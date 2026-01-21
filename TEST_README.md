# Grumpy Carlos Code Review Agent - Test Repository

This repo is set up to test the **Grumpy Carlos Code Review Subagent**. The agent automatically reviews TypeScript/React/Next.js code against Carlos's exacting standards for clarity, simplicity, and maintainability.

## How This Works

1. This is a standard Scaffold-ETH 2 repository with the grumpy-carlos agent configured
2. When you ask Claude Code (or Opencode) to implement a feature, it will write the code
3. After writing code, the agent should **automatically invoke** the grumpy-carlos-code-reviewer subagent
4. Carlos will review the code and provide feedback in his characteristic style

## Setup

```bash
# Install dependencies
yarn install

# Start the local chain
yarn chain

# In another terminal, deploy contracts
yarn deploy

# In another terminal, start the frontend
yarn start
```

## Test Prompt

Copy and paste this prompt into Claude Code or Opencode to test the subagent:

---

### The Prompt

```
Build a Token Vesting Dashboard for our Scaffold-ETH 2 app. This dashboard allows admins to create vesting schedules for team members and allows beneficiaries to track and claim their vested tokens.

Requirements:

**Smart Contract (Solidity):**
- Create a `TokenVesting.sol` contract that:
  - Allows admin to create vesting schedules with: beneficiary address, total amount, cliff period, vesting duration, and start time
  - Supports linear vesting after cliff
  - Allows beneficiaries to claim vested tokens
  - Emits events for schedule creation and claims
  - Has a function to calculate currently vested amount
  - Supports revoking unvested tokens (admin only)

**Frontend Components:**
1. `VestingDashboard.tsx` - Main dashboard page showing:
   - For admins: form to create new vesting schedules
   - For beneficiaries: their vesting schedules with progress

2. `VestingScheduleCard.tsx` - A card component showing:
   - Beneficiary address
   - Total tokens, claimed tokens, claimable tokens
   - Visual progress bar of vesting
   - Cliff and end dates
   - Claim button (if claimable amount > 0)

3. `CreateVestingForm.tsx` - Form for admins to create schedules:
   - Input fields for all vesting parameters
   - Validation for inputs
   - Submit transaction handling

4. `useVestingData.ts` - Custom hook to:
   - Fetch all vesting schedules for connected address
   - Calculate real-time vested amounts
   - Handle claim transactions
   - Refresh data after transactions

**Technical Requirements:**
- Use wagmi hooks for contract interactions
- Proper TypeScript types for all components and data
- Handle loading and error states
- Use scaffold-eth components where appropriate (Address, Balance, etc.)
- Follow Next.js App Router conventions

Please implement this feature with production-quality code.
```

---

## What to Observe

When testing, pay attention to:

1. **Does the agent automatically invoke the code reviewer?** After writing code, look for the subagent being called.

2. **Quality of feedback:** Carlos should provide:
   - Overall assessment (blunt and honest)
   - Critical issues that need fixing
   - Specific improvements with code examples
   - Praise for what works well
   - Refactored versions if needed

3. **Carlos's personality:** Look for his characteristic phrases:
   - "This is a bit hacky."
   - "Can we keep this simple?"
   - "Looks great!"
   - "Not sure why this is necessary."
   - "I think we should..."

4. **Does the agent iterate?** After Carlos's review, does the main agent fix the issues and potentially get another review?

## Expected Flow

```
User: [Pastes the prompt above]
     |
     v
Claude/Opencode: Implements the smart contract
     |
     v
[Automatically invokes grumpy-carlos-code-reviewer]
     |
     v
Carlos: Reviews the contract code
     |
     v
Claude/Opencode: Implements frontend components
     |
     v
[Automatically invokes grumpy-carlos-code-reviewer]
     |
     v
Carlos: Reviews the React/TypeScript code
     |
     v
... continues until complete
```

## Agent Configuration

The agent is configured in:
- `.claude/agents/grumpy-carlos-code-reviewer.md` (for Claude Code)
- `.opencode/agents/grumpy-carlos-code-reviewer.md` (for Opencode)

## Feedback

After testing, note:
- Did the subagent get invoked automatically?
- Was the review feedback helpful and in-character?
- Did it catch real code quality issues?
- Was the overall experience smooth?

Share your findings with the team!
