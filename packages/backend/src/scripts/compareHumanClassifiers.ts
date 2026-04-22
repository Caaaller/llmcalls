/**
 * Classifier Comparison Harness
 *
 * Runs multiple human-vs-IVR classifier variants against the hand-labeled
 * dataset at /data/labeling/turns-labeled.jsonl and reports per-class
 * accuracy, confusion matrices, and individual wrong predictions.
 *
 * Variants:
 *   - baseline: the current production IVR-navigator prompt
 *                (packages/backend/src/services/ivrNavigatorService.ts).
 *                We call decideAction() with awaitingHumanConfirmation=false
 *                (first-hearing context) and map the returned action to one
 *                of HUMAN / IVR / UNCLEAR.
 *   - haiku:    a focused single-purpose prompt against Claude Haiku 4.5
 *                that classifies a single turn as HUMAN / IVR / UNCLEAR.
 *
 * Run:
 *   pnpm --filter backend ts-node src/scripts/compareHumanClassifiers.ts
 *   pnpm --filter backend ts-node src/scripts/compareHumanClassifiers.ts --limit=20
 *   pnpm --filter backend ts-node src/scripts/compareHumanClassifiers.ts --variants=haiku
 *   pnpm --filter backend ts-node src/scripts/compareHumanClassifiers.ts --concurrency=5
 */

import '../loadEnv';
import * as fs from 'fs';
import * as path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import transferConfig from '../config/transfer-config';
import ivrNavigatorService from '../services/ivrNavigatorService';
import type { ActionHistoryEntry } from '../config/prompts';

type ClassLabel = 'HUMAN' | 'IVR' | 'UNCLEAR';
type RawLabel = 'h' | 'i' | 'u' | 's';

interface ContextLine {
  speaker: 'user' | 'ai' | 'system';
  text: string;
}

interface UnlabeledTurn {
  callSid: string;
  turnIndex: number;
  timestamp: string;
  contextBefore: ContextLine[];
  text: string;
  metadata: { to?: string; callPurpose?: string };
}

interface LabelRow {
  callSid: string;
  turnIndex: number;
  label: RawLabel;
  labeledAt: string;
}

interface EvalTurn {
  turn: UnlabeledTurn;
  actual: ClassLabel;
}

interface TurnResult {
  callSid: string;
  turnIndex: number;
  text: string;
  actual: ClassLabel;
  predicted: ClassLabel;
  rawAction?: string;
  correct: boolean;
}

interface VariantSummary {
  name: string;
  overallCorrect: number;
  overallTotal: number;
  perClass: Record<ClassLabel, { correct: number; total: number }>;
  confusion: Record<ClassLabel, Record<ClassLabel, number>>;
}

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const LABELS_FILE = path.join(
  REPO_ROOT,
  'data',
  'labeling',
  'turns-labeled.jsonl'
);
const TURNS_FILE = path.join(
  REPO_ROOT,
  'data',
  'labeling',
  'turns-unlabeled.jsonl'
);
const OUTPUT_FILE = path.join(
  REPO_ROOT,
  'data',
  'labeling',
  'classifier-eval.json'
);

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

function parseArgs(): {
  variants: string[];
  limit: number | null;
  concurrency: number;
} {
  const args = process.argv.slice(2);
  let variants = ['baseline', 'haiku'];
  let limit: number | null = null;
  let concurrency = 5;
  for (const arg of args) {
    if (arg.startsWith('--variants=')) {
      variants = arg
        .slice('--variants='.length)
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
    } else if (arg.startsWith('--limit=')) {
      const v = parseInt(arg.slice('--limit='.length), 10);
      if (!Number.isNaN(v)) limit = v;
    } else if (arg.startsWith('--concurrency=')) {
      const v = parseInt(arg.slice('--concurrency='.length), 10);
      if (!Number.isNaN(v) && v > 0) concurrency = v;
    }
  }
  return { variants, limit, concurrency };
}

