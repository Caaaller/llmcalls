import React, { useState } from 'react';
import type { WizardData, WizardStep } from '../../types/wizard';

interface Step4ReviewProps {
  data: WizardData;
  onCall: (save: boolean, saveName: string) => void;
  onJumpToStep: (step: WizardStep) => void;
  onBack: () => void;
  isCalling: boolean;
}

function Step4Review({
  data,
  onCall,
  onJumpToStep,
  onBack,
  isCalling,
}: Step4ReviewProps) {
  const [saveCall, setSaveCall] = useState(false);
  const [saveName, setSaveName] = useState(
    data.companyName || data.toPhoneNumber
  );

  const displayName = data.companyName || data.toPhoneNumber;

  return (
    <div className="wizard-step">
      <h2>Review & Call</h2>
      <p className="step-description">
        Double-check everything before we start the call.
      </p>

      <div className="review-card">
        <div className="review-row">
          <span className="review-label">Calling</span>
          <span className="review-value">
            {displayName}
            {data.companyName && (
              <span className="review-sub">{data.toPhoneNumber}</span>
            )}
          </span>
          <button
            className="edit-pencil"
            onClick={() => onJumpToStep(1)}
            title="Edit"
          >
            &#9998;
          </button>
        </div>

        <div className="review-row">
          <span className="review-label">Reason</span>
          <span className="review-value">{data.callPurpose}</span>
          <button
            className="edit-pencil"
            onClick={() => onJumpToStep(2)}
            title="Edit"
          >
            &#9998;
          </button>
        </div>

        {data.customInstructions && (
          <div className="review-row">
            <span className="review-label">Instructions</span>
            <span className="review-value review-instructions">
              {data.customInstructions}
            </span>
            <button
              className="edit-pencil"
              onClick={() => onJumpToStep(2)}
              title="Edit"
            >
              &#9998;
            </button>
          </div>
        )}

        <div className="review-row">
          <span className="review-label">Your phone</span>
          <span className="review-value">{data.transferNumber}</span>
          <button
            className="edit-pencil"
            onClick={() => onJumpToStep(3)}
            title="Edit"
          >
            &#9998;
          </button>
        </div>
      </div>

      <label className="save-checkbox">
        <input
          type="checkbox"
          checked={saveCall}
          onChange={e => setSaveCall(e.target.checked)}
        />
        Save this call for later
      </label>

      {saveCall && (
        <input
          type="text"
          className="wizard-input save-name-input"
          placeholder="Name this call (e.g. Chase billing)"
          value={saveName}
          onChange={e => setSaveName(e.target.value)}
        />
      )}

      <div className="wizard-actions">
        <button className="btn btn-secondary" onClick={onBack}>
          Back
        </button>
        <button
          className="btn btn-success btn-call"
          disabled={isCalling}
          onClick={() => onCall(saveCall, saveName)}
        >
          {isCalling ? 'Starting call...' : 'Start Call'}
        </button>
      </div>
    </div>
  );
}

export default Step4Review;
