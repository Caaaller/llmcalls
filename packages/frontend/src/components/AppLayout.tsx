import React, { useState, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Sidebar, { type ActiveView } from './Sidebar';
import CallWizard from './CallWizard';
import HistoryTab from '../HistoryTab';
import EvaluationsTab from '../EvaluationsTab';
import TestRunsTab from '../TestRunsTab';
import { api } from '../api/client';
import type { WizardData, WizardStep } from '../types/wizard';
import type { User } from '../utils/auth';

interface AppLayoutProps {
  user: User;
  defaultTransferNumber: string;
  onLogout: () => void;
}

function AppLayout({ user, defaultTransferNumber, onLogout }: AppLayoutProps) {
  const [activeView, setActiveView] = useState<ActiveView>('wizard');
  const [wizardKey, setWizardKey] = useState(0);
  const [wizardInitial, setWizardInitial] = useState<WizardData | undefined>();
  const [wizardInitialStep, setWizardInitialStep] = useState<
    WizardStep | undefined
  >();

  const queryClient = useQueryClient();

  const quickCallMutation = useMutation({
    mutationFn: (data: WizardData) =>
      api.calls.initiate({
        to: data.toPhoneNumber,
        transferNumber: data.transferNumber,
        callPurpose: data.callPurpose,
        customInstructions: data.customInstructions,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calls', 'history'] });
    },
  });

  const handleNewCall = useCallback(() => {
    setWizardInitial(undefined);
    setWizardInitialStep(undefined);
    setWizardKey(k => k + 1);
    setActiveView('wizard');
  }, []);

  const handlePrefill = useCallback((data: WizardData) => {
    setWizardInitial(data);
    setWizardInitialStep(4);
    setWizardKey(k => k + 1);
    setActiveView('wizard');
  }, []);

  const handleQuickCall = useCallback(
    (data: WizardData) => {
      if (!data.transferNumber) {
        data.transferNumber = defaultTransferNumber;
      }
      quickCallMutation.mutate(data);
    },
    [defaultTransferNumber, quickCallMutation]
  );

  return (
    <div className="app-layout">
      <Sidebar
        activeView={activeView}
        onViewChange={setActiveView}
        onPrefill={handlePrefill}
        onQuickCall={handleQuickCall}
        onNewCall={handleNewCall}
      />

      <main className="main-content">
        <header className="main-header">
          <div />
          <div className="user-info">
            <span className="user-name">{user.name || user.email}</span>
            <button className="logout-btn" onClick={onLogout}>
              Logout
            </button>
          </div>
        </header>

        {quickCallMutation.isSuccess && (
          <div className="wizard-success">
            Call started! We're navigating the phone system for you.
          </div>
        )}
        {quickCallMutation.error && (
          <div className="wizard-error">{quickCallMutation.error.message}</div>
        )}

        <div className="main-body">
          {activeView === 'wizard' && (
            <CallWizard
              key={wizardKey}
              initialData={wizardInitial}
              initialStep={wizardInitialStep}
              defaultTransferNumber={defaultTransferNumber}
              onCallInitiated={() => {
                queryClient.invalidateQueries({
                  queryKey: ['calls', 'history'],
                });
              }}
            />
          )}
          {activeView === 'history' && <HistoryTab />}
          {activeView === 'evaluations' && <EvaluationsTab />}
          {activeView === 'test-runs' && <TestRunsTab />}
        </div>
      </main>
    </div>
  );
}

export default AppLayout;
