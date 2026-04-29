/**
 * Unit test for `injectSyntheticTranscript` — verifies that synthetic
 * injection writes a `conversation/user` event via callHistoryService
 * before/alongside calling onUtterance, so the visualizer/transcript
 * reflects the line that was fed to the AI.
 */

process.env.TELNYX_API_KEY = process.env.TELNYX_API_KEY || 'test-key';
jest.mock('telnyx', () => {
  return jest.fn().mockImplementation(() => ({
    calls: {
      actions: { speak: jest.fn(), answer: jest.fn(), hangup: jest.fn() },
    },
  }));
});

const addConversationMock = jest.fn().mockResolvedValue(undefined);
jest.mock('../../services/callHistoryService', () => ({
  __esModule: true,
  default: {
    addConversation: (...args: unknown[]) => addConversationMock(...args),
    addHoldDetected: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../../services/speechProcessingService', () => ({
  processSpeech: jest.fn().mockResolvedValue(undefined),
}));

import { injectSyntheticTranscript } from '../streamRoutes';

// Reach into the streamRoutes module-private registry through a tiny test
// helper: we re-require the file and seed `activeStreamStates` by simulating
// a registered stream via a typed any-cast on the module's internals.
//
// We don't have a public seed API, so the simplest approach is to construct
// a fake state by accessing the internal Map. The Map is module-scoped, so
// we expose it via a require-time trick: re-import streamRoutes and patch
// its internal map through a cast.
import * as streamRoutesModule from '../streamRoutes';

interface PrivateStreamState {
  callControlId: string;
  dgWs: null;
  audioBuffer: Buffer[];
  transcript: string;
  speechFired: boolean;
  lastUtteranceAt: number;
  silentHoldTimer: null;
  dgReconnects: number;
  dgSilentMs: number;
  dgDisconnectedAt: null;
  reconnectAttempts: number;
  reconnectTimer: null;
  reconnectGiveUp: boolean;
  expectedClose: boolean;
  onUtterance: ((text: string) => Promise<void>) | null;
  semanticWaitTimer: null;
}

function makeFakeState(
  callControlId: string,
  onUtterance: (text: string) => Promise<void>
): PrivateStreamState {
  return {
    callControlId,
    dgWs: null,
    audioBuffer: [],
    transcript: '',
    speechFired: false,
    lastUtteranceAt: Date.now(),
    silentHoldTimer: null,
    dgReconnects: 0,
    dgSilentMs: 0,
    dgDisconnectedAt: null,
    reconnectAttempts: 0,
    reconnectTimer: null,
    reconnectGiveUp: false,
    expectedClose: false,
    onUtterance,
    semanticWaitTimer: null,
  };
}

describe('injectSyntheticTranscript', () => {
  beforeEach(() => {
    addConversationMock.mockClear();
  });

  it('returns false and does not write an event when no stream is registered', () => {
    const ok = injectSyntheticTranscript('unknown-call-id', 'hello');
    expect(ok).toBe(false);
    expect(addConversationMock).not.toHaveBeenCalled();
  });

  it('writes a conversation/user event AND fires onUtterance when a stream is registered', async () => {
    // Seed the module-private map by reaching through the streamRoutes
    // module exports. We added `__testing__` export below to enable this.
    const mod = streamRoutesModule as unknown as {
      __testing__: { activeStreamStates: Map<string, PrivateStreamState> };
    };
    expect(mod.__testing__).toBeDefined();

    const callSid = 'inject-test-call';
    const onUtteranceMock = jest.fn().mockResolvedValue(undefined);
    mod.__testing__.activeStreamStates.set(
      callSid,
      makeFakeState(callSid, onUtteranceMock)
    );

    const text = "Yes, I'm a real person.";
    const ok = injectSyntheticTranscript(callSid, text);
    expect(ok).toBe(true);
    expect(onUtteranceMock).toHaveBeenCalledWith(text);

    // The conversation/user event write is dispatched via dynamic import +
    // .then(); flush microtasks so the .then handler runs.
    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));

    expect(addConversationMock).toHaveBeenCalledTimes(1);
    expect(addConversationMock).toHaveBeenCalledWith(callSid, 'user', text);

    mod.__testing__.activeStreamStates.delete(callSid);
  });
});
