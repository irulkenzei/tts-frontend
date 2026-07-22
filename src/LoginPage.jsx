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
      // 🔧 FIX: Appwrite menolak bikin sesi baru kalau udah ada sesi aktif
      // ("Creation of a session is prohibited when a session is active")
      // -- SAMA PERSIS isu yang sudah didokumentasikan panjang lebar di
      // mobile app (services/appwrite.ts). Browser bisa aja masih nyimpen
      // sesi lama (mis. abis login sebagai akun lain), jadi logout dulu
      // di sini -- aman di-panggil walau sebenernya lagi gak ada sesi
      // aktif (tinggal di-catch, diabaikan).
      try {
        await account.deleteSession('current');
      } catch {
        // gak ada sesi aktif -- aman, lanjut aja
      }

      // 🔧 FIX: SDK 'appwrite' versi 13.0.2 (lihat package.json) BELUM
      // punya method createEmailPasswordSession -- itu baru ada mulai
      // versi 14.0.1. Untuk versi ini, nama method-nya createEmailSession
      // (parameter tetap positional, sama seperti sebelumnya).
      await account.createEmailSession(email.trim(), password);
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