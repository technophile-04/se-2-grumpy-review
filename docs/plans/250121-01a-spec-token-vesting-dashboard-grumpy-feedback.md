# Token Vesting Dashboard - Grumpy Code Review

**Reviewer**: Carlos (Grumpy but Caring Senior Reviewer)
**Date**: 2026-01-21
**Spec Version**: v1a

---

## Overall Assessment

Look, this is actually a pretty solid spec. The bones are good - you've got the right idea with event-based discovery, custom errors, and using SE-2 patterns properly. But there are some things that bug me. The smart contract has a couple of gas inefficiencies and one subtle security footgun. The frontend code is mostly clean but has some unnecessary complexity and a few places where we're fighting TypeScript instead of embracing it. Let's go through this properly.

---

## Critical Issues

These need to be fixed before this ships. Not negotiable.

### 1. Smart Contract: Missing `startTime` Validation - Potential Footgun

```solidity
function createVestingSchedule(
    address _beneficiary,
    uint256 _totalAmount,
    uint64 _startTime,  // <- No validation!
    ...
)
```

**Problem**: There's no validation that `_startTime` is reasonable. An admin could accidentally set a start time in the past (meaning tokens vest instantly) or far in the future (confusing beneficiaries). Worse, if `_startTime` is 0, the vesting essentially starts from Unix epoch.

**Fix**:
```solidity
error InvalidStartTime();

// In createVestingSchedule:
if (_startTime < block.timestamp) revert InvalidStartTime();
// Or if you want to allow "start now":
uint64 actualStartTime = _startTime == 0 ? uint64(block.timestamp) : _startTime;
if (actualStartTime < block.timestamp) revert InvalidStartTime();
```

This could be a security issue if an admin fat-fingers a timestamp. Tokens could vest immediately and be claimed before anyone notices.

### 2. Smart Contract: Revoking After Full Vest Should Be Prevented

```solidity
function revokeVesting(uint256 _scheduleId) external onlyOwner {
    // ... checks ...
    uint256 vestedAmount = _calculateVestedAmount(schedule);
    uint256 unvestedAmount = schedule.totalAmount - vestedAmount;
    // ... proceeds even if unvestedAmount is 0 ...
}
```

**Problem**: If the schedule is fully vested, `revokeVesting` still succeeds but does nothing meaningful. The schedule gets marked as revoked, `totalVestingAmount` gets decremented by 0, and the event is emitted with `unvestedAmount = 0`. This is confusing behavior and wastes gas.

**Fix**:
```solidity
error NothingToRevoke();

// In revokeVesting, after calculating unvestedAmount:
if (unvestedAmount == 0) revert NothingToRevoke();
```

### 3. Frontend: CreateVestingForm Has a Race Condition

```typescript
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
```

**Problem**: The `vestingContractAddress` is fetched from reading the `token()` function, but that returns the TOKEN address, not the vesting contract address. You need the vesting contract's address for the approval.

**Current code**:
```typescript
const { data: vestingContractAddress } = useScaffoldReadContract({
  contractName: "TokenVesting",
  functionName: "token",  // Returns the TOKEN address, not vesting contract!
});
```

This is broken. The approval should be to the TokenVesting contract's address, not the token's address.

**Fix**: Use `useDeployedContractInfo` to get the vesting contract address:
```typescript
import { useDeployedContractInfo } from "~~/hooks/scaffold-eth";

const { data: vestingContractInfo } = useDeployedContractInfo("TokenVesting");
const vestingContractAddress = vestingContractInfo?.address;

// Then approve to vestingContractAddress
```

This is a showstopper bug. The current spec won't work.

---

## Improvements Needed

These aren't blockers, but they should be addressed. This is the difference between "works" and "works well."

### 4. Smart Contract: `scheduleCount` Should Be `uint64` or Renamed

```solidity
uint256 public scheduleCount;
```

