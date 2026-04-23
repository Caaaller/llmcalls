import { sanitizeSpeakText } from '../../utils/sanitizeSpeakText';

describe('sanitizeSpeakText', () => {
  describe('standalone "press X" utterances', () => {
    const digitWordCases: Array<[string, string]> = [
      ['press zero', 'representative'],
      ['press one', 'representative'],
      ['press two', 'representative'],
      ['press three', 'representative'],
      ['press four', 'representative'],
      ['press five', 'representative'],
      ['press six', 'representative'],
      ['press seven', 'representative'],
      ['press eight', 'representative'],
      ['press nine', 'representative'],
    ];

    test.each(digitWordCases)('"%s" → "%s"', (input, expected) => {
      expect(sanitizeSpeakText(input)).toBe(expected);
    });

    const digitCases: Array<[string, string]> = [
      ['press 0', 'representative'],
      ['press 1', 'representative'],
      ['press 2', 'representative'],
      ['press 3', 'representative'],
      ['press 4', 'representative'],
      ['press 5', 'representative'],
      ['press 6', 'representative'],
      ['press 7', 'representative'],
      ['press 8', 'representative'],
      ['press 9', 'representative'],
    ];

    test.each(digitCases)('"%s" → "%s"', (input, expected) => {
      expect(sanitizeSpeakText(input)).toBe(expected);
    });

    const keyCases: Array<[string, string]> = [
      ['press pound', 'representative'],
      ['press hash', 'representative'],
      ['press star', 'representative'],
      ['press asterisk', 'representative'],
    ];

    test.each(keyCases)('"%s" → "%s"', (input, expected) => {
      expect(sanitizeSpeakText(input)).toBe(expected);
    });
  });

  describe('case-insensitivity', () => {
    it('rewrites "PRESS FIVE" → "representative"', () => {
      expect(sanitizeSpeakText('PRESS FIVE')).toBe('representative');
    });

    it('rewrites "Press Zero" → "representative"', () => {
      expect(sanitizeSpeakText('Press Zero')).toBe('representative');
    });
  });

  describe('in-sentence replacement', () => {
    it('rewrites "press zero" in the middle of a sentence', () => {
      expect(sanitizeSpeakText('To reach the operator press zero.')).toBe(
        'To reach the operator representative.'
      );
    });

    it('rewrites "press 0" in the middle of a sentence', () => {
      expect(sanitizeSpeakText('Please press 0 now.')).toBe(
        'Please representative now.'
      );
    });

    it('rewrites "press the 5 key" in a sentence', () => {
      expect(sanitizeSpeakText('Please press the 5 key to continue.')).toBe(
        'Please representative to continue.'
      );
    });

    it('rewrites "press the pound key" in a sentence', () => {
      expect(sanitizeSpeakText('Enter your ID then press the pound key.')).toBe(
        'Enter your ID then representative.'
      );
    });
  });

  describe('false-positive safety', () => {
    it('does NOT touch "I\'ll press on"', () => {
      expect(sanitizeSpeakText("I'll press on")).toBe("I'll press on");
    });

    it('does NOT touch "press on with this"', () => {
      expect(sanitizeSpeakText('press on with this')).toBe(
        'press on with this'
      );
    });

    it('does NOT touch "under pressure"', () => {
      expect(sanitizeSpeakText('under pressure')).toBe('under pressure');
    });

    it('does NOT touch "press release"', () => {
      expect(sanitizeSpeakText('Issue a press release')).toBe(
        'Issue a press release'
      );
    });

    it('returns empty string unchanged', () => {
      expect(sanitizeSpeakText('')).toBe('');
    });

    it('returns non-matching sentence unchanged', () => {
      expect(sanitizeSpeakText('Hello, how are you?')).toBe(
        'Hello, how are you?'
      );
    });

    it('returns "representative" unchanged', () => {
      expect(sanitizeSpeakText('representative')).toBe('representative');
    });
  });

  describe('trailing punctuation on a bare match', () => {
    it('collapses "press zero." → "representative"', () => {
      expect(sanitizeSpeakText('press zero.')).toBe('representative');
    });

    it('collapses "Press five!" → "representative"', () => {
      expect(sanitizeSpeakText('Press five!')).toBe('representative');
    });
  });
});
