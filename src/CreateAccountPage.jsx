import { useEffect, useState } from 'react';
import { account } from './services/appwrite';
import './AuthPages.css';

// URL endpoint HTTP function delete-account-web (bukan lewat SDK
// createExecution, lebih simpel pakai fetch biasa + kirim JWT).
const DELETE_ACCOUNT_FUNCTION_URL = import.meta.env.VITE_DELETE_ACCOUNT_FUNCTION_URL;

export default function AccountPage() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState(''); 

  useEffect(() => {
    (async () => {
      try {
        const currentUser = await account.get();
        setUser(currentUser);
      } catch {
        // Belum login -- lempar ke halaman login.
        window.location.href = '/login';
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleLogout = async () => {
    // 🔧 FIX: sebelumnya kalau deleteSession('current') gagal karena
    // alasan apapun (sesi udah dianggap invalid di server, race condition,
    // dll), promise REJECT tanpa ke-catch -- window.location.href
    // gak pernah kejalan, halaman diam aja kayak logout "gak ngefek".
    // Sekarang redirect TETAP jalan apapun hasilnya -- tujuan akhir user
    // (keluar dari akun) tetap tercapai walau deleteSession-nya sendiri
    // gagal (sesi lokal browser toh mau dianggap "keluar").
    try {
      await account.deleteSession('current');
    } catch (err) {
      console.error('[logout] deleteSession failed (redirecting anyway):', err);
    }
    window.location.href = '/';
  };

  const handleDeleteAccount = async () => {
    setIsDeleting(true);
    setError('');
    try {
      // 🔐 Kirim JWT (bukan userId mentah) -- function verifikasi JWT ini
      // ke server buat mastiin yang minta hapus akun itu BENERAN pemilik
      // akun itu sendiri, bukan orang lain nebak-nebak userId.
      const jwt = await account.createJWT();

      const res = await fetch(DELETE_ACCOUNT_FUNCTION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jwt: jwt.jwt }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to delete account.');
      }

      // Akun sudah dihapus di server -- bersihkan sesi lokal juga.
      try {
        await account.deleteSession('current');
      } catch {
        // Sesi kemungkinan udah otomatis invalid karena user-nya udah
        // dihapus -- aman diabaikan.
      }

      window.location.href = '/?accountDeleted=1';
    } catch (err) {
      console.error('[delete-account] error:', err);
      setError(err.message || 'Something went wrong. Please try again or contact support.');
      setIsDeleting(false);
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
