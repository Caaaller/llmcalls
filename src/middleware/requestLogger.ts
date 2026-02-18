/**
 * Request Logger Middleware
 * Automatically logs every request/response in one line.
 * Captures all query params, body fields, and response fields.
 */

import { Request, Response, NextFunction } from 'express';

/**
 * Converts any value into a log-friendly string.
 * Arrays and objects are JSON-stringified to preserve full content.
 */
function formatValue(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

/**
 * Formats all key-value pairs of an object into a space-separated string.
 * Skips null, undefined, empty strings, and any keys in the skip set.
 */
function formatFields(obj: Record<string, unknown>, skip: Set<string> = new Set()): string {
  const pairs: Array<string> = [];
  for (const [key, val] of Object.entries(obj)) {
    if (skip.has(key) || val === undefined || val === null || val === '') continue;
    pairs.push(`${key}=${formatValue(val)}`);
  }
  return pairs.join(' ');
}

/**
 * Summarizes a JSON response body into a compact key=value string.
 * Skips the "success" field since it's redundant with the HTTP status code.
 */
function summarizeResponse(body: unknown): string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return '';

  const obj = body as Record<string, unknown>;
  const parts: Array<string> = [];

  for (const [key, val] of Object.entries(obj)) {
    if (val === undefined || val === null) continue;
    if (key === 'success') continue; // redundant with status code
    parts.push(`${key}=${formatValue(val)}`);
  }

  return parts.join(' ');
}

/**
 * Express middleware that logs every request/response in a single line.
 * Captures method, path, status, duration, all query params, all body fields,
 * and response summary (JSON fields or TwiML verbs). Uses console.error for 5xx.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  if (req.path === '/health') {
    next();
    return;
  }

  const start = Date.now();
  let responseSummary = '';

  // Intercept res.json to capture response fields
  const originalJson = res.json.bind(res);
  res.json = function (body: unknown) {
    responseSummary = summarizeResponse(body);
    return originalJson(body);
  } as Response['json'];

  // Intercept res.send to capture TwiML XML responses
  const originalSend = res.send.bind(res);
  res.send = function (body: unknown) {
    if (typeof body === 'string' && body.includes('</Response>')) {
      responseSummary = `twiml=${body}`;
    }
    return originalSend(body as string);
  } as Response['send'];

  res.on('finish', () => {
    const duration = Date.now() - start;
    const status = res.statusCode;
    const parts: Array<string> = [`${req.method} ${req.path} ${status} ${duration}ms`];

    // Query params
    const query = req.query as Record<string, unknown>;
    const queryStr = formatFields(query);
    if (queryStr) parts.push(queryStr);

    // Body fields
    if (req.body && typeof req.body === 'object') {
      const bodyStr = formatFields(req.body as Record<string, unknown>);
      if (bodyStr) parts.push(bodyStr);
    }

    // Response
    if (responseSummary) parts.push(`-> ${responseSummary}`);

    if (status >= 500) {
      console.error(parts.join(' '));
    } else {
      console.log(parts.join(' '));
    }
  });

  next();
}
