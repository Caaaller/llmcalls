/**
 * STT Test Routes
 * TwiML endpoints for voice-to-text regression tests.
 *
 * Flow:
 * 1. Outbound leg hits /gather — returns <Gather> that listens silently
 * 2. Inbound leg hits /play — returns <Play> with the test audio file
 * 3. Gather transcribes what it hears → POSTs to /result
 * 4. Test runner polls /result/:callSid to retrieve transcription
 */

import express, { Request, Response } from 'express';
import twilio from 'twilio';
import * as path from 'path';
import * as fs from 'fs';
import { createGatherAttributes, getBaseUrl } from '../utils/twimlHelpers';
import transferConfig from '../config/transfer-config';

const router: express.Router = express.Router();

export interface SttResult {
  callSid: string;
  caseId: string;
  speechResult: string;
  confidence: string;
  receivedAt: Date;
}

const sttResults = new Map<string, SttResult>();

export function getSttResult(callSid: string): SttResult | undefined {
  return sttResults.get(callSid);
}

export function clearSttResults(): void {
  sttResults.clear();
}

const RECORDINGS_DIR = path.join(
  __dirname,
  '..',
  '..',
  'src',
  'services',
  '__tests__',
  'fixtures',
  'recordings'
);

/**
 * Outbound leg — returns Gather that listens for the played audio.
 * Uses production STT config (speechModel, language, etc.) to match real behavior.
 */
router.post('/gather', (req: Request, res: Response): void => {
  const caseId = (req.query.caseId as string) || 'unknown';
  const speechModel = (req.query.speechModel as string) || undefined;
  const speechTimeout = (req.query.speechTimeout as string) || undefined;
  const baseUrl = getBaseUrl(req);

  const config = transferConfig.createConfig({
    transferNumber: process.env.TRANSFER_PHONE_NUMBER || '',
    callPurpose: 'stt-test',
  });

  const response = new twilio.twiml.VoiceResponse();

  const overrides: Record<string, unknown> = {
    action: `${baseUrl}/voice/stt-test/result?caseId=${encodeURIComponent(caseId)}`,
    method: 'POST',
    timeout: 60,
  };
  if (speechModel) overrides.speechModel = speechModel;
  if (speechTimeout) {
    overrides.speechTimeout =
      speechTimeout === 'auto' ? 'auto' : Number(speechTimeout);
  }

  const gatherAttributes = createGatherAttributes(
    config,
    overrides as Partial<import('../types/twilio-twiml').TwilioGatherInput>
  );

  console.log(
    `[STT-TEST] Gather case=${caseId} speechModel=${gatherAttributes.speechModel} speechTimeout=${gatherAttributes.speechTimeout}`
  );

  response.gather(gatherAttributes as Parameters<typeof response.gather>[0]);

  // If Gather times out without speech, post empty result
  response.redirect(
    { method: 'POST' },
    `${baseUrl}/voice/stt-test/result?caseId=${encodeURIComponent(caseId)}&timeout=true`
  );

  res.type('text/xml');
  res.send(response.toString());
});

/**
 * Inbound leg — plays the audio file for the test case.
 */
router.post('/play', (req: Request, res: Response): void => {
  const caseId = (req.query.caseId as string) || 'unknown';
  const audioFile = (req.query.audioFile as string) || `${caseId}.mp3`;
  const baseUrl = getBaseUrl(req);

  const response = new twilio.twiml.VoiceResponse();

  const audioUrl = `${baseUrl}/voice/stt-test/audio/${encodeURIComponent(audioFile)}`;
  response.play(audioUrl);
  response.pause({ length: 2 });
  response.hangup();

  console.log(`[STT-TEST] Playing audio for case=${caseId}: ${audioUrl}`);

  res.type('text/xml');
  res.send(response.toString());
});

/**
 * Gather result callback — receives Twilio's transcription.
 */
router.post('/result', (req: Request, res: Response): void => {
  const callSid = req.body.CallSid || '';
  const caseId = (req.query.caseId as string) || 'unknown';
  const speechResult = req.body.SpeechResult || '';
  const confidence = req.body.Confidence || '';
  const isTimeout = req.query.timeout === 'true';

  console.log(
    `[STT-TEST] Result for case=${caseId} callSid=${callSid}: ` +
      (isTimeout
        ? 'TIMEOUT (no speech detected)'
        : `confidence=${confidence} "${speechResult}"`)
  );

  sttResults.set(callSid, {
    callSid,
    caseId,
    speechResult,
    confidence,
    receivedAt: new Date(),
  });

  const response = new twilio.twiml.VoiceResponse();
  response.hangup();
  res.type('text/xml');
  res.send(response.toString());
});

/**
 * Serve audio files from fixtures/recordings directory.
 */
router.get('/audio/:filename', (req: Request, res: Response): void => {
  const filename = req.params.filename as string;
  const filePath = path.join(RECORDINGS_DIR, filename);

  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: `Audio file not found: ${filename}` });
    return;
  }

  const stat = fs.statSync(filePath);
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Content-Length', stat.size);
  fs.createReadStream(filePath).pipe(res);
});

/**
 * Poll endpoint — test runner fetches transcription result by callSid.
 */
router.get('/result/:callSid', (req: Request, res: Response): void => {
  const callSid = req.params.callSid as string;
  const result = sttResults.get(callSid);

  if (!result) {
    res.status(404).json({ found: false });
    return;
  }

  res.json({ found: true, ...result });
});

export default router;
