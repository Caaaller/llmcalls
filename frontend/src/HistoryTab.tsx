import React, { useState, useEffect } from 'react';
import './HistoryTab.css';

interface CallMetadata {
  to?: string;
  from?: string;
  transferNumber?: string;
  callPurpose?: string;
}

interface DTMFPress {
  digit: string;
  reason?: string;
  timestamp?: Date | string;
}

interface ConversationEntry {
  type: 'user' | 'ai' | 'system';
  text: string;
  timestamp?: Date | string;
}

interface MenuOption {
  digit: string;
  option: string;
}

interface CallEvent {
  eventType: 'conversation' | 'dtmf' | 'ivr_menu' | 'transfer' | 'termination';
  type?: 'user' | 'ai' | 'system';
  text?: string;
  digit?: string;
  reason?: string;
  menuOptions?: MenuOption[];
  transferNumber?: string;
  success?: boolean;
  timestamp?: Date | string;
}

interface Call {
  callSid: string;
  startTime: Date | string;
  endTime?: Date | string;
  duration?: number;
  status: 'in-progress' | 'completed' | 'failed' | 'terminated';
  metadata?: CallMetadata;
  conversationCount?: number;
  dtmfCount?: number;
}

interface CallDetails extends Call {
  conversation: ConversationEntry[];
  dtmfPresses: DTMFPress[];
  events: CallEvent[];
}

