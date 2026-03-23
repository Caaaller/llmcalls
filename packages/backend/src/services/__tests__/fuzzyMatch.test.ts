import { normalizeSpeech, tokenOverlap, isSpeechMatch } from './fuzzyMatch';

describe('normalizeSpeech', () => {
  it('lowercases and strips punctuation', () => {
    expect(normalizeSpeech('Press 1 for Billing!')).toBe('press 1 for billing');
  });

  it('collapses whitespace', () => {
    expect(normalizeSpeech('  hello   world  ')).toBe('hello world');
  });

  it('handles empty string', () => {
    expect(normalizeSpeech('')).toBe('');
  });

  it('handles tabs and newlines', () => {
    expect(normalizeSpeech('hello\t\nworld')).toBe('hello world');
  });

  it('preserves digits in phone numbers', () => {
    expect(normalizeSpeech('Call (800) 555-1234')).toBe('call 800 555 1234');
  });
});

describe('tokenOverlap', () => {
  it('returns 1 for identical strings', () => {
    expect(tokenOverlap('hello world', 'hello world')).toBe(1);
  });

  it('returns 0 for completely disjoint strings', () => {
    expect(tokenOverlap('hello world', 'goodbye universe')).toBe(0);
  });

  it('returns correct Jaccard for partial overlap', () => {
    // "press 1 for billing" vs "press 1 for questions"
    // intersection: {press, 1, for} = 3, union: {press, 1, for, billing, questions} = 5
    expect(tokenOverlap('press 1 for billing', 'press 1 for questions')).toBe(
      3 / 5
    );
  });

  it('returns 1 for both empty', () => {
    expect(tokenOverlap('', '')).toBe(1);
  });

  it('returns 0 when one is empty', () => {
    expect(tokenOverlap('hello', '')).toBe(0);
    expect(tokenOverlap('', 'hello')).toBe(0);
  });
});

describe('isSpeechMatch', () => {
  it('matches identical speech', () => {
    expect(isSpeechMatch('Welcome to Amazon', 'Welcome to Amazon')).toBe(true);
  });

  it('matches with minor variation', () => {
    // "press 1 for billing or account inquiries" vs "press 1 for billing or account questions"
    // 6/8 overlap = 0.75, above 0.7 threshold
    expect(
      isSpeechMatch(
        'Press 1 for billing or account inquiries',
        'Press 1 for billing or account questions'
      )
    ).toBe(true);
  });

  it('rejects completely different speech', () => {
    expect(
      isSpeechMatch('Thank you for calling Acme', 'Goodbye have a nice day')
    ).toBe(false);
  });

  it('uses lower threshold for short speech under 5 tokens', () => {
    // "main menu" vs "menu" — 1 overlap, union of 2, Jaccard = 0.5
    expect(isSpeechMatch('main menu', 'menu')).toBe(true);
  });

  it('rejects short speech that is too different', () => {
    // "main menu" vs "hold please" — 0 overlap
    expect(isSpeechMatch('main menu', 'hold please')).toBe(false);
  });

  it('handles special characters gracefully', () => {
    expect(isSpeechMatch('Press 1 for Español', 'Press 1 for Espanol')).toBe(
      true
    );
  });
});
