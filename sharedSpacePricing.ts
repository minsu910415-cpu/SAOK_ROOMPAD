export type SharedSpacePricing = {
  coinPerUnit: number;
  bookingUnitMinutes: number;
  bookingUnitLabel: string;
  maxConsecutiveHours: number;
  operatingStart: string;
  operatingEnd: string;
  operatingStartMinutes: number;
  operatingEndMinutes: number;
};

type SharedSpacePricingSource = {
  coin_per_unit?: number;
  booking_unit?: string | null;
  time_unit_minutes?: number;
  max_consecutive_hours?: number;
  operating_start?: string;
  operating_end?: string;
};

export const toMinutesFromHHMM = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
};

export const toHHMMFromMinutes = (minutes: number) => {
  const clamped = Math.max(0, Math.min(minutes, 24 * 60));
  const hh = Math.floor(clamped / 60)
    .toString()
    .padStart(2, "0");
  const mm = (clamped % 60).toString().padStart(2, "0");
  return `${hh}:${mm}`;
};

const normalizeOperatingTime = (value: string | undefined, fallback: string) => {
  const trimmed = value?.trim();
  if (!trimmed || !/^\d{1,2}:\d{2}$/.test(trimmed)) return fallback;
  return trimmed;
};

/** booking_unit 예: "1시간", "30분" */
export const parseBookingUnitMinutes = (bookingUnit?: string | null, fallbackMinutes = 60) => {
  if (!bookingUnit) return fallbackMinutes;

  const normalized = bookingUnit.trim();
  const hourMatch = normalized.match(/(\d+)\s*시간/);
  if (hourMatch) return Number(hourMatch[1]) * 60;

  const minuteMatch = normalized.match(/(\d+)\s*분/);
  if (minuteMatch) return Number(minuteMatch[1]);

  const onlyNumber = normalized.match(/^(\d+)$/);
  if (onlyNumber) return Number(onlyNumber[1]);

  return fallbackMinutes;
};

export const mapSharedSpacePricing = (data: SharedSpacePricingSource): SharedSpacePricing => {
  const bookingUnitMinutes =
    data.time_unit_minutes && data.time_unit_minutes > 0
      ? Number(data.time_unit_minutes)
      : parseBookingUnitMinutes(data.booking_unit);

  const operatingStart = normalizeOperatingTime(data.operating_start, "09:00");
  const operatingEnd = normalizeOperatingTime(data.operating_end, "22:00");
  const operatingStartMinutes = toMinutesFromHHMM(operatingStart);
  const operatingEndMinutes = toMinutesFromHHMM(operatingEnd);

  return {
    coinPerUnit: Number(data.coin_per_unit ?? 0),
    bookingUnitMinutes: bookingUnitMinutes > 0 ? bookingUnitMinutes : 60,
    bookingUnitLabel: data.booking_unit?.trim() || "1시간",
    maxConsecutiveHours:
      data.max_consecutive_hours != null && data.max_consecutive_hours > 0
        ? Number(data.max_consecutive_hours)
        : 2,
    operatingStart,
    operatingEnd,
    operatingStartMinutes,
    operatingEndMinutes,
  };
};

export const formatOperatingHours = (pricing: SharedSpacePricing) =>
  `${pricing.operatingStart} ~ ${pricing.operatingEnd}`;

/** 타임라인에 표시할 슬롯 (운영 시간 내 시작 가능 슬롯 + 기존 예약이 걸친 슬롯) */
export const getVisibleTimelineSlots = (
  allSlots: string[],
  pricing: SharedSpacePricing | null,
  isSlotReserved: (slotMinutes: number) => boolean
) => {
  if (!pricing) return allSlots;

  return allSlots.filter((slot) => {
    const slotMinutes = toMinutesFromHHMM(slot);
    return isSlotStartBookable(slot, pricing) || isSlotReserved(slotMinutes);
  });
};

export const getCurrentTimeLinePercent = (
  currentMinutes: number,
  pricing: SharedSpacePricing
) => {
  const rangeMinutes = pricing.operatingEndMinutes - pricing.operatingStartMinutes;
  if (rangeMinutes <= 0) return 0;
  return ((currentMinutes - pricing.operatingStartMinutes) / rangeMinutes) * 100;
};

export const isCurrentTimeInOperatingHours = (currentMinutes: number, pricing: SharedSpacePricing) =>
  currentMinutes >= pricing.operatingStartMinutes && currentMinutes < pricing.operatingEndMinutes;

