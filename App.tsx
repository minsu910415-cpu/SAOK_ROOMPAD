import { LinearGradient } from "expo-linear-gradient";
import { StatusBar } from "expo-status-bar";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Brightness from "expo-brightness";
import { useKeepAwake } from "expo-keep-awake";
import * as NavigationBar from "expo-navigation-bar";
import {
  registerBatteryBackgroundReporting,
  unregisterBatteryBackgroundReporting,
} from "./batteryBackgroundTask";
import {
  apiValidatePin,
  apiLookupMembership,
  apiCreateBooking,
  apiUpdateBattery,
  apiDisconnect,
  apiGetRoomState,
  setRoompadDeviceToken,
} from "./roompadApi";
import {
  formatMembershipConfirmTitle,
  type MatchedMembership,
} from "./membershipLookup";
import { hasEnoughCoins, isCoinDeductionSufficient, planCoinDeduction } from "./coinDeduction";
import {
  calculateBillingUnits,
  calculateReservationDeductCoin,
  formatOperatingHours,
  formatReservationDuration,
  getCurrentTimeLinePercent,
  getDefaultReservationEnd,
  getReservationEndTimeOptions,
  getReservationStartTimeOptions,
  getVisibleTimelineSlots,
  isCurrentTimeInOperatingHours,
  isSlotStartBookable,
  mapSharedSpacePricing,
  validateReservationRange,
  type SharedSpacePricing,
} from "./sharedSpacePricing";
import { Timestamp } from "firebase/firestore";
import { FirebaseError } from "firebase/app";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

type ScreenMode = "initialLoading" | "activation" | "connecting" | "dashboard";
type RoomMode = "available" | "inUse";
type Reservation = { id: string; start: string; end: string; roomNumber: string };
type DeviceBinding = { roomId: string; workspaceId: string; pinId: string };

const pinCount = 6;
const DASHBOARD_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const TIMELINE_SLOT_ROW_HEIGHT = 60;
const DEFAULT_USER_BRIGHTNESS = 0.85;
const SLEEP_MODE_BRIGHTNESS = 0.05;
const MIN_NORMAL_BRIGHTNESS = 0.25;
const STORAGE_ROOM_ID_KEY = "@saok_roompad/roomId";
const STORAGE_WORKSPACE_ID_KEY = "@saok_roompad/workspaceId";
const STORAGE_DEVICE_TOKEN_KEY = "@saok_roompad/deviceToken";
const STORAGE_NIGHT_START_KEY = "@saok_roompad/nightStartTime";
const STORAGE_NIGHT_END_KEY = "@saok_roompad/nightEndTime";
const STORAGE_NIGHT_MODE_ENABLED_KEY = "@saok_roompad/nightModeEnabled";
const STORAGE_WAKE_UP_ENABLED_KEY = "@saok_roompad/wakeUpEnabled";
const sampleSlots = Array.from({ length: 25 }, (_, hour) => `${hour.toString().padStart(2, "0")}:00`);
const hourSlots = Array.from({ length: 24 }, (_, hour) => `${hour.toString().padStart(2, "0")}:00`);

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

const formatRange = (start: string, end: string) => `${start} ~ ${end}`;
const minutesInDay = 24 * 60;
const toTimeString = (minutes: number) => {
  const hh = Math.floor(minutes / 60)
    .toString()
    .padStart(2, "0");
  const mm = (minutes % 60).toString().padStart(2, "0");
  return `${hh}:${mm}`;
};

const toDateFromUnknown = (value: unknown) => {
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  if (value && typeof value === "object" && "seconds" in value) {
    const tsLike = value as { seconds?: number };
    if (typeof tsLike.seconds === "number") return new Date(tsLike.seconds * 1000);
  }
  return null;
};

const toHHMM = (value: unknown) => {
  const date = toDateFromUnknown(value);
  if (!date) return "00:00";
  return date.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
};

const isSameLocalDate = (left: Date, right: Date) =>
  left.getFullYear() === right.getFullYear() &&
  left.getMonth() === right.getMonth() &&
  left.getDate() === right.getDate();

const isConfirmedBookingStatus = (status: unknown) => {
  if (status == null || status === "") return true;
  return String(status).trim().toUpperCase() === "CONFIRMED";
};

// 예약 매핑은 roompadGetRoomState 폴링에서 서버 반환값({id,status,startMs,endMs})으로 직접 처리한다.

const hasReservationTimeOverlap = (
  existingReservations: Reservation[],
  startTime: string,
  endTime: string
) => {
  const newStart = toMinutes(startTime);
  const newEnd = toMinutes(endTime);
  if (newStart >= newEnd) return false;

  return existingReservations.some((item) => {
    const existingStart = toMinutes(item.start);
    const existingEnd = toMinutes(item.end);
    return newStart < existingEnd && newEnd > existingStart;
  });
};

const findOverlappingReservation = (
  existingReservations: Reservation[],
  startTime: string,
  endTime: string
) => {
  const newStart = toMinutes(startTime);
  const newEnd = toMinutes(endTime);
  if (newStart >= newEnd) return null;

  return (
    existingReservations.find((item) => {
      const existingStart = toMinutes(item.start);
      const existingEnd = toMinutes(item.end);
      return newStart < existingEnd && newEnd > existingStart;
    }) ?? null
  );
};

const getReservationOverlapError = (
  existingReservations: Reservation[],
  startTime: string,
  endTime: string
): string | null => {
  const conflict = findOverlappingReservation(existingReservations, startTime, endTime);
  if (!conflict) return null;

  return `선택한 시간(${startTime} ~ ${endTime})에 기존 예약(${conflict.start} ~ ${conflict.end})과 겹칩니다. 다른 시간을 선택해 주세요.`;
};