function readJsonl<T>(file: string): T[] {
  if (!fs.existsSync(file)) {
    throw new Error(`File not found: ${file}`);
  }
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line) as T);
}

function rawToClass(raw: RawLabel): ClassLabel | null {
  if (raw === 'h') return 'HUMAN';
  if (raw === 'i') return 'IVR';
  if (raw === 'u') return 'UNCLEAR';
  return null; // 's' = skip
}

function loadDataset(limit: number | null): EvalTurn[] {
  const labels = readJsonl<LabelRow>(LABELS_FILE);
  const turns = readJsonl<UnlabeledTurn>(TURNS_FILE);
  const turnMap = new Map<string, UnlabeledTurn>();
  for (const t of turns) {
    turnMap.set(`${t.callSid}|${t.turnIndex}`, t);
  }
  const dataset: EvalTurn[] = [];
  for (const lbl of labels) {
    const cls = rawToClass(lbl.label);
    if (!cls) continue;
    const turn = turnMap.get(`${lbl.callSid}|${lbl.turnIndex}`);
    if (!turn) continue;
    dataset.push({ turn, actual: cls });
  }
  if (limit !== null) return dataset.slice(0, limit);
  return dataset;
}

/**
 * Convert contextBefore (pairs of ai/user lines) into the ActionHistoryEntry
 * shape the baseline IVR navigator expects. Each "turn" in action history is
 * an IVR utterance plus the AI's response. We approximate:
 *   - ai line  → entry.ivrSpeech (no — ai IS us. flipping speakers: user IS ivr)
 *
 * Convention in this codebase: conversation.type === 'user' means the REMOTE
 * phone system spoke; type === 'ai' means our agent spoke. So in the history:
 *   ivrSpeech  <- previous 'user' line
 *   action     <- 'speak', speech <- previous 'ai' line
 *
 * We pair them up sequentially.
 */
function contextToActionHistory(
  contextBefore: ContextLine[]
): ActionHistoryEntry[] {
  const history: ActionHistoryEntry[] = [];
  let pendingIvr: string | null = null;
  let turnNumber = 1;
  for (const line of contextBefore) {
    if (line.speaker === 'user') {
      // flush any pending ivr with a 'wait' action
      if (pendingIvr !== null) {
        history.push({
          turnNumber: turnNumber++,
          ivrSpeech: pendingIvr,
          action: 'wait',
        });
      }
      pendingIvr = line.text;
    } else if (line.speaker === 'ai') {
      history.push({
        turnNumber: turnNumber++,
        ivrSpeech: pendingIvr ?? '',
        action: 'speak',
        speech: line.text,
      });
      pendingIvr = null;
    }
  }
  if (pendingIvr !== null) {
    history.push({
      turnNumber: turnNumber++,
      ivrSpeech: pendingIvr,
      action: 'wait',
    });
  }
  return history;
}

function mapBaselineAction(action: {
  action: string;
  detected?: { humanIntroDetected?: boolean };
}): ClassLabel {
  if (action.action === 'human_detected') return 'HUMAN';
  if (action.action === 'maybe_human') return 'HUMAN';
  if (action.action === 'maybe_human_unclear') return 'UNCLEAR';
  return 'IVR';
}

async function runBaseline(turn: UnlabeledTurn): Promise<{
  predicted: ClassLabel;
  rawAction: string;
}> {
  const config = {
    ...transferConfig.defaults,
    callPurpose:
      turn.metadata.callPurpose || transferConfig.defaults.callPurpose,
  };
  const actionHistory = contextToActionHistory(turn.contextBefore);
  const action = await ivrNavigatorService.decideAction({
    config,
    conversationHistory: [],
    actionHistory,
    currentSpeech: turn.text,
    previousMenus: [],
    callPurpose: config.callPurpose,
    awaitingHumanConfirmation: false,
    awaitingHumanClarification: false,
    skipInfoRequests: true,
    requireLiveAgent: false,
  });
  return { predicted: mapBaselineAction(action), rawAction: action.action };
}

