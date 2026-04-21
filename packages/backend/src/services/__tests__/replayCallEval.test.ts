/**
 * Replay Call Evaluation Tests
 * Replays recorded IVR speech through decideAction() without Twilio.
 * The AI runs live — only IVR input is cached.
 *
 * If the AI makes a different decision than recorded, the test FAILS.
 * This is a strict regression test: same input must produce same output.
 * Divergence means the prompt changed behavior — re-record to verify.
 *
 * Modes:
 *   test:replay         — strict: fail on divergence (default)
 *   test:replay-or-live — try replay, fall back to live call on divergence
 *
 * Run: pnpm --filter backend test:replay
 */

import '../../../jest.setup';
import * as fs from 'fs';
import * as path from 'path';
import ivrNavigatorService from '../ivrNavigatorService';
import { DEFAULT_TEST_CASES, TEST_IVR_CASES } from '../liveCallTestCases';
import type { LiveCallTestCase } from '../liveCallTestCases';
import type { RecordedCallTree, TreeNode, TreeEdge } from './recordedCallTypes';
import { isTerminalOutcome } from './recordedCallTypes';
import { loadFixture, getLatestPath } from './treeUtils';
import {
  executeCall,
  formatCallTimeline,
  buildRecordedTurns,
  getCallOutcome,
  hasTelnyxCreds,
} from './liveCallRunner';
import { mergePathIntoTree, saveTreeFixture } from './treeUtils';
import type { ActionHistoryEntry } from '../../config/prompts';
import type { MenuOption } from '../../types/menu';
import type { TransferConfig } from '../../config/transfer-config';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const ALL_TEST_CASES = [...DEFAULT_TEST_CASES, ...TEST_IVR_CASES];
const TEST_MODE = process.env.TEST_MODE || 'replay';
const MAX_CONCURRENT = Number(process.env.REPLAY_EVAL_CONCURRENCY) || Infinity;

async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit: number
): Promise<Array<T>> {
  const results: Array<T> = new Array(tasks.length);
  let index = 0;

  async function runNext(): Promise<void> {
    while (index < tasks.length) {
      const i = index++;
      results[i] = await tasks[i]();
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, () => runNext())
  );
  return results;
}

function loadTreeFixtures(): Array<{
  tree: RecordedCallTree;
  filePath: string;
}> {
  if (!fs.existsSync(FIXTURES_DIR)) return [];

  const fixtures: Array<{ tree: RecordedCallTree; filePath: string }> = [];
  const files = fs.readdirSync(FIXTURES_DIR).filter(f => f.endsWith('.json'));

  // Group by testCaseId — prefer .tree.json, fall back to date-based
  const seen = new Set<string>();

  for (const f of files) {
    if (!f.endsWith('.tree.json')) continue;
    const filePath = path.join(FIXTURES_DIR, f);
    const tree = loadFixture(filePath);
    seen.add(tree.testCaseId);
    fixtures.push({ tree, filePath });
  }

  for (const f of files) {
    if (f.endsWith('.tree.json')) continue;
    const filePath = path.join(FIXTURES_DIR, f);
    const tree = loadFixture(filePath);
    if (seen.has(tree.testCaseId)) continue;
    seen.add(tree.testCaseId);
    fixtures.push({ tree, filePath });
  }

  return fixtures;
}

function findTestCase(testCaseId: string): LiveCallTestCase | undefined {
  return ALL_TEST_CASES.find(tc => tc.id === testCaseId);
}

function buildConfig(tree: RecordedCallTree): TransferConfig {
  return {
    transferNumber: '',
    userPhone: '',
    userEmail: '',
    callPurpose: tree.config.callPurpose,
    customInstructions: tree.config.customInstructions,
    aiSettings: {
      model: 'gpt-4o-mini',
      maxTokens: 500,
      temperature: 0.3,
    },
  };
}

function findMatchingEdge(
  children: Array<TreeEdge>,
  action: string,
  digit?: string
): TreeEdge | undefined {
  return children.find(edge => {
    if (edge.aiAction.action !== action) return false;
    if (action === 'press_digit') return edge.aiAction.digit === digit;
    return true;
  });
}

async function runLiveFallback(
  testCase: LiveCallTestCase,
  divergenceMsg: string,
  treeFilePath: string,
  tree: RecordedCallTree
): Promise<void> {
  if (!hasTelnyxCreds()) {
    throw new Error(
      `${divergenceMsg}\n\nWould fall back to live call, but Telnyx credentials are missing.`
    );
  }

  console.warn(
    `Replay diverged, falling back to live call for ${testCase.id}:`
  );
  console.warn(divergenceMsg);

  const { connect, disconnect } = await import('../database');
  await connect();

  try {
    const result = await executeCall(testCase);
    const turns = await buildRecordedTurns(result.callSid);
    const outcome = await getCallOutcome(
      result.callSid,
      result.durationSeconds,
      result.status
    );

    if (turns.length > 0) {
      mergePathIntoTree(tree, turns, outcome);
      saveTreeFixture(treeFilePath, tree);
      console.log(
        `Live fallback recorded: ${testCase.id}.tree.json (${turns.length} turns)`
      );
    }

    const timeline = await formatCallTimeline(result.callSid);
    console.log(`Live fallback completed: ${result.status}\n${timeline}`);

    expect(result.timedOut).toBe(false);
  } finally {
    await disconnect();
  }
}

