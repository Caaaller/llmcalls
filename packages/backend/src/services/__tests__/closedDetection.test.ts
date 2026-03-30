import '../../../jest.setup';
import callHistoryService from '../callHistoryService';
import { hasBusinessClosed } from './liveCallRunner';

jest.mock('../callHistoryService');

const mockGetTerminationReason =
  callHistoryService.getTerminationReason as jest.Mock;
const mockGetCall = callHistoryService.getCall as jest.Mock;

function makeCall(
  events: Array<{ eventType: string; type?: string; text?: string }>
) {
  return { events };
}

function ivrEvent(text: string) {
  return { eventType: 'conversation', type: 'user', text };
}

function aiEvent(text: string) {
  return { eventType: 'conversation', type: 'ai', text };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetTerminationReason.mockResolvedValue(null);
  mockGetCall.mockResolvedValue(null);
});

describe('hasBusinessClosed', () => {
  it('returns true when termination reason is closed_no_menu', async () => {
    mockGetTerminationReason.mockResolvedValue('closed_no_menu');
    expect(await hasBusinessClosed('sid-1')).toBe(true);
  });

  it('returns true when IVR speech contains "our offices are closed"', async () => {
    mockGetCall.mockResolvedValue(
      makeCall([ivrEvent('Sorry, our offices are closed at this time.')])
    );
    expect(await hasBusinessClosed('sid-2')).toBe(true);
  });

  it('returns true when IVR speech contains "business hours"', async () => {
    mockGetCall.mockResolvedValue(
      makeCall([
        ivrEvent(
          'Please call back during our business hours, Monday through Friday.'
        ),
      ])
    );
    expect(await hasBusinessClosed('sid-3')).toBe(true);
  });

  it('returns true when IVR speech contains "after hours"', async () => {
    mockGetCall.mockResolvedValue(
      makeCall([
        ivrEvent('You have reached us after hours. Please call again.'),
      ])
    );
    expect(await hasBusinessClosed('sid-4')).toBe(true);
  });

  it('returns true when IVR speech contains "outside.*hours"', async () => {
    mockGetCall.mockResolvedValue(
      makeCall([
        ivrEvent(
          'This call was received outside of our normal hours of operation.'
        ),
      ])
    );
    expect(await hasBusinessClosed('sid-5')).toBe(true);
  });

  it('returns false for a normal active call with no closed language', async () => {
    mockGetCall.mockResolvedValue(
      makeCall([
        ivrEvent(
          'Thank you for calling. Press 1 for sales, press 2 for support.'
        ),
        aiEvent('I need to speak with a representative.'),
      ])
    );
    expect(await hasBusinessClosed('sid-6')).toBe(false);
  });

  it('returns false when there are no events', async () => {
    mockGetCall.mockResolvedValue(makeCall([]));
    expect(await hasBusinessClosed('sid-7')).toBe(false);
  });

  it('does not trigger on closed language in AI speech (only IVR speech counts)', async () => {
    mockGetCall.mockResolvedValue(
      makeCall([
        aiEvent(
          'The business may be closed right now, but let me try pressing 0.'
        ),
      ])
    );
    expect(await hasBusinessClosed('sid-8')).toBe(false);
  });

  it('returns false when termination reason is unrelated and IVR speech is normal', async () => {
    mockGetTerminationReason.mockResolvedValue('max_turns_reached');
    mockGetCall.mockResolvedValue(makeCall([ivrEvent('Press 1 for support.')]));
    expect(await hasBusinessClosed('sid-9')).toBe(false);
  });

  it('returns false when call has no events at all (null call)', async () => {
    mockGetCall.mockResolvedValue(null);
    expect(await hasBusinessClosed('sid-10')).toBe(false);
  });
});