function HistoryTab() {
  const [calls, setCalls] = useState<Call[]>([]);
  const [selectedCall, setSelectedCall] = useState<CallDetails | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadHistory();
    // Refresh every 5 seconds
    const interval = setInterval(loadHistory, 5000);
    return () => clearInterval(interval);
  }, []);

  const loadHistory = async (): Promise<void> => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('http://localhost:3000/api/calls/history?limit=50', {
        headers: token ? {
          'Authorization': `Bearer ${token}`
        } : {},
        mode: 'cors'
      });
      if (response.ok) {
        const data = await response.json();
        setCalls(data.calls || []);
        
        // Show helpful message if MongoDB is not connected
        if (data.mongoConnected === false) {
          setError('⚠️ MongoDB not connected. Call history will not be saved. Add MONGODB_URI to .env to enable call history.');
        } else {
          setError(null);
        }
      } else {
        const errorData = await response.json().catch(() => ({}));
        setError(errorData.error || 'Failed to load call history');
      }
    } catch (err) {
      console.error('Error loading history:', err);
      setError('Error loading call history. Make sure the backend server is running.');
    }
  };

  const loadCallDetails = async (callSid: string): Promise<void> => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`http://localhost:3000/api/calls/${callSid}`, {
        headers: token ? {
          'Authorization': `Bearer ${token}`
        } : {},
        mode: 'cors'
      });
      if (response.ok) {
        const data = await response.json();
        setSelectedCall(data.call);
      } else {
        alert('Failed to load call details');
      }
    } catch (err) {
      console.error('Error loading call details:', err);
      alert('Error loading call details');
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (date: Date | string | null | undefined): string => {
    if (!date) return 'N/A';
    return new Date(date).toLocaleString();
  };

  const formatDuration = (ms: number | null | undefined): string => {
    if (!ms) return 'N/A';
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}m ${secs}s`;
  };

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'completed': return '#28a745';
      case 'in-progress': return '#007bff';
      case 'failed': return '#dc3545';
      case 'terminated': return '#ffc107';
      default: return '#6c757d';
    }
  };

  return (
    <div className="history-container">
      <div className="history-header">
        <h2>📞 Call History</h2>
        <button onClick={loadHistory} className="btn-refresh">🔄 Refresh</button>
      </div>

      {error && (
        <div className={`error-message ${error.includes('MongoDB') ? 'warning-message' : ''}`}>
          {error}
          {error.includes('MongoDB') && (
            <div style={{ marginTop: '10px', fontSize: '0.9rem' }}>
              <strong>Quick Setup:</strong>
              <ol style={{ marginLeft: '20px', marginTop: '5px' }}>
                <li>Go to <a href="https://www.mongodb.com/cloud/atlas" target="_blank" rel="noopener noreferrer">MongoDB Atlas</a> (free)</li>
                <li>Create a free cluster</li>
                <li>Get your connection string</li>
                <li>Add to .env: <code>MONGODB_URI=your_connection_string</code></li>
                <li>Restart the server</li>
              </ol>
            </div>
          )}
        </div>
      )}

      <div className="history-layout">
        {/* Calls List */}
        <div className="calls-list">
          <h3>Recent Calls ({calls.length})</h3>
          {calls.length === 0 ? (
            <div className="empty-state">No calls yet</div>
          ) : (
            <div className="calls-list-items">
              {calls.map((call) => (
                <div
                  key={call.callSid}
                  className={`call-item ${selectedCall?.callSid === call.callSid ? 'active' : ''}`}
                  onClick={() => loadCallDetails(call.callSid)}
                >
                  <div className="call-item-header">
                    <span className="call-sid">{call.callSid.substring(0, 20)}...</span>
                    <span
                      className="call-status"
                      style={{ color: getStatusColor(call.status) }}
                    >
                      {call.status}
                    </span>
                  </div>
                  <div className="call-item-meta">
                    <div>📞 To: {call.metadata?.to || 'N/A'}</div>
                    <div>🕐 {formatTime(call.startTime)}</div>
                    <div>⏱️ {formatDuration(call.duration)}</div>
                  </div>
                  <div className="call-item-stats">
                    <span>💬 {call.conversationCount || 0} messages</span>
                    <span>🔢 {call.dtmfCount || 0} DTMF</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Call Details */}
        <div className="call-details">
          {loading ? (
            <div className="loading">Loading call details...</div>
          ) : selectedCall ? (
            <>
              <div className="call-details-header">
                <h3>Call Details</h3>
                <button onClick={() => setSelectedCall(null)} className="btn-close">✕</button>
              </div>

              <div className="call-info">
                <div className="info-row">
                  <strong>Call SID:</strong> {selectedCall.callSid}
                </div>
                <div className="info-row">
                  <strong>Status:</strong>{' '}
                  <span style={{ color: getStatusColor(selectedCall.status) }}>
                    {selectedCall.status}
                  </span>
                </div>
                <div className="info-row">
                  <strong>Start Time:</strong> {formatTime(selectedCall.startTime)}
                </div>
                <div className="info-row">
                  <strong>End Time:</strong> {formatTime(selectedCall.endTime)}
                </div>
                <div className="info-row">
                  <strong>Duration:</strong> {formatDuration(selectedCall.duration)}
                </div>
                <div className="info-row">
                  <strong>To:</strong> {selectedCall.metadata?.to || 'N/A'}
                </div>
                <div className="info-row">
                  <strong>From:</strong> {selectedCall.metadata?.from || 'N/A'}
                </div>
                <div className="info-row">
                  <strong>Transfer Number:</strong> {selectedCall.metadata?.transferNumber || 'N/A'}
                </div>
                <div className="info-row">
                  <strong>Call Purpose:</strong> {selectedCall.metadata?.callPurpose || 'N/A'}
                </div>
              </div>

              {/* DTMF Presses */}
              {selectedCall.dtmfPresses && selectedCall.dtmfPresses.length > 0 && (
                <div className="section">
                  <h4>🔢 DTMF Presses ({selectedCall.dtmfPresses.length})</h4>
                  <div className="dtmf-list">
                    {selectedCall.dtmfPresses.map((dtmf, idx) => (
                      <div key={idx} className="dtmf-item">
                        <span className="dtmf-digit">Press {dtmf.digit}</span>
                        <span className="dtmf-time">{formatTime(dtmf.timestamp)}</span>
                        {dtmf.reason && (
                          <div className="dtmf-reason">{dtmf.reason}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Conversation */}
              {selectedCall.conversation && selectedCall.conversation.length > 0 && (
                <div className="section">
                  <h4>💬 Conversation ({selectedCall.conversation.length} messages)</h4>
                  <div className="conversation-list">
                    {selectedCall.conversation.map((msg, idx) => (
                      <div
                        key={idx}
                        className={`conversation-item ${msg.type === 'user' ? 'user-message' : msg.type === 'ai' ? 'ai-message' : 'system-message'}`}
                      >
                        <div className="message-header">
                          <span className="message-type">
                            {msg.type === 'user' ? '👤 User' : msg.type === 'ai' ? '🤖 AI' : '⚙️ System'}
                          </span>
                          <span className="message-time">{formatTime(msg.timestamp)}</span>
                        </div>
                        <div className="message-text">{msg.text}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* All Events Timeline */}
              {selectedCall.events && selectedCall.events.length > 0 && (
                <div className="section">
                  <h4>📋 Event Timeline ({selectedCall.events.length} events)</h4>
                  <div className="timeline">
                    {selectedCall.events.map((event, idx) => (
                      <div key={idx} className="timeline-item">
                        <div className="timeline-time">{formatTime(event.timestamp)}</div>
                        <div className="timeline-content">
                          {event.eventType === 'dtmf' && (
                            <div className="event-dtmf">
                              🔢 Pressed DTMF: <strong>{event.digit}</strong>
                              {event.reason && <span className="event-reason"> - {event.reason}</span>}
                            </div>
                          )}
                          {event.eventType === 'ivr_menu' && (
                            <div className="event-ivr">
                              📋 IVR Menu Detected
                              {event.menuOptions && (
                                <div className="menu-options">
                                  {event.menuOptions.map((opt, i) => (
                                    <span key={i} className="menu-option">Press {opt.digit} for {opt.option}</span>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                          {event.eventType === 'transfer' && (
                            <div className="event-transfer">
                              🔄 Transfer {event.success ? 'Successful' : 'Attempted'} to {event.transferNumber}
                            </div>
                          )}
                          {event.eventType === 'termination' && (
                            <div className="event-termination">
                              🛑 Call Terminated: {event.reason}
                            </div>
                          )}
                          {event.eventType === 'conversation' && (
                            <div className={`event-conversation ${event.type === 'user' ? 'user' : 'ai'}`}>
                              {event.type === 'user' ? '👤' : '🤖'} {event.text}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="empty-details">Select a call to view details</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default HistoryTab;

