/**
 * Replay Call Evaluation Tests
 * Replays recorded IVR speech through decideAction() without Twilio.
 * The AI runs live — only IVR input is cached.
 *
 * If the AI makes a different decision than recorded, the test FAILS.
 * This is a strict regression test: same input must produce same output.
 * Divergence means the prompt changed behavior — re-record to verify.
 *
 * Run: pnpm --filter backend test:replay
 */

import '../../../jest.setup';
import * as fs from 'fs';
import * as path from 'path';
import ivrNavigatorService from '../ivrNavigatorService';
import { DEFAULT_TEST_CASES, TEST_IVR_CASES } from '../liveCallTestCases';
import type { LiveCallTestCase } from '../liveCallTestCases';
import type { RecordedCall } from './recordedCallTypes';
import type { ActionHistoryEntry } from '../../config/prompts';
import type { MenuOption } from '../../types/menu';
import type { TransferConfig } from '../../config/transfer-config';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const ALL_TEST_CASES = [...DEFAULT_TEST_CASES, ...TEST_IVR_CASES];

function loadFixtures(): Array<RecordedCall> {
  if (!fs.existsSync(FIXTURES_DIR)) return [];
  return fs
    .readdirSync(FIXTURES_DIR)
    .filter(f => f.endsWith('.json'))
    .map(
      f =>
        JSON.parse(
          fs.readFileSync(path.join(FIXTURES_DIR, f), 'utf-8')
        ) as RecordedCall
    );
}

function findTestCase(testCaseId: string): LiveCallTestCase | undefined {
  return ALL_TEST_CASES.find(tc => tc.id === testCaseId);
}

function buildConfig(recorded: RecordedCall): TransferConfig {
  return {
    transferNumber: '',
    userPhone: '',
    userEmail: '',
    callPurpose: recorded.config.callPurpose,
    customInstructions: recorded.config.customInstructions,
    aiSettings: { model: 'gpt-5.4', maxTokens: 500, temperature: 0.3 },
  };
}

const fixtures = loadFixtures();

if (fixtures.length === 0) {
  describe('Replay call evaluations', () => {
    it('no fixtures found — run pnpm test:live:record first', () => {
      console.warn(`No fixture files in ${FIXTURES_DIR}`);
    });
  });
} else {
  describe('Replay call evaluations', () => {
    fixtures.forEach(recorded => {
      const testCase = findTestCase(recorded.testCaseId);
      const label = testCase?.name || recorded.testCaseId;

      it(
        `replay: ${label} (${recorded.turns.length} turns)`,
        async () => {
          const config = buildConfig(recorded);
          const actionHistory: Array<ActionHistoryEntry> = [];
          const previousMenus: Array<Array<MenuOption>> = [];
          let lastPressedDTMF: string | undefined;

          for (const turn of recorded.turns) {
            const result = await ivrNavigatorService.decideAction({
              config,
              conversationHistory: [],
              actionHistory: [...actionHistory],
              currentSpeech: turn.ivrSpeech,
              previousMenus: [...previousMenus],
              lastPressedDTMF,
              callPurpose: recorded.config.callPurpose,
            });

            // Strict regression on real AI decisions (press_digit, speak)
            // Skip wait turns — they're inferred from event gaps, not actual decideAction() output
            const expectedAction = turn.aiAction.action;
            const expectedDigit = turn.aiAction.digit;
            const isReplayable = expectedAction !== 'wait';

            if (
              isReplayable &&
              (result.action !== expectedAction ||
                result.digit !== expectedDigit)
            ) {
              const msg = [
                `DIVERGED at turn ${turn.turnNumber}`,
                `  IVR said: "${turn.ivrSpeech.slice(0, 100)}"`,
                `  Expected: ${expectedAction}${expectedDigit ? ` digit=${expectedDigit}` : ''}`,
                `  Got:      ${result.action}${result.digit ? ` digit=${result.digit}` : ''}`,
                `  Reason:   ${result.reason}`,
                '',
                'Prompt change altered AI behavior. Re-record with pnpm test:live:record to verify.',
              ].join('\n');
              throw new Error(msg);
            }

            // Build state from AI's response for next turn
            actionHistory.push({
              turnNumber: turn.turnNumber,
              ivrSpeech: turn.ivrSpeech,
              action: result.action,
              digit: result.digit,
              speech: result.speech,
              reason: result.reason,
            });

            if (
              result.detected.isIVRMenu &&
              result.detected.menuOptions.length > 0
            ) {
              previousMenus.push(result.detected.menuOptions);
            }

            if (result.action === 'press_digit' && result.digit) {
              lastPressedDTMF = result.digit;
            }
          }

          // Validate final outcome against test case expectations
          if (testCase?.expectedOutcome) {
            const { expectedOutcome } = testCase;
            const replayDigits = actionHistory
              .filter(a => a.action === 'press_digit' && a.digit)
              .map(a => a.digit!);

            if (expectedOutcome.expectedDigits) {
              expectedOutcome.expectedDigits.forEach((digit, i) => {
                expect(replayDigits[i]).toBe(digit);
              });
            }

            if (expectedOutcome.maxDTMFPresses !== undefined) {
              expect(replayDigits.length).toBeLessThanOrEqual(
                expectedOutcome.maxDTMFPresses
              );
            }
          }
        },
        Math.max(60_000, recorded.turns.length * 10_000)
      );
    });
  });
}
