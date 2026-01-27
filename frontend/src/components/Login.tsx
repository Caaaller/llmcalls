import React, { useState, FormEvent, ChangeEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import './Login.css';
import { api } from '../api/client';
import { setAuth, type User } from '../utils/auth';

interface User {
  id: string;
  email: string;
  name: string;
}

interface LoginProps {
  onLogin: (user: User, token: string) => void;
}

interface FormData {
  email: string;
  password: string;
  name: string;
}

function Login({ onLogin }: LoginProps) {
  const [isSignup, setIsSignup] = useState<boolean>(false);
  const [formData, setFormData] = useState<FormData>({
    email: '',
    password: '',
    name: ''
  });
  const [error, setError] = useState<string>('');

  const loginMutation = useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      api.auth.login(email, password),
    onSuccess: (data) => {
      if (data.success) {
        setAuth(data.user, data.token);
        onLogin(data.user, data.token);
      }
    },
    onError: (err: Error) => {
      setError(err.message || 'An error occurred');
    },
  });

  const signupMutation = useMutation({
    mutationFn: ({ email, password, name }: { email: string; password: string; name: string }) =>
      api.auth.signup(email, password, name),
    onSuccess: (data) => {
      if (data.success) {
        setAuth(data.user, data.token);
        onLogin(data.user, data.token);
      }
    },
    onError: (err: Error) => {
      setError(err.message || 'An error occurred');
    },
  });

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
    setError('');
  };

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');

    if (isSignup) {
      signupMutation.mutate({
        email: formData.email,
        password: formData.password,
        name: formData.name
      });
    } else {
      loginMutation.mutate({
        email: formData.email,
        password: formData.password
      });
    }
  };

  const isLoading = loginMutation.isPending || signupMutation.isPending;

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-header">
          <h1>📞 Transfer Call Manager</h1>
          <p>{isSignup ? 'Create your account' : 'Welcome back!'}</p>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          {isSignup && (
            <div className="form-group">
              <label htmlFor="name">Full Name</label>
              <input
                type="text"
                id="name"
                name="name"
                value={formData.name}
                onChange={handleChange}
                required
                placeholder="John Doe"
              />
            </div>
          )}

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
              placeholder={isSignup ? "At least 6 characters" : "Your password"}
              minLength={isSignup ? 6 : undefined}
            />
          </div>

          {error && <div className="error-message">{error}</div>}

          <button type="submit" className="btn-primary" disabled={isLoading}>
            {isLoading ? 'Please wait...' : (isSignup ? 'Sign Up' : 'Login')}
          </button>
        </form>

        <div className="login-footer">
          <p>
            {isSignup ? 'Already have an account? ' : "Don't have an account? "}
            <button
              type="button"
              className="link-button"
              onClick={() => {
                setIsSignup(!isSignup);
                setError('');
                setFormData({ email: '', password: '', name: '' });
              }}
            >
              {isSignup ? 'Login' : 'Sign Up'}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}

export default Login;
