/**
 * Debug Routes — non-production utilities for deterministic reproduction of
 * edge-case failures (e.g. simulating a Deepgram WS 1006 disconnect).
 *
 * Every handler MUST short-circuit with a 404 in production.
 */

import express, { Request, Response } from 'express';
import { killDeepgramWsForCall, getReconnectTelemetry } from './streamRoutes';

const router: express.Router = express.Router();

function blockInProd(res: Response): boolean {
  if (process.env.NODE_ENV === 'production') {
    res.status(404).json({ success: false, error: 'Not found' });
    return true;
  }
  return false;
}

/**
 * Force-close the Deepgram WebSocket for the given callSid with a simulated
 * abnormal 1006 close. Used by the reconnect integration test and for manual
 * repro when debugging the live-call deaf-tail bug.
 */
router.post('/kill-deepgram-ws/:callSid', (req: Request, res: Response) => {
  if (blockInProd(res)) return;
  const callSid = String(req.params.callSid);
  const killed = killDeepgramWsForCall(callSid);
  if (!killed) {
    res
      .status(404)
      .json({ success: false, error: 'No active stream for callSid' });
    return;
  }
  res.json({ success: true, callSid, action: 'deepgram-ws-terminated' });
});

/**
 * Read the current reconnect telemetry (dg_reconnects, dg_silent_ms) for a
 * live call. Useful while reproducing the bug manually.
 */
router.get('/reconnect-telemetry/:callSid', (req: Request, res: Response) => {
  if (blockInProd(res)) return;
  const callSid = String(req.params.callSid);
  const telemetry = getReconnectTelemetry(callSid);
  if (!telemetry) {
    res
      .status(404)
      .json({ success: false, error: 'No active stream for callSid' });
    return;
  }
  res.json({ success: true, callSid, ...telemetry });
});

export default router;
