import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import './App.css';
import Login from './components/Login';
import Signup from './components/Signup';
import AppLayout from './components/AppLayout';
import LabelingPage from './LabelingPage';
import { api, type ApiConfigResponse } from './api/client';
import {
  isAuthenticated,
  getStoredUser,
  clearAuth,
  setAuth,
  type User,
} from './utils/auth';

function App() {
  // Labeling UI lives on its own route and is dev-only / unauthenticated.
  // Short-circuit before any auth logic so it loads without a session.
  if (
    typeof window !== 'undefined' &&
    window.location.pathname === '/labeling'
  ) {
    return <LabelingPage />;
  }

  const [loading, setLoading] = useState<boolean>(true);
  const [showSignup, setShowSignup] = useState<boolean>(false);
  const queryClient = useQueryClient();

  const hasStoredAuth = isAuthenticated();
  const [isAuthenticatedState, setIsAuthenticatedState] =
    useState<boolean>(hasStoredAuth);
  const [user, setUser] = useState<User | null>(
    hasStoredAuth ? getStoredUser() : null
  );

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

  // Load config to get default transfer number
  const { data: configData } = useQuery<ApiConfigResponse>({
    queryKey: ['config'],
    queryFn: () => api.config.get(),
    enabled: isAuthenticatedState,
  });

  const defaultTransferNumber = configData?.config?.transferNumber || '';

  const logoutMutation = useMutation({
    mutationFn: () => api.auth.logout(),
    onSuccess: () => {
      clearAuth();
      setUser(null);
      setIsAuthenticatedState(false);
      queryClient.clear();
    },
    onError: () => {
      clearAuth();
      setUser(null);
      setIsAuthenticatedState(false);
      queryClient.clear();
    },
  });

  function handleLogin(userData: User, token: string) {
    setAuth(userData, token);
    setUser(userData);
    setIsAuthenticatedState(true);
    setShowSignup(false);
    queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
  }

  function handleSignup(userData: User, token: string) {
    setAuth(userData, token);
    setUser(userData);
    setIsAuthenticatedState(true);
    setShowSignup(false);
    queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
  }

  if (loading) {
    return (
      <div className="App">
        <div className="loading-container">
          <div className="spinner" />
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticatedState) {
    if (showSignup) {
      return (
        <Signup
          onSignup={handleSignup}
          onSwitchToLogin={() => setShowSignup(false)}
        />
      );
    }
    return (
      <Login
        onLogin={handleLogin}
        onSwitchToSignup={() => setShowSignup(true)}
      />
    );
  }

  return (
    <AppLayout
      user={user!}
      defaultTransferNumber={defaultTransferNumber}
      onLogout={() => logoutMutation.mutate()}
    />
  );
}

export default App;
