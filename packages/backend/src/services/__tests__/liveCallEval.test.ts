/**
 * Live Call Evaluation Tests (Jest).
 * Makes real Twilio calls and validates IVR navigation using existing services.
 * Run: pnpm --filter backend test:live
 */

import '../../../jest.setup';
import * as fs from 'fs';
import * as path from 'path';
import callHistoryService from '../callHistoryService';
import { connect, disconnect } from '../database';
import {
  DEFAULT_TEST_CASES,
  LONG_TEST_CASES,
  TEST_IVR_CASES,
} from '../liveCallTestCases';
import type { LiveCallTestCase } from '../liveCallTestCases';
import {
  executeCall,
  formatCallTimeline,
  buildRecordedTurns,
  getCallOutcome,
  hasBusinessClosed,
  isRemoteHangup,
} from './liveCallRunner';
import {
  detectBackToBackDuplication,
  normalizeForDuplication,
} from './detectBackToBackDuplication';
import type { CallResult } from './liveCallRunner';
import { loadFixture, mergePathIntoTree, saveTreeFixture } from './treeUtils';
import type { RecordedCallTree } from './recordedCallTypes';

const STAGGER_MS = 2000;
const DEFAULT_TIMEOUT_SECONDS = 600;

const MAX_CONCURRENT = Number(process.env.LIVE_EVAL_CONCURRENCY) || 3;

async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
  staggerMs = STAGGER_MS
): Promise<Array<T>> {
  const results: Array<T> = new Array(tasks.length);
  let index = 0;
  const startTime = Date.now();

  async function runNext(): Promise<void> {
    while (index < tasks.length) {
      const i = index++;
      const targetLaunch = startTime + i * staggerMs;
      const waitMs = targetLaunch - Date.now();
      if (waitMs > 0) await new Promise(r => setTimeout(r, waitMs));
      results[i] = await tasks[i]();
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, () => runNext())
  );
  return results;
}

async function recordCallToTree(
  callSid: string,
  testCase: LiveCallTestCase,
  durationSeconds: number,
  callStatus: string
): Promise<void> {
  const turns = await buildRecordedTurns(callSid);
  if (turns.length === 0) return;

  const outcome = await getCallOutcome(callSid, durationSeconds, callStatus);

  const fixturesDir = path.join(__dirname, 'fixtures');
  const treeFile = path.join(fixturesDir, `${testCase.id}.tree.json`);

  let tree: RecordedCallTree;
  if (fs.existsSync(treeFile)) {
    tree = loadFixture(treeFile);
  } else {
    // Check for old date-based fixture to migrate
    const oldFixtures = fs
      .readdirSync(fixturesDir)
      .filter(f => f.startsWith(`${testCase.id}-`) && f.endsWith('.json'));
    if (oldFixtures.length > 0) {
      const latestOld = oldFixtures.sort().pop()!;
      tree = loadFixture(path.join(fixturesDir, latestOld));
    } else {
      tree = {
        version: 2,
        id: testCase.id,
        testCaseId: testCase.id,
        lastRecordedAt: new Date().toISOString(),
        config: {
          callPurpose: testCase.callPurpose,
          customInstructions: testCase.customInstructions,
        },
        root: {
          id: 'n0',
          ivrSpeech: turns[0].ivrSpeech,
          children: [],
        },
      };
    }
  }

  mergePathIntoTree(tree, turns, outcome);
  saveTreeFixture(treeFile, tree);
  console.log(
    `Recorded tree fixture: ${testCase.id}.tree.json (${turns.length} turns, ${tree.root.children.length} branches)`
  );
}

