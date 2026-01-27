import React, { useState, useEffect, ChangeEvent, FormEvent } from 'react';
import './App.css';
import HistoryTab from './HistoryTab';
import Login from './components/Login';

interface User {
  id: string;
  email: string;
  name: string;
}

interface Settings {
  transferNumber: string;
  toPhoneNumber: string;
  callPurpose: string;
  customInstructions: string;
  voice: string;
  userPhone: string;
  userEmail: string;
}

interface VoiceOption {
  value: string;
  label: string;
}

interface CallResponse {
  call: {
    sid: string;
    status: string;
    to: string;
  };
}

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  
  const [settings, setSettings] = useState<Settings>({
    transferNumber: '',
    toPhoneNumber: '',
    callPurpose: 'speak with a representative',
    customInstructions: '',
    voice: 'Polly.Matthew',
    userPhone: '',
    userEmail: ''
  });

  const [prompt, setPrompt] = useState<string>('');
  const [saved, setSaved] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'settings' | 'history'>('settings');

  // Check if user is already logged in
  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async (): Promise<void> => {
    const token = localStorage.getItem('token');
    const storedUser = localStorage.getItem('user');
    
    if (token && storedUser) {
      try {
        // Verify token is still valid
        const response = await fetch('http://localhost:3000/api/auth/me', {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
          mode: 'cors'
        });
        
        if (response.ok) {
          const data = await response.json();
          setUser(data.user);
          setIsAuthenticated(true);
        } else {
          // Token invalid, clear storage
          localStorage.removeItem('token');
          localStorage.removeItem('user');
        }
      } catch (error) {
        console.error('Auth check error:', error);
        localStorage.removeItem('token');
        localStorage.removeItem('user');
      }
    }
    setLoading(false);
  };

  const handleLogin = (userData: User, token: string): void => {
    setUser(userData);
    setIsAuthenticated(true);
  };

  const handleLogout = async (): Promise<void> => {
    try {
      const token = localStorage.getItem('token');
      if (token) {
        await fetch('http://localhost:3000/api/auth/logout', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
          },
          mode: 'cors'
        });
      }
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      setUser(null);
      setIsAuthenticated(false);
    }
  };

  const voiceOptions: VoiceOption[] = [
    { value: 'Polly.Matthew', label: 'Polly.Matthew (Male, Natural)' },
    { value: 'Polly.Joanna', label: 'Polly.Joanna (Female, Natural)' },
    { value: 'Polly.Amy', label: 'Polly.Amy (Female, British)' },
    { value: 'Polly.Brian', label: 'Polly.Brian (Male, British)' },
    { value: 'alice', label: 'Alice (Basic Female)' },
    { value: 'man', label: 'Man (Basic Male)' },
    { value: 'woman', label: 'Woman (Basic Female)' }
  ];

  useEffect(() => {
    if (isAuthenticated) {
      loadSettings();
      loadPrompt();
    }
  }, [isAuthenticated]);

  const loadSettings = async (): Promise<void> => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('http://localhost:3000/api/config', {
        headers: token ? {
          'Authorization': `Bearer ${token}`
        } : {},
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

  const loadPrompt = async (): Promise<void> => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('http://localhost:3000/api/prompt', {
        headers: token ? {
          'Authorization': `Bearer ${token}`
        } : {},
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

  const handleSave = async (): Promise<void> => {
    setLoading(true);
    setSaved(false);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('http://localhost:3000/api/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
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

  const handleInitiateCall = async (): Promise<void> => {
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
      const token = localStorage.getItem('token');
      const response = await fetch('http://localhost:3000/api/calls/initiate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          to: settings.toPhoneNumber,
          transferNumber: settings.transferNumber,
          callPurpose: settings.callPurpose,
          customInstructions: settings.customInstructions
        }),
      });

      if (response.ok) {
        const data: CallResponse = await response.json();
        alert(`✅ Call initiated successfully!\n\nCall SID: ${data.call.sid}\nStatus: ${data.call.status}\nTo: ${data.call.to}`);
      } else {
        const error = await response.json();
        alert(`❌ Failed to initiate call:\n\n${error.error}\n\nMake sure:\n1. TWIML_URL is set in .env to your ngrok URL\n2. ngrok is running\n3. Server is running`);
      }
    } catch (error) {
      const err = error as Error;
      console.error('Error initiating call:', error);
      alert(`❌ Error initiating call:\n\n${err.message}\n\nMake sure:\n1. Backend server is running on port 3000\n2. TWIML_URL is set in .env to your ngrok URL`);
    } finally {
      setLoading(false);
    }
  };

  // Show loading spinner while checking auth
  if (loading) {
    return (
      <div className="App">
        <div className="loading-container">
          <div className="spinner"></div>
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  // Show login if not authenticated
  if (!isAuthenticated) {
    return <Login onLogin={handleLogin} />;
  }

  return (
    <div className="App">
      <div className="container">
        <header className="header">
          <div className="header-content">
            <div>
              <h1>📞 Transfer Call Manager</h1>
              <p>Configure and manage your transfer-only phone navigation system</p>
            </div>
            <div className="user-info">
              <span className="user-name">👤 {user?.name || user?.email}</span>
              <button onClick={handleLogout} className="logout-btn">Logout</button>
            </div>
          </div>
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
                onChange={(e: ChangeEvent<HTMLInputElement>) => setSettings({ ...settings, toPhoneNumber: e.target.value })}
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
                onChange={(e: ChangeEvent<HTMLInputElement>) => setSettings({ ...settings, transferNumber: e.target.value })}
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
                onChange={(e: ChangeEvent<HTMLInputElement>) => setSettings({ ...settings, userPhone: e.target.value })}
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
                onChange={(e: ChangeEvent<HTMLInputElement>) => setSettings({ ...settings, userEmail: e.target.value })}
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
                onChange={(e: ChangeEvent<HTMLInputElement>) => setSettings({ ...settings, callPurpose: e.target.value })}
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
                onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setSettings({ ...settings, customInstructions: e.target.value })}
                placeholder="Additional instructions for the AI..."
                className="textarea"
                rows={3}
              />
              <small>Optional: Additional context for the AI</small>
            </div>

            <div className="form-group">
              <label htmlFor="voice">Voice Option</label>
              <select
                id="voice"
                value={settings.voice}
                onChange={(e: ChangeEvent<HTMLSelectElement>) => setSettings({ ...settings, voice: e.target.value })}
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
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setPrompt(e.target.value)}
              className="textarea prompt-textarea"
              rows={20}
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

