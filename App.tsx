import { StatusBar } from "expo-status-bar";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Brightness from "expo-brightness";
import { useKeepAwake } from "expo-keep-awake";
import * as NavigationBar from "expo-navigation-bar";
import { db } from "./firebase";
import {
  Timestamp,
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

type ScreenMode = "initialLoading" | "activation" | "connecting" | "dashboard";
type RoomMode = "available" | "inUse";
type Reservation = { id: string; start: string; end: string; reservedBy: string };
type DeviceBinding = { roomId: string; workspaceId: string; pinId: string };

const pinCount = 6;
const STORAGE_ROOM_ID_KEY = "@saok_roompad/roomId";
const STORAGE_WORKSPACE_ID_KEY = "@saok_roompad/workspaceId";
const STORAGE_DEVICE_TOKEN_KEY = "@saok_roompad/deviceToken";
const sampleSlots = Array.from({ length: 25 }, (_, hour) => `${hour.toString().padStart(2, "0")}:00`);

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

export default function App() {
  useKeepAwake();

  const [screenMode, setScreenMode] = useState<ScreenMode>("initialLoading");
  const [now, setNow] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [showSettings, setShowSettings] = useState(false);
  const [showReservationModal, setShowReservationModal] = useState(false);
  const [showReservationConfirmModal, setShowReservationConfirmModal] = useState(false);
  const [showReservationDoneModal, setShowReservationDoneModal] = useState(false);
  const [reservationPhone, setReservationPhone] = useState("");
  const [selectedStartTime, setSelectedStartTime] = useState("14:00");
  const [selectedEndTime, setSelectedEndTime] = useState("16:00");
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [boundRoomId, setBoundRoomId] = useState<string | null>(null);
  const [boundWorkspaceId, setBoundWorkspaceId] = useState<string | null>(null);
  const [boundRoomName, setBoundRoomName] = useState<string>("STUDIO A");
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState("");
  const [isPinSubmitting, setIsPinSubmitting] = useState(false);
  const [nightModeEnabled, setNightModeEnabled] = useState(true);
  const [wakeUpEnabled, setWakeUpEnabled] = useState(true);
  const [nightStartTime] = useState("22:00");
  const [nightEndTime] = useState("07:00");
  const [isSleepMode, setIsSleepMode] = useState(false);
  const spinnerRotate = useRef(new Animated.Value(0)).current;
  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const originalBrightnessRef = useRef(0.8);
  const isBrightnessGrantedRef = useRef(false);

  const displayTime = useMemo(
    () => now.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }),
    [now]
  );

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const prepareBrightness = async () => {
      try {
        const permission = await Brightness.requestPermissionsAsync();
        isBrightnessGrantedRef.current = permission.status === "granted";
        if (isBrightnessGrantedRef.current) {
          const current = await Brightness.getBrightnessAsync();
          originalBrightnessRef.current = current > 0 ? current : 0.8;
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

    const applyBrightness = async () => {
      const targetBrightness = isSleepMode ? 0.1 : originalBrightnessRef.current || 0.8;
      await Brightness.setBrightnessAsync(targetBrightness);
    };

    void applyBrightness();
  }, [isSleepMode]);

  useEffect(() => {
    return () => {
      if (!isBrightnessGrantedRef.current) return;
      void Brightness.setBrightnessAsync(originalBrightnessRef.current || 0.8);
    };
  }, []);

  const validatePinWithFirebase = async (inputPin: string) => {
    // device_pins/{6-digit-pin}
    const pinDocRef = doc(db, "device_pins", inputPin);
    const pinSnap = await getDoc(pinDocRef);
    if (!pinSnap.exists()) return null;

    const data = pinSnap.data() as {
      workspace_id?: string;
      room_id?: string;
      expires_at?: unknown;
    };

    if (!data.workspace_id || !data.room_id) return null;

    const expiresAt =
      data.expires_at instanceof Timestamp
        ? data.expires_at.toDate()
        : data.expires_at instanceof Date
          ? data.expires_at
          : null;

    // PIN must be valid and not expired (issued +10min)
    if (!expiresAt || expiresAt.getTime() <= Date.now()) {
      return null;
    }

    return {
      roomId: data.room_id,
      workspaceId: data.workspace_id,
      pinId: pinSnap.id,
    } satisfies DeviceBinding;
  };

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
      const authResult = await validatePinWithFirebase(inputPin);
      if (!authResult) {
        setPin("");
        setPinError("PIN 인증에 실패했습니다. 다시 입력해 주세요.");
        setScreenMode("activation");
        return;
      }

      const deviceToken = `pin-${authResult.pinId}-${Date.now()}`;
      await persistDeviceAuth(authResult, deviceToken);
      setBoundRoomId(authResult.roomId);
      setBoundWorkspaceId(authResult.workspaceId);
      setPin("");
      setScreenMode("dashboard");
    } catch {
      setPin("");
      setPinError("연결 중 오류가 발생했습니다. 다시 시도해 주세요.");
      setScreenMode("activation");
    } finally {
      setIsPinSubmitting(false);
    }
  };

  const handleDisconnectDevice = async () => {
    await clearDeviceAuth();
    setShowSettings(false);
    setShowReservationModal(false);
    setShowReservationConfirmModal(false);
    setShowReservationDoneModal(false);
    setReservations([]);
    setBoundRoomId(null);
    setBoundWorkspaceId(null);
    setPin("");
    setPinError("");
    setScreenMode("activation");
  };

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

  const onReservationNumberPress = (digit: string) => {
    if (reservationPhone.length >= 8) return;
    setReservationPhone((prev: string) => prev + digit);
  };

  const onReservationDelete = () => {
    setReservationPhone((prev: string) => prev.slice(0, -1));
  };

  const onTimeSlotPress = (slot: string) => {
    const startMinutes = toMinutes(slot);
    const endMinutes = Math.min(startMinutes + 120, toMinutes("24:00"));
    setSelectedStartTime(slot);
    setSelectedEndTime(toTimeString(endMinutes));
    setReservationPhone("");
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
    setIsSleepMode(false);
    resetInactivityTimer();
  };
  const currentReservation =
    reservations.find((item) => currentMinutes >= toMinutes(item.start) && currentMinutes < toMinutes(item.end)) ??
    null;
  const nextReservation = reservations.find((item) => toMinutes(item.start) > currentMinutes) ?? null;
  const roomMode: RoomMode = currentReservation ? "inUse" : "available";
  const reservationHours = Math.max(1, Math.round((toMinutes(selectedEndTime) - toMinutes(selectedStartTime)) / 60));
  const ownedCoin = 50;
  const deductCoin = reservationHours * 10;
  const remainCoin = ownedCoin - deductCoin;
  const roomDisplayName = boundRoomName || "STUDIO A";

  useEffect(() => {
    if (!boundRoomId) {
      setBoundRoomName("STUDIO A");
      return;
    }

    let cancelled = false;

    const fetchRoomName = async () => {
      // Primary target from schema: shared_spaces/{room_id}.name
      const sharedSpaceDoc = await getDoc(doc(db, "shared_spaces", boundRoomId));
      if (sharedSpaceDoc.exists()) {
        const sharedData = sharedSpaceDoc.data() as { name?: string };
        if (!cancelled && sharedData.name) {
          setBoundRoomName(sharedData.name);
          return;
        }
      }

      // Fallback target: rooms/{room_id}.name
      const roomDoc = await getDoc(doc(db, "rooms", boundRoomId));
      if (roomDoc.exists()) {
        const roomData = roomDoc.data() as { name?: string };
        if (!cancelled && roomData.name) {
          setBoundRoomName(roomData.name);
          return;
        }
      }

      if (!cancelled) {
        setBoundRoomName(boundRoomId);
      }
    };

    void fetchRoomName();

    return () => {
      cancelled = true;
    };
  }, [boundRoomId]);

  useEffect(() => {
    if (!boundWorkspaceId || !boundRoomId || screenMode !== "dashboard") {
      setReservations([]);
      return;
    }

    // Keep query simple (workspace only) to avoid composite-index blockers,
    // then filter by status/room/date in client.
    const q = query(collection(db, "bookings"), where("workspace_id", "==", boundWorkspaceId));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const selectedKey = selectedDate.toDateString();
        const roomCandidates = new Set(
          [boundRoomId, boundRoomName]
            .filter(Boolean)
            .map((value) => String(value).trim().toLowerCase())
        );

        const roomBookings: Reservation[] = snapshot.docs
          .map((doc) => {
            const data = doc.data() as {
              room?: string;
              room_id?: string;
              status?: string;
              startTime?: unknown;
              endTime?: unknown;
              userName?: string;
            };

            if (data.status && data.status !== "CONFIRMED") return null;

            const roomValue = String(data.room_id ?? data.room ?? "")
              .trim()
              .toLowerCase();
            if (!roomCandidates.has(roomValue)) return null;

            const startDate = toDateFromUnknown(data.startTime);
            const endDate = toDateFromUnknown(data.endTime);
            if (!startDate || !endDate) return null;
            if (startDate.toDateString() !== selectedKey) return null;

            return {
              id: doc.id,
              start: toHHMM(startDate),
              end: toHHMM(endDate),
              reservedBy: data.userName ?? "예약자",
            };
          })
          .filter((item): item is Reservation => Boolean(item))
          .sort((a, b) => toMinutes(a.start) - toMinutes(b.start));

        setReservations(roomBookings);
      },
      () => {
        setReservations([]);
      }
    );

    return () => unsubscribe();
  }, [boundWorkspaceId, boundRoomId, boundRoomName, screenMode, selectedDate]);

  useEffect(() => {
    if (!nightModeEnabled || !isNightTime || screenMode !== "dashboard") {
      clearInactivityTimer();
      if (isSleepMode) setIsSleepMode(false);
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
        <Text style={styles.settingsIcon}>⚙</Text>
      </Pressable>

      <View style={styles.content}>
        <View style={styles.timelinePanel}>
          <View style={styles.dateHeader}>
            <Pressable style={styles.dateNavButton} onPress={() => changeSelectedDate(-1)}>
              <Text style={styles.dateNavText}>‹</Text>
            </Pressable>
            <Text style={styles.dateTitle}>{formatSelectedDate(selectedDate)}</Text>
            <Pressable style={styles.dateNavButton} onPress={() => changeSelectedDate(1)}>
              <Text style={styles.dateNavText}>›</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.timelineList}>
            <View style={styles.timelineInner}>
              {sampleSlots.map((slot) => {
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
                        {isBooked ? matchedReservation?.reservedBy : "예약 가능"}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}

              <View
                pointerEvents="none"
                style={[
                  styles.currentTimeLine,
                  {
                    top: `${(currentMinutes / minutesInDay) * 100}%`,
                  },
                ]}
              >
                <View style={styles.currentTimeDot} />
              </View>
            </View>
          </ScrollView>
        </View>

        <View style={styles.statusPanel}>
          <Text style={styles.roomName}>{roomDisplayName}</Text>
          <Text style={styles.clock}>◷ {displayTime}</Text>
          <View style={styles.statusCenter}>
            <View style={[styles.statusDot, roomMode === "inUse" ? styles.statusDotInUse : styles.statusDotAvailable]} />
            <Text style={styles.statusTitle}>{roomMode === "inUse" ? "현재 사용 중" : "현재 미사용 중"}</Text>
            {roomMode === "inUse" ? (
              <>
                <Text style={styles.statusMeta}>예약자: {currentReservation?.reservedBy}</Text>
                <Text style={styles.usageTime}>
                  {currentReservation ? formatRange(currentReservation.start, currentReservation.end) : "-"}
                </Text>
                <Text style={styles.statusMeta}>
                  다음 예약: {nextReservation ? nextReservation.start : "없음"}
                </Text>
              </>
            ) : (
              <Text style={styles.statusMeta}>
                {nextReservation
                  ? `다음 예약: ${nextReservation.start} (${nextReservation.reservedBy})`
                  : "오늘 남은 예약이 없습니다"}
              </Text>
            )}
          </View>
          {roomMode === "available" && (
            <Pressable
              style={styles.reserveButton}
              onPress={() => {
                setReservationPhone("");
                setSelectedStartTime("14:00");
                setSelectedEndTime("16:00");
                setShowReservationConfirmModal(false);
                setShowReservationModal(true);
              }}
            >
              <Text style={styles.reserveButtonText}>지금 예약하기</Text>
            </Pressable>
          )}
        </View>
      </View>

      <Modal visible={showSettings} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>룸패드 설정</Text>
              <Pressable onPress={() => setShowSettings(false)}>
                <Text style={styles.closeButton}>✕</Text>
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
                  <TextInput style={styles.timeInput} value={nightStartTime} editable={false} />
                </View>
                <View style={styles.timeInputGroup}>
                  <Text style={styles.reservationLabel}>종료 시간</Text>
                  <TextInput style={styles.timeInput} value={nightEndTime} editable={false} />
                </View>
              </View>
              <Pressable style={styles.wakeUpRow} onPress={() => setWakeUpEnabled((prev: boolean) => !prev)}>
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

              <Pressable style={styles.disconnectButton} onPress={() => void handleDisconnectDevice()}>
                <Text style={styles.disconnectButtonText}>기기 연결 해지</Text>
              </Pressable>
              <Text style={styles.disconnectHelpText}>
                기기 변경을 위해 현재 연결된 공간과의 매칭을 해제합니다.
              </Text>

              <View style={styles.settingsFooter}>
                <Pressable style={styles.settingsSaveButton} onPress={() => setShowSettings(false)}>
                  <Text style={styles.settingsSaveButtonText}>저장하기</Text>
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={showReservationModal} animationType="fade" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.reservationCard}>
            <View style={styles.reservationHeader}>
              <Text style={styles.reservationHeaderIcon}>‹</Text>
              <View style={styles.reservationHeaderCenter}>
                <Text style={styles.reservationTitle}>예약자 확인을 위해</Text>
                <Text style={styles.reservationSubtitle}>휴대폰 번호를 입력해 주세요</Text>
              </View>
              <Pressable onPress={() => setShowReservationModal(false)}>
                <Text style={styles.closeButton}>✕</Text>
              </Pressable>
            </View>

            <View style={styles.reservationContent}>
              <View style={styles.reservationLeftPanel}>
                <Text style={styles.reservationLeftTitle}>◷ 예약 시간 설정</Text>
                <Text style={styles.reservationLabel}>시작 시간</Text>
                <View style={styles.selectBox}>
                  <Text style={styles.selectText}>{selectedStartTime}</Text>
                  <Text style={styles.selectChevron}>⌄</Text>
                </View>
                <Text style={styles.timeDivider}>~</Text>
                <Text style={styles.reservationLabel}>종료 시간</Text>
                <View style={styles.selectBox}>
                  <Text style={styles.selectText}>{selectedEndTime}</Text>
                  <Text style={styles.selectChevron}>⌄</Text>
                </View>
                <View style={styles.totalTimeBox}>
                  <Text style={styles.totalTimeText}>총 2시간</Text>
                </View>
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
                <Pressable
                  style={[
                    styles.reservationNextButton,
                    reservationPhone.length === 8 && styles.reservationNextButtonActive,
                  ]}
                  disabled={reservationPhone.length !== 8}
                  onPress={() => {
                    setShowReservationModal(false);
                    setShowReservationConfirmModal(true);
                  }}
                >
                  <Text
                    style={[
                      styles.reservationNextButtonText,
                      reservationPhone.length === 8 && styles.reservationNextButtonTextActive,
                    ]}
                  >
                    다음 단계
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
                <Text style={styles.reservationHeaderIcon}>‹</Text>
              </Pressable>
              <View style={styles.reservationHeaderCenter}>
                <Text style={styles.confirmTitle}>101호 ㈜테크솔루션 (김대표)</Text>
                <Text style={styles.confirmSubtitle}>예약 정보를 확인해 주세요</Text>
              </View>
              <Pressable onPress={() => setShowReservationConfirmModal(false)}>
                <Text style={styles.closeButton}>✕</Text>
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
                  {selectedStartTime} ~ {selectedEndTime} ({reservationHours}시간)
                </Text>
              </View>
              <View style={styles.confirmDivider} />
              <View style={[styles.confirmRow, styles.confirmRowTight]}>
                <Text style={styles.confirmLabel}>보유 코인</Text>
                <Text style={styles.confirmCoinValue}>{ownedCoin} C</Text>
              </View>
              <View style={[styles.confirmRow, styles.confirmRowTight]}>
                <Text style={styles.confirmDeductLabel}>차감 코인</Text>
                <Text style={styles.confirmDeductValue}>- {deductCoin} C</Text>
              </View>
              <View style={styles.confirmDivider} />
              <View style={styles.confirmRow}>
                <Text style={styles.confirmRemainLabel}>잔여 코인</Text>
                <Text style={styles.confirmRemainValue}>{remainCoin} C</Text>
              </View>
            </View>

            <View style={styles.confirmActions}>
              <Pressable
                style={styles.confirmCancelButton}
                onPress={() => {
                  setShowReservationConfirmModal(false);
                  setShowReservationModal(true);
                }}
              >
                <Text style={styles.confirmCancelText}>취소</Text>
              </Pressable>
              <Pressable
                style={styles.confirmSubmitButton}
                onPress={() => {
                  setShowReservationConfirmModal(false);
                  setShowReservationDoneModal(true);
                }}
              >
                <Text style={styles.confirmSubmitText}>결제 및 예약 확정</Text>
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
  settingsIcon: { fontSize: 26, color: "#2B3A55" },
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
    marginBottom: 8,
  },
  dateNavButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  dateNavText: { fontSize: 24, color: "#2B3A55", fontWeight: "600" },
  dateTitle: {
    textAlign: "center",
    color: "#2B3A55",
    fontSize: 16,
    fontWeight: "700",
    flex: 1,
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
    paddingHorizontal: 20,
    paddingVertical: 26,
    justifyContent: "space-between",
  },
  roomName: { fontSize: 52, fontWeight: "800", color: "#2B3A55" },
  clock: { fontSize: 30, color: "#a8adb5", marginTop: 6 },
  statusCenter: { alignItems: "center", gap: 12 },
  statusDot: { width: 54, height: 54, borderRadius: 27 },
  statusDotAvailable: { borderWidth: 3, borderColor: "#2bd08b" },
  statusDotInUse: { backgroundColor: "#F27059" },
  statusTitle: { fontSize: 46, color: "#2B3A55", fontWeight: "800" },
  statusMeta: { fontSize: 26, color: "#6f7480" },
  usageTime: { fontSize: 64, color: "#F27059", fontWeight: "800" },
  reserveButton: {
    alignSelf: "flex-end",
    backgroundColor: "#F27059",
    borderRadius: 14,
    paddingHorizontal: 26,
    paddingVertical: 16,
  },
  reserveButtonText: { color: "#ffffff", fontSize: 30, fontWeight: "800" },
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
  closeButton: { fontSize: 28, color: "#9aa0a8" },
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
  timeInput: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#dce1e7",
    fontSize: 26,
    paddingVertical: 12,
    paddingHorizontal: 14,
    color: "#2B3A55",
    backgroundColor: "#ffffff",
  },
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
  reservationHeaderIcon: { fontSize: 40, color: "#7a818c", width: 36 },
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
  selectText: { fontSize: 30, color: "#2B3A55", fontWeight: "700" },
  selectChevron: { fontSize: 24, color: "#6b7280" },
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
