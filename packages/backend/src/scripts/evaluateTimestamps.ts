/**
 * Timestamp drift evaluator.
 *
 * For a given call (or set of calls), compares stored event timestamps
 * against the actual position of the same speech in the audio recording
 * (via Deepgram nova-3 word-level timestamps).
 *
 * Read-only / diagnostic — does not modify any call data.
 *
 * Usage:
 *   pnpm --filter backend eval:timestamps --callSid <sid>
 *   pnpm --filter backend eval:timestamps --latest
 *   pnpm --filter backend eval:timestamps --latest --limit 5
 *   pnpm --filter backend eval:timestamps --testrun <runId>
 */

import '../loadEnv';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { connect, disconnect } from '../services/database';
import CallHistory, { ICallHistory, CallEvent } from '../models/CallHistory';
import TestRun from '../models/TestRun';

// nova-3 list price as of 2026-04: $0.0043/min for prerecorded
const DEEPGRAM_COST_PER_MINUTE = 0.0043;
const REPORT_DIR = path.join(
  os.homedir(),
  'Documents/coding/screenshots/llmcalls/timestamp-eval'
);

interface CliArgs {
  callSid?: string;
  latest: boolean;
  testrun?: string;
  limit: number;
}

function parseArgs(): CliArgs {
  const argv = process.argv.slice(2);
  const args: CliArgs = { latest: false, limit: 1 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--callSid') args.callSid = argv[++i];
    else if (a === '--latest') args.latest = true;
    else if (a === '--testrun') args.testrun = argv[++i];
    else if (a === '--limit') args.limit = parseInt(argv[++i] || '1', 10);
  }
  return args;
}

interface DeepgramWord {
  word: string;
  start: number;
  end: number;
  punctuated_word?: string;
}

async function resolveDownloadUrl(recordingUrl: string): Promise<string> {
  if (!recordingUrl.startsWith('telnyx:')) return recordingUrl;
  const apiKey = process.env.TELNYX_API_KEY;
  if (!apiKey) throw new Error('TELNYX_API_KEY missing');
  const recordingId = recordingUrl.replace('telnyx:', '');
  const res = await fetch(
    `https://api.telnyx.com/v2/recordings/${recordingId}`,
    { headers: { Authorization: `Bearer ${apiKey}` } }
  );
  if (!res.ok) {
    throw new Error(
      `Telnyx recording metadata fetch failed: HTTP ${res.status}`
    );
  }
  const body = (await res.json()) as {
    data: { download_urls: { mp3: string; wav?: string } };
  };
  return body.data.download_urls.mp3;
}

async function fetchAudio(downloadUrl: string): Promise<Buffer> {
  const res = await fetch(downloadUrl);
  if (!res.ok) throw new Error(`Audio fetch failed: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

interface DeepgramRestResponse {
  metadata?: { duration?: number };
  results?: {
    channels?: Array<{
      alternatives?: Array<{ words?: DeepgramWord[] }>;
    }>;
  };
}

async function transcribe(
  audio: Buffer
): Promise<{ words: DeepgramWord[]; duration: number }> {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) throw new Error('DEEPGRAM_API_KEY missing');
  // REST prerecorded API — simpler than the v5 SDK wrapper for one-shot use.
  const params = new URLSearchParams({
    model: 'nova-3',
    smart_format: 'true',
    punctuate: 'true',
  });
  const res = await fetch(
    `https://api.deepgram.com/v1/listen?${params.toString()}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Token ${apiKey}`,
        'Content-Type': 'audio/mpeg',
      },
      body: audio,
    }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Deepgram HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as DeepgramRestResponse;
  const words = json.results?.channels?.[0]?.alternatives?.[0]?.words ?? [];
  const duration = json.metadata?.duration ?? 0;
  return { words, duration };
}