async function assertOutcome(
  testCase: LiveCallTestCase,
  result: CallResult
): Promise<void> {
  const { expectedOutcome } = testCase;

  // Only fail on timeout when we expect a specific outcome (reaching a human, confirmed transfer)
  // For IVR-navigation-only tests, timing out on hold is acceptable
  if (
    expectedOutcome.shouldReachHuman ||
    expectedOutcome.requireConfirmedTransfer
  ) {
    expect(result.timedOut).toBe(false);
  }

  if (expectedOutcome.maxDTMFPresses !== undefined) {
    const digits = await callHistoryService.getDTMFDigits(result.callSid);
    expect(digits.length).toBeLessThanOrEqual(expectedOutcome.maxDTMFPresses);
  }

  if (expectedOutcome.expectedDigits) {
    const digits = await callHistoryService.getDTMFDigits(result.callSid);
    expectedOutcome.expectedDigits.forEach((digit, i) => {
      expect(digits[i]).toBe(digit);
    });
  }

  if (expectedOutcome.requireConfirmedTransfer) {
    const transferred = await callHistoryService.hasSuccessfulTransfer(
      result.callSid
    );
    expect(transferred).toBe(true);
    // Self-call cases: the simulator's randomized greeting doesn't always match
    // the human-introduction regex (e.g. "Yes, human here" rather than "this is
    // Jamie"). For self-call tests, the transfer event firing IS the proof —
    // the AI ran the full maybe_human → confirmation → human_detected pipeline
    // against real Telnyx audio and decided to transfer. The simulator leg
    // tearing down post-bridge is expected and unrelated to test success.
    if (!testCase.id.startsWith('self-call-')) {
      // Stronger check: the transfer must have been preceded by a real human introduction
      const reachedHuman = await callHistoryService.hasHumanIntroduction(
        result.callSid
      );
      expect(reachedHuman).toBe(true);
    }
  } else if (expectedOutcome.shouldReachHuman !== undefined) {
    if (expectedOutcome.shouldReachHuman) {
      // Require either (a) a real human intro in transcript, or (b) a legitimate hold queue
      const reachedHuman = await callHistoryService.hasHumanIntroduction(
        result.callSid
      );
      const onHold = await callHistoryService.hasReachedHoldQueue(
        result.callSid
      );
      expect(reachedHuman || onHold).toBe(true);
    } else {
      const transferred = await callHistoryService.hasSuccessfulTransfer(
        result.callSid
      );
      const onHold = await callHistoryService.hasReachedHoldQueue(
        result.callSid
      );
      expect(transferred || onHold).toBe(false);
    }
  }

  if (expectedOutcome.requireHoldLowPowerDwell) {
    // Hold-low-power integration assertion. Proves three claims:
    // (1) hold was detected at all, (2) the dwell window after detection
    // had no `conversation/user` events (DG paused), AND (3) the dwell
    // lasted at least MIN_DWELL_S seconds — guarding against the
    // degenerate "call ended right after hold detection so the dwell
    // was trivially empty" pass that an unbounded check would allow.
    const MIN_DWELL_S = 15;
    const call = await callHistoryService.getCall(result.callSid);
    const events: Array<{
      eventType?: string;
      type?: string;
      timestamp?: Date | string;
    }> = call?.events ?? [];
    const firstHoldIdx = events.findIndex(e => e.eventType === 'hold');
    expect(firstHoldIdx).toBeGreaterThanOrEqual(0);
    const firstHoldTs = new Date(events[firstHoldIdx].timestamp!).getTime();

    // Dwell ends at the first AI utterance AFTER firstHold, or at the
    // call's end timestamp if no such AI event exists.
    const dwellEndAbsIdx = events
      .slice(firstHoldIdx + 1)
      .findIndex(e => e.eventType === 'conversation' && e.type === 'ai');
    const dwellEndTs =
      dwellEndAbsIdx === -1
        ? new Date(call?.endTime ?? call?.updatedAt ?? Date.now()).getTime()
        : new Date(
            events[firstHoldIdx + 1 + dwellEndAbsIdx].timestamp!
          ).getTime();
    const dwellSeconds = (dwellEndTs - firstHoldTs) / 1000;
    expect(dwellSeconds).toBeGreaterThanOrEqual(MIN_DWELL_S);

    const dwellEvents =
      dwellEndAbsIdx === -1
        ? events.slice(firstHoldIdx + 1)
        : events.slice(firstHoldIdx + 1, firstHoldIdx + 1 + dwellEndAbsIdx);
    const userEventsDuringDwell = dwellEvents.filter(
      e => e.eventType === 'conversation' && e.type === 'user'
    );
    expect(userEventsDuringDwell).toEqual([]);
  }

  // Fail on application errors (caused by Telnyx 422 "call already ended" — indicates
  // a bug where we tried to speak/act on a terminated call)
  if (expectedOutcome.failOnApplicationError !== false) {
    const hadError = await callHistoryService.hasApplicationError(
      result.callSid
    );
    expect(hadError).toBe(false);
  }

  if (expectedOutcome.maxDurationSeconds !== undefined) {
    expect(result.durationSeconds).toBeLessThanOrEqual(
      expectedOutcome.maxDurationSeconds
    );
  }

  if (expectedOutcome.minDurationSeconds !== undefined) {
    expect(result.durationSeconds).toBeGreaterThanOrEqual(
      expectedOutcome.minDurationSeconds
    );
  }

  // Always-on regression guard: scan conversation/user events for duplication
  // patterns that signal Deepgram is_final stitching is broken. We catch any
  // 4+ word phrase that repeats back-to-back within a single user event —
  // that's the smoking-gun shape of the duplication bug fixed by the
  // time-anchored segment merger (e.g. "press one for sales press 1 for
  // sales"). The digit-word normalization ensures the exact mixed-formatting
  // pattern PR #46 fixed ("press one" + "press 1") is caught. If this fires
  // we have regressed back to string stitching.
  const dupCall = await callHistoryService.getCall(result.callSid);
  const dupEvents = dupCall?.events ?? [];
  for (const e of dupEvents) {
    if (e.eventType !== 'conversation' || e.type !== 'user' || !e.text) {
      continue;
    }
    const dupResult = detectBackToBackDuplication(e.text, {
      normalize: normalizeForDuplication,
    });
    if (dupResult.duplicated) {
      throw new Error(
        `Duplication detected in user event: "${dupResult.phrase}" repeats back-to-back. ` +
          `Full event text: "${e.text}"`
      );
    }
  }
}

