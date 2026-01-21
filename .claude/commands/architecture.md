# Develop a kickass spec for a new feature / dApp

You will receive a prompt for a new feature or dApp. Use the **Docs Fetcher** and **Grumpy Carlos Code Reviewer** sub-agents to develop a great spec for it.

## Steps

Here is the requirements prompt: $ARGUMENT

### 1. Clarify the requirements

First, evaluate whether the requirements document requires any clarification. If it does, ask the user before proceeding, and append the clarifications to the requirements document in a ## Clarifications section.

Unless the requirements are extremely clear upfront, you should always ask at least 3 clarifying questions - ideally, select the ones which are most likely to reduce ambiguity and result in a great spec, and, later, a great, tight implementation that does what it needs to do and nothing more.

For Scaffold-ETH 2 projects, consider asking about:
- Smart contract requirements (state variables, functions, events, access control)
- UI components needed (using SE-2 hooks like `useScaffoldReadContract`, `useScaffoldWriteContract`)
- Network requirements (which chains to support)
- User interactions (wallet connection, transactions, event listening)

### 2. Fetch documentation

Once you are happy with the basic requirements, decide whether it requires documentation in addition to what is present in the codebase. If it does, use the **Docs Fetcher** sub-agent to fetch the relevant documentation and summarize it.

Key SE-2 documentation sources:
- Scaffold-ETH 2 docs: https://docs.scaffoldeth.io
- Smart contract patterns: `packages/hardhat/contracts/`
- SE-2 hooks: `packages/nextjs/hooks/scaffold-eth/`
- SE-2 components: Check `@scaffold-ui/components` and `@scaffold-ui/hooks`

### 3. First iteration of the spec

Use the **Application Architect** approach to create a first iteration of the spec. Pass it the documentation it needs as well as the requirements.

For SE-2 dApps, the spec should cover:
- **Smart Contract Architecture**: Contract structure, storage, functions, events, modifiers
- **Frontend Components**: React components using SE-2 hooks and components
- **Contract Interactions**: Which SE-2 hooks to use (`useScaffoldReadContract`, `useScaffoldWriteContract`, `useScaffoldEventHistory`)
- **Deployment**: Hardhat deploy scripts in `packages/hardhat/deploy/`

The first iteration should end up in a file named `YYMMDD-XXa-spec-headline.md` in a `/docs/plans/` folder.

So for example, if the requirements are for a "token-staking" feature, the first iteration of the spec should be called `/docs/plans/250121-01a-token-staking.md`.

### 4. Refine the spec

Pass the first iteration of the spec to the **Grumpy Carlos Code Reviewer** sub-agent to refine it. Carlos will review with his exacting standards for:
- Smart contract best practices (gas efficiency, security, clarity)
- TypeScript/React code quality
- Proper use of SE-2 patterns and hooks
- Unnecessary complexity or over-engineering

Require the Grumpy Carlos Reviewer to write all its comments in a file named `YYMMDD-XXa-spec-headline-grumpy-feedback.md` in the `/docs/plans/` folder.

Check whether the Grumpy Carlos Reviewer actually saved its comments in the specified file. If it didn't, save whatever it returned to you in the specified file.

### 5. Second iteration of the spec

Take the first iteration of the spec, the relevant documentation, the requirements and the Grumpy Carlos Reviewer's comments, and create a second iteration of the spec, applying Grumpy's feedback.

The second iteration should focus on:
- Simplifying any over-engineered solutions
- Ensuring proper use of SE-2 conventions
- Removing unnecessary abstractions
- Making the code "Carlos-worthy" - clear, simple, maintainable

The second iteration should be called `YYMMDD-XXb-spec-headline.md` in the `/docs/plans/` folder.

### 6. Refine the spec again

Repeat the Grumpy Carlos review process for the second iteration of the spec.

### 7. Third iteration of the spec

Apply Grumpy's second round of feedback to create the final spec iteration: `YYMMDD-XXc-spec-headline.md`.

### 8. Pause and notify the user that the spec is ready for review

The user will want to review the spec in detail before proceeding to implementation.

In your notification, summarize the key, final components of the spec at a very high level (3 paragraphs max), and also summarize the key changes that were made thanks to Grumpy's suggestions (also 3 paragraphs max). Use paragraphs rather than bullet points.

### 9. Afterwards: build the feature

When building the feature:

**Smart Contracts** (`packages/hardhat/`):
- Write contracts in `packages/hardhat/contracts/`
- Create deploy scripts in `packages/hardhat/deploy/`
- Write tests in `packages/hardhat/test/`
- Run `yarn deploy` to deploy and generate TypeScript ABIs

**Frontend** (`packages/nextjs/`):
- Use SE-2 hooks for contract interaction:
  - `useScaffoldReadContract` for reading contract state
  - `useScaffoldWriteContract` for sending transactions
  - `useScaffoldEventHistory` for reading event logs
- Use SE-2 components: `Address`, `AddressInput`, `Balance`, `EtherInput`
- Create pages in `packages/nextjs/app/`

**Testing**:
- Test smart contracts with Hardhat tests
- Test the frontend by running `yarn start` and checking `http://localhost:3000`
- Use the Debug page (`/debug`) to verify contract interactions

Once they have finished building the feature, please review the code output yourself to ensure it meets Grumpy Carlos's standards and hasn't deviated substantially from the spec without good cause.
