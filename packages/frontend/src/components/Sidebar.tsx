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
        <h1>CallBot</h1>
      </div>

      <button className="new-call-btn" onClick={onNewCall}>
        + New Call
      </button>

      {/* Recent calls */}
      {deduplicatedRecent.length > 0 && (
        <div className="sidebar-section">
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

      {/* Saved calls */}
      {savedCalls.length > 0 && (
        <div className="sidebar-section">
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
        >
          New Call
        </button>
        <button
          className={`sidebar-nav-btn ${activeView === 'history' ? 'nav-active' : ''}`}
          onClick={() => onViewChange('history')}
        >
          Call History
        </button>
        <button
          className={`sidebar-nav-btn ${activeView === 'evaluations' ? 'nav-active' : ''}`}
          onClick={() => onViewChange('evaluations')}
        >
          Evaluations
        </button>
        {process.env.NODE_ENV !== 'production' && (
          <button
            className={`sidebar-nav-btn ${activeView === 'test-runs' ? 'nav-active' : ''}`}
            onClick={() => onViewChange('test-runs')}
          >
            Test Runs
          </button>
        )}
      </nav>
    </aside>
  );
}

export default Sidebar;
