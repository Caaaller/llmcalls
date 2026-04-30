// Module-load side-effect guard: ivrNavigatorService instantiates OpenAI/Anthropic
// clients at module load (`new IVRNavigatorService()`), both of which require API
// keys. For unit tests of the pure PressDigitExtractor class we don't need real
// keys — a placeholder lets the constructors initialize.
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-placeholder';
process.env.ANTHROPIC_API_KEY =
  process.env.ANTHROPIC_API_KEY || 'test-placeholder';

import { PressDigitExtractor } from '../ivrNavigatorService';

/**
 * Feed a string into the extractor character-by-character (worst-case
 * fragmentation, mimics how Anthropic's stream emits tokens). Returns the
 * digit on the first delta that completes both action+digit, null otherwise.
 */
function streamCharByChar(
  extractor: PressDigitExtractor,
  s: string
): string | null {
  let result: string | null = null;
  for (const ch of s) {
    const r = extractor.extract(ch);
    if (r && !result) result = r;
  }
  return result;
}

describe('PressDigitExtractor', () => {
  it('detects press_digit + digit when speech comes first (production schema order)', () => {
    const json =
      '{"speech": "", "action": "press_digit", "digit": "3", "reason": "selected option 3"}';
    const ex = new PressDigitExtractor();
    const result = streamCharByChar(ex, json);
    expect(result).toBe('3');
  });

  it('detects digit-then-action order (defensive)', () => {
    const json = '{"digit": "5", "action": "press_digit", "speech": ""}';
    const ex = new PressDigitExtractor();
    const result = streamCharByChar(ex, json);
    expect(result).toBe('5');
  });

  it('does not fire on action=speak', () => {
    const json = '{"speech": "hello", "action": "speak", "reason": "greeting"}';
    const ex = new PressDigitExtractor();
    const result = streamCharByChar(ex, json);
    expect(result).toBeNull();
  });

  it('does not fire on action=wait even if a digit field appears later', () => {
    const json =
      '{"speech": "", "action": "wait", "digit": "0", "reason": "incomplete menu"}';
    const ex = new PressDigitExtractor();
    const result = streamCharByChar(ex, json);
    // Once action is parsed as non-press_digit, extractor short-circuits.
    expect(result).toBeNull();
  });

  it('handles * and # as valid digits', () => {
    const ex1 = new PressDigitExtractor();
    expect(
      streamCharByChar(ex1, '{"action": "press_digit", "digit": "*"}')
    ).toBe('*');
    const ex2 = new PressDigitExtractor();
    expect(
      streamCharByChar(ex2, '{"action": "press_digit", "digit": "#"}')
    ).toBe('#');
  });

  it('is single-shot — returns null after firing', () => {
    const ex = new PressDigitExtractor();
    const r1 = streamCharByChar(ex, '{"action": "press_digit", "digit": "2"}');
    expect(r1).toBe('2');
    const r2 = ex.extract(', "more": "stuff"}');
    expect(r2).toBeNull();
  });

  it('handles whitespace variations between key, colon, value', () => {
    const ex = new PressDigitExtractor();
    const result = streamCharByChar(
      ex,
      '{"action"   :    "press_digit",    "digit"  :  "7"}'
    );
    expect(result).toBe('7');
  });

  it('does not fire when only action is present (digit not yet streamed)', () => {
    const ex = new PressDigitExtractor();
    const partial = '{"speech": "", "action": "press_digit", "reas';
    const result = streamCharByChar(ex, partial);
    expect(result).toBeNull();
  });

  it('does not fire when only digit is present (action not yet streamed)', () => {
    const ex = new PressDigitExtractor();
    const partial = '{"digit": "1", "spee';
    const result = streamCharByChar(ex, partial);
    expect(result).toBeNull();
  });

  it('fires on the exact delta that completes both fields (not before, not after)', () => {
    const ex = new PressDigitExtractor();
    // Action present but digit not yet — should not fire
    expect(ex.extract('{"speech": "", "action": "press_digit", ')).toBeNull();
    // Digit now arrives — should fire on this delta
    expect(ex.extract('"digit": "4",')).toBe('4');
    // Subsequent deltas: no-op
    expect(ex.extract(' "reason": "x"}')).toBeNull();
  });
});
