/**
 * ROOMPAD ↔ Cloud Functions 클라이언트.
 * 미인증 태블릿은 Firestore를 직접 접근하지 않고, 이 콜러블들을 통해서만 동작한다.
 * roompadValidatePin이 발급한 기기 세션 토큰(deviceToken)을 저장해 이후 호출에 사용.
 */
import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "./firebase";

const functionsInstance = getFunctions(app, "asia-northeast3");

let deviceToken: string | null = null;
export function setRoompadDeviceToken(token: string | null): void {
  deviceToken = token && token.trim() ? token.trim() : null;
}
export function getRoompadDeviceToken(): string | null {
  return deviceToken;
}

function callFn<T>(name: string) {
  const fn = httpsCallable(functionsInstance, name);
  return async (data: Record<string, unknown> = {}): Promise<T> => {
    const res = await fn(data);
    return res.data as T;
  };
}

export type RoompadRoomInfo = {
  name: string;
  coin_per_unit: number;
  booking_unit: string | null;
  time_unit_minutes: number;
  max_consecutive_hours: number;
  operating_start: string;
  operating_end: string;
};

export type RoompadValidateResult = {
  deviceToken: string;
  workspaceId: string;
  roomId: string;
  roomName: string;
  room: RoompadRoomInfo;
};

export type RoompadMembership = {
  id: string;
  user_id: string | null;
  company_name: string;
  room_number: string;
  role_in_company: string;
  coin_balance_free: number;
  coin_balance_paid: number;
};

export type RoompadBooking = {
  id: string;
  status: string;
  startMs: number;
  endMs: number;
  room_number?: string | null;
  company_name?: string | null;
};

/** PIN 검증 + 연결등록 + 세션 발급. 성공 시 deviceToken을 내부 저장한다. */
export async function apiValidatePin(pin: string): Promise<RoompadValidateResult> {
  const data = await callFn<RoompadValidateResult>("roompadValidatePin")({ pin });
  if (data && data.deviceToken) setRoompadDeviceToken(data.deviceToken);
  return data;
}

/** 워크인 전화(뒤 8자리) 조회 — 안전 필드만. */
export async function apiLookupMembership(
  phoneDigits8: string
): Promise<{ matched: boolean; membership?: RoompadMembership }> {
  return callFn<{ matched: boolean; membership?: RoompadMembership }>(
    "roompadLookupMembership"
  )({ deviceToken, phoneDigits8 });
}

/** 워크인 예약 + 코인 차감(서버 트랜잭션). */
export async function apiCreateBooking(params: {
  membershipId: string;
  startTimeMs: number;
  endTimeMs: number;
  deductCoin: number;
}): Promise<{
  ok: boolean;
  bookingId: string;
  usedFreeCoin: number;
  usedPaidCoin: number;
  nextFree: number;
  nextPaid: number;
}> {
  return callFn<{
    ok: boolean;
    bookingId: string;
    usedFreeCoin: number;
    usedPaidCoin: number;
    nextFree: number;
    nextPaid: number;
  }>("roompadCreateBooking")({ deviceToken, ...params });
}

/**
 * 배터리 레벨(0~1) 업데이트.
 * 백그라운드(헤드리스) 태스크는 메모리 토큰이 없을 수 있어, 저장소에서 읽은 토큰을
 * explicitToken으로 전달할 수 있게 한다.
 */
export async function apiUpdateBattery(
  batteryLevel: number,
  explicitToken?: string
): Promise<{ ok: boolean }> {
  return callFn<{ ok: boolean }>("roompadUpdateBattery")({
    deviceToken: explicitToken ?? deviceToken,
    batteryLevel,
  });
}

/** 룸패드 자가 연결 해제 + 세션 폐기. */
export async function apiDisconnect(): Promise<{ ok: boolean }> {
  const res = await callFn<{ ok: boolean }>("roompadDisconnect")({ deviceToken });
  setRoompadDeviceToken(null);
  return res;
}

/** 룸 상태 + 예약현황(표시/중복체크용). 폴링 시 세션이 자동 갱신된다. */
export async function apiGetRoomState(): Promise<{
  is_roompad_active: boolean;
  room: RoompadRoomInfo;
  bookings: RoompadBooking[];
}> {
  return callFn<{
    is_roompad_active: boolean;
    room: RoompadRoomInfo;
    bookings: RoompadBooking[];
  }>("roompadGetRoomState")({ deviceToken });
}
