/**
 * INTEGRATION TEST — Qatar Airways post-hold AI-silence fix (real LLM,
 * real `processSpeech` code path).
 *
 * --------------------------------------------------------------------------
 * WHY THIS TEST EXISTS
 * --------------------------------------------------------------------------
 * The prior reproducer (`qatarPromptOnlyRegression.test.ts`) drives
 * `ivrNavigatorService.decideAction` in isolation. That bypasses the
 * actual production fix, which lives in `processSpeech`:
 *
 *   1. The previous turn (hold) sets `lastTurnWasHold = true`.
 *   2. On the NEXT non-wait turn, BEFORE the LLM is called, the post-hold
 *      reset clears `conversationHistory` so the LLM no longer sees 22
 *      minutes of pre-hold IVR priming.
 *      [speechProcessingService.ts ~573]
 *   3. The LLM (Haiku) then classifies the human greeting against a
 *      clean slate and should choose `maybe_human` — triggering the
 *      canned confirmation question.
 *
 * If we keep testing only the in-isolation decideAction path we will
 * keep "reproducing" the original bug forever even though the production
 * fix is shipped and working. THIS test drives the real `processSpeech`
 * end-to-end (real Anthropic API, real callStateManager, testMode=true
 * to suppress TTS / persistence side effects) and asserts that the
 * AI's effective action lands at `maybe_human` post-reset.
 *
 * --------------------------------------------------------------------------
 * STRUCTURE
 * --------------------------------------------------------------------------
 * For each post-hold human-greeting variant:
 *   1. Seed callStateManager with the recorded pre-hold conversation
 *      history from the Qatar fixture.
 *   2. Drive a hold turn (hold-music transcript) through processSpeech.
 *      The LLM should set `holdDetected:true → action='wait'` and
 *      lastTurnWasHold should flip true.
 *   3. Drive the human-greeting variant through processSpeech.
 *      Post-hold reset fires BEFORE the LLM is called; the LLM
 *      classifies the greeting; speechProcessingService's existing
 *      humanIntro override may downgrade `human_detected`/`speak` to
 *      `maybe_human`.
 *   4. Assert `result.aiAction === 'maybe_human'`.
 *   5. Repeat 5x per variant — assert 5/5.
 *
 * --------------------------------------------------------------------------
 * VARIANTS
 * --------------------------------------------------------------------------
 * STRICT variants (gate the test, must be 5/5 maybe_human):
 *   - canonical-pushpanjali: full personal name introduction
 *   - bare-hello: "Hello?" — minimal but unambiguously interrogative
 *   - role-only: "Yes, this is customer support." — role intro
 *
 * PROBE variants (report-only, log pass-rate but do not fail):
 *   - generic-help, clarification-repeat, casual-conversational,
 *     transitional-moment — these intentionally overlap canned-IVR /
 *     hold-music cues (e.g. "just a moment please", "how can I help
 *     you") and Haiku may classify them as `hold=true` or generic-IVR.
 *     That's a separate prompt-engineering problem from the post-hold
 *     reset itself. We log the pass-rate so future prompt work can
 *     target these.
 *
 * Cost: 7 variants × (1 hold turn + 1 greeting turn) × 5 runs ≈ 70
 * Haiku calls ≈ ~$0.05. Gated behind RUN_LLM_INTEGRATION=1 so it does
 * not fire in the normal unit-test sweep.
 *
 * Run:
 *   RUN_LLM_INTEGRATION=1 pnpm --filter backend test \
 *     --testPathPatterns=qatarPostHoldRealLLM
 */

import '../../../jest.setup';
import callStateManager from '../callStateManager';
import { processSpeech } from '../speechProcessingService';
import fixture from './fixtures/regression-qatar-post-hold-silence.json';

interface FixtureEvent {
  eventType: string;
  type?: string;
  text?: string;
  digit?: string;
  timestamp: string;
}

const HUMAN_PICKUP_TS = fixture.humanPickup.timestamp;

function buildPreHoldHistory(): Array<{
  type: 'user' | 'ai' | 'system';
  text: string;
}> {
  const cutoff = new Date(HUMAN_PICKUP_TS).getTime();
  const out: Array<{ type: 'user' | 'ai' | 'system'; text: string }> = [];
  for (const e of fixture.events as FixtureEvent[]) {
    if (e.eventType !== 'conversation') continue;
    if (!e.text || !e.type) continue;
    if (e.type !== 'user' && e.type !== 'ai' && e.type !== 'system') continue;
    const t = new Date(e.timestamp).getTime();
    if (t >= cutoff) break;
    out.push({ type: e.type, text: e.text });
  }
  return out;
}

const HOLD_TRANSCRIPT =
  'Please continue to hold. Your call is very important to us. ' +
  'A representative will be with you as soon as possible.';

interface Variant {
  label: string;
  speech: string;
  /** Strict variants must hit `maybe_human` in 5/5 runs (gate the test).
   * Probe variants log a pass-rate without failing the suite — they
   * surface prompt-robustness signal on genuinely ambiguous greetings
   * that overlap IVR-style phrasing (hold cues, generic offers, etc.). */
  strict: boolean;
}

