/**
 * Regression: parallel live-fallback tasks must NOT each own their own Mongo
 * connect/disconnect lifecycle. One task's disconnect() kills the shared
 * mongoose connection that sibling tasks are still polling with, which
 * silently breaks callHistoryService.getCall() and misclassifies real call
 * successes as timeouts.
 *
 * See: fix/mongo-connection-race — the live suite was reporting 300s timeouts
 * on calls that actually reached transfer within 150-220s because their
 * poll loops could no longer see the transfer event once a sibling task
 * called disconnect() in its `finally` block.
 *
 * This test statically scans runLiveFallback for the anti-pattern so any
 * future regression (re-adding per-task connect/disconnect) fails in CI
 * without needing a live Mongo or live Telnyx setup.
 */

import * as fs from 'fs';
import * as path from 'path';

describe('runLiveFallback Mongo connection lifecycle', () => {
  it('does not call connect() or disconnect() per-task', () => {
    const src = fs.readFileSync(
      path.join(__dirname, 'replayCallEval.test.ts'),
      'utf8'
    );

    const fnStart = src.indexOf('async function runLiveFallback(');
    expect(fnStart).toBeGreaterThan(-1);

    // Walk brace-by-brace to find the matching close of the function body,
    // skipping anything inside string/template/comment to avoid false matches.
    const bodyStart = src.indexOf('{', fnStart);
    let depth = 0;
    let i = bodyStart;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    const body = src.slice(bodyStart, i + 1);

    // Strip line and block comments so comments that mention "disconnect()"
    // (explaining why it must NOT be called) don't trip the assertion.
    const codeOnly = body
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');

    expect(codeOnly).not.toMatch(/\bconnect\s*\(\s*\)/);
    expect(codeOnly).not.toMatch(/\bdisconnect\s*\(\s*\)/);
  });
});
