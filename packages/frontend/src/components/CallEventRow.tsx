import React from 'react';
import type { CallEvent } from '../api/client';
import { formatTimeOfDay } from '../utils/callFormatting';

interface CallEventRowProps {
  event: CallEvent;
  isActive?: boolean;
  isSeekable?: boolean;
  seekSeconds?: number;
  onSeek?: () => void;
}

interface EventTypeMeta {
  rowClass: string;
  badgeClass: string;
  badgeLabel: string;
}

function getEventTypeMeta(event: CallEvent): EventTypeMeta {
  switch (event.eventType) {
    case 'conversation':
      if (event.type === 'user')
        return {
          rowClass: 'event-row event-user',
          badgeClass: 'event-type-badge type-user',
          badgeLabel: 'User',
        };
      if (event.type === 'ai')
        return {
          rowClass: 'event-row event-ai',
          badgeClass: 'event-type-badge type-ai',
          badgeLabel: 'AI',
        };
      return {
        rowClass: 'event-row event-system',
        badgeClass: 'event-type-badge type-system',
        badgeLabel: 'System',
      };
    case 'dtmf':
      return {
        rowClass: 'event-row event-dtmf',
        badgeClass: 'event-type-badge type-dtmf',
        badgeLabel: 'DTMF',
      };
    case 'ivr_menu':
      return {
        rowClass: 'event-row event-ivr',
        badgeClass: 'event-type-badge type-ivr',
        badgeLabel: 'IVR',
      };
    case 'transfer':
      return {
        rowClass: 'event-row event-transfer',
        badgeClass: 'event-type-badge type-transfer',
        badgeLabel: 'Transfer',
      };
    case 'termination':
      return {
        rowClass: 'event-row event-termination',
        badgeClass: 'event-type-badge type-termination',
        badgeLabel: 'End',
      };
    case 'hold':
      return {
        rowClass: 'event-row event-hold',
        badgeClass: 'event-type-badge type-hold',
        badgeLabel: 'Hold',
      };
    case 'info_request':
      return {
        rowClass: 'event-row event-info',
        badgeClass: 'event-type-badge type-info',
        badgeLabel: 'Info Req',
      };
    case 'info_response':
      return {
        rowClass: 'event-row event-info',
        badgeClass: 'event-type-badge type-info',
        badgeLabel: 'Info Res',
      };
    case 'turn_timing':
      // Diagnostic event — HistoryTab filters these out before render.
      // This case exists to satisfy exhaustive switch typecheck.
      return {
        rowClass: 'event-row',
        badgeClass: 'event-type-badge',
        badgeLabel: '',
      };
  }
}

function renderEventBody(event: CallEvent) {
  switch (event.eventType) {
    case 'conversation':
      return <span>{event.text}</span>;
    case 'dtmf':
      return (
        <span>
          <strong>Press {event.digit}</strong>
          {event.reason ? ` — ${event.reason}` : ''}
        </span>
      );
    case 'ivr_menu':
      return (
        <span>
          {event.menuOptions
            ? event.menuOptions.map(o => `${o.digit}=${o.option}`).join(', ')
            : 'IVR menu detected'}
        </span>
      );
    case 'transfer':
      return (
        <span>
          <strong>Transfer {event.success ? 'Successful' : 'Attempted'}</strong>
          {event.transferNumber ? ` to ${event.transferNumber}` : ''}
        </span>
      );
    case 'termination':
      return (
        <span>Call terminated{event.reason ? `: ${event.reason}` : ''}</span>
      );
    case 'hold':
      return <span>Hold queue detected</span>;
    case 'info_request':
      return <span>Requested: {event.text}</span>;
    case 'info_response':
      return <span>Answered: {event.text}</span>;
    case 'turn_timing':
      return null;
  }
}

function CallEventRow({
  event,
  isActive = false,
  isSeekable = false,
  seekSeconds = 0,
  onSeek,
}: CallEventRowProps) {
  const meta = getEventTypeMeta(event);
  return (
    <div className={`${meta.rowClass}${isActive ? ' event-row-active' : ''}`}>
      <div className="event-inner">
        <span
          className={`event-time${isSeekable ? ' timeline-time-clickable' : ''}`}
          onClick={isSeekable ? onSeek : undefined}
          title={isSeekable ? `Seek to ${Math.floor(seekSeconds)}s` : undefined}
        >
          {formatTimeOfDay(event.timestamp)}
        </span>
        <span className={meta.badgeClass}>{meta.badgeLabel}</span>
        <span className="event-text">{renderEventBody(event)}</span>
      </div>
    </div>
  );
}

export default CallEventRow;