const HAIKU_SYSTEM_PROMPT = `You are a classifier for a phone-call routing system. Given ONE utterance that was just spoken on the call (plus recent context), decide who is speaking: a live HUMAN agent, an automated IVR / recording, or if it's genuinely UNCLEAR.

Output exactly one token: HUMAN, IVR, or UNCLEAR. No other text.

HUMAN — a real live person just picked up or is talking conversationally:
- Proper first-name intro: "My name is Diana", "This is Mike", "You've reached Ron", "Jeremy speaking"
- Role intro spoken conversationally: "This is a live representative, may I have your name"
- Live check-in after silence: "Hello? Caller, can you hear me?", "Are you still there?"
- Natural conversational speech responding to us: "Oh yes. How can I help you?", "Sure, what's your account number?"
- Apologetic or casual speech that breaks IVR scripting: "So I do apologize, I am not able to hear you..."

IVR — automated system, recording, or bot:
- Generic greetings & disclaimers: "Thank you for calling X", "For quality assurance your call may be recorded"
- Menus: "Press 1 for billing, press 2 for support"
- Hold/queue messages: "Please hold", "your call is important to us", "estimated wait time is 5 minutes", "all representatives are busy"
- Privacy policy / legal: "To hear our privacy policy press 2"
- Status/transition scripts: "I understand you want to speak with an agent. Please stay on the line..."
- Data collection prompts: "Enter your account number followed by pound"
- Self-service responses: "I can send you a text link..."

UNCLEAR — genuinely ambiguous, could be either:
- Very short fragments with no identifiable features: "Good afternoon.", "Thank you for calling.", "How can I assist you?"
- Single decontextualized questions that could be scripted OR live: "What's the phone number?", "Repeat that please"
- Mid-sentence cutoffs: "There's no chart with that particular", "For account access,"
- STT garble with no clear signal
- When both HUMAN and IVR are plausible at similar confidence given the context

Rules:
1. A scripted greeting with NO personal name → IVR or UNCLEAR, never HUMAN.
2. A personal first name ("Diana", "Veronica", "Honey", "Ron") → HUMAN, even if embedded in a scripted-sounding greeting (live agents often open with scripts).
3. "Live representative" self-identification with conversational followup → HUMAN.
4. Hold/queue/menu scripts → IVR.
5. When truly split 50/50 between HUMAN and IVR, choose UNCLEAR.

Respond with exactly one token: HUMAN, IVR, or UNCLEAR.`;

function buildHaikuUserMessage(turn: UnlabeledTurn): string {
  const ctxLines = turn.contextBefore
    .slice(-4)
    .map(c => {
      const who = c.speaker === 'user' ? 'REMOTE' : 'US (caller agent)';
      return `  ${who}: "${c.text}"`;
    })
    .join('\n');
  const ctxBlock =
    ctxLines.length > 0
      ? `Recent context (last 4 turns, "REMOTE" is the other end of the line):\n${ctxLines}\n\n`
      : 'Recent context: (none — first turn of the call)\n\n';
  const callPurpose = turn.metadata.callPurpose || '(none provided)';
  return `Call purpose: ${callPurpose}

${ctxBlock}Utterance to classify (just spoken by REMOTE):
"${turn.text}"

Classify as HUMAN, IVR, or UNCLEAR. One token, no explanation.`;
}

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

function parseHaikuResponse(text: string): ClassLabel {
  const upper = text.toUpperCase();
  // Find the first occurrence of a valid class token
  const human = upper.indexOf('HUMAN');
  const ivr = upper.indexOf('IVR');
  const unclear = upper.indexOf('UNCLEAR');
  const candidates: Array<[ClassLabel, number]> = [];
  if (human >= 0) candidates.push(['HUMAN', human]);
  if (ivr >= 0) candidates.push(['IVR', ivr]);
  if (unclear >= 0) candidates.push(['UNCLEAR', unclear]);
  if (candidates.length === 0) return 'UNCLEAR';
  candidates.sort((a, b) => a[1] - b[1]);
  return candidates[0][0];
}

