"use client";

import { Address } from "@scaffold-ui/components";
import { formatEther } from "viem";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";

type AdminScheduleRowProps = {
  scheduleId: bigint;
  onRevoke: (id: bigint) => void;
  revokingScheduleId: bigint | null;
};

export const AdminScheduleRow = ({ scheduleId, onRevoke, revokingScheduleId }: AdminScheduleRowProps) => {
  const { data: schedule } = useScaffoldReadContract({
    contractName: "TokenVesting",
    functionName: "getVestingSchedule",
    args: [scheduleId],
    watch: true,
  });

  if (!schedule) return null;

  const isThisRevoking = revokingScheduleId === scheduleId;
  const isAnyRevoking = revokingScheduleId !== null;

  return (
    <tr>
      <td>{scheduleId.toString()}</td>
      <td>
        <Address address={schedule.beneficiary} />
      </td>
      <td>{formatEther(schedule.totalAmount)} VEST</td>
      <td>{schedule.revocable ? "Yes" : "No"}</td>
      <td>
        {schedule.revocable && !schedule.revoked && (
          <button
            className={`btn btn-error btn-sm ${isThisRevoking ? "loading" : ""}`}
            onClick={() => onRevoke(scheduleId)}
            disabled={isAnyRevoking}
          >
            Revoke
          </button>
        )}
        {schedule.revoked && <span className="badge badge-error">Revoked</span>}
      </td>
    </tr>
  );
};
