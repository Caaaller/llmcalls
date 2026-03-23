/**
 * STT Model Comparison Test
 *
 * Plays recordings through Twilio's STT using two different speech models
 * and compares transcription quality against tree fixture ground truth.
 *
 * Models compared:
 *   - phone_call (speechTimeout=auto)
 *   - experimental_conversations (speechTimeout=3)
 *
 * Requires: running server, ngrok, Twilio credentials
 * Run: pnpm --filter backend test:stt-compare
 */

import '../../../jest.setup';
import * as fs from 'fs';
import * as path from 'path';
import OpenAI from 'openai';
import { TEST_IVR_NUMBERS } from '../liveCallTestCases';
import {
  executeSttTest,
  type SttModelConfig,
  type SttTestResult,
} from './sttTestRunner';
import type { SttTestCase } from './sttTestCases';
import { tokenOverlap } from './fuzzyMatch';
import { clearSttResults } from '../../routes/sttTestRoutes';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const RECORDINGS_DIR = path.join(FIXTURES_DIR, 'recordings');
const STT_TEST_NUMBER = TEST_IVR_NUMBERS[1];

const MODELS: Record<string, SttModelConfig> = {
  exp_conv_3s: {
    speechModel: 'experimental_conversations',
    speechTimeout: 3,
  },
  exp_conv_1s: {
    speechModel: 'experimental_conversations',
    speechTimeout: 1,
  },
};

async function transcribeWithWhisper(audioPath: string): Promise<{
  text: string;
  durationSeconds: number;
}> {
  const openai = new OpenAI();
  const startTime = Date.now();
  const transcription = await openai.audio.transcriptions.create({
    file: fs.createReadStream(audioPath),
    model: 'whisper-1',
    language: 'en',
  });
  const durationSeconds = Math.round((Date.now() - startTime) / 1000);
  return { text: transcription.text, durationSeconds };
}

interface ComparisonCase {
  id: string;
  name: string;
  audioFile: string;
  groundTruth?: string;
  treeFixtureId?: string;
}

function extractAllIvrSpeech(node: {
  ivrSpeech?: string;
  children?: Array<{
    child?: { ivrSpeech?: string; children?: Array<unknown> };
  }>;
}): string {
  const speeches: Array<string> = [];

  function walk(n: typeof node): void {
    if (n.ivrSpeech) speeches.push(n.ivrSpeech);
    for (const edge of n.children || []) {
      if (edge.child) walk(edge.child as typeof node);
    }
  }

  walk(node);
  return speeches.join(' ');
}

function loadGroundTruth(treeFixtureId: string): string | undefined {
  const treePath = path.join(FIXTURES_DIR, `${treeFixtureId}.tree.json`);
  if (!fs.existsSync(treePath)) return undefined;

  const tree = JSON.parse(fs.readFileSync(treePath, 'utf-8'));
  return extractAllIvrSpeech(tree.root);
}

function buildComparisonCases(): Array<ComparisonCase> {
  const cases: Array<ComparisonCase> = [];

  // Costco loop IVR — maps to loop-test-720 tree fixture
  if (fs.existsSync(path.join(RECORDINGS_DIR, 'costco-loop-ivr.mp3'))) {
    cases.push({
      id: 'costco-loop',
      name: 'Costco IVR loop (long, menu-heavy)',
      audioFile: 'costco-loop-ivr.mp3',
      treeFixtureId: 'loop-test-720',
    });
  }

  // Short recording from manifest — closed office hours
  if (
    fs.existsSync(
      path.join(RECORDINGS_DIR, 'CA5eb62861ba515ce32c0dc2bf60ca361b.mp3')
    )
  ) {
    cases.push({
      id: 'short-closed',
      name: 'Short recording (closed office hours)',
      audioFile: 'CA5eb62861ba515ce32c0dc2bf60ca361b.mp3',
    });
  }

  // Pick 3 medium-sized recordings for additional comparison data
  const mediumRecordings = [
    'CA7a891f8cd2d7fd7c128a5270a78a8fe3.mp3',
    'CA309a6527efbbd43a84e7433d1176ad67.mp3',
    'CA0ec148987bed029c09553b7c77813b33.mp3',
  ];
  for (const rec of mediumRecordings) {
    if (fs.existsSync(path.join(RECORDINGS_DIR, rec))) {
      const baseName = rec.replace('.mp3', '');
      cases.push({
        id: `mid-${baseName.slice(-8)}`,
        name: `Medium recording (${baseName.slice(-12)})`,
        audioFile: rec,
      });
    }
  }

  return cases;
}

