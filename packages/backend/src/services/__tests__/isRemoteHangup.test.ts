/**
 * Unit tests for `isRemoteHangup` — the helper that classifies a finished
 * call as "far end disconnected before success" so the live-eval suite can
 * mark it `remote_hangup` instead of failing.
 *
 * Regression: self-call simulator tests were being misclassified as
 * remote_hangup even when the AI caller's `transfer` event had fired,
 * because the simulator leg's hangup webhook landed before the transfer
 * event finished committing on the AI caller's call document. The settle
 * window in `isRemoteHangup` absorbs that race.
 */

import '../../../jest.setup';
import { isRemoteHangup } from './liveCallRunner';
import callHistoryService from '../callHistoryService';

jest.mock('../callHistoryService', () => ({
  __esModule: true,
  default: {
    hasSuccessfulTransfer: jest.fn(),
    hasReachedHoldQueue: jest.fn(),
    getCall: jest.fn(),
    getTerminationReason: jest.fn(),
  },
}));

const mocked = callHistoryService as unknown as {
  hasSuccessfulTransfer: jest.Mock;
  hasReachedHoldQueue: jest.Mock;
  getCall: jest.Mock;
  getTerminationReason: jest.Mock;
};

beforeEach(() => {
  mocked.hasSuccessfulTransfer.mockReset();
  mocked.hasReachedHoldQueue.mockReset();
  mocked.getCall.mockReset();
  mocked.getTerminationReason.mockReset();
});

describe('isRemoteHangup', () => {
  it('returns false when timed out', async () => {
    expect(await isRemoteHangup('sid', true)).toBe(false);
    expect(mocked.hasSuccessfulTransfer).not.toHaveBeenCalled();
  });

  it('returns false immediately when transfer fired', async () => {
    mocked.hasSuccessfulTransfer.mockResolvedValueOnce(true);
    expect(await isRemoteHangup('sid', false)).toBe(false);
    expect(mocked.hasSuccessfulTransfer).toHaveBeenCalledTimes(1);
  });

  it('returns false when transfer event lands during the settle window', async () => {
    // First read misses the transfer (race vs simulator-leg hangup webhook),
    // subsequent read finds it once the event-write commits.
    mocked.hasSuccessfulTransfer
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    expect(await isRemoteHangup('sid', false)).toBe(false);
    expect(mocked.hasSuccessfulTransfer).toHaveBeenCalledTimes(2);
    expect(mocked.hasReachedHoldQueue).not.toHaveBeenCalled();
  });

  it('returns false when on hold', async () => {
    mocked.hasSuccessfulTransfer.mockResolvedValue(false);
    mocked.hasReachedHoldQueue.mockResolvedValueOnce(true);
    expect(await isRemoteHangup('sid', false)).toBe(false);
  });

  it('returns true when call ended cleanly with no transfer/hold', async () => {
    mocked.hasSuccessfulTransfer.mockResolvedValue(false);
    mocked.hasReachedHoldQueue.mockResolvedValueOnce(false);
    mocked.getTerminationReason.mockResolvedValue(null);
    mocked.getCall.mockResolvedValue({ status: 'completed', events: [] });
    expect(await isRemoteHangup('sid', false)).toBe(true);
  });

  it('returns false when call is still in-progress', async () => {
    mocked.hasSuccessfulTransfer.mockResolvedValue(false);
    mocked.hasReachedHoldQueue.mockResolvedValueOnce(false);
    mocked.getTerminationReason.mockResolvedValueOnce(null);
    mocked.getCall.mockResolvedValueOnce({ status: 'in-progress', events: [] });
    expect(await isRemoteHangup('sid', false)).toBe(false);
  });
});
