import React, { useState, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { WizardData, WizardStep } from '../types/wizard';
import { EMPTY_WIZARD } from '../types/wizard';
import { saveTransferNumber } from '../utils/transferNumberStore';
import Step1Company from './wizard/Step1Company';
import Step2Reason from './wizard/Step2Reason';
import Step3Phone from './wizard/Step3Phone';
import Step4Review from './wizard/Step4Review';

interface CallWizardProps {
  initialData?: WizardData;
  initialStep?: WizardStep;
  defaultTransferNumber: string;
  onCallInitiated?: () => void;
}

const STEP_LABELS: Record<WizardStep, string> = {
  1: 'Company',
  2: 'Reason',
  3: 'Your Phone',
  4: 'Review',
};

function CallWizard({
  initialData,
  initialStep,
  defaultTransferNumber,
  onCallInitiated,
}: CallWizardProps) {
  const [step, setStep] = useState<WizardStep>(initialStep ?? 1);
  const [data, setData] = useState<WizardData>(() => {
    const base = initialData ?? { ...EMPTY_WIZARD };
    if (!base.transferNumber && defaultTransferNumber) {
      base.transferNumber = defaultTransferNumber;
    }
    return base;
  });

  const queryClient = useQueryClient();

  const updateData = useCallback((updates: Partial<WizardData>) => {
    setData(prev => ({ ...prev, ...updates }));
  }, []);

  const handlePrefillAndReview = useCallback((prefill: WizardData) => {
    setData(prefill);
    setStep(4);
  }, []);

  const initiateCallMutation = useMutation({
    mutationFn: (payload: {
      to: string;
      transferNumber: string;
      callPurpose: string;
      customInstructions: string;
      skipInfoRequests?: boolean;
    }) => api.calls.initiate(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calls', 'history'] });
      onCallInitiated?.();
    },
  });

  const saveCallMutation = useMutation({
    mutationFn: (payload: {
      name: string;
      toPhoneNumber: string;
      transferNumber: string;
      callPurpose: string;
      customInstructions?: string;
    }) => api.savedCalls.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['savedCalls'] });
    },
  });

  function handleCall(save: boolean, saveName: string) {
    if (save && saveName) {
      saveCallMutation.mutate({
        name: saveName,
        toPhoneNumber: data.toPhoneNumber,
        transferNumber: data.transferNumber,
        callPurpose: data.callPurpose,
        customInstructions: data.customInstructions || undefined,
      });
    }

    saveTransferNumber(data.transferNumber);

    initiateCallMutation.mutate({
      to: data.toPhoneNumber,
      transferNumber: data.transferNumber,
      callPurpose: data.callPurpose,
      customInstructions: data.customInstructions,
      skipInfoRequests: data.skipInfoRequests,
    });
  }

  function jumpToStep(target: WizardStep) {
    setStep(target);
  }

  return (
    <div className="call-wizard">
      {/* Step indicator */}
      <div className="step-indicator">
        {([1, 2, 3, 4] as Array<WizardStep>).map(s => (
          <div
            key={s}
            className={`step-dot ${s === step ? 'step-active' : ''} ${s < step ? 'step-done' : ''}`}
            onClick={() => {
              if (s < step) setStep(s);
            }}
          >
            <span className="step-number">{s < step ? '\u2713' : s}</span>
            <span className="step-label">{STEP_LABELS[s]}</span>
          </div>
        ))}
      </div>

      {/* Error display */}
      {initiateCallMutation.error && (
        <div className="wizard-error">{initiateCallMutation.error.message}</div>
      )}

      {initiateCallMutation.isSuccess && (
        <div className="wizard-success">
          Call started! We're navigating the phone system for you.
        </div>
      )}

      {/* Steps */}
      {step === 1 && (
        <Step1Company
          data={data}
          onChange={updateData}
          onNext={() => setStep(2)}
          onPrefillAndReview={handlePrefillAndReview}
        />
      )}
      {step === 2 && (
        <Step2Reason
          data={data}
          onChange={updateData}
          onNext={() => setStep(3)}
          onBack={() => setStep(1)}
        />
      )}
      {step === 3 && (
        <Step3Phone
          data={data}
          onChange={updateData}
          onNext={() => setStep(4)}
          onBack={() => setStep(2)}
        />
      )}
      {step === 4 && (
        <Step4Review
          data={data}
          onChange={updateData}
          onCall={handleCall}
          onJumpToStep={jumpToStep}
          onBack={() => setStep(3)}
          isCalling={initiateCallMutation.isPending}
        />
      )}
    </div>
  );
}

export default CallWizard;
