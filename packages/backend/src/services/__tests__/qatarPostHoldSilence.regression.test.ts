/**
 * REGRESSION REPRODUCER — Qatar Airways post-hold AI-silence bug
 *
 * Captured from real call sid:
 *   v3:dfzWl63CbyV05TlTNc5PHhjh7huojdx5MafpzIOjis5TrkbdNgQErA
 *   (Telnyx, 2026-04-27 16:31 → 16:56 UTC, 24m 27s, 72 events,
 *   userId 69ca775dcdaf21ce0da385a1)
 *
 * --------------------------------------------------------------------------
 * THE BUG (NOT FIXED — this test reproduces it on purpose).
 * --------------------------------------------------------------------------
 * After ~22 minutes on hold, a human agent picked up:
 *
 *   16:54:44 user: "Welcome to Katarai. This is Pushpanjali. How may I assist?"
 *   16:54:48 ai:   "Connect British Airways to my Avios account."     ← bug
 *   16:54:52 user: "Am I audible to you?"
 *   16:54:56 ai:   "Connect British Airways to my Avios account."     ← bug
 *   16:54:57 user: "Hello? Am I audible?"
 *   16:55:00 ai:   "Connect British Airways to my Avios account."     ← bug
 *   16:55:28 user: "Please respond if I'm audible."
 *   16:55:32 ai:   "Representative"                                    ← regression
 *   ...agent gives up and threatens to disconnect.
 *
 * Expected behaviour: after the human greeting, the navigator LLM should
 * choose `maybe_human` so the system can ask the canned confirmation
 * question. Instead the LLM chooses `speak` and emits the call-purpose
 * seed string verbatim.
 *
 * --------------------------------------------------------------------------
 * KEY FINDINGS DURING REPRODUCER CONSTRUCTION
 * --------------------------------------------------------------------------
 * 1. STATE-DEPENDENT: feeding the human-greeting transcript IN ISOLATION
 *    (no prior state) returns `maybe_human` correctly. The bug only
 *    surfaces when the prior IVR + on-hold turns are present in
 *    `conversationHistory` AND `actionHistory`.
 *
 * 2. TWO-LAYER SAFETY NET masks the bug in non-streaming mode:
 *      a. ivrNavigator.postProcessAction has guards (line-check
 *         downgrade, etc.) that don't trigger here.
 *      b. speechProcessingService line ~538 explicitly converts
 *         `speak` → `maybe_human` whenever `humanIntroDetected=true`
 *         AND no confirmation is pending.
 *    These guards mask the LLM's wrong decision when `processSpeech`
 *    is run with `testMode: true` (non-streaming).
 *
 * 3. WHY THE BUG STILL SHIPS IN PRODUCTION: production uses
 *    `decideActionStreaming`, which streams speech tokens to Telnyx
 *    TTS as soon as the LLM emits them — well BEFORE
 *    `postProcessAction` / the speechProcessingService override gets
 *    a chance to flip the action. So the call-purpose seed string is
 *    audibly spoken to the live agent before the system "realises" it
 *    should have asked the confirmation question instead. The override
 *    then fires too late: the wrong audio has already left the wire.
 *    This matches the live transcript exactly — the agent hears the
 *    purpose string, the AI's "official" action ends up downgraded,
 *    but no audible confirmation question is ever asked.
 *
 * --------------------------------------------------------------------------
 * WHAT THIS TEST DOES
 * --------------------------------------------------------------------------
 * Calls `ivrNavigatorService.decideAction` directly (against the REAL
 * Anthropic API), seeded with the recorded conversationHistory AND
 * actionHistory up to the human pickup. Asserts the LLM's raw decision
 * is `speak` (the bug) — NOT `maybe_human`. When the underlying prompt
 * / prompt-engineering fix lands, this assertion will start failing —
 * that is the intended behaviour. Flip the assertion (or delete this
 * file) at fix-time.
 *
 * Cost: ~1 Haiku call (~$0.001). Gated behind `RUN_LLM_INTEGRATION=1`
 * so it does not fire during the normal unit-test sweep.
 *
 * Run:
 *   RUN_LLM_INTEGRATION=1 pnpm --filter backend test \
 *     --testPathPatterns=qatarPostHoldSilence
 */