function normalizeText(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Find the start time (sec) of the best fuzzy match for `text` within the
 * Deepgram word stream. Sliding window over windows of the text length;
 * score = fraction of text tokens present in window. Returns null if no
 * window scores >= 0.7.
 */
function findAudioOffset(
  text: string,
  words: DeepgramWord[],
  searchStartSec = 0
): number | null {
  const target = normalizeText(text);
  if (target.length === 0 || words.length === 0) return null;

  // Use up to first 10 tokens of target as the matching signature — enough
  // to be unique, short enough that Deepgram word boundaries don't
  // catastrophically tank the score.
  const sig = target.slice(0, Math.min(10, target.length));
  const sigSet = new Set(sig);
  const windowLen = Math.max(sig.length, 5);

  let bestScore = 0;
  let bestStart: number | null = null;

  // Find first word index whose start >= searchStartSec — we still allow
  // matches before this but bias toward later by penalizing earlier matches.
  const startIdx = words.findIndex(w => w.start >= searchStartSec);
  const minIdx = startIdx > 0 ? startIdx : 0;

  for (let i = 0; i + windowLen <= words.length; i++) {
    const window = words.slice(i, i + windowLen);
    let hits = 0;
    for (const w of window) {
      const tok = (w.punctuated_word || w.word)
        .toLowerCase()
        .replace(/[^a-z0-9']/g, '');
      if (sigSet.has(tok)) hits++;
    }
    const score = hits / sig.length;
    // Slight bonus if at/after searchStartSec
    const adjusted = i >= minIdx ? score : score * 0.85;
    if (adjusted > bestScore) {
      bestScore = adjusted;
      bestStart = window[0]!.start;
    }
  }

  return bestScore >= 0.7 ? bestStart : null;
}

interface EventRow {
  index: number;
  type: string;
  text: string;
  storedOffsetSec: number;
  audioOffsetSec: number | null;
  driftSec: number | null;
}

function extractTextEvents(call: ICallHistory): EventRow[] {
  const startMs = new Date(call.startTime).getTime();
  const rows: EventRow[] = [];
  let i = 0;
  for (const ev of call.events as CallEvent[]) {
    const text = ev.text?.trim();
    if (!text) continue;
    const ts = ev.timestamp ? new Date(ev.timestamp).getTime() : NaN;
    if (!isFinite(ts)) continue;
    const storedOffsetSec = (ts - startMs) / 1000;
    const subtype = ev.type ? `${ev.eventType}/${ev.type}` : ev.eventType;
    rows.push({
      index: ++i,
      type: subtype,
      text,
      storedOffsetSec,
      audioOffsetSec: null,
      driftSec: null,
    });
  }
  return rows;
}

function alignRows(rows: EventRow[], words: DeepgramWord[]): void {
  let cursorSec = 0;
  for (const row of rows) {
    const audio = findAudioOffset(row.text, words, cursorSec);
    row.audioOffsetSec = audio;
    if (audio !== null) {
      row.driftSec = audio - row.storedOffsetSec;
      // Advance cursor monotonically — but never go backwards far
      cursorSec = Math.max(cursorSec, audio - 1.0);
    }
  }
}

function pad(s: string, n: number): string {
  if (s.length >= n) return s.slice(0, n - 1) + '…';
  return s + ' '.repeat(n - s.length);
}

function fmtOffset(sec: number | null): string {
  if (sec === null) return '   ??   ';
  const sign = sec >= 0 ? '+' : '';
  return `${sign}${sec.toFixed(2)}s`;
}

function renderTable(rows: EventRow[]): string {
  const header =
    pad('#', 4) +
    pad('type', 22) +
    pad('text', 50) +
    pad('stored', 10) +
    pad('audio', 10) +
    pad('drift', 10) +
    'flag';
  const sep = '-'.repeat(header.length);
  const lines = [header, sep];
  for (const r of rows) {
    const flag =
      r.driftSec === null ? '?' : Math.abs(r.driftSec) > 1 ? '⚠' : '';
    lines.push(
      pad(String(r.index), 4) +
        pad(r.type, 22) +
        pad(`"${r.text}"`, 50) +
        pad(fmtOffset(r.storedOffsetSec), 10) +
        pad(fmtOffset(r.audioOffsetSec), 10) +
        pad(fmtOffset(r.driftSec), 10) +
        flag
    );
  }
  return lines.join('\n');
}

interface Stats {
  matched: number;
  unmatched: number;
  meanAbsDriftSec: number;
  maxAbsDriftSec: number;
  countOver1s: number;
  meanSignedDriftSec: number;
}

function computeStats(rows: EventRow[]): Stats {
  const matched = rows.filter(r => r.driftSec !== null);
  const drifts = matched.map(r => r.driftSec as number);
  const absDrifts = drifts.map(Math.abs);
  return {
    matched: matched.length,
    unmatched: rows.length - matched.length,
    meanAbsDriftSec: matched.length
      ? absDrifts.reduce((a, b) => a + b, 0) / matched.length
      : 0,
    maxAbsDriftSec: matched.length ? Math.max(...absDrifts) : 0,
    countOver1s: absDrifts.filter(d => d > 1).length,
    meanSignedDriftSec: matched.length
      ? drifts.reduce((a, b) => a + b, 0) / matched.length
      : 0,
  };
}

function classify(
  rows: EventRow[],
  stats: Stats,
  audioDuration: number
): string {
  const matched = rows.filter(r => r.driftSec !== null);
  if (matched.length < 3) {
    return 'INCONCLUSIVE: too few matched events to draw a pattern.';
  }

  const drifts = matched.map(r => r.driftSec as number);
  const meanSigned = stats.meanSignedDriftSec;
  const variance =
    drifts.reduce((a, d) => a + (d - meanSigned) ** 2, 0) / drifts.length;
  const std = Math.sqrt(variance);

  // Per-type means
  const byType: Record<string, number[]> = {};
  for (const r of matched) {
    (byType[r.type] ??= []).push(r.driftSec as number);
  }
  const typeMeans = Object.entries(byType).map(([t, arr]) => ({
    type: t,
    mean: arr.reduce((a, b) => a + b, 0) / arr.length,
    n: arr.length,
  }));

  // Monotonic drift growth: regression slope vs index
  const xs = matched.map((_, i) => i);
  const ys = drifts;
  const xMean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const yMean = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i]! - xMean) * (ys[i]! - yMean);
    den += (xs[i]! - xMean) ** 2;
  }
  const slope = den ? num / den : 0;

  const lines: string[] = [];
  lines.push(
    `Mean signed drift: ${meanSigned.toFixed(2)}s, std: ${std.toFixed(2)}s`
  );
  lines.push(`Per-type means:`);
  for (const tm of typeMeans) {
    lines.push(`  - ${tm.type} (n=${tm.n}): ${tm.mean.toFixed(2)}s`);
  }
  lines.push(`Drift slope vs event index: ${slope.toFixed(3)}s/event`);
  lines.push(`Audio duration: ${audioDuration.toFixed(1)}s`);

  // Pattern decisions
  if (std < 0.5 && Math.abs(meanSigned) > 1) {
    lines.push('');
    lines.push(
      `**Hypothesis:** uniform offset of ~${meanSigned.toFixed(1)}s across all events. The recording-start anchor is wrong — events appear ${meanSigned > 0 ? 'earlier' : 'later'} in the audio than ${meanSigned > 0 ? 'logged' : 'logged'}. Likely cause: \`call.startTime\` is captured at a different moment than recording start (e.g. recording begins on call answer, but startTime is set at call.initiated).`
    );
  } else if (Math.abs(slope) > 0.05) {
    lines.push('');
    lines.push(
      `**Hypothesis:** drift grows monotonically (~${slope.toFixed(2)}s per event). Suggests clock drift between Telnyx event clocks and our server clock, OR cumulative timestamp errors compounding through the call.`
    );
  } else if (typeMeans.length >= 2) {
    const sorted = [...typeMeans].sort(
      (a, b) => Math.abs(b.mean) - Math.abs(a.mean)
    );
    const worst = sorted[0]!;
    const best = sorted[sorted.length - 1]!;
    if (Math.abs(worst.mean - best.mean) > 1.5) {
      lines.push('');
      lines.push(
        `**Hypothesis:** drift is type-dependent — \`${worst.type}\` drifts by ${worst.mean.toFixed(2)}s while \`${best.type}\` only ${best.mean.toFixed(2)}s. The wrong timestamp field is being written for one of these event types.`
      );
    } else if (std > 1.5) {
      lines.push('');
      lines.push(
        `**Hypothesis:** drift is scattered (std=${std.toFixed(2)}s) without a consistent pattern. Either (a) text-alignment is misfiring on short/repetitive utterances, or (b) timestamps are being stamped at inconsistent moments (sometimes at speech-start, sometimes at log-write). Investigate alignment quality first.`
      );
    } else {
      lines.push('');
      lines.push(
        `**Hypothesis:** drift is small and roughly uniform (mean ${meanSigned.toFixed(2)}s, std ${std.toFixed(2)}s). Likely within acceptable tolerance for normal STT/event-loop latency; no clear bug.`
      );
    }
  } else {
    lines.push('');
    lines.push(
      '**Hypothesis:** insufficient type diversity to classify further.'
    );
  }

  return lines.join('\n');
}

