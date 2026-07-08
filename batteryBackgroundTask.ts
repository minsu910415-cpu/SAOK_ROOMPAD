import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState, type AppStateStatus } from "react-native";
import * as BackgroundFetch from "expo-background-fetch";
import * as Battery from "expo-battery";
import * as TaskManager from "expo-task-manager";
import { apiUpdateBattery } from "./roompadApi";

export const STORAGE_ROOM_ID_KEY = "@saok_roompad/roomId";
const STORAGE_DEVICE_TOKEN_KEY = "@saok_roompad/deviceToken";

export const BACKGROUND_BATTERY_TASK = "saok-roompad-battery-report";
const BATTERY_REPORT_INTERVAL_MS = 10 * 60 * 1000;

let foregroundIntervalId: ReturnType<typeof setInterval> | null = null;
let activeRoomId: string | null = null;
let appStateSubscription: { remove: () => void } | null = null;

const readBatteryLevel = async (): Promise<number | null> => {
  try {
    const isAvailable = await Battery.isAvailableAsync();
    if (!isAvailable) return null;

    const level = await Battery.getBatteryLevelAsync();
    if (level != null && !Number.isNaN(level) && level >= 0 && level <= 1) {
      return level;
    }

    const powerState = await Battery.getPowerStateAsync();
    const fallbackLevel = powerState.batteryLevel;
    if (
      fallbackLevel != null &&
      !Number.isNaN(fallbackLevel) &&
      fallbackLevel >= 0 &&
      fallbackLevel <= 1
    ) {
      return fallbackLevel;
    }
  } catch (error) {
    console.error("[roompad][battery] Failed to read battery level:", error);
  }

  return null;
};

/**
 * 배터리 레벨을 서버(roompadUpdateBattery)로 보고한다.
 * 미인증 태블릿은 shared_spaces를 직접 쓸 수 없으므로 기기 세션 토큰으로 콜러블을 호출한다.
 * 백그라운드(헤드리스) 컨텍스트에서도 동작하도록 토큰을 AsyncStorage에서 읽어 명시 전달한다.
 */
export async function reportBatteryLevel(): Promise<boolean> {
  try {
    const level = await readBatteryLevel();
    if (level == null) {
      console.error("[roompad][battery] Battery level unavailable on this device");
      return false;
    }

    const deviceToken = await AsyncStorage.getItem(STORAGE_DEVICE_TOKEN_KEY);
    if (!deviceToken) {
      console.warn("[roompad][battery] Skipped report: no device session token");
      return false;
    }

    await apiUpdateBattery(level, deviceToken);

    console.log("[roompad][battery] Reported level:", Math.round(level * 100) + "%");
    return true;
  } catch (error) {
    console.error("[roompad][battery] Battery report failed:", error);
    return false;
  }
}

async function runBatteryBackgroundTask(): Promise<BackgroundFetch.BackgroundFetchResult> {
  try {
    const roomId = await AsyncStorage.getItem(STORAGE_ROOM_ID_KEY);
    if (!roomId) {
      console.warn("[roompad][battery] Background task skipped: no roomId");
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }

    const reported = await reportBatteryLevel();
    return reported
      ? BackgroundFetch.BackgroundFetchResult.NewData
      : BackgroundFetch.BackgroundFetchResult.Failed;
  } catch (error) {
    console.error("[roompad][battery] Background task crashed:", error);
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
}

TaskManager.defineTask(BACKGROUND_BATTERY_TASK, runBatteryBackgroundTask);

const reportActiveRoomBattery = () => {
  if (!activeRoomId) return;
  void reportBatteryLevel();
};

const ensureAppStateListener = () => {
  if (appStateSubscription) return;

  appStateSubscription = AppState.addEventListener("change", (nextState: AppStateStatus) => {
    if (nextState === "active") {
      reportActiveRoomBattery();
    }
  });
};

export function startForegroundBatteryReporting(roomId: string) {
  stopForegroundBatteryReporting();

  activeRoomId = roomId;
  ensureAppStateListener();
  reportActiveRoomBattery();

  foregroundIntervalId = setInterval(() => {
    reportActiveRoomBattery();
  }, BATTERY_REPORT_INTERVAL_MS);

  console.log("[roompad][battery] Foreground reporting started (every 10 min)");
}

export function stopForegroundBatteryReporting() {
  if (foregroundIntervalId) {
    clearInterval(foregroundIntervalId);
    foregroundIntervalId = null;
  }
  activeRoomId = null;
}

export async function registerBatteryBackgroundReporting(roomId?: string) {
  const targetRoomId = roomId ?? (await AsyncStorage.getItem(STORAGE_ROOM_ID_KEY));
  if (!targetRoomId) return;

  startForegroundBatteryReporting(targetRoomId);

  try {
    const status = await BackgroundFetch.getStatusAsync();
    if (
      status === BackgroundFetch.BackgroundFetchStatus.Restricted ||
      status === BackgroundFetch.BackgroundFetchStatus.Denied
    ) {
      console.warn(
        "[roompad][battery] Background fetch unavailable (status:",
        status,
        ") — using foreground interval only"
      );
      return;
    }

    const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_BATTERY_TASK);
    if (!isRegistered) {
      await BackgroundFetch.registerTaskAsync(BACKGROUND_BATTERY_TASK, {
        minimumInterval: BATTERY_REPORT_INTERVAL_MS / 1000,
        stopOnTerminate: false,
        startOnBoot: true,
      });
      console.log("[roompad][battery] Background fetch registered (EAS/dev build)");
    }
  } catch (error) {
    console.warn("[roompad][battery] Background fetch registration failed:", error);
  }
}

export async function unregisterBatteryBackgroundReporting() {
  stopForegroundBatteryReporting();

  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_BATTERY_TASK);
    if (isRegistered) {
      await BackgroundFetch.unregisterTaskAsync(BACKGROUND_BATTERY_TASK);
      console.log("[roompad][battery] Background fetch unregistered");
    }
  } catch (error) {
    console.error("[roompad][battery] Failed to unregister background fetch:", error);
  }
}