async function runHaiku(turn: UnlabeledTurn): Promise<{
  predicted: ClassLabel;
  rawAction: string;
}> {
  const userMessage = buildHaikuUserMessage(turn);
  const response = await anthropic.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 10,
    temperature: 0,
    system: HAIKU_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });
  const first = response.content[0];
  const text = first && first.type === 'text' ? first.text : '';
  const cls = parseHaikuResponse(text);
  return { predicted: cls, rawAction: text.trim() };
}

type VariantRunner = (turn: UnlabeledTurn) => Promise<{
  predicted: ClassLabel;
  rawAction: string;
}>;

const VARIANT_RUNNERS: Record<string, VariantRunner> = {
  baseline: runBaseline,
  haiku: runHaiku,
};

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers: Promise<void>[] = [];
  for (let i = 0; i < concurrency; i++) {
    workers.push(
      (async () => {
        while (true) {
          const idx = next++;
          if (idx >= items.length) return;
          results[idx] = await worker(items[idx], idx);
        }
      })()
    );
  }
  await Promise.all(workers);
  return results;
}

function emptySummary(name: string): VariantSummary {
  const makeRow = (): Record<ClassLabel, number> => ({
    HUMAN: 0,
    IVR: 0,
    UNCLEAR: 0,
  });
  return {
    name,
    overallCorrect: 0,
    overallTotal: 0,
    perClass: {
      HUMAN: { correct: 0, total: 0 },
      IVR: { correct: 0, total: 0 },
      UNCLEAR: { correct: 0, total: 0 },
    },
    confusion: {
      HUMAN: makeRow(),
      IVR: makeRow(),
      UNCLEAR: makeRow(),
    },
  };
}

function summarize(name: string, results: TurnResult[]): VariantSummary {
  const s = emptySummary(name);
  for (const r of results) {
    s.overallTotal++;
    s.perClass[r.actual].total++;
    s.confusion[r.actual][r.predicted]++;
    if (r.correct) {
      s.overallCorrect++;
      s.perClass[r.actual].correct++;
    }
  }
  return s;
}

function formatSummary(s: VariantSummary): string {
  const pct = (c: number, t: number): string =>
    t === 0 ? 'n/a' : `${((100 * c) / t).toFixed(1)}%`;
  const classes: ClassLabel[] = ['HUMAN', 'IVR', 'UNCLEAR'];
  const lines: string[] = [];
  lines.push(`Variant: ${s.name}`);
  lines.push(
    `  Overall accuracy: ${s.overallCorrect}/${s.overallTotal} (${pct(
      s.overallCorrect,
      s.overallTotal
    )})`
  );
  lines.push('  Per-class:');
  for (const cls of classes) {
    const row = s.perClass[cls];
    lines.push(
      `    ${cls.padEnd(8)} ${row.correct}/${row.total} (${pct(
        row.correct,
        row.total
      )})`
    );
  }
  lines.push('  Confusion:');
  lines.push('                predicted');
  lines.push('                H    I    U');
  for (const actual of classes) {
    const row = s.confusion[actual];
    const letter = actual[0];
    lines.push(
      `    actual ${letter}    ${String(row.HUMAN).padStart(3)}  ${String(
        row.IVR
      ).padStart(3)}  ${String(row.UNCLEAR).padStart(3)}`
    );
  }
  return lines.join('\n');
}