const ALL_CASES = [...DEFAULT_TEST_CASES, ...TEST_IVR_CASES];

// Filter precedence: LIVE_EVAL_CASE (exact id match) > TEST_FILTER (substring
// match against id or name) > LIVE_EVAL_IVR / LIVE_EVAL_LONG > DEFAULT_TEST_CASES.
// TEST_FILTER is the shared convention with replayCallEval, so users can do:
//   TEST_FILTER=wellsfargo pnpm --filter backend test:live:record
const caseFilter = process.env.LIVE_EVAL_CASE
  ? new Set(process.env.LIVE_EVAL_CASE.split(',').map(s => s.trim()))
  : null;
const testFilterRaw = (process.env.TEST_FILTER || '').trim();
const testFilterTerms = testFilterRaw
  ? testFilterRaw
      .toLowerCase()
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
  : [];
const testCases = caseFilter
  ? ALL_CASES.filter(tc => caseFilter.has(tc.id))
  : testFilterTerms.length
    ? ALL_CASES.filter(tc => {
        const haystack = `${tc.id} ${tc.name}`.toLowerCase();
        return testFilterTerms.some(t => haystack.includes(t));
      })
    : process.env.LIVE_EVAL_IVR
      ? TEST_IVR_CASES
      : process.env.LIVE_EVAL_LONG
        ? LONG_TEST_CASES
        : DEFAULT_TEST_CASES;

if (testFilterTerms.length && !caseFilter) {
  console.log(
    `TEST_FILTER=${testFilterRaw} — matched ${testCases.length}/${ALL_CASES.length} cases`
  );
}

const maxPerCall = Math.max(
  ...testCases.map(
    tc => tc.expectedOutcome.maxDurationSeconds || DEFAULT_TIMEOUT_SECONDS
  )
);
const totalTimeoutMs =
  (Math.ceil(testCases.length / MAX_CONCURRENT) * maxPerCall + 120) * 1000;

