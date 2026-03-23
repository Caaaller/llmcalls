/**
 * STT Test Case definitions.
 * Each case maps a prerecorded audio file to expected transcription phrases.
 *
 * Primary source: fixtures/recordings/manifest.json
 * Recordings without manifest entries are included with no expected phrases
 * (they verify Twilio returns *some* speech, but don't assert content).
 */

import * as fs from 'fs';
import * as path from 'path';

export interface SttTestCase {
  id: string;
  name: string;
  audioFile: string;
  expectedPhrases: Array<string>;
  expectedText?: string;
  minTokenOverlap?: number;
  maxPollSeconds?: number;
}

interface ManifestEntry {
  audioFile: string;
  name: string;
  expectedPhrases: Array<string>;
  expectedText?: string;
  minTokenOverlap?: number;
  maxPollSeconds?: number;
}

interface Manifest {
  cases: Array<ManifestEntry>;
}

function loadManifest(recordingsDir: string): Map<string, ManifestEntry> {
  const manifestPath = path.join(recordingsDir, 'manifest.json');
  const map = new Map<string, ManifestEntry>();

  if (!fs.existsSync(manifestPath)) return map;

  const manifest: Manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

  for (const entry of manifest.cases) {
    map.set(entry.audioFile, entry);
  }

  return map;
}

/**
 * Build test cases from manifest + available recordings.
 * Manifest entries are authoritative; unmatched recordings get basic smoke cases.
 */
export function buildSttTestCasesFromFixtures(): Array<SttTestCase> {
  const recordingsDir = path.join(__dirname, 'fixtures', 'recordings');

  if (!fs.existsSync(recordingsDir)) return [];

  const recordings: Array<string> = fs
    .readdirSync(recordingsDir)
    .filter((f: string) => f.endsWith('.mp3'));

  if (recordings.length === 0) return [];

  const manifest = loadManifest(recordingsDir);

  // Manifest entries first (these have real assertions)
  const cases: Array<SttTestCase> = [];

  for (const recording of recordings) {
    const entry = manifest.get(recording);

    if (entry) {
      cases.push({
        id: `stt-${recording.replace('.mp3', '')}`,
        name: entry.name,
        audioFile: recording,
        expectedPhrases: entry.expectedPhrases,
        expectedText: entry.expectedText,
        minTokenOverlap: entry.minTokenOverlap ?? 0.3,
        maxPollSeconds: entry.maxPollSeconds,
      });
    }
  }

  // If no manifest entries matched, include all recordings as smoke tests
  if (cases.length === 0) {
    for (const recording of recordings) {
      const baseName = recording.replace('.mp3', '');
      cases.push({
        id: `stt-${baseName.slice(-8)}`,
        name: `STT: ${baseName.slice(-12)}`,
        audioFile: recording,
        expectedPhrases: [],
        minTokenOverlap: 0.3,
      });
    }
  }

  return cases;
}