function hasRequiredEnv(): boolean {
  return !!(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_PHONE_NUMBER &&
    (process.env.TWIML_URL || process.env.BASE_URL)
  );
}

interface ModelResult {
  modelName: string;
  speechResult: string;
  confidence: string;
  durationSeconds: number;
  timedOut: boolean;
  overlapVsGroundTruth: number | null;
}

interface ComparisonResult {
  caseId: string;
  caseName: string;
  audioFile: string;
  groundTruthLength: number | null;
  models: Array<ModelResult>;
}

function printComparisonTable(results: Array<ComparisonResult>): void {
  const modelNames = Object.keys(MODELS);

  console.log('\n' + '='.repeat(100));
  console.log('  STT MODEL COMPARISON RESULTS');
  console.log('='.repeat(100));

  for (const r of results) {
    console.log(`\n--- ${r.caseName} (${r.audioFile}) ---`);
    if (r.groundTruthLength !== null) {
      console.log(`  Ground truth: ${r.groundTruthLength} chars`);
    }

    for (const m of r.models) {
      const overlapStr =
        m.overlapVsGroundTruth !== null
          ? `${(m.overlapVsGroundTruth * 100).toFixed(1)}%`
          : 'N/A';
      const speechPreview =
        m.speechResult.length > 120
          ? m.speechResult.slice(0, 120) + '...'
          : m.speechResult;

      console.log(`\n  [${m.modelName}]`);
      console.log(`    Confidence: ${m.confidence}`);
      console.log(`    Duration: ${m.durationSeconds}s`);
      console.log(`    Timed out: ${m.timedOut}`);
      console.log(`    Overlap vs ground truth: ${overlapStr}`);
      console.log(
        `    Speech (${m.speechResult.length} chars): "${speechPreview}"`
      );
    }

    // Determine winner if ground truth exists
    const withOverlap = r.models.filter(m => m.overlapVsGroundTruth !== null);
    if (withOverlap.length >= 2) {
      const sorted = [...withOverlap].sort(
        (a, b) => b.overlapVsGroundTruth! - a.overlapVsGroundTruth!
      );
      const best = sorted[0];
      const second = sorted[1];
      const diff =
        (best.overlapVsGroundTruth! - second.overlapVsGroundTruth!) * 100;
      if (diff < 1) {
        console.log(
          `\n  VERDICT: Tie between ${best.modelName} and ${second.modelName} (within 1%)`
        );
      } else {
        console.log(
          `\n  VERDICT: ${best.modelName} wins (${(best.overlapVsGroundTruth! * 100).toFixed(1)}% vs next best ${second.modelName} at ${(second.overlapVsGroundTruth! * 100).toFixed(1)}%)`
        );
      }
    }
  }

  // Summary table
  console.log('\n' + '='.repeat(100));
  console.log('  SUMMARY');
  console.log('='.repeat(100));
  const allModelNames =
    results.length > 0 ? results[0].models.map(m => m.modelName) : modelNames;
  const tableWidth = 40 + allModelNames.length * 25 + 15;

  console.log(
    '\n' +
      padRight('Recording', 40) +
      allModelNames.map(n => padRight(n, 25)).join('') +
      'Winner'
  );
  console.log('-'.repeat(tableWidth));

  for (const r of results) {
    const label = r.caseName.slice(0, 38);
    const scores = r.models.map(m => {
      if (m.overlapVsGroundTruth !== null) {
        return `${(m.overlapVsGroundTruth * 100).toFixed(1)}%`;
      }
      return `${m.speechResult.length} chars`;
    });

    const withOverlap = r.models.filter(m => m.overlapVsGroundTruth !== null);
    let winner = '-';
    if (withOverlap.length >= 2) {
      const sorted = [...withOverlap].sort(
        (a, b) => b.overlapVsGroundTruth! - a.overlapVsGroundTruth!
      );
      const diff =
        sorted[0].overlapVsGroundTruth! - sorted[1].overlapVsGroundTruth!;
      if (diff < 0.01) winner = 'Tie';
      else winner = sorted[0].modelName;
    }

    console.log(
      padRight(label, 40) + scores.map(s => padRight(s, 25)).join('') + winner
    );
  }

  console.log('');
}

