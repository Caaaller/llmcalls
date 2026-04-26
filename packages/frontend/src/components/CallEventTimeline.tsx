import React from 'react';
import type { CallEvent } from '../api/client';
import { getSeekSeconds } from '../hooks/useCallRecording';

function formatTime(date: Date | string | null | undefined): string {
  if (!date) return 'N/A';
  return new Date(date).toLocaleTimeString();
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
  options: RenderEventOptions
) {
  const {
    isActive,
    isSeekable,
    seekSeconds,
    onSeek,
    isPostHangup = false,
  } = options;
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

interface CallEventTimelineProps {
  events: CallEvent[];
  startTime: Date | string;
  endTime?: Date | string | null;
  recordingUrl?: string | null;
  audioRef: React.RefObject<HTMLAudioElement>;
  audioCurrentTime: number;
  onSeek: (
    eventTimestamp: Date | string | undefined,
    callStartTime: Date | string | undefined
  ) => void;
  showHangupMarker?: boolean;
  sectionLabel?: string;
}

function CallEventTimeline({
  events,
  startTime,
  endTime,
  recordingUrl,
  audioRef,
  audioCurrentTime,
  onSeek,
  showHangupMarker = false,
  sectionLabel,
}: CallEventTimelineProps) {
  // Internal diagnostic events (turn_timing sub-timestamps) are stored
  // alongside transcript events but should not render in the timeline —
  // they have no text body so they would show up as empty rows.
  const visibleEvents = events.filter(e => e.eventType !== 'turn_timing');
  if (visibleEvents.length === 0) return null;

  // Find the INDEX of the first termination event in visibleEvents.
  // That event is the authoritative call-end boundary — anything at or
  // after it was logged against a call that was already over. Falls back
  // to endTime (minus a 2s grace) only if there is no termination event.
  const terminationIdx = showHangupMarker
    ? visibleEvents.findIndex(e => e.eventType === 'termination')
    : -1;
  const terminationReason =
    terminationIdx !== -1 ? visibleEvents[terminationIdx].reason : null;
  const reasonLabel = ((): string => {
    if (!terminationReason) return 'Call ended';
    switch (terminationReason) {
      case 'closed_no_menu':
        return 'Call ended — business was closed (no menu)';
      case 'voicemail':
        return 'Call ended — reached voicemail';
      case 'dead_end':
        return 'Call ended — hit dead end in menu';
      case 'runner_timeout':
        return 'Call ended — test runner hit max duration';
      default:
        return `Call ended — ${terminationReason}`;
    }
  })();
  const endMs = endTime ? new Date(endTime).getTime() : null;

  let hangupMarkerRendered = false;
  const rendered: Array<React.ReactNode> = [];

  visibleEvents.forEach((event, idx) => {
    const seekSec = getSeekSeconds(event.timestamp, startTime);
    const nextEvent = visibleEvents[idx + 1];
    const nextSeekSec = nextEvent
      ? getSeekSeconds(nextEvent.timestamp, startTime)
      : Infinity;
    const isActive =
      !!recordingUrl &&
      !!audioRef.current &&
      !audioRef.current.paused &&
      audioCurrentTime >= seekSec &&
      audioCurrentTime < nextSeekSec;

    let isPostHangup = false;
    if (showHangupMarker) {
      const eventMs = event.timestamp ? new Date(event.timestamp).getTime() : 0;
      isPostHangup =
        terminationIdx !== -1
          ? idx > terminationIdx
          : !!endMs && eventMs > endMs + 2000;

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
            ── {reasonLabel}; events below were logged but not actually played
            ──
          </div>
        );
      }
    }

    rendered.push(
      renderEvent(event, idx, {
        isActive,
        isSeekable: !!recordingUrl,
        seekSeconds: seekSec,
        onSeek: () => onSeek(event.timestamp, startTime),
        isPostHangup,
      })
    );
  });

  return (
    <div className="inline-timeline">
      {sectionLabel && <div className="section-label">{sectionLabel}</div>}
      {rendered}
    </div>
  );
}

export default CallEventTimeline;
