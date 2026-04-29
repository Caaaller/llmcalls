/**
 * Simulator Agent Service — unit tests
 *
 * Validates `pickSimulatorScript` returns a valid shape and enough variance
 * across repeated calls. Does not spin up Telnyx — the script picker is
 * pure, and the flow orchestrator is exercised here only indirectly
 * through its dependencies being mockable.
 */

jest.mock('telnyx', () => {
  return jest.fn().mockImplementation(() => ({
    calls: {
      actions: {
        speak: jest.fn().mockResolvedValue(undefined),
        answer: jest.fn().mockResolvedValue(undefined),
        hangup: jest.fn().mockResolvedValue(undefined),
      },
    },
  }));
});

const mockFindAiLegForSimulator = jest.fn();
const mockInjectSyntheticTranscript = jest.fn();
const mockHasRealUtteranceSince = jest.fn();
jest.mock('../../routes/streamRoutes', () => ({
  findAiLegForSimulator: (...args: unknown[]) =>
    mockFindAiLegForSimulator(...args),
  injectSyntheticTranscript: (...args: unknown[]) =>
    mockInjectSyntheticTranscript(...args),
  hasRealUtteranceSince: (...args: unknown[]) =>
    mockHasRealUtteranceSince(...args),
}));

process.env.TELNYX_API_KEY = 'test';
process.env.TELNYX_PHONE_NUMBER = '+15555551212';

import {
  pickSimulatorScript,
  matchesConfirmationQuestion,
  isActiveSimulatorCall,
  handleSimulatorTranscript,
  handleSimulatorSpeakEnded,
  __testing,
} from '../simulatorAgentService';

describe('pickSimulatorScript', () => {
  it('returns a script with all required fields populated across 100 calls', () => {
    for (let i = 0; i < 100; i++) {
      const script = pickSimulatorScript();
      expect(script.agentName).toMatch(/^[A-Z][a-z]+$/);
      expect(script.greeting.length).toBeGreaterThan(10);
      expect(script.confirmation.length).toBeGreaterThan(10);
      expect(script.followup.length).toBeGreaterThan(5);
      expect(script.pickupDelayMs).toBeGreaterThanOrEqual(3000);
      expect(script.pickupDelayMs).toBeLessThan(5000);
      expect(script.greetingToConfirmationMs).toBeGreaterThanOrEqual(18000);
      expect(script.greetingToConfirmationMs).toBeLessThan(25500);
      expect(script.confirmationToFollowupMs).toBeGreaterThanOrEqual(4000);
      expect(script.confirmationToFollowupMs).toBeLessThan(6500);
    }
  });

  it('produces at least 4 distinct agent names across 100 calls', () => {
    const names = new Set<string>();
    for (let i = 0; i < 100; i++) {
      names.add(pickSimulatorScript().agentName);
    }
    expect(names.size).toBeGreaterThanOrEqual(4);
  });

  it('produces at least 3 distinct greetings across 100 calls', () => {
    const greetings = new Set<string>();
    for (let i = 0; i < 100; i++) {
      // Strip the name to compare templates (names vary independently).
      const g = pickSimulatorScript().greeting;
      // Remove any capitalized word (name) to collapse to template shape.
      greetings.add(g.replace(/\b[A-Z][a-z]+\b/g, '{name}'));
    }
    expect(greetings.size).toBeGreaterThanOrEqual(3);
  });

  it('never emits a template placeholder that was not substituted', () => {
    for (let i = 0; i < 100; i++) {
      const script = pickSimulatorScript();
      expect(script.greeting).not.toMatch(/\{\w+\}/);
      expect(script.confirmation).not.toMatch(/\{\w+\}/);
      expect(script.followup).not.toMatch(/\{\w+\}/);
    }
  });

  it('includes the picked agentName in the greeting', () => {
    for (let i = 0; i < 50; i++) {
      const script = pickSimulatorScript();
      expect(script.greeting).toContain(script.agentName);
    }
  });
});

describe('simulator script pools', () => {
  it('exposes non-empty pools for names, greetings, confirmations, followups', () => {
    expect(__testing.AGENT_NAMES.length).toBeGreaterThanOrEqual(8);
    expect(__testing.GREETING_TEMPLATES.length).toBeGreaterThanOrEqual(4);
    expect(__testing.CONFIRMATION_TEMPLATES.length).toBeGreaterThanOrEqual(5);
    expect(__testing.FOLLOWUP_TEMPLATES.length).toBeGreaterThanOrEqual(3);
    expect(__testing.CONFIRMATION_KEYWORDS.length).toBeGreaterThanOrEqual(5);
  });
});