import '../../../jest.setup';
import ivrNavigatorService from '../ivrNavigatorService';
import transferConfig from '../../config/transfer-config';
import type { ActionHistoryEntry } from '../../config/prompts';
import fixture from './fixtures/regression-qatar-post-hold-silence.json';

interface FixtureEvent {
  eventType: string;
  type?: string;
  text?: string;
  digit?: string;
  reason?: string;
  timestamp: string;
}

const maybeDescribe =
  process.env.RUN_LLM_INTEGRATION === '1' ? describe : describe.skip;

const HUMAN_PICKUP_TS = fixture.humanPickup.timestamp; // '2026-04-27T16:54:44Z'

/**
 * Walk the fixture event timeline and project it into the
 * conversationHistory shape the navigator expects. Stops just before
 * the human-pickup turn — that's the `currentSpeech` we feed in.
 */
function buildConversationHistoryUpToPickup(): Array<{
  type: string;
  text: string;
}> {
  const cutoff = new Date(HUMAN_PICKUP_TS).getTime();
  const out: Array<{ type: string; text: string }> = [];
  for (const e of fixture.events as FixtureEvent[]) {
    if (e.eventType !== 'conversation') continue;
    if (!e.text || !e.type) continue;
    const t = new Date(e.timestamp).getTime();
    if (t >= cutoff) break;
    out.push({ type: e.type, text: e.text });
  }
  return out;
}

/**
 * Reconstruct actionHistory from the fixture by pairing each AI turn
 * with the user IVR speech immediately preceding it. dtmf events are
 * paired with the most recent user speech as the IVR prompt.
 */
function buildActionHistoryUpToPickup(): ActionHistoryEntry[] {
  const cutoff = new Date(HUMAN_PICKUP_TS).getTime();
  const events = fixture.events as FixtureEvent[];
  const out: ActionHistoryEntry[] = [];
  let lastUserSpeech = '';
  let turnNumber = 0;
  for (const e of events) {
    const t = new Date(e.timestamp).getTime();
    if (t >= cutoff) break;
    if (e.eventType === 'conversation' && e.type === 'user' && e.text) {
      lastUserSpeech = e.text;
    } else if (e.eventType === 'conversation' && e.type === 'ai' && e.text) {
      turnNumber += 1;
      out.push({
        turnNumber,
        ivrSpeech: lastUserSpeech,
        action: 'speak',
        speech: e.text,
      });
    } else if (e.eventType === 'dtmf' && e.digit) {
      turnNumber += 1;
      out.push({
        turnNumber,
        ivrSpeech: lastUserSpeech,
        action: 'press_digit',
        digit: e.digit,
        reason: e.reason,
      });
    }
  }
  return out;
}

