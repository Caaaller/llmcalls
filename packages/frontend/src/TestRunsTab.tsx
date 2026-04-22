import React, { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import './TestRunsTab.css';
import {
  api,
  type TestRunSummary,
  type TestRunDetail,
  type TestCaseResult,
  type CallDetails,
  type CallDetailsResponse,
  type CallEvent,
  type FailureAnalysis,
} from './api/client';
import { useCallRecording, getSeekSeconds } from './hooks/useCallRecording';
import { CallRecordingPlayer } from './components/CallRecordingPlayer';

function formatRunDate(date: string | Date): string {
  return new Date(date).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function formatTime(date: Date | string | null | undefined): string {
  if (!date) return 'N/A';
  return new Date(date).toLocaleTimeString();
}

function computeRunDuration(run: {
  startedAt: string;
  completedAt?: string;
}): string {
  const endMs = run.completedAt
    ? new Date(run.completedAt).getTime()
    : Date.now();
  const ms = endMs - new Date(run.startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '\u2014';
  return formatDuration(Math.round(ms / 1000));
}

interface StatusCounts {
  passed: number;
  failed: number;
  closed: number;
  remoteHangup: number;
  skipped: number;
  total: number;
}

function computeStatusCounts(
  testCases: Array<TestCaseResult>,
  _maxTests: number
): StatusCounts {
  let passed = 0;
  let failed = 0;
  let closed = 0;
  let remoteHangup = 0;
  let skipped = 0;
  for (const tc of testCases) {
    if (tc.status === 'passed') passed++;
    else if (tc.status === 'failed') failed++;
    else if (tc.status === 'business_closed') closed++;
    else if (tc.status === 'remote_hangup') remoteHangup++;
    else if (tc.status === 'skipped') skipped++;
  }
  const total = testCases.length;
  return { passed, failed, closed, remoteHangup, skipped, total };
}

function buildRunMeta(run: TestRunSummary): string {
  const skippedTests = (run as { skippedTests?: number }).skippedTests || 0;
  const executed = run.passedTests + run.failedTests;
  const parts: Array<string> = [];
  parts.push(`${run.passedTests}/${executed} passed`);
  if (skippedTests > 0) parts.push(`${skippedTests} skipped`);
  return parts.join(' \u00b7 ');
}

interface ProgressSegment {
  left: string;
  width: string;
  background: string;
}

function buildProgressSegments(run: TestRunSummary): Array<ProgressSegment> {
  const total = run.totalTests;
  if (total === 0) return [];

  const closedTests = run.closedTests || 0;
  // Progress bar uses total as denominator so skipped = unfilled right side
  const passP = (run.passedTests / total) * 100;
  const failP = (run.failedTests / total) * 100;
  const closedP = (closedTests / total) * 100;
  // Skipped tests are NOT rendered — they leave the bar unfilled

  const segments: Array<ProgressSegment> = [];
  let offset = 0;

  if (passP > 0) {
    segments.push({
      left: `${offset}%`,
      width: `${passP}%`,
      background: '#28a745',
    });
    offset += passP;
  }
  if (failP > 0) {
    segments.push({
      left: `${offset}%`,
      width: `${failP}%`,
      background: '#dc3545',
    });
    offset += failP;
  }
  if (closedP > 0) {
    segments.push({
      left: `${offset}%`,
      width: `${closedP}%`,
      background: '#d4a017',
    });
  }

  return segments;
}

function buildDetailProgressSegments(
  counts: StatusCounts
): Array<ProgressSegment> {
  if (counts.total === 0) return [];
  const segments: Array<ProgressSegment> = [];
  let offset = 0;
  const add = (count: number, color: string) => {
    if (count <= 0) return;
    const pct = (count / counts.total) * 100;
    segments.push({ left: `${offset}%`, width: `${pct}%`, background: color });
    offset += pct;
  };
  add(counts.passed, '#28a745');
  add(counts.failed, '#dc3545');
  add(counts.closed, '#d4a017');
  add(counts.remoteHangup, '#8a6d3b');
  add(counts.skipped, '#6c757d');
  return segments;
}

interface RenderEventOptions {
  isActive: boolean;
  isSeekable: boolean;
  seekSeconds: number;
  onSeek: () => void;
  isPostHangup?: boolean;
}

function renderEvent(
  event: CallEvent,
  idx: number,
  options?: RenderEventOptions
) {
  const {
    isActive = false,
    isSeekable = false,
    seekSeconds = 0,
    onSeek,
    isPostHangup = false,
  } = options ?? {};
  return (
    <div
      key={idx}
      className={`inline-timeline-item${isActive ? ' inline-timeline-item-active' : ''}${isPostHangup ? ' inline-timeline-item-post-hangup' : ''}`}
      style={isPostHangup ? { opacity: 0.5, fontStyle: 'italic' } : undefined}
      title={
        isPostHangup
          ? 'This event was logged after the call ended — no audio was actually played.'
          : undefined
      }
    >
      <div
        className={`inline-timeline-time${isSeekable ? ' timeline-time-clickable' : ''}`}
        onClick={isSeekable ? onSeek : undefined}
        title={isSeekable ? `Seek to ${Math.floor(seekSeconds)}s` : undefined}
      >
        {formatTime(event.timestamp)}
      </div>
      <div className="inline-timeline-content">
        {event.eventType === 'dtmf' && (
          <span style={{ color: '#667eea', fontWeight: 600 }}>
            Press {event.digit}
            {event.reason && (
              <span style={{ fontWeight: 400, color: '#666' }}>
                {' '}
                — <em>{event.reason}</em>
              </span>
            )}
          </span>
        )}
        {event.eventType === 'ivr_menu' && (
          <span style={{ color: '#ff9800' }}>
            IVR Menu
            {event.menuOptions &&
              `: ${event.menuOptions.map(o => `${o.digit}=${o.option}`).join(', ')}`}
          </span>
        )}
        {event.eventType === 'transfer' && (
          <span style={{ color: '#28a745', fontWeight: 600 }}>
            Transfer {event.success ? 'Successful' : 'Attempted'} to{' '}
            {event.transferNumber}
          </span>
        )}
        {event.eventType === 'termination' && (
          <span style={{ color: '#dc3545', fontWeight: 600 }}>
            Terminated: {event.reason}
          </span>
        )}
        {event.eventType === 'conversation' && (
          <span
            style={{
              color:
                event.type === 'user'
                  ? '#2196f3'
                  : event.type === 'ai'
                    ? '#9c27b0'
                    : '#ff9800',
            }}
          >
            {event.type === 'user'
              ? 'User'
              : event.type === 'ai'
                ? 'AI'
                : 'System'}
            : {event.text}
          </span>
        )}
        {event.eventType === 'hold' && (
          <span style={{ color: '#ffc107', fontWeight: 600 }}>
            Hold queue detected
          </span>
        )}
        {event.eventType === 'info_request' && (
          <span style={{ color: '#17a2b8' }}>Info Request: {event.text}</span>
        )}
        {event.eventType === 'info_response' && (
          <span style={{ color: '#17a2b8' }}>Info Response: {event.text}</span>
        )}
      </div>
    </div>
  );
}

function CallDetailInline({ callSid }: { callSid: string }) {
  const recording = useCallRecording(callSid);
  const { recordingUrl, audioRef, audioCurrentTime, handleSeekToEvent } =
    recording;

  const { data, isLoading } = useQuery<CallDetailsResponse>({
    queryKey: ['calls', callSid],
    queryFn: () => api.calls.get(callSid),
  });

  const call: CallDetails | null = data?.call ?? null;

  useEffect(() => {
    if (call?.recordingUrl && !recordingUrl && !recording.recordingLoading) {
      recording.handleLoadRecording(callSid);
    }
  }, [call?.recordingUrl, callSid, recordingUrl, recording]);

  if (isLoading)
    return (
      <div className="call-detail-inline">
        <div className="test-runs-loading">Loading call...</div>
      </div>
    );
  if (!call)
    return (
      <div className="call-detail-inline">
        <div style={{ color: '#999' }}>Call data not found</div>
      </div>
    );

  return (
    <div className="call-detail-inline">
      <div className="call-meta-chips">
        <span className="call-chip">SID: {callSid.substring(0, 16)}...</span>
        {call.metadata?.to && (
          <span className="call-chip">To: {call.metadata.to}</span>
        )}
        {call.metadata?.from && (
          <span className="call-chip">From: {call.metadata.from}</span>
        )}
        {call.metadata?.callPurpose && (
          <span className="call-chip">
            Purpose: {call.metadata.callPurpose}
          </span>
        )}
      </div>

      {call.recordingUrl && (
        <div className="inline-audio-player">
          <div className="inline-audio-label">Call Recording</div>
          <CallRecordingPlayer
            recording={recording}
            callSid={callSid}
            hasRecordingUrl={!!call.recordingUrl}
          />
        </div>
      )}

      {call.events && call.events.length > 0 && (
        <div className="inline-timeline">
          {(() => {
            const endMs = call.endTime
              ? new Date(call.endTime).getTime()
              : null;
            let hangupMarkerRendered = false;
            const rendered: Array<React.ReactNode> = [];
            call.events.forEach((event, idx) => {
              const seekSec = getSeekSeconds(event.timestamp, call.startTime);
              const nextEvent = call.events[idx + 1];
              const nextSeekSec = nextEvent
                ? getSeekSeconds(nextEvent.timestamp, call.startTime)
                : Infinity;
              const isActive =
                !!recordingUrl &&
                !!audioRef.current &&
                !audioRef.current.paused &&
                audioCurrentTime >= seekSec &&
                audioCurrentTime < nextSeekSec;
              const eventMs = event.timestamp
                ? new Date(event.timestamp).getTime()
                : 0;
              // Allow a small grace window (2s) — Telnyx webhooks and Mongo
              // writes can arrive slightly out of order. Mark anything more
              // than 2s after call.endTime as post-hangup.
              const isPostHangup = !!endMs && eventMs > endMs + 2000;

              if (isPostHangup && !hangupMarkerRendered) {
                hangupMarkerRendered = true;
                rendered.push(
                  <div
                    key={`hangup-marker-${idx}`}
                    style={{
                      borderTop: '1px dashed #dc3545',
                      margin: '8px 0',
                      padding: '4px 8px',
                      color: '#dc3545',
                      fontSize: '0.85em',
                      fontWeight: 600,
                      textAlign: 'center',
                    }}
                  >
                    ── Call ended — events below were logged but not actually
                    played ──
                  </div>
                );
              }

              rendered.push(
                renderEvent(event, idx, {
                  isActive,
                  isSeekable: !!recordingUrl,
                  seekSeconds: seekSec,
                  onSeek: () =>
                    handleSeekToEvent(event.timestamp, call.startTime),
                  isPostHangup,
                })
              );
            });
            return rendered;
          })()}
        </div>
      )}
    </div>
  );
}

interface SkippedTestCase {
  name: string;
  status: 'skipped';
}

type DisplayTestCase = TestCaseResult | SkippedTestCase;

function isSkipped(tc: DisplayTestCase): tc is SkippedTestCase {
  return tc.status === 'skipped';
}

interface TestRunsTabProps {
  initialRunId?: string | null;
  onRunSelect?: (runId: string) => void;
  onRunDeselect?: () => void;
}

function TestRunsTab({
  initialRunId,
  onRunSelect,
  onRunDeselect,
}: TestRunsTabProps = {}) {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(
    initialRunId ?? null
  );
  const [expandedCallSid, setExpandedCallSid] = useState<string | null>(null);
  const [analysisState, setAnalysisState] = useState<
    Record<
      string,
      {
        loading: boolean;
        data: FailureAnalysis | null;
        error: string | null;
        applied: boolean;
      }
    >
  >({});
  const queryClient = useQueryClient();

  const {
    data: listData,
    isLoading: isLoadingList,
    refetch,
  } = useQuery({
    queryKey: ['testRuns'],
    queryFn: () => api.testRuns.list(),
    refetchInterval: 10000,
  });

  const { data: detailData, isLoading: isLoadingDetail } = useQuery({
    queryKey: ['testRuns', selectedRunId],
    queryFn: () => api.testRuns.get(selectedRunId!),
    enabled: !!selectedRunId,
  });

  const deleteMutation = useMutation({
    mutationFn: (runId: string) => api.testRuns.delete(runId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['testRuns'] });
      handleDeselectRun();
    },
  });

  const runs: Array<TestRunSummary> = useMemo(
    () => listData?.runs ?? [],
    [listData]
  );
  const selectedRun: TestRunDetail | null = detailData?.run ?? null;

  // Each run defines its own total — no cross-run comparison for "skipped"
  const maxTests = 0;

  function handleSelectRun(runId: string) {
    setSelectedRunId(runId);
    setExpandedCallSid(null);
    onRunSelect?.(runId);
  }

  function handleDeselectRun() {
    setSelectedRunId(null);
    setExpandedCallSid(null);
    onRunDeselect?.();
  }

  function toggleCallDetail(callSid: string) {
    setExpandedCallSid(prev => (prev === callSid ? null : callSid));
  }

  async function analyzeFailure(tc: TestCaseResult) {
    setAnalysisState(prev => ({
      ...prev,
      [tc.testCaseId]: {
        loading: true,
        data: null,
        error: null,
        applied: false,
      },
    }));
    try {
      const result = await api.testRuns.analyzeFailure(
        tc.callSid,
        tc.name,
        tc.testCaseId
      );
      setAnalysisState(prev => ({
        ...prev,
        [tc.testCaseId]: {
          loading: false,
          data: result.analysis,
          error: null,
          applied: false,
        },
      }));
    } catch (err) {
      setAnalysisState(prev => ({
        ...prev,
        [tc.testCaseId]: {
          loading: false,
          data: null,
          error: err instanceof Error ? err.message : 'Analysis failed',
          applied: false,
        },
      }));
    }
  }

  async function applyFix(testCaseId: string, customInstructions: string) {
    await api.testRuns.saveOverride(testCaseId, customInstructions);
    setAnalysisState(prev => ({
      ...prev,
      [testCaseId]: { ...prev[testCaseId], applied: true },
    }));
  }

  function renderRunsList() {
    if (isLoadingList) {
      return <div className="test-runs-loading">Loading runs...</div>;
    }
    if (runs.length === 0) {
      return (
        <div className="test-runs-empty" style={{ padding: '40px 20px' }}>
          No test runs yet. Run <code>pnpm --filter backend test:live</code> to
          generate results.
        </div>
      );
    }
    return (
      <div className="runs-list-items">
        {runs.map(run => {
          const segments = buildProgressSegments(run);
          return (
            <div
              key={run.runId}
              className={`run-item ${selectedRunId === run.runId ? 'active' : ''}`}
              onClick={() => handleSelectRun(run.runId)}
            >
              <div className="run-item-header">
                <span className="run-date">{formatRunDate(run.startedAt)}</span>
                <span className={`run-status-badge ${run.status}`}>
                  {run.status === 'in_progress'
                    ? 'RUNNING'
                    : run.status.toUpperCase()}
                </span>
              </div>
              <div className="run-item-meta">
                <span>{buildRunMeta(run)}</span>
                <span>{computeRunDuration(run)}</span>
              </div>
              <div className="run-progress">
                {segments.map((seg, i) => (
                  <div
                    key={i}
                    className="run-progress-bar"
                    style={{
                      left: seg.left,
                      width: seg.width,
                      background: seg.background,
                    }}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  function renderDetailPanel() {
    if (isLoadingDetail) {
      return <div className="test-runs-loading">Loading run details...</div>;
    }
    if (!selectedRun) {
      return (
        <div className="detail-empty">
          <div className="detail-empty-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="#9ca3af">
              <path d="M19.8 18.4L14 10.67V6.5l1.35-1.69c.26-.33.03-.81-.39-.81H9.04c-.42 0-.65.48-.39.81L10 6.5v4.17L4.2 18.4c-.49.66-.02 1.6.8 1.6h14c.82 0 1.29-.94.8-1.6z" />
            </svg>
          </div>
          <div className="detail-empty-title">Select a run</div>
          <div className="detail-empty-sub">
            Click a run on the left to view details
          </div>
        </div>
      );
    }

    const counts = computeStatusCounts(selectedRun.testCases, maxTests);
    const progressSegments = buildDetailProgressSegments(counts);
    const duration = computeRunDuration(selectedRun);

    const sortedTestCases = [...selectedRun.testCases].sort((a, b) => {
      const order: Record<string, number> = {
        failed: 0,
        business_closed: 1,
        passed: 2,
      };
      return (order[a.status] ?? 3) - (order[b.status] ?? 3);
    });

    const skippedTests: Array<SkippedTestCase> = [];
    if (counts.skipped > 0) {
      for (let i = 0; i < counts.skipped; i++) {
        skippedTests.push({
          name: `Test case ${selectedRun.testCases.length + i + 1}`,
          status: 'skipped',
        });
      }
    }

    const displayTestCases: Array<DisplayTestCase> = [
      ...sortedTestCases,
      ...skippedTests,
    ];

    const suiteLabel =
      counts.skipped > 0
        ? `Partial run \u00b7 ${selectedRun.testCases.length} of ${counts.total} tests \u00b7 completed in ${duration}`
        : `Full suite \u00b7 ${counts.total} tests \u00b7 completed in ${duration}`;

    return (
      <div className="detail-inner">
        <div className="detail-run-header">
          <div>
            <div className="detail-run-title">
              {formatRunDate(selectedRun.startedAt)}
            </div>
            <div className="detail-run-meta">{suiteLabel}</div>
          </div>
          <button
            className="btn-delete-run"
            onClick={() => deleteMutation.mutate(selectedRun.runId)}
          >
            Delete
          </button>
        </div>

        <div className="summary-cards">
          <div className="summary-card">
            <div className="summary-card-value total">{counts.total}</div>
            <div className="summary-card-label">Total</div>
          </div>
          <div className="summary-card">
            <div className="summary-card-value passed">{counts.passed}</div>
            <div className="summary-card-label">Passed</div>
          </div>
          <div className="summary-card">
            <div className="summary-card-value failed">{counts.failed}</div>
            <div className="summary-card-label">Failed</div>
          </div>
          {counts.closed > 0 && (
            <div className="summary-card">
              <div className="summary-card-value closed">{counts.closed}</div>
              <div className="summary-card-label">Closed</div>
            </div>
          )}
          {counts.remoteHangup > 0 && (
            <div className="summary-card">
              <div className="summary-card-value closed">
                {counts.remoteHangup}
              </div>
              <div className="summary-card-label">Hung Up</div>
            </div>
          )}
          {counts.skipped > 0 && (
            <div className="summary-card">
              <div className="summary-card-value skipped">{counts.skipped}</div>
              <div className="summary-card-label">Skipped</div>
            </div>
          )}
          <div className="summary-card">
            <div className="summary-card-value duration">{duration}</div>
            <div className="summary-card-label">Duration</div>
          </div>
        </div>

        <div className="detail-progress">
          {progressSegments.map((seg, i) => (
            <div
              key={i}
              className="detail-progress-bar"
              style={{
                left: seg.left,
                width: seg.width,
                background: seg.background,
              }}
            />
          ))}
        </div>

        <div className="test-cases-section">
          <div className="section-label">Test Cases ({counts.total})</div>
          {displayTestCases.map((tc, idx) => {
            if (isSkipped(tc)) {
              return (
                <div key={`skipped-${idx}`} className="test-case skipped">
                  <div className="test-case-row">
                    <span
                      className="test-case-icon"
                      style={{ color: '#6c757d' }}
                    >
                      &mdash;
                    </span>
                    <span className="test-case-name">
                      {tc.name}
                      <span className="skipped-label">skipped</span>
                    </span>
                    <span style={{ flex: 1 }} />
                    <span className="test-case-duration">&mdash;</span>
                  </div>
                </div>
              );
            }

            const isInProgress =
              tc.status === 'pending' || tc.status === 'running';
            const statusClass =
              tc.status === 'passed'
                ? 'pass'
                : tc.status === 'business_closed'
                  ? 'closed'
                  : tc.status === 'remote_hangup'
                    ? 'closed'
                    : isInProgress
                      ? 'pending'
                      : 'fail';
            const isExpanded = expandedCallSid === tc.callSid;

            return (
              <div
                key={tc.testCaseId}
                className={`test-case ${statusClass}${isExpanded ? ' expanded' : ''}`}
              >
                <div
                  className="test-case-row"
                  onClick={() =>
                    tc.callSid ? toggleCallDetail(tc.callSid) : undefined
                  }
                >
                  <span className="test-case-icon">
                    {tc.status === 'passed'
                      ? '\u2705'
                      : tc.status === 'business_closed'
                        ? '\ud83d\udd5b'
                        : tc.status === 'remote_hangup'
                          ? '\ud83d\udcde'
                          : tc.status === 'running'
                            ? '\u23F3'
                            : tc.status === 'pending'
                              ? '\u2026'
                              : '\u274C'}
                  </span>
                  <span className="test-case-name">{tc.name}</span>
                  {tc.error && (
                    <span className="test-case-error-badge" title={tc.error}>
                      {tc.error}
                    </span>
                  )}
                  <span className="test-case-duration">
                    {formatDuration(
                      Math.round(
                        tc.durationSeconds > 3600
                          ? tc.durationSeconds / 1000
                          : tc.durationSeconds
                      )
                    )}
                  </span>
                  {tc.callSid && (
                    <button
                      className="btn-view-call"
                      onClick={e => {
                        e.stopPropagation();
                        toggleCallDetail(tc.callSid);
                      }}
                    >
                      {isExpanded ? 'Hide' : 'View Call'}
                    </button>
                  )}
                  {tc.status === 'failed' && (
                    <button
                      className="btn-why-failed"
                      onClick={e => {
                        e.stopPropagation();
                        analyzeFailure(tc);
                      }}
                      disabled={analysisState[tc.testCaseId]?.loading}
                    >
                      {analysisState[tc.testCaseId]?.loading
                        ? 'Analyzing...'
                        : 'Why?'}
                    </button>
                  )}
                </div>
                {analysisState[tc.testCaseId]?.data && (
                  <div className="failure-analysis-panel">
                    <div className="failure-analysis-explanation">
                      {analysisState[tc.testCaseId].data!.explanation}
                    </div>
                    <div className="failure-analysis-fix">
                      <strong>Proposed fix:</strong>{' '}
                      {analysisState[tc.testCaseId].data!.fix.description}
                      <div className="failure-analysis-instructions">
                        <code>
                          {
                            analysisState[tc.testCaseId].data!.fix
                              .customInstructions
                          }
                        </code>
                      </div>
                      <button
                        className={`btn-apply-fix ${analysisState[tc.testCaseId].applied ? 'applied' : ''}`}
                        onClick={e => {
                          e.stopPropagation();
                          applyFix(
                            tc.testCaseId,
                            analysisState[tc.testCaseId].data!.fix
                              .customInstructions
                          );
                        }}
                        disabled={analysisState[tc.testCaseId].applied}
                      >
                        {analysisState[tc.testCaseId].applied
                          ? '\u2713 Fix Applied'
                          : 'Apply Fix'}
                      </button>
                    </div>
                  </div>
                )}
                {analysisState[tc.testCaseId]?.error && (
                  <div className="failure-analysis-error">
                    {analysisState[tc.testCaseId].error}
                  </div>
                )}
                {isExpanded && <CallDetailInline callSid={tc.callSid} />}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="test-runs-container">
      <div className="test-runs-header">
        <div>
          <h2>Test Runs</h2>
          <div className="header-subtitle">
            Automated regression suite results
          </div>
        </div>
        <button
          onClick={() => refetch()}
          className="btn-refresh"
          disabled={isLoadingList}
        >
          {isLoadingList ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      <div className="test-runs-layout">
        <div className="runs-panel">
          <div className="panel-header">
            <span className="panel-title">Recent Runs</span>
            <span className="panel-count">
              {runs.length} run{runs.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="runs-list">{renderRunsList()}</div>
        </div>

        <div className="detail-panel">{renderDetailPanel()}</div>
      </div>
    </div>
  );
}

export default TestRunsTab;
