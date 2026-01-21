# Grumpy Carlos Code Review Agent - Test Repository

This repo is set up to test the **Scaffold-ETH 2 AI Development Workflow** with multiple subagents working together:

1. **`/architecture` command** - Creates a detailed spec through iterative refinement
2. **Docs Fetcher subagent** - Fetches relevant documentation from external sources
3. **Grumpy Carlos subagent** - Reviews specs and code with exacting standards

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

Run the `/architecture` command with this prompt to test the full workflow:

```
/architecture Build a Token Vesting Dashboard for team token distribution. This dApp allows admins to create vesting schedules for team members, advisors, and investors. Beneficiaries can track their vesting progress and claim tokens as they vest.

Core Features:
- Admin can create vesting schedules with: beneficiary address, token amount, cliff period (months), total vesting duration (months), and optional revocability
- Linear vesting after cliff period ends
- Beneficiaries see a dashboard with their vesting schedules, progress visualization, and claim button
- Admin can revoke unvested tokens from revocable schedules
- Support for multiple vesting schedules per beneficiary
- Real-time updates showing claimable amount

Smart Contract Requirements:
- Custom ERC20 token for vesting (or use existing)
- Vesting contract that holds tokens and manages schedules
- Events for schedule creation, claims, and revocations
- View functions for calculating vested/claimable amounts

Frontend Requirements:
- Admin page: Create vesting schedules form with validation
- Beneficiary dashboard: List of schedules with progress bars
- Claim interface with transaction feedback
- Use SE-2 hooks (useScaffoldReadContract, useScaffoldWriteContract)
- Proper loading and error states
```


## How This Works

```
┌─────────────────────────────────────────────────────────────────┐
│                    /architecture <prompt>                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  1. Clarify Requirements                                         │
│     - Asks 3+ clarifying questions                              │
│     - Appends clarifications to requirements                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. Fetch Documentation (Docs Fetcher Subagent)                  │
│     - Fetches Wagmi, Hardhat, SE-2 docs as needed               │
│     - Summarizes relevant patterns and APIs                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. Create First Spec Iteration                                  │
│     - Writes /docs/plans/YYMMDD-XXa-spec-headline.md            │
│     - Covers contracts, components, hooks, deployment            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. Grumpy Carlos Review (First Pass)                            │
│     - Reviews spec for over-engineering, security, SE-2 patterns│
│     - Writes feedback to /docs/plans/...-grumpy-feedback.md     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  5. Create Second Spec Iteration                                 │
│     - Applies Carlos's feedback                                  │
│     - Writes /docs/plans/YYMMDD-XXb-spec-headline.md            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  6. Grumpy Carlos Review (Second Pass)                           │
│     - Another round of review                                    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  7. Create Final Spec                                            │
│     - Writes /docs/plans/YYMMDD-XXc-spec-headline.md            │
│     - PAUSES for user approval                                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                      [User Approves]
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  8. Build the Feature                                            │
│     - Implements contracts in packages/hardhat/contracts/        │
│     - Creates deploy scripts in packages/hardhat/deploy/         │
│     - Builds frontend in packages/nextjs/                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  9. Grumpy Carlos Code Review                                    │
│     - Reviews final implementation                               │
│     - Ensures code matches spec and meets standards              │
└─────────────────────────────────────────────────────────────────┘
```