function padRight(str: string, len: number): string {
  return str.length >= len ? str : str + ' '.repeat(len - str.length);
}

// Pre-compute cases and timeout at describe time
const comparisonCases = buildComparisonCases();
const modelCount = Object.keys(MODELS).length;
const testTimeout = Math.max(
  comparisonCases.length * modelCount * 180_000,
  600_000
);

describe('STT model comparison', () => {
  beforeAll(() => {
    if (!hasRequiredEnv()) {
      throw new Error(
        'Missing env vars. Need TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER, TWIML_URL'
      );
    }
    if (!fs.existsSync(RECORDINGS_DIR)) {
      throw new Error(`Recordings directory not found: ${RECORDINGS_DIR}`);
    }
    if (comparisonCases.length === 0) {
      throw new Error('No comparison cases found — check recordings directory');
    }

    clearSttResults();

    console.log(`\nSTT Model Comparison: ${comparisonCases.length} recordings`);
    console.log(`Models: ${Object.keys(MODELS).join(' vs ')}`);
    console.log(`Estimated calls: ${comparisonCases.length * modelCount}`);
    console.log(`Test phone number: ${STT_TEST_NUMBER}\n`);
  });

  it(
    'compares speech models across recordings',
    async () => {
      const results: Array<ComparisonResult> = [];

      for (const tc of comparisonCases) {
        const groundTruth = tc.treeFixtureId
          ? loadGroundTruth(tc.treeFixtureId)
          : tc.groundTruth;

        console.log(`\n=== ${tc.name} ===`);
        if (groundTruth) {
          console.log(
            `  Ground truth: ${groundTruth.length} chars, first 100: "${groundTruth.slice(0, 100)}..."`
          );
        }

        const modelResults: Array<ModelResult> = [];

        for (const [modelName, modelConfig] of Object.entries(MODELS)) {
          console.log(`\n  Running ${modelName}...`);

          const testCase: SttTestCase = {
            id: `${tc.id}-${modelName}`,
            name: `${tc.name} (${modelName})`,
            audioFile: tc.audioFile,
            expectedPhrases: [],
            maxPollSeconds: 180,
          };

          const result: SttTestResult = await executeSttTest(
            testCase,
            STT_TEST_NUMBER,
            modelConfig
          );

          const overlap = groundTruth
            ? tokenOverlap(result.speechResult, groundTruth)
            : null;

          console.log(
            `  ${modelName}: confidence=${result.confidence} ` +
              `duration=${result.durationSeconds}s ` +
              `chars=${result.speechResult.length} ` +
              (overlap !== null ? `overlap=${(overlap * 100).toFixed(1)}%` : '')
          );

          modelResults.push({
            modelName,
            speechResult: result.speechResult,
            confidence: result.confidence,
            durationSeconds: result.durationSeconds,
            timedOut: result.timedOut,
            overlapVsGroundTruth: overlap,
          });

          // Clear results between calls to avoid stale data
          clearSttResults();
        }

        // Run OpenAI Whisper as a third comparison (no Twilio call needed)
        const audioPath = path.join(RECORDINGS_DIR, tc.audioFile);
        console.log(`\n  Running whisper...`);
        const whisperResult = await transcribeWithWhisper(audioPath);
        const whisperOverlap = groundTruth
          ? tokenOverlap(whisperResult.text, groundTruth)
          : null;

        console.log(
          `  whisper: duration=${whisperResult.durationSeconds}s ` +
            `chars=${whisperResult.text.length} ` +
            (whisperOverlap !== null
              ? `overlap=${(whisperOverlap * 100).toFixed(1)}%`
              : '')
        );

        modelResults.push({
          modelName: 'whisper',
          speechResult: whisperResult.text,
          confidence: 'N/A',
          durationSeconds: whisperResult.durationSeconds,
          timedOut: false,
          overlapVsGroundTruth: whisperOverlap,
        });

        results.push({
          caseId: tc.id,
          caseName: tc.name,
          audioFile: tc.audioFile,
          groundTruthLength: groundTruth ? groundTruth.length : null,
          models: modelResults,
        });
      }

      printComparisonTable(results);

      // Always pass — this is a comparison, not an assertion
      expect(results.length).toBeGreaterThan(0);
    },
    testTimeout
  );
});
