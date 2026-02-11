import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import './EvaluationsTab.css';
import {
  api,
  type EvaluationResponse,
  type BreakdownResponse,
} from './api/client';

function EvaluationsTab() {
  const [days, setDays] = useState<number>(30);
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  // Fetch evaluation metrics
  const {
    data: metricsData,
    isLoading: isLoadingMetrics,
    error: metricsError,
    refetch: refetchMetrics,
  } = useQuery<EvaluationResponse>({
    queryKey: ['evaluations', days, startDate, endDate],
    queryFn: () =>
      api.evaluations.get({
        days: startDate || endDate ? undefined : days,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      }),
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Fetch breakdown
  const {
    data: breakdownData,
    isLoading: isLoadingBreakdown,
    refetch: refetchBreakdown,
  } = useQuery<BreakdownResponse>({
    queryKey: ['evaluations', 'breakdown', startDate, endDate],
    queryFn: () =>
      api.evaluations.breakdown({
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      }),
    refetchInterval: 30000,
  });

  const metrics = metricsData?.metrics;
  const breakdown = breakdownData?.breakdown;

  const handleQuickFilter = (selectedDays: number) => {
    setDays(selectedDays);
    setStartDate('');
    setEndDate('');
  };

  const formatDate = (dateString: string): string => {
    if (!dateString) return '';
    try {
      return new Date(dateString).toLocaleDateString();
    } catch {
      return dateString;
    }
  };

  const formatDuration = (ms: number): string => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    }
    return `${minutes}m ${seconds % 60}s`;
  };

  return (
    <div className="evaluations-container">
      <div className="evaluations-header">
        <h2>📊 Call Evaluations</h2>
        <button
          onClick={() => {
            refetchMetrics();
            refetchBreakdown();
          }}
          className="btn-refresh"
          disabled={isLoadingMetrics || isLoadingBreakdown}
        >
          {isLoadingMetrics || isLoadingBreakdown
            ? '⏳ Loading...'
            : '🔄 Refresh'}
        </button>
      </div>

      {/* Filters */}
      <div className="filters-section">
        <div className="filter-group">
          <label>Quick Filters:</label>
          <div className="filter-buttons">
            <button
              className={`filter-btn ${days === 7 ? 'active' : ''}`}
              onClick={() => handleQuickFilter(7)}
            >
              Last 7 days
            </button>
            <button
              className={`filter-btn ${days === 30 ? 'active' : ''}`}
              onClick={() => handleQuickFilter(30)}
            >
              Last 30 days
            </button>
            <button
              className={`filter-btn ${days === 90 ? 'active' : ''}`}
              onClick={() => handleQuickFilter(90)}
            >
              Last 90 days
            </button>
            <button
              className={`filter-btn ${!startDate && !endDate && days === 0 ? 'active' : ''}`}
              onClick={() => handleQuickFilter(0)}
            >
              All Time
            </button>
          </div>
        </div>

        <div className="filter-group">
          <label>Custom Date Range:</label>
          <div className="date-inputs">
            <input
              type="date"
              value={startDate}
              onChange={e => {
                setStartDate(e.target.value);
                setDays(0);
              }}
              className="date-input"
            />
            <span>to</span>
            <input
              type="date"
              value={endDate}
              onChange={e => {
                setEndDate(e.target.value);
                setDays(0);
              }}
              className="date-input"
            />
          </div>
        </div>
      </div>

      {metricsError && (
        <div className="error-message">
          Error loading evaluation metrics. Make sure the backend server is
          running.
        </div>
      )}

      {isLoadingMetrics ? (
        <div className="loading">Loading metrics...</div>
      ) : metrics ? (
        <>
          {/* Key Metrics Cards */}
          <div className="metrics-grid">
            <div className="metric-card">
              <div className="metric-header">
                <h3>Total Calls</h3>
                <span className="metric-icon">📞</span>
              </div>
              <div className="metric-value">{metrics.totalCalls}</div>
              {metrics.period && (
                <div className="metric-period">
                  {formatDate(metrics.period.startDate)} -{' '}
                  {formatDate(metrics.period.endDate)}
                </div>
              )}
            </div>

            <div className="metric-card success">
              <div className="metric-header">
                <h3>Successful Agent Reach</h3>
                <span className="metric-icon">✅</span>
              </div>
              <div className="metric-value">
                {metrics.successfulAgentReach.percentage.toFixed(1)}%
              </div>
              <div className="metric-count">
                {metrics.successfulAgentReach.count} of {metrics.totalCalls}{' '}
                calls
              </div>
            </div>

            <div className="metric-card info">
              <div className="metric-header">
                <h3>Transfer After Agent Join</h3>
                <span className="metric-icon">🔄</span>
              </div>
              <div className="metric-value">
                {metrics.transferAfterAgentJoin.percentage.toFixed(1)}%
              </div>
              <div className="metric-count">
                {metrics.transferAfterAgentJoin.count} of {metrics.totalCalls}{' '}
                calls
              </div>
            </div>

            <div className="metric-card warning">
              <div className="metric-header">
                <h3>Dropped or Failed</h3>
                <span className="metric-icon">⚠️</span>
              </div>
              <div className="metric-value">
                {metrics.droppedOrFailed.percentage.toFixed(1)}%
              </div>
              <div className="metric-count">
                {metrics.droppedOrFailed.count} of {metrics.totalCalls} calls
              </div>
            </div>
          </div>

          {/* Detailed Breakdown */}
          {breakdown && (
            <div className="breakdown-section">
              <h3>Detailed Breakdown</h3>
              <div className="breakdown-grid">
                <div className="breakdown-card">
                  <h4>Call Status</h4>
                  <div className="breakdown-list">
                    <div className="breakdown-item">
                      <span>In Progress:</span>
                      <strong>{breakdown.byStatus['in-progress']}</strong>
                    </div>
                    <div className="breakdown-item">
                      <span>Completed:</span>
                      <strong style={{ color: '#28a745' }}>
                        {breakdown.byStatus.completed}
                      </strong>
                    </div>
                    <div className="breakdown-item">
                      <span>Failed:</span>
                      <strong style={{ color: '#dc3545' }}>
                        {breakdown.byStatus.failed}
                      </strong>
                    </div>
                    <div className="breakdown-item">
                      <span>Terminated:</span>
                      <strong style={{ color: '#ffc107' }}>
                        {breakdown.byStatus.terminated}
                      </strong>
                    </div>
                  </div>
                </div>

                <div className="breakdown-card">
                  <h4>Transfer Statistics</h4>
                  <div className="breakdown-list">
                    <div className="breakdown-item">
                      <span>With Transfers:</span>
                      <strong>{breakdown.withTransfers}</strong>
                    </div>
                    <div className="breakdown-item">
                      <span>Successful Transfers:</span>
                      <strong style={{ color: '#28a745' }}>
                        {breakdown.withSuccessfulTransfers}
                      </strong>
                    </div>
                    <div className="breakdown-item">
                      <span>Transfer Success Rate:</span>
                      <strong>
                        {breakdown.withTransfers > 0
                          ? (
                              (breakdown.withSuccessfulTransfers /
                                breakdown.withTransfers) *
                              100
                            ).toFixed(1)
                          : 0}
                        %
                      </strong>
                    </div>
                  </div>
                </div>

                <div className="breakdown-card">
                  <h4>Call Duration</h4>
                  <div className="breakdown-list">
                    <div className="breakdown-item">
                      <span>Average Duration:</span>
                      <strong>
                        {breakdown.averageDuration > 0
                          ? formatDuration(breakdown.averageDuration)
                          : 'N/A'}
                      </strong>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="empty-state">No evaluation data available</div>
      )}
    </div>
  );
}

export default EvaluationsTab;




