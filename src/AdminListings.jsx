import { useState, useEffect } from 'react';
import { account, databases, client, ID, Query, DATABASE_ID, VOICE_LISTINGS_COLLECTION_ID, UPLOAD_TO_R2_FUNCTION_ID } from './appwriteConfig';
import { Functions } from 'appwrite';
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
  const [tags, setTags] = useState('');
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
      // 🐛 FIX: createEmailPasswordSession BELUM ADA di appwrite SDK v13
      // (baru diperkenalkan di v1.5+) -- versi yang dipakai project ini
      // masih pakai nama method LAMA: createEmailSession(email, password).
      await account.createEmailSession(email, password);
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

  // 🔧 Convert File jadi base64 -- dikirim ke Function upload-to-r2 lewat
  // JSON body (Appwrite Function execution nerima body sebagai string,
  // gak bisa multipart/binary langsung).
  const fileToBase64 = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        // readAsDataURL hasilnya "data:audio/mpeg;base64,XXXXX" -- kita
        // cuma butuh bagian base64-nya doang, buang prefix-nya.
        const base64 = reader.result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const handleUpload = async (e) => {
    e.preventDefault();
    setFormError('');
    setFormSuccess('');

    if (!title.trim()) return setFormError('Title is required.');
    if (!audioFile) return setFormError('Please choose an audio file.');

    setUploading(true);
    try {
      // 1. Upload file audio ke Cloudflare R2 lewat Function perantara --
      // kredensial R2 gak pernah nyentuh browser sama sekali.
      const fileBase64 = await fileToBase64(audioFile);
      const functions = new Functions(client);
      const execution = await functions.createExecution(
        UPLOAD_TO_R2_FUNCTION_ID,
        JSON.stringify({
          action: 'upload',
          fileBase64,
          fileName: audioFile.name,
          mimeType: audioFile.type,
        })
      );
      const result = JSON.parse(execution.responseBody || '{}');
      if (!result.success) throw new Error(result.error || 'Failed to upload audio to R2.');

      // 2. Bikin dokumen listing, nunjuk ke URL R2 yang barusan di-upload
      // 🏷️ Normalize tags -- trim tiap tag, buang yang kosong, simpen balik
      // sebagai string dipisah koma (bukan array -- sengaja, biar gak kena
      // limitasi "array gak bisa diindex" kalau nanti mau filter by tag).
      const normalizedTags = tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
        .join(', ');

      await databases.createDocument(DATABASE_ID, VOICE_LISTINGS_COLLECTION_ID, ID.unique(), {
        title: title.trim(),
        quote_text: quoteText.trim(),
        tags: normalizedTags,
        audio_url: result.url,
        audio_r2_key: result.key, // disimpen buat keperluan hapus file nanti
      });

      setFormSuccess('Listing published successfully.');
      setTitle('');
      setQuoteText('');
      setTags('');
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
      // File audio-nya juga dihapus dari R2, biar gak numpuk sampah.
      if (listing.audio_r2_key) {
        try {
          const functions = new Functions(client);
          await functions.createExecution(
            UPLOAD_TO_R2_FUNCTION_ID,
            JSON.stringify({ action: 'delete', key: listing.audio_r2_key })
          );
        } catch (e) {
          console.warn('Listing document deleted, but failed to delete its audio file from R2:', e);
        }
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

        <label>Tags (comma-separated)</label>
        <input
          type="text"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="e.g. calm, narration, male voice"
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
                  {!!item.tags && (
                    <div className="admin-tags-row">
                      {item.tags.split(',').map((t) => t.trim()).filter(Boolean).map((tag) => (
                        <span className="admin-tag-pill" key={tag}>{tag}</span>
                      ))}
                    </div>
                  )}
                  <audio
                    controls
                    src={item.audio_url}
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