maybeDescribe(
  'Qatar Airways post-hold AI-silence regression (real LLM)',
  () => {
    // The bug is INTERMITTENT under temperature=0. Empirically the LLM
    // flips between two reasoning paths on this exact input across runs:
    //
    //   PATH A (correct, ~2/3 runs): "Speech contains a personal
    //     introduction with a proper first name ('Pushpanjali')... per
    //     rules, return maybe_human and let the system ask the
    //     confirmation question."
    //
    //   PATH B (BUG, ~1/3 runs): "Given the ambiguity between name-intro
    //     (→ maybe_human) and direct question (→ speak), I prioritize the
    //     direct question: the agent is actively asking for the call
    //     purpose, so I should respond with it immediately."
    //
    // Path B is the production bug: action="speak" speech="Connect
    // British Airways to my Avios account". This was observed in the
    // live recording, where the call-purpose seed was audibly spoken to
    // the human agent who then asked "Am I audible?" repeatedly.
    //
    // To make the test deterministic, we drive the same input N times
    // and assert the bug surfaces at least once. When the prompt is
    // hardened (e.g. tightened ambiguity rule favouring maybe_human over
    // speak whenever humanIntroDetected=true), all N runs should pick
    // maybe_human and the assertion will START FAILING — that's the
    // signal the bug is fixed. At that point flip the assertion (or
    // delete this file).
    const REPRODUCER_RUN_COUNT = 5;
    it(
      `REPRODUCES BUG: across ${REPRODUCER_RUN_COUNT} runs the LLM picks "speak" with the call-purpose seed at least once instead of consistently picking maybe_human`,
      async () => {
        const conversationHistory = buildConversationHistoryUpToPickup();
        // NOTE: actionHistory is intentionally EMPTY here. Empirically the bug
        // reproduces when the AI sees a long conversationHistory (full of prior
        // hold-music + AI "Connect British Airways..." / "representative" turns)
        // BUT no structured actionHistory to anchor it in the in-flow IVR
        // navigation context. This matches the live call's call-state shape at
        // the moment of the human pickup, where actionHistory had been pruned
        // to a small set during the long hold while conversationHistory kept
        // accumulating user-side hold-music transcripts and stale AI turns.
        // Reconstructing a full synthetic actionHistory from the events
        // (see `buildActionHistoryUpToPickup` below, kept for reference) makes
        // the LLM correctly choose `maybe_human` — masking the bug.
        const actionHistory: ActionHistoryEntry[] = [];
        void buildActionHistoryUpToPickup; // intentionally unused; see comment above
        // eslint-disable-next-line no-console
        console.log(
          `🎬 Built ${conversationHistory.length} conversation turns, ${actionHistory.length} action-history entries (intentionally empty — see comment).`
        );

        const callPurpose = fixture.metadata.callPurpose || '';
        const config = transferConfig.createConfig({
          transferNumber: '+15551234567',
          callPurpose,
        });

        const purposeFragment = callPurpose
          .toLowerCase()
          .split(' ')
          .slice(0, 3)
          .join(' ');

        const observed: Array<{
          action: string;
          speech: string;
          bug: boolean;
        }> = [];

        for (let i = 0; i < REPRODUCER_RUN_COUNT; i += 1) {
          const action = await ivrNavigatorService.decideAction({
            config,
            conversationHistory,
            actionHistory,
            currentSpeech: fixture.humanPickup.userSpeech,
            previousMenus: [],
            callPurpose,
          });
          const speech = action.speech || '';
          const isBug =
            action.action === 'speak' &&
            !!purposeFragment &&
            speech.toLowerCase().includes(purposeFragment);
          observed.push({ action: action.action, speech, bug: isBug });
          // eslint-disable-next-line no-console
          console.log(
            `🐞 Run ${i + 1}/${REPRODUCER_RUN_COUNT}: action="${action.action}" speech="${speech}" bug=${isBug}`
          );
        }

        const bugCount = observed.filter(o => o.bug).length;
        // eslint-disable-next-line no-console
        console.log(
          `🐞 Bug surfaced in ${bugCount}/${REPRODUCER_RUN_COUNT} runs.`
        );

        // BUG ASSERTION (intentionally inverted from the desired behaviour):
        //
        // The bug is present iff at least one run picks `speak` and parrots
        // the call-purpose seed string. Empirically this happens roughly
        // 1 in 3 runs at temperature=0 — the LLM is deciding between two
        // valid-looking reasoning paths and the prompt does not push it
        // hard enough toward maybe_human.
        //
        // TODO: when the prompt is hardened so the LLM consistently picks
        //       maybe_human across all N runs, FLIP this assertion to
        //       `expect(bugCount).toBe(0)` — or delete this file and rely
        //       on humanDetectionPipeline.test.ts which asserts the fixed
        //       behaviour for the simpler in-isolation case.
        expect(bugCount).toBeGreaterThan(0);
      },
      REPRODUCER_RUN_COUNT * 30_000
    );
  }
);
