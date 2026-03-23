/**
 * Test Runs API + Recording Integration Tests
 *
 * Verifies the full flow: POST a run, list runs, get detail,
 * expand a call with events/recording, delete a run.
 * Uses a fake MP3 fixture to verify audio exists.
 *
 * Run: pnpm --filter backend test -- --testPathPatterns=testRuns
 */

import '../../../jest.setup';
import request from 'supertest';
import path from 'path';
import fs from 'fs';
import app from '../../server';
import { connect, disconnect } from '../database';
import TestRun from '../../models/TestRun';
import callHistoryService from '../callHistoryService';
import CallHistory from '../../models/CallHistory';

const FAKE_MP3_PATH = path.join(__dirname, 'fixtures', 'fake-recording.mp3');
const TEST_RUN_ID = `test-run-${Date.now()}`;
const TEST_CALL_SID = `CA_test_${Date.now()}`;

beforeAll(async () => {
  await connect();
  await TestRun.deleteMany({ runId: { $regex: /^test-run-/ } });
});

afterAll(async () => {
  await TestRun.deleteMany({ runId: { $regex: /^test-run-/ } });
  await CallHistory.deleteMany({ callSid: { $regex: /^CA_test_|^CA_e2e_/ } });
  await disconnect();
});

describe('Test Runs API', () => {
  const runPayload = {
    runId: TEST_RUN_ID,
    startedAt: new Date('2026-03-20T10:00:00Z'),
    completedAt: new Date('2026-03-20T10:05:00Z'),
    status: 'passed' as const,
    totalTests: 3,
    passedTests: 2,
    failedTests: 1,
    testCases: [
      {
        testCaseId: 'tc-1',
        name: 'Wells Fargo CS',
        callSid: TEST_CALL_SID,
        status: 'passed' as const,
        durationSeconds: 42,
        timedOut: false,
      },
      {
        testCaseId: 'tc-2',
        name: 'Chase Balance',
        callSid: `${TEST_CALL_SID}_2`,
        status: 'passed' as const,
        durationSeconds: 38,
        timedOut: false,
      },
      {
        testCaseId: 'tc-3',
        name: 'Comcast Support',
        callSid: `${TEST_CALL_SID}_3`,
        status: 'failed' as const,
        durationSeconds: 55,
        error: 'Expected transfer but call terminated',
        timedOut: false,
      },
    ],
  };

  it('POST /api/test-runs creates a new run', async () => {
    const res = await request(app)
      .post('/api/test-runs')
      .send(runPayload)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.testRun.runId).toBe(TEST_RUN_ID);
    expect(res.body.testRun.totalTests).toBe(3);
    expect(res.body.testRun.testCases).toHaveLength(3);
  });

  it('POST /api/test-runs upserts on duplicate runId', async () => {
    const updated = {
      ...runPayload,
      passedTests: 3,
      failedTests: 0,
      status: 'passed' as const,
    };
    const res = await request(app)
      .post('/api/test-runs')
      .send(updated)
      .expect(200);

    expect(res.body.testRun.passedTests).toBe(3);

    const count = await TestRun.countDocuments({ runId: TEST_RUN_ID });
    expect(count).toBe(1);
  });

  it('POST /api/test-runs rejects missing runId', async () => {
    const res = await request(app)
      .post('/api/test-runs')
      .send({ testCases: [] })
      .expect(400);

    expect(res.body.error).toMatch(/runId/);
  });

  it('POST /api/test-runs rejects missing testCases', async () => {
    const res = await request(app)
      .post('/api/test-runs')
      .send({ runId: 'some-id' })
      .expect(400);

    expect(res.body.error).toMatch(/testCases/);
  });

  it('GET /api/test-runs lists runs without testCases', async () => {
    const res = await request(app).get('/api/test-runs').expect(200);

    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.runs)).toBe(true);

    const ourRun = res.body.runs.find(
      (r: { runId: string }) => r.runId === TEST_RUN_ID
    );
    expect(ourRun).toBeDefined();
    expect(ourRun.totalTests).toBe(3);
    expect(ourRun.testCases).toBeUndefined();
  });

  it('GET /api/test-runs/:runId returns full detail with testCases', async () => {
    const res = await request(app)
      .get(`/api/test-runs/${encodeURIComponent(TEST_RUN_ID)}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.run.runId).toBe(TEST_RUN_ID);
    expect(res.body.run.testCases).toHaveLength(3);
    expect(res.body.run.testCases[2].error).toBe(
      'Expected transfer but call terminated'
    );
  });

  it('GET /api/test-runs/:runId returns 404 for unknown run', async () => {
    const res = await request(app)
      .get('/api/test-runs/nonexistent-run')
      .expect(404);

    expect(res.body.error).toMatch(/not found/i);
  });

  it('DELETE /api/test-runs/:runId removes the run', async () => {
    const deleteRunId = `test-run-delete-${Date.now()}`;
    await request(app)
      .post('/api/test-runs')
      .send({ ...runPayload, runId: deleteRunId });

    await request(app)
      .delete(`/api/test-runs/${encodeURIComponent(deleteRunId)}`)
      .expect(200);

    await request(app)
      .get(`/api/test-runs/${encodeURIComponent(deleteRunId)}`)
      .expect(404);
  });
});

describe('Call detail for test run drill-down', () => {
  beforeAll(async () => {
    await callHistoryService.startCall(TEST_CALL_SID, {
      to: '+18005551234',
      from: '+15551234567',
      callPurpose: 'Check account balance',
    });
    await callHistoryService.addConversation(
      TEST_CALL_SID,
      'ai',
      'Welcome to the automated system.',
      new Date('2026-03-20T10:00:05Z')
    );
    await callHistoryService.addDTMF(
      TEST_CALL_SID,
      '1',
      'Account balance',
      new Date('2026-03-20T10:00:08Z')
    );
    await callHistoryService.addIVRMenu(
      TEST_CALL_SID,
      [
        { digit: '1', option: 'Checking' },
        { digit: '2', option: 'Savings' },
      ],
      new Date('2026-03-20T10:00:12Z')
    );
    await callHistoryService.addTransfer(
      TEST_CALL_SID,
      '+18005559999',
      true,
      new Date('2026-03-20T10:00:22Z')
    );
  });

  it('call has expected events for View Call drill-down', async () => {
    const call = await callHistoryService.getCall(TEST_CALL_SID);
    expect(call).toBeTruthy();
    expect(call!.events!.length).toBeGreaterThanOrEqual(4);

    const types = call!.events!.map((e: { eventType: string }) => e.eventType);
    expect(types).toContain('conversation');
    expect(types).toContain('dtmf');
    expect(types).toContain('ivr_menu');
    expect(types).toContain('transfer');

    const dtmf = call!.events!.find(
      (e: { eventType: string }) => e.eventType === 'dtmf'
    );
    expect(dtmf!.digit).toBe('1');

    const transfer = call!.events!.find(
      (e: { eventType: string }) => e.eventType === 'transfer'
    );
    expect(transfer!.success).toBe(true);
  });

  it('recording proxy returns 401 or 404 for call without recording', async () => {
    const res = await request(app).get(`/api/calls/${TEST_CALL_SID}/recording`);
    // 401 (auth required) or 404 (no recording URL on call)
    expect([401, 404]).toContain(res.status);
  });
});

describe('Fake MP3 fixture', () => {
  it('exists and has valid MP3 sync word', () => {
    expect(fs.existsSync(FAKE_MP3_PATH)).toBe(true);
    const stats = fs.statSync(FAKE_MP3_PATH);
    expect(stats.size).toBeGreaterThan(0);

    const header = Buffer.alloc(2);
    const fd = fs.openSync(FAKE_MP3_PATH, 'r');
    fs.readSync(fd, header, 0, 2, 0);
    fs.closeSync(fd);
    expect(header[0]).toBe(0xff);
    expect(header[1]).toBe(0xfb);
  });
});

describe('End-to-end: run → list → detail → call drill-down', () => {
  const e2eRunId = `test-run-e2e-${Date.now()}`;
  const e2eCallSid = `CA_e2e_${Date.now()}`;

  beforeAll(async () => {
    await callHistoryService.startCall(e2eCallSid, {
      to: '+18009990000',
      callPurpose: 'E2E test',
    });
    await callHistoryService.addConversation(
      e2eCallSid,
      'user',
      'I need help with my account'
    );
    await callHistoryService.addConversation(
      e2eCallSid,
      'ai',
      'Let me transfer you.'
    );
    await callHistoryService.addTermination(e2eCallSid, 'Call completed');
  });

  afterAll(async () => {
    await TestRun.deleteMany({ runId: e2eRunId });
    await CallHistory.deleteMany({ callSid: e2eCallSid });
  });

  it('full flow: post run, list, fetch detail, verify call data', async () => {
    // 1. Post the run
    await request(app)
      .post('/api/test-runs')
      .send({
        runId: e2eRunId,
        startedAt: new Date(),
        completedAt: new Date(),
        status: 'failed',
        totalTests: 1,
        passedTests: 0,
        failedTests: 1,
        testCases: [
          {
            testCaseId: 'e2e-tc-1',
            name: 'E2E Test Case',
            callSid: e2eCallSid,
            status: 'failed',
            durationSeconds: 30,
            error: 'Transfer not detected',
            timedOut: false,
          },
        ],
      })
      .expect(200);

    // 2. List runs — our run should appear
    const listRes = await request(app).get('/api/test-runs').expect(200);
    const ourRun = listRes.body.runs.find(
      (r: { runId: string }) => r.runId === e2eRunId
    );
    expect(ourRun).toBeDefined();
    expect(ourRun.status).toBe('failed');
    expect(ourRun.failedTests).toBe(1);

    // 3. Fetch detail — should include testCases with error
    const detailRes = await request(app)
      .get(`/api/test-runs/${encodeURIComponent(e2eRunId)}`)
      .expect(200);
    expect(detailRes.body.run.testCases).toHaveLength(1);
    expect(detailRes.body.run.testCases[0].callSid).toBe(e2eCallSid);
    expect(detailRes.body.run.testCases[0].error).toBe('Transfer not detected');

    // 4. Verify the call has events (what "View Call" would render)
    const call = await callHistoryService.getCall(e2eCallSid);
    expect(call).toBeTruthy();
    expect(call!.events!.length).toBe(3);
    expect(call!.events![0].eventType).toBe('conversation');
    expect(call!.events![2].eventType).toBe('termination');
  });
});
