// 워크인 조회는 서버(roompadLookupMembership)가 담당한다. (직접 memberships 접근 제거됨)
// 이 파일은 표시용 타입/헬퍼만 유지한다.
export type MatchedMembership = {
  id: string;
  user_id?: string | null;
  company_name: string;
  room_number: string;
  role_in_company: string;
  phone_number?: string; // 서버 워크인 조회는 PII(전화)를 반환하지 않음
  coin_balance_free: number;
  coin_balance_paid: number;
};

export const normalizePhoneDigits = (value: string) => value.replace(/\D/g, "");

export const formatMembershipConfirmTitle = (membership: MatchedMembership) =>
  `${membership.room_number} ${membership.company_name} (${membership.role_in_company})`;