interface ProcessResult {
  callSid: string;
  reportPath: string;
  stats: Stats;
}

async function processCall(call: ICallHistory): Promise<ProcessResult | null> {
  console.log(`\n=== Processing call ${call.callSid} ===`);
  if (!call.recordingUrl) {
    console.log(`  SKIP: no recordingUrl`);
    return null;
  }

  console.log(`  Resolving download URL...`);
  const downloadUrl = await resolveDownloadUrl(call.recordingUrl);

  console.log(`  Downloading audio...`);
  const audio = await fetchAudio(downloadUrl);
  console.log(`  Audio: ${(audio.length / 1024).toFixed(1)} KB`);

  console.log(`  Transcribing with Deepgram nova-3...`);
  const { words, duration } = await transcribe(audio);
  console.log(
    `  Got ${words.length} words, audio duration ${duration.toFixed(1)}s`
  );

  const rows = extractTextEvents(call);
  console.log(`  Extracted ${rows.length} text-bearing events`);
  alignRows(rows, words);

  const stats = computeStats(rows);
  const table = renderTable(rows);
  const hypothesis = classify(rows, stats, duration);

  const summary = [
    `# Timestamp drift report — ${call.callSid}`,
    ``,
    `- Call started: ${call.startTime.toISOString()}`,
    `- Audio duration: ${duration.toFixed(1)}s`,
    `- Events analyzed: ${rows.length} (matched ${stats.matched}, unmatched ${stats.unmatched})`,
    `- Mean abs drift: ${stats.meanAbsDriftSec.toFixed(2)}s`,
    `- Max abs drift: ${stats.maxAbsDriftSec.toFixed(2)}s`,
    `- Events drifting >1s: ${stats.countOver1s}`,
    ``,
    '## Per-event table',
    '',
    '```',
    table,
    '```',
    '',
    '## Hypothesis',
    '',
    hypothesis,
    '',
  ].join('\n');

  console.log('\n' + table);
  console.log('');
  console.log(
    `mean abs drift: ${stats.meanAbsDriftSec.toFixed(2)}s   max: ${stats.maxAbsDriftSec.toFixed(2)}s   >1s: ${stats.countOver1s}/${stats.matched}`
  );

  if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });
  const reportPath = path.join(REPORT_DIR, `${call.callSid}-drift.md`);
  fs.writeFileSync(reportPath, summary);
  console.log(`\nReport: ${reportPath}`);

  return { callSid: call.callSid, reportPath, stats };
}