describe('matchesConfirmationQuestion', () => {
  const positives = [
    'Hi, am I speaking with a live agent?',
    'Am I speaking with a real person?',
    'Are you a real human?',
    'Is this a real human or a bot?',
    'Hi there, are you human?',
    'Just confirming — am I speaking to a live rep?',
    'Quick check, are you real?',
    'Sorry to ask — is this a person or an automated system?',
    'Hi there! Live agent or bot?',
    'Bot or human?',
  ];

  const negatives = [
    'Hi, thanks for calling customer service, this is Jamie speaking, how can I help you today?',
    "Hello, you've reached our support team.",
    'Please hold while I connect you.',
    'Your call is important to us.',
    '',
    "What's the issue you're calling about today?",
  ];

  it.each(positives)('matches confirmation phrase: %s', phrase => {
    expect(matchesConfirmationQuestion(phrase)).toBe(true);
  });

  it.each(negatives)('does NOT match non-confirmation phrase: %s', phrase => {
    expect(matchesConfirmationQuestion(phrase)).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(
      matchesConfirmationQuestion('AM I SPEAKING WITH A LIVE AGENT?')
    ).toBe(true);
    expect(matchesConfirmationQuestion('Are You A Real Person')).toBe(true);
  });
});

describe('handleSimulatorTranscript', () => {
  const callControlId = 'test-sim-call-1';

  beforeEach(() => {
    __testing.activeSimulatorCalls.clear();
  });

  it('is a no-op for unknown call ids', () => {
    expect(isActiveSimulatorCall(callControlId)).toBe(false);
    expect(() =>
      handleSimulatorTranscript(callControlId, 'are you a real person?')
    ).not.toThrow();
  });

  it('triggers the confirmation when a keyword matches and stage is awaiting', () => {
    let triggered = false;
    __testing.activeSimulatorCalls.set(callControlId, {
      script: pickSimulatorScript(),
      startedAt: Date.now(),
      stage: 'awaiting-confirmation-question',
      confirmationTriggered: () => {
        triggered = true;
      },
      awaitConfirmation: Promise.resolve(),
      pendingSpeakEnded: null,
      aiLegSpeaking: false,
    });

    handleSimulatorTranscript(
      callControlId,
      'Hi there, am I speaking with a live agent?'
    );
    expect(triggered).toBe(true);
  });

  it('does NOT trigger when stage is past awaiting-confirmation', () => {
    let triggered = false;
    __testing.activeSimulatorCalls.set(callControlId, {
      script: pickSimulatorScript(),
      startedAt: Date.now(),
      stage: 'confirmation-spoken',
      confirmationTriggered: () => {
        triggered = true;
      },
      awaitConfirmation: Promise.resolve(),
      pendingSpeakEnded: null,
      aiLegSpeaking: false,
    });

    handleSimulatorTranscript(
      callControlId,
      'Hi there, am I speaking with a live agent?'
    );
    expect(triggered).toBe(false);
  });

  it('does NOT trigger on a non-matching transcript', () => {
    let triggered = false;
    __testing.activeSimulatorCalls.set(callControlId, {
      script: pickSimulatorScript(),
      startedAt: Date.now(),
      stage: 'awaiting-confirmation-question',
      confirmationTriggered: () => {
        triggered = true;
      },
      awaitConfirmation: Promise.resolve(),
      pendingSpeakEnded: null,
      aiLegSpeaking: false,
    });

    handleSimulatorTranscript(callControlId, 'Please hold for one moment.');
    expect(triggered).toBe(false);
  });

  it('handleSimulatorSpeakEnded resolves a pending waiter and clears it', () => {
    let resolved = false;
    __testing.activeSimulatorCalls.set(callControlId, {
      script: pickSimulatorScript(),
      startedAt: Date.now(),
      stage: 'awaiting-confirmation-question',
      confirmationTriggered: () => {},
      awaitConfirmation: Promise.resolve(),
      pendingSpeakEnded: () => {
        resolved = true;
      },
      aiLegSpeaking: false,
    });
    handleSimulatorSpeakEnded(callControlId);
    expect(resolved).toBe(true);
    expect(
      __testing.activeSimulatorCalls.get(callControlId)?.pendingSpeakEnded
    ).toBe(null);
  });

  it('handleSimulatorSpeakEnded is a no-op when no waiter pending', () => {
    __testing.activeSimulatorCalls.set(callControlId, {
      script: pickSimulatorScript(),
      startedAt: Date.now(),
      stage: 'confirmation-spoken',
      confirmationTriggered: () => {},
      awaitConfirmation: Promise.resolve(),
      pendingSpeakEnded: null,
      aiLegSpeaking: false,
    });
    expect(() => handleSimulatorSpeakEnded(callControlId)).not.toThrow();
  });

  it('handleSimulatorSpeakEnded is a no-op for unknown call ids when no simulator is active', () => {
    expect(() => handleSimulatorSpeakEnded('unknown-id')).not.toThrow();
  });

  it('handleSimulatorSpeakEnded on an UNRELATED leg triggers confirmation when sim is awaiting', () => {
    let triggered = false;
    __testing.activeSimulatorCalls.set(callControlId, {
      script: pickSimulatorScript(),
      startedAt: Date.now(),
      stage: 'awaiting-confirmation-question',
      confirmationTriggered: () => {
        triggered = true;
      },
      awaitConfirmation: Promise.resolve(),
      pendingSpeakEnded: null,
      aiLegSpeaking: false,
    });
    // A `call.speak.ended` from a DIFFERENT call_control_id (the AI-caller
    // leg of the same self-call pair) should trigger confirmation.
    handleSimulatorSpeakEnded('other-leg-id');
    expect(triggered).toBe(true);
  });

  it('handleSimulatorSpeakEnded on an UNRELATED leg is a no-op when sim is past awaiting', () => {
    let triggered = false;
    __testing.activeSimulatorCalls.set(callControlId, {
      script: pickSimulatorScript(),
      startedAt: Date.now(),
      stage: 'confirmation-spoken',
      confirmationTriggered: () => {
        triggered = true;
      },
      awaitConfirmation: Promise.resolve(),
      pendingSpeakEnded: null,
      aiLegSpeaking: false,
    });
    handleSimulatorSpeakEnded('other-leg-id');
    expect(triggered).toBe(false);
  });

  describe('dispatchSyntheticConfirmationToAiLeg', () => {
    beforeEach(() => {
      mockFindAiLegForSimulator.mockReset();
      mockInjectSyntheticTranscript.mockReset();
    });

    it('injects the confirmation text onto the AI-leg stream when one is found', async () => {
      mockFindAiLegForSimulator.mockReturnValue('ai-leg-id');
      mockInjectSyntheticTranscript.mockReturnValue(true);
      await __testing.dispatchSyntheticConfirmationToAiLeg(
        'sim-leg-id',
        "Yes, I'm a real person.",
        Date.now()
      );
      expect(mockFindAiLegForSimulator).toHaveBeenCalledWith('sim-leg-id');
      expect(mockInjectSyntheticTranscript).toHaveBeenCalledWith(
        'ai-leg-id',
        "Yes, I'm a real person."
      );
    });

    it('skips injection when no AI-leg stream is registered', async () => {
      mockFindAiLegForSimulator.mockReturnValue(null);
      await __testing.dispatchSyntheticConfirmationToAiLeg(
        'sim-leg-id',
        'irrelevant text',
        Date.now()
      );
      expect(mockInjectSyntheticTranscript).not.toHaveBeenCalled();
    });
  });

  describe('dispatchSyntheticGreetingToAiLeg', () => {
    beforeEach(() => {
      mockFindAiLegForSimulator.mockReset();
      mockInjectSyntheticTranscript.mockReset();
    });

    it('injects the greeting text onto the AI-leg stream when one is found', async () => {
      mockFindAiLegForSimulator.mockReturnValue('ai-leg-id');
      mockInjectSyntheticTranscript.mockReturnValue(true);
      await __testing.dispatchSyntheticGreetingToAiLeg(
        'sim-leg-id',
        'Good afternoon, this is Maria speaking.',
        Date.now()
      );
      expect(mockFindAiLegForSimulator).toHaveBeenCalledWith('sim-leg-id');
      expect(mockInjectSyntheticTranscript).toHaveBeenCalledWith(
        'ai-leg-id',
        'Good afternoon, this is Maria speaking.'
      );
    });

    it('skips injection when no AI-leg stream is registered', async () => {
      mockFindAiLegForSimulator.mockReturnValue(null);
      await __testing.dispatchSyntheticGreetingToAiLeg(
        'sim-leg-id',
        'irrelevant greeting',
        Date.now()
      );
      expect(mockInjectSyntheticTranscript).not.toHaveBeenCalled();
    });
  });

  it('reports active simulator calls correctly', () => {
    expect(isActiveSimulatorCall(callControlId)).toBe(false);
    __testing.activeSimulatorCalls.set(callControlId, {
      script: pickSimulatorScript(),
      startedAt: Date.now(),
      stage: 'awaiting-confirmation-question',
      confirmationTriggered: () => {},
      awaitConfirmation: Promise.resolve(),
      pendingSpeakEnded: null,
      aiLegSpeaking: false,
    });
    expect(isActiveSimulatorCall(callControlId)).toBe(true);
  });
});
