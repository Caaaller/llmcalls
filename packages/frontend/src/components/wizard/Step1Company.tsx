import React, { useState, useRef, useEffect } from 'react';
import {
  companyDirectory,
  type CompanyEntry,
} from '../../data/companyDirectory';
import type { WizardData } from '../../types/wizard';

interface Step1CompanyProps {
  data: WizardData;
  onChange: (updates: Partial<WizardData>) => void;
  onNext: () => void;
}

function Step1Company({ data, onChange, onNext }: Step1CompanyProps) {
  const [query, setQuery] = useState(data.companyName || data.toPhoneNumber);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  const filtered = query
    ? companyDirectory.filter(c =>
        c.name.toLowerCase().includes(query.toLowerCase())
      )
    : [];

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function selectCompany(company: CompanyEntry) {
    setQuery(company.name);
    onChange({
      companyName: company.name,
      toPhoneNumber: company.phone,
    });
    setShowSuggestions(false);
  }

  function handleInputChange(value: string) {
    setQuery(value);
    setShowSuggestions(true);

    // If it looks like a phone number, put it in toPhoneNumber
    const isPhone =
      /^[+\d\s()-]+$/.test(value) && value.replace(/\D/g, '').length >= 7;
    if (isPhone) {
      onChange({ companyName: '', toPhoneNumber: value });
    } else {
      onChange({ companyName: value, toPhoneNumber: '' });
    }
  }

  const canProceed = data.toPhoneNumber.length > 0;

  return (
    <div className="wizard-step">
      <h2>Who do you want to call?</h2>
      <p className="step-description">
        Search for a company or enter a phone number directly.
      </p>

      <div className="autocomplete-wrapper">
        <input
          ref={inputRef}
          type="text"
          className="wizard-input"
          placeholder="e.g. Amazon, Chase, or +1 (800) 555-1234"
          value={query}
          onChange={e => handleInputChange(e.target.value)}
          onFocus={() => setShowSuggestions(true)}
          onKeyDown={e => {
            if (e.key === 'Enter' && canProceed) onNext();
          }}
          autoFocus
        />

        {showSuggestions && filtered.length > 0 && (
          <div className="autocomplete-dropdown" ref={suggestionsRef}>
            {filtered.map(company => (
              <button
                key={company.name}
                className="autocomplete-item"
                onClick={() => selectCompany(company)}
              >
                <span className="company-name">{company.name}</span>
                <span className="company-meta">
                  {company.category} &middot; {company.phone}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {data.toPhoneNumber && data.companyName && (
        <p className="selected-phone">{data.toPhoneNumber}</p>
      )}

      <div className="wizard-actions">
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

export default Step1Company;
