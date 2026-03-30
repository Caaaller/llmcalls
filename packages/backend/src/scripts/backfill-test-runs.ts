/**
 * Backfill test runs from existing call history.
 * Matches calls to test cases by phone number, groups by time proximity,
 * and inserts TestRun documents.
 *
 * Run: ts-node src/scripts/backfill-test-runs.ts
 */

import '../loadEnv';
import mongoose from 'mongoose';
import CallHistory from '../models/CallHistory';
import TestRun from '../models/TestRun';
import {
  DEFAULT_TEST_CASES,
  LONG_TEST_CASES,
  TEST_IVR_CASES,
} from '../services/liveCallTestCases';

const ALL_TEST_CASES = [
  ...DEFAULT_TEST_CASES,
  ...LONG_TEST_CASES,
  ...TEST_IVR_CASES,
];

// Max gap between calls in the same run (30 min)
const RUN_GAP_MS = 30 * 60 * 1000;

async function main() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/llmcalls';
  await mongoose.connect(uri);
  console.log('Connected to MongoDB');

  const calls = await CallHistory.find().sort({ startTime: 1 }).lean();

  console.log(`Found ${calls.length} calls total`);

  // Match each call to a test case by phone number
  const matched = calls.flatMap(call => {
    const to = call.metadata?.to;
    if (!to) return [];
    const tc = ALL_TEST_CASES.find(t => t.phoneNumber === to);
    if (!tc) return [];
    return [{ call, tc }];
  });

  console.log(`Matched ${matched.length} calls to test cases`);

  if (matched.length === 0) {
    console.log('No calls matched — nothing to backfill');
    await mongoose.disconnect();
    return;
  }

  // Group into runs by time proximity
  const runs: Array<typeof matched> = [];
  let currentRun: typeof matched = [matched[0]];

  for (let i = 1; i < matched.length; i++) {
    const prev = matched[i - 1].call.startTime.getTime();
    const curr = matched[i].call.startTime.getTime();
    if (curr - prev > RUN_GAP_MS) {
      runs.push(currentRun);
      currentRun = [];
    }
    currentRun.push(matched[i]);
  }
  runs.push(currentRun);

  console.log(`Grouped into ${runs.length} test run(s)`);

  let inserted = 0;
  for (const run of runs) {
    const startedAt = run[0].call.startTime;
    const completedAt = new Date(
      Math.max(...run.map(r => (r.call.endTime || r.call.startTime).getTime()))
    );
    const runId = `run-${startedAt.toISOString()}`;

    const existing = await TestRun.findOne({ runId });
    if (existing) {
      console.log(`Skipping existing run: ${runId}`);
      continue;
    }

    const testCases = run.map(({ call, tc }) => {
      // call.duration is stored in milliseconds; convert to seconds
      const durationMs =
        call.duration ||
        (call.endTime || call.startTime).getTime() - call.startTime.getTime();
      const duration = Math.round(durationMs / 1000);

      // Infer status: if call has a transfer event with success=true → passed
      const hasTransfer = call.events?.some(
        e => e.eventType === 'transfer' && e.success
      );
      const hasHold = call.events?.some(e => e.eventType === 'hold');
      const hasTermination = call.events?.some(
        e => e.eventType === 'termination'
      );
      const status =
        hasTransfer || hasHold
          ? 'passed'
          : hasTermination
            ? 'failed'
            : 'passed';

      return {
        testCaseId: tc.id,
        name: tc.name,
        callSid: call.callSid,
        status: status as 'passed' | 'failed' | 'business_closed',
        durationSeconds: duration,
        timedOut: false,
      };
    });

    const failedTests = testCases.filter(t => t.status === 'failed').length;

    await TestRun.create({
      runId,
      startedAt,
      completedAt,
      status: failedTests > 0 ? 'failed' : 'passed',
      totalTests: testCases.length,
      passedTests: testCases.filter(t => t.status === 'passed').length,
      failedTests,
      closedTests: testCases.filter(t => t.status === 'business_closed').length,
      testCases,
    });

    console.log(
      `Inserted run ${runId} (${testCases.length} tests, started ${startedAt.toISOString()})`
    );
    inserted++;
  }

  console.log(`\nDone. Inserted ${inserted} test run(s).`);
  await mongoose.disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
