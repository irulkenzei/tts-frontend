import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom'; // Tambahkan ini
import { account } from '../services/appwrite';
import '../styles/AuthPages.css';

const DELETE_ACCOUNT_FUNCTION_URL = import.meta.env.VITE_DELETE_ACCOUNT_FUNCTION_URL;

export default function AccountPage() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState('');
  
  // Inisialisasi navigasi
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        const currentUser = await account.get();
        setUser(currentUser);
      } catch {
        navigate('/login');
      } finally {
        setLoading(false);
      }
    })();
  }, [navigate]);

  // PERBAIKAN FUNGSI LOGOUT DI SINI
  const handleLogout = async () => {
    try {
      // 1. Coba hapus sesi di server Appwrite
      await account.deleteSession('current');
    } catch (error) {
      console.error('[logout] error:', error);
      // Meskipun error, kita tetap paksa user keluar secara lokal
    } finally {
      // 2. Kosongkan state
      setUser(null);
      // 3. Pindah ke halaman login (bukan beranda '/')
      navigate('/login');
    }
  };

  if (loading) {
    return (
      <div className="auth-container">
        <div className="auth-card"><p className="auth-subtitle">Loading...</p></div>
      </div>
    );
  }

  return (
    <div className="auth-container">
      <div className="auth-card">
        <h1 className="auth-title">My Account</h1>
        <p className="auth-subtitle">{user?.name || 'Narator AI user'}</p>
        <p className="auth-subtitle" style={{ opacity: 0.7 }}>{user?.email}</p>

        <button className="auth-submit-btn" style={{ marginTop: '24px' }} onClick={handleLogout}>
          Log Out
        </button>

        <div className="danger-zone">
          <h2 className="danger-zone-title">Danger Zone</h2>
          {!showConfirm ? (
            <button className="danger-btn" onClick={() => setShowConfirm(true)}>
              Delete Account
            </button>
          ) : (
            <div>
              <p className="auth-error" style={{ marginBottom: '12px' }}>
                This will permanently delete your account and all associated data (generated audio, translations,
                cloned voices, subscription history). This cannot be undone.
              </p>
              {error && <p className="auth-error">{error}</p>}
              <div style={{ display: 'flex', gap: '12px' }}>
                <button className="danger-btn" onClick={handleDeleteAccount} disabled={isDeleting}>
                  {isDeleting ? 'Deleting...' : 'Yes, delete my account'}
                </button>
                <button className="auth-submit-btn" onClick={() => setShowConfirm(false)} disabled={isDeleting}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