Not sure why this is `uint256`. The vesting struct uses `uint64` for timestamps to pack storage efficiently, which is good. But `scheduleCount` as `uint256` means each schedule ID is a full 256-bit value. For consistency and to signal intent, either:
- Make it `uint64` (you're never creating 2^64 schedules)
- Or keep it but add a comment explaining the choice

Not a big deal, but it's a bit inconsistent.

### 5. Smart Contract: Consider Using `block.timestamp` as Default Start Time

The current design requires the frontend to calculate and pass `startTime`. This is a bit cumbersome and creates the validation issue mentioned above. I think we should consider:

```solidity
function createVestingSchedule(
    address _beneficiary,
    uint256 _totalAmount,
    uint64 _cliffDuration,
    uint64 _vestingDuration,
    bool _revocable
) external onlyOwner returns (uint256 scheduleId) {
    // Use block.timestamp as start time
    uint64 startTime = uint64(block.timestamp);
    // ...
}
```

This is simpler, less error-prone, and covers 99% of use cases. If you need deferred vesting, you could add a separate function `createVestingScheduleWithStartTime()`.

Can we keep this simple?

### 6. Smart Contract: Redundant Storage Read in `claim()`

```solidity
function claim(uint256 _scheduleId) external nonReentrant {
    VestingSchedule storage schedule = schedules[_scheduleId];

    if (schedule.beneficiary == address(0)) revert ScheduleNotFound();
    if (schedule.beneficiary != msg.sender) revert NotBeneficiary();
    // ...
}
```

You're reading `schedule.beneficiary` twice. In Solidity, storage reads are expensive. I think we should cache it:

```solidity
function claim(uint256 _scheduleId) external nonReentrant {
    VestingSchedule storage schedule = schedules[_scheduleId];
    address beneficiary = schedule.beneficiary;

    if (beneficiary == address(0)) revert ScheduleNotFound();
    if (beneficiary != msg.sender) revert NotBeneficiary();
    // ...
}
```

Small optimization but it adds up. Good stuff otherwise.

### 7. Frontend: VestingProgressBar Uses `Date.now()` Without Syncing

```typescript
const now = BigInt(Math.floor(Date.now() / 1000));
```

**Problem**: This uses client time, which may differ from blockchain time. For vesting calculations that need precision, this could show misleading progress. The contract uses `block.timestamp`, so we should try to stay close to that.

**Fix**: Either:
1. Accept the discrepancy and document it (acceptable for UI purposes)
2. Use `useBlock()` from wagmi to get the latest block timestamp

For a dashboard, option 1 is probably fine, but add a comment:
```typescript
// Note: Uses client time for UI updates. May differ slightly from on-chain calculations.
const now = BigInt(Math.floor(Date.now() / 1000));
```

### 8. Frontend: VestingScheduleCard Props Are Verbose

```typescript
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
```

This is a lot of props. The component is basically just receiving a flattened `VestingSchedule` struct plus computed values. I think we should define a proper type and use object spread:

```typescript
type VestingSchedule = {
  beneficiary: string;
  totalAmount: bigint;
  releasedAmount: bigint;
  startTime: bigint;
  cliffDuration: bigint;
  vestingDuration: bigint;
  revocable: boolean;
  revoked: boolean;
};

type VestingScheduleCardProps = {
  scheduleId: bigint;
  schedule: VestingSchedule;
  claimableAmount: bigint;
  vestedAmount: bigint;
};

// Usage:
<VestingScheduleCard
  scheduleId={scheduleId}
  schedule={schedule}
  claimableAmount={claimableAmount ?? 0n}
  vestedAmount={vestedAmount ?? 0n}
/>
```

This also makes it clearer what's contract data vs. computed data. What do you think?

### 9. Frontend: Missing Error Handling UI

```typescript
const handleClaim = async () => {
  try {
    await writeContractAsync({
      functionName: "claim",
      args: [scheduleId],
    });
  } catch (error) {
    console.error("Claim failed:", error);  // This is a bit hacky
  }
};
```

`console.error` is fine for debugging but users won't see it. SE-2 has toast notifications built in. I think we should use them:

```typescript
import { notification } from "~~/utils/scaffold-eth";

const handleClaim = async () => {
  try {
    await writeContractAsync({
      functionName: "claim",
      args: [scheduleId],
    });
    notification.success("Tokens claimed successfully!");
  } catch (error: any) {
    notification.error(error?.shortMessage || "Failed to claim tokens");
  }
};
```

Same applies to `CreateVestingForm` and the revoke handler.

### 10. Frontend: Admin Page Missing Loading State for Owner Check

```typescript
const { data: owner } = useScaffoldReadContract({
  contractName: "TokenVesting",
  functionName: "owner",
});

// ...

const isOwner = owner && address && owner.toLowerCase() === address.toLowerCase();

if (!isOwner) {
  return (
    <div>Access Denied</div>
  );
}
```

**Problem**: If `owner` is still loading (undefined), `isOwner` will be false and the user sees "Access Denied" briefly before the actual content loads. This is jarring.

**Fix**: Add loading state:
```typescript
const { data: owner, isLoading: ownerLoading } = useScaffoldReadContract({
  contractName: "TokenVesting",
  functionName: "owner",
});

if (!address) {
  return <ConnectWalletMessage />;
}

if (ownerLoading) {
  return <LoadingSpinner />;
}

if (!isOwner) {
  return <AccessDenied owner={owner} />;
}
```

### 11. Frontend: Non-null Assertions in Event Mapping

```typescript
{scheduleIds.map((scheduleId) => (
  <VestingScheduleCardWrapper
    key={scheduleId?.toString()}
    scheduleId={scheduleId!}  // <- Non-null assertion
  />
))}
```

Using `!` is a code smell. If `scheduleId` can be undefined, we should handle it:

```typescript
{scheduleIds
  .filter((id): id is bigint => id !== undefined)
  .map((scheduleId) => (
    <VestingScheduleCardWrapper
      key={scheduleId.toString()}
      scheduleId={scheduleId}
    />
  ))
}
```

TypeScript exists for a reason - use it properly.

### 12. Smart Contract: Consider Adding a Pause Mechanism

For a vesting contract that might handle significant value, having an emergency pause mechanism could be valuable:

```solidity
import "@openzeppelin/contracts/utils/Pausable.sol";

contract TokenVesting is Ownable, ReentrancyGuard, Pausable {

    function claim(uint256 _scheduleId) external nonReentrant whenNotPaused {
        // ...
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
```

This is optional but good practice for contracts handling real money. Let's discuss this further.

### 13. Tests: Missing Edge Cases

The tests are good but missing some important cases:

- What happens when claiming from a revoked schedule (should still allow claiming vested portion)?
- Multiple claims from the same schedule
- Claiming exactly at cliff end (boundary condition)
- Creating multiple schedules for the same beneficiary
- Verifying exact vested amounts at specific timestamps

I'd add:
```typescript
it("should allow beneficiary to claim vested tokens from revoked schedule", async function () {
  // Create revocable schedule
  // Move past cliff but not full vest
  // Beneficiary claims some
  // Admin revokes
  // Beneficiary should still be able to claim remaining vested portion
});

it("should handle multiple claims correctly", async function () {
  // Create schedule
  // Move to 25% vested, claim
  // Move to 50% vested, claim
  // Move to 100% vested, claim
  // Verify total claimed equals total amount
});
```

---

## What Works Well

Thanks for these! Good stuff.

### Proper SE-2 Hook Usage
Looks great! You're using `useScaffoldReadContract`, `useScaffoldWriteContract`, and `useScaffoldEventHistory` correctly. No raw wagmi hooks where SE-2 hooks should be used. I love this approach!

### Event-Based Schedule Discovery
Using events with `useScaffoldEventHistory` and filters is exactly right. This is much more gas-efficient than storing arrays on-chain. Good thinking on the `filters: { beneficiary: address }` pattern.

### Custom Errors Over Require Strings
All the errors are custom errors. This is proper modern Solidity - more gas-efficient and cleaner. Good stuff!

### Struct Packing
```solidity
struct VestingSchedule {
    address beneficiary;      // 20 bytes
    uint256 totalAmount;      // 32 bytes (slot 2)
    uint256 releasedAmount;   // 32 bytes (slot 3)
    uint64 startTime;         // 8 bytes
    uint64 cliffDuration;     // 8 bytes
    uint64 vestingDuration;   // 8 bytes   // these 3 pack into slot 4
    bool revocable;           // 1 byte
    bool revoked;             // 1 byte    // these pack with the uint64s
}
```
Using `uint64` for durations allows multiple fields to pack into a single storage slot. Nice gas optimization.

### Immutable Token Reference
```solidity
IERC20 public immutable token;
```
Using `immutable` here saves gas on every token operation since it's embedded in the bytecode rather than read from storage.

### SafeERC20 Usage
Using SafeERC20 for all token transfers is the right call. Some tokens don't return booleans properly, and this handles it.

### CEI Pattern
The claim function follows Checks-Effects-Interactions properly:
1. Checks (schedule exists, caller is beneficiary, amount > 0)
2. Effects (update releasedAmount, update totalVestingAmount)
3. Interactions (safeTransfer)

Thanks for this!

### Component Structure
Single responsibility components - `VestingScheduleCard`, `VestingProgressBar`, `ClaimButton`, `CreateVestingForm` - each doing one thing. This is how it should be.

### Deploy Script Dependencies
```typescript
deployTokenVesting.dependencies = ["VestingToken"];
```
Proper use of hardhat-deploy dependencies. The contracts will deploy in the right order.

---

## Refactored Sections

Here are the fixes for the critical issues in concrete code form.

### Fixed CreateVestingForm.tsx

```typescript
"use client";

import { useState } from "react";
import { parseEther } from "viem";
import {
  useScaffoldWriteContract,
  useDeployedContractInfo
} from "~~/hooks/scaffold-eth";
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

  const { writeContractAsync: createSchedule, isMining: isCreating } =
    useScaffoldWriteContract("TokenVesting");

  const { writeContractAsync: approveTokens, isMining: isApproving } =
    useScaffoldWriteContract("VestingToken");

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
    const startTime = BigInt(Math.floor(Date.now() / 1000));
    const cliff = BigInt(cliffSeconds || "0");
    const duration = BigInt(durationSeconds);

    try {
      // Approve tokens to the vesting contract (not the token!)
      await approveTokens({
        functionName: "approve",
        args: [vestingContractInfo.address, amountWei],
      });

      await createSchedule({
        functionName: "createVestingSchedule",
        args: [beneficiary, amountWei, startTime, cliff, duration, revocable],
      });

      setFormState(INITIAL_FORM_STATE);
      notification.success("Vesting schedule created successfully!");
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      notification.error(`Failed to create vesting schedule: ${errorMessage}`);
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
            onChange={(value) => updateField("beneficiary", value)}
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
            onChange={(e) => updateField("amount", e.target.value)}
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
              onChange={(e) => updateField("cliffSeconds", e.target.value)}
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
              onChange={(e) => updateField("durationSeconds", e.target.value)}
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
              onChange={(e) => updateField("revocable", e.target.checked)}
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

### Fixed TokenVesting.sol (Critical Sections)

```solidity
// Add these errors
error InvalidStartTime();
error NothingToRevoke();

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

    // Validate start time - must be now or in the future
    if (_startTime < uint64(block.timestamp)) revert InvalidStartTime();

    // ... rest of function
}

