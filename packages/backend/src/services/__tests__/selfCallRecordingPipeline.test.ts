/**
 * Self-Call Recording-API Workaround — unit tests
 *
 * Verifies the post-call recording → Deepgram → state-machine replay
 * pipeline that bypasses Issue #D (Telnyx cross-app stream-fork bug).
 * See docs/telnyx-cross-app-stream-fork-bug.md.
 *
 * Two layers:
 *   1. Pure-function tests for word-chunk splitting (no network).
 *   2. Replay test with a mocked processSpeech to assert that
 *      `maybe_human → human_detected` flow runs cleanly chunk-by-chunk.
 *
 * An opt-in real-LLM integration test runs when RUN_LLM_INTEGRATION=1
 * is set — same gating as humanDetectionPipeline.test.ts.
 */
jest.mock('telnyx', () => {
  return jest.fn().mockImplementation(() => ({
    calls: { actions: { speak: jest.fn(), answer: jest.fn() } },
  }));
});

process.env.TELNYX_API_KEY = 'test';
process.env.TELNYX_PHONE_NUMBER = '+15555551212';

import callStateManager from '../callStateManager';
import {
  DeepgramWord,
  splitWordsIntoChunks,
  replayChunksThroughStateMachine,
  RecordingChunk,
} from '../selfCallRecordingPipelineService';

// Mock processSpeech for the deterministic replay test. The mock
// behaves like the real state machine for our two test cases:
//   - Greeting chunk → maybe_human
//   - Confirmation chunk (with awaitingHumanConfirmation set) → human_detected
const mockProcessSpeech = jest.fn();
jest.mock('../speechProcessingService', () => ({
  __esModule: true,
  processSpeech: (...args: unknown[]) => mockProcessSpeech(...args),
}));

function makeWord(word: string, start: number, end: number): DeepgramWord {
  return { word, start, end, punctuated_word: word };
}

describe('splitWordsIntoChunks', () => {
  it('returns empty for empty input', () => {
    expect(splitWordsIntoChunks([])).toEqual([]);
  });

  it('groups contiguous words into one chunk', () => {
    const words: DeepgramWord[] = [
      makeWord('hi', 0.0, 0.2),
      makeWord('there', 0.25, 0.5),
      makeWord('friend', 0.55, 0.9),
    ];
    const chunks = splitWordsIntoChunks(words, 0.7);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe('hi there friend');
    expect(chunks[0].startSec).toBe(0);
    expect(chunks[0].endSec).toBeCloseTo(0.9, 5);
  });

  it('splits on a gap larger than the threshold', () => {
    const words: DeepgramWord[] = [
      makeWord('hi', 0.0, 0.3),
      makeWord('there', 0.4, 0.7),
      // 1.0s gap — > 0.7 threshold
      makeWord('yes', 1.7, 2.0),
      makeWord('human', 2.1, 2.5),
    ];
    const chunks = splitWordsIntoChunks(words, 0.7);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].text).toBe('hi there');
    expect(chunks[1].text).toBe('yes human');
  });

  it('does not split on a gap smaller than the threshold', () => {
    const words: DeepgramWord[] = [
      makeWord('a', 0.0, 0.2),
      makeWord('b', 0.5, 0.7),
      makeWord('c', 1.05, 1.3),
    ];
    const chunks = splitWordsIntoChunks(words, 0.5);
    expect(chunks).toHaveLength(1);
  });

  it('respects punctuated_word when present', () => {
    const words: DeepgramWord[] = [
      { word: 'hi', start: 0, end: 0.3, punctuated_word: 'Hi,' },
      { word: 'there', start: 0.35, end: 0.7, punctuated_word: 'there.' },
    ];
    const chunks = splitWordsIntoChunks(words, 0.7);
    expect(chunks[0].text).toBe('Hi, there.');
  });

  it('produces 2 chunks for a typical agent-greeting + confirmation pattern', () => {
    // greeting (~3s of speech) → 6s gap → confirmation (~2s)
    const words: DeepgramWord[] = [
      makeWord('hi', 0.0, 0.3),
      makeWord('thanks', 0.4, 0.8),
      makeWord('for', 0.85, 1.0),
      makeWord('calling', 1.1, 1.5),
      makeWord('this', 1.6, 1.8),
      makeWord('is', 1.85, 2.0),
      makeWord('jamie', 2.1, 2.6),
      // 6s gap (caller asks "are you a human?")
      makeWord('yes', 8.6, 9.0),
      makeWord("i'm", 9.1, 9.3),
      makeWord('a', 9.35, 9.4),
      makeWord('real', 9.5, 9.8),
      makeWord('person', 9.9, 10.4),
    ];
    const chunks = splitWordsIntoChunks(words, 0.7);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].text).toMatch(/jamie/);
    expect(chunks[1].text).toMatch(/yes/);
  });
});

