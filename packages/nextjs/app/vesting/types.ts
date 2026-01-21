export type VestingSchedule = {
  beneficiary: string;
  totalAmount: bigint;
  releasedAmount: bigint;
  startTime: bigint;
  cliffDuration: bigint;
  vestingDuration: bigint;
  revocable: boolean;
  revoked: boolean;
};

export type VestingScheduleWithComputedData = {
  scheduleId: bigint;
  schedule: VestingSchedule;
  claimableAmount: bigint;
  vestedAmount: bigint;
};
