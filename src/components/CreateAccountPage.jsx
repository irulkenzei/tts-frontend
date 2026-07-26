import { useState } from 'react';
import { ID } from 'appwrite';
import { account, databases, DATABASE_ID, REGISTERED_USERS_COLLECTION_ID } from '../services/appwrite';
import '../styles/AuthPages.css';

export default function CreateAccountPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState('');

  // 🔑 OAuth -- redirect penuh ke provider, Appwrite yang urus callback-nya.
  // successUrl mengarah ke /auth-callback, yang tugasnya cuma pastikan
  // dokumen registered_users ada, lalu redirect ke /account.
  const handleOAuth = (provider) => {
    const successUrl = `${window.location.origin}/auth-callback`;
    const failureUrl = `${window.location.origin}/signup?error=oauth_failed`;
    account.createOAuth2Session(provider, successUrl, failureUrl);
  };

  const handleEmailSignup = async (e) => {
    e.preventDefault();
    setError('');

    if (!name.trim() || !email.trim() || !password) {
      setError('Please fill in all fields.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    setIsProcessing(true);
    try {
      const userId = ID.unique();
      await account.create(userId, email.trim(), password, name.trim());

      // 🔧 FIX: sama persis pola LoginPage.jsx -- logout dulu sesi lama
      // (kalau ada) sebelum bikin sesi baru, biar tidak kena error
      // "Creation of a session is prohibited when a session is active".
      try {
        await account.deleteSession('current');
      } catch {
        // gak ada sesi aktif -- aman, lanjut aja
      }

      // 🔧 FIX: sama persis kasus LoginPage.jsx -- SDK 'appwrite' versi
      // 13.0.2 belum punya createEmailPasswordSession (baru ada mulai
      // 14.0.1), nama method yang benar di versi ini createEmailSession.
      await account.createEmailSession(email.trim(), password);

      // 🔑 Sama persis pola mobile (ProfileScreen.tsx) -- dokumen di
      // registered_users ini yang menandakan "user beneran login", bukan
      // anonymous. Kalau nanti user yang sama login di app mobile, mereka
      // otomatis dikenali sebagai user terdaftar juga.
      await databases.createDocument(DATABASE_ID, REGISTERED_USERS_COLLECTION_ID, userId, {
        name: name.trim(),
        email: email.trim(),
        avatar_url: null,
      });

      window.location.href = '/account';
    } catch (err) {
      console.error('[signup] error:', err);
      setError(err.message || 'Failed to create account. Please try again.');
      setIsProcessing(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <h1 className="auth-title">Create Account</h1>
        <p className="auth-subtitle">Sync your Narator AI data across devices.</p>

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

        <form onSubmit={handleEmailSignup} className="auth-form">
          <input
            type="text"
            placeholder="Full name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="auth-input"
            disabled={isProcessing}
          />
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
            placeholder="Password (min. 8 characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="auth-input"
            disabled={isProcessing}
          />

          {error && <p className="auth-error">{error}</p>}

          <button type="submit" className="auth-submit-btn" disabled={isProcessing}>
            {isProcessing ? 'Creating account...' : 'Create Account'}
          </button>
        </form>

        <p className="auth-switch">
          Already have an account? <a href="/login">Log in</a>
        </p>
      </div>
    </div>
  );
}