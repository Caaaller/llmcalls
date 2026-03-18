import React from 'react';
import type { WizardData } from '../../types/wizard';

interface Step3PhoneProps {
  data: WizardData;
  onChange: (updates: Partial<WizardData>) => void;
  onNext: () => void;
  onBack: () => void;
}

function Step3Phone({ data, onChange, onNext, onBack }: Step3PhoneProps) {
  const canProceed = data.transferNumber.trim().length > 0;

  return (
    <div className="wizard-step">
      <h2>Your phone number</h2>
      <p className="step-description">
        When we reach a human agent, we'll connect them to this number.
      </p>

      <input
        type="tel"
        className="wizard-input"
        placeholder="+1 (555) 123-4567"
        value={data.transferNumber}
        onChange={e => onChange({ transferNumber: e.target.value })}
        onKeyDown={e => {
          if (e.key === 'Enter' && canProceed) onNext();
        }}
        autoFocus
      />

      <div className="wizard-actions">
        <button className="btn btn-secondary" onClick={onBack}>
          Back
        </button>
        <button
          className="btn btn-primary"
          disabled={!canProceed}
          onClick={onNext}
        >
          Review
        </button>
      </div>
    </div>
  );
}

export default Step3Phone;
