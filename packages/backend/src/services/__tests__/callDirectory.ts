/**
 * Script to call numbers from phone-directory.json and collect IVR transcripts.
 * Usage: npx ts-node src/services/__tests__/callDirectory.ts [startIndex] [count]
 *
 * Calls each number with purpose "speak with a representative",
 * waits for the call to complete, and prints the transcript.
 */

import '../../../jest.setup';
import * as fs from 'fs';
import * as path from 'path';
import twilioService from '../twilioService';
import callHistoryService from '../callHistoryService';
import { connect, disconnect } from '../database';

interface DirectoryEntry {
  name: string;
  phone: string;
  category: string;
  tip: string;
  navHint: string;
}

const POLL_INTERVAL_MS = 3000;
const MAX_DURATION_SECONDS = 120; // 2 minutes per call
const TERMINAL_STATUSES = [
  'completed',
  'failed',
  'busy',
  'no-answer',
  'canceled',
];

async function makeCall(
  entry: DirectoryEntry
): Promise<{ callSid: string; status: string; durationSeconds: number }> {
  const baseUrl = process.env.TWIML_URL || '';
  const from = process.env.TWILIO_PHONE_NUMBER || '';
  const transferNumber = process.env.TRANSFER_PHONE_NUMBER || '+13033962866';

  const params = new URLSearchParams({
    transferNumber,
    callPurpose: 'speak with a representative',
  });
  const twimlUrl = `${baseUrl}/voice?${params.toString()}`;

  const call = await twilioService.initiateCall(entry.phone, from, twimlUrl);
  const callSid = call.sid;
  const startTime = Date.now();
  let status = call.status;

  while (true) {
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    const currentCall = await twilioService.getCallStatus(callSid);
    status = currentCall.status;

    if (TERMINAL_STATUSES.includes(status)) break;

    const elapsed = (Date.now() - startTime) / 1000;
    if (elapsed > MAX_DURATION_SECONDS) {
      await twilioService.terminateCall(callSid);
      break;
    }
  }

  const durationSeconds = Math.round((Date.now() - startTime) / 1000);
  return { callSid, status, durationSeconds };
}

async function getTranscript(callSid: string): Promise<string> {
  const call = await callHistoryService.getCall(callSid);
  if (!call) return 'No call history found';

  const lines: Array<string> = [];
  if (call.events && call.events.length > 0) {
    for (const event of call.events) {
      const time = event.timestamp
        ? new Date(event.timestamp).toISOString().slice(11, 19)
        : '??:??:??';
      switch (event.eventType) {
        case 'conversation':
          lines.push(`[${time}] ${event.type?.toUpperCase()}: ${event.text}`);
          break;
        case 'dtmf':
          lines.push(`[${time}] DTMF: ${event.digit} — ${event.reason || ''}`);
          break;
        case 'ivr_menu':
          lines.push(
            `[${time}] IVR MENU: ${(event.menuOptions || []).map((o: { digit: string; option: string }) => `${o.digit}=${o.option}`).join(', ')}`
          );
          break;
        case 'transfer':
          lines.push(
            `[${time}] TRANSFER → ${event.transferNumber} (success=${event.success})`
          );
          break;
        case 'hold':
          lines.push(`[${time}] HOLD`);
          break;
        case 'termination':
          lines.push(`[${time}] TERMINATED: ${event.reason}`);
          break;
        default:
          lines.push(`[${time}] ${event.eventType}`);
      }
    }
  }
  return lines.join('\n');
}

async function main() {
  const startIndex = parseInt(process.argv[2] || '0', 10);
  const count = parseInt(process.argv[3] || '10', 10);

  const directory: Array<DirectoryEntry> = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'phone-directory.json'), 'utf-8')
  );

  const batch = directory.slice(startIndex, startIndex + count);
  console.log(
    `\nCalling ${batch.length} numbers (index ${startIndex}-${startIndex + batch.length - 1} of ${directory.length})\n`
  );

  await connect();

  const results: Array<{
    name: string;
    phone: string;
    status: string;
    duration: number;
    transcript: string;
  }> = [];

  for (let i = 0; i < batch.length; i++) {
    const entry = batch[i];
    const idx = startIndex + i;
    console.log(
      `[${idx}/${directory.length - 1}] Calling ${entry.name} (${entry.phone})...`
    );

    const { callSid, status, durationSeconds } = await makeCall(entry);
    // Wait a moment for events to flush to DB
    await new Promise(resolve => setTimeout(resolve, 2000));
    const transcript = await getTranscript(callSid);

    console.log(`  Status: ${status}, Duration: ${durationSeconds}s`);
    console.log(
      transcript
        .split('\n')
        .map(l => `  ${l}`)
        .join('\n')
    );
    console.log('');

    results.push({
      name: entry.name,
      phone: entry.phone,
      status,
      duration: durationSeconds,
      transcript,
    });
  }

  // Save results to file
  const outPath = path.join(
    __dirname,
    `call-results-${startIndex}-${startIndex + batch.length - 1}.json`
  );
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\nResults saved to ${outPath}`);

  await disconnect();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