function revokeVesting(uint256 _scheduleId) external onlyOwner {
    VestingSchedule storage schedule = schedules[_scheduleId];
    address beneficiary = schedule.beneficiary;  // Cache to avoid double read

    if (beneficiary == address(0)) revert ScheduleNotFound();
    if (!schedule.revocable) revert NotRevocable();
    if (schedule.revoked) revert AlreadyRevoked();

    uint256 vestedAmount = _calculateVestedAmount(schedule);
    uint256 unvestedAmount = schedule.totalAmount - vestedAmount;

    // Don't allow pointless revocations
    if (unvestedAmount == 0) revert NothingToRevoke();

    schedule.revoked = true;
    schedule.totalAmount = vestedAmount;
    totalVestingAmount -= unvestedAmount;

    token.safeTransfer(owner(), unvestedAmount);

    emit VestingRevoked(_scheduleId, beneficiary, unvestedAmount);
}

function claim(uint256 _scheduleId) external nonReentrant {
    VestingSchedule storage schedule = schedules[_scheduleId];
    address beneficiary = schedule.beneficiary;  // Cache storage read

    if (beneficiary == address(0)) revert ScheduleNotFound();
    if (beneficiary != msg.sender) revert NotBeneficiary();

    uint256 claimableAmount = _calculateClaimableAmount(schedule);
    if (claimableAmount == 0) revert NothingToClaim();

    schedule.releasedAmount += claimableAmount;
    totalVestingAmount -= claimableAmount;

    token.safeTransfer(msg.sender, claimableAmount);

    emit TokensClaimed(_scheduleId, msg.sender, claimableAmount);
}
```

---

## Summary

| Category | Count |
|----------|-------|
| Critical Issues | 3 |
| Improvements | 10 |
| Things Done Well | 10 |

**Bottom Line**: This is a solid spec with good fundamentals. Fix the three critical issues (especially the broken approval address bug), address the improvements for polish, and this will be production-ready. The SE-2 patterns are used correctly, the contract structure is sound, and the frontend architecture makes sense.

The biggest concern is the `CreateVestingForm` bug where approvals go to the wrong address - that's a showstopper that would make the app non-functional. Fix that first.

Good stuff overall. Let's discuss the optional Pausable addition when you have time.

---

*Review by Carlos - "High standards aren't about being difficult - they're about building something we can all be proud of."*
