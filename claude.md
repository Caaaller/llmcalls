## MANDATORY: Autonomous Execution

Work autonomously — build, test, and fix without asking. Only ask me when genuinely stuck or facing an ambiguous design decision. Run tests yourself and iterate on failures before reporting back.

## MANDATORY: Read Product Context

Before making architectural decisions, READ `product.md` in the project root for product goals and design principles.

## MANDATORY: Import Context-Specific Rules

Before starting relevant tasks, READ the appropriate rule file:

- **Frontend**: ~/.claude/frontend-conventions.md

---

## MANDATORY: Plan Mode for non-trivial changes

Use Plan Mode (EnterPlanMode) for any non-trivial changes. Plans are conversational — no plan files needed.

## MANDATORY: Prefer replay tests over live tests

Always use `test:replay-or-live` instead of `test:live`. It replays from recorded fixtures (free) and only falls back to live Twilio calls when the tree diverges. Only use `test:live:record` when explicitly recording new fixtures.

## MANDATORY: Start server/ngrok automatically for live tests

Before running `test:live`, `test:live:record`, or when `test:replay-or-live` falls back to a live call:

1. Start the dev server (`pnpm --filter backend dev`) in background if not running on port 3000
2. Check ngrok status (`curl -s http://localhost:4040/api/tunnels`). If down, start it with `ngrok http 3000`
3. Update `TWIML_URL` in `.env` if the ngrok URL changed
4. Use `TRANSFER_PHONE_NUMBER=+13033962866` to avoid ringing the user's phone

Do NOT report a blocker about the server/ngrok being down — just start them.

## DRY and duplicated code

THIS IS EXTREMELY IMPORTANT. Avoid repeating code. Create shared functions and utilities. Route handlers can be extracted into functions if they need to be reused for evals or testing.

# Writing Guidelines

When adding new guidelines to this file:

**Style:**

- Keep them SHORT and actionable (1-3 lines preferred)
- Lead with the action/rule, not explanation
- Use imperative voice ("Do X", not "You should do X")
- Only include examples if absolutely necessary for clarity

**Structure:**

- Title: Use "MANDATORY:" prefix only for critical, non-negotiable rules
- Content: State what to do, not why (assume I understand context)
- Format: Use simple sentences, avoid numbered lists unless showing a sequence
- Length: If you need >5 lines, the rule is probably too complex - simplify or split

**Examples of good guidelines:**

- "When modifying test files, MUST run the test and verify it passes before reporting success."
- "Use `Array<TheType>` not `TheType[]`"
- "NEVER add comments unless explicitly asked."

**Examples of bad guidelines:**

- Long explanations of why a rule exists
- Multiple bullet points listing edge cases
- Overly detailed procedures with numbered steps
- Examples showing both good and bad approaches (just state the rule)

**When to add:**

- Recurring mistakes or patterns worth automating
- Critical requirements that override default behavior
- Project-specific conventions that aren't obvious

**When NOT to add:**

- One-off situations or edge cases
- General best practices already covered in Claude's training
- Overly specific implementation details

---

## Avoid Unnecessary Re-exports

**Don't add "backward compatibility" re-exports.** TypeScript will catch breaking changes automatically.

```typescript
// ❌ Don't
import { MenuOption } from '../types/menu';
export type { MenuOption }; // Unnecessary

// ✅ Do
import { MenuOption } from '../types/menu';
// Use directly - TypeScript catches issues
```

## MANDATORY: Use Worktrees for Separate Work Items

Each distinct task or feature MUST be done in its own git worktree to avoid mixing unrelated changes. Before starting a new task:

1. Create a worktree: `git worktree add ../llmcalls-<short-name> -b <branch-name>`
2. Do all work in that worktree directory
3. Commit and push from the worktree
4. Clean up when done: `git worktree remove ../llmcalls-<short-name>`

If you are already in a worktree (check with `git worktree list`), continue working there. Never mix unrelated changes in the same worktree.

## Git Workflow

Before starting work, run `git log --format="%h %ae %s" -20` and review all consecutive commits from the top by the current `git config user.email` author for context.

## MANDATORY: No Fallbacks

NO fallbacks, NO mock data, NO try/catch blocks unless explicitly requested. Report missing data as failure.

## MANDATORY: Never Claim Success Without Full Verification

Be brutally honest. List EXACTLY what you tested vs what you didn't. Partial completion = FAILURE. Report failures FIRST, then successes.

## Function Naming

Name functions as verbs: `dialNumber()` not `dial.number()`.

## Function Parameters

Use object parameters when a function has more than 2 parameters.

# Reminder: Did You Import the Right Rules?

// ✅ Do
interface TransferParams {
response: VoiceResponse;
baseUrl: string;
config: Config;
callSid: string;
message?: string;
}
function transfer({ response, baseUrl, config, callSid, message }: TransferParams) { }

````

## Comments

**Only comment complex code or function parameters. Avoid obvious or celebratory comments.**

```typescript
// ❌ Don't
// req.validatedQuery is already fully typed! 🎉
const { days } = req.validatedQuery;

// ✅ Do
// Complex algorithm: merge overlapping time ranges
const mergedRanges = mergeTimeRanges(ranges);

// ✅ Do (function parameters)
/**
 * Process voice input and return structured results
 * @param context - Voice processing context with speech and state
 */
function processVoiceInput(context: VoiceProcessingContext) { }
````

## MANDATORY: Modular Function Bodies

Extract logic into well-named functions. Keep function bodies declarative and explicit — prefer `doTheThing()` calls over 45 inline lines. Every distinct operation should be its own function.

## MANDATORY: QA Tester and Skeptic After Implementation

After completing any non-trivial implementation, invoke the QA Tester agent (to generate test scenarios from product requirements) and the Code Skeptic agent (to verify claims and surface risks) before reporting success.

## Explain Tests Clearly

When discussing tests, always explain how they work step by step — what input goes in, what the AI does, and what we assert. Don't just say "the loop test fails" — show the exact speech fed at each step and what the AI decided. Use the format: Step 1: speech → AI decision → assertion.

## Question Legacy Decisions

Early development made some questionable choices. Don't assume existing test expectations, prompt workarounds, or architectural patterns are correct — question whether they make sense before building on top of them. If a test expectation seems wrong (e.g., testing that the AI should stop pressing a digit after detecting a loop, when the correct behavior is to keep pressing), fix the test, don't work around it.

## AI-Driven Logic (DTMF, loops, incomplete speech)

- Avoid adding regex/heuristic logic for call behavior (DTMF choice, loop detection, incomplete speech, menu parsing) when an AI or existing service already handles it; route through those shared functions instead.
- Do not introduce new static helpers or duplicated logic for call behavior in tests or services; reuse `speechProcessingService`, `ivrNavigatorService`, and `callHistoryService` where possible.