function printWrongPredictions(
  variantName: string,
  results: TurnResult[],
  max = 15
): void {
  const wrong = results.filter(r => !r.correct);
  if (wrong.length === 0) {
    console.log(`  [${variantName}] no wrong predictions`);
    return;
  }
  // Prioritize: HUMAN misses first (rarest class, most important), then UNCLEAR, then IVR
  const priority: Record<ClassLabel, number> = { HUMAN: 0, UNCLEAR: 1, IVR: 2 };
  wrong.sort((a, b) => priority[a.actual] - priority[b.actual]);
  console.log(`  [${variantName}] ${wrong.length} wrong predictions:`);
  for (const r of wrong.slice(0, max)) {
    const text = r.text.length > 120 ? r.text.slice(0, 117) + '...' : r.text;
    console.log(
      `    callSid=${r.callSid.slice(0, 30)}... turnIndex=${r.turnIndex} actual=${r.actual} predicted=${r.predicted}  text=${JSON.stringify(
        text
      )}`
    );
  }
}

async function runVariant(
  name: string,
  dataset: EvalTurn[],
  concurrency: number
): Promise<{ summary: VariantSummary; results: TurnResult[] }> {
  const runner = VARIANT_RUNNERS[name];
  if (!runner) throw new Error(`Unknown variant: ${name}`);
  console.log(
    `\n[${name}] running on ${dataset.length} turns with concurrency=${concurrency}...`
  );
  const started = Date.now();
  let done = 0;
  const results = await runWithConcurrency(
    dataset,
    concurrency,
    async (item): Promise<TurnResult> => {
      let predicted: ClassLabel = 'UNCLEAR';
      let rawAction = '';
      try {
        const out = await runner(item.turn);
        predicted = out.predicted;
        rawAction = out.rawAction;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          `[${name}] error on ${item.turn.callSid}/${item.turn.turnIndex}: ${msg}`
        );
        rawAction = `ERROR: ${msg}`;
      }
      done++;
      if (done % 10 === 0 || done === dataset.length) {
        process.stdout.write(
          `\r  [${name}] ${done}/${dataset.length}  (${(
            (Date.now() - started) /
            1000
          ).toFixed(1)}s)`
        );
      }
      return {
        callSid: item.turn.callSid,
        turnIndex: item.turn.turnIndex,
        text: item.turn.text,
        actual: item.actual,
        predicted,
        rawAction,
        correct: predicted === item.actual,
      };
    }
  );
  process.stdout.write('\n');
  const summary = summarize(name, results);
  return { summary, results };
}

async function main(): Promise<void> {
  const { variants, limit, concurrency } = parseArgs();
  console.log(
    `compareHumanClassifiers: variants=${variants.join(',')} limit=${
      limit ?? 'none'
    } concurrency=${concurrency}`
  );

  const dataset = loadDataset(limit);
  if (dataset.length === 0) {
    console.error('No labeled turns found — aborting.');
    process.exit(1);
  }

  const counts: Record<ClassLabel, number> = { HUMAN: 0, IVR: 0, UNCLEAR: 0 };
  for (const d of dataset) counts[d.actual]++;
  console.log(
    `Dataset: ${dataset.length} labeled turns (after excluding skips)`
  );
  console.log(
    `  HUMAN: ${counts.HUMAN}  IVR: ${counts.IVR}  UNCLEAR: ${counts.UNCLEAR}`
  );

  const allVariantOutputs: Array<{
    name: string;
    summary: VariantSummary;
    results: TurnResult[];
  }> = [];

  for (const v of variants) {
    const out = await runVariant(v, dataset, concurrency);
    console.log('');
    console.log(formatSummary(out.summary));
    allVariantOutputs.push({
      name: v,
      summary: out.summary,
      results: out.results,
    });
  }

  console.log(
    '\n=== Wrong predictions (HUMAN misses first, then UNCLEAR, then IVR) ==='
  );
  for (const o of allVariantOutputs) {
    printWrongPredictions(o.name, o.results);
  }

  const dump = {
    runAt: new Date().toISOString(),
    datasetSize: dataset.length,
    classCounts: counts,
    variants: allVariantOutputs.map(o => ({
      name: o.name,
      summary: o.summary,
      perTurnResults: o.results,
    })),
  };
  const outDir = path.dirname(OUTPUT_FILE);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(dump, null, 2));
  console.log(`\nWrote: ${OUTPUT_FILE}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
