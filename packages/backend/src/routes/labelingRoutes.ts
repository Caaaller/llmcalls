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

function normalizeText(t: string): string {
  return (t || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Heuristic: turns likely to be a live human, so we can surface them earlier
 * than the deep-IVR monologues. First turn of a call is almost always the IVR
 * greeting; turns after index 2 that are short or question-shaped are more
 * human-signal. Not a classifier — just a display-order tiebreak.
 */
function humanSignalScore(t: UnlabeledTurn): number {
  const text = t.text || '';
  let score = 0;
  if (t.turnIndex >= 2) score += 2;
  if (/\?/.test(text)) score += 2;
  if (text.length < 80) score += 1;
  // Classic human markers
  if (
    /\b(my name is|this is|how can i|can i help|you've reached)\b/i.test(text)
  )
    score += 3;
  // Anti-signals — strong IVR phrasing
  if (
    /\bpress \d\b|\bfor \w+, press\b|\bsay (yes|no|one|two|three)\b/i.test(text)
  )
    score -= 3;
  if (
    /^(thank you for calling|welcome to|please (hold|wait))/i.test(text.trim())
  )
    score -= 2;
  return score;
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

  // Normalized text of every already-labeled turn — used to skip
  // duplicates so the user doesn't re-label the same IVR greeting 10x.
  const unlabeledByKey = new Map(unlabeled.map(u => [turnKey(u), u]));
  const labeledTexts = new Set<string>();
  for (const l of alreadyLabeled) {
    const u = unlabeledByKey.get(turnKey(l));
    if (u) labeledTexts.add(normalizeText(u.text));
  }

  const total = unlabeled.length;
  const labeled = alreadyLabeled.length;

  // Filter: unlabeled AND text not already covered by a labeled row
  const uniqueRemaining = unlabeled.filter(t => {
    if (labeledKeys.has(turnKey(t))) return false;
    if (labeledTexts.has(normalizeText(t.text))) return false;
    return true;
  });

  // Prioritize likely-human turns so the underrepresented class gets more labels
  const sorted = [...uniqueRemaining].sort(
    (a, b) => humanSignalScore(b) - humanSignalScore(a)
  );
  const nextTurn = sorted[0] ?? null;
  const remaining = uniqueRemaining.length;

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

/**
 * GET /api/labeling/next-review?label=u
 * Returns the next already-labeled turn whose existing label matches the
 * query. Used for review mode — user re-checks a class they may have been
 * inconsistent on. `reviewed` is tracked in-memory per process to avoid
 * re-serving the same turn back-to-back.
 */
const reviewedThisSession = new Set<string>();
router.get('/next-review', (req: Request, res: Response) => {
  const labelFilter = String(req.query.label ?? 'u');
  if (!['h', 'i', 'u', 's'].includes(labelFilter)) {
    return res.status(400).json({ error: 'label must be h|i|u|s' });
  }
  const unlabeled = readJsonlLines<UnlabeledTurn>(UNLABELED_FILE);
  const labeled = readJsonlLines<LabeledTurn>(LABELED_FILE);
  const unlabeledByKey = new Map(unlabeled.map(u => [turnKey(u), u]));

  const matching = labeled.filter(l => l.label === labelFilter);
  const total = matching.length;

  // Prefer a matching row we haven't shown yet this session; fall back to
  // any matching row if the user has cycled through all of them.
  let next = matching.find(l => !reviewedThisSession.has(turnKey(l)));
  if (!next) {
    reviewedThisSession.clear();
    next = matching[0];
  }
  if (!next) {
    return res.json({
      turn: null,
      progress: { total, reviewed: 0, remaining: 0 },
      complete: true,
    });
  }
  reviewedThisSession.add(turnKey(next));
  const fullTurn = unlabeledByKey.get(turnKey(next));
  if (!fullTurn) {
    return res.status(500).json({
      error: `Labeled turn not found in unlabeled dataset: ${turnKey(next)}`,
    });
  }
  return res.json({
    turn: fullTurn,
    currentLabel: next.label,
    progress: {
      total,
      reviewed: reviewedThisSession.size,
      remaining: Math.max(0, total - reviewedThisSession.size),
    },
    complete: false,
  });
});

/**
 * POST /api/labeling/relabel
 * Overwrite an existing label row. Used by review mode.
 */
router.post('/relabel', (req: Request, res: Response) => {
  const { callSid, turnIndex, label } = req.body ?? {};
  if (typeof callSid !== 'string' || !callSid) {
    return res.status(400).json({ error: 'callSid required' });
  }
  if (typeof turnIndex !== 'number' || !Number.isInteger(turnIndex)) {
    return res.status(400).json({ error: 'turnIndex must be integer' });
  }
  if (!['h', 'i', 'u', 's'].includes(label)) {
    return res.status(400).json({ error: 'label must be h|i|u|s' });
  }
  const labeled = readJsonlLines<LabeledTurn>(LABELED_FILE);
  const key = turnKey({ callSid, turnIndex });
  const idx = labeled.findIndex(l => turnKey(l) === key);
  if (idx === -1) {
    return res.status(404).json({ error: 'row not found' });
  }
  labeled[idx] = {
    callSid,
    turnIndex,
    label,
    labeledAt: new Date().toISOString(),
  };
  const body = labeled.map(r => JSON.stringify(r)).join('\n') + '\n';
  fs.writeFileSync(LABELED_FILE, body);
  return res.json({ success: true });
});

/**
 * POST /api/labeling/undo
 * Remove the most recently labeled row so the user can re-label it.
 * No-op (204) if there's nothing to undo.
 */
router.post('/undo', (_req: Request, res: Response) => {
  const labeled = readJsonlLines<LabeledTurn>(LABELED_FILE);
  if (labeled.length === 0) {
    return res.status(204).end();
  }
  const removed = labeled[labeled.length - 1];
  const remaining = labeled.slice(0, -1);
  const body = remaining.map(r => JSON.stringify(r)).join('\n');
  fs.writeFileSync(LABELED_FILE, body.length > 0 ? body + '\n' : '');
  return res.json({ success: true, removed });
});

export default router;
