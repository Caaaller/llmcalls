/**
 * STT (Speech-to-Text) Evaluation Tests
 *
 * Plays prerecorded audio through Twilio's STT pipeline and verifies
 * the transcription contains expected phrases.
 *
 * Requires: running server, ngrok, Twilio credentials
 * Run: pnpm --filter backend test:stt
 */

import '../../../jest.setup';
import * as fs from 'fs';
import * as path from 'path';
import { TEST_IVR_NUMBERS } from '../liveCallTestCases';
import { executeSttTest } from './sttTestRunner';
import { buildSttTestCasesFromFixtures } from './sttTestCases';
import type { SttTestCase } from './sttTestCases';
import { containsKeyPhrases, tokenOverlap } from './fuzzyMatch';
import { clearSttResults } from '../../routes/sttTestRoutes';

const RECORDINGS_DIR = path.join(__dirname, 'fixtures', 'recordings');

// Use a different Twilio number than TWILIO_PHONE_NUMBER (the from number)
// so we can update its webhook to play audio while calling it from another number.
const STT_TEST_NUMBER = TEST_IVR_NUMBERS[1];

function hasRequiredEnv(): boolean {
  return !!(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_PHONE_NUMBER &&
    (process.env.TWIML_URL || process.env.BASE_URL)
  );
}

function hasRecordings(): boolean {
  if (!fs.existsSync(RECORDINGS_DIR)) return false;
  return fs.readdirSync(RECORDINGS_DIR).some(f => f.endsWith('.mp3'));
}

// Pre-compute timeout based on available recordings
const estimatedCaseCount = (() => {
  if (!fs.existsSync(RECORDINGS_DIR)) return 1;
  return Math.max(
    1,
    fs.readdirSync(RECORDINGS_DIR).filter(f => f.endsWith('.mp3')).length
  );
})();

describe('STT evaluations', () => {
  let testCases: Array<SttTestCase>;

  beforeAll(() => {
    if (!hasRequiredEnv()) {
      throw new Error(
        'Missing env vars. Need TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER, TWIML_URL'
      );
    }

    if (!hasRecordings()) {
      throw new Error(
        'No recordings found. Run: npx ts-node src/scripts/downloadRecordings.ts'
      );
    }

    testCases = buildSttTestCasesFromFixtures();
    if (testCases.length === 0) {
      throw new Error('No STT test cases generated from fixtures');
    }

    clearSttResults();

    console.log(`\nSTT Test Suite: ${testCases.length} cases`);
    console.log(`Test phone number: ${STT_TEST_NUMBER}`);
    console.log(`Recordings dir: ${RECORDINGS_DIR}\n`);
  });

  it(
    'transcribes recorded audio with expected accuracy',
    async () => {
      const results: Array<{
        testCase: SttTestCase;
        speechResult: string;
        confidence: string;
        durationSeconds: number;
        phraseResult: {
          allFound: boolean;
          found: Array<string>;
          missing: Array<string>;
        };
        overlap: number;
        passed: boolean;
      }> = [];

      // Run test cases serially (must update phone webhook between each)
      for (const tc of testCases) {
        console.log(`\n--- ${tc.name} (${tc.audioFile}) ---`);

        const result = await executeSttTest(tc, STT_TEST_NUMBER);

        console.log(`  Duration: ${result.durationSeconds}s`);
        console.log(`  Confidence: ${result.confidence}`);
        console.log(
          `  Speech: "${result.speechResult.slice(0, 200)}${result.speechResult.length > 200 ? '...' : ''}"`
        );

        const phraseResult =
          tc.expectedPhrases.length > 0
            ? containsKeyPhrases(result.speechResult, tc.expectedPhrases)
            : { allFound: true, found: [], missing: [] };

        const overlap = tc.expectedText
          ? tokenOverlap(result.speechResult, tc.expectedText)
          : -1;

        const minOverlap = tc.minTokenOverlap ?? 0.3;
        const phrasesOk = phraseResult.allFound;
        const overlapOk = overlap === -1 || overlap >= minOverlap;
        const hasSpeech = result.speechResult.length > 0;
        const passed = hasSpeech && phrasesOk && overlapOk;

        if (phraseResult.missing.length > 0) {
          console.log(`  Missing phrases: ${phraseResult.missing.join(', ')}`);
        }
        if (overlap >= 0) {
          console.log(
            `  Token overlap: ${(overlap * 100).toFixed(1)}% (min: ${(minOverlap * 100).toFixed(1)}%)`
          );
        }
        console.log(`  Result: ${passed ? 'PASS' : 'FAIL'}`);

        results.push({
          testCase: tc,
          speechResult: result.speechResult,
          confidence: result.confidence,
          durationSeconds: result.durationSeconds,
          phraseResult,
          overlap,
          passed,
        });
      }

      // Summary
      const passCount = results.filter(r => r.passed).length;
      const failCount = results.length - passCount;

      console.log(
        `\n=== STT Results: ${passCount}/${results.length} passed ===`
      );

      if (failCount > 0) {
        const failures = results.filter(r => !r.passed);
        const failMessages = failures.map(f => {
          const lines = [`${f.testCase.name}:`];
          if (!f.speechResult) {
            lines.push('  No speech detected');
          } else {
            if (f.phraseResult.missing.length > 0) {
              lines.push(`  Missing: ${f.phraseResult.missing.join(', ')}`);
            }
            if (
              f.overlap >= 0 &&
              f.overlap < (f.testCase.minTokenOverlap ?? 0.3)
            ) {
              lines.push(`  Overlap too low: ${(f.overlap * 100).toFixed(1)}%`);
            }
          }
          return lines.join('\n');
        });

        throw new Error(
          `${failCount}/${results.length} STT tests failed:\n\n${failMessages.join('\n\n')}`
        );
      }
    },
    estimatedCaseCount * 120_000
  );
});