/** 해당 시각에 예약을 시작할 수 있는지 (최소 1회 billing 단위 확보) */
export const isSlotStartBookable = (startTime: string, pricing: SharedSpacePricing) => {
  const startMinutes = toMinutesFromHHMM(startTime);
  return (
    startMinutes >= pricing.operatingStartMinutes &&
    startMinutes + pricing.bookingUnitMinutes <= pricing.operatingEndMinutes
  );
};

export const getDefaultReservationEnd = (startTime: string, pricing: SharedSpacePricing) => {
  const startMinutes = toMinutesFromHHMM(startTime);
  const preferredEnd = startMinutes + pricing.bookingUnitMinutes;
  const cappedEnd = Math.min(preferredEnd, pricing.operatingEndMinutes);
  return toHHMMFromMinutes(Math.max(cappedEnd, startMinutes + pricing.bookingUnitMinutes));
};

/** 예약 모달 — 선택 가능한 시작 시간 목록 */
export const getReservationStartTimeOptions = (pricing: SharedSpacePricing) => {
  const options: string[] = [];
  for (
    let minutes = pricing.operatingStartMinutes;
    minutes < pricing.operatingEndMinutes;
    minutes += pricing.bookingUnitMinutes
  ) {
    const time = toHHMMFromMinutes(minutes);
    if (isSlotStartBookable(time, pricing)) {
      options.push(time);
    }
  }
  return options;
};

/** 예약 모달 — 선택 가능한 종료 시간 목록 (시작 + billing 단위 배수, 최대 연속 이용 이내) */
export const getReservationEndTimeOptions = (startTime: string, pricing: SharedSpacePricing) => {
  const startMinutes = toMinutesFromHHMM(startTime);
  const maxConsecutiveMinutes = pricing.maxConsecutiveHours * 60;
  const options: string[] = [];

  for (
    let duration = pricing.bookingUnitMinutes;
    duration <= maxConsecutiveMinutes;
    duration += pricing.bookingUnitMinutes
  ) {
    const endMinutes = startMinutes + duration;
    if (endMinutes > pricing.operatingEndMinutes) break;
    options.push(toHHMMFromMinutes(endMinutes));
  }

  return options;
};

export const validateReservationRange = (
  startTime: string,
  endTime: string,
  pricing: SharedSpacePricing
): string | null => {
  const startMinutes = toMinutesFromHHMM(startTime);
  const endMinutes = toMinutesFromHHMM(endTime);
  const maxConsecutiveMinutes = pricing.maxConsecutiveHours * 60;

  if (startMinutes < pricing.operatingStartMinutes || endMinutes > pricing.operatingEndMinutes) {
    return `이용 가능 시간은 ${formatOperatingHours(pricing)} 입니다.`;
  }

  if (startMinutes >= endMinutes) {
    return "종료 시간은 시작 시간보다 늦어야 합니다.";
  }

  if (endMinutes - startMinutes > maxConsecutiveMinutes) {
    return `연속 이용은 최대 ${pricing.maxConsecutiveHours}시간까지 가능합니다.`;
  }

  if (!isSlotStartBookable(startTime, pricing)) {
    return `선택한 시작 시간은 예약할 수 없습니다. (${formatOperatingHours(pricing)})`;
  }

  return null;
};

export const getReservationDurationMinutes = (startTime: string, endTime: string) =>
  Math.max(0, toMinutesFromHHMM(endTime) - toMinutesFromHHMM(startTime));

export const formatReservationDuration = (totalMinutes: number) => {
  if (totalMinutes <= 0) return "0분";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0 && minutes === 0) return `${hours}시간`;
  if (hours > 0) return `${hours}시간 ${minutes}분`;
  return `${minutes}분`;
};

export const calculateBillingUnits = (durationMinutes: number, bookingUnitMinutes: number) => {
  if (durationMinutes <= 0 || bookingUnitMinutes <= 0) return 0;
  return Math.ceil(durationMinutes / bookingUnitMinutes);
};

export const calculateReservationDeductCoin = (
  startTime: string,
  endTime: string,
  pricing: SharedSpacePricing
) => {
  const durationMinutes = getReservationDurationMinutes(startTime, endTime);
  const billingUnits = calculateBillingUnits(durationMinutes, pricing.bookingUnitMinutes);
  return billingUnits * pricing.coinPerUnit;
};

/** 지금 예약하기용: 운영 시간 내 다음 정시 슬롯 */
export const getNextBookableStartSlot = (
  currentMinutes: number,
  pricing: SharedSpacePricing,
  hourSlots: string[]
) => {
  const candidates = hourSlots.filter((slot) => {
    const slotMinutes = toMinutesFromHHMM(slot);
    return slotMinutes >= currentMinutes && isSlotStartBookable(slot, pricing);
  });
  return candidates[0] ?? null;
};
