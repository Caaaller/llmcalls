import React, { useState } from 'react';
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
  completedAt: string;
}): string {
  const ms =
    new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime();
  return formatDuration(Math.round(ms / 1000));
}

function renderEvent(event: CallEvent, idx: number) {
  return (
    <div key={idx} className="inline-timeline-item">
      <div className="inline-timeline-time">{formatTime(event.timestamp)}</div>
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
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [recordingLoading, setRecordingLoading] = useState(false);

  const { data, isLoading } = useQuery<CallDetailsResponse>({
    queryKey: ['calls', callSid],
    queryFn: () => api.calls.get(callSid),
  });

  const call: CallDetails | null = data?.call ?? null;

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

  async function loadRecording() {
    setRecordingError(null);
    setRecordingLoading(true);
    try {
      const url = await api.calls.getRecordingUrl(callSid);
      setRecordingUrl(url);
    } catch {
      setRecordingError('Failed to load recording');
    } finally {
      setRecordingLoading(false);
    }
  }

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
          {recordingUrl ? (
            <audio controls autoPlay src={recordingUrl} />
          ) : (
            <>
              <button
                className="btn-view-call"
                onClick={loadRecording}
                disabled={recordingLoading}
              >
                {recordingLoading ? 'Loading...' : 'Load Recording'}
              </button>
              {recordingError && (
                <span
                  style={{
                    color: '#dc3545',
                    fontSize: '0.85rem',
                    marginLeft: 8,
                  }}
                >
                  {recordingError}
                </span>
              )}
            </>
          )}
        </div>
      )}

      {call.events && call.events.length > 0 && (
        <div className="inline-timeline">
          {call.events.map((event, idx) => renderEvent(event, idx))}
        </div>
      )}
    </div>
  );
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

  const runs: TestRunSummary[] = listData?.runs ?? [];
  const selectedRun: TestRunDetail | null = detailData?.run ?? null;

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

  return (
    <div className="test-runs-container">
      <div className="test-runs-header">
        <h2>Test Runs</h2>
        <button
          onClick={() => refetch()}
          className="btn-refresh"
          disabled={isLoadingList}
        >
          {isLoadingList ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      <div className="test-runs-layout">
        {/* Runs List */}
        <div className="runs-list">
          <h3>Recent Runs ({runs.length})</h3>
          {isLoadingList ? (
            <div className="test-runs-loading">Loading runs...</div>
          ) : runs.length === 0 ? (
            <div className="test-runs-empty" style={{ padding: '40px 20px' }}>
              No test runs yet. Run <code>pnpm --filter backend test:live</code>{' '}
              to generate results.
            </div>
          ) : (
            <div className="runs-list-items">
              {runs.map(run => {
                const closedTests = run.closedTests || 0;
                const activeTests = run.totalTests - closedTests;
                const passPercent =
                  activeTests > 0 ? (run.passedTests / activeTests) * 100 : 0;
                return (
                  <div
                    key={run.runId}
                    className={`run-item ${selectedRunId === run.runId ? 'active' : ''}`}
                    onClick={() => handleSelectRun(run.runId)}
                  >
                    <div className="run-item-header">
                      <span className="run-date">
                        {formatRunDate(run.startedAt)}
                      </span>
                      <span className={`run-status-badge ${run.status}`}>
                        {run.status.toUpperCase()}
                      </span>
                    </div>
                    <div className="run-item-meta">
                      <span>
                        {run.passedTests}/{activeTests} passed
                        {closedTests > 0 ? ` (${closedTests} closed)` : ''}
                      </span>
                      <span>{computeRunDuration(run)}</span>
                    </div>
                    <div className="run-progress">
                      <div
                        className="run-progress-fill"
                        style={{
                          width: '100%',
                          background: (() => {
                            const failPercent =
                              activeTests > 0
                                ? (run.failedTests / activeTests) * 100
                                : 0;
                            const closedPercent =
                              run.totalTests > 0
                                ? (closedTests / run.totalTests) * 100
                                : 0;
                            if (closedTests > 0 || run.failedTests > 0) {
                              const passStop =
                                passPercent * (1 - closedPercent / 100);
                              const failStop =
                                passStop +
                                failPercent * (1 - closedPercent / 100);
                              return `linear-gradient(to right, #28a745 ${passStop}%, #dc3545 ${passStop}% ${failStop}%, #f0ad4e ${failStop}%)`;
                            }
                            return '#28a745';
                          })(),
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Detail Panel */}
        <div className="run-detail">
          {isLoadingDetail ? (
            <div className="test-runs-loading">Loading run details...</div>
          ) : selectedRun ? (
            <>
              <div className="run-detail-header">
                <h3>Run: {formatRunDate(selectedRun.startedAt)}</h3>
                <div className="run-detail-actions">
                  <button
                    className="btn-delete-run"
                    onClick={() => deleteMutation.mutate(selectedRun.runId)}
                  >
                    Delete
                  </button>
                </div>
              </div>

              <div className="summary-cards">
                <div className="summary-card">
                  <div className="summary-card-value total">
                    {selectedRun.totalTests}
                  </div>
                  <div className="summary-card-label">Total Tests</div>
                </div>
                <div className="summary-card">
                  <div className="summary-card-value passed">
                    {selectedRun.passedTests}
                  </div>
                  <div className="summary-card-label">Passed</div>
                </div>
                <div className="summary-card">
                  <div className="summary-card-value failed">
                    {selectedRun.failedTests}
                  </div>
                  <div className="summary-card-label">Failed</div>
                </div>
                {(selectedRun.closedTests || 0) > 0 && (
                  <div className="summary-card">
                    <div className="summary-card-value closed">
                      {selectedRun.closedTests}
                    </div>
                    <div className="summary-card-label">Closed</div>
                  </div>
                )}
                <div className="summary-card">
                  <div className="summary-card-value duration">
                    {computeRunDuration(selectedRun)}
                  </div>
                  <div className="summary-card-label">Duration</div>
                </div>
              </div>

              <div className="test-cases-section">
                <h4>Test Cases ({selectedRun.testCases.length})</h4>
                {[...selectedRun.testCases]
                  .sort((a, b) => {
                    const order = { failed: 0, business_closed: 1, passed: 2 };
                    return order[a.status] - order[b.status];
                  })
                  .map((tc: TestCaseResult) => (
                    <React.Fragment key={tc.testCaseId}>
                      <div
                        className={`test-case-row ${tc.status === 'failed' ? 'fail' : ''} ${tc.status === 'business_closed' ? 'closed' : ''} ${expandedCallSid === tc.callSid ? 'expanded' : ''}`}
                        onClick={() => toggleCallDetail(tc.callSid)}
                      >
                        <span className="test-case-icon">
                          {tc.status === 'passed'
                            ? '\u2705'
                            : tc.status === 'business_closed'
                              ? '\ud83d\udd5b'
                              : '\u274C'}
                        </span>
                        <span className="test-case-name">{tc.name}</span>
                        {tc.error && (
                          <span
                            className="test-case-error-badge"
                            title={tc.error}
                          >
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
                        <button
                          className="btn-view-call"
                          onClick={e => {
                            e.stopPropagation();
                            toggleCallDetail(tc.callSid);
                          }}
                        >
                          {expandedCallSid === tc.callSid
                            ? 'Hide'
                            : 'View Call'}
                        </button>
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
                                ? '✓ Fix Applied'
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
                      {expandedCallSid === tc.callSid && (
                        <CallDetailInline callSid={tc.callSid} />
                      )}
                    </React.Fragment>
                  ))}
              </div>
            </>
          ) : (
            <div className="test-runs-empty">Select a run to view details</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default TestRunsTab;
