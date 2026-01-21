# Token Vesting Dashboard - Specification v1c (Final)

## Overview

A Token Vesting Dashboard dApp for team token distribution built on Scaffold-ETH 2. This application allows admins to create vesting schedules for team members, advisors, and investors, while beneficiaries can track their vesting progress and claim tokens as they vest.

## Changes from v1b

Based on Grumpy Carlos's second review, the following minor refinements were made:

### Fixes
1. **Consistent error message strings**: All catch blocks now use specific, helpful error messages
2. **Added missing AdminScheduleRow import**: Admin page now properly imports the component
3. **Documented revokeVesting intentionally without whenNotPaused**: Added comment explaining design decision
4. **Improved revoke loading state UX**: Track individual revoke operations to show loading on correct button only

---

## Requirements Summary

### Clarifications

Based on user input:
- **Token Model**: Deploy a new ERC20 token specifically for vesting
- **Admin Model**: Single owner using OpenZeppelin's Ownable pattern
- **Schedule Discovery**: Event-based using `useScaffoldEventHistory` (gas-efficient SE-2 pattern)
- **Time Handling**: Timestamps in seconds (most precise and standard)

### Core Features

1. Admin can create vesting schedules with:
   - Beneficiary address
   - Token amount
   - Cliff period (in seconds)
   - Total vesting duration (in seconds)
   - Revocability flag

2. Linear vesting after cliff period ends
3. Beneficiaries dashboard with:
   - List of vesting schedules
   - Progress visualization
   - Claim button
4. Admin can revoke unvested tokens from revocable schedules
5. Multiple vesting schedules per beneficiary
6. Real-time claimable amount updates

---

## Smart Contract Architecture

### Contract 1: VestingToken.sol

