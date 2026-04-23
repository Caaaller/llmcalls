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

process.env.TELNYX_API_KEY = 'test';
process.env.TELNYX_PHONE_NUMBER = '+15555551212';

import { pickSimulatorScript, __testing } from '../simulatorAgentService';

describe('pickSimulatorScript', () => {
  it('returns a script with all required fields populated across 100 calls', () => {
    for (let i = 0; i < 100; i++) {
      const script = pickSimulatorScript();
      expect(script.agentName).toMatch(/^[A-Z][a-z]+$/);
      expect(script.greeting.length).toBeGreaterThan(10);
      expect(script.confirmation.length).toBeGreaterThan(10);
      expect(script.followup.length).toBeGreaterThan(5);
      expect(script.pickupDelayMs).toBeGreaterThanOrEqual(800);
      expect(script.pickupDelayMs).toBeLessThan(2500);
      expect(script.greetingToConfirmationMs).toBeGreaterThanOrEqual(4000);
      expect(script.greetingToConfirmationMs).toBeLessThan(6000);
      expect(script.confirmationToFollowupMs).toBeGreaterThanOrEqual(3000);
      expect(script.confirmationToFollowupMs).toBeLessThan(5000);
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
    expect(__testing.GREETING_TEMPLATES.length).toBeGreaterThanOrEqual(6);
    expect(__testing.CONFIRMATION_TEMPLATES.length).toBeGreaterThanOrEqual(5);
    expect(__testing.FOLLOWUP_TEMPLATES.length).toBeGreaterThanOrEqual(3);
  });
});