async function loadCalls(args: CliArgs): Promise<ICallHistory[]> {
  if (args.callSid) {
    const c = await CallHistory.findOne({ callSid: args.callSid });
    if (!c) throw new Error(`Call ${args.callSid} not found`);
    return [c];
  }
  if (args.testrun) {
    const tr = await TestRun.findOne({ runId: args.testrun }).lean();
    if (!tr) throw new Error(`Test run ${args.testrun} not found`);
    const sids = tr.testCases
      .map(tc => tc.callSid)
      .filter((s): s is string => !!s);
    if (sids.length === 0) throw new Error('Test run has no call SIDs');
    const calls = await CallHistory.find({
      callSid: { $in: sids },
      recordingUrl: { $exists: true, $ne: null },
    });
    return calls;
  }
  if (args.latest) {
    return await CallHistory.find({
      recordingUrl: { $exists: true, $ne: null },
    })
      .sort({ startTime: -1 })
      .limit(args.limit);
  }
  throw new Error(
    'Specify one of: --callSid <sid>, --latest, or --testrun <runId>'
  );
}

async function main(): Promise<void> {
  const args = parseArgs();
  await connect();

  const calls = await loadCalls(args);
  console.log(`Loaded ${calls.length} call(s) for analysis`);

  // Cost estimate. Cap per-call duration at 10 min to avoid stuck-call
  // records with bogus 1000+ min durations skewing the estimate.
  const totalSec = calls.reduce(
    (acc, c) => acc + Math.min(c.duration ?? 120, 600),
    0
  );
  const estCost = (totalSec / 60) * DEEPGRAM_COST_PER_MINUTE;
  console.log(
    `Estimated Deepgram cost: $${estCost.toFixed(4)} (${(totalSec / 60).toFixed(1)} min @ $${DEEPGRAM_COST_PER_MINUTE}/min)`
  );
  if (estCost > 1) {
    console.log(
      `WARNING: estimated cost > $1. Aborting — narrow with --callSid or smaller --limit.`
    );
    await disconnect();
    process.exit(2);
  }

  const results: ProcessResult[] = [];
  for (const c of calls) {
    try {
      const r = await processCall(c);
      if (r) results.push(r);
    } catch (err) {
      console.error(
        `  FAIL ${c.callSid}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  if (results.length > 1) {
    const indexLines = [
      `# Timestamp drift batch — ${new Date().toISOString()}`,
      '',
      `Processed ${results.length} call(s).`,
      '',
      '| Call SID | Mean abs drift | Max | >1s | Report |',
      '|----------|---------------|-----|-----|--------|',
    ];
    for (const r of results) {
      indexLines.push(
        `| ${r.callSid} | ${r.stats.meanAbsDriftSec.toFixed(2)}s | ${r.stats.maxAbsDriftSec.toFixed(2)}s | ${r.stats.countOver1s}/${r.stats.matched} | [report](${path.basename(r.reportPath)}) |`
      );
    }
    const indexPath = path.join(REPORT_DIR, 'index.md');
    fs.writeFileSync(indexPath, indexLines.join('\n') + '\n');
    console.log(`\nBatch index: ${indexPath}`);
  }

  await disconnect();
}

main().catch(err => {
  console.error('Fatal:', err);
  disconnect().finally(() => process.exit(1));
});