export default function App() {
  useKeepAwake();

  const [screenMode, setScreenMode] = useState<ScreenMode>("initialLoading");
  const [now, setNow] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [showSettings, setShowSettings] = useState(false);
  const [showDisconnectConfirmModal, setShowDisconnectConfirmModal] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState("");
  const [showReservationModal, setShowReservationModal] = useState(false);
  const [showReservationConfirmModal, setShowReservationConfirmModal] = useState(false);
  const [showReservationDoneModal, setShowReservationDoneModal] = useState(false);
  const [reservationPhone, setReservationPhone] = useState("");
  const [matchedMembership, setMatchedMembership] = useState<MatchedMembership | null>(null);
  const [membershipLookupError, setMembershipLookupError] = useState("");
  const [isMembershipLookingUp, setIsMembershipLookingUp] = useState(false);
  const [isReservationSubmitting, setIsReservationSubmitting] = useState(false);
  const [reservationSubmitError, setReservationSubmitError] = useState("");
  const [selectedStartTime, setSelectedStartTime] = useState("14:00");
  const [selectedEndTime, setSelectedEndTime] = useState("16:00");
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [boundRoomId, setBoundRoomId] = useState<string | null>(null);
  const [boundWorkspaceId, setBoundWorkspaceId] = useState<string | null>(null);
  const [boundRoomName, setBoundRoomName] = useState<string>("STUDIO A");
  const [sharedSpacePricing, setSharedSpacePricing] = useState<SharedSpacePricing | null>(null);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState("");
  const [isPinSubmitting, setIsPinSubmitting] = useState(false);
  const [nightModeEnabled, setNightModeEnabled] = useState(true);
  const [wakeUpEnabled, setWakeUpEnabled] = useState(true);
  const [nightStartTime, setNightStartTime] = useState("22:00");
  const [nightEndTime, setNightEndTime] = useState("07:00");
  const [nightTimePickerTarget, setNightTimePickerTarget] = useState<"start" | "end" | null>(null);
  const [reservationTimePickerTarget, setReservationTimePickerTarget] = useState<"start" | "end" | null>(
    null
  );
  const [isSleepMode, setIsSleepMode] = useState(false);
  const spinnerRotate = useRef(new Animated.Value(0)).current;
  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timelineScrollRef = useRef<ScrollView>(null);
  const userPreferredBrightnessRef = useRef(DEFAULT_USER_BRIGHTNESS);
  const brightnessBeforeSleepRef = useRef<number | null>(null);
  const isBrightnessGrantedRef = useRef(false);
  /** 웹 관리자 연결 해지 리스너 중복 실행 방지 */
  const adminDisconnectHandledRef = useRef(false);
  /** 기기 자체 연결 해지 시 관리자 해지 리스너 무시 */
  const skipAdminDisconnectListenerRef = useRef(false);

  const displayTime = useMemo(
    () => now.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }),
    [now]
  );

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const loadNightSettings = async () => {
      try {
        const values = await AsyncStorage.multiGet([
          STORAGE_NIGHT_START_KEY,
          STORAGE_NIGHT_END_KEY,
          STORAGE_NIGHT_MODE_ENABLED_KEY,
          STORAGE_WAKE_UP_ENABLED_KEY,
        ]);
        const start = values[0]?.[1];
        const end = values[1]?.[1];
        const nightEnabled = values[2]?.[1];
        const wakeEnabled = values[3]?.[1];

        if (start && hourSlots.includes(start)) setNightStartTime(start);
        if (end && hourSlots.includes(end)) setNightEndTime(end);
        if (nightEnabled != null) setNightModeEnabled(nightEnabled === "1");
        if (wakeEnabled != null) setWakeUpEnabled(wakeEnabled === "1");
      } catch (error) {
        console.error("[roompad][settings] failed to load night settings:", error);
      }
    };

    void loadNightSettings();
  }, []);

  useEffect(() => {
    if (screenMode !== "dashboard") return;

    const refreshDashboardToNow = () => {
      const current = new Date();
      setNow(current);
      setSelectedDate(new Date(current));
      setShowSettings(false);
      setShowReservationModal(false);
      setShowReservationConfirmModal(false);
      setShowReservationDoneModal(false);
      setReservationPhone("");
      setMatchedMembership(null);
      setMembershipLookupError("");
      setReservationSubmitError("");
      setIsSleepMode(false);

      const currentMinutes = current.getHours() * 60 + current.getMinutes();
      const visibleSlots = getVisibleTimelineSlots(sampleSlots, sharedSpacePricing, (slotMinutes) =>
        reservations.some(
          (item) =>
            slotMinutes >= toMinutes(item.start) && slotMinutes < toMinutes(item.end)
        )
      );
      const timelineContentHeight = visibleSlots.length * TIMELINE_SLOT_ROW_HEIGHT;
      const scrollY =
        sharedSpacePricing && isCurrentTimeInOperatingHours(currentMinutes, sharedSpacePricing)
          ? Math.max(
              0,
              (getCurrentTimeLinePercent(currentMinutes, sharedSpacePricing) / 100) *
                timelineContentHeight -
                TIMELINE_SLOT_ROW_HEIGHT * 2
            )
          : 0;

      requestAnimationFrame(() => {
        timelineScrollRef.current?.scrollTo({ y: scrollY, animated: true });
      });

      if (__DEV__) {
        console.log("[roompad] dashboard refreshed to current date/time");
      }
    };

    const interval = setInterval(refreshDashboardToNow, DASHBOARD_REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [screenMode]);

  useEffect(() => {
    const prepareBrightness = async () => {
      try {
        const permission = await Brightness.requestPermissionsAsync();
        isBrightnessGrantedRef.current = permission.status === "granted";
        if (!isBrightnessGrantedRef.current) return;

        const current = await Brightness.getBrightnessAsync();
        if (current >= MIN_NORMAL_BRIGHTNESS) {
          userPreferredBrightnessRef.current = current;
        }

        if (!isSleepMode) {
          await Brightness.setBrightnessAsync(userPreferredBrightnessRef.current);
        }
      } catch {
        isBrightnessGrantedRef.current = false;
      }
    };

    void prepareBrightness();
  }, []);

  useEffect(() => {
    if (Platform.OS !== "android") return;

    const setImmersiveMode = async () => {
      await NavigationBar.setBehaviorAsync("overlay-swipe");
      await NavigationBar.setPositionAsync("absolute");
      await NavigationBar.setVisibilityAsync("hidden");
      await NavigationBar.setBackgroundColorAsync("#00000000");
    };

    void setImmersiveMode();
  }, []);

  useEffect(() => {
    let isMounted = true;

    const bootstrapDeviceAuth = async () => {
      try {
        const values = await AsyncStorage.multiGet([
          STORAGE_ROOM_ID_KEY,
          STORAGE_WORKSPACE_ID_KEY,
          STORAGE_DEVICE_TOKEN_KEY,
        ]);
        const roomId = values[0]?.[1];
        const workspaceId = values[1]?.[1];
        const deviceToken = values[2]?.[1];
        const hasSavedAuth = Boolean(roomId && workspaceId && deviceToken);

        // 저장된 기기 세션 토큰을 메모리에 복원 → 이후 콜러블 호출에 사용
        if (hasSavedAuth && deviceToken) {
          setRoompadDeviceToken(deviceToken);
        }

        setTimeout(() => {
          if (!isMounted) return;
          setBoundRoomId(roomId ?? null);
          setBoundWorkspaceId(workspaceId ?? null);
          setScreenMode(hasSavedAuth ? "dashboard" : "activation");
        }, 800);
      } catch {
        if (isMounted) setScreenMode("activation");
      }
    };

    void bootstrapDeviceAuth();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!boundRoomId || screenMode !== "dashboard") {
      void unregisterBatteryBackgroundReporting();
      return;
    }

    void registerBatteryBackgroundReporting(boundRoomId);

    return () => {
      void unregisterBatteryBackgroundReporting();
    };
  }, [boundRoomId, screenMode]);

  useEffect(() => {
    if (screenMode !== "connecting") return;

    const animation = Animated.loop(
      Animated.timing(spinnerRotate, {
        toValue: 1,
        duration: 1100,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    animation.start();

    return () => {
      animation.stop();
      spinnerRotate.setValue(0);
    };
  }, [screenMode, spinnerRotate]);

  useEffect(() => {
    if (!isBrightnessGrantedRef.current) return;

    const applySleepBrightness = async () => {
      try {
        if (isSleepMode) {
          const current = await Brightness.getBrightnessAsync();
          brightnessBeforeSleepRef.current =
            current >= MIN_NORMAL_BRIGHTNESS
              ? current
              : userPreferredBrightnessRef.current;
          await Brightness.setBrightnessAsync(SLEEP_MODE_BRIGHTNESS);
          return;
        }

        const restoreTarget =
          brightnessBeforeSleepRef.current ?? userPreferredBrightnessRef.current;
        await Brightness.setBrightnessAsync(restoreTarget);
        if (brightnessBeforeSleepRef.current != null) {
          userPreferredBrightnessRef.current = restoreTarget;
        }
        brightnessBeforeSleepRef.current = null;
      } catch (error) {
        console.error("[roompad][brightness] apply failed:", error);
      }
    };

    void applySleepBrightness();
  }, [isSleepMode]);

  useEffect(() => {
    return () => {
      if (!isBrightnessGrantedRef.current) return;
      void Brightness.setBrightnessAsync(userPreferredBrightnessRef.current);
    };
  }, []);

  const getFirebaseErrorCode = (error: unknown) => {
    if (error && typeof error === "object" && "code" in error) {
      return String((error as FirebaseError).code);
    }
    return "unknown";
  };

  // PIN 검증/연결등록은 서버(roompadValidatePin)가 담당한다. (직접 Firestore 접근 제거됨)

  const persistDeviceAuth = async (binding: DeviceBinding, deviceToken: string) => {
    await AsyncStorage.multiSet([
      [STORAGE_ROOM_ID_KEY, binding.roomId],
      [STORAGE_WORKSPACE_ID_KEY, binding.workspaceId],
      [STORAGE_DEVICE_TOKEN_KEY, deviceToken],
    ]);
  };

  const clearDeviceAuth = async () => {
    await AsyncStorage.multiRemove([STORAGE_ROOM_ID_KEY, STORAGE_WORKSPACE_ID_KEY, STORAGE_DEVICE_TOKEN_KEY]);
  };

  const handlePinSubmit = async (inputPin: string) => {
    if (isPinSubmitting) return;
    setIsPinSubmitting(true);
    setPinError("");
    setScreenMode("connecting");

    try {
      // 서버 콜러블: PIN 검증 + 연결등록 + 세션토큰 발급 + 룸 정보 반환
      const result = await apiValidatePin(inputPin.trim());
      await persistDeviceAuth(
        {
          roomId: result.roomId,
          workspaceId: result.workspaceId,
          pinId: inputPin.trim(),
        },
        result.deviceToken,
      );
      setBoundRoomId(result.roomId);
      setBoundWorkspaceId(result.workspaceId);
      setBoundRoomName(result.roomName || result.room?.name || "STUDIO A");
      if (result.room) setSharedSpacePricing(mapSharedSpacePricing(result.room));
      setPin("");
      setScreenMode("dashboard");
    } catch (error) {
      const code = getFirebaseErrorCode(error);
      console.error("[roompad] pin submit failed:", code, error);
      setPin("");
      setPinError(
        code === "functions/not-found"
          ? "PIN 인증에 실패했습니다. 다시 입력해 주세요."
          : "연결 중 오류가 발생했습니다. 다시 시도해 주세요.",
      );
      setScreenMode("activation");
    } finally {
      setIsPinSubmitting(false);
    }
  };

  const resetLocalDeviceState = () => {
    setShowSettings(false);
    setShowDisconnectConfirmModal(false);
    setShowReservationModal(false);
    setShowReservationConfirmModal(false);
    setShowReservationDoneModal(false);
    setReservations([]);
    setBoundRoomId(null);
    setBoundWorkspaceId(null);
    setBoundRoomName("STUDIO A");
    setSharedSpacePricing(null);
    setMatchedMembership(null);
    setPin("");
    setPinError("");
    setDisconnectError("");
    setIsSleepMode(false);
    resetReservationFlow();
  };

  const handleDisconnectPress = () => {
    setDisconnectError("");
    setShowDisconnectConfirmModal(true);
  };

  const handleDisconnectCancel = () => {
    if (isDisconnecting) return;
    setShowDisconnectConfirmModal(false);
    setDisconnectError("");
  };

  const handleDisconnectConfirm = async () => {
    if (!boundRoomId || !boundWorkspaceId || isDisconnecting) return;

    setIsDisconnecting(true);
    setDisconnectError("");
    skipAdminDisconnectListenerRef.current = true;

    try {
      await apiDisconnect();
      await unregisterBatteryBackgroundReporting();
      await clearDeviceAuth();
      resetLocalDeviceState();
      setScreenMode("activation");
    } catch (error) {
      console.error("[roompad][disconnect] failed:", getFirebaseErrorCode(error), error);
      setDisconnectError("연결 해지에 실패했습니다. 네트워크를 확인해 주세요.");
    } finally {
      skipAdminDisconnectListenerRef.current = false;
      setIsDisconnecting(false);
    }
  };

  /**
   * 룸 상태 폴링(roompadGetRoomState) — 미인증 태블릿의 직접 Firestore 접근을 대체한다.
   * 한 번의 폴링으로 (1) 관리자 연결해지 감지 (2) 가격/이름 (3) 예약현황을 모두 처리.
   * 폴링 시 서버가 기기 세션 만료를 자동 연장한다.
   */
  useEffect(() => {
    if (!boundRoomId || screenMode !== "dashboard") {
      return;
    }
    adminDisconnectHandledRef.current = false;
    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;
      try {
        const state = await apiGetRoomState();
        if (cancelled) return;

        if (state.room) {
          setBoundRoomName(state.room.name || boundRoomId);
          setSharedSpacePricing(mapSharedSpacePricing(state.room));
        }

        const roomBookings: Reservation[] = (state.bookings || [])
          .map((b) => {
            const startDate = new Date(b.startMs);
            const endDate = new Date(b.endMs);
            if (!isSameLocalDate(startDate, selectedDate)) return null;
            return {
              id: b.id,
              start: toHHMM(startDate),
              end: toHHMM(endDate),
              roomNumber: "-",
            } as Reservation;
          })
          .filter((item): item is Reservation => Boolean(item))
          .sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
        setReservations(roomBookings);

        if (
          state.is_roompad_active === false &&
          !skipAdminDisconnectListenerRef.current &&
          !isDisconnecting &&
          !adminDisconnectHandledRef.current
        ) {
          adminDisconnectHandledRef.current = true;
          try {
            await unregisterBatteryBackgroundReporting();
            await clearDeviceAuth();
            resetLocalDeviceState();
          } catch (error) {
            console.error("[roompad][admin-disconnect] cleanup failed:", error);
          }
          Alert.alert(
            "알림",
            "관리자에 의해 기기 연결이 해지되었습니다.",
            [
              {
                text: "확인",
                onPress: () => {
                  adminDisconnectHandledRef.current = false;
                  skipAdminDisconnectListenerRef.current = false;
                  setScreenMode("activation");
                },
              },
            ],
            { cancelable: false }
          );
        }
      } catch (error) {
        if (cancelled) return;
        const code = getFirebaseErrorCode(error);
        // 세션 만료 → PIN 재입력 화면으로
        if (code === "functions/unauthenticated") {
          await clearDeviceAuth().catch(() => {});
          setRoompadDeviceToken(null);
          resetLocalDeviceState();
          setScreenMode("activation");
          return;
        }
        console.error("[roompad][poll] room state failed:", code, error);
      }
    };

    void poll();
    const intervalId = setInterval(() => {
      void poll();
    }, 12000);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [boundRoomId, screenMode, isDisconnecting, selectedDate]);

  const onPinNumberPress = (digit: string) => {
    if (pin.length >= pinCount || isPinSubmitting) return;
    const next = pin + digit;
    setPin(next);
    if (next.length === pinCount) {
      void handlePinSubmit(next);
    }
  };

  const onPinDelete = () => {
    setPin((prev: string) => prev.slice(0, -1));
  };

  const resetReservationFlow = () => {
    setReservationPhone("");
    setMatchedMembership(null);
    setMembershipLookupError("");
    setReservationSubmitError("");
    setIsMembershipLookingUp(false);
    setIsReservationSubmitting(false);
    setReservationTimePickerTarget(null);
  };

  const onReservationNumberPress = (digit: string) => {
    if (reservationPhone.length >= 8) return;
    setReservationPhone((prev: string) => prev + digit);
    setMatchedMembership(null);
    setMembershipLookupError("");
    setReservationSubmitError("");
  };

  const onReservationDelete = () => {
    setReservationPhone((prev: string) => prev.slice(0, -1));
    setMatchedMembership(null);
    setMembershipLookupError("");
    setReservationSubmitError("");
  };

  const buildBookingTimestamp = (date: Date, hhmm: string) => {
    const [hours, minutes] = hhmm.split(":").map(Number);
    const value = new Date(date);
    value.setHours(hours, minutes, 0, 0);
    return Timestamp.fromDate(value);
  };

  const handleReservationNextStep = async () => {
    if (reservationPhone.length !== 8 || !boundWorkspaceId) return;

    setIsMembershipLookingUp(true);
    setMembershipLookupError("");
    setMatchedMembership(null);
    setReservationSubmitError("");

    try {
      const lookupResult = await apiLookupMembership(reservationPhone);
      const membership = lookupResult.membership;
      if (!lookupResult.matched || !membership) {
        setMembershipLookupError("등록된 입주사 정보를 찾을 수 없습니다. 번호를 확인해 주세요.");
        return;
      }

      if (!sharedSpacePricing || !Number.isFinite(deductCoin) || deductCoin < 0) {
        setMembershipLookupError("공간 요금 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
        return;
      }

      if (!hasEnoughCoins(membership.coin_balance_free, membership.coin_balance_paid, deductCoin)) {
        const owned = membership.coin_balance_free + membership.coin_balance_paid;
        setMembershipLookupError(
          `보유 코인(${owned.toLocaleString()}C)이 부족합니다. 필요 코인: ${deductCoin.toLocaleString()}C`
        );
        return;
      }

      const operatingError = validateReservationRange(
        selectedStartTime,
        selectedEndTime,
        sharedSpacePricing
      );
      if (operatingError) {
        setMembershipLookupError(operatingError);
        return;
      }

      const overlapError = getReservationOverlapError(
        reservations,
        selectedStartTime,
        selectedEndTime
      );
      if (overlapError) {
        setMembershipLookupError(overlapError);
        return;
      }

      setMatchedMembership(membership);
      setShowReservationModal(false);
      setShowReservationConfirmModal(true);
    } catch (error) {
      console.error("[roompad][membership] lookup failed:", getFirebaseErrorCode(error), error);
      setMembershipLookupError("입주사 조회 중 오류가 발생했습니다. 다시 시도해 주세요.");
    } finally {
      setIsMembershipLookingUp(false);
    }
  };

  const handleReservationConfirm = async () => {
    if (!matchedMembership || !boundWorkspaceId || !boundRoomId || isReservationSubmitting) {
      return;
    }

    if (reservationDurationMinutes <= 0) {
      setReservationSubmitError("예약 시간을 다시 확인해 주세요.");
      return;
    }

    if (!sharedSpacePricing || !Number.isFinite(deductCoin) || deductCoin < 0) {
      setReservationSubmitError("공간 요금 정보를 불러오지 못했습니다. 다시 시도해 주세요.");
      return;
    }

    const operatingError = validateReservationRange(
      selectedStartTime,
      selectedEndTime,
      sharedSpacePricing
    );
    if (operatingError) {
      setReservationSubmitError(operatingError);
      return;
    }

    const overlapError = getReservationOverlapError(
      reservations,
      selectedStartTime,
      selectedEndTime
    );
    if (overlapError) {
      setReservationSubmitError(overlapError);
      return;
    }

    setIsReservationSubmitting(true);
    setReservationSubmitError("");

    try {
      // 서버 콜러블: 중복체크 + 잔액재확인 + 코인차감 + 예약생성을 트랜잭션으로 처리
      const startMs = buildBookingTimestamp(selectedDate, selectedStartTime).toMillis();
      const endMs = buildBookingTimestamp(selectedDate, selectedEndTime).toMillis();
      const bookingResult = await apiCreateBooking({
        membershipId: matchedMembership.id,
        startTimeMs: startMs,
        endTimeMs: endMs,
        deductCoin,
      });
      if (!bookingResult.ok) {
        setReservationSubmitError("예약을 처리할 수 없습니다. 다시 시도해 주세요.");
        return;
      }

      setShowReservationConfirmModal(false);
      setShowReservationDoneModal(true);
      resetReservationFlow();
    } catch (error) {
      const code = getFirebaseErrorCode(error);
      const message =
        error && typeof (error as { message?: unknown }).message === "string"
          ? String((error as { message?: unknown }).message)
          : "";
      console.error("[roompad][booking] create failed:", code, error);
      // 서버가 failed-precondition으로 던지는 상세 메시지(중복/코인부족)를 우선 노출
      setReservationSubmitError(message || "예약 저장 중 오류가 발생했습니다. 다시 시도해 주세요.");
    } finally {
      setIsReservationSubmitting(false);
    }
  };

  const pickAvailableReservationEnd = (startSlot: string) => {
    if (!sharedSpacePricing) return null;

    const endOptions = getReservationEndTimeOptions(startSlot, sharedSpacePricing).filter(
      (end) => !hasReservationTimeOverlap(reservations, startSlot, end)
    );
    if (endOptions.length === 0) return null;

    const preferredEnd = getDefaultReservationEnd(startSlot, sharedSpacePricing);
    return endOptions.includes(preferredEnd) ? preferredEnd : endOptions[0];
  };

  const onTimeSlotPress = (slot: string) => {
    if (!sharedSpacePricing || !isSlotStartBookable(slot, sharedSpacePricing)) return;

    const endSlot = pickAvailableReservationEnd(slot);
    if (!endSlot) {
      Alert.alert("예약 불가", "선택한 시간에 이미 예약이 있습니다. 다른 시간을 선택해 주세요.");
      return;
    }

    setSelectedStartTime(slot);
    setSelectedEndTime(endSlot);
    resetReservationFlow();
    setShowReservationModal(true);
  };

  const openReservationWithStartSlot = (startSlot: string) => {
    if (!sharedSpacePricing) return;

    const endSlot = pickAvailableReservationEnd(startSlot);
    if (!endSlot) {
      Alert.alert("예약 불가", "선택한 시간에 이미 예약이 있습니다. 다른 시간을 선택해 주세요.");
      return;
    }

    setSelectedStartTime(startSlot);
    setSelectedEndTime(endSlot);
    resetReservationFlow();
    setShowReservationConfirmModal(false);
    setShowReservationModal(true);
  };

  const formatSelectedDate = (date: Date) => {
    const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, "0");
    const day = date.getDate().toString().padStart(2, "0");
    return `${year}.${month}.${day} (${weekdays[date.getDay()]})`;
  };

  const changeSelectedDate = (offsetDays: number) => {
    setSelectedDate((prev: Date) => {
      const next = new Date(prev);
      next.setDate(next.getDate() + offsetDays);
      return next;
    });
  };

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const nightStartMinutes = toMinutes(nightStartTime);
  const nightEndMinutes = toMinutes(nightEndTime);
  const isNightTime =
    nightStartMinutes <= nightEndMinutes
      ? currentMinutes >= nightStartMinutes && currentMinutes < nightEndMinutes
      : currentMinutes >= nightStartMinutes || currentMinutes < nightEndMinutes;

  const clearInactivityTimer = () => {
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
    }
  };

  const resetInactivityTimer = () => {
    clearInactivityTimer();
    if (!nightModeEnabled || !isNightTime || screenMode !== "dashboard" || isSleepMode) return;
    inactivityTimerRef.current = setTimeout(() => {
      setIsSleepMode(true);
    }, 30000);
  };

  const handleUserInteraction = () => {
    if (isSleepMode) return;
    resetInactivityTimer();
  };

  const handleWakeUp = () => {
    if (!wakeUpEnabled) return;
    setIsSleepMode(false);
    resetInactivityTimer();
  };

  const handleSettingsSave = async () => {
    try {
      await AsyncStorage.multiSet([
        [STORAGE_NIGHT_START_KEY, nightStartTime],
        [STORAGE_NIGHT_END_KEY, nightEndTime],
        [STORAGE_NIGHT_MODE_ENABLED_KEY, nightModeEnabled ? "1" : "0"],
        [STORAGE_WAKE_UP_ENABLED_KEY, wakeUpEnabled ? "1" : "0"],
      ]);
      setNightTimePickerTarget(null);
      setShowSettings(false);
    } catch (error) {
      console.error("[roompad][settings] failed to save night settings:", error);
    }
  };

  const handleNightTimeSelect = (time: string) => {
    if (nightTimePickerTarget === "start") {
      setNightStartTime(time);
    } else if (nightTimePickerTarget === "end") {
      setNightEndTime(time);
    }
    setNightTimePickerTarget(null);
  };

  const reservationStartTimeOptions = useMemo(() => {
    if (!sharedSpacePricing) return [];

    return getReservationStartTimeOptions(sharedSpacePricing).filter((start) =>
      getReservationEndTimeOptions(start, sharedSpacePricing).some(
        (end) => !hasReservationTimeOverlap(reservations, start, end)
      )
    );
  }, [sharedSpacePricing, reservations]);

  const reservationEndTimeOptions = useMemo(() => {
    if (!sharedSpacePricing) return [];

    return getReservationEndTimeOptions(selectedStartTime, sharedSpacePricing).filter(
      (end) => !hasReservationTimeOverlap(reservations, selectedStartTime, end)
    );
  }, [sharedSpacePricing, selectedStartTime, reservations]);

  const reservationTimeRangeError = sharedSpacePricing
    ? validateReservationRange(selectedStartTime, selectedEndTime, sharedSpacePricing)
    : null;

  const reservationOverlapError = getReservationOverlapError(
    reservations,
    selectedStartTime,
    selectedEndTime
  );

  const reservationValidationError = reservationTimeRangeError ?? reservationOverlapError;

  const handleReservationStartTimeSelect = (time: string) => {
    if (!sharedSpacePricing) return;
    setSelectedStartTime(time);
    const endOptions = getReservationEndTimeOptions(time, sharedSpacePricing).filter(
      (end) => !hasReservationTimeOverlap(reservations, time, end)
    );
    setSelectedEndTime((prev) => {
      if (endOptions.includes(prev)) return prev;
      if (endOptions.length > 0) return endOptions[0];
      return getDefaultReservationEnd(time, sharedSpacePricing);
    });
    setReservationTimePickerTarget(null);
    setMembershipLookupError("");
    setReservationSubmitError("");
  };

  const handleReservationEndTimeSelect = (time: string) => {
    setSelectedEndTime(time);
    setReservationTimePickerTarget(null);
    setMembershipLookupError("");
    setReservationSubmitError("");
  };
  const currentReservation =
    reservations.find((item) => currentMinutes >= toMinutes(item.start) && currentMinutes < toMinutes(item.end)) ??
    null;
  const nextReservation = reservations.find((item) => toMinutes(item.start) > currentMinutes) ?? null;
  const roomMode: RoomMode = currentReservation ? "inUse" : "available";
  const reservationDurationMinutes = Math.max(
    0,
    toMinutes(selectedEndTime) - toMinutes(selectedStartTime)
  );
  const reservationDurationLabel = formatReservationDuration(reservationDurationMinutes);
  const billingUnits = sharedSpacePricing
    ? calculateBillingUnits(reservationDurationMinutes, sharedSpacePricing.bookingUnitMinutes)
    : 0;
  const ownedCoin = matchedMembership
    ? matchedMembership.coin_balance_free + matchedMembership.coin_balance_paid
    : 0;
  const deductCoin = sharedSpacePricing
    ? calculateReservationDeductCoin(selectedStartTime, selectedEndTime, sharedSpacePricing)
    : 0;
  const remainCoin = ownedCoin - deductCoin;
  // 무료 공간(deductCoin=0)도 예약 가능해야 한다 → deductCoin >= 0 허용(0이면 차감 없음).
  const canAffordReservation =
    Boolean(matchedMembership && sharedSpacePricing && Number.isFinite(deductCoin) && deductCoin >= 0) &&
    hasEnoughCoins(
      matchedMembership?.coin_balance_free ?? 0,
      matchedMembership?.coin_balance_paid ?? 0,
      deductCoin
    );
  const membershipConfirmTitle = matchedMembership
    ? formatMembershipConfirmTitle(matchedMembership)
    : "예약자 정보 확인 중";
  const roomDisplayName = boundRoomName || "STUDIO A";
  const operatingHoursLabel = sharedSpacePricing
    ? formatOperatingHours(sharedSpacePricing)
    : "운영 시간 정보 없음";

  const isSlotReserved = (slotMinutes: number) =>
    reservations.some(
      (item) => slotMinutes >= toMinutes(item.start) && slotMinutes < toMinutes(item.end)
    );

  const visibleTimelineSlots = useMemo(
    () => getVisibleTimelineSlots(sampleSlots, sharedSpacePricing, isSlotReserved),
    [sharedSpacePricing, reservations]
  );

  const showCurrentTimeLine =
    sharedSpacePricing != null &&
    isSameLocalDate(selectedDate, now) &&
    isCurrentTimeInOperatingHours(currentMinutes, sharedSpacePricing);

  const currentTimeLinePercent = sharedSpacePricing
    ? getCurrentTimeLinePercent(currentMinutes, sharedSpacePricing)
    : 0;

  // 가격/이름/예약현황은 위 roompadGetRoomState 폴링에서 설정한다.
  // 여기서는 미연결 상태의 기본값만 리셋한다(직접 Firestore 접근 없음).
  useEffect(() => {
    if (!boundRoomId) {
      setBoundRoomName("STUDIO A");
      setSharedSpacePricing(null);
      setReservations([]);
    }
  }, [boundRoomId]);

  useEffect(() => {
    if (!nightModeEnabled || !isNightTime) {
      setIsSleepMode(false);
    }
  }, [nightModeEnabled, isNightTime]);

  useEffect(() => {
    if (!nightModeEnabled || !isNightTime || screenMode !== "dashboard") {
      clearInactivityTimer();
      return;
    }

    if (!isSleepMode) {
      resetInactivityTimer();
    }

    return () => {
      clearInactivityTimer();
    };
  }, [nightModeEnabled, isNightTime, screenMode, isSleepMode]);

  useEffect(() => {
    if (!isSleepMode) return;
    setShowSettings(false);
    setShowReservationModal(false);
    setShowReservationConfirmModal(false);
    setShowReservationDoneModal(false);
  }, [isSleepMode]);

  const sleepClock = now.toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const sleepOverlay = isSleepMode ? (
    <Pressable style={styles.sleepOverlay} onPress={handleWakeUp}>
      <Text style={styles.sleepTimeText}>{sleepClock}</Text>
    </Pressable>
  ) : null;

  if (screenMode === "activation") {
    return (
      <SafeAreaView style={styles.safeArea} onTouchStart={handleUserInteraction}>
        <StatusBar hidden style="dark" />
        <View style={styles.activationCard}>
          <Text style={styles.brandTitle}>SAOK</Text>
          <Text style={styles.activationTitle}>기기 활성화를 위한</Text>
          <Text style={styles.activationSub}>6자리 PIN 코드를 입력해 주세요.</Text>
          <View style={styles.pinRow}>
            {[0, 1, 2, 3, 4, 5].map((index) => (
              <View key={`pin-${index}`} style={styles.pinBox}>
                <Text style={styles.pinValue}>{pin[index] ?? ""}</Text>
              </View>
            ))}
          </View>
          <View style={styles.keypad}>
            {[
              ["1", "2", "3"],
              ["4", "5", "6"],
              ["7", "8", "9"],
              ["⌫", "0", ""],
            ].map((row, rowIndex) => (
              <View key={`row-${rowIndex}`} style={styles.keypadRow}>
                {row.map((label, colIndex) =>
                  label ? (
                    <Pressable
                      key={`${rowIndex}-${colIndex}-${label}`}
                      style={styles.keyButton}
                      onPress={() => (label === "⌫" ? onPinDelete() : onPinNumberPress(label))}
                    >
                      <Text style={styles.keyLabel}>{label}</Text>
                    </Pressable>
                  ) : (
                    <View key={`${rowIndex}-${colIndex}-empty`} style={styles.keyButtonPlaceholder} />
                  )
                )}
              </View>
            ))}
          </View>
          <Text style={styles.helpText}>PIN 코드는 관리자로부터 받으실 수 있습니다.</Text>
          {pinError ? <Text style={styles.pinErrorText}>{pinError}</Text> : null}
        </View>
        {sleepOverlay}
      </SafeAreaView>
    );
  }

  if (screenMode === "initialLoading") {
    return (
      <SafeAreaView style={styles.safeArea} onTouchStart={handleUserInteraction}>
        <StatusBar hidden style="dark" />
        <View style={styles.initialLoadingCard}>
          <Text style={styles.initialLoadingBrand}>SAOK</Text>
          <ActivityIndicator size="large" color="#F27059" />
          <Text style={styles.initialLoadingText}>룸패드를 준비하고 있습니다.</Text>
        </View>
        {sleepOverlay}
      </SafeAreaView>
    );
  }

  if (screenMode === "connecting") {
    const spin = spinnerRotate.interpolate({
      inputRange: [0, 1],
      outputRange: ["0deg", "360deg"],
    });

    return (
      <SafeAreaView style={styles.safeArea} onTouchStart={handleUserInteraction}>
        <StatusBar hidden style="dark" />
        <View style={styles.connectingCard}>
          <Animated.View style={[styles.connectingSpinner, { transform: [{ rotate: spin }] }]} />
          <Text style={styles.connectingTitle}>연결 중...</Text>
          <Text style={styles.connectingSub}>기기를 활성화하고 있습니다.</Text>
        </View>
        {sleepOverlay}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} onTouchStart={handleUserInteraction}>
      <StatusBar hidden style="dark" />
      <Pressable style={styles.settingsButton} onPress={() => setShowSettings(true)}>
        <View style={styles.iconBox}>
          <Text style={styles.settingsIcon}>⚙</Text>
        </View>
      </Pressable>

      <View style={styles.content}>
        <View style={styles.timelinePanel}>
          <View style={styles.dateHeader}>
            <Pressable style={styles.dateNavButton} onPress={() => changeSelectedDate(-1)}>
              <View style={styles.iconBox}>
                <Text style={styles.dateNavText}>‹</Text>
              </View>
            </Pressable>
            <Text style={styles.dateTitle}>{formatSelectedDate(selectedDate)}</Text>
            <Pressable style={styles.dateNavButton} onPress={() => changeSelectedDate(1)}>
              <View style={styles.iconBox}>
                <Text style={styles.dateNavText}>›</Text>
              </View>
            </Pressable>
          </View>
          <ScrollView ref={timelineScrollRef} contentContainerStyle={styles.timelineList}>
            <View style={styles.timelineInner}>
              {visibleTimelineSlots.map((slot) => {
                const slotMinutes = toMinutes(slot);
                const matchedReservation = reservations.find(
                  (item) => slotMinutes >= toMinutes(item.start) && slotMinutes < toMinutes(item.end)
                );
                const isBooked = Boolean(matchedReservation);
                const isCurrent =
                  roomMode === "inUse" &&
                  currentReservation &&
                  slotMinutes >= toMinutes(currentReservation.start) &&
                  slotMinutes < toMinutes(currentReservation.end);
                return (
                  <Pressable
                    key={slot}
                    style={styles.slotRow}
                    disabled={isBooked}
                    onPress={() => onTimeSlotPress(slot)}
                  >
                    <Text style={styles.slotTime}>{slot}</Text>
                    <View
                      style={[
                        styles.slotBadge,
                        isBooked ? styles.slotBadgeBooked : styles.slotBadgeFree,
                        isCurrent && styles.slotBadgeCurrent,
                      ]}
                    >
                      <Text style={[styles.slotBadgeText, !isBooked && styles.slotBadgeTextFree]}>
                        {isBooked ? matchedReservation?.roomNumber : "예약 가능"}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}

              {showCurrentTimeLine ? (
                <View
                  pointerEvents="none"
                  style={[
                    styles.currentTimeLine,
                    {
                      top: `${currentTimeLinePercent}%`,
                    },
                  ]}
                >
                  <View style={styles.currentTimeDot} />
                </View>
              ) : null}
            </View>
          </ScrollView>
        </View>

        <View style={styles.statusPanel}>
          <LinearGradient
            colors={
              roomMode === "inUse"
                ? (["#659999", "#f4791f"] as const)
                : (["#00416a", "#799f0c", "#ffe000"] as const)
            }
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.statusPanelInner}>
            <View style={styles.statusPanelHeader}>
              <Text style={styles.statusPanelRoomName}>{roomDisplayName}</Text>
              <Text style={styles.statusPanelClock}>◷ {displayTime}</Text>
            </View>

            <View style={styles.statusCenter}>
              <View
                style={[
                  styles.statusDot,
                  roomMode === "inUse" ? styles.statusDotInUse : styles.statusDotAvailable,
                ]}
              />
              <Text style={styles.statusTitle}>
                {roomMode === "inUse" ? "사용 중" : "사용 가능"}
              </Text>
              {roomMode === "inUse" ? (
                <>
                  <Text style={styles.statusMeta}>호실: {currentReservation?.roomNumber}</Text>
                  <Text style={styles.usageTime}>
                    {currentReservation
                      ? formatRange(currentReservation.start, currentReservation.end)
                      : "-"}
                  </Text>
                  <Text style={styles.statusMeta}>
                    다음 예약: {nextReservation ? nextReservation.start : "없음"}
                  </Text>
                </>
              ) : (
                <Text style={styles.statusMeta}>
                  {nextReservation
                    ? `다음 예약: ${nextReservation.start} (${nextReservation.roomNumber})`
                    : "오늘 남은 예약이 없습니다"}
                </Text>
              )}
            </View>

            {roomMode === "available" ? (
              <Pressable
                style={styles.reserveButton}
                onPress={() => {
                  if (!sharedSpacePricing) return;
                  const nextSlot =
                    sampleSlots.find((slot) => {
                      const slotMinutes = toMinutes(slot);
                      if (slotMinutes < currentMinutes || !isSlotStartBookable(slot, sharedSpacePricing)) {
                        return false;
                      }
                      return getReservationEndTimeOptions(slot, sharedSpacePricing).some(
                        (end) => !hasReservationTimeOverlap(reservations, slot, end)
                      );
                    }) ?? null;
                  if (!nextSlot) {
                    Alert.alert(
                      "예약 불가",
                      `현재 예약 가능한 시간이 없습니다.\n이용 가능: ${operatingHoursLabel}`
                    );
                    return;
                  }
                  openReservationWithStartSlot(nextSlot);
                }}
              >
                <Text style={styles.reserveButtonText}>지금 예약하기</Text>
              </Pressable>
            ) : (
              <View style={styles.statusPanelFooterSpacer} />
            )}
          </View>
        </View>
      </View>

      <Modal visible={showSettings} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>룸패드 설정</Text>
              <Pressable onPress={() => setShowSettings(false)}>
                <View style={styles.iconBox}>
                  <Text style={styles.closeButton}>✕</Text>
                </View>
              </Pressable>
            </View>
            <ScrollView showsVerticalScrollIndicator contentContainerStyle={styles.settingsScrollContent}>
              <Text style={styles.modalSectionTitle}>야간 절전 설정</Text>
              <View style={styles.rowBetween}>
                <Text style={styles.modalLabel}>야간 절전 모드 활성화</Text>
                <Pressable
                  style={[styles.switchTrack, nightModeEnabled && styles.switchTrackOn]}
                  onPress={() => setNightModeEnabled((prev: boolean) => !prev)}
                >
                  <View style={[styles.switchThumb, nightModeEnabled && styles.switchThumbOn]} />
                </Pressable>
              </View>
              <Text style={styles.settingsHintText}>
                기기 화면을 물리적으로 끄지 않고, 앱을 검은 화면으로 전환한 뒤 밝기를 0%로 낮춰 화면을 보호합니다.
              </Text>
              <View style={styles.inlineInputs}>
                <View style={styles.timeInputGroup}>
                  <Text style={styles.reservationLabel}>시작 시간</Text>
                  <Pressable
                    style={[styles.timeSelectBox, !nightModeEnabled && styles.timeSelectBoxDisabled]}
                    disabled={!nightModeEnabled}
                    onPress={() => setNightTimePickerTarget("start")}
                  >
                    <Text style={[styles.timeSelectText, !nightModeEnabled && styles.timeSelectTextDisabled]}>
                      {nightStartTime}
                    </Text>
                    <View style={styles.iconBox}>
                      <Text style={styles.selectChevron}>⌄</Text>
                    </View>
                  </Pressable>
                </View>
                <View style={styles.timeInputGroup}>
                  <Text style={styles.reservationLabel}>종료 시간</Text>
                  <Pressable
                    style={[styles.timeSelectBox, !nightModeEnabled && styles.timeSelectBoxDisabled]}
                    disabled={!nightModeEnabled}
                    onPress={() => setNightTimePickerTarget("end")}
                  >
                    <Text style={[styles.timeSelectText, !nightModeEnabled && styles.timeSelectTextDisabled]}>
                      {nightEndTime}
                    </Text>
                    <View style={styles.iconBox}>
                      <Text style={styles.selectChevron}>⌄</Text>
                    </View>
                  </Pressable>
                </View>
              </View>
              <Pressable
                style={[styles.wakeUpRow, !nightModeEnabled && styles.wakeUpRowDisabled]}
                disabled={!nightModeEnabled}
                onPress={() => setWakeUpEnabled((prev: boolean) => !prev)}
              >
                <View style={[styles.wakeUpCheck, wakeUpEnabled && styles.wakeUpCheckOn]}>
                  <Text style={styles.wakeUpCheckText}>{wakeUpEnabled ? "✓" : ""}</Text>
                </View>
                <Text style={styles.wakeUpText}>화면 터치 시 즉시 깨우기 (Wake-up)</Text>
              </Pressable>

              <Text style={styles.modalSectionTitle}>기기 정보</Text>
              <View style={styles.deviceInfoCard}>
                <View style={styles.deviceInfoRow}>
                  <Text style={styles.deviceInfoKey}>연결된 공간</Text>
                  <Text style={styles.deviceInfoValueStrong}>{roomDisplayName}</Text>
                </View>
                <View style={styles.deviceInfoRow}>
                  <Text style={styles.deviceInfoKey}>모델명</Text>
                  <Text style={styles.deviceInfoValue}>Galaxy Tab A7</Text>
                </View>
                <View style={styles.deviceInfoRow}>
                  <Text style={styles.deviceInfoKey}>기기 ID</Text>
                  <Text style={styles.deviceInfoValue}>SAOK-2024-0001</Text>
                </View>
              </View>

              <Pressable style={styles.disconnectButton} onPress={handleDisconnectPress}>
                <Text style={styles.disconnectButtonText}>기기 연결 해지</Text>
              </Pressable>
              <Text style={styles.disconnectHelpText}>
                기기 변경을 위해 현재 연결된 공간과의 매칭을 해제합니다.
              </Text>

              <View style={styles.settingsFooter}>
                <Pressable style={styles.settingsSaveButton} onPress={() => void handleSettingsSave()}>
                  <Text style={styles.settingsSaveButtonText}>저장하기</Text>
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={showDisconnectConfirmModal} animationType="fade" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.disconnectConfirmCard}>
            <View style={styles.disconnectWarningIconWrap}>
              <View style={styles.disconnectWarningIconInner}>
                <Text style={styles.disconnectWarningIconText}>!</Text>
              </View>
            </View>
            <Text style={styles.disconnectConfirmTitle}>정말로 기기 연결을{"\n"}해지하시겠습니까?</Text>
            <Text style={styles.disconnectConfirmMessage}>
              정말로 이 기기의 연결을 해지하시겠습니까? 연결 해지 시 재인증이 필요합니다.
            </Text>
            {disconnectError ? (
              <Text style={styles.reservationErrorText}>{disconnectError}</Text>
            ) : null}
            <View style={styles.disconnectConfirmActions}>
              <Pressable
                style={styles.disconnectCancelButton}
                disabled={isDisconnecting}
                onPress={handleDisconnectCancel}
              >
                <Text style={styles.disconnectCancelText}>취소</Text>
              </Pressable>
              <Pressable
                style={[styles.disconnectConfirmButton, isDisconnecting && styles.confirmSubmitButtonDisabled]}
                disabled={isDisconnecting}
                onPress={() => void handleDisconnectConfirm()}
              >
                <Text style={styles.disconnectConfirmText}>
                  {isDisconnecting ? "해지 중..." : "해지"}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={nightTimePickerTarget !== null} animationType="fade" transparent>
        <Pressable style={styles.modalBackdrop} onPress={() => setNightTimePickerTarget(null)}>
          <View style={styles.nightTimePickerCard}>
            <Text style={styles.nightTimePickerTitle}>
              {nightTimePickerTarget === "start" ? "절전 시작 시간" : "절전 종료 시간"}
            </Text>
            <ScrollView style={styles.nightTimePickerList}>
              {hourSlots.map((time) => {
                const isSelected =
                  nightTimePickerTarget === "start"
                    ? nightStartTime === time
                    : nightEndTime === time;
                return (
                  <Pressable
                    key={`night-time-${nightTimePickerTarget}-${time}`}
                    style={[styles.nightTimeOption, isSelected && styles.nightTimeOptionSelected]}
                    onPress={() => handleNightTimeSelect(time)}
                  >
                    <Text
                      style={[styles.nightTimeOptionText, isSelected && styles.nightTimeOptionTextSelected]}
                    >
                      {time}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>

      <Modal
        visible={showReservationModal && reservationTimePickerTarget !== null}
        animationType="fade"
        transparent
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setReservationTimePickerTarget(null)}
        >
          <View style={styles.nightTimePickerCard}>
            <Text style={styles.nightTimePickerTitle}>
              {reservationTimePickerTarget === "start" ? "시작 시간 선택" : "종료 시간 선택"}
            </Text>
            <ScrollView style={styles.nightTimePickerList}>
              {(reservationTimePickerTarget === "start"
                ? reservationStartTimeOptions
                : reservationEndTimeOptions
              ).map((time) => {
                const isSelected =
                  reservationTimePickerTarget === "start"
                    ? selectedStartTime === time
                    : selectedEndTime === time;
                return (
                  <Pressable
                    key={`reservation-time-${reservationTimePickerTarget}-${time}`}
                    style={[styles.nightTimeOption, isSelected && styles.nightTimeOptionSelected]}
                    onPress={() =>
                      reservationTimePickerTarget === "start"
                        ? handleReservationStartTimeSelect(time)
                        : handleReservationEndTimeSelect(time)
                    }
                  >
                    <Text
                      style={[
                        styles.nightTimeOptionText,
                        isSelected && styles.nightTimeOptionTextSelected,
                      ]}
                    >
                      {time}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={showReservationModal} animationType="fade" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.reservationCard}>
            <View style={styles.reservationHeader}>
              <View style={styles.iconBox}>
                <Text style={styles.reservationHeaderIcon}>‹</Text>
              </View>
              <View style={styles.reservationHeaderCenter}>
                <Text style={styles.reservationTitle}>예약자 확인을 위해</Text>
                <Text style={styles.reservationSubtitle}>휴대폰 번호를 입력해 주세요</Text>
              </View>
              <Pressable
                onPress={() => {
                  setReservationTimePickerTarget(null);
                  setShowReservationModal(false);
                }}
              >
                <View style={styles.iconBox}>
                  <Text style={styles.closeButton}>✕</Text>
                </View>
              </Pressable>
            </View>

            <View style={styles.reservationContent}>
              <View style={styles.reservationLeftPanel}>
                <Text style={styles.reservationLeftTitle}>◷ 예약 시간 설정</Text>
                <Text style={styles.reservationOperatingHours}>
                  이용 가능: {operatingHoursLabel}
                  {sharedSpacePricing
                    ? ` (최대 ${sharedSpacePricing.maxConsecutiveHours}시간)`
                    : ""}
                </Text>
                <Text style={styles.reservationLabel}>시작 시간</Text>
                <Pressable
                  style={[styles.selectBox, !sharedSpacePricing && styles.selectBoxDisabled]}
                  disabled={!sharedSpacePricing}
                  onPress={() => setReservationTimePickerTarget("start")}
                >
                  <Text style={styles.selectText}>{selectedStartTime}</Text>
                  <View style={styles.iconBox}>
                    <Text style={styles.selectChevron}>⌄</Text>
                  </View>
                </Pressable>
                <Text style={styles.timeDivider}>~</Text>
                <Text style={styles.reservationLabel}>종료 시간</Text>
                <Pressable
                  style={[
                    styles.selectBox,
                    (!sharedSpacePricing || reservationEndTimeOptions.length === 0) &&
                      styles.selectBoxDisabled,
                  ]}
                  disabled={!sharedSpacePricing || reservationEndTimeOptions.length === 0}
                  onPress={() => setReservationTimePickerTarget("end")}
                >
                  <Text style={styles.selectText}>{selectedEndTime}</Text>
                  <View style={styles.iconBox}>
                    <Text style={styles.selectChevron}>⌄</Text>
                  </View>
                </Pressable>
                <View style={styles.totalTimeBox}>
                  <Text style={styles.totalTimeText}>총 {reservationDurationLabel}</Text>
                </View>
                {reservationValidationError ? (
                  <Text style={styles.reservationErrorText}>{reservationValidationError}</Text>
                ) : null}
                {sharedSpacePricing ? (
                  <Text style={styles.reservationPricingHint}>
                    {sharedSpacePricing.bookingUnitLabel}당 {sharedSpacePricing.coinPerUnit.toLocaleString()}C
                    {billingUnits > 0 ? ` · 예상 ${billingUnits}회 차감` : ""}
                  </Text>
                ) : null}
              </View>

              <View style={styles.reservationRightPanel}>
                <View style={styles.phoneDisplayBox}>
                  <Text style={styles.phoneDisplayText}>
                    {`010  -  ${reservationPhone.slice(0, 4).padEnd(4, "*")}  -  ${reservationPhone
                      .slice(4, 8)
                      .padEnd(4, "*")}`}
                  </Text>
                </View>
                <View style={styles.reservationPad}>
                  {[
                    ["1", "2", "3"],
                    ["4", "5", "6"],
                    ["7", "8", "9"],
                    ["⌫", "0", ""],
                  ].map((row, rowIndex) => (
                    <View key={`reserve-row-${rowIndex}`} style={styles.reservationPadRow}>
                      {row.map((label, colIndex) =>
                        label ? (
                          <Pressable
                            key={`reserve-${rowIndex}-${colIndex}-${label}`}
                            style={styles.reservationPadButton}
                            onPress={() =>
                              label === "⌫" ? onReservationDelete() : onReservationNumberPress(label)
                            }
                          >
                            <Text style={styles.reservationPadText}>{label}</Text>
                          </Pressable>
                        ) : (
                          <View
                            key={`reserve-empty-${rowIndex}-${colIndex}`}
                            style={styles.reservationPadButtonPlaceholder}
                          />
                        )
                      )}
                    </View>
                  ))}
                </View>
                {membershipLookupError ? (
                  <Text style={styles.reservationErrorText}>{membershipLookupError}</Text>
                ) : null}
                <Pressable
                  style={[
                    styles.reservationNextButton,
                    reservationPhone.length === 8 &&
                      !isMembershipLookingUp &&
                      !reservationValidationError &&
                      styles.reservationNextButtonActive,
                  ]}
                  disabled={
                    reservationPhone.length !== 8 ||
                    isMembershipLookingUp ||
                    Boolean(reservationValidationError)
                  }
                  onPress={() => void handleReservationNextStep()}
                >
                  <Text
                    style={[
                      styles.reservationNextButtonText,
                      reservationPhone.length === 8 &&
                        !isMembershipLookingUp &&
                        !reservationValidationError &&
                        styles.reservationNextButtonTextActive,
                    ]}
                  >
                    {isMembershipLookingUp ? "확인 중..." : "다음 단계"}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={showReservationConfirmModal} animationType="fade" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.confirmCard}>
            <View style={styles.confirmHeader}>
              <Pressable
                onPress={() => {
                  setShowReservationConfirmModal(false);
                  setShowReservationModal(true);
                }}
              >
                <View style={styles.iconBox}>
                  <Text style={styles.reservationHeaderIcon}>‹</Text>
                </View>
              </Pressable>
              <View style={styles.reservationHeaderCenter}>
                <Text style={styles.confirmTitle}>{membershipConfirmTitle}</Text>
                <Text style={styles.confirmSubtitle}>예약 정보를 확인해 주세요</Text>
              </View>
              <Pressable onPress={() => setShowReservationConfirmModal(false)}>
                <View style={styles.iconBox}>
                  <Text style={styles.closeButton}>✕</Text>
                </View>
              </Pressable>
            </View>

            <View style={styles.confirmInfoBox}>
              <View style={styles.confirmRow}>
                <Text style={styles.confirmLabel}>예약 공간</Text>
                <Text style={styles.confirmValueStrong}>{roomDisplayName}</Text>
              </View>
              <View style={styles.confirmDivider} />
              <View style={styles.confirmRow}>
                <Text style={styles.confirmLabel}>예약 시간</Text>
                <Text style={styles.confirmValueStrong}>
                  {selectedStartTime} ~ {selectedEndTime} ({reservationDurationLabel})
                </Text>
              </View>
              <View style={styles.confirmDivider} />
              <View style={[styles.confirmRow, styles.confirmRowTight]}>
                <Text style={styles.confirmLabel}>보유 코인</Text>
                <Text style={styles.confirmCoinValue}>{ownedCoin} C</Text>
              </View>
              <View style={[styles.confirmRow, styles.confirmRowTight]}>
                <Text style={styles.confirmDeductLabel}>차감 코인</Text>
                <Text style={styles.confirmDeductValue}>
                  - {deductCoin.toLocaleString()} C
                  {sharedSpacePricing && billingUnits > 0
                    ? ` (${billingUnits}×${sharedSpacePricing.coinPerUnit.toLocaleString()}C)`
                    : ""}
                </Text>
              </View>
              <View style={styles.confirmDivider} />
              <View style={styles.confirmRow}>
                <Text style={styles.confirmRemainLabel}>잔여 코인</Text>
                <Text
                  style={[
                    styles.confirmRemainValue,
                    !canAffordReservation && styles.confirmRemainValueInsufficient,
                  ]}
                >
                  {remainCoin.toLocaleString()} C
                </Text>
              </View>
            </View>

            {!canAffordReservation ? (
              <Text style={styles.reservationErrorText}>
                보유 코인이 부족하여 예약할 수 없습니다. (필요 {deductCoin.toLocaleString()}C / 보유{" "}
                {ownedCoin.toLocaleString()}C)
              </Text>
            ) : null}

            {reservationSubmitError ? (
              <Text style={styles.reservationErrorText}>{reservationSubmitError}</Text>
            ) : null}

            <View style={styles.confirmActions}>
              <Pressable
                style={styles.confirmCancelButton}
                onPress={() => {
                  setShowReservationConfirmModal(false);
                  setShowReservationModal(true);
                  setReservationSubmitError("");
                }}
              >
                <Text style={styles.confirmCancelText}>취소</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.confirmSubmitButton,
                  (isReservationSubmitting || !canAffordReservation) && styles.confirmSubmitButtonDisabled,
                ]}
                disabled={!matchedMembership || isReservationSubmitting || !canAffordReservation}
                onPress={() => void handleReservationConfirm()}
              >
                <Text style={styles.confirmSubmitText}>
                  {isReservationSubmitting ? "예약 처리 중..." : "결제 및 예약 확정"}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={showReservationDoneModal} animationType="fade" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.doneCard}>
            <View style={styles.doneIconWrap}>
              <View style={styles.doneIconCircle}>
                <Text style={styles.doneIconText}>✓</Text>
              </View>
            </View>
            <Text style={styles.doneTitle}>예약이 완료되었습니다.</Text>
            <Text style={styles.doneSubtitle}>{roomDisplayName}의 문이 열렸습니다.</Text>
            <Text style={styles.doneSubtitle}>바로 이용해 주세요.</Text>

            <Pressable
              style={styles.doneConfirmButton}
              onPress={() => {
                setShowReservationDoneModal(false);
              }}
            >
              <Text style={styles.doneConfirmText}>확인</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      {sleepOverlay}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#f5f6f8",
  },
  sleepOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000000",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 999,
  },
  sleepTimeText: {
    fontSize: 56,
    color: "#333333",
    fontWeight: "500",
    letterSpacing: 2,
  },
  settingsButton: {
    position: "absolute",
    top: 16,
    right: 16,
    zIndex: 20,
    width: 52,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 26,
    backgroundColor: "#ffffff",
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  iconBox: {
    width: 24,
    height: 24,
    justifyContent: "center",
    alignItems: "center",
  },
  settingsIcon: {
    fontSize: 18,
    lineHeight: 20,
    color: "#2B3A55",
    textAlign: "center",
    includeFontPadding: false,
  },
  content: {
    flex: 1,
    flexDirection: "row",
    margin: 12,
    borderRadius: 18,
    overflow: "hidden",
    backgroundColor: "#ffffff",
  },
  timelinePanel: {
    width: "40%",
    backgroundColor: "#f8fafc",
    borderRightWidth: 1,
    borderRightColor: "#eef1f4",
    padding: 12,
  },
  dateHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
    paddingVertical: 8,
    paddingHorizontal: 4,
    minHeight: 56,
  },
  dateNavButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#eef1f4",
  },
  dateNavText: {
    fontSize: 20,
    color: "#2B3A55",
    fontWeight: "700",
    lineHeight: 22,
    textAlign: "center",
    includeFontPadding: false,
  },
  dateTitle: {
    textAlign: "center",
    color: "#2B3A55",
    fontSize: 26,
    fontWeight: "800",
    flex: 1,
    lineHeight: 32,
  },
  timelineList: { paddingBottom: 20, gap: 8 },
  timelineInner: { position: "relative" },
  slotRow: { flexDirection: "row", alignItems: "center", height: 52 },
  slotTime: { width: 52, color: "#2B3A55", fontSize: 12 },
  slotBadge: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  slotBadgeBooked: { backgroundColor: "#2B3A55" },
  slotBadgeFree: { backgroundColor: "transparent" },
  slotBadgeCurrent: { backgroundColor: "#F27059" },
  slotBadgeText: { color: "#ffffff", fontSize: 12 },
  slotBadgeTextFree: { color: "#c2c7cf" },
  reservationOperatingHours: {
    fontSize: 16,
    color: "#5f6670",
    marginBottom: 10,
    lineHeight: 22,
  },
  currentTimeLine: {
    position: "absolute",
    left: 52,
    right: 4,
    height: 2,
    backgroundColor: "#F27059",
    zIndex: 10,
  },
  currentTimeDot: {
    position: "absolute",
    left: -5,
    top: -4,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#F27059",
  },
  statusPanel: {
    width: "60%",
    overflow: "hidden",
    position: "relative",
  },
  statusPanelInner: {
    flex: 1,
    paddingHorizontal: 24,
    paddingVertical: 28,
    justifyContent: "space-between",
  },
  statusPanelHeader: { gap: 4 },
  statusPanelRoomName: { fontSize: 52, fontWeight: "800", color: "#ffffff" },
  statusPanelClock: { fontSize: 30, color: "rgba(255,255,255,0.88)", marginTop: 4 },
  statusCenter: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 14,
    paddingVertical: 16,
  },
  statusDot: { width: 58, height: 58, borderRadius: 29 },
  statusDotAvailable: {
    borderWidth: 4,
    borderColor: "#ffffff",
    backgroundColor: "rgba(255,255,255,0.25)",
  },
  statusDotInUse: {
    backgroundColor: "#ffffff",
    borderWidth: 4,
    borderColor: "rgba(255,255,255,0.55)",
  },
  statusTitle: {
    fontSize: 50,
    color: "#ffffff",
    fontWeight: "800",
    textAlign: "center",
    textShadowColor: "rgba(0,0,0,0.15)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
  statusMeta: {
    fontSize: 26,
    color: "rgba(255,255,255,0.92)",
    textAlign: "center",
    lineHeight: 34,
  },
  usageTime: {
    fontSize: 64,
    color: "#ffffff",
    fontWeight: "800",
    textAlign: "center",
    textShadowColor: "rgba(0,0,0,0.12)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
  statusPanelFooterSpacer: { minHeight: 68 },
  reserveButton: {
    alignSelf: "flex-end",
    backgroundColor: "#ffffff",
    borderRadius: 14,
    paddingHorizontal: 26,
    paddingVertical: 16,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  reserveButtonText: { color: "#128F57", fontSize: 30, fontWeight: "800" },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.2)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalCard: {
    width: "88%",
    backgroundColor: "#ffffff",
    borderRadius: 20,
    padding: 20,
    maxHeight: "90%",
  },
  settingsScrollContent: {
    gap: 12,
    paddingBottom: 16,
  },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  modalTitle: { fontSize: 34, fontWeight: "800", color: "#2B3A55" },
  closeButton: {
    fontSize: 18,
    lineHeight: 20,
    color: "#9aa0a8",
    textAlign: "center",
    includeFontPadding: false,
  },
  modalSectionTitle: { fontSize: 28, color: "#2B3A55", fontWeight: "700" },
  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#f5f7f9",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  modalLabel: { fontSize: 26, color: "#2B3A55" },
  switchTrack: {
    width: 56,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#d5d9df",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  switchTrackOn: { backgroundColor: "#F27059" },
  switchThumb: { width: 24, height: 24, borderRadius: 12, backgroundColor: "#ffffff" },
  switchThumbOn: { alignSelf: "flex-end" },
  inlineInputs: { flexDirection: "row", gap: 10 },
  timeInputGroup: { flex: 1, gap: 6 },
  timeSelectBox: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#dce1e7",
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: "#ffffff",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  timeSelectBoxDisabled: {
    backgroundColor: "#f1f3f6",
    borderColor: "#e6eaef",
  },
  timeSelectText: { fontSize: 26, color: "#2B3A55", fontWeight: "600" },
  timeSelectTextDisabled: { color: "#98a0ab" },
  nightTimePickerCard: {
    width: "42%",
    maxHeight: "70%",
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 20,
    alignSelf: "center",
    marginTop: "15%",
  },
  nightTimePickerTitle: {
    fontSize: 24,
    color: "#2B3A55",
    fontWeight: "800",
    marginBottom: 12,
    textAlign: "center",
  },
  nightTimePickerList: { maxHeight: 420 },
  nightTimeOption: {
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 6,
  },
  nightTimeOptionSelected: { backgroundColor: "#fde8e4" },
  nightTimeOptionText: { fontSize: 24, color: "#2B3A55", textAlign: "center" },
  nightTimeOptionTextSelected: { color: "#F27059", fontWeight: "800" },
  wakeUpRowDisabled: { opacity: 0.5 },
  settingsHintText: { fontSize: 18, color: "#8e949d", lineHeight: 26 },
  wakeUpRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f1f3f6",
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    gap: 10,
  },
  wakeUpCheck: {
    width: 30,
    height: 30,
    borderWidth: 2,
    borderColor: "#bcc2ca",
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
  },
  wakeUpCheckOn: {
    backgroundColor: "#2085da",
    borderColor: "#2085da",
  },
  wakeUpCheckText: { color: "#ffffff", fontSize: 22, fontWeight: "800" },
  wakeUpText: { fontSize: 18, color: "#2B3A55", flex: 1 },
  deviceInfoCard: {
    borderRadius: 14,
    backgroundColor: "#f4f6f8",
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  deviceInfoRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  deviceInfoKey: { fontSize: 18, color: "#4f5560" },
  deviceInfoValue: { fontSize: 18, color: "#2B3A55" },
  deviceInfoValueStrong: { fontSize: 20, color: "#2B3A55", fontWeight: "700" },
  disconnectButton: {
    borderWidth: 2,
    borderColor: "#ea8c93",
    borderRadius: 14,
    minHeight: 56,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  disconnectButtonText: { fontSize: 22, color: "#d74757", fontWeight: "700" },
  disconnectHelpText: { textAlign: "center", color: "#a6adb7", fontSize: 16 },
  disconnectConfirmCard: {
    width: "72%",
    maxWidth: 720,
    backgroundColor: "#ffffff",
    borderRadius: 20,
    paddingVertical: 36,
    paddingHorizontal: 32,
    alignItems: "center",
    alignSelf: "center",
  },
  disconnectWarningIconWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: "#fde8e4",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  disconnectWarningIconInner: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "#fad4ce",
    alignItems: "center",
    justifyContent: "center",
  },
  disconnectWarningIconText: { fontSize: 40, color: "#d74757", fontWeight: "800" },
  disconnectConfirmTitle: {
    fontSize: 34,
    color: "#2B3A55",
    fontWeight: "800",
    textAlign: "center",
    lineHeight: 44,
    marginBottom: 14,
  },
  disconnectConfirmMessage: {
    fontSize: 20,
    color: "#5f6670",
    textAlign: "center",
    lineHeight: 30,
    marginBottom: 20,
  },
  disconnectConfirmActions: { flexDirection: "row", gap: 12, width: "100%" },
  disconnectCancelButton: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#dce1e7",
    backgroundColor: "#ffffff",
    paddingVertical: 16,
    alignItems: "center",
  },
  disconnectCancelText: { fontSize: 22, color: "#5f6670", fontWeight: "700" },
  disconnectConfirmButton: {
    flex: 1,
    borderRadius: 14,
    backgroundColor: "#d74757",
    paddingVertical: 16,
    alignItems: "center",
  },
  disconnectConfirmText: { fontSize: 22, color: "#ffffff", fontWeight: "800" },
  settingsFooter: {
    alignItems: "flex-end",
    marginTop: 2,
  },
  settingsSaveButton: {
    backgroundColor: "#2B3A55",
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 28,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  settingsSaveButtonText: { color: "#ffffff", fontSize: 22, fontWeight: "800" },
  activateButton: {
    alignSelf: "flex-start",
    backgroundColor: "#2B3A55",
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginTop: 8,
  },
  activateButtonText: { color: "#ffffff", fontSize: 22, fontWeight: "700" },
  activationCard: {
    margin: 20,
    flex: 1,
    borderRadius: 20,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    gap: 8,
  },
  initialLoadingCard: {
    margin: 20,
    flex: 1,
    borderRadius: 20,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
  },
  initialLoadingBrand: { fontSize: 52, fontWeight: "800", color: "#2B3A55", marginBottom: 8 },
  initialLoadingText: { fontSize: 24, color: "#7a818c" },
  brandTitle: { fontSize: 48, fontWeight: "800", color: "#2B3A55" },
  activationTitle: { fontSize: 28, color: "#2B3A55", fontWeight: "700" },
  activationSub: { fontSize: 24, color: "#6f7480" },
  pinRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  pinBox: {
    width: 40,
    height: 54,
    borderWidth: 1,
    borderColor: "#d9dde3",
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  pinValue: { fontSize: 28, color: "#2B3A55", fontWeight: "700" },
  keypad: {
    width: "70%",
    gap: 8,
    marginTop: 12,
  },
  keypadRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
  },
  keyButton: {
    flex: 1,
    minHeight: 56,
    borderWidth: 1,
    borderColor: "#d9dde3",
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
  },
  keyButtonPlaceholder: {
    flex: 1,
    minHeight: 56,
  },
  keyLabel: { fontSize: 30, color: "#2B3A55", fontWeight: "700" },
  helpText: { fontSize: 18, color: "#c0c5cd", marginTop: 8 },
  pinErrorText: { fontSize: 16, color: "#d64545", marginTop: 6 },
  connectingCard: {
    margin: 20,
    flex: 1,
    borderRadius: 20,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  connectingSpinner: {
    width: 62,
    height: 62,
    borderRadius: 31,
    borderWidth: 5,
    borderColor: "#F27059",
    borderTopColor: "transparent",
    borderRightColor: "transparent",
    marginBottom: 18,
  },
  connectingTitle: { fontSize: 44, color: "#2B3A55", fontWeight: "800", marginTop: 20 },
  connectingSub: { fontSize: 26, color: "#6f7480", marginTop: 6 },
  reservationCard: {
    width: "96%",
    maxWidth: 1100,
    borderRadius: 20,
    backgroundColor: "#ffffff",
    padding: 18,
  },
  reservationHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  reservationHeaderIcon: {
    fontSize: 20,
    lineHeight: 22,
    color: "#7a818c",
    textAlign: "center",
    includeFontPadding: false,
  },
  reservationHeaderCenter: { flex: 1 },
  reservationTitle: { fontSize: 36, color: "#2B3A55", fontWeight: "800" },
  reservationSubtitle: { fontSize: 24, color: "#5f6670" },
  reservationContent: { flexDirection: "row", gap: 14 },
  reservationLeftPanel: {
    width: "33%",
    borderRadius: 14,
    backgroundColor: "#f4f6f8",
    padding: 14,
  },
  reservationRightPanel: { width: "67%", gap: 10 },
  reservationLeftTitle: { fontSize: 24, color: "#2B3A55", fontWeight: "700", marginBottom: 10 },
  reservationLabel: { fontSize: 18, color: "#5f6670", marginBottom: 6 },
  selectBox: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#dde2e8",
    backgroundColor: "#ffffff",
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  selectBoxDisabled: {
    backgroundColor: "#f1f3f6",
    borderColor: "#e6eaef",
    opacity: 0.7,
  },
  selectText: { fontSize: 30, color: "#2B3A55", fontWeight: "700" },
  selectChevron: {
    fontSize: 16,
    lineHeight: 18,
    color: "#6b7280",
    textAlign: "center",
    includeFontPadding: false,
  },
  timeDivider: { fontSize: 28, color: "#9097a1", alignSelf: "center", marginVertical: 8 },
  totalTimeBox: {
    marginTop: 12,
    borderRadius: 12,
    backgroundColor: "#ffffff",
    paddingVertical: 12,
    alignItems: "center",
  },
  totalTimeText: { fontSize: 30, color: "#F27059", fontWeight: "800" },
  phoneDisplayBox: {
    borderRadius: 12,
    backgroundColor: "#f4f6f8",
    minHeight: 78,
    alignItems: "center",
    justifyContent: "center",
  },
  phoneDisplayText: { fontSize: 40, color: "#2B3A55", fontWeight: "800", letterSpacing: 1 },
  reservationPad: { gap: 8 },
  reservationPadRow: { flexDirection: "row", gap: 8 },
  reservationPadButton: {
    flex: 1,
    minHeight: 62,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#d9dee5",
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
  },
  reservationPadButtonPlaceholder: { flex: 1, minHeight: 62 },
  reservationPadText: { fontSize: 34, color: "#2B3A55", fontWeight: "700" },
  reservationNextButton: {
    marginTop: 6,
    borderRadius: 12,
    backgroundColor: "#dde1e7",
    minHeight: 68,
    alignItems: "center",
    justifyContent: "center",
  },
  reservationNextButtonActive: { backgroundColor: "#F27059" },
  reservationNextButtonText: { fontSize: 30, color: "#98a0ab", fontWeight: "700" },
  reservationNextButtonTextActive: { color: "#ffffff" },
  reservationPricingHint: { fontSize: 14, color: "#5f6670", marginTop: 8 },
  reservationErrorText: { fontSize: 16, color: "#d64545", marginTop: 8, textAlign: "center" },
  confirmSubmitButtonDisabled: { opacity: 0.6 },
  confirmCard: {
    width: "96%",
    maxWidth: 1100,
    borderRadius: 20,
    backgroundColor: "#ffffff",
    padding: 18,
  },
  confirmHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  confirmTitle: { fontSize: 50, color: "#2B3A55", fontWeight: "800" },
  confirmSubtitle: { fontSize: 22, color: "#6f7480", marginTop: 4 },
  confirmInfoBox: {
    borderRadius: 14,
    backgroundColor: "#f4f6f8",
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
  },
  confirmRow: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  confirmRowTight: { minHeight: 34 },
  confirmDivider: {
    height: 1,
    backgroundColor: "#e1e5ea",
  },
  confirmLabel: { fontSize: 18, color: "#2B3A55" },
  confirmValueStrong: { fontSize: 22, color: "#2B3A55", fontWeight: "700" },
  confirmCoinValue: { fontSize: 22, color: "#2B3A55", fontWeight: "700" },
  confirmDeductLabel: { fontSize: 18, color: "#d35b61" },
  confirmDeductValue: { fontSize: 22, color: "#d35b61", fontWeight: "700" },
  confirmRemainLabel: { fontSize: 22, color: "#2B3A55", fontWeight: "700" },
  confirmRemainValue: { fontSize: 40, color: "#2B3A55", fontWeight: "800" },
  confirmRemainValueInsufficient: { color: "#d64545" },
  confirmActions: {
    marginTop: 14,
    flexDirection: "row",
    gap: 10,
  },
  confirmCancelButton: {
    width: "33%",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#ced3da",
    minHeight: 62,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
  },
  confirmCancelText: { fontSize: 20, color: "#4f5560", fontWeight: "700" },
  confirmSubmitButton: {
    width: "67%",
    borderRadius: 14,
    minHeight: 62,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F27059",
  },
  confirmSubmitText: { fontSize: 24, color: "#ffffff", fontWeight: "800" },
  doneCard: {
    width: "92%",
    maxWidth: 980,
    borderRadius: 24,
    backgroundColor: "#ffffff",
    paddingHorizontal: 28,
    paddingVertical: 26,
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  doneIconWrap: {
    width: 108,
    height: 108,
    borderRadius: 54,
    backgroundColor: "#eaf9f0",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
  },
  doneIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#d4f2df",
    alignItems: "center",
    justifyContent: "center",
  },
  doneIconText: { fontSize: 52, color: "#11a552", fontWeight: "800" },
  doneTitle: { fontSize: 58, color: "#2B3A55", fontWeight: "800", marginBottom: 12 },
  doneSubtitle: { fontSize: 24, color: "#6f7480", lineHeight: 34 },
  doneConfirmButton: {
    marginTop: 24,
    width: "100%",
    minHeight: 74,
    borderRadius: 16,
    backgroundColor: "#2B3A55",
    alignItems: "center",
    justifyContent: "center",
  },
  doneConfirmText: { fontSize: 42, color: "#ffffff", fontWeight: "800" },
});
