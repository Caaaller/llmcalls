import React, { useState, useEffect } from 'react';
import './App.css';
import HistoryTab from './HistoryTab';

function App() {
  const [settings, setSettings] = useState({
    transferNumber: '',
    toPhoneNumber: '',
    callPurpose: 'speak with a representative',
    customInstructions: '',
    voice: 'Polly.Matthew',
    userPhone: '',
    userEmail: ''
  });

  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [activeTab, setActiveTab] = useState('settings'); // 'settings' or 'history'

  const voiceOptions = [
    { value: 'Polly.Matthew', label: 'Polly.Matthew (Male, Natural)' },
    { value: 'Polly.Joanna', label: 'Polly.Joanna (Female, Natural)' },
    { value: 'Polly.Amy', label: 'Polly.Amy (Female, British)' },
    { value: 'Polly.Brian', label: 'Polly.Brian (Male, British)' },
    { value: 'alice', label: 'Alice (Basic Female)' },
    { value: 'man', label: 'Man (Basic Male)' },
    { value: 'woman', label: 'Woman (Basic Female)' }
  ];

  useEffect(() => {
    loadSettings();
    loadPrompt();
  }, []);

  const loadSettings = async () => {
    try {
      const response = await fetch('http://localhost:3000/api/config', {
        mode: 'cors'
      });
      if (response.ok) {
        const data = await response.json();
        if (data.config) {
          setSettings(prev => ({
            ...prev,
            transferNumber: data.config.transferNumber || '',
            userPhone: data.config.userPhone || '',
            userEmail: data.config.userEmail || '',
            voice: data.config.aiSettings?.voice || 'Polly.Matthew'
          }));
        }
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  };

  const loadPrompt = async () => {
    try {
      const response = await fetch('http://localhost:3000/api/prompt', {
        mode: 'cors'
      });
      if (response.ok) {
        const data = await response.json();
        setPrompt(data.prompt || '');
      }
    } catch (error) {
      console.error('Error loading prompt:', error);
    }
  };

  const handleSave = async () => {
    setLoading(true);
    setSaved(false);
    try {
      const response = await fetch('http://localhost:3000/api/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...settings,
          prompt
        }),
      });

      if (response.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      } else {
        alert('Failed to save settings');
      }
    } catch (error) {
      console.error('Error saving settings:', error);
      alert('Error saving settings');
    } finally {
      setLoading(false);
    }
  };

  const handleInitiateCall = async () => {
    if (!settings.toPhoneNumber) {
      alert('Please enter a phone number to call');
      return;
    }
    
    if (!settings.transferNumber) {
      alert('Please enter a transfer phone number');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('http://localhost:3000/api/calls/initiate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: settings.toPhoneNumber,
          transferNumber: settings.transferNumber,
          callPurpose: settings.callPurpose,
          customInstructions: settings.customInstructions
        }),
      });

      if (response.ok) {
        const data = await response.json();
        alert(`✅ Call initiated successfully!\n\nCall SID: ${data.call.sid}\nStatus: ${data.call.status}\nTo: ${data.call.to}`);
      } else {
        const error = await response.json();
        alert(`❌ Failed to initiate call:\n\n${error.error}\n\nMake sure:\n1. TWIML_URL is set in .env to your ngrok URL\n2. ngrok is running\n3. Server is running`);
      }
    } catch (error) {
      console.error('Error initiating call:', error);
      alert(`❌ Error initiating call:\n\n${error.message}\n\nMake sure:\n1. Backend server is running on port 3000\n2. TWIML_URL is set in .env to your ngrok URL`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="App">
      <div className="container">
        <header className="header">
          <h1>📞 Transfer Call Manager</h1>
          <p>Configure and manage your transfer-only phone navigation system</p>
        </header>

        {/* Tabs */}
        <div className="tabs">
          <button
            className={`tab ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            ⚙️ Settings
          </button>
          <button
            className={`tab ${activeTab === 'history' ? 'active' : ''}`}
            onClick={() => setActiveTab('history')}
          >
            📋 Call History
          </button>
        </div>

        {activeTab === 'history' ? (
          <HistoryTab />
        ) : (
          <>

        <div className="settings-grid">
          {/* Phone Numbers Section */}
          <div className="settings-card">
            <h2>Phone Numbers</h2>
            
            <div className="form-group">
              <label htmlFor="toPhoneNumber">
                To Phone Number <span className="required">*</span>
              </label>
              <input
                type="tel"
                id="toPhoneNumber"
                value={settings.toPhoneNumber}
                onChange={(e) => setSettings({ ...settings, toPhoneNumber: e.target.value })}
                placeholder="+1234567890"
                className="input"
              />
              <small>The phone number to call (e.g., eBay support)</small>
            </div>

            <div className="form-group">
              <label htmlFor="transferNumber">
                Transfer Phone Number <span className="required">*</span>
              </label>
              <input
                type="tel"
                id="transferNumber"
                value={settings.transferNumber}
                onChange={(e) => setSettings({ ...settings, transferNumber: e.target.value })}
                placeholder="720-584-6358"
                className="input"
              />
              <small>Number to transfer calls to when human is reached</small>
            </div>

            <div className="form-group">
              <label htmlFor="userPhone">Your Phone Number</label>
              <input
                type="tel"
                id="userPhone"
                value={settings.userPhone}
                onChange={(e) => setSettings({ ...settings, userPhone: e.target.value })}
                placeholder="720-584-6358"
                className="input"
              />
              <small>Your phone number (for callbacks)</small>
            </div>

            <div className="form-group">
              <label htmlFor="userEmail">Your Email</label>
              <input
                type="email"
                id="userEmail"
                value={settings.userEmail}
                onChange={(e) => setSettings({ ...settings, userEmail: e.target.value })}
                placeholder="oliverullman@gmail.com"
                className="input"
              />
              <small>Your email address</small>
            </div>
          </div>

          {/* Call Configuration Section */}
          <div className="settings-card">
            <h2>Call Configuration</h2>
            
            <div className="form-group">
              <label htmlFor="callPurpose">Call Purpose</label>
              <input
                type="text"
                id="callPurpose"
                value={settings.callPurpose}
                onChange={(e) => setSettings({ ...settings, callPurpose: e.target.value })}
                placeholder="speak with a representative"
                className="input"
              />
              <small>Purpose of the call (e.g., "check order status")</small>
            </div>

            <div className="form-group">
              <label htmlFor="customInstructions">Custom Instructions</label>
              <textarea
                id="customInstructions"
                value={settings.customInstructions}
                onChange={(e) => setSettings({ ...settings, customInstructions: e.target.value })}
                placeholder="Additional instructions for the AI..."
                className="textarea"
                rows="3"
              />
              <small>Optional: Additional context for the AI</small>
            </div>

            <div className="form-group">
              <label htmlFor="voice">Voice Option</label>
              <select
                id="voice"
                value={settings.voice}
                onChange={(e) => setSettings({ ...settings, voice: e.target.value })}
                className="select"
              >
                {voiceOptions.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <small>Select the voice for AI responses</small>
            </div>
          </div>
        </div>

        {/* Prompt Section */}
        <div className="settings-card full-width">
          <h2>Transfer Call Prompt</h2>
          <div className="form-group">
            <label htmlFor="prompt">Default Prompt Template</label>
            <textarea
              id="prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="textarea prompt-textarea"
              rows="20"
              placeholder="Loading prompt..."
            />
            <small>This is the main prompt used for transfer-only calls. Edit as needed.</small>
          </div>
        </div>

        {/* Actions */}
        <div className="actions">
          <button
            onClick={handleSave}
            disabled={loading}
            className="btn btn-primary"
          >
            {loading ? 'Saving...' : '💾 Save Settings'}
          </button>
          
          <button
            onClick={handleInitiateCall}
            disabled={loading || !settings.toPhoneNumber}
            className="btn btn-success"
          >
            {loading ? 'Initiating...' : '📞 Initiate Call'}
          </button>
        </div>

        {saved && (
          <div className="success-message">
            ✅ Settings saved successfully!
          </div>
        )}
          </>
        )}
      </div>
    </div>
  );
}

export default App;
