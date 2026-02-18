/**
 * Request Logger Middleware
 * Automatically logs every request with method, path, status, duration,
 * key request fields, and response summary.
 *
 * Replaces manual "endpoint called" / "speech received" / "call status" logs
 * and manual response logging ("Call initiated", "TwiML response sent", etc.)
 */

import { Request, Response, NextFunction } from 'express';

const MAX_SPEECH_LOG = 80;

function extractTwimlVerbs(xml: string): string {
  const verbs = ['Gather', 'Dial', 'Say', 'Hangup', 'Redirect', 'Pause', 'Play'];
  const found = verbs.filter(v => xml.includes(`<${v}`));
  return found.length > 0 ? found.join('+') : 'empty';
}

function stringify(val: unknown): string {
  if (typeof val === 'string') return val;
  return JSON.stringify(val);
}

function summarizeJson(body: unknown): string {
  if (!body || typeof body !== 'object') return '';

  const obj = body as Record<string, unknown>;

  // Error responses
  if (obj.success === false && obj.error) {
    return `error="${stringify(obj.error).slice(0, 100)}"`;
  }

  // Call initiation response
  if (obj.call && typeof obj.call === 'object') {
    const call = obj.call as Record<string, unknown>;
    if (call.sid) return `call=${call.sid}`;
  }

  // List responses — find the first array and log its count
  for (const key of Object.keys(obj)) {
    if (Array.isArray(obj[key])) {
      return `${(obj[key] as Array<unknown>).length} ${key}`;
    }
  }

  // Generic success
  if (obj.success === true) return 'ok';

  return '';
}

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  if (req.path === '/health') {
    next();
    return;
  }

  const start = Date.now();
  let responseSummary = '';

  // Intercept res.json to capture JSON response summary
  const originalJson = res.json.bind(res);
  res.json = function (body: unknown) {
    responseSummary = summarizeJson(body);
    return originalJson(body);
  } as Response['json'];

  // Intercept res.send to capture TwiML response summary
  const originalSend = res.send.bind(res);
  res.send = function (body: unknown) {
    if (typeof body === 'string' && body.includes('</Response>')) {
      responseSummary = `twiml=${extractTwimlVerbs(body)}`;
    }
    return originalSend(body as string);
  } as Response['send'];

  res.on('finish', () => {
    const duration = Date.now() - start;
    const status = res.statusCode;
    const parts: Array<string> = [`${req.method} ${req.path} ${status} ${duration}ms`];

    // Voice route request fields
    if (req.path.startsWith('/voice')) {
      const body = req.body || {};
      if (body.CallSid) parts.push(`[${body.CallSid}]`);
      if (body.SpeechResult) {
        const speech = body.SpeechResult.length > MAX_SPEECH_LOG
          ? body.SpeechResult.slice(0, MAX_SPEECH_LOG) + '…'
          : body.SpeechResult;
        parts.push(`speech="${speech}"`);
      }
      if (body.Digits || req.query.Digits) parts.push(`digits=${body.Digits || req.query.Digits}`);
      if (body.CallStatus) parts.push(`status=${body.CallStatus}`);
    }

    // Response summary
    if (responseSummary) parts.push(`-> ${responseSummary}`);

    // Use console.error for 5xx so they stand out
    if (status >= 500) {
      console.error(parts.join(' '));
    } else {
      console.log(parts.join(' '));
    }
  });

  next();
}
