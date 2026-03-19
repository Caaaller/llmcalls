import React, { useState } from 'react';
import type { WizardData } from '../../types/wizard';
import { useRecentCalls } from '../../hooks/useRecentCalls';

interface Step2ReasonProps {
  data: WizardData;
  onChange: (updates: Partial<WizardData>) => void;
  onNext: () => void;
  onBack: () => void;
}

const SUGGESTION_CHIPS = [
  'Speak with a representative',
  'Cancel my subscription',
  'Check order status',
  'Billing question',
  'Technical support',
  'File a complaint',
  'Request a refund',
];

function Step2Reason({ data, onChange, onNext, onBack }: Step2ReasonProps) {
  const [showInstructions, setShowInstructions] = useState(
    data.customInstructions.length > 0
  );

  const { calls: recentCalls } = useRecentCalls(20);

  const suggestionLower = SUGGESTION_CHIPS.map(c => c.toLowerCase());
  const usedBefore = recentCalls
    .filter(
      c => c.metadata?.to === data.toPhoneNumber && c.metadata?.callPurpose
    )
    .map(c => c.metadata!.callPurpose!)
    .filter((purpose, i, arr) => arr.indexOf(purpose) === i)
    .filter(purpose => !suggestionLower.includes(purpose.toLowerCase()));

  const canProceed = data.callPurpose.trim().length > 0;

  return (
    <div className="wizard-step">
      <h2>What's the reason for your call?</h2>
      <p className="step-description">
        Tell us why you're calling so our AI knows what to navigate to.
      </p>

      {usedBefore.length > 0 && (
        <>
          <div className="chips-label">Used before</div>
          <div className="chips-row">
            {usedBefore.map(purpose => (
              <button
                key={purpose}
                className={`chip chip-history ${data.callPurpose === purpose ? 'chip-active' : ''}`}
                onClick={() => onChange({ callPurpose: purpose })}
              >
                {purpose}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="chips-row">
        {SUGGESTION_CHIPS.map(chip => (
          <button
            key={chip}
            className={`chip ${data.callPurpose === chip.toLowerCase() ? 'chip-active' : ''}`}
            onClick={() => onChange({ callPurpose: chip.toLowerCase() })}
          >
            {chip}
          </button>
        ))}
      </div>

      <input
        type="text"
        className="wizard-input"
        placeholder="Or type your own reason..."
        value={data.callPurpose}
        onChange={e => onChange({ callPurpose: e.target.value })}
        onKeyDown={e => {
          if (e.key === 'Enter' && canProceed) onNext();
        }}
      />

      {!showInstructions ? (
        <button className="link-btn" onClick={() => setShowInstructions(true)}>
          + Add custom instructions
        </button>
      ) : (
        <div className="instructions-section">
          <label className="wizard-label">Custom instructions (optional)</label>
          <textarea
            className="wizard-textarea"
            rows={3}
            placeholder="e.g. My account number is 12345, my name is John Smith..."
            value={data.customInstructions}
            onChange={e => onChange({ customInstructions: e.target.value })}
          />
        </div>
      )}

      <div className="wizard-actions">
        <button className="btn btn-secondary" onClick={onBack}>
          Back
        </button>
        <button
          className="btn btn-primary"
          disabled={!canProceed}
          onClick={onNext}
        >
          Next
        </button>
      </div>
    </div>
  );
}

export default Step2Reason;
