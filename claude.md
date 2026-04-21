## MANDATORY: Verify Fixes by Rerunning Tests

After making any fix to test infrastructure, prompts, or call handling, rerun the affected test(s) and verify the fix worked before reporting success. Don't just commit — prove it.

## MANDATORY: Test Runs Must Finish Within 30 Minutes

No test run should ever take more than 30 minutes. When kicking off any test run (live, replay, or eval), start a 30-minute timer. If the run hasn't completed in that window, IMMEDIATELY interrupt the user with an ALL-CAPS message explaining that the run is still going and why (current progress, what's blocking, likely cause). Never silently wait past 30 minutes — surface the stall.

## MANDATORY: Timetable for Any Process Over 10 Minutes

When any process (test suite, background agent, long-running command) takes more than 10 minutes total, include a NON-GUESSED timetable of where the time actually went when you report completion. Pull real timestamps from logs, MongoDB, Telnyx, or process start/end times — never estimate or guess. Format as a simple table: step | start → end | duration. If a step's timing is unknown, write "unknown" — do NOT fabricate numbers.

## MANDATORY: Never Daemonize Long Tasks — Use run_in_background Only

NEVER launch long-running test suites or commands with `nohup cmd &`, `cmd &`, or `disown`. Those detach the process and Claude's completion notifications never fire, leaving the user waiting in silence while the task already finished or failed. Always use the Bash tool's `run_in_background: true` parameter DIRECTLY on the command (no nohup, no `&`). The only exception: truly fire-and-forget daemons like the dev server — and even then, accept you won't get completion notifications. If you need to know when something finishes, `run_in_background: true` is the only acceptable option.

## MANDATORY: Never Put Long Waits Inside a Claude Agent

Claude background agents have a 600-second (10-minute) inactivity watchdog that kills them if they sit idle waiting for an external process. This has caused repeated silent stalls in this repo (jest test suites, live call monitoring, etc.). Rule:

- Agents are for ACTIVE work: code edits, analysis, orchestration steps that involve frequent tool calls.
- Long-running processes (jest, live call monitoring, CI builds, `pnpm test`, anything that might take >5 min) MUST run via Bash `run_in_background: true` from the MAIN thread — never inside an agent that waits for them.
- When an agent does need to kick off a test, it should launch via `run_in_background`, commit/push any code it's done, then EXIT. The main thread polls for results.
- If an agent stalls: the FIRST action in the main thread is aggressive recovery — check actual process state, read logs, get the real status in under 60 seconds. Do NOT schedule wakeups, do NOT launch replacement agents, do NOT wait.

## MANDATORY: Stall Recovery Is Immediate

When a task-notification arrives with status `failed` and reason "Agent stalled" / "stream watchdog did not recover":

1. Immediately check: did the wrapped process actually complete? (ps, log tail, MongoDB, git log — whatever applies)
2. Report the ACTUAL state to the user in the same turn — not "I'll check later"
3. Continue recovery in the main thread, not by spawning another agent

Never respond to a stalled-agent notification with "still running" or "will check in N minutes". That's the pattern that burns user time.

## MANDATORY: Be Trigger-Happy About Rerunning Live Calls

After ANY change to prompts, IVR navigation, speech processing, endpointing, DTMF logic, or call-handling code, immediately kick off a live test call to validate — don't wait for the user to ask. Default to rerunning. Calls are cheap; stale assumptions are expensive. Use `pnpm --filter backend test:live:record` (NOT `/calls/initiate` — that's for user-initiated calls only).

## MANDATORY: Run /verify-calls After Every Live Test

After ANY live test run (test:live:record or test:replay-or-live), you MUST run `/verify-calls`. This is non-negotiable. The test framework's pass/fail is unreliable — it has repeatedly reported false passes (hold falsely detected, transfers without confirmation, calls ending after 3 turns). The `/verify-calls` skill queries MongoDB for actual transcripts and forces you to verify each call honestly. NEVER report live test results without running this skill first.

## MANDATORY: Use oliverullman@gmail.com for All API Calls

When making API calls to the backend (local or prod), always authenticate as `oliverullman@gmail.com`. Never use `test@test.com` or other test accounts — calls won't appear in the user's history.

## MANDATORY: Status Table on Every Response

Every response must end with a compact status table of active work items. Done items drop off. Format:

| Item      | Next step                                            |
| --------- | ---------------------------------------------------- |
| Feature X | ⏳ Running / 🔲 Not started / ✅ Done — [file](path) |

Include clickable links to any relevant files, URLs, or outputs in the **Next step** column. Never put links in the **Item** column.

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

## MANDATORY: Always manage ngrok and dev server automatically

Never ask the user to start ngrok or the dev server. Always handle it:

1. Start the dev server (`pnpm --filter backend dev`) in background if not running on port 3000
2. Check ngrok (`curl -s http://localhost:4040/api/tunnels`). If down, start with `ngrok http 3000`
3. If ngrok URL changed, update `TELNYX_WEBHOOK_URL` in `.env` AND patch the Telnyx connection:
   ```bash
   curl -X PATCH "https://api.telnyx.com/v2/call_control_applications/2925946576717219034" \
     -H "Authorization: Bearer $TELNYX_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"webhook_event_url": "https://NEW-URL.ngrok-free.app/voice"}'
   ```
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

## MANDATORY: No Worktrees — Work Directly on Branches

Do NOT create git worktrees. Do all work directly in /Users/oliverullman/Documents/coding/llmcalls. Each feature/fix gets its own branch (`git checkout -b <branch>`) but in the same directory. Commit, push, merge, done. Worktrees added overhead without benefit in this project.

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
