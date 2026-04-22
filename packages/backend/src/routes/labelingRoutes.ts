/**
 * Labeling Routes — human-vs-IVR ground truth dataset
 *
 * Serves the same JSONL dataset as scripts/labelTurns.ts via a web UI at
 * /labeling. Keyboard-driven, no form, no modal — pure "hold a key and burn
 * through labels" UX.
 *
 * NOTE: Local-dev only. No auth middleware is attached because this mounts
 * at /api/labeling and is never exposed in production. Do NOT add auth —
 * the frontend calls it unauthenticated.
 */

import express, { Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';

const router: express.Router = express.Router();

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

type Label = 'h' | 'i' | 'u' | 's';

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

/**
 * GET /api/labeling/next-turn
 * Returns the first unlabeled turn plus progress counters.
 */
router.get('/next-turn', (_req: Request, res: Response) => {
  if (!fs.existsSync(UNLABELED_FILE)) {
    return res.status(500).json({
      error: `Missing ${UNLABELED_FILE}. Run: pnpm --filter backend ts-node src/scripts/extractLabelingDataset.ts`,
    });
  }

  const unlabeled = readJsonlLines<UnlabeledTurn>(UNLABELED_FILE);
  const alreadyLabeled = readJsonlLines<LabeledTurn>(LABELED_FILE);
  const labeledKeys = new Set(alreadyLabeled.map(turnKey));

  const total = unlabeled.length;
  const labeled = alreadyLabeled.length;
  const remaining = total - labeled;

  const nextTurn = unlabeled.find(t => !labeledKeys.has(turnKey(t))) ?? null;

  if (!nextTurn) {
    return res.json({
      turn: null,
      progress: { total, labeled, remaining: 0 },
      complete: true,
    });
  }

  return res.json({
    turn: nextTurn,
    progress: { total, labeled, remaining },
    complete: false,
  });
});

/**
 * POST /api/labeling/label
 * Append a single label row to turns-labeled.jsonl.
 * Idempotent: duplicates return { already: true } without writing.
 */
router.post('/label', (req: Request, res: Response) => {
  const { callSid, turnIndex, label } = req.body ?? {};

  if (typeof callSid !== 'string' || !callSid) {
    return res
      .status(400)
      .json({ error: 'callSid must be a non-empty string' });
  }
  if (typeof turnIndex !== 'number' || !Number.isInteger(turnIndex)) {
    return res.status(400).json({ error: 'turnIndex must be an integer' });
  }
  if (label !== 'h' && label !== 'i' && label !== 'u' && label !== 's') {
    return res
      .status(400)
      .json({ error: "label must be 'h' | 'i' | 'u' | 's'" });
  }

  const alreadyLabeled = readJsonlLines<LabeledTurn>(LABELED_FILE);
  const key = turnKey({ callSid, turnIndex });
  if (alreadyLabeled.some(t => turnKey(t) === key)) {
    return res.json({ success: true, already: true });
  }

  const row: LabeledTurn = {
    callSid,
    turnIndex,
    label,
    labeledAt: new Date().toISOString(),
  };

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.appendFileSync(LABELED_FILE, JSON.stringify(row) + '\n');

  return res.json({ success: true, already: false });
});

export default router;