const fixtures = loadTreeFixtures();

interface ReplayResult {
  label: string;
  status: 'passed' | 'failed';
  error?: string;
  turnCount: number;
  callSid?: string;
  durationSeconds?: number;
  testCaseId?: string;
}

async function replayFixture(
  tree: RecordedCallTree,
  filePath: string
): Promise<ReplayResult> {
  const testCase = findTestCase(tree.testCaseId);
  const label = testCase?.name || tree.testCaseId;
  const latestPath = getLatestPath(tree);

  const config = buildConfig(tree);
  const actionHistory: Array<ActionHistoryEntry> = [];
  const previousMenus: Array<Array<MenuOption>> = [];
  let lastPressedDTMF: string | undefined;

  let cursor: TreeNode | null = tree.root;
  let turnNumber = 0;

  while (cursor && cursor.children.length > 0) {
    turnNumber++;

    const result = await ivrNavigatorService.decideAction({
      config,
      conversationHistory: [],
      actionHistory: [...actionHistory],
      currentSpeech: cursor.ivrSpeech,
      previousMenus: [...previousMenus],
      lastPressedDTMF,
      callPurpose: tree.config.callPurpose,
    });

    // Skip wait turns — they're inferred from event gaps, not actual decideAction() output
    const isReplayable = result.action !== 'wait';

    // Find matching edge in the tree
    const matchedEdge: TreeEdge | undefined = isReplayable
      ? findMatchingEdge(cursor.children, result.action, result.digit)
      : cursor.children.find(e => e.aiAction.action === 'wait');

    if (!matchedEdge) {
      if (!isReplayable) {
        const anyEdge =
          cursor.children.find(e => e.isLatestPath) || cursor.children[0];
        if (anyEdge) {
          const expectedAction = anyEdge.aiAction.action;
          const expectedDigit = anyEdge.aiAction.digit;
          const msg = [
            `DIVERGED at turn ${turnNumber}`,
            `  IVR said: "${cursor.ivrSpeech.slice(0, 100)}"`,
            `  Expected: ${expectedAction}${expectedDigit ? ` digit=${expectedDigit}` : ''}`,
            `  Got:      ${result.action}`,
            `  Reason:   ${result.reason}`,
            '',
            'Prompt change altered AI behavior. Re-record with pnpm test:live:record to verify.',
          ].join('\n');

          if (TEST_MODE === 'replay-or-live' && testCase) {
            await runLiveFallback(testCase, msg, filePath, tree);
            return { label, status: 'passed', turnCount: turnNumber };
          }
          return { label, status: 'failed', error: msg, turnCount: turnNumber };
        }
      }

      const knownEdges = cursor.children
        .map(e => {
          const a = e.aiAction;
          return `${a.action}${a.digit ? ` digit=${a.digit}` : ''}`;
        })
        .join(', ');

      const msg = [
        `DIVERGED at turn ${turnNumber} — unknown path`,
        `  IVR said: "${cursor.ivrSpeech.slice(0, 100)}"`,
        `  AI chose: ${result.action}${result.digit ? ` digit=${result.digit}` : ''}`,
        `  Known edges: [${knownEdges}]`,
        `  Reason:   ${result.reason}`,
        '',
        'Prompt change altered AI behavior. Re-record with pnpm test:live:record to verify.',
      ].join('\n');

      if (TEST_MODE === 'replay-or-live' && testCase) {
        await runLiveFallback(testCase, msg, filePath, tree);
        return { label, status: 'passed', turnCount: turnNumber };
      }
      return { label, status: 'failed', error: msg, turnCount: turnNumber };
    }

    if (!matchedEdge.isLatestPath && isReplayable) {
      console.warn(
        `[${label}] Turn ${turnNumber}: took different known path (${result.action}${result.digit ? ` digit=${result.digit}` : ''}) — not the latest recorded path`
      );
    }

    actionHistory.push({
      turnNumber,
      ivrSpeech: cursor.ivrSpeech,
      action: result.action,
      digit: result.digit,
      speech: result.speech,
      reason: result.reason,
    });

    if (result.detected.isIVRMenu && result.detected.menuOptions.length > 0) {
      previousMenus.push(result.detected.menuOptions);
    }

    if (result.action === 'press_digit' && result.digit) {
      lastPressedDTMF = result.digit;
    }

    if (isTerminalOutcome(matchedEdge.child)) {
      cursor = null;
    } else {
      cursor = matchedEdge.child;
    }
  }

  // Validate final outcome against test case expectations
  if (testCase?.expectedOutcome) {
    const { expectedOutcome } = testCase;
    const replayDigits = actionHistory
      .filter(a => a.action === 'press_digit' && a.digit)
      .map(a => a.digit!);

    if (expectedOutcome.expectedDigits) {
      for (let i = 0; i < expectedOutcome.expectedDigits.length; i++) {
        if (replayDigits[i] !== expectedOutcome.expectedDigits[i]) {
          return {
            label,
            status: 'failed',
            error: `Expected digit[${i}]=${expectedOutcome.expectedDigits[i]} but got ${replayDigits[i]}`,
            turnCount: turnNumber,
          };
        }
      }
    }

    if (
      expectedOutcome.maxDTMFPresses !== undefined &&
      replayDigits.length > expectedOutcome.maxDTMFPresses
    ) {
      return {
        label,
        status: 'failed',
        error: `Too many DTMF presses: ${replayDigits.length} > ${expectedOutcome.maxDTMFPresses}`,
        turnCount: turnNumber,
      };
    }
  }

  return { label, status: 'passed', turnCount: latestPath.length };
}

