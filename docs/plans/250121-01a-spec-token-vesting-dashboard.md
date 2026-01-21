# Token Vesting Dashboard - Specification v1a

## Overview

A Token Vesting Dashboard dApp for team token distribution built on Scaffold-ETH 2. This application allows admins to create vesting schedules for team members, advisors, and investors, while beneficiaries can track their vesting progress and claim tokens as they vest.

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

**Storage:**
- Inherited ERC20 storage (balances, allowances, totalSupply)

**Events:**
- Inherited ERC20 events (Transfer, Approval)

**Functions:**
- `constructor(name, symbol, initialSupply)`: Deploy with initial mint to deployer
- `mint(to, amount)`: Owner-only minting for additional supply

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

contract TokenVesting is Ownable, ReentrancyGuard {
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

    // Total tokens held for all active vesting schedules
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
    error InsufficientTokens();

    // ============ Constructor ============

    constructor(address _token) Ownable(msg.sender) {
        token = IERC20(_token);
    }

    // ============ Admin Functions ============

    function createVestingSchedule(
        address _beneficiary,
        uint256 _totalAmount,
        uint64 _startTime,
        uint64 _cliffDuration,
        uint64 _vestingDuration,
        bool _revocable
    ) external onlyOwner returns (uint256 scheduleId) {
        if (_beneficiary == address(0)) revert InvalidBeneficiary();
        if (_totalAmount == 0) revert InvalidAmount();
        if (_vestingDuration == 0) revert InvalidDuration();
        if (_cliffDuration > _vestingDuration) revert CliffExceedsDuration();

        // Transfer tokens from owner to this contract
        token.safeTransferFrom(msg.sender, address(this), _totalAmount);

        scheduleId = scheduleCount++;

        schedules[scheduleId] = VestingSchedule({
            beneficiary: _beneficiary,
            totalAmount: _totalAmount,
            releasedAmount: 0,
            startTime: _startTime,
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
            _startTime,
            _cliffDuration,
            _vestingDuration,
            _revocable
        );
    }

    function revokeVesting(uint256 _scheduleId) external onlyOwner {
        VestingSchedule storage schedule = schedules[_scheduleId];

        if (schedule.beneficiary == address(0)) revert ScheduleNotFound();
        if (!schedule.revocable) revert NotRevocable();
        if (schedule.revoked) revert AlreadyRevoked();

        uint256 vestedAmount = _calculateVestedAmount(schedule);
        uint256 unvestedAmount = schedule.totalAmount - vestedAmount;

        schedule.revoked = true;
        schedule.totalAmount = vestedAmount;
        totalVestingAmount -= unvestedAmount;

        // Return unvested tokens to owner
        if (unvestedAmount > 0) {
            token.safeTransfer(owner(), unvestedAmount);
        }

        emit VestingRevoked(_scheduleId, schedule.beneficiary, unvestedAmount);
    }

    // ============ Beneficiary Functions ============

    function claim(uint256 _scheduleId) external nonReentrant {
        VestingSchedule storage schedule = schedules[_scheduleId];

        if (schedule.beneficiary == address(0)) revert ScheduleNotFound();
        if (schedule.beneficiary != msg.sender) revert NotBeneficiary();

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

        // Before cliff: nothing vested
        if (currentTime < cliffEnd) {
            return 0;
        }

        // After vesting complete: everything vested
        if (currentTime >= vestingEnd) {
            return schedule.totalAmount;
        }

        // During vesting: linear calculation
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

**Storage:**
- `token`: Immutable reference to the ERC20 token
- `scheduleCount`: Counter for generating unique schedule IDs
- `schedules`: Mapping of schedule ID to VestingSchedule struct
- `totalVestingAmount`: Tracking total locked tokens

**Events:**
- `VestingScheduleCreated`: Emitted when admin creates a new schedule (indexed: scheduleId, beneficiary)
- `TokensClaimed`: Emitted when beneficiary claims tokens (indexed: scheduleId, beneficiary)
- `VestingRevoked`: Emitted when admin revokes a schedule (indexed: scheduleId, beneficiary)

**Functions:**
- `createVestingSchedule()`: Admin creates a new vesting schedule
- `revokeVesting()`: Admin revokes unvested tokens from revocable schedule
- `claim()`: Beneficiary claims vested tokens
- `getVestingSchedule()`: Returns full schedule details
- `getVestedAmount()`: Returns total vested amount for a schedule
- `getClaimableAmount()`: Returns claimable (vested - released) amount
- `getScheduleCount()`: Returns total number of schedules

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

### Page Structure

```
packages/nextjs/app/
├── vesting/
│   ├── page.tsx           # Main dashboard (beneficiary view)
│   ├── admin/
│   │   └── page.tsx       # Admin page (create schedules)
│   └── components/
│       ├── VestingScheduleCard.tsx
│       ├── VestingProgressBar.tsx
│       ├── ClaimButton.tsx
│       ├── CreateVestingForm.tsx
│       └── AdminScheduleList.tsx
```

### Component Specifications

#### 1. VestingScheduleCard.tsx

Displays a single vesting schedule with progress and claim functionality.

```typescript
"use client";

import { formatEther } from "viem";
import { VestingProgressBar } from "./VestingProgressBar";
import { ClaimButton } from "./ClaimButton";
import { Address } from "~~/components/scaffold-eth";

interface VestingScheduleCardProps {
  scheduleId: bigint;
  beneficiary: string;
  totalAmount: bigint;
  releasedAmount: bigint;
  startTime: bigint;
  cliffDuration: bigint;
  vestingDuration: bigint;
  revocable: boolean;
  revoked: boolean;
  claimableAmount: bigint;
  vestedAmount: bigint;
}

export const VestingScheduleCard = ({
  scheduleId,
  beneficiary,
  totalAmount,
  releasedAmount,
  startTime,
  cliffDuration,
  vestingDuration,
  revocable,
  revoked,
  claimableAmount,
  vestedAmount,
}: VestingScheduleCardProps) => {
  const cliffEnd = startTime + cliffDuration;
  const vestingEnd = startTime + vestingDuration;
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

  const statusColor = revoked
    ? "badge-error"
    : isFullyVested
      ? "badge-success"
      : "badge-warning";

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

        {revocable && !revoked && (
          <div className="text-xs text-warning">This schedule is revocable</div>
        )}

        <div className="card-actions justify-end mt-4">
          <ClaimButton scheduleId={scheduleId} claimableAmount={claimableAmount} />
        </div>
      </div>
    </div>
  );
};
```

#### 2. VestingProgressBar.tsx

Visual representation of vesting progress with cliff marker.

```typescript
"use client";

interface VestingProgressBarProps {
  startTime: bigint;
  cliffDuration: bigint;
  vestingDuration: bigint;
  vestedAmount: bigint;
  totalAmount: bigint;
}

export const VestingProgressBar = ({
  startTime,
  cliffDuration,
  vestingDuration,
  vestedAmount,
  totalAmount,
}: VestingProgressBarProps) => {
  const now = BigInt(Math.floor(Date.now() / 1000));
  const vestingEnd = startTime + vestingDuration;
  const cliffEnd = startTime + cliffDuration;

  // Calculate percentage progress
  const totalDuration = Number(vestingDuration);
  const cliffPercent = (Number(cliffDuration) / totalDuration) * 100;

  const elapsed = now > startTime ? Number(now - startTime) : 0;
  const timeProgress = Math.min((elapsed / totalDuration) * 100, 100);

  const vestedPercent = totalAmount > 0n
    ? (Number(vestedAmount) / Number(totalAmount)) * 100
    : 0;

  return (
    <div className="w-full mt-4">
      <div className="flex justify-between text-xs mb-1">
        <span>Start</span>
        <span>Cliff ({cliffPercent.toFixed(0)}%)</span>
        <span>End</span>
      </div>

      <div className="relative w-full h-4 bg-base-300 rounded-full overflow-hidden">
        {/* Vested progress */}
        <div
          className="absolute h-full bg-primary transition-all duration-500"
          style={{ width: `${vestedPercent}%` }}
        />

        {/* Cliff marker */}
        <div
          className="absolute h-full w-0.5 bg-warning"
          style={{ left: `${cliffPercent}%` }}
        />
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

Button to claim vested tokens with loading state.

```typescript
"use client";

import { useScaffoldWriteContract } from "~~/hooks/scaffold-eth";

interface ClaimButtonProps {
  scheduleId: bigint;
  claimableAmount: bigint;
}

export const ClaimButton = ({ scheduleId, claimableAmount }: ClaimButtonProps) => {
  const { writeContractAsync, isMining } = useScaffoldWriteContract("TokenVesting");

  const handleClaim = async () => {
    try {
      await writeContractAsync({
        functionName: "claim",
        args: [scheduleId],
      });
    } catch (error) {
      console.error("Claim failed:", error);
    }
  };

  const isDisabled = claimableAmount === 0n || isMining;

  return (
    <button
      className={`btn btn-primary ${isMining ? "loading" : ""}`}
      onClick={handleClaim}
      disabled={isDisabled}
    >
      {isMining ? "Claiming..." : "Claim Tokens"}
    </button>
  );
};
```

#### 4. CreateVestingForm.tsx

Admin form for creating new vesting schedules.

```typescript
"use client";

import { useState } from "react";
import { parseEther } from "viem";
import { useScaffoldWriteContract, useScaffoldReadContract } from "~~/hooks/scaffold-eth";
import { AddressInput, IntegerInput } from "~~/components/scaffold-eth";

export const CreateVestingForm = () => {
  const [beneficiary, setBeneficiary] = useState<string>("");
  const [amount, setAmount] = useState<string>("");
  const [cliffSeconds, setCliffSeconds] = useState<string>("");
  const [durationSeconds, setDurationSeconds] = useState<string>("");
  const [revocable, setRevocable] = useState<boolean>(false);

  const { writeContractAsync: createSchedule, isMining: isCreating } =
    useScaffoldWriteContract("TokenVesting");

  const { writeContractAsync: approveTokens, isMining: isApproving } =
    useScaffoldWriteContract("VestingToken");

  const { data: vestingContractAddress } = useScaffoldReadContract({
    contractName: "TokenVesting",
    functionName: "token",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!beneficiary || !amount || !durationSeconds) return;

    const amountWei = parseEther(amount);
    const startTime = BigInt(Math.floor(Date.now() / 1000));
    const cliff = BigInt(cliffSeconds || "0");
    const duration = BigInt(durationSeconds);

    try {
      // First approve tokens
      await approveTokens({
        functionName: "approve",
        args: [vestingContractAddress, amountWei],
      });

      // Then create vesting schedule
      await createSchedule({
        functionName: "createVestingSchedule",
        args: [beneficiary, amountWei, startTime, cliff, duration, revocable],
      });

      // Reset form
      setBeneficiary("");
      setAmount("");
      setCliffSeconds("");
      setDurationSeconds("");
      setRevocable(false);
    } catch (error) {
      console.error("Failed to create vesting schedule:", error);
    }
  };

  const isLoading = isCreating || isApproving;

  return (
    <form onSubmit={handleSubmit} className="card bg-base-100 shadow-xl">
      <div className="card-body">
        <h2 className="card-title">Create Vesting Schedule</h2>

        <div className="form-control">
          <label className="label">
            <span className="label-text">Beneficiary Address</span>
          </label>
          <AddressInput
            value={beneficiary}
            onChange={setBeneficiary}
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
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
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
              value={cliffSeconds}
              onChange={(e) => setCliffSeconds(e.target.value)}
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
              value={durationSeconds}
              onChange={(e) => setDurationSeconds(e.target.value)}
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
              checked={revocable}
              onChange={(e) => setRevocable(e.target.checked)}
            />
          </label>
        </div>

        <div className="card-actions justify-end mt-4">
          <button
            type="submit"
            className={`btn btn-primary ${isLoading ? "loading" : ""}`}
            disabled={isLoading || !beneficiary || !amount || !durationSeconds}
          >
            {isLoading ? "Creating..." : "Create Schedule"}
          </button>
        </div>
      </div>
    </form>
  );
};
```

#### 5. Beneficiary Dashboard Page (vesting/page.tsx)

```typescript
"use client";

import { useAccount } from "wagmi";
import { useScaffoldEventHistory, useScaffoldReadContract } from "~~/hooks/scaffold-eth";
import { VestingScheduleCard } from "./components/VestingScheduleCard";

const VestingDashboard = () => {
  const { address } = useAccount();

  // Get all VestingScheduleCreated events for this beneficiary
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
          <p className="text-base-content/70">
            Connect your wallet to view your vesting schedules
          </p>
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

  const scheduleIds = vestingEvents?.map((event) => event.args.scheduleId) ?? [];

  return (
    <div className="container mx-auto p-6">
      <h1 className="text-3xl font-bold mb-8">Your Vesting Schedules</h1>

      {scheduleIds.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-base-content/70">No vesting schedules found for your address</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {scheduleIds.map((scheduleId) => (
            <VestingScheduleCardWrapper
              key={scheduleId?.toString()}
              scheduleId={scheduleId!}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// Wrapper component to fetch individual schedule data
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

  return (
    <VestingScheduleCard
      scheduleId={scheduleId}
      beneficiary={schedule.beneficiary}
      totalAmount={schedule.totalAmount}
      releasedAmount={schedule.releasedAmount}
      startTime={schedule.startTime}
      cliffDuration={schedule.cliffDuration}
      vestingDuration={schedule.vestingDuration}
      revocable={schedule.revocable}
      revoked={schedule.revoked}
      claimableAmount={claimableAmount ?? 0n}
      vestedAmount={vestedAmount ?? 0n}
    />
  );
};

export default VestingDashboard;
```

#### 6. Admin Page (vesting/admin/page.tsx)

```typescript
"use client";

import { useAccount } from "wagmi";
import { useScaffoldReadContract, useScaffoldWriteContract, useScaffoldEventHistory } from "~~/hooks/scaffold-eth";
import { CreateVestingForm } from "../components/CreateVestingForm";
import { Address } from "~~/components/scaffold-eth";
import { formatEther } from "viem";

const AdminPage = () => {
  const { address } = useAccount();

  // Check if current user is owner
  const { data: owner } = useScaffoldReadContract({
    contractName: "TokenVesting",
    functionName: "owner",
  });

  const { data: tokenBalance } = useScaffoldReadContract({
    contractName: "VestingToken",
    functionName: "balanceOf",
    args: [address],
  });

  // Get all vesting events
  const { data: allVestingEvents, isLoading } = useScaffoldEventHistory({
    contractName: "TokenVesting",
    eventName: "VestingScheduleCreated",
    fromBlock: 0n,
    watch: true,
  });

  const { writeContractAsync: revokeSchedule, isMining: isRevoking } =
    useScaffoldWriteContract("TokenVesting");

  const isOwner = owner && address && owner.toLowerCase() === address.toLowerCase();

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

  if (!isOwner) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-4">Access Denied</h2>
          <p className="text-base-content/70">Only the contract owner can access this page</p>
          <p className="text-sm mt-2">Owner: <Address address={owner} /></p>
        </div>
      </div>
    );
  }

  const handleRevoke = async (scheduleId: bigint) => {
    try {
      await revokeSchedule({
        functionName: "revokeVesting",
        args: [scheduleId],
      });
    } catch (error) {
      console.error("Revoke failed:", error);
    }
  };

  return (
    <div className="container mx-auto p-6">
      <h1 className="text-3xl font-bold mb-4">Admin Dashboard</h1>

      <div className="mb-8 p-4 bg-base-200 rounded-lg">
        <p className="text-sm">
          Your VEST Balance: <span className="font-bold">{formatEther(tokenBalance ?? 0n)} VEST</span>
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div>
          <CreateVestingForm />
        </div>

        <div className="card bg-base-100 shadow-xl">
          <div className="card-body">
            <h2 className="card-title">All Vesting Schedules</h2>

            {isLoading ? (
              <span className="loading loading-spinner"></span>
            ) : allVestingEvents?.length === 0 ? (
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
                    {allVestingEvents?.map((event) => (
                      <AdminScheduleRow
                        key={event.args.scheduleId?.toString()}
                        scheduleId={event.args.scheduleId!}
                        onRevoke={handleRevoke}
                        isRevoking={isRevoking}
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

const AdminScheduleRow = ({
  scheduleId,
  onRevoke,
  isRevoking
}: {
  scheduleId: bigint;
  onRevoke: (id: bigint) => void;
  isRevoking: boolean;
}) => {
  const { data: schedule } = useScaffoldReadContract({
    contractName: "TokenVesting",
    functionName: "getVestingSchedule",
    args: [scheduleId],
    watch: true,
  });

  if (!schedule) return null;

  return (
    <tr>
      <td>{scheduleId.toString()}</td>
      <td><Address address={schedule.beneficiary} /></td>
      <td>{formatEther(schedule.totalAmount)} VEST</td>
      <td>{schedule.revocable ? "Yes" : "No"}</td>
      <td>
        {schedule.revocable && !schedule.revoked && (
          <button
            className={`btn btn-error btn-sm ${isRevoking ? "loading" : ""}`}
            onClick={() => onRevoke(scheduleId)}
            disabled={isRevoking}
          >
            Revoke
          </button>
        )}
        {schedule.revoked && <span className="badge badge-error">Revoked</span>}
      </td>
    </tr>
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

  const TOTAL_AMOUNT = ethers.parseEther("1000");
  const CLIFF_DURATION = 90 * 24 * 60 * 60; // 90 days
  const VESTING_DURATION = 365 * 24 * 60 * 60; // 365 days

  beforeEach(async function () {
    [owner, beneficiary] = await ethers.getSigners();

    // Deploy token
    const VestingTokenFactory = await ethers.getContractFactory("VestingToken");
    vestingToken = await VestingTokenFactory.deploy("Vesting Token", "VEST", ethers.parseEther("1000000"));

    // Deploy vesting contract
    const TokenVestingFactory = await ethers.getContractFactory("TokenVesting");
    tokenVesting = await TokenVestingFactory.deploy(await vestingToken.getAddress());

    // Approve tokens
    await vestingToken.approve(await tokenVesting.getAddress(), ethers.parseEther("1000000"));
  });

  describe("createVestingSchedule", function () {
    it("should create a vesting schedule", async function () {
      const startTime = await time.latest();

      await expect(
        tokenVesting.createVestingSchedule(
          beneficiary.address,
          TOTAL_AMOUNT,
          startTime,
          CLIFF_DURATION,
          VESTING_DURATION,
          true
        )
      ).to.emit(tokenVesting, "VestingScheduleCreated");

      const schedule = await tokenVesting.getVestingSchedule(0);
      expect(schedule.beneficiary).to.equal(beneficiary.address);
      expect(schedule.totalAmount).to.equal(TOTAL_AMOUNT);
    });

    it("should revert with zero beneficiary", async function () {
      const startTime = await time.latest();

      await expect(
        tokenVesting.createVestingSchedule(
          ethers.ZeroAddress,
          TOTAL_AMOUNT,
          startTime,
          CLIFF_DURATION,
          VESTING_DURATION,
          true
        )
      ).to.be.revertedWithCustomError(tokenVesting, "InvalidBeneficiary");
    });
  });

  describe("claim", function () {
    it("should not allow claiming before cliff", async function () {
      const startTime = await time.latest();

      await tokenVesting.createVestingSchedule(
        beneficiary.address,
        TOTAL_AMOUNT,
        startTime,
        CLIFF_DURATION,
        VESTING_DURATION,
        true
      );

      await expect(
        tokenVesting.connect(beneficiary).claim(0)
      ).to.be.revertedWithCustomError(tokenVesting, "NothingToClaim");
    });

    it("should allow claiming after cliff", async function () {
      const startTime = await time.latest();

      await tokenVesting.createVestingSchedule(
        beneficiary.address,
        TOTAL_AMOUNT,
        startTime,
        CLIFF_DURATION,
        VESTING_DURATION,
        true
      );

      // Move past cliff
      await time.increase(CLIFF_DURATION + 1);

      await expect(tokenVesting.connect(beneficiary).claim(0))
        .to.emit(tokenVesting, "TokensClaimed");
    });

    it("should vest linearly after cliff", async function () {
      const startTime = await time.latest();

      await tokenVesting.createVestingSchedule(
        beneficiary.address,
        TOTAL_AMOUNT,
        startTime,
        CLIFF_DURATION,
        VESTING_DURATION,
        true
      );

      // Move to 50% through vesting
      await time.increase(VESTING_DURATION / 2);

      const claimable = await tokenVesting.getClaimableAmount(0);
      const expected = TOTAL_AMOUNT / 2n;

      // Allow 1% tolerance for timing
      expect(claimable).to.be.closeTo(expected, expected / 100n);
    });
  });

  describe("revokeVesting", function () {
    it("should revoke and return unvested tokens", async function () {
      const startTime = await time.latest();

      await tokenVesting.createVestingSchedule(
        beneficiary.address,
        TOTAL_AMOUNT,
        startTime,
        CLIFF_DURATION,
        VESTING_DURATION,
        true // revocable
      );

      const ownerBalanceBefore = await vestingToken.balanceOf(owner.address);

      await expect(tokenVesting.revokeVesting(0))
        .to.emit(tokenVesting, "VestingRevoked");

      const ownerBalanceAfter = await vestingToken.balanceOf(owner.address);
      expect(ownerBalanceAfter).to.be.gt(ownerBalanceBefore);
    });

    it("should not allow revoking non-revocable schedules", async function () {
      const startTime = await time.latest();

      await tokenVesting.createVestingSchedule(
        beneficiary.address,
        TOTAL_AMOUNT,
        startTime,
        CLIFF_DURATION,
        VESTING_DURATION,
        false // not revocable
      );

      await expect(tokenVesting.revokeVesting(0))
        .to.be.revertedWithCustomError(tokenVesting, "NotRevocable");
    });
  });
});
```

---

## Navigation Integration

Add navigation link to the header in `packages/nextjs/components/Header.tsx`:

```typescript
// Add to menuLinks array
{
  label: "Vesting",
  href: "/vesting",
  icon: <ClockIcon className="h-4 w-4" />
},
```

---

## Gas Considerations

1. **Event-based discovery**: Using events instead of on-chain arrays saves significant gas on schedule creation
2. **Batch operations**: Consider adding batch claim functionality if users have many schedules
3. **View functions**: All calculation functions are view-only, costing no gas
4. **SafeERC20**: Minimal overhead for security benefits

---

## Security Considerations

1. **ReentrancyGuard**: Applied to claim function to prevent reentrancy attacks
2. **SafeERC20**: All token transfers use SafeERC20 for compatibility
3. **Access Control**: Ownable pattern for admin functions
4. **Custom Errors**: Gas-efficient error handling with descriptive errors
5. **Input Validation**: All inputs validated before state changes
6. **Immutable Token**: Token address is immutable, preventing token swap attacks

---

## Future Enhancements (Out of Scope)

1. Multiple token support per vesting contract
2. Transferable vesting schedules
3. Batch schedule creation
4. Governance integration for revocation decisions
5. Vesting schedule templates