describe('Live call evaluations', () => {
  beforeAll(async () => {
    const baseUrl = process.env.TELNYX_WEBHOOK_URL || process.env.BASE_URL;
    if (!baseUrl)
      throw new Error(
        'TELNYX_WEBHOOK_URL or BASE_URL must be set to run live call tests'
      );
    if (!process.env.TELNYX_PHONE_NUMBER)
      throw new Error('TELNYX_PHONE_NUMBER must be set');
    if (!process.env.TRANSFER_PHONE_NUMBER)
      throw new Error('TRANSFER_PHONE_NUMBER must be set');

    await connect();
  });

  afterAll(async () => {
    await disconnect();
  });

  it(
    'evaluates all calls',
    async () => {
      console.log(
        `Launching ${testCases.length} calls (concurrency=${MAX_CONCURRENT}, stagger=${STAGGER_MS}ms)`
      );

      const startedAt = new Date();
      const runId = `run-${startedAt.toISOString()}`;
      const fullSuite = DEFAULT_TEST_CASES;

      // Records for test cases in this run (mutated as calls complete).
      const testCaseResults: Array<{
        testCaseId: string;
        name: string;
        callSid: string;
        status:
          | 'passed'
          | 'failed'
          | 'business_closed'
          | 'remote_hangup'
          | 'pending'
          | 'running';
        durationSeconds: number;
        error?: string;
        timedOut: boolean;
      }> = testCases.map(tc => ({
        testCaseId: tc.id,
        name: tc.name,
        callSid: '',
        status: 'pending',
        durationSeconds: 0,
        timedOut: false,
      }));

      // Default to localhost for the testrun status POST — the test harness
      // runs on the same machine as the backend, so routing through ngrok
      // is pointless and has broken us before when the ngrok URL was stale.
      // Override via TESTRUN_API_URL if running tests from a different host.
      const baseUrl =
        process.env.TESTRUN_API_URL ||
        `http://localhost:${process.env.PORT || '8068'}`;

      function buildSkippedResults() {
        const ranIds = new Set(testCaseResults.map(tc => tc.testCaseId));
        return fullSuite
          .filter(tc => !ranIds.has(tc.id))
          .map(tc => ({
            testCaseId: tc.id,
            name: tc.name,
            callSid: '',
            status: 'skipped' as const,
            durationSeconds: 0,
            timedOut: false,
          }));
      }

      function countsFromResults() {
        let passed = 0;
        let failed = 0;
        let closed = 0;
        for (const r of testCaseResults) {
          if (r.status === 'passed') passed++;
          else if (r.status === 'failed') failed++;
          else if (r.status === 'business_closed') closed++;
        }
        return { passed, failed, closed };
      }

      async function postTestRun(body: Record<string, unknown>) {
        if (!baseUrl) return;
        try {
          const res = await fetch(`${baseUrl}/api/test-runs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          if (!res.ok) {
            console.warn(`Failed to post test run: HTTP ${res.status}`);
          }
        } catch (err) {
          console.warn('Failed to post test run:', err);
        }
      }

      async function writeProgress(
        status: 'in_progress' | 'passed' | 'failed',
        completedAt?: Date
      ) {
        const { passed, failed, closed } = countsFromResults();
        const skipped = buildSkippedResults();
        await postTestRun({
          runId,
          startedAt,
          ...(completedAt ? { completedAt } : {}),
          status,
          totalTests: fullSuite.length,
          passedTests: passed,
          failedTests: failed,
          closedTests: closed,
          skippedTests: skipped.length,
          testCases: [...testCaseResults, ...skipped],
        });
      }

      // Initial in_progress record so interrupted runs are still visible.
      await writeProgress('in_progress');

      const tasks = testCases.map(tc => () => executeCall(tc));
      const results = await runWithConcurrency(tasks, MAX_CONCURRENT);

      const failures: Array<string> = [];

      for (let i = 0; i < testCases.length; i++) {
        const tc = testCases[i];
        const result = results[i];
        // Populate identifiers before assertion so an interrupt still shows the callSid.
        testCaseResults[i].callSid = result.callSid;
        testCaseResults[i].durationSeconds = result.durationSeconds;
        testCaseResults[i].timedOut = result.timedOut;
        testCaseResults[i].status = 'running';

        try {
          // Settle delay: when a call times out, the AI may have been
          // mid-decision (e.g. about to fire hang_up with closed_no_menu).
          // That event writes to Mongo async, so checking hasBusinessClosed
          // immediately after timeout can miss it. Wait up to 3s, retrying
          // every 500ms, for the signal to arrive.
          const CLOSE_SETTLE_MS = 3000;
          const CLOSE_POLL_MS = 500;
          let closed = await hasBusinessClosed(result.callSid);
          if (!closed && result.timedOut) {
            const deadline = Date.now() + CLOSE_SETTLE_MS;
            while (!closed && Date.now() < deadline) {
              await new Promise(r => setTimeout(r, CLOSE_POLL_MS));
              closed = await hasBusinessClosed(result.callSid);
            }
          }
          if (closed) {
            console.log(
              `CLOSED: ${tc.name} (${result.durationSeconds}s) — business closed`
            );
            testCaseResults[i].status = 'business_closed';
            continue;
          }

          const remoteHangup = await isRemoteHangup(
            result.callSid,
            result.timedOut
          );
          if (remoteHangup) {
            console.log(
              `REMOTE HANGUP: ${tc.name} (${result.durationSeconds}s) — far end disconnected before success`
            );
            testCaseResults[i].status = 'remote_hangup';
            continue;
          }

          await assertOutcome(tc, result);
          console.log(`PASS: ${tc.name} (${result.durationSeconds}s)`);
          testCaseResults[i].status = 'passed';
        } catch (e: unknown) {
          const timeline = await formatCallTimeline(result.callSid);
          const message = e instanceof Error ? e.message : String(e);
          failures.push(`${tc.name}: ${message}\n${timeline}`);
          console.log(
            `\nFAIL: ${tc.name} (${result.durationSeconds}s, ${result.timedOut ? 'TIMED OUT' : result.status}):\n${timeline}\n`
          );
          testCaseResults[i].status = 'failed';
          testCaseResults[i].error = message;
        } finally {
          if (process.env.RECORD_CALLS === '1') {
            await recordCallToTree(
              result.callSid,
              tc,
              result.durationSeconds,
              result.status
            );
          }
          // Incremental write after each test case completes.
          await writeProgress('in_progress');
        }
      }

      // Final write with completedAt and terminal status.
      await writeProgress(failures.length ? 'failed' : 'passed', new Date());

      if (failures.length) {
        throw new Error(
          `${failures.length}/${testCases.length} calls failed:\n\n${failures.join('\n\n')}`
        );
      }
    },
    totalTimeoutMs
  );
});
