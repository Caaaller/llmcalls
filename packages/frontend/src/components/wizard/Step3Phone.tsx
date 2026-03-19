import React from 'react';
import type { WizardData } from '../../types/wizard';
import { getSavedTransferNumbers } from '../../utils/transferNumberStore';

interface Step3PhoneProps {
  data: WizardData;
  onChange: (updates: Partial<WizardData>) => void;
  onNext: () => void;
  onBack: () => void;
}

function Step3Phone({ data, onChange, onNext, onBack }: Step3PhoneProps) {
  const savedNumbers = getSavedTransferNumbers();
  const canProceed = data.transferNumber.trim().length > 0;

  return (
    <div className="wizard-step">
      <h2>Your phone number</h2>
      <p className="step-description">
        When we reach a human agent, we'll connect them to this number.
      </p>

      {savedNumbers.length > 0 && (
        <>
          <div className="chips-label">Your numbers</div>
          <div className="chips-row">
            {savedNumbers.map(number => (
              <button
                key={number}
                className={`chip chip-history ${data.transferNumber === number ? 'chip-active' : ''}`}
                onClick={() => onChange({ transferNumber: number })}
              >
                {number}
              </button>
            ))}
          </div>
          <div className="wizard-divider">
            <span>or enter new</span>
          </div>
        </>
      )}

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