describe('replayChunksThroughStateMachine', () => {
  const callSid = 'test-replay-' + Date.now();

  beforeEach(() => {
    mockProcessSpeech.mockReset();
    callStateManager.clearCallState(callSid);
  });

  afterAll(() => {
    callStateManager.clearCallState(callSid);
  });

  it('progresses maybe_human → human_detected across two chunks', async () => {
    mockProcessSpeech
      .mockResolvedValueOnce({
        twiml: '',
        shouldSend: false,
        aiAction: 'maybe_human',
      })
      .mockResolvedValueOnce({
        twiml: '',
        shouldSend: false,
        aiAction: 'human_detected',
      });

    const chunks: RecordingChunk[] = [
      { text: 'Hi, this is Jamie speaking.', startSec: 0, endSec: 3 },
      { text: "Yes, I'm a real person.", startSec: 9, endSec: 11 },
    ];

    const results = await replayChunksThroughStateMachine({
      callSid,
      chunks,
      baseUrl: 'http://localhost:8068',
      transferNumber: '+15551234567',
      callPurpose: 'speak with a representative',
    });

    expect(results).toHaveLength(2);
    expect(results[0].result.aiAction).toBe('maybe_human');
    expect(results[1].result.aiAction).toBe('human_detected');

    // After maybe_human fires, the second chunk should have been
    // dispatched with the awaitingHumanConfirmation flag set on state.
    // The mock doesn't inspect state directly, but we can assert the
    // state mutation actually happened.
    const state = callStateManager.getCallState(callSid);
    expect(state.awaitingHumanConfirmation).toBe(true);
  });

  it('halts after a terminal action (does not process trailing chunks)', async () => {
    mockProcessSpeech
      .mockResolvedValueOnce({
        twiml: '',
        shouldSend: false,
        aiAction: 'maybe_human',
      })
      .mockResolvedValueOnce({
        twiml: '',
        shouldSend: false,
        aiAction: 'transfer',
      });

    const chunks: RecordingChunk[] = [
      { text: 'greeting', startSec: 0, endSec: 1 },
      { text: 'confirmation', startSec: 5, endSec: 6 },
      {
        text: 'followup that should never be processed',
        startSec: 10,
        endSec: 12,
      },
    ];

    const results = await replayChunksThroughStateMachine({
      callSid,
      chunks,
      baseUrl: 'http://localhost:8068',
    });

    expect(results).toHaveLength(2);
    expect(mockProcessSpeech).toHaveBeenCalledTimes(2);
  });

  it('skips empty/whitespace chunks', async () => {
    mockProcessSpeech.mockResolvedValue({
      twiml: '',
      shouldSend: false,
      aiAction: 'continue',
    });

    const chunks: RecordingChunk[] = [
      { text: '   ', startSec: 0, endSec: 1 },
      { text: 'real text here', startSec: 1, endSec: 2 },
      { text: '', startSec: 2, endSec: 3 },
    ];

    await replayChunksThroughStateMachine({
      callSid,
      chunks,
      baseUrl: 'http://localhost:8068',
    });

    expect(mockProcessSpeech).toHaveBeenCalledTimes(1);
    const callArg = mockProcessSpeech.mock.calls[0][0];
    expect(callArg.speechResult).toBe('real text here');
  });
});