A simple ERC20 token deployed alongside the vesting contract.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract VestingToken is ERC20, Ownable {
    constructor(
        string memory name,
        string memory symbol,
        uint256 initialSupply
    ) ERC20(name, symbol) Ownable(msg.sender) {
        _mint(msg.sender, initialSupply);
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
```

---

### Contract 2: TokenVesting.sol

The main vesting contract that manages all vesting schedules.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

contract TokenVesting is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ============ Structs ============

    struct VestingSchedule {
        address beneficiary;
        uint256 totalAmount;
        uint256 releasedAmount;
        uint64 startTime;
        uint64 cliffDuration;
        uint64 vestingDuration;
        bool revocable;
        bool revoked;
    }

    // ============ State Variables ============

    IERC20 public immutable token;
    uint256 public scheduleCount;
    mapping(uint256 => VestingSchedule) public schedules;
    uint256 public totalVestingAmount;

    // ============ Events ============

    event VestingScheduleCreated(
        uint256 indexed scheduleId,
        address indexed beneficiary,
        uint256 totalAmount,
        uint64 startTime,
        uint64 cliffDuration,
        uint64 vestingDuration,
        bool revocable
    );

    event TokensClaimed(
        uint256 indexed scheduleId,
        address indexed beneficiary,
        uint256 amount
    );

    event VestingRevoked(
        uint256 indexed scheduleId,
        address indexed beneficiary,
        uint256 unvestedAmount
    );

    // ============ Errors ============

    error InvalidBeneficiary();
    error InvalidAmount();
    error InvalidDuration();
    error CliffExceedsDuration();
    error ScheduleNotFound();
    error NotBeneficiary();
    error NothingToClaim();
    error NotRevocable();
    error AlreadyRevoked();
    error NothingToRevoke();

    // ============ Constructor ============

    constructor(address _token) Ownable(msg.sender) {
        token = IERC20(_token);
    }

    // ============ Admin Functions ============

    /**
     * @notice Creates a new vesting schedule starting immediately
     * @param _beneficiary Address that will receive vested tokens
     * @param _totalAmount Total tokens to vest
     * @param _cliffDuration Seconds until first tokens vest
     * @param _vestingDuration Total vesting period in seconds
     * @param _revocable Whether admin can revoke unvested tokens
     */
    function createVestingSchedule(
        address _beneficiary,
        uint256 _totalAmount,
        uint64 _cliffDuration,
        uint64 _vestingDuration,
        bool _revocable
    ) external onlyOwner whenNotPaused returns (uint256 scheduleId) {
        if (_beneficiary == address(0)) revert InvalidBeneficiary();
        if (_totalAmount == 0) revert InvalidAmount();
        if (_vestingDuration == 0) revert InvalidDuration();
        if (_cliffDuration > _vestingDuration) revert CliffExceedsDuration();

        token.safeTransferFrom(msg.sender, address(this), _totalAmount);

        scheduleId = scheduleCount++;
        uint64 startTime = uint64(block.timestamp);

        schedules[scheduleId] = VestingSchedule({
            beneficiary: _beneficiary,
            totalAmount: _totalAmount,
            releasedAmount: 0,
            startTime: startTime,
            cliffDuration: _cliffDuration,
            vestingDuration: _vestingDuration,
            revocable: _revocable,
            revoked: false
        });

        totalVestingAmount += _totalAmount;

        emit VestingScheduleCreated(
            scheduleId,
            _beneficiary,
            _totalAmount,
            startTime,
            _cliffDuration,
            _vestingDuration,
            _revocable
        );
    }

    /**
     * @notice Revokes unvested tokens from a revocable schedule
     * @param _scheduleId The ID of the schedule to revoke
     * @dev Intentionally NOT marked whenNotPaused - allows admin to revoke during emergencies
     *      to recover unvested tokens. Beneficiaries can still claim vested portion after unpause.
     */
    function revokeVesting(uint256 _scheduleId) external onlyOwner {
        VestingSchedule storage schedule = schedules[_scheduleId];
        address beneficiary = schedule.beneficiary;

        if (beneficiary == address(0)) revert ScheduleNotFound();
        if (!schedule.revocable) revert NotRevocable();
        if (schedule.revoked) revert AlreadyRevoked();

        uint256 vestedAmount = _calculateVestedAmount(schedule);
        uint256 unvestedAmount = schedule.totalAmount - vestedAmount;

        if (unvestedAmount == 0) revert NothingToRevoke();

        schedule.revoked = true;
        schedule.totalAmount = vestedAmount;
        totalVestingAmount -= unvestedAmount;

        token.safeTransfer(owner(), unvestedAmount);

        emit VestingRevoked(_scheduleId, beneficiary, unvestedAmount);
    }

    /**
     * @notice Pauses all vesting operations (claims and new schedules)
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Resumes vesting operations
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    // ============ Beneficiary Functions ============

    /**
     * @notice Claims vested tokens for a schedule
     * @param _scheduleId The ID of the schedule to claim from
     */
    function claim(uint256 _scheduleId) external nonReentrant whenNotPaused {
        VestingSchedule storage schedule = schedules[_scheduleId];
        address beneficiary = schedule.beneficiary;

        if (beneficiary == address(0)) revert ScheduleNotFound();
        if (beneficiary != msg.sender) revert NotBeneficiary();

        uint256 claimableAmount = _calculateClaimableAmount(schedule);
        if (claimableAmount == 0) revert NothingToClaim();

        schedule.releasedAmount += claimableAmount;
        totalVestingAmount -= claimableAmount;

        token.safeTransfer(msg.sender, claimableAmount);

        emit TokensClaimed(_scheduleId, msg.sender, claimableAmount);
    }

    // ============ View Functions ============

    function getVestingSchedule(uint256 _scheduleId)
        external
        view
        returns (VestingSchedule memory)
    {
        return schedules[_scheduleId];
    }

    function getVestedAmount(uint256 _scheduleId) external view returns (uint256) {
        VestingSchedule storage schedule = schedules[_scheduleId];
        if (schedule.beneficiary == address(0)) revert ScheduleNotFound();
        return _calculateVestedAmount(schedule);
    }

    function getClaimableAmount(uint256 _scheduleId) external view returns (uint256) {
        VestingSchedule storage schedule = schedules[_scheduleId];
        if (schedule.beneficiary == address(0)) revert ScheduleNotFound();
        return _calculateClaimableAmount(schedule);
    }

    function getScheduleCount() external view returns (uint256) {
        return scheduleCount;
    }

    // ============ Internal Functions ============

    function _calculateVestedAmount(VestingSchedule storage schedule)
        internal
        view
        returns (uint256)
    {
        if (schedule.revoked) {
            return schedule.totalAmount;
        }

        uint64 currentTime = uint64(block.timestamp);
        uint64 startTime = schedule.startTime;
        uint64 cliffEnd = startTime + schedule.cliffDuration;
        uint64 vestingEnd = startTime + schedule.vestingDuration;

        if (currentTime < cliffEnd) {
            return 0;
        }

        if (currentTime >= vestingEnd) {
            return schedule.totalAmount;
        }

        uint256 timeVested = currentTime - startTime;
        return (schedule.totalAmount * timeVested) / schedule.vestingDuration;
    }

    function _calculateClaimableAmount(VestingSchedule storage schedule)
        internal
        view
        returns (uint256)
    {
        return _calculateVestedAmount(schedule) - schedule.releasedAmount;
    }
}
```

**Key Design Decisions:**
- `revokeVesting` intentionally lacks `whenNotPaused` - allows admin to recover unvested tokens during emergencies while beneficiaries can claim their vested portion after unpause
- `startTime` defaults to `block.timestamp` - simpler API, eliminates past-timestamp footgun
- Struct packing: `uint64` timestamps pack efficiently with booleans in single storage slot

---

## Deployment Scripts

### 01_deploy_vesting_token.ts

```typescript
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { parseEther } from "viem";

const deployVestingToken: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  const initialSupply = parseEther("1000000"); // 1 million tokens

  await deploy("VestingToken", {
    from: deployer,
    args: ["Vesting Token", "VEST", initialSupply],
    log: true,
    autoMine: true,
  });
};

export default deployVestingToken;
deployVestingToken.tags = ["VestingToken"];
```

### 02_deploy_token_vesting.ts

```typescript
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const deployTokenVesting: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy, get } = hre.deployments;

  const vestingToken = await get("VestingToken");

  await deploy("TokenVesting", {
    from: deployer,
    args: [vestingToken.address],
    log: true,
    autoMine: true,
  });
};

export default deployTokenVesting;
deployTokenVesting.tags = ["TokenVesting"];
deployTokenVesting.dependencies = ["VestingToken"];
```

---

## Frontend Architecture

### Types (packages/nextjs/app/vesting/types.ts)

```typescript
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
```

### Page Structure

```
packages/nextjs/app/
├── vesting/
│   ├── page.tsx                    # Beneficiary dashboard
│   ├── admin/
│   │   └── page.tsx               # Admin page
│   ├── types.ts                   # Shared types
│   └── components/
│       ├── VestingScheduleCard.tsx
│       ├── VestingProgressBar.tsx
│       ├── ClaimButton.tsx
│       ├── CreateVestingForm.tsx
│       └── AdminScheduleRow.tsx
```

### Component Specifications

#### 1. VestingScheduleCard.tsx

```typescript
"use client";

import { formatEther } from "viem";
import { VestingProgressBar } from "./VestingProgressBar";
import { ClaimButton } from "./ClaimButton";
import { Address } from "~~/components/scaffold-eth";
import { VestingScheduleWithComputedData } from "../types";

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

  const statusLabel = revoked
    ? "Revoked"
    : isFullyVested
      ? "Fully Vested"
      : isCliffPeriod
        ? "In Cliff"
        : "Vesting";

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
```

#### 2. VestingProgressBar.tsx

```typescript
"use client";

type VestingProgressBarProps = {
  startTime: bigint;
  cliffDuration: bigint;
  vestingDuration: bigint;
  vestedAmount: bigint;
  totalAmount: bigint;
};

export const VestingProgressBar = ({
  startTime,
  cliffDuration,
  vestingDuration,
  vestedAmount,
  totalAmount,
}: VestingProgressBarProps) => {
  const vestingEnd = startTime + vestingDuration;

  const totalDuration = Number(vestingDuration);
  const cliffPercent = (Number(cliffDuration) / totalDuration) * 100;

  const vestedPercent = totalAmount > 0n ? (Number(vestedAmount) / Number(totalAmount)) * 100 : 0;

  return (
    <div className="w-full mt-4">
      <div className="flex justify-between text-xs mb-1">
        <span>Start</span>
        <span>Cliff ({cliffPercent.toFixed(0)}%)</span>
        <span>End</span>
      </div>

      <div className="relative w-full h-4 bg-base-300 rounded-full overflow-hidden">
        <div className="absolute h-full bg-primary transition-all duration-500" style={{ width: `${vestedPercent}%` }} />
        <div className="absolute h-full w-0.5 bg-warning" style={{ left: `${cliffPercent}%` }} />
      </div>

      <div className="flex justify-between text-xs mt-1 text-base-content/70">
        <span>{new Date(Number(startTime) * 1000).toLocaleDateString()}</span>
        <span>{vestedPercent.toFixed(1)}% vested</span>
        <span>{new Date(Number(vestingEnd) * 1000).toLocaleDateString()}</span>
      </div>
    </div>
  );
};
```

#### 3. ClaimButton.tsx

```typescript
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
```

#### 4. CreateVestingForm.tsx

```typescript
"use client";

import { useState } from "react";
import { parseEther } from "viem";
import { useScaffoldWriteContract, useDeployedContractInfo } from "~~/hooks/scaffold-eth";
import { AddressInput } from "~~/components/scaffold-eth";
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
```

#### 5. AdminScheduleRow.tsx

```typescript
"use client";

import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";
import { Address } from "~~/components/scaffold-eth";
import { formatEther } from "viem";

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
```

#### 6. Beneficiary Dashboard Page (vesting/page.tsx)

```typescript
"use client";

import { useAccount } from "wagmi";
import { useScaffoldEventHistory, useScaffoldReadContract } from "~~/hooks/scaffold-eth";
import { VestingScheduleCard } from "./components/VestingScheduleCard";
import { VestingSchedule } from "./types";

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
```

#### 7. Admin Page (vesting/admin/page.tsx)

```typescript
"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { useScaffoldReadContract, useScaffoldWriteContract, useScaffoldEventHistory } from "~~/hooks/scaffold-eth";
import { CreateVestingForm } from "../components/CreateVestingForm";
import { AdminScheduleRow } from "../components/AdminScheduleRow";
import { Address } from "~~/components/scaffold-eth";
import { formatEther } from "viem";
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
```

---

## Testing Strategy

### Smart Contract Tests (packages/hardhat/test/TokenVesting.test.ts)

```typescript
import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { TokenVesting, VestingToken } from "../typechain-types";

describe("TokenVesting", function () {
  let vestingToken: VestingToken;
  let tokenVesting: TokenVesting;
  let owner: any;
  let beneficiary: any;
  let otherUser: any;

  const TOTAL_AMOUNT = ethers.parseEther("1000");
  const CLIFF_DURATION = 90 * 24 * 60 * 60; // 90 days
  const VESTING_DURATION = 365 * 24 * 60 * 60; // 365 days

  beforeEach(async function () {
    [owner, beneficiary, otherUser] = await ethers.getSigners();

    const VestingTokenFactory = await ethers.getContractFactory("VestingToken");
    vestingToken = await VestingTokenFactory.deploy("Vesting Token", "VEST", ethers.parseEther("1000000"));

    const TokenVestingFactory = await ethers.getContractFactory("TokenVesting");
    tokenVesting = await TokenVestingFactory.deploy(await vestingToken.getAddress());

    await vestingToken.approve(await tokenVesting.getAddress(), ethers.parseEther("1000000"));
  });

  describe("createVestingSchedule", function () {
    it("should create a vesting schedule", async function () {
      await expect(
        tokenVesting.createVestingSchedule(beneficiary.address, TOTAL_AMOUNT, CLIFF_DURATION, VESTING_DURATION, true),
      ).to.emit(tokenVesting, "VestingScheduleCreated");

      const schedule = await tokenVesting.getVestingSchedule(0);
      expect(schedule.beneficiary).to.equal(beneficiary.address);
      expect(schedule.totalAmount).to.equal(TOTAL_AMOUNT);
    });

    it("should revert with zero beneficiary", async function () {
      await expect(
        tokenVesting.createVestingSchedule(
          ethers.ZeroAddress,
          TOTAL_AMOUNT,
          CLIFF_DURATION,
          VESTING_DURATION,
          true,
        ),
      ).to.be.revertedWithCustomError(tokenVesting, "InvalidBeneficiary");
    });

    it("should revert with zero amount", async function () {
      await expect(
        tokenVesting.createVestingSchedule(beneficiary.address, 0, CLIFF_DURATION, VESTING_DURATION, true),
      ).to.be.revertedWithCustomError(tokenVesting, "InvalidAmount");
    });

    it("should revert with cliff exceeding duration", async function () {
      await expect(
        tokenVesting.createVestingSchedule(
          beneficiary.address,
          TOTAL_AMOUNT,
          VESTING_DURATION + 1,
          VESTING_DURATION,
          true,
        ),
      ).to.be.revertedWithCustomError(tokenVesting, "CliffExceedsDuration");
    });

    it("should allow multiple schedules for same beneficiary", async function () {
      await tokenVesting.createVestingSchedule(
        beneficiary.address,
        TOTAL_AMOUNT,
        CLIFF_DURATION,
        VESTING_DURATION,
        true,
      );
      await tokenVesting.createVestingSchedule(
        beneficiary.address,
        TOTAL_AMOUNT,
        CLIFF_DURATION,
        VESTING_DURATION,
        false,
      );

      expect(await tokenVesting.getScheduleCount()).to.equal(2);
    });
  });

  describe("claim", function () {
    beforeEach(async function () {
      await tokenVesting.createVestingSchedule(
        beneficiary.address,
        TOTAL_AMOUNT,
        CLIFF_DURATION,
        VESTING_DURATION,
        true,
      );
    });

    it("should not allow claiming before cliff", async function () {
      await expect(tokenVesting.connect(beneficiary).claim(0)).to.be.revertedWithCustomError(
        tokenVesting,
        "NothingToClaim",
      );
    });

    it("should allow claiming after cliff", async function () {
      await time.increase(CLIFF_DURATION + 1);

      await expect(tokenVesting.connect(beneficiary).claim(0)).to.emit(tokenVesting, "TokensClaimed");
    });

    it("should vest linearly after cliff", async function () {
      await time.increase(VESTING_DURATION / 2);

      const claimable = await tokenVesting.getClaimableAmount(0);
      const expected = TOTAL_AMOUNT / 2n;

      expect(claimable).to.be.closeTo(expected, expected / 100n);
    });

    it("should allow claiming exactly at cliff end", async function () {
      await time.increase(CLIFF_DURATION);

      const claimable = await tokenVesting.getClaimableAmount(0);
      const expectedAtCliff = (TOTAL_AMOUNT * BigInt(CLIFF_DURATION)) / BigInt(VESTING_DURATION);

      expect(claimable).to.be.closeTo(expectedAtCliff, expectedAtCliff / 100n);
    });

    it("should allow multiple claims", async function () {
      // First claim at 25%
      await time.increase(VESTING_DURATION / 4);
      await tokenVesting.connect(beneficiary).claim(0);

      const balanceAfterFirst = await vestingToken.balanceOf(beneficiary.address);

      // Second claim at 50%
      await time.increase(VESTING_DURATION / 4);
      await tokenVesting.connect(beneficiary).claim(0);

      const balanceAfterSecond = await vestingToken.balanceOf(beneficiary.address);
      expect(balanceAfterSecond).to.be.gt(balanceAfterFirst);

      // Third claim at 100%
      await time.increase(VESTING_DURATION / 2);
      await tokenVesting.connect(beneficiary).claim(0);

      const finalBalance = await vestingToken.balanceOf(beneficiary.address);
      expect(finalBalance).to.equal(TOTAL_AMOUNT);
    });

    it("should not allow non-beneficiary to claim", async function () {
      await time.increase(CLIFF_DURATION + 1);

      await expect(tokenVesting.connect(otherUser).claim(0)).to.be.revertedWithCustomError(
        tokenVesting,
        "NotBeneficiary",
      );
    });

    it("should not allow claiming when paused", async function () {
      await time.increase(CLIFF_DURATION + 1);
      await tokenVesting.pause();

      await expect(tokenVesting.connect(beneficiary).claim(0)).to.be.revertedWithCustomError(
        tokenVesting,
        "EnforcedPause",
      );
    });
  });

  describe("revokeVesting", function () {
    it("should revoke and return unvested tokens", async function () {
      await tokenVesting.createVestingSchedule(
        beneficiary.address,
        TOTAL_AMOUNT,
        CLIFF_DURATION,
        VESTING_DURATION,
        true,
      );

      const ownerBalanceBefore = await vestingToken.balanceOf(owner.address);

      await expect(tokenVesting.revokeVesting(0)).to.emit(tokenVesting, "VestingRevoked");

      const ownerBalanceAfter = await vestingToken.balanceOf(owner.address);
      expect(ownerBalanceAfter).to.equal(ownerBalanceBefore + TOTAL_AMOUNT);
    });

    it("should not allow revoking non-revocable schedules", async function () {
      await tokenVesting.createVestingSchedule(
        beneficiary.address,
        TOTAL_AMOUNT,
        CLIFF_DURATION,
        VESTING_DURATION,
        false,
      );

      await expect(tokenVesting.revokeVesting(0)).to.be.revertedWithCustomError(tokenVesting, "NotRevocable");
    });

    it("should not allow double revocation", async function () {
      await tokenVesting.createVestingSchedule(
        beneficiary.address,
        TOTAL_AMOUNT,
        CLIFF_DURATION,
        VESTING_DURATION,
        true,
      );

      await tokenVesting.revokeVesting(0);

      await expect(tokenVesting.revokeVesting(0)).to.be.revertedWithCustomError(tokenVesting, "AlreadyRevoked");
    });

    it("should not allow revoking fully vested schedule", async function () {
      await tokenVesting.createVestingSchedule(
        beneficiary.address,
        TOTAL_AMOUNT,
        CLIFF_DURATION,
        VESTING_DURATION,
        true,
      );

      await time.increase(VESTING_DURATION + 1);

      await expect(tokenVesting.revokeVesting(0)).to.be.revertedWithCustomError(tokenVesting, "NothingToRevoke");
    });

    it("should allow beneficiary to claim vested portion after revocation", async function () {
      await tokenVesting.createVestingSchedule(
        beneficiary.address,
        TOTAL_AMOUNT,
        CLIFF_DURATION,
        VESTING_DURATION,
        true,
      );

      // Move to 50% vested
      await time.increase(VESTING_DURATION / 2);

      // Beneficiary claims some
      await tokenVesting.connect(beneficiary).claim(0);

      // Admin revokes
      await tokenVesting.revokeVesting(0);

      // Beneficiary claims remaining vested portion
      const claimableAfterRevoke = await tokenVesting.getClaimableAmount(0);
      if (claimableAfterRevoke > 0n) {
        await tokenVesting.connect(beneficiary).claim(0);
      }

      // Verify beneficiary got roughly half the tokens
      const finalBalance = await vestingToken.balanceOf(beneficiary.address);
      expect(finalBalance).to.be.closeTo(TOTAL_AMOUNT / 2n, TOTAL_AMOUNT / 100n);
    });

    it("should allow revoking when contract is paused", async function () {
      await tokenVesting.createVestingSchedule(
        beneficiary.address,
        TOTAL_AMOUNT,
        CLIFF_DURATION,
        VESTING_DURATION,
        true,
      );

      await tokenVesting.pause();

      // Should still be able to revoke during emergency
      await expect(tokenVesting.revokeVesting(0)).to.emit(tokenVesting, "VestingRevoked");
    });
  });

  describe("pause/unpause", function () {
    it("should pause and unpause", async function () {
      await tokenVesting.pause();
      expect(await tokenVesting.paused()).to.be.true;

      await tokenVesting.unpause();
      expect(await tokenVesting.paused()).to.be.false;
    });

    it("should not allow non-owner to pause", async function () {
      await expect(tokenVesting.connect(beneficiary).pause()).to.be.revertedWithCustomError(
        tokenVesting,
        "OwnableUnauthorizedAccount",
      );
    });

    it("should not allow creating schedules when paused", async function () {
      await tokenVesting.pause();

      await expect(
        tokenVesting.createVestingSchedule(beneficiary.address, TOTAL_AMOUNT, CLIFF_DURATION, VESTING_DURATION, true),
      ).to.be.revertedWithCustomError(tokenVesting, "EnforcedPause");
    });
  });
});
```

---

## Navigation Integration

Add navigation link to the header in `packages/nextjs/components/Header.tsx`:

```typescript
import { LockClosedIcon } from "@heroicons/react/24/outline";

// Add to menuLinks array
{
  label: "Vesting",
  href: "/vesting",
  icon: <LockClosedIcon className="h-4 w-4" />
},
```

---

## Gas Considerations

1. **Event-based discovery**: Using events instead of on-chain arrays saves significant gas on schedule creation
2. **Cached storage reads**: Beneficiary address cached in `claim()` and `revokeVesting()` to avoid double reads
3. **Simplified signature**: Removed `_startTime` parameter, reducing calldata costs
4. **Struct packing**: `uint64` timestamps pack efficiently with booleans in single storage slot
5. **Immutable token**: Token address in bytecode, not storage

---

## Security Considerations

1. **ReentrancyGuard**: Applied to claim function
2. **SafeERC20**: All token transfers use SafeERC20
3. **Pausable**: Emergency pause mechanism for critical situations
4. **Access Control**: Ownable pattern for admin functions
5. **Custom Errors**: Gas-efficient error handling
6. **Input Validation**: All inputs validated before state changes
7. **Immutable Token**: Token address cannot be changed after deployment
8. **CEI Pattern**: Checks-Effects-Interactions pattern followed
9. **Emergency Revocation**: `revokeVesting` works during pause for emergency token recovery

---

## Design Decisions

1. **`startTime` defaults to `block.timestamp`**: Simpler API, eliminates past-timestamp footgun, covers 99% of use cases
2. **`revokeVesting` without `whenNotPaused`**: Intentional - allows admin to recover unvested tokens during emergencies while beneficiaries can claim vested portion after unpause
3. **Event-based schedule discovery**: Gas efficient and follows SE-2 patterns with `useScaffoldEventHistory`
4. **Single owner model**: Simple Ownable pattern suitable for team vesting use case

---

## Future Enhancements (Out of Scope)

1. Multiple token support per vesting contract
2. Transferable vesting schedules
3. Batch schedule creation
4. Governance integration for revocation decisions
5. Vesting schedule templates
6. Deferred start time support via separate function
