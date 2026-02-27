import React, { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  api,
  type LiveCallTestCase,
  type LiveCallEvalReport,
} from './api/client';
import './LiveEvalTab.css';

function LiveEvalTab() {
  const [selectedTests, setSelectedTests] = useState<Set<string>>(new Set());
  const [currentReport, setCurrentReport] = useState<LiveCallEvalReport | null>(
    null
  );

  const { data: testCasesData, isLoading: loadingTests } = useQuery({
    queryKey: ['liveEval', 'testCases'],
    queryFn: () => api.liveEval.getTestCases(),
  });

  const runEvalMutation = useMutation({
    mutationFn: () =>
      api.liveEval.run(
        selectedTests.size > 0 ? Array.from(selectedTests) : 'quick'
      ),
    onSuccess: (data: { report?: LiveCallEvalReport }) => {
      if (data.report) {
        setCurrentReport(data.report);
      }
    },
    onError: (error: Error) => {
      alert(`Evaluation failed: ${error.message}`);
    },
  });

  const testCases: LiveCallTestCase[] = testCasesData?.testCases || [];

  const toggleTest = (testId: string) => {
    setSelectedTests(prev => {
      const newSet = new Set(prev);
      if (newSet.has(testId)) {
        newSet.delete(testId);
      } else {
        newSet.add(testId);
      }
      return newSet;
    });
  };

  const selectAll = () => {
    setSelectedTests(new Set(testCases.map(tc => tc.id)));
  };

  const selectNone = () => {
    setSelectedTests(new Set());
  };

  return (
    <div className="live-eval-tab">
      <div className="eval-header">
        <h2>Live Call Evaluations</h2>
        <p>
          Run automated tests that dial real phone numbers and validate IVR
          navigation
        </p>
      </div>

      <div className="eval-actions">
        <button
          className="btn btn-primary"
          onClick={() => runEvalMutation.mutate()}
          disabled={runEvalMutation.isPending}
        >
          {runEvalMutation.isPending ? 'Running...' : '▶ Run Evaluations'}
        </button>
        <span className="eval-info">
          {selectedTests.size > 0
            ? `${selectedTests.size} test(s) selected`
            : 'Running quick tests by default'}
        </span>
      </div>

      <div className="test-cases-section">
        <div className="section-header">
          <h3>Test Cases</h3>
          <div className="selection-actions">
            <button className="link-btn" onClick={selectAll}>
              Select All
            </button>
            <button className="link-btn" onClick={selectNone}>
              Select None
            </button>
          </div>
        </div>

        {loadingTests ? (
          <p>Loading test cases...</p>
        ) : (
          <div className="test-cases-grid">
            {testCases.map(tc => (
              <div
                key={tc.id}
                className={`test-case-card ${selectedTests.has(tc.id) ? 'selected' : ''}`}
                onClick={() => toggleTest(tc.id)}
              >
                <div className="test-case-header">
                  <input
                    type="checkbox"
                    checked={selectedTests.has(tc.id)}
                    onChange={() => toggleTest(tc.id)}
                    onClick={e => e.stopPropagation()}
                  />
                  <span className="test-case-name">{tc.name}</span>
                </div>
                <p className="test-case-desc">{tc.description}</p>
                <div className="test-case-meta">
                  <span>📞 {tc.phoneNumber}</span>
                  <span>🎯 {tc.callPurpose}</span>
                </div>
                {tc.customInstructions && (
                  <div className="test-case-instructions">
                    <small>Instructions: {tc.customInstructions}</small>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {currentReport && (
        <div className="eval-results">
          <div className="results-header">
            <h3>Results</h3>
            <span
              className={`result-badge ${currentReport.failed === 0 ? 'success' : 'failure'}`}
            >
              {currentReport.passed}/{currentReport.totalTests} Passed
            </span>
          </div>

          <div className="results-list">
            {currentReport.results.map((result, idx) => (
              <div
                key={idx}
                className={`result-item ${result.passed ? 'passed' : 'failed'}`}
              >
                <div className="result-summary">
                  <span className="result-icon">
                    {result.passed ? '✅' : '❌'}
                  </span>
                  <span className="result-name">{result.testCaseName}</span>
                  {result.callSid && (
                    <span className="result-sid">SID: {result.callSid}</span>
                  )}
                </div>

                {result.status && (
                  <div className="result-details">
                    <span>Status: {result.status}</span>
                    {result.duration && (
                      <span>Duration: {result.duration}s</span>
                    )}
                    {result.dtmfPresses && (
                      <span>DTMF: {result.dtmfPresses.join(' → ')}</span>
                    )}
                    {result.reachedHuman !== undefined && (
                      <span>
                        Human reached: {result.reachedHuman ? 'Yes' : 'No'}
                      </span>
                    )}
                  </div>
                )}

                {result.error && (
                  <div className="result-error">Error: {result.error}</div>
                )}

                {result.assertions && result.assertions.length > 0 && (
                  <div className="result-assertions">
                    {result.assertions.map((assertion, i) => (
                      <div
                        key={i}
                        className={`assertion ${assertion.passed ? 'passed' : 'failed'}`}
                      >
                        <span>{assertion.passed ? '✅' : '❌'}</span>
                        <span>{assertion.name}:</span>
                        <span className="assertion-msg">
                          {assertion.message}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {runEvalMutation.isPending && (
        <div className="eval-progress">
          <div className="spinner"></div>
          <p>Running live call evaluations... This may take several minutes.</p>
        </div>
      )}
    </div>
  );
}

export default LiveEvalTab;
