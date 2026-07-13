import { useState, useEffect } from 'react';
import { account, databases, storage, ID, Query, DATABASE_ID, VOICE_LISTINGS_COLLECTION_ID, RECORDING_UPLOAD_BUCKET_ID } from './appwriteConfig';
import './AdminListings.css';

export default function AdminListings() {
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  const [title, setTitle] = useState('');
  const [quoteText, setQuoteText] = useState('');
  const [audioFile, setAudioFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');

  const [listings, setListings] = useState([]);
  const [listingsLoading, setListingsLoading] = useState(true);

  // 🔎 Cek status login begitu halaman dibuka -- kalau sesi masih aktif
  // (browser session cookie), langsung masuk ke form tanpa perlu login ulang.
  useEffect(() => {
    (async () => {
      try {
        await account.get();
        setIsLoggedIn(true);
      } catch {
        setIsLoggedIn(false);
      } finally {
        setCheckingAuth(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (isLoggedIn) fetchListings();
  }, [isLoggedIn]);

  const fetchListings = async () => {
    setListingsLoading(true);
    try {
      const res = await databases.listDocuments(DATABASE_ID, VOICE_LISTINGS_COLLECTION_ID, [
        Query.orderDesc('$createdAt'),
        Query.limit(50),
      ]);
      setListings(res.documents);
    } catch (e) {
      console.error('Failed to fetch listings:', e);
    } finally {
      setListingsLoading(false);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    setLoginLoading(true);
    try {
      await account.createEmailPasswordSession(email, password);
      setIsLoggedIn(true);
    } catch (err) {
      setLoginError(err?.message || 'Login failed. Check your email and password.');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await account.deleteSession('current');
    } catch {
      // gak masalah kalau gagal -- state lokal tetap di-reset di bawah
    }
    setIsLoggedIn(false);
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    setFormError('');
    setFormSuccess('');

    if (!title.trim()) return setFormError('Title is required.');
    if (!audioFile) return setFormError('Please choose an audio file.');

    setUploading(true);
    try {
      // 1. Upload file audio ke Storage
      const uploadedFile = await storage.createFile(RECORDING_UPLOAD_BUCKET_ID, ID.unique(), audioFile);

      // 2. Bikin dokumen listing, nunjuk ke file yang barusan di-upload
      await databases.createDocument(DATABASE_ID, VOICE_LISTINGS_COLLECTION_ID, ID.unique(), {
        title: title.trim(),
        quote_text: quoteText.trim(),
        audio_file_id: uploadedFile.$id,
      });

      setFormSuccess('Listing published successfully.');
      setTitle('');
      setQuoteText('');
      setAudioFile(null);
      e.target.reset();
      fetchListings();
    } catch (err) {
      setFormError(err?.message || 'Failed to publish listing.');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (listing) => {
    if (!window.confirm(`Delete "${listing.title}"? This cannot be undone.`)) return;
    try {
      await databases.deleteDocument(DATABASE_ID, VOICE_LISTINGS_COLLECTION_ID, listing.$id);
      // File audio-nya juga dihapus, biar gak numpuk sampah di Storage.
      try {
        await storage.deleteFile(RECORDING_UPLOAD_BUCKET_ID, listing.audio_file_id);
      } catch (e) {
        console.warn('Listing document deleted, but failed to delete its audio file:', e);
      }
      setListings((prev) => prev.filter((l) => l.$id !== listing.$id));
    } catch (err) {
      alert(err?.message || 'Failed to delete listing.');
    }
  };

  if (checkingAuth) {
    return (
      <div className="admin-shell">
        <p className="admin-loading">Checking session…</p>
      </div>
    );
  }

  if (!isLoggedIn) {
    return (
      <div className="admin-shell">
        <form className="admin-login-card" onSubmit={handleLogin}>
          <h1>Admin Login</h1>
          <p className="admin-subtitle">Manage Voice Listings</p>

          {!!loginError && <div className="admin-error">{loginError}</div>}

          <label>Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required disabled={loginLoading} />

          <label>Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required disabled={loginLoading} />

          <button type="submit" disabled={loginLoading}>
            {loginLoading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="admin-shell">
      <div className="admin-header">
        <h1>Voice Listings</h1>
        <button className="admin-logout-btn" onClick={handleLogout}>Log Out</button>
      </div>

      <form className="admin-upload-card" onSubmit={handleUpload}>
        <h2>Publish a new listing</h2>

        {!!formError && <div className="admin-error">{formError}</div>}
        {!!formSuccess && <div className="admin-success">{formSuccess}</div>}

        <label>Title</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Calm narration sample"
          disabled={uploading}
        />

        <label>Quote text (shown above the voice)</label>
        <textarea
          value={quoteText}
          onChange={(e) => setQuoteText(e.target.value)}
          placeholder="The words that appear alongside this voice sample…"
          rows={3}
          disabled={uploading}
        />

        <label>Audio file</label>
        <input
          type="file"
          accept="audio/*"
          onChange={(e) => setAudioFile(e.target.files?.[0] || null)}
          disabled={uploading}
        />

        <button type="submit" disabled={uploading}>
          {uploading ? 'Publishing…' : 'Publish Listing'}
        </button>
      </form>

      <div className="admin-list-section">
        <h2>Published listings ({listings.length})</h2>
        {listingsLoading ? (
          <p className="admin-loading">Loading…</p>
        ) : listings.length === 0 ? (
          <p className="admin-empty">No listings published yet.</p>
        ) : (
          <div className="admin-list">
            {listings.map((item) => (
              <div className="admin-list-item" key={item.$id}>
                <div className="admin-list-item-info">
                  <strong>{item.title}</strong>
                  {!!item.quote_text && <p>{item.quote_text}</p>}
                  <audio
                    controls
                    src={storage.getFileView(RECORDING_UPLOAD_BUCKET_ID, item.audio_file_id).toString()}
                  />
                </div>
                <button className="admin-delete-btn" onClick={() => handleDelete(item)}>Delete</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
