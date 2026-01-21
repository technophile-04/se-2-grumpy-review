"use client";

import { useState } from "react";
import { AdminScheduleRow } from "../components/AdminScheduleRow";
import { CreateVestingForm } from "../components/CreateVestingForm";
import { Address } from "@scaffold-ui/components";
import { formatEther } from "viem";
import { useAccount } from "wagmi";
import { useScaffoldEventHistory, useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { notification } from "~~/utils/scaffold-eth";

const AdminPage = () => {
  const { address } = useAccount();
  const [revokingScheduleId, setRevokingScheduleId] = useState<bigint | null>(null);

  const { data: owner, isLoading: ownerLoading } = useScaffoldReadContract({
    contractName: "TokenVesting",
    functionName: "owner",
  });

  const { data: tokenBalance } = useScaffoldReadContract({
    contractName: "VestingToken",
    functionName: "balanceOf",
    args: [address],
  });

  const { data: paused } = useScaffoldReadContract({
    contractName: "TokenVesting",
    functionName: "paused",
  });

  const { data: allVestingEvents, isLoading: eventsLoading } = useScaffoldEventHistory({
    contractName: "TokenVesting",
    eventName: "VestingScheduleCreated",
    fromBlock: 0n,
    watch: true,
  });

  const { writeContractAsync: revokeSchedule } = useScaffoldWriteContract("TokenVesting");

  const { writeContractAsync: togglePause, isMining: isPauseToggling } = useScaffoldWriteContract("TokenVesting");

  const isOwner = owner && address && owner.toLowerCase() === address.toLowerCase();

  // Handle not connected
  if (!address) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-4">Connect Your Wallet</h2>
          <p className="text-base-content/70">Connect your wallet to access admin functions</p>
        </div>
      </div>
    );
  }

  // Handle loading state
  if (ownerLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <span className="loading loading-spinner loading-lg"></span>
      </div>
    );
  }

  // Handle not owner
  if (!isOwner) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-4">Access Denied</h2>
          <p className="text-base-content/70">Only the contract owner can access this page</p>
          <p className="text-sm mt-2">
            Owner: <Address address={owner} />
          </p>
        </div>
      </div>
    );
  }

  const handleRevoke = async (scheduleId: bigint) => {
    setRevokingScheduleId(scheduleId);
    try {
      await revokeSchedule({
        functionName: "revokeVesting",
        args: [scheduleId],
      });
      notification.success("Schedule revoked successfully!");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to revoke schedule";
      notification.error(message);
    } finally {
      setRevokingScheduleId(null);
    }
  };

  const handlePauseToggle = async () => {
    try {
      await togglePause({
        functionName: paused ? "unpause" : "pause",
      });
      notification.success(paused ? "Contract unpaused" : "Contract paused");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to toggle pause state";
      notification.error(message);
    }
  };

  const scheduleIds =
    allVestingEvents?.map(event => event.args.scheduleId).filter((id): id is bigint => id !== undefined) ?? [];

  return (
    <div className="container mx-auto p-6">
      <h1 className="text-3xl font-bold mb-4">Admin Dashboard</h1>

      <div className="mb-8 p-4 bg-base-200 rounded-lg flex justify-between items-center">
        <p className="text-sm">
          Your VEST Balance: <span className="font-bold">{formatEther(tokenBalance ?? 0n)} VEST</span>
        </p>
        <div className="flex items-center gap-4">
          {paused && <span className="badge badge-error">Contract Paused</span>}
          <button
            className={`btn btn-sm ${paused ? "btn-success" : "btn-warning"} ${isPauseToggling ? "loading" : ""}`}
            onClick={handlePauseToggle}
            disabled={isPauseToggling}
          >
            {paused ? "Unpause" : "Pause"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div>
          <CreateVestingForm />
        </div>

        <div className="card bg-base-100 shadow-xl">
          <div className="card-body">
            <h2 className="card-title">All Vesting Schedules</h2>

            {eventsLoading ? (
              <span className="loading loading-spinner"></span>
            ) : scheduleIds.length === 0 ? (
              <p className="text-base-content/70">No vesting schedules created yet</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="table table-zebra">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Beneficiary</th>
                      <th>Amount</th>
                      <th>Revocable</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scheduleIds.map(scheduleId => (
                      <AdminScheduleRow
                        key={scheduleId.toString()}
                        scheduleId={scheduleId}
                        onRevoke={handleRevoke}
                        revokingScheduleId={revokingScheduleId}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminPage;
