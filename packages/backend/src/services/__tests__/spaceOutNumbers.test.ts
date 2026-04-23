import { spaceOutNumbers } from '../../utils/spaceOutNumbers';

describe('spaceOutNumbers', () => {
  it('splits a contiguous 8-digit member ID', () => {
    expect(spaceOutNumbers('35142679')).toBe('3 5 1 4 2 6 7 9');
  });

  it('handles a dashed US phone number', () => {
    expect(spaceOutNumbers('720-584-6358')).toBe('7 2 0 5 8 4 6 3 5 8');
  });

  it('handles a dashed phone number inside a sentence', () => {
    expect(spaceOutNumbers('My number is 720-584-6358.')).toBe(
      'My number is 7 2 0 5 8 4 6 3 5 8.'
    );
  });

  it('splits a ZIP inside a sentence', () => {
    expect(spaceOutNumbers('ID is 12345')).toBe('ID is 1 2 3 4 5');
  });

  it('leaves single digits untouched', () => {
    expect(spaceOutNumbers('press 1')).toBe('press 1');
    expect(spaceOutNumbers('press 0 to return')).toBe('press 0 to return');
  });

  it('spaces a year inside prose', () => {
    expect(spaceOutNumbers('March 6th 1998')).toBe('March 6th 1 9 9 8');
  });

  it('handles multiple separate numbers', () => {
    expect(spaceOutNumbers('call 5551234 or 6667890 please')).toBe(
      'call 5 5 5 1 2 3 4 or 6 6 6 7 8 9 0 please'
    );
  });

  it('handles space-separated digit groups', () => {
    expect(spaceOutNumbers('720 584 6358')).toBe('7 2 0 5 8 4 6 3 5 8');
  });

  it('is a no-op on text without digits', () => {
    expect(spaceOutNumbers('Hello, how can I help you?')).toBe(
      'Hello, how can I help you?'
    );
  });

  it('handles empty string', () => {
    expect(spaceOutNumbers('')).toBe('');
  });

  it('handles a single digit in isolation', () => {
    expect(spaceOutNumbers('5')).toBe('5');
  });

  it('preserves parentheses around an area code', () => {
    // The regex intentionally does not cross parens; "(720)" becomes "(7 2 0)".
    expect(spaceOutNumbers('(720) 584-6358')).toBe('(7 2 0) 5 8 4 6 3 5 8');
  });
});
