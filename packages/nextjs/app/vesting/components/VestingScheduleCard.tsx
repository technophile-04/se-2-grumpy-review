"use client";

import { VestingScheduleWithComputedData } from "../types";
import { ClaimButton } from "./ClaimButton";
import { VestingProgressBar } from "./VestingProgressBar";
import { Address } from "@scaffold-ui/components";
import { formatEther } from "viem";

export const VestingScheduleCard = ({
  scheduleId,
  schedule,
  claimableAmount,
  vestedAmount,
}: VestingScheduleWithComputedData) => {
  const { startTime, cliffDuration, vestingDuration, totalAmount, releasedAmount, revocable, revoked, beneficiary } =
    schedule;

  const cliffEnd = startTime + cliffDuration;
  const vestingEnd = startTime + vestingDuration;
  // Note: Uses client time for UI updates. May differ slightly from on-chain calculations.
  const now = BigInt(Math.floor(Date.now() / 1000));

  const isCliffPeriod = now < cliffEnd;
  const isFullyVested = now >= vestingEnd;

  const statusLabel = revoked ? "Revoked" : isFullyVested ? "Fully Vested" : isCliffPeriod ? "In Cliff" : "Vesting";

  const statusColor = revoked ? "badge-error" : isFullyVested ? "badge-success" : "badge-warning";

  return (
    <div className="card bg-base-100 shadow-xl">
      <div className="card-body">
        <div className="flex justify-between items-start">
          <h3 className="card-title">Schedule #{scheduleId.toString()}</h3>
          <span className={`badge ${statusColor}`}>{statusLabel}</span>
        </div>

        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-base-content/70">Beneficiary:</span>
            <Address address={beneficiary} />
          </div>
          <div className="flex justify-between">
            <span className="text-base-content/70">Total Amount:</span>
            <span>{formatEther(totalAmount)} VEST</span>
          </div>
          <div className="flex justify-between">
            <span className="text-base-content/70">Vested:</span>
            <span>{formatEther(vestedAmount)} VEST</span>
          </div>
          <div className="flex justify-between">
            <span className="text-base-content/70">Claimed:</span>
            <span>{formatEther(releasedAmount)} VEST</span>
          </div>
          <div className="flex justify-between">
            <span className="text-base-content/70">Claimable:</span>
            <span className="font-bold text-primary">{formatEther(claimableAmount)} VEST</span>
          </div>
        </div>

        <VestingProgressBar
          startTime={startTime}
          cliffDuration={cliffDuration}
          vestingDuration={vestingDuration}
          vestedAmount={vestedAmount}
          totalAmount={totalAmount}
        />

        {revocable && !revoked && <div className="text-xs text-warning">This schedule is revocable</div>}

        <div className="card-actions justify-end mt-4">
          <ClaimButton scheduleId={scheduleId} claimableAmount={claimableAmount} />
        </div>
      </div>
    </div>
  );
};
