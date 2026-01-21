"use client";

import { VestingScheduleCard } from "./components/VestingScheduleCard";
import { VestingSchedule } from "./types";
import { useAccount } from "wagmi";
import { useScaffoldEventHistory, useScaffoldReadContract } from "~~/hooks/scaffold-eth";

const VestingDashboard = () => {
  const { address } = useAccount();

  const { data: vestingEvents, isLoading: eventsLoading } = useScaffoldEventHistory({
    contractName: "TokenVesting",
    eventName: "VestingScheduleCreated",
    fromBlock: 0n,
    watch: true,
    filters: { beneficiary: address },
  });

  if (!address) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-4">Connect Your Wallet</h2>
          <p className="text-base-content/70">Connect your wallet to view your vesting schedules</p>
        </div>
      </div>
    );
  }

  if (eventsLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <span className="loading loading-spinner loading-lg"></span>
      </div>
    );
  }

  const scheduleIds =
    vestingEvents?.map(event => event.args.scheduleId).filter((id): id is bigint => id !== undefined) ?? [];

  return (
    <div className="container mx-auto p-6">
      <h1 className="text-3xl font-bold mb-8">Your Vesting Schedules</h1>

      {scheduleIds.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-base-content/70">No vesting schedules found for your address</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {scheduleIds.map(scheduleId => (
            <VestingScheduleCardWrapper key={scheduleId.toString()} scheduleId={scheduleId} />
          ))}
        </div>
      )}
    </div>
  );
};

const VestingScheduleCardWrapper = ({ scheduleId }: { scheduleId: bigint }) => {
  const { data: schedule } = useScaffoldReadContract({
    contractName: "TokenVesting",
    functionName: "getVestingSchedule",
    args: [scheduleId],
    watch: true,
  });

  const { data: claimableAmount } = useScaffoldReadContract({
    contractName: "TokenVesting",
    functionName: "getClaimableAmount",
    args: [scheduleId],
    watch: true,
  });

  const { data: vestedAmount } = useScaffoldReadContract({
    contractName: "TokenVesting",
    functionName: "getVestedAmount",
    args: [scheduleId],
    watch: true,
  });

  if (!schedule) return null;

  const typedSchedule: VestingSchedule = {
    beneficiary: schedule.beneficiary,
    totalAmount: schedule.totalAmount,
    releasedAmount: schedule.releasedAmount,
    startTime: schedule.startTime,
    cliffDuration: schedule.cliffDuration,
    vestingDuration: schedule.vestingDuration,
    revocable: schedule.revocable,
    revoked: schedule.revoked,
  };

  return (
    <VestingScheduleCard
      scheduleId={scheduleId}
      schedule={typedSchedule}
      claimableAmount={claimableAmount ?? 0n}
      vestedAmount={vestedAmount ?? 0n}
    />
  );
};

export default VestingDashboard;
