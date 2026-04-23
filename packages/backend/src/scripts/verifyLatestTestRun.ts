/**
 * Verify the most recent test run registered correctly in the UI.
 *
 * Checks the latest `testruns` document and confirms:
 *   1. Created within the last `--within-minutes` (default 20).
 *   2. Status is `passed` or `failed` — NOT `in_progress` or `aborted`.
 *   3. `testCases.length > 0` (actually ran tests, not an empty probe).
 *   4. `completedAt` is set.
 *
 * Exit 0 on pass, 1 on fail. Prints a short report.
 *
 * Usage:
 *   pnpm --filter backend ts-node src/scripts/verifyLatestTestRun.ts
 *   pnpm --filter backend ts-node src/scripts/verifyLatestTestRun.ts --within-minutes 60
 */

import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '..', '..', '..', '.env') });

const argvIdx = process.argv.indexOf('--within-minutes');
const WITHIN_MIN = argvIdx > -1 ? Number(process.argv[argvIdx + 1]) : 20;

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI not set');
    process.exit(1);
  }
  await mongoose.connect(uri);
  try {
    const col = mongoose.connection.db!.collection('testruns');
    const latest = await col.findOne({}, { sort: { startedAt: -1 } });
    if (!latest) {
      console.error('❌ No testruns found in MongoDB');
      process.exit(1);
    }
    const ageMs = Date.now() - new Date(latest.startedAt).getTime();
    const ageMin = Math.round(ageMs / 60000);
    const failures: string[] = [];

    if (ageMin > WITHIN_MIN) {
      failures.push(
        `latest testrun is ${ageMin}min old (threshold ${WITHIN_MIN}min) — did the run register at all?`
      );
    }
    if (latest.status === 'in_progress') {
      failures.push(`status=in_progress — run never posted final status`);
    }
    if (latest.status === 'aborted') {
      failures.push(`status=aborted — jest was killed mid-run`);
    }
    if (latest.status !== 'passed' && latest.status !== 'failed') {
      failures.push(`unexpected status=${latest.status}`);
    }
    if (!Array.isArray(latest.testCases) || latest.testCases.length === 0) {
      failures.push('testCases is empty or missing');
    }
    if (!latest.completedAt) {
      failures.push('completedAt is not set');
    }

    console.log('Latest testrun:');
    console.log('  runId:       ' + latest.runId);
    console.log(
      '  startedAt:   ' +
        new Date(latest.startedAt).toISOString() +
        ` (${ageMin} min ago)`
    );
    console.log(
      '  completedAt: ' +
        (latest.completedAt
          ? new Date(latest.completedAt).toISOString()
          : 'missing')
    );
    console.log('  status:      ' + latest.status);
    console.log('  testCases:   ' + (latest.testCases?.length ?? 0));
    console.log(
      '  passed/failed/closed: ' +
        latest.passedTests +
        '/' +
        latest.failedTests +
        '/' +
        (latest.closedTests ?? 0)
    );

    if (failures.length > 0) {
      console.error('');
      console.error('❌ FAIL — ' + failures.length + ' problem(s):');
      for (const f of failures) console.error('  - ' + f);
      process.exit(1);
    }
    console.log('');
    console.log('✅ Latest testrun registered correctly.');
    process.exit(0);
  } finally {
    await mongoose.disconnect();
  }
}

void main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