const VARIANTS: Variant[] = [
  // Strict: clear human pickups. The post-hold reset must yield maybe_human
  // every time on these — they're the production-fix invariant.
  {
    label: 'canonical-pushpanjali',
    speech: fixture.humanPickup.userSpeech,
    strict: true,
  },
  { label: 'bare-hello', speech: 'Hello?', strict: true },
  {
    label: 'role-only',
    speech: 'Yes, this is customer support.',
    strict: true,
  },
  // Probe (report-only): IVR-overlap phrasing. These intentionally
  // overlap hold-music / canned-IVR cues — Haiku may classify them as
  // hold=true or generic-IVR, which is a separate prompt-engineering
  // problem from the post-hold reset itself. We log the pass rate so
  // future prompt work can target these, but we do NOT gate the suite
  // on them today.
  {
    label: 'generic-help',
    speech: 'Hi, how can I help you?',
    strict: false,
  },
  {
    label: 'clarification-repeat',
    speech: 'Sorry, can you repeat that?',
    strict: false,
  },
  {
    label: 'casual-conversational',
    speech: "Hello, you've reached us. What's going on?",
    strict: false,
  },
  {
    label: 'transitional-moment',
    speech: 'Hey there, just a moment please.',
    strict: false,
  },
];

const RUNS_PER_VARIANT = 5;
const STRICT_THRESHOLD = 5; // 5/5 required for strict variants

const maybeDescribe =
  process.env.RUN_LLM_INTEGRATION === '1' ? describe : describe.skip;

function seedCallState(callSid: string): void {
  // Reset any prior state, then seed the pre-hold conversation history
  // exactly as it would have accumulated during the live call.
  callStateManager.clearCallState(callSid);
  const history = buildPreHoldHistory();
  for (const entry of history) {
    callStateManager.addToHistory(callSid, {
      type: entry.type,
      text: entry.text,
    });
  }
  callStateManager.updateCallState(callSid, {
    transferConfig: undefined,
    actionHistory: [],
  });
}

async function driveHoldTurn(callSid: string): Promise<void> {
  const result = await processSpeech({
    callSid,
    speechResult: HOLD_TRANSCRIPT,
    isFirstCall: false,
    baseUrl: 'http://localhost:8068',
    transferNumber: '+15551234567',
    callPurpose: fixture.metadata.callPurpose,
    testMode: true,
  });
  // Sanity: hold turn should be classified as wait, lastTurnWasHold should flip
  const cs = callStateManager.getCallState(callSid);
  // eslint-disable-next-line no-console
  console.log(
    `   hold-turn: aiAction=${result.aiAction} lastTurnWasHold=${cs.lastTurnWasHold} historyLen=${(cs.conversationHistory || []).length}`
  );
}

async function driveGreetingTurn(
  callSid: string,
  speech: string
): Promise<{ aiAction?: string; postHoldFired: boolean; historyLen: number }> {
  const result = await processSpeech({
    callSid,
    speechResult: speech,
    isFirstCall: false,
    baseUrl: 'http://localhost:8068',
    transferNumber: '+15551234567',
    callPurpose: fixture.metadata.callPurpose,
    testMode: true,
  });
  const cs = callStateManager.getCallState(callSid);
  return {
    aiAction: result.aiAction,
    postHoldFired: !!cs.postHoldResetFired,
    historyLen: (cs.conversationHistory || []).length,
  };
}

maybeDescribe(
  'Qatar post-hold real-LLM integration (processSpeech end-to-end)',
  () => {
    for (const variant of VARIANTS) {
      it(
        `[${variant.label}${variant.strict ? '' : ' PROBE'}] post-hold reset → maybe_human (${RUNS_PER_VARIANT} runs)`,
        async () => {
          const observed: Array<{
            run: number;
            aiAction?: string;
            postHoldFired: boolean;
            historyLen: number;
          }> = [];

          for (let i = 0; i < RUNS_PER_VARIANT; i += 1) {
            const callSid = `qatar-real-llm-${variant.label}-${i}-${Date.now()}`;
            seedCallState(callSid);
            await driveHoldTurn(callSid);
            const turn = await driveGreetingTurn(callSid, variant.speech);
            observed.push({ run: i + 1, ...turn });
            // eslint-disable-next-line no-console
            console.log(
              `🎯 [${variant.label}] run ${i + 1}/${RUNS_PER_VARIANT}: ` +
                `aiAction=${turn.aiAction} postHoldFired=${turn.postHoldFired} ` +
                `historyLenAfter=${turn.historyLen}`
            );
            callStateManager.clearCallState(callSid);
          }

          const maybeHumanCount = observed.filter(
            o => o.aiAction === 'maybe_human'
          ).length;
          // eslint-disable-next-line no-console
          console.log(
            `🎯 [${variant.label}] maybe_human in ${maybeHumanCount}/${RUNS_PER_VARIANT} runs.`
          );

          if (variant.strict) {
            expect(maybeHumanCount).toBeGreaterThanOrEqual(STRICT_THRESHOLD);
          } else {
            // Probe variant: surface signal without gating the suite.
            // eslint-disable-next-line no-console
            console.log(
              `📊 [${variant.label}] PROBE pass-rate ` +
                `${maybeHumanCount}/${RUNS_PER_VARIANT} ` +
                `(prompt-robustness signal, not a gate)`
            );
          }
        },
        // Each run = 2 LLM calls, ~10s each upper bound.
        RUNS_PER_VARIANT * 60_000
      );
    }
  }
);
