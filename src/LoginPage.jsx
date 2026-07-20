import { useState } from 'react';
import { account } from './services/appwrite';
import './AuthPages.css';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState('');

  const handleOAuth = (provider) => {
    const successUrl = `${window.location.origin}/auth-callback`;
    const failureUrl = `${window.location.origin}/login?error=oauth_failed`;
    account.createOAuth2Session(provider, successUrl, failureUrl);
  };

  const handleEmailLogin = async (e) => {
    e.preventDefault();
    setError('');

    if (!email.trim() || !password) {
      setError('Please fill in all fields.');
      return;
    }

    setIsProcessing(true);
    try {
      await account.createEmailPasswordSession(email.trim(), password);
      window.location.href = '/account';
    } catch (err) {
      console.error('[login] error:', err);
      setError('Invalid email or password.');
      setIsProcessing(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <h1 className="auth-title">Log In</h1>
        <p className="auth-subtitle">Welcome back to Narator AI.</p>

        <div className="oauth-buttons">
          <button className="oauth-btn oauth-google" onClick={() => handleOAuth('google')}>
            Continue with Google
          </button>
          <button className="oauth-btn oauth-apple" onClick={() => handleOAuth('apple')}>
            Continue with Apple
          </button>
          <button className="oauth-btn oauth-facebook" onClick={() => handleOAuth('facebook')}>
            Continue with Facebook
          </button>
        </div>

        <div className="auth-divider"><span>or</span></div>

        <form onSubmit={handleEmailLogin} className="auth-form">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="auth-input"
            disabled={isProcessing}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="auth-input"
            disabled={isProcessing}
          />

          {error && <p className="auth-error">{error}</p>}

          <button type="submit" className="auth-submit-btn" disabled={isProcessing}>
            {isProcessing ? 'Logging in...' : 'Log In'}
          </button>
        </form>

        <p className="auth-switch">
          Don't have an account? <a href="/signup">Sign up</a>
        </p>
      </div>
    </div>
  );
}