if (fixtures.length === 0) {
  describe('Replay call evaluations', () => {
    it('no fixtures found — run pnpm test:live:record first', () => {
      console.warn(`No fixture files in ${FIXTURES_DIR}`);
    });
  });
} else {
  const maxTurns = Math.max(...fixtures.map(f => getLatestPath(f.tree).length));
  const batches = Number.isFinite(MAX_CONCURRENT)
    ? Math.ceil(fixtures.length / MAX_CONCURRENT)
    : 1;
  const totalTimeoutMs =
    TEST_MODE === 'replay-or-live'
      ? 600_000
      : Math.max(300_000, batches * maxTurns * 15_000);

  describe('Replay call evaluations', () => {
    it(
      'replays all fixtures',
      async () => {
        console.log(
          `Replaying ${fixtures.length} fixtures (concurrency=${MAX_CONCURRENT})`
        );

        const startedAt = new Date();
        const runId = `run-${startedAt.toISOString()}`;
        const baseUrl =
          process.env.BASE_URL ||
          (process.env.TELNYX_WEBHOOK_URL || '').replace(/\/voice\/?$/, '');

        const testCaseResults = fixtures.map(({ tree }) => {
          const testCase = findTestCase(tree.testCaseId);
          return {
            testCaseId: tree.testCaseId,
            name: testCase?.name || tree.testCaseId,
            callSid: '',
            status: 'pending' as
              | 'pending'
              | 'running'
              | 'passed'
              | 'failed'
              | 'business_closed'
              | 'skipped',
            durationSeconds: 0,
            timedOut: false,
            error: undefined as string | undefined,
          };
        });

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
          let passed = 0;
          let failed = 0;
          for (const r of testCaseResults) {
            if (r.status === 'passed') passed++;
            else if (r.status === 'failed') failed++;
          }
          await postTestRun({
            runId,
            startedAt,
            ...(completedAt ? { completedAt } : {}),
            status,
            totalTests: fixtures.length,
            passedTests: passed,
            failedTests: failed,
            closedTests: 0,
            skippedTests: 0,
            testCases: testCaseResults,
          });
        }

        // Initial in_progress record so interrupted runs are still visible.
        await writeProgress('in_progress');

        const tasks = fixtures.map(
          ({ tree, filePath }, i) => async () => {
            testCaseResults[i].status = 'running';
            await writeProgress('in_progress');
            const r = await replayFixture(tree, filePath);
            testCaseResults[i].status = r.status;
            if (r.error) testCaseResults[i].error = r.error;
            await writeProgress('in_progress');
            return r;
          }
        );
        const results = await runWithConcurrency(tasks, MAX_CONCURRENT);

        const failures: Array<string> = [];
        for (const r of results) {
          if (r.status === 'passed') {
            console.log(`PASS: ${r.label} (${r.turnCount} turns)`);
          } else {
            console.log(
              `\nFAIL: ${r.label} (${r.turnCount} turns):\n${r.error}\n`
            );
            failures.push(`${r.label}: ${r.error}`);
          }
        }

        // Final write with completedAt and terminal status.
        await writeProgress(
          failures.length ? 'failed' : 'passed',
          new Date()
        );

        if (failures.length) {
          throw new Error(
            `${failures.length}/${fixtures.length} replays failed:\n\n${failures.join('\n\n')}`
          );
        }
      },
      totalTimeoutMs
    );
  });
}
