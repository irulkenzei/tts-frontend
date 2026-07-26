import { useEffect, useState } from 'react';
import { ID } from 'appwrite';
import { account, databases, DATABASE_ID, REGISTERED_USERS_COLLECTION_ID } from '../services/appwrite';
import '../styles/AuthPages.css';

export default function AuthCallbackPage() {
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const user = await account.get();

        // Pastikan dokumen registered_users ada -- kalau ini login OAuth
        // PERTAMA kali buat akun ini, dokumennya belum ada, bikin sekarang.
        try {
          await databases.getDocument(DATABASE_ID, REGISTERED_USERS_COLLECTION_ID, user.$id);
        } catch {
          await databases.createDocument(DATABASE_ID, REGISTERED_USERS_COLLECTION_ID, user.$id, {
            name: user.name || '',
            email: user.email || '',
            avatar_url: null,
          });
        }

        window.location.href = '/account';
      } catch (err) {
        console.error('[auth-callback] error:', err);
        setError('Something went wrong finishing sign-in. Please try again.');
      }
    })();
  }, []);

  return (
    <div className="auth-container">
      <div className="auth-card" style={{ textAlign: 'center' }}>
        {error ? (
          <>
            <p className="auth-error">{error}</p>
            <a href="/login" className="auth-submit-btn" style={{ display: 'inline-block', textDecoration: 'none' }}>
              Back to Login
            </a>
          </>
        ) : (
          <p className="auth-subtitle">Finishing sign-in...</p>
        )}
      </div>
    </div>
  );
}
