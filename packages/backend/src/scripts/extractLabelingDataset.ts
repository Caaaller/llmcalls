/**
 * Extract the last 100 calls from MongoDB CallHistory and emit every USER
 * transcript turn as a row in a JSONL file, with surrounding context.
 *
 * Output: /Users/oliverullman/Documents/coding/llmcalls/data/labeling/turns-unlabeled.jsonl
 *
 * Run: pnpm --filter backend ts-node src/scripts/extractLabelingDataset.ts
 *
 * This is step 1 of building a ground-truth dataset for comparing
 * human-vs-IVR classifier variants. See ./LABELING.md.
 */

import '../loadEnv';
import * as fs from 'fs';
import * as path from 'path';
import { connect, disconnect } from '../services/database';
import CallHistory, {
  ConversationEntry,
  ICallHistory,
} from '../models/CallHistory';

const CALL_LIMIT = 100;
const CONTEXT_WINDOW = 4;

const OUTPUT_DIR = path.join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'data',
  'labeling'
);
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'turns-unlabeled.jsonl');

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
  metadata: {
    to?: string;
    callPurpose?: string;
  };
}

function extractTurnsFromCall(call: ICallHistory): UnlabeledTurn[] {
  const conversation = call.conversation || [];
  const turns: UnlabeledTurn[] = [];

  for (let i = 0; i < conversation.length; i++) {
    const entry: ConversationEntry = conversation[i];
    if (entry.type !== 'user') continue;

    const start = Math.max(0, i - CONTEXT_WINDOW);
    const contextBefore: ContextLine[] = conversation
      .slice(start, i)
      .map(e => ({ speaker: e.type, text: e.text }));

    turns.push({
      callSid: call.callSid,
      turnIndex: i,
      timestamp: (entry.timestamp ?? new Date(0)).toISOString(),
      contextBefore,
      text: entry.text,
      metadata: {
        to: call.metadata?.to,
        callPurpose: call.metadata?.callPurpose,
      },
    });
  }

  return turns;
}

async function extract(): Promise<void> {
  await connect();

  const calls = await CallHistory.find({})
    .sort({ startTime: -1 })
    .limit(CALL_LIMIT)
    .lean<ICallHistory[]>();

  console.log(`Fetched ${calls.length} calls (sorted by startTime desc)`);

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const out = fs.createWriteStream(OUTPUT_FILE, { flags: 'w' });
  let totalTurns = 0;

  for (const call of calls) {
    const turns = extractTurnsFromCall(call);
    for (const turn of turns) {
      out.write(JSON.stringify(turn) + '\n');
    }
    totalTurns += turns.length;
  }

  out.end();
  await new Promise<void>(resolve => out.on('finish', () => resolve()));

  const avgTurns =
    calls.length > 0 ? (totalTurns / calls.length).toFixed(2) : '0';
  console.log('');
  console.log('Summary');
  console.log('-------');
  console.log(`Calls:              ${calls.length}`);
  console.log(`User turns:         ${totalTurns}`);
  console.log(`Avg turns per call: ${avgTurns}`);
  console.log(`Wrote:              ${OUTPUT_FILE}`);

  await disconnect();
}

extract().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
