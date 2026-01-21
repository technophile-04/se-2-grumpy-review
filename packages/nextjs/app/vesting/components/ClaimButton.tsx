"use client";

import { useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { notification } from "~~/utils/scaffold-eth";

type ClaimButtonProps = {
  scheduleId: bigint;
  claimableAmount: bigint;
};

export const ClaimButton = ({ scheduleId, claimableAmount }: ClaimButtonProps) => {
  const { writeContractAsync, isMining } = useScaffoldWriteContract("TokenVesting");

  const handleClaim = async () => {
    try {
      await writeContractAsync({
        functionName: "claim",
        args: [scheduleId],
      });
      notification.success("Tokens claimed successfully!");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to claim tokens";
      notification.error(message);
    }
  };

  const isDisabled = claimableAmount === 0n || isMining;

  return (
    <button className={`btn btn-primary ${isMining ? "loading" : ""}`} onClick={handleClaim} disabled={isDisabled}>
      {isMining ? "Claiming..." : "Claim Tokens"}
    </button>
  );
};
