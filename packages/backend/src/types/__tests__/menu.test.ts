import { sameMenuShape, type MenuOption } from '../menu';

const opt = (digit: string, option: string): MenuOption => ({ digit, option });

describe('sameMenuShape', () => {
  it('returns true for empty menus', () => {
    expect(sameMenuShape([], [])).toBe(true);
  });

  it('returns false when digit sets differ', () => {
    expect(
      sameMenuShape(
        [opt('1', 'sales'), opt('2', 'support')],
        [opt('1', 'sales'), opt('3', 'support')]
      )
    ).toBe(false);
  });

  it('returns false when lengths differ', () => {
    expect(
      sameMenuShape(
        [opt('1', 'sales'), opt('2', 'support')],
        [opt('1', 'sales')]
      )
    ).toBe(false);
  });

  it('returns true for identical menus', () => {
    const m = [opt('1', 'privilege club'), opt('2', 'travel agent')];
    expect(sameMenuShape(m, m)).toBe(true);
  });

  it('returns true for rephrased same-shape menu (significant word overlap)', () => {
    expect(
      sameMenuShape(
        [opt('1', 'for bookings and reservations')],
        [opt('1', 'regarding bookings, reservations or changes')]
      )
    ).toBe(true);
  });

  it('returns false when same digit maps to genuinely different option', () => {
    // Qatar real case: prior menu (1=privilege/2=travel/3=bookings) vs
    // new menu (1=first class/2=existing/3=new). Same digits, different
    // descriptions, no word overlap → different menu.
    expect(
      sameMenuShape(
        [
          opt('1', 'privilege club member'),
          opt('2', 'travel agent'),
          opt('3', 'bookings and reservations'),
        ],
        [
          opt('1', 'first class business'),
          opt('2', 'existing booking'),
          opt('3', 'new booking'),
        ]
      )
    ).toBe(false);
  });

  it('handles digit-only menus (no descriptions to compare)', () => {
    // Edge case: menus where options are too short to have ≥4-letter words.
    // Default to true if digit set matches and no significant words exist.
    expect(sameMenuShape([opt('1', 'a')], [opt('1', 'b')])).toBe(true);
  });

  it('returns false when only IVR boilerplate words overlap', () => {
    // Staff-review caveat: the original ≥1-word threshold falsely
    // collapsed two distinct submenus that share only IVR boilerplate
    // ("press"). After tightening: requires ≥2 content-word overlap
    // (post-stop-word filter), so these correctly diverge.
    expect(
      sameMenuShape(
        [opt('1', 'for bookings press')],
        [opt('1', 'for cancellations press')]
      )
    ).toBe(false);
  });

  it('still detects same-shape on real rephrasing with multiple content overlaps', () => {
    // Two content words overlap ("hours", "weekend") plus possible others.
    expect(
      sameMenuShape(
        [opt('1', 'business hours weekend coverage')],
        [opt('1', 'extended hours weekend support')]
      )
    ).toBe(true);
  });
});
