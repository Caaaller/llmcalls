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
} from './liveCallRunner';
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
    // Stronger check: the transfer must have been preceded by a real human introduction
    const reachedHuman = await callHistoryService.hasHumanIntroduction(
      result.callSid
    );
    expect(reachedHuman).toBe(true);
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
}

const ALL_CASES = [...DEFAULT_TEST_CASES, ...TEST_IVR_CASES];
const caseFilter = process.env.LIVE_EVAL_CASE
  ? new Set(process.env.LIVE_EVAL_CASE.split(',').map(s => s.trim()))
  : null;
const testCases = caseFilter
  ? ALL_CASES.filter(tc => caseFilter.has(tc.id))
  : process.env.LIVE_EVAL_IVR
    ? TEST_IVR_CASES
    : process.env.LIVE_EVAL_LONG
      ? LONG_TEST_CASES
      : DEFAULT_TEST_CASES;

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
      const tasks = testCases.map(tc => () => executeCall(tc));
      const results = await runWithConcurrency(tasks, MAX_CONCURRENT);

      const failures: Array<string> = [];
      let closedCount = 0;
      const testCaseResults: Array<{
        testCaseId: string;
        name: string;
        callSid: string;
        status: 'passed' | 'failed' | 'business_closed';
        durationSeconds: number;
        error?: string;
        timedOut: boolean;
      }> = [];

      for (let i = 0; i < testCases.length; i++) {
        const tc = testCases[i];
        const result = results[i];
        try {
          const closed = await hasBusinessClosed(result.callSid);
          if (closed) {
            closedCount++;
            console.log(
              `CLOSED: ${tc.name} (${result.durationSeconds}s) — business closed`
            );
            testCaseResults.push({
              testCaseId: tc.id,
              name: tc.name,
              callSid: result.callSid,
              status: 'business_closed',
              durationSeconds: result.durationSeconds,
              timedOut: result.timedOut,
            });
            continue;
          }

          await assertOutcome(tc, result);
          console.log(`PASS: ${tc.name} (${result.durationSeconds}s)`);
          testCaseResults.push({
            testCaseId: tc.id,
            name: tc.name,
            callSid: result.callSid,
            status: 'passed',
            durationSeconds: result.durationSeconds,
            timedOut: result.timedOut,
          });
        } catch (e: unknown) {
          const timeline = await formatCallTimeline(result.callSid);
          const message = e instanceof Error ? e.message : String(e);
          failures.push(`${tc.name}: ${message}\n${timeline}`);
          console.log(
            `\nFAIL: ${tc.name} (${result.durationSeconds}s, ${result.timedOut ? 'TIMED OUT' : result.status}):\n${timeline}\n`
          );
          testCaseResults.push({
            testCaseId: tc.id,
            name: tc.name,
            callSid: result.callSid,
            status: 'failed',
            durationSeconds: result.durationSeconds,
            error: message,
            timedOut: result.timedOut,
          });
        } finally {
          if (process.env.RECORD_CALLS === '1') {
            await recordCallToTree(
              result.callSid,
              tc,
              result.durationSeconds,
              result.status
            );
          }
        }
      }

      // Add skipped entries for tests that weren't in this run
      const ranIds = new Set(testCaseResults.map(tc => tc.testCaseId));
      const fullSuite = DEFAULT_TEST_CASES;
      const skippedResults = fullSuite
        .filter(tc => !ranIds.has(tc.id))
        .map(tc => ({
          testCaseId: tc.id,
          name: tc.name,
          callSid: '',
          status: 'skipped' as const,
          durationSeconds: 0,
          timedOut: false,
        }));
      const allResults = [...testCaseResults, ...skippedResults];
      const skippedCount = skippedResults.length;

      // Post test run results to the API for the Test Runs UI
      const baseUrl = process.env.TELNYX_WEBHOOK_URL || process.env.BASE_URL;
      if (baseUrl) {
        try {
          const postRes = await fetch(`${baseUrl}/api/test-runs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              runId: `run-${startedAt.toISOString()}`,
              startedAt,
              completedAt: new Date(),
              status: failures.length ? 'failed' : 'passed',
              totalTests: fullSuite.length,
              passedTests: testCases.length - failures.length - closedCount,
              failedTests: failures.length,
              closedTests: closedCount,
              skippedTests: skippedCount,
              testCases: allResults,
            }),
          });
          if (!postRes.ok) {
            console.warn(
              `Failed to post test run results: HTTP ${postRes.status}`
            );
          }
        } catch (postErr) {
          console.warn('Failed to post test run results:', postErr);
        }
      }

      if (failures.length) {
        throw new Error(
          `${failures.length}/${testCases.length} calls failed:\n\n${failures.join('\n\n')}`
        );
      }
    },
    totalTimeoutMs
  );
});
