import React, { useState, FormEvent, ChangeEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import './Login.css';
import { api } from '../api/client';
import { setAuth, type User } from '../utils/auth';

interface SignupProps {
  onSignup: (user: User, token: string) => void;
  onSwitchToLogin: () => void;
}

interface FormData {
  email: string;
  password: string;
  name: string;
}

function Signup({ onSignup, onSwitchToLogin }: SignupProps) {
  const [formData, setFormData] = useState<FormData>({
    email: '',
    password: '',
    name: ''
  });
  const [error, setError] = useState<string>('');

  const signupMutation = useMutation({
    mutationFn: ({ email, password, name }: { email: string; password: string; name: string }) =>
      api.auth.signup(email, password, name),
    onSuccess: (data) => {
      if (data.success) {
        setAuth(data.user, data.token);
        onSignup(data.user, data.token);
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

    signupMutation.mutate({
      email: formData.email,
      password: formData.password,
      name: formData.name
    });
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-header">
          <h1>📞 Transfer Call Manager</h1>
          <p>Create your account</p>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
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
              placeholder="At least 6 characters"
              minLength={6}
            />
          </div>

          {error && <div className="error-message">{error}</div>}

          <button type="submit" className="btn-primary" disabled={signupMutation.isPending}>
            {signupMutation.isPending ? 'Please wait...' : 'Sign Up'}
          </button>
        </form>

        <div className="login-footer">
          <p>
            Already have an account?{' '}
            <button
              type="button"
              className="link-button"
              onClick={() => {
                onSwitchToLogin();
                setError('');
                setFormData({ email: '', password: '', name: '' });
              }}
            >
              Login
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}

export default Signup;


