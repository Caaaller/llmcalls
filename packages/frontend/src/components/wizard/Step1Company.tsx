import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import {
  companyDirectory,
  type CompanyEntry,
} from '../../data/companyDirectory';
import type { WizardData } from '../../types/wizard';
import { useRecentCalls } from '../../hooks/useRecentCalls';
import { recentToWizard } from '../../utils/callConversions';
import { timeAgo } from '../../utils/time';

interface Step1CompanyProps {
  data: WizardData;
  onChange: (updates: Partial<WizardData>) => void;
  onNext: () => void;
  onPrefillAndReview: (data: WizardData) => void;
}

function lookupNameByPhone(phone: string): string | undefined {
  const digits = phone.replace(/\D/g, '');
  return companyDirectory.find(c => c.phone.replace(/\D/g, '') === digits)
    ?.name;
}

function Step1Company({
  data,
  onChange,
  onNext,
  onPrefillAndReview,
}: Step1CompanyProps) {
  const [query, setQuery] = useState(data.companyName || data.toPhoneNumber);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  const { calls: recentCalls } = useRecentCalls(10);
  const { data: savedCallsData } = useQuery({
    queryKey: ['savedCalls'],
    queryFn: () => api.savedCalls.list(),
  });

  const savedNameByPhone = useMemo(() => {
    const map = new Map<string, string>();
    for (const sc of savedCallsData?.savedCalls ?? []) {
      const digits = sc.toPhoneNumber.replace(/\D/g, '');
      if (!map.has(digits)) map.set(digits, sc.name);
    }
    return map;
  }, [savedCallsData]);

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

      {deduplicatedRecent.length > 0 && !query && (
        <>
          <div className="recent-calls-list">
            {deduplicatedRecent.map(call => {
              const phone = call.metadata!.to!;
              const digits = phone.replace(/\D/g, '');
              const label =
                savedNameByPhone.get(digits) || lookupNameByPhone(phone);

              function handleClick() {
                const wizard = recentToWizard(call);
                if (label) wizard.companyName = label;
                onPrefillAndReview(wizard);
              }

              return (
                <button
                  key={call.callSid}
                  className="recent-call-item"
                  onClick={handleClick}
                >
                  <div className="recent-call-info">
                    <span className="recent-call-number">{label || phone}</span>
                    {call.metadata?.callPurpose && (
                      <span className="recent-call-purpose">
                        {call.metadata.callPurpose}
                      </span>
                    )}
                  </div>
                  <span className="recent-call-time">
                    {timeAgo(call.startTime)}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="wizard-divider">
            <span>or start new</span>
          </div>
        </>
      )}

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
