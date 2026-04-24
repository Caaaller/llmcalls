/**
 * Human-Detection Pipeline Integration Test
 *
 * Validates the full AI flow:
 *   1. Hear agent greeting → AI marks maybe_human, asks confirmation question
 *   2. Hear "yes I'm a real human" → AI marks human_detected, initiates transfer
 *
 * Bypasses the Telnyx audio round-trip (which has a known-bug stream fork on
 * cross-app bridged self-calls — see CHANGES-LOG #D). Instead, injects
 * synthetic transcripts directly into processSpeech and inspects the
 * returned aiAction/processingResult. This runs against the REAL Anthropic
 * API so it validates actual prompt behavior, not mocks.
 *
 * Cost: ~2 Haiku calls per test case × 2 cases = ~$0.04 total.
 *
 * Run: pnpm --filter backend jest --testPathPatterns=humanDetectionPipeline --forceExit
 */

import '../../../jest.setup';
import callStateManager from '../callStateManager';
import { processSpeech } from '../speechProcessingService';

// Don't run during normal test suite — only on-demand. Costs a few LLM calls.
const maybeDescribe =
  process.env.RUN_LLM_INTEGRATION === '1' ? describe : describe.skip;

maybeDescribe('human-detection pipeline (real LLM, no phone)', () => {
  const callSid = 'test-human-detection-' + Date.now();
  const transferNumber = '+15551234567';

  beforeAll(() => {
    // getCallState lazy-creates the record if missing — that's all we need.
    callStateManager.getCallState(callSid);
  });

  afterAll(() => {
    callStateManager.clearCallState(callSid);
  });

  it('asks confirmation question after hearing agent greeting', async () => {
    const result = await processSpeech({
      callSid,
      speechResult:
        'Hi, thanks for calling customer service, this is Jamie speaking, how can I help you today?',
      isFirstCall: false,
      baseUrl: 'http://localhost:8068',
      transferNumber,
      callPurpose: 'speak with a representative',
      testMode: true,
    });

    // maybe_human is the correct signal. The backend translates it into a
    // canned "Am I speaking with a live agent?" confirmation prompt — the
    // AI's speech field carries the agent name intro, not the prompt text.
    const action = result.aiAction || '';
    expect(action).toBe('maybe_human');
  }, 30_000);

  it('marks human_detected after hearing confirmation', async () => {
    // Update call state to reflect that confirmation is now being awaited —
    // matches the production flow after the first turn fired maybe_human.
    callStateManager.updateCallState(callSid, {
      awaitingHumanConfirmation: true,
    });

    const result = await processSpeech({
      callSid,
      speechResult: "Yeah I'm a real human, not a bot. What's the issue?",
      isFirstCall: false,
      baseUrl: 'http://localhost:8068',
      transferNumber,
      callPurpose: 'speak with a representative',
      testMode: true,
    });

    // Expect human_detected OR a transfer-initiating action.
    const action = result.aiAction || '';
    expect(['human_detected', 'transfer']).toContain(action);
  }, 30_000);
});
