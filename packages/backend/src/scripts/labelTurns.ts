/**
 * Interactive CLI labeler for human-vs-IVR ground-truth dataset.
 *
 * Reads:  data/labeling/turns-unlabeled.jsonl
 * Reads:  data/labeling/turns-labeled.jsonl (to resume)
 * Writes: data/labeling/turns-labeled.jsonl (append, one row per keypress)
 *
 * Run: pnpm --filter backend ts-node src/scripts/labelTurns.ts
 *
 * See ./LABELING.md.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

const DATA_DIR = path.join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'data',
  'labeling'
);
const UNLABELED_FILE = path.join(DATA_DIR, 'turns-unlabeled.jsonl');
const LABELED_FILE = path.join(DATA_DIR, 'turns-labeled.jsonl');

const COLOR = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

type Label = 'h' | 'i' | 'u';

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

interface LabeledTurn {
  callSid: string;
  turnIndex: number;
  label: Label;
  labeledAt: string;
}

function turnKey(t: { callSid: string; turnIndex: number }): string {
  return `${t.callSid}::${t.turnIndex}`;
}

function readJsonlLines<T>(file: string): T[] {
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, 'utf-8');
  const out: T[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    out.push(JSON.parse(trimmed) as T);
  }
  return out;
}

function formatContextLine(line: ContextLine): string {
  const prefix =
    line.speaker === 'user'
      ? `${COLOR.cyan}USER${COLOR.reset}`
      : line.speaker === 'ai'
        ? `${COLOR.magenta}AI  ${COLOR.reset}`
        : `${COLOR.dim}SYS ${COLOR.reset}`;
  return `  ${prefix} ${COLOR.dim}${line.text}${COLOR.reset}`;
}

function renderTurn(
  turn: UnlabeledTurn,
  progress: { done: number; total: number }
): void {
  console.log('');
  console.log(
    `${COLOR.dim}--- ${progress.done + 1} / ${progress.total} | ${turn.callSid} turn ${turn.turnIndex} | to=${turn.metadata.to ?? '?'} purpose=${turn.metadata.callPurpose ?? '?'} ---${COLOR.reset}`
  );
  if (turn.contextBefore.length === 0) {
    console.log(`  ${COLOR.dim}(no prior context — first turn)${COLOR.reset}`);
  } else {
    for (const line of turn.contextBefore) {
      console.log(formatContextLine(line));
    }
  }
  console.log(
    `${COLOR.yellow}${COLOR.bold}>>${COLOR.reset} ${COLOR.yellow}${turn.text}${COLOR.reset}`
  );
}

function appendLabel(row: LabeledTurn): void {
  fs.appendFileSync(LABELED_FILE, JSON.stringify(row) + '\n');
}

interface KeyInput {
  name?: string;
  ctrl?: boolean;
  sequence?: string;
}

async function promptLabel(): Promise<Label | 'skip' | 'quit'> {
  process.stdout.write(
    `${COLOR.green}Label [h]uman / [i]vr / [u]nclear / [s]kip / [q]uit: ${COLOR.reset}`
  );

  return new Promise(resolve => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      throw new Error(
        'labelTurns requires an interactive TTY (stdin is not a TTY)'
      );
    }
    readline.emitKeypressEvents(stdin);
    stdin.setRawMode(true);
    stdin.resume();

    const onKey = (_str: string, key: KeyInput): void => {
      if (key.ctrl && key.name === 'c') {
        cleanup();
        resolve('quit');
        return;
      }
      const name = key.name ?? key.sequence ?? '';
      if (name === 'h' || name === 'i' || name === 'u') {
        process.stdout.write(name + '\n');
        cleanup();
        resolve(name);
        return;
      }
      if (name === 's') {
        process.stdout.write('s\n');
        cleanup();
        resolve('skip');
        return;
      }
      if (name === 'q' || name === 'escape') {
        process.stdout.write('q\n');
        cleanup();
        resolve('quit');
        return;
      }
      // ignore any other key
    };

    const cleanup = (): void => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('keypress', onKey);
    };

    stdin.on('keypress', onKey);
  });
}

async function main(): Promise<void> {
  if (!fs.existsSync(UNLABELED_FILE)) {
    console.error(`Missing ${UNLABELED_FILE}`);
    console.error(
      'Run: pnpm --filter backend ts-node src/scripts/extractLabelingDataset.ts'
    );
    process.exit(1);
  }

  const unlabeled = readJsonlLines<UnlabeledTurn>(UNLABELED_FILE);
  const alreadyLabeled = readJsonlLines<LabeledTurn>(LABELED_FILE);
  const labeledKeys = new Set(alreadyLabeled.map(turnKey));

  const todo = unlabeled.filter(t => !labeledKeys.has(turnKey(t)));
  const total = unlabeled.length;
  const startingDone = alreadyLabeled.length;

  console.log(
    `Unlabeled file: ${unlabeled.length} turns | already labeled: ${alreadyLabeled.length} | remaining: ${todo.length}`
  );
  console.log(
    'Keys: h=human, i=IVR, u=unclear, s=skip, q=quit (Ctrl-C also quits)'
  );

  let labeledThisSession = 0;

  const handleSigint = (): void => {
    console.log(
      `\nExiting. Labeled ${labeledThisSession} this session, ${startingDone + labeledThisSession} of ${total} turns total.`
    );
    process.exit(0);
  };
  process.on('SIGINT', handleSigint);

  for (let i = 0; i < todo.length; i++) {
    const turn = todo[i];
    renderTurn(turn, { done: startingDone + i, total });

    const result = await promptLabel();
    if (result === 'quit') {
      console.log(
        `\nExiting. Labeled ${labeledThisSession} this session, ${startingDone + labeledThisSession} of ${total} turns total.`
      );
      return;
    }
    if (result === 'skip') {
      continue;
    }

    const row: LabeledTurn = {
      callSid: turn.callSid,
      turnIndex: turn.turnIndex,
      label: result,
      labeledAt: new Date().toISOString(),
    };
    appendLabel(row);
    labeledThisSession++;
  }

  console.log(
    `\nAll ${todo.length} remaining turns processed. Labeled ${labeledThisSession} this session, ${startingDone + labeledThisSession} of ${total} turns total.`
  );
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
