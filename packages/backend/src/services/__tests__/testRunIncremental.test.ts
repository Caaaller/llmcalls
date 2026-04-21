/**
 * Incremental test-run lifecycle: in_progress → updated → terminal.
 * Verifies schema accepts the new statuses and upsert preserves progress.
 *
 * Run: pnpm --filter backend test -- --testPathPatterns=testRunIncremental
 */

import '../../../jest.setup';
import request from 'supertest';
import app from '../../server';
import { connect, disconnect } from '../database';
import TestRun from '../../models/TestRun';

const RUN_ID = `test-run-incremental-${Date.now()}`;

beforeAll(async () => {
  await connect();
  await TestRun.deleteMany({ runId: RUN_ID });
});

afterAll(async () => {
  await TestRun.deleteMany({ runId: RUN_ID });
  await disconnect();
});

describe('Incremental TestRun lifecycle', () => {
  const startedAt = new Date('2026-04-20T10:00:00Z');

  it('accepts initial in_progress POST with pending test cases', async () => {
    await request(app)
      .post('/api/test-runs')
      .send({
        runId: RUN_ID,
        startedAt,
        status: 'in_progress',
        totalTests: 3,
        passedTests: 0,
        failedTests: 0,
        closedTests: 0,
        testCases: [
          {
            testCaseId: 'tc1',
            name: 'A',
            callSid: '',
            status: 'pending',
            durationSeconds: 0,
            timedOut: false,
          },
          {
            testCaseId: 'tc2',
            name: 'B',
            callSid: '',
            status: 'pending',
            durationSeconds: 0,
            timedOut: false,
          },
          {
            testCaseId: 'tc3',
            name: 'C',
            callSid: '',
            status: 'pending',
            durationSeconds: 0,
            timedOut: false,
          },
        ],
      })
      .expect(200);

    const run = await TestRun.findOne({ runId: RUN_ID }).lean();
    expect(run).toBeTruthy();
    expect(run!.status).toBe('in_progress');
    expect(run!.completedAt).toBeUndefined();
    expect(run!.testCases).toHaveLength(3);
    expect(run!.testCases[0].status).toBe('pending');
  });

  it('updates to partial progress with one running, one passed', async () => {
    await request(app)
      .post('/api/test-runs')
      .send({
        runId: RUN_ID,
        startedAt,
        status: 'in_progress',
        totalTests: 3,
        passedTests: 1,
        failedTests: 0,
        closedTests: 0,
        testCases: [
          {
            testCaseId: 'tc1',
            name: 'A',
            callSid: 'CA_1',
            status: 'passed',
            durationSeconds: 30,
            timedOut: false,
          },
          {
            testCaseId: 'tc2',
            name: 'B',
            callSid: 'CA_2',
            status: 'running',
            durationSeconds: 10,
            timedOut: false,
          },
          {
            testCaseId: 'tc3',
            name: 'C',
            callSid: '',
            status: 'pending',
            durationSeconds: 0,
            timedOut: false,
          },
        ],
      })
      .expect(200);

    const run = await TestRun.findOne({ runId: RUN_ID }).lean();
    expect(run!.status).toBe('in_progress');
    expect(run!.completedAt).toBeUndefined();
    expect(run!.passedTests).toBe(1);
    expect(run!.testCases[0].status).toBe('passed');
    expect(run!.testCases[1].status).toBe('running');
    expect(run!.testCases[2].status).toBe('pending');
  });

  it('finalizes with completedAt and terminal status', async () => {
    const completedAt = new Date('2026-04-20T10:05:00Z');
    await request(app)
      .post('/api/test-runs')
      .send({
        runId: RUN_ID,
        startedAt,
        completedAt,
        status: 'passed',
        totalTests: 3,
        passedTests: 3,
        failedTests: 0,
        closedTests: 0,
        testCases: [
          {
            testCaseId: 'tc1',
            name: 'A',
            callSid: 'CA_1',
            status: 'passed',
            durationSeconds: 30,
            timedOut: false,
          },
          {
            testCaseId: 'tc2',
            name: 'B',
            callSid: 'CA_2',
            status: 'passed',
            durationSeconds: 28,
            timedOut: false,
          },
          {
            testCaseId: 'tc3',
            name: 'C',
            callSid: 'CA_3',
            status: 'passed',
            durationSeconds: 25,
            timedOut: false,
          },
        ],
      })
      .expect(200);

    const run = await TestRun.findOne({ runId: RUN_ID }).lean();
    expect(run!.status).toBe('passed');
    expect(run!.completedAt).toBeDefined();
    expect(run!.testCases.every(tc => tc.status === 'passed')).toBe(true);
    // Same runId, should still be a single document (upsert)
    const count = await TestRun.countDocuments({ runId: RUN_ID });
    expect(count).toBe(1);
  });

  it('rejects invalid status values', async () => {
    await request(app)
      .post('/api/test-runs')
      .send({
        runId: `${RUN_ID}-invalid`,
        startedAt,
        status: 'bogus_status',
        totalTests: 1,
        passedTests: 0,
        failedTests: 0,
        closedTests: 0,
        testCases: [
          {
            testCaseId: 'tc1',
            name: 'A',
            callSid: '',
            status: 'pending',
            durationSeconds: 0,
            timedOut: false,
          },
        ],
      })
      .expect(500);
  });
});
