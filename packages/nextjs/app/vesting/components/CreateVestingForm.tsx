"use client";

import { useState } from "react";
import { AddressInput } from "@scaffold-ui/components";
import { parseEther } from "viem";
import { useDeployedContractInfo, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { notification } from "~~/utils/scaffold-eth";

type FormState = {
  beneficiary: string;
  amount: string;
  cliffSeconds: string;
  durationSeconds: string;
  revocable: boolean;
};

const INITIAL_FORM_STATE: FormState = {
  beneficiary: "",
  amount: "",
  cliffSeconds: "",
  durationSeconds: "",
  revocable: false,
};

export const CreateVestingForm = () => {
  const [formState, setFormState] = useState<FormState>(INITIAL_FORM_STATE);

  const { data: vestingContractInfo } = useDeployedContractInfo("TokenVesting");

  const { writeContractAsync: createSchedule, isMining: isCreating } = useScaffoldWriteContract("TokenVesting");

  const { writeContractAsync: approveTokens, isMining: isApproving } = useScaffoldWriteContract("VestingToken");

  const updateField = <K extends keyof FormState>(field: K, value: FormState[K]) => {
    setFormState(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const { beneficiary, amount, cliffSeconds, durationSeconds, revocable } = formState;

    if (!beneficiary || !amount || !durationSeconds || !vestingContractInfo?.address) {
      notification.error("Please fill in all required fields");
      return;
    }

    const amountWei = parseEther(amount);
    const cliff = BigInt(cliffSeconds || "0");
    const duration = BigInt(durationSeconds);

    try {
      // Approve tokens to the vesting contract
      await approveTokens({
        functionName: "approve",
        args: [vestingContractInfo.address, amountWei],
      });

      // Create vesting schedule (startTime handled by contract)
      await createSchedule({
        functionName: "createVestingSchedule",
        args: [beneficiary, amountWei, cliff, duration, revocable],
      });

      setFormState(INITIAL_FORM_STATE);
      notification.success("Vesting schedule created successfully!");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to create vesting schedule";
      notification.error(message);
    }
  };

  const isLoading = isCreating || isApproving;
  const isFormValid = formState.beneficiary && formState.amount && formState.durationSeconds;

  return (
    <form onSubmit={handleSubmit} className="card bg-base-100 shadow-xl">
      <div className="card-body">
        <h2 className="card-title">Create Vesting Schedule</h2>

        <div className="form-control">
          <label className="label">
            <span className="label-text">Beneficiary Address</span>
          </label>
          <AddressInput
            value={formState.beneficiary}
            onChange={value => updateField("beneficiary", value)}
            placeholder="0x..."
          />
        </div>

        <div className="form-control">
          <label className="label">
            <span className="label-text">Token Amount (VEST)</span>
          </label>
          <input
            type="number"
            className="input input-bordered"
            value={formState.amount}
            onChange={e => updateField("amount", e.target.value)}
            placeholder="1000"
            min="0"
            step="0.01"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="form-control">
            <label className="label">
              <span className="label-text">Cliff (seconds)</span>
            </label>
            <input
              type="number"
              className="input input-bordered"
              value={formState.cliffSeconds}
              onChange={e => updateField("cliffSeconds", e.target.value)}
              placeholder="7776000 (90 days)"
              min="0"
            />
          </div>

          <div className="form-control">
            <label className="label">
              <span className="label-text">Duration (seconds)</span>
            </label>
            <input
              type="number"
              className="input input-bordered"
              value={formState.durationSeconds}
              onChange={e => updateField("durationSeconds", e.target.value)}
              placeholder="31536000 (365 days)"
              min="1"
            />
          </div>
        </div>

        <div className="form-control">
          <label className="label cursor-pointer">
            <span className="label-text">Revocable</span>
            <input
              type="checkbox"
              className="checkbox"
              checked={formState.revocable}
              onChange={e => updateField("revocable", e.target.checked)}
            />
          </label>
        </div>

        <div className="card-actions justify-end mt-4">
          <button
            type="submit"
            className={`btn btn-primary ${isLoading ? "loading" : ""}`}
            disabled={isLoading || !isFormValid}
          >
            {isLoading ? "Creating..." : "Create Schedule"}
          </button>
        </div>
      </div>
    </form>
  );
};
