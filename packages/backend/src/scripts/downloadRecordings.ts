/**
 * Download call recordings from Twilio and save as local MP3 fixtures.
 * Run: npx ts-node src/scripts/downloadRecordings.ts
 *
 * Downloads all recordings stored in MongoDB CallHistory.recordingUrl
 * into src/services/__tests__/fixtures/recordings/
 */

import '../loadEnv';
import * as fs from 'fs';
import * as path from 'path';
import { connect, disconnect } from '../services/database';
import CallHistory from '../models/CallHistory';

const RECORDINGS_DIR = path.join(
  __dirname,
  '..',
  'services',
  '__tests__',
  'fixtures',
  'recordings'
);

async function downloadRecordings(): Promise<void> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    throw new Error('TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set');
  }

  await connect();

  const calls = await CallHistory.find({
    recordingUrl: { $exists: true, $ne: null },
  }).lean();

  console.log(`Found ${calls.length} calls with recordings`);

  if (!fs.existsSync(RECORDINGS_DIR)) {
    fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
  }

  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  for (const call of calls) {
    const callSid = call.callSid;
    const purpose = call.metadata?.callPurpose || 'unknown';
    const outFile = path.join(RECORDINGS_DIR, `${callSid}.mp3`);

    if (fs.existsSync(outFile)) {
      console.log(`  SKIP ${callSid} (already exists)`);
      skipped++;
      continue;
    }

    const recordingUrl = call.recordingUrl;
    if (!recordingUrl) continue;

    // Twilio recording URLs need .mp3 suffix for MP3 format
    const mp3Url = recordingUrl.endsWith('.mp3')
      ? recordingUrl
      : `${recordingUrl}.mp3`;

    try {
      console.log(`  Downloading ${callSid} (${purpose})...`);
      const response = await fetch(mp3Url, {
        headers: { Authorization: `Basic ${auth}` },
      });

      if (!response.ok) {
        console.error(
          `  FAIL ${callSid}: HTTP ${response.status} ${response.statusText}`
        );
        failed++;
        continue;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length < 1000) {
        console.error(
          `  FAIL ${callSid}: Recording too small (${buffer.length} bytes)`
        );
        failed++;
        continue;
      }

      fs.writeFileSync(outFile, buffer);
      console.log(`  OK   ${callSid}: ${(buffer.length / 1024).toFixed(1)} KB`);
      downloaded++;
    } catch (err) {
      console.error(
        `  FAIL ${callSid}: ${err instanceof Error ? err.message : String(err)}`
      );
      failed++;
    }
  }

  console.log(
    `\nDone: ${downloaded} downloaded, ${skipped} skipped, ${failed} failed`
  );
  await disconnect();
}

downloadRecordings().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
