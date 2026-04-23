import React, { useState, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import './TestRunsTab.css';
import './HistoryTab.css';
import {
  api,
  type CallHistoryResponse,
  type CallDetailsResponse,
  type CallDetails,
  type CallSummary,
  type CallStatus,
  type InitiateCallPayload,
  type InitiateCallResponse,
} from './api/client';
import { useCallRecording, getSeekSeconds } from './hooks/useCallRecording';
import { CallRecordingPlayer } from './components/CallRecordingPlayer';
import CallEventRow from './components/CallEventRow';
import { formatDateTime, formatDurationMs } from './utils/callFormatting';

interface StatusBadgeMeta {
  className: string;
  label: string;
  progressColor: string;
}

function getStatusMeta(status: CallStatus): StatusBadgeMeta {
  switch (status) {
    case 'completed':
      return {
        className: 'badge-completed',
        label: 'Completed',
        progressColor: '#28a745',
      };
    case 'failed':
      return {
        className: 'badge-failed',
        label: 'Failed',
        progressColor: '#dc3545',
      };
    case 'in-progress':
      return {
        className: 'badge-in-progress',
        label: 'In Progress',
        progressColor: '#007bff',
      };
    case 'terminated':
      return {
        className: 'badge-terminated',
        label: 'Terminated',
        progressColor: '#d4a017',
      };
  }
}

function transferOutcomeLabel(call: CallDetails): string {
  const events = call.events;
  if (events && events.length > 0) {
    const transfer = events.find(e => e.eventType === 'transfer');
    if (transfer) return transfer.success ? 'Transfer OK' : 'Transfer failed';
    if (events.some(e => e.eventType === 'hold')) return 'Hold detected';
  }
  return call.status === 'completed' ? 'Completed' : 'No transfer';
}

interface CallListItemProps {
  call: CallSummary;
  isActive: boolean;
  onSelect: () => void;
}

function CallListItem({ call, isActive, onSelect }: CallListItemProps) {
  const status = getStatusMeta(call.status);
  const phone = call.metadata?.to || call.callSid.substring(0, 16);
  return (
    <div className={`call-item ${isActive ? 'active' : ''}`} onClick={onSelect}>
      <div className="call-item-header">
        <span className="call-number">{phone}</span>
        <span className={`call-status-badge ${status.className}`}>
          {status.label}
        </span>
      </div>
      <div className="call-item-meta">
        <span>{formatDateTime(call.startTime)}</span>
        <span>{formatDurationMs(call.duration)}</span>
      </div>
      <div className="call-item-stats">
        <span>{call.conversationCount ?? 0} messages</span>
        <span>{call.dtmfCount ?? 0} DTMF</span>
      </div>
      <div className="call-progress">
        <div
          className="call-progress-bar"
          style={{
            left: 0,
            width: '100%',
            background: status.progressColor,
          }}
        />
      </div>
    </div>
  );
}

interface CallDetailViewProps {
  call: CallDetails;
  onCallInitiated: (callSid: string) => void;
}

function CallDetailView({ call, onCallInitiated }: CallDetailViewProps) {
  const queryClient = useQueryClient();
  const repeatCall = useMutation<
    InitiateCallResponse,
    Error,
    InitiateCallPayload
  >({
    mutationFn: payload => api.calls.initiate(payload),
    onSuccess: data => {
      queryClient.invalidateQueries({ queryKey: ['calls', 'history'] });
      onCallInitiated(data.call.sid);
    },
  });
  const recording = useCallRecording(call.callSid);
  const { recordingUrl, audioRef, audioCurrentTime, handleSeekToEvent } =
    recording;
  const status = getStatusMeta(call.status);
  const outcome = transferOutcomeLabel(call);
  const messageCount = call.conversation?.length ?? 0;
  const dtmfCount = call.dtmfPresses?.length ?? 0;

  return (
    <div className="detail-inner">
      <div className="detail-run-header">
        <div>
          <div className="detail-run-title">
            {call.metadata?.to || call.callSid}
          </div>
          <div className="detail-run-meta">
            {formatDateTime(call.startTime)} · {formatDurationMs(call.duration)}{' '}
            · SID: {call.callSid.substring(0, 16)}…
          </div>
        </div>
        <div className="detail-run-header-actions">
          <button
            onClick={() => {
              const to = call.metadata?.to;
              const transferNumber = call.metadata?.transferNumber;
              if (!to || !transferNumber) return;
              repeatCall.mutate({
                to,
                transferNumber,
                callPurpose: call.metadata?.callPurpose ?? '',
                customInstructions: '',
              });
            }}
            disabled={
              repeatCall.isPending ||
              !call.metadata?.to ||
              !call.metadata?.transferNumber
            }
            className="btn-repeat-call"
            title="Place a new call with the same number, purpose, and transfer settings"
          >
            {repeatCall.isPending ? 'Calling…' : '🔁 Repeat Call'}
          </button>
          <span className={`call-status-badge ${status.className}`}>
            {status.label}
          </span>
        </div>
      </div>

      {repeatCall.isError && (
        <div className="repeat-call-error">
          Failed to repeat call: {repeatCall.error.message}
        </div>
      )}

      <div className="call-meta-chips">
        {call.metadata?.callPurpose && (
          <span className="call-chip highlight">
            Purpose: {call.metadata.callPurpose}
          </span>
        )}
        {call.metadata?.to && (
          <span className="call-chip">To: {call.metadata.to}</span>
        )}
        {call.metadata?.from && (
          <span className="call-chip">From: {call.metadata.from}</span>
        )}
        {call.metadata?.transferNumber && (
          <span className="call-chip">
            Transfer: {call.metadata.transferNumber}
          </span>
        )}
      </div>

      <div className="summary-cards">
        <div className="summary-card">
          <div className="summary-card-value duration">
            {formatDurationMs(call.duration)}
          </div>
          <div className="summary-card-label">Duration</div>
        </div>
        <div className="summary-card">
          <div className="summary-card-value total">{messageCount}</div>
          <div className="summary-card-label">Messages</div>
        </div>
        <div className="summary-card">
          <div className="summary-card-value closed">{dtmfCount}</div>
          <div className="summary-card-label">DTMF Presses</div>
        </div>
        <div className="summary-card">
          <div
            className={`summary-card-value ${call.status === 'completed' ? 'passed' : 'failed'}`}
          >
            {outcome}
          </div>
          <div className="summary-card-label">Outcome</div>
        </div>
      </div>

      <div className="detail-progress">
        <div
          className="detail-progress-bar"
          style={{
            left: 0,
            width: '100%',
            background: status.progressColor,
          }}
        />
      </div>

      {call.recordingUrl && (
        <div className="inline-audio-player">
          <div className="inline-audio-label">Call Recording</div>
          <CallRecordingPlayer
            recording={recording}
            callSid={call.callSid}
            hasRecordingUrl={!!call.recordingUrl}
          />
        </div>
      )}

      {call.events &&
        call.events.length > 0 &&
        (() => {
          // Internal diagnostic events (turn_timing sub-timestamps) are stored
          // alongside transcript events but should not render in the timeline —
          // they have no text body so they showed up as empty rows.
          const visibleEvents = call.events.filter(
            e => e.eventType !== 'turn_timing'
          );
          if (visibleEvents.length === 0) return null;
          return (
            <div className="test-cases-section">
              <div className="section-label">
                Event Timeline ({visibleEvents.length} events)
              </div>
              {visibleEvents.map((event, idx) => {
                const seekSec = getSeekSeconds(event.timestamp, call.startTime);
                const nextEvent = visibleEvents[idx + 1];
                const nextSeekSec = nextEvent
                  ? getSeekSeconds(nextEvent.timestamp, call.startTime)
                  : Infinity;
                const isActive =
                  !!recordingUrl &&
                  !!audioRef.current &&
                  !audioRef.current.paused &&
                  audioCurrentTime >= seekSec &&
                  audioCurrentTime < nextSeekSec;
                return (
                  <CallEventRow
                    key={idx}
                    event={event}
                    isActive={isActive}
                    isSeekable={!!recordingUrl}
                    seekSeconds={seekSec}
                    onSeek={() =>
                      handleSeekToEvent(event.timestamp, call.startTime)
                    }
                  />
                );
              })}
            </div>
          );
        })()}
    </div>
  );
}

function HistoryTab() {
  const [selectedCallSid, setSelectedCallSid] = useState<string | null>(null);

  const {
    data: historyData,
    isLoading: isLoadingHistory,
    refetch,
  } = useQuery<CallHistoryResponse>({
    queryKey: ['calls', 'history'],
    queryFn: () => api.calls.history(50),
    refetchInterval: 5000,
  });

  const { data: callDetailsData, isLoading: isLoadingDetails } =
    useQuery<CallDetailsResponse>({
      queryKey: ['calls', selectedCallSid],
      queryFn: () => api.calls.get(selectedCallSid!),
      enabled: !!selectedCallSid,
    });

  const calls: Array<CallSummary> = useMemo(
    () => historyData?.calls ?? [],
    [historyData]
  );
  const selectedCall: CallDetails | null = callDetailsData?.call ?? null;
  const mongoConnected = historyData?.mongoConnected !== false;

  function renderCallsList() {
    if (isLoadingHistory) {
      return <div className="test-runs-loading">Loading calls...</div>;
    }
    if (calls.length === 0) {
      return (
        <div className="test-runs-empty" style={{ padding: '40px 20px' }}>
          No calls yet. Start a call from the New Call tab.
        </div>
      );
    }
    return (
      <div className="runs-list-items">
        {calls.map(call => (
          <CallListItem
            key={call.callSid}
            call={call}
            isActive={selectedCallSid === call.callSid}
            onSelect={() => setSelectedCallSid(call.callSid)}
          />
        ))}
      </div>
    );
  }

  function renderDetail() {
    if (!selectedCallSid) {
      return (
        <div className="detail-empty">
          <div className="detail-empty-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="#9ca3af">
              <path d="M20 15.5c-1.25 0-2.45-.2-3.57-.57a1 1 0 0 0-1.02.24l-2.2 2.2a15.05 15.05 0 0 1-6.59-6.59l2.2-2.21a1 1 0 0 0 .25-1.01A11.36 11.36 0 0 1 8.5 4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1 17 17 0 0 0 17 17 1 1 0 0 0 1-1v-3.5a1 1 0 0 0-1-1z" />
            </svg>
          </div>
          <div className="detail-empty-title">Select a call</div>
          <div className="detail-empty-sub">
            Click a call on the left to view its transcript and events
          </div>
        </div>
      );
    }
    if (isLoadingDetails || !selectedCall) {
      return <div className="test-runs-loading">Loading call details...</div>;
    }
    return (
      <CallDetailView
        call={selectedCall}
        onCallInitiated={setSelectedCallSid}
      />
    );
  }

  return (
    <div className="test-runs-container">
      <div className="test-runs-header">
        <div>
          <h2>Call History</h2>
          <div className="header-subtitle">
            Live IVR call recordings and transcripts
          </div>
        </div>
        <button
          onClick={() => refetch()}
          className="btn-refresh"
          disabled={isLoadingHistory}
        >
          {isLoadingHistory ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {!mongoConnected && (
        <div className="history-warning">
          MongoDB not connected. Call history will not be saved. Add MONGODB_URI
          to .env to enable call history.
        </div>
      )}

      <div className="test-runs-layout">
        <div className="runs-panel">
          <div className="panel-header">
            <span className="panel-title">Recent Calls</span>
            <span className="panel-count">
              {calls.length} call{calls.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="runs-list">{renderCallsList()}</div>
        </div>

        <div className="detail-panel">{renderDetail()}</div>
      </div>
    </div>
  );
}

export default HistoryTab;
