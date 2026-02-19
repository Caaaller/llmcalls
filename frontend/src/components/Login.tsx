import React, { useState, FormEvent, ChangeEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import './Login.css';
import { api } from '../api/client';
import { setAuth, type User } from '../utils/auth';

interface LoginProps {
  onLogin: (user: User, token: string) => void;
  onSwitchToSignup: () => void;
}

interface FormData {
  email: string;
  password: string;
}

function Login({ onLogin, onSwitchToSignup }: LoginProps) {
  const [formData, setFormData] = useState<FormData>({
    email: '',
    password: '',
  });
  const [error, setError] = useState<string>('');

  const loginMutation = useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      api.auth.login(email, password),
    onSuccess: data => {
      if (data.success) {
        setAuth(data.user, data.token);
        onLogin(data.user, data.token);
      } else {
        // Handle case where API returns success: false
        setError(data.error || 'Login failed. Please try again.');
      }
    },
    onError: (err: Error) => {
      setError(err.message || 'An error occurred');
    },
  });

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
    setError('');
  };

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');

    // Validate form data
    if (!formData.email || !formData.password) {
      setError('Please enter both email and password');
      return;
    }

    loginMutation.mutate({
      email: formData.email.trim(),
      password: formData.password,
    });
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-header">
          <h1>📞 Transfer Call Manager</h1>
          <p>Welcome back!</p>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
              type="email"
              id="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              required
              placeholder="you@example.com"
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              type="password"
              id="password"
              name="password"
              value={formData.password}
              onChange={handleChange}
              required
              placeholder="Your password"
            />
          </div>

          {error && <div className="error-message">{error}</div>}

          <button
            type="submit"
            className="btn-primary"
            disabled={loginMutation.isPending}
          >
            {loginMutation.isPending ? 'Please wait...' : 'Login'}
          </button>
        </form>

        <div className="login-footer">
          <p>
            Don&apos;t have an account?{' '}
            <button
              type="button"
              className="link-button"
              onClick={() => {
                onSwitchToSignup();
                setError('');
                setFormData({ email: '', password: '' });
              }}
            >
              Sign Up
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}

export default Login;
