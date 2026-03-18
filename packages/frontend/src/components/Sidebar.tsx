import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { SavedCall, WizardData } from '../types/wizard';

export type ActiveView = 'wizard' | 'history' | 'evaluations';

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

  const { data: recentCallsData } = useQuery({
    queryKey: ['calls', 'history', 'sidebar'],
    queryFn: () => api.calls.history(10),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.savedCalls.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['savedCalls'] });
    },
  });

  const savedCalls = savedCallsData?.savedCalls ?? [];
  const recentCalls = recentCallsData?.calls ?? [];

  function savedToWizard(sc: SavedCall): WizardData {
    return {
      companyName: sc.name,
      toPhoneNumber: sc.toPhoneNumber,
      transferNumber: sc.transferNumber,
      callPurpose: sc.callPurpose,
      customInstructions: sc.customInstructions || '',
    };
  }

  function recentToWizard(call: (typeof recentCalls)[0]): WizardData {
    return {
      companyName: '',
      toPhoneNumber: call.metadata?.to || '',
      transferNumber: call.metadata?.transferNumber || '',
      callPurpose: call.metadata?.callPurpose || 'speak with a representative',
      customInstructions: '',
    };
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <h1>CallBot</h1>
      </div>

      <button className="new-call-btn" onClick={onNewCall}>
        + New Call
      </button>

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

      {/* Recent calls */}
      {recentCalls.length > 0 && (
        <div className="sidebar-section">
          <h3 className="sidebar-heading">Recent</h3>
          <ul className="sidebar-list">
            {recentCalls.slice(0, 8).map(call => (
              <li key={call.callSid} className="sidebar-item">
                <span className="sidebar-item-name">
                  {call.metadata?.to || call.callSid.slice(0, 10)}
                </span>
                <div className="sidebar-item-actions">
                  <button
                    className="icon-btn"
                    title="Edit & review"
                    onClick={() => onPrefill(recentToWizard(call))}
                  >
                    &#9998;
                  </button>
                  <button
                    className="icon-btn"
                    title="Call again"
                    onClick={() => onQuickCall(recentToWizard(call))}
                  >
                    &#9654;
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
      </nav>
    </aside>
  );
}

export default Sidebar;
