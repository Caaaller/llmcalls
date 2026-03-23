/**
 * STT Test Runner
 * Executes voice-to-text tests by calling ourselves through Twilio.
 *
 * Flow:
 * 1. Update test phone number's voice webhook to play the audio file
 * 2. Initiate outbound call with Gather on the calling side
 * 3. Poll for transcription result
 */

import twilio from 'twilio';
import twilioService from '../twilioService';
import type { SttTestCase } from './sttTestCases';
import type { SttResult } from '../../routes/sttTestRoutes';

const POLL_INTERVAL_MS = 1000;
const DEFAULT_MAX_POLL_SECONDS = 120;
const TERMINAL_STATUSES = [
  'completed',
  'failed',
  'busy',
  'no-answer',
  'canceled',
];

export interface SttModelConfig {
  speechModel: string;
  speechTimeout: string | number;
}

export interface SttTestResult {
  callSid: string;
  speechResult: string;
  confidence: string;
  durationSeconds: number;
  timedOut: boolean;
}

/**
 * Update a Twilio phone number's voice webhook URL.
 */
async function updatePhoneNumberWebhook(
  phoneNumber: string,
  voiceUrl: string
): Promise<string> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID!;
  const authToken = process.env.TWILIO_AUTH_TOKEN!;
  const client = twilio(accountSid, authToken);

  const numbers = await client.incomingPhoneNumbers.list({
    phoneNumber,
    limit: 1,
  });

  if (numbers.length === 0) {
    throw new Error(`Phone number ${phoneNumber} not found in Twilio account`);
  }

  const numberSid = numbers[0].sid;
  const originalUrl = numbers[0].voiceUrl || '';

  await client.incomingPhoneNumbers(numberSid).update({
    voiceUrl,
    voiceMethod: 'POST',
  });

  console.log(`[STT-TEST] Updated ${phoneNumber} webhook: ${voiceUrl}`);

  return originalUrl;
}

/**
 * Restore a phone number's webhook to its original URL.
 */
export async function restorePhoneNumberWebhook(
  phoneNumber: string,
  originalUrl: string
): Promise<void> {
  if (!originalUrl) return;
  await updatePhoneNumberWebhook(phoneNumber, originalUrl);
  console.log(`[STT-TEST] Restored ${phoneNumber} webhook`);
}

/**
 * Execute a single STT test case.
 */
export async function executeSttTest(
  testCase: SttTestCase,
  testPhoneNumber: string,
  modelConfig?: SttModelConfig
): Promise<SttTestResult> {
  const baseUrl = process.env.TWIML_URL || process.env.BASE_URL || '';
  const from = process.env.TWILIO_PHONE_NUMBER || '';
  const maxPollSeconds = testCase.maxPollSeconds ?? DEFAULT_MAX_POLL_SECONDS;

  // Update the test phone number's webhook to play this test's audio
  const originalUrl = await updatePhoneNumberWebhook(
    testPhoneNumber,
    `${baseUrl}/voice/stt-test/play?caseId=${encodeURIComponent(testCase.id)}&audioFile=${encodeURIComponent(testCase.audioFile)}`
  );

  try {
    // Outbound leg: Gather that listens, with optional model overrides
    const gatherParams = new URLSearchParams({
      caseId: testCase.id,
    });
    if (modelConfig) {
      gatherParams.set('speechModel', modelConfig.speechModel);
      gatherParams.set('speechTimeout', String(modelConfig.speechTimeout));
    }
    const gatherUrl = `${baseUrl}/voice/stt-test/gather?${gatherParams.toString()}`;

    const call = await twilioService.initiateCall(
      testPhoneNumber,
      from,
      gatherUrl,
      { record: false }
    );

    const callSid = call.sid;
    const startTime = Date.now();
    let timedOut = false;

    // Poll for call completion
    while (true) {
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));

      const currentCall = await twilioService.getCallStatus(callSid);

      if (TERMINAL_STATUSES.includes(currentCall.status)) break;

      const elapsed = (Date.now() - startTime) / 1000;
      if (elapsed > maxPollSeconds) {
        await twilioService.terminateCall(callSid);
        timedOut = true;
        break;
      }
    }

    // Poll for STT result (may arrive slightly after call ends)
    const resultUrl = `${baseUrl}/voice/stt-test/result/${callSid}`;
    let result: SttResult | undefined;
    const resultPollStart = Date.now();

    while ((Date.now() - resultPollStart) / 1000 < 15) {
      const response = await fetch(resultUrl);
      if (response.ok) {
        const data = (await response.json()) as { found: boolean } & SttResult;
        if (data.found) {
          result = data;
          break;
        }
      }
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    }

    const durationSeconds = Math.round((Date.now() - startTime) / 1000);

    return {
      callSid,
      speechResult: result?.speechResult || '',
      confidence: result?.confidence || '',
      durationSeconds,
      timedOut,
    };
  } finally {
    await restorePhoneNumberWebhook(testPhoneNumber, originalUrl);
  }
}
