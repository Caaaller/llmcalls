import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { WizardData } from '../types/wizard';
import { savedToWizard } from '../utils/callConversions';

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

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.savedCalls.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['savedCalls'] });
    },
  });

  const savedCalls = savedCallsData?.savedCalls ?? [];

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
