import { useState } from 'react';
import { account } from '../services/appwriteConfig';
import '../styles/AdminListings.css'; // reuse style form yang udah ada (input, button, dst)

export default function ResetPassword() {
  const params = new URLSearchParams(window.location.search);
  const userId = params.get('userId');
  const secret = params.get('secret');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!userId || !secret) {
      setError('This link is invalid or has expired. Please request a new password reset from the app.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      // 🐛 FIX: SDK appwrite v13 (versi yang dipakai project ini) butuh 4
      // parameter posisional -- (userId, secret, password, passwordAgain)
      // -- BUKAN 3. "passwordAgain" itu confirmPassword yang udah kita
      // kumpulin di form, tinggal diteruskan sebagai argument ke-4.
      await account.updateRecovery(userId, secret, password, confirmPassword);
      setSuccess(true);
    } catch (err) {
      setError(err?.message || 'Failed to reset password. The link may have expired -- please request a new one.');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="admin-shell">
        <div className="admin-login-card">
          <h1>Password Updated</h1>
          <p className="admin-subtitle">
            Your password has been changed successfully. You can now go back to the Narator AI app and sign in with your new password.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-shell">
      <form className="admin-login-card" onSubmit={handleSubmit}>
        <h1>Reset Password</h1>
        <p className="admin-subtitle">Enter a new password for your account.</p>

        {!!error && <div className="admin-error">{error}</div>}

        <label>New Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Min. 8 characters"
          disabled={loading}
        />

        <label>Confirm Password</label>
        <input
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          disabled={loading}
        />

        <button type="submit" disabled={loading}>
          {loading ? 'Updating…' : 'Update Password'}
        </button>
      </form>
    </div>
  );
}
