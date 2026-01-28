import React, { useState, ChangeEvent, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import './App.css';
import HistoryTab from './HistoryTab';
import Login from './components/Login';
import { api, type ApiConfigResponse } from './api/client';
import { isAuthenticated, getStoredUser, clearAuth, setAuth, type User } from './utils/auth';

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

function App() {
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
  const queryClient = useQueryClient();

  // Initialize auth state from localStorage
  const hasStoredAuth = isAuthenticated();
  const [isAuthenticatedState, setIsAuthenticatedState] = useState<boolean>(hasStoredAuth);
  const [user, setUser] = useState<User | null>(hasStoredAuth ? getStoredUser() : null);

  // Verify token validity with react-query
  const {
    data: meData,
    isLoading: isAuthChecking,
    error: authError,
  } = useQuery<{ user: User }>({
    queryKey: ['auth', 'me'],
    queryFn: () => api.auth.me(),
    enabled: hasStoredAuth,
    retry: false,
  });

  // React to auth query results
  useEffect(() => {
    if (meData?.user) {
      setUser(meData.user);
      setIsAuthenticatedState(true);
      setLoading(false);
    } else if (!hasStoredAuth && !isAuthChecking) {
      setLoading(false);
    }
  }, [meData, hasStoredAuth, isAuthChecking]);

  useEffect(() => {
    if (authError) {
      clearAuth();
      setUser(null);
      setIsAuthenticatedState(false);
      setLoading(false);
    }
  }, [authError]);

  // Load settings
  const { data: configData } = useQuery<ApiConfigResponse>({
    queryKey: ['config'],
    queryFn: () => api.config.get(),
    enabled: isAuthenticatedState,
  });

  useEffect(() => {
    if (configData?.config) {
      const cfg = configData.config;
      setSettings(prev => ({
        ...prev,
        transferNumber: cfg.transferNumber || '',
        userPhone: cfg.userPhone || '',
        userEmail: cfg.userEmail || '',
        voice: cfg.aiSettings?.voice || 'Polly.Matthew',
      }));
    }
  }, [configData]);

  // Load prompt
  const { data: promptData } = useQuery<{ success: boolean; prompt: string }>({
    queryKey: ['prompt'],
    queryFn: () => api.prompt.get(),
    enabled: isAuthenticatedState,
  });

  useEffect(() => {
    if (promptData?.prompt) {
      setPrompt(promptData.prompt);
    }
  }, [promptData]);

  // Logout mutation
  const logoutMutation = useMutation({
    mutationFn: () => api.auth.logout(),
    onSuccess: () => {
      clearAuth();
      setUser(null);
      setIsAuthenticatedState(false);
      queryClient.clear();
    },
    onError: () => {
      // Clear even if logout fails
      clearAuth();
      setUser(null);
      setIsAuthenticatedState(false);
      queryClient.clear();
    },
  });

  // Save settings mutation
  const saveMutation = useMutation({
    mutationFn: (data: { settings: Settings; prompt: string }) =>
      api.config.update({
        transferNumber: data.settings.transferNumber,
        userPhone: data.settings.userPhone,
        userEmail: data.settings.userEmail,
        aiSettings: {
          model: 'gpt-4o',
          maxTokens: 150,
          temperature: 0.7,
          voice: data.settings.voice,
          language: 'en-US',
        },
        toPhoneNumber: data.settings.toPhoneNumber,
        callPurpose: data.settings.callPurpose,
        customInstructions: data.settings.customInstructions,
        prompt: data.prompt,
      }),
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      queryClient.invalidateQueries({ queryKey: ['config'] });
      queryClient.invalidateQueries({ queryKey: ['prompt'] });
    },
    onError: () => {
      alert('Failed to save settings');
    },
  });

  // Initiate call mutation
  const initiateCallMutation = useMutation<{ call: { sid: string; status: string; to: string } }, Error, {
    to: string;
    transferNumber: string;
    callPurpose: string;
    customInstructions: string;
  }>({
    mutationFn: (data: {
      to: string;
      transferNumber: string;
      callPurpose: string;
      customInstructions: string;
    }) => api.calls.initiate(data),
    onSuccess: (data: { call: { sid: string; status: string; to: string } }) => {
      alert(`✅ Call initiated successfully!\n\nCall SID: ${data.call.sid}\nStatus: ${data.call.status}\nTo: ${data.call.to}`);
      queryClient.invalidateQueries({ queryKey: ['calls', 'history'] });
    },
    onError: (error: Error) => {
      alert(`❌ Failed to initiate call:\n\n${error.message}\n\nMake sure:\n1. TWIML_URL is set in .env to your ngrok URL\n2. ngrok is running\n3. Server is running`);
    },
  });

  const handleLogin = (userData: User, token: string): void => {
    setAuth(userData, token);
    setUser(userData);
    setIsAuthenticatedState(true);
    queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
  };

  const handleLogout = (): void => {
    logoutMutation.mutate();
  };

  const handleSave = (): void => {
    if (!settings.toPhoneNumber) {
      alert('Please enter a phone number to call');
      return;
    }
    
    if (!settings.transferNumber) {
      alert('Please enter a transfer phone number');
      return;
    }

    saveMutation.mutate({ settings, prompt });
  };

  const handleInitiateCall = (): void => {
    if (!settings.toPhoneNumber) {
      alert('Please enter a phone number to call');
      return;
    }
    
    if (!settings.transferNumber) {
      alert('Please enter a transfer phone number');
      return;
    }

    initiateCallMutation.mutate({
      to: settings.toPhoneNumber,
      transferNumber: settings.transferNumber,
      callPurpose: settings.callPurpose,
      customInstructions: settings.customInstructions
    });
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

  const isLoading = loading || isAuthChecking || saveMutation.isPending || initiateCallMutation.isPending;

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
  if (!isAuthenticatedState) {
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
              <button onClick={handleLogout} className="logout-btn" disabled={logoutMutation.isPending}>
                {logoutMutation.isPending ? 'Logging out...' : 'Logout'}
              </button>
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
                disabled={isLoading}
                className="btn btn-primary"
              >
                {saveMutation.isPending ? 'Saving...' : '💾 Save Settings'}
              </button>
              
              <button
                onClick={handleInitiateCall}
                disabled={isLoading || !settings.toPhoneNumber}
                className="btn btn-success"
              >
                {initiateCallMutation.isPending ? 'Initiating...' : '📞 Initiate Call'}
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
