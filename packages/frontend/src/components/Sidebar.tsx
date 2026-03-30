import React, { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { WizardData } from '../types/wizard';
import { savedToWizard, recentToWizard } from '../utils/callConversions';
import { useRecentCalls } from '../hooks/useRecentCalls';
import { companyDirectory } from '../data/companyDirectory';
import { timeAgo } from '../utils/time';

export type ActiveView = 'wizard' | 'history' | 'evaluations' | 'test-runs';

function lookupNameByPhone(phone: string): string | undefined {
  const digits = phone.replace(/\D/g, '');
  return companyDirectory.find(c => c.phone.replace(/\D/g, '') === digits)
    ?.name;
}

const PhoneIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
  >
    <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.01L6.6 10.8z" />
  </svg>
);

const HistoryIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
  >
    <path d="M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 13 21a9 9 0 0 0 0-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z" />
  </svg>
);

const ChartIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
  >
    <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z" />
  </svg>
);

const TestIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
  >
    <path d="M19.8 18.4L14 10.67V6.5l1.35-1.69c.26-.33.03-.81-.39-.81H9.04c-.42 0-.65.48-.39.81L10 6.5v4.17L4.2 18.4c-.49.66-.02 1.6.8 1.6h14c.82 0 1.29-.94.8-1.6z" />
  </svg>
);

interface SidebarProps {
  activeView: ActiveView;
  onViewChange: (view: ActiveView) => void;
  onPrefill: (data: WizardData) => void;
  onQuickCall: (data: WizardData) => void;
  onNewCall: () => void;
}

function Sidebar({
  activeView,
  onViewChange,
  onPrefill,
  onQuickCall,
  onNewCall,
}: SidebarProps) {
  const queryClient = useQueryClient();

  const { data: savedCallsData } = useQuery({
    queryKey: ['savedCalls'],
    queryFn: () => api.savedCalls.list(),
  });

  const { calls: recentCalls } = useRecentCalls(5);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.savedCalls.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['savedCalls'] });
    },
  });

  const savedCalls = savedCallsData?.savedCalls ?? [];

  const savedNameByPhone = useMemo(() => {
    const map = new Map<string, string>();
    for (const sc of savedCalls) {
      const digits = sc.toPhoneNumber.replace(/\D/g, '');
      if (!map.has(digits)) map.set(digits, sc.name);
    }
    return map;
  }, [savedCalls]);

  const deduplicatedRecent = recentCalls
    .filter(c => c.metadata?.to)
    .reduce(
      (acc, call) => {
        const to = call.metadata!.to!;
        if (!acc.some(c => c.metadata?.to === to)) acc.push(call);
        return acc;
      },
      [] as typeof recentCalls
    )
    .slice(0, 5);

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <span className="brand-icon">CB</span>
        <span className="brand-text">CallBot</span>
      </div>

      <button className="new-call-btn" onClick={onNewCall}>
        <span className="nav-icon">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
          </svg>
        </span>
        <span className="nav-label">New Call</span>
      </button>

      {/* Recent calls — only visible when expanded */}
      {deduplicatedRecent.length > 0 && (
        <div className="sidebar-section sidebar-expandable">
          <h3 className="sidebar-heading">Recent</h3>
          <ul className="sidebar-list">
            {deduplicatedRecent.map(call => {
              const phone = call.metadata!.to!;
              const digits = phone.replace(/\D/g, '');
              const label =
                savedNameByPhone.get(digits) ||
                lookupNameByPhone(phone) ||
                phone;

              function handleClick() {
                const wizard = recentToWizard(call);
                if (label !== phone) wizard.companyName = label;
                onPrefill(wizard);
              }

              return (
                <li
                  key={call.callSid}
                  className="sidebar-item sidebar-recent-item"
                >
                  <button className="sidebar-recent-btn" onClick={handleClick}>
                    <span className="sidebar-item-name">{label}</span>
                    <span className="sidebar-recent-time">
                      {timeAgo(call.startTime)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Saved calls — only visible when expanded */}
      {savedCalls.length > 0 && (
        <div className="sidebar-section sidebar-expandable">
          <h3 className="sidebar-heading">Saved</h3>
          <ul className="sidebar-list">
            {savedCalls.map(sc => (
              <li key={sc._id} className="sidebar-item">
                <span className="sidebar-item-name">{sc.name}</span>
                <div className="sidebar-item-actions">
                  <button
                    className="icon-btn"
                    title="Edit & review"
                    onClick={() => onPrefill(savedToWizard(sc))}
                  >
                    &#9998;
                  </button>
                  <button
                    className="icon-btn"
                    title="Call now"
                    onClick={() => onQuickCall(savedToWizard(sc))}
                  >
                    &#9654;
                  </button>
                  <button
                    className="icon-btn icon-btn-danger"
                    title="Delete"
                    onClick={() => deleteMutation.mutate(sc._id)}
                  >
                    &times;
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Navigation */}
      <nav className="sidebar-nav">
        <button
          className={`sidebar-nav-btn ${activeView === 'wizard' ? 'nav-active' : ''}`}
          onClick={() => onViewChange('wizard')}
          title="New Call"
        >
          <span className="nav-icon">
            <PhoneIcon />
          </span>
          <span className="nav-label">New Call</span>
        </button>
        <button
          className={`sidebar-nav-btn ${activeView === 'history' ? 'nav-active' : ''}`}
          onClick={() => onViewChange('history')}
          title="Call History"
        >
          <span className="nav-icon">
            <HistoryIcon />
          </span>
          <span className="nav-label">Call History</span>
        </button>
        <button
          className={`sidebar-nav-btn ${activeView === 'evaluations' ? 'nav-active' : ''}`}
          onClick={() => onViewChange('evaluations')}
          title="Evaluations"
        >
          <span className="nav-icon">
            <ChartIcon />
          </span>
          <span className="nav-label">Evaluations</span>
        </button>
        {process.env.NODE_ENV !== 'production' && (
          <button
            className={`sidebar-nav-btn ${activeView === 'test-runs' ? 'nav-active' : ''}`}
            onClick={() => onViewChange('test-runs')}
            title="Test Runs"
          >
            <span className="nav-icon">
              <TestIcon />
            </span>
            <span className="nav-label">Test Runs</span>
          </button>
        )}
      </nav>
    </aside>
  );
}

export default Sidebar;
