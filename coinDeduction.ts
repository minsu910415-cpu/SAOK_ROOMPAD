export type CoinDeductionPlan = {
  usedFreeCoin: number;
  usedPaidCoin: number;
  nextFreeBalance: number;
  nextPaidBalance: number;
};

/** 무료 코인 선차감 후 유료 코인 차감 */
export const planCoinDeduction = (
  totalDeduct: number,
  freeBalance: number,
  paidBalance: number
): CoinDeductionPlan => {
  const safeTotal = Math.max(0, Math.floor(totalDeduct));
  const safeFree = Math.max(0, Math.floor(freeBalance));
  const safePaid = Math.max(0, Math.floor(paidBalance));

  const usedFreeCoin = Math.min(safeFree, safeTotal);
  const remaining = safeTotal - usedFreeCoin;
  const usedPaidCoin = Math.min(safePaid, remaining);

  return {
    usedFreeCoin,
    usedPaidCoin,
    nextFreeBalance: safeFree - usedFreeCoin,
    nextPaidBalance: safePaid - usedPaidCoin,
  };
};

export const getTotalCoinBalance = (freeBalance: number, paidBalance: number) =>
  Math.max(0, Math.floor(freeBalance)) + Math.max(0, Math.floor(paidBalance));

export const hasEnoughCoins = (freeBalance: number, paidBalance: number, requiredCoin: number) =>
  getTotalCoinBalance(freeBalance, paidBalance) >= Math.max(0, Math.floor(requiredCoin));

export const isCoinDeductionSufficient = (plan: CoinDeductionPlan, totalDeduct: number) =>
  plan.usedFreeCoin + plan.usedPaidCoin >= Math.max(0, Math.floor(totalDeduct));
