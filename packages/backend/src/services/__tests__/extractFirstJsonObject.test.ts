/**
 * extractFirstJsonObject — unit tests
 *
 * Regression guard for the live bug where greedy /\{[\s\S]*\}/ captured
 * trailing prose that itself contained `}` characters, producing JSON.parse
 * errors like "Unexpected non-whitespace character after JSON at position
 * 1002". When that happened mid-call we spoke an "application error" canned
 * message to the live human agent, who then hung up.
 */

jest.mock('telnyx', () => jest.fn());
jest.mock('openai', () => jest.fn());
jest.mock('@anthropic-ai/sdk', () => jest.fn());
process.env.TELNYX_API_KEY = 'test';
process.env.ANTHROPIC_API_KEY = 'test';

import { extractFirstJsonObject } from '../ivrNavigatorService';

describe('extractFirstJsonObject', () => {
  it('returns null when no JSON is present', () => {
    expect(extractFirstJsonObject('')).toBeNull();
    expect(extractFirstJsonObject('no braces here')).toBeNull();
    expect(extractFirstJsonObject('{ unclosed')).toBeNull();
  });

  it('extracts a simple object at the start', () => {
    const out = extractFirstJsonObject('{"action":"wait","reason":"hold"}');
    expect(JSON.parse(out!)).toEqual({ action: 'wait', reason: 'hold' });
  });

  it('stops at the matching brace when prose follows the JSON', () => {
    const content =
      '{"action":"wait","reason":"hold"}\n\nHere is my reasoning: the system is holding.';
    const out = extractFirstJsonObject(content);
    expect(out).toBe('{"action":"wait","reason":"hold"}');
  });

  it('handles trailing prose that itself contains braces (the live bug)', () => {
    // The exact failure mode: JSON followed by narrative with stray braces.
    // Old greedy regex captured through the last `}`, producing invalid JSON.
    const content = [
      '{"action":"press_digit","digit":"1","reason":"first option"}',
      '',
      'Additional thoughts: this is a promotional menu {not related to support}.',
      'The IVR said "press 1 if you are {50+}".',
    ].join('\n');

    const out = extractFirstJsonObject(content);
    expect(out).toBe(
      '{"action":"press_digit","digit":"1","reason":"first option"}'
    );
    expect(() => JSON.parse(out!)).not.toThrow();
  });

  it('respects braces inside JSON string values', () => {
    const content =
      '{"reason":"user said \\"press 1 if {eligible}\\"","action":"wait"}';
    const out = extractFirstJsonObject(content);
    expect(out).toBe(content);
    expect(JSON.parse(out!)).toEqual({
      reason: 'user said "press 1 if {eligible}"',
      action: 'wait',
    });
  });

  it('handles nested objects correctly', () => {
    const content =
      '{"action":"press_digit","detected":{"menuOptions":[{"digit":"1","option":"sales"}]}}';
    const out = extractFirstJsonObject(content);
    expect(out).toBe(content);
    expect(JSON.parse(out!).detected.menuOptions[0].digit).toBe('1');
  });

  it('handles markdown code fences around the JSON', () => {
    const content = '```json\n{"action":"wait"}\n```\nThat is my answer.';
    const out = extractFirstJsonObject(content);
    expect(JSON.parse(out!)).toEqual({ action: 'wait' });
  });

  it('handles leading prose before the JSON', () => {
    const content =
      'Based on the transcript: {"action":"human_detected","reason":"clear confirmation"}';
    const out = extractFirstJsonObject(content);
    expect(JSON.parse(out!)).toEqual({
      action: 'human_detected',
      reason: 'clear confirmation',
    });
  });

  it('handles escaped backslashes in strings', () => {
    const content = '{"reason":"path is C:\\\\Users\\\\x","action":"wait"}';
    const out = extractFirstJsonObject(content);
    expect(JSON.parse(out!).reason).toBe('path is C:\\Users\\x');
  });
});
