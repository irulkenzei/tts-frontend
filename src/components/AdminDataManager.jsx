import { useState, useEffect } from 'react';
import { Client, Functions } from 'appwrite';
import {
  account, databases, ID, Query,
  DATABASE_ID, APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, UPLOAD_TO_R2_FUNCTION_ID,
} from '../services/appwriteConfig';
import '../styles/AdminListings.css';
import '../styles/AdminDataManager.css';

const SPEAKERS_COLLECTION_ID = 'speakers';
const EMOTION_SAMPLES_COLLECTION_ID = 'speaker_emotion_samples';
// 🆕 Koleksi musik latar kurasi NaratorAI (dipakai di CreateScreen.tsx app
// mobile, opsi "NaratorAI Collection" pas user nambahin background music)
const BACKGROUND_MUSIC_COLLECTION_ID = 'background_music';
// File background music di-upload ke folder R2 ini (lihat perubahan di
// upload-to-r2/src/main.js -- folder sekarang ditentuin dari client,
// bukan hardcode lagi), hasil akhirnya jadi https://media.naratorai.app/background-music/...
const BACKGROUND_MUSIC_R2_FOLDER = 'background-music';
const DEFAULT_AVATAR = 'https://media.naratorai.app/speaker-samples/avatar/texttospeech.webp';

const client = new Client().setEndpoint(APPWRITE_ENDPOINT).setProject(APPWRITE_PROJECT_ID);

function parseEmotionFilename(filename) {
  const base = filename.replace(/\.(wav|mp3|m4a|ogg)$/i, '');
  const parts = base.split('-').map((p) => p.trim());
  if (parts.length < 4) return null;
  return {
    speakerName: parts[0],
    gender: parts[1],
    language: parts[2],
    emotion: parts[3].toLowerCase(),
  };
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ============================================================
// TAB 1 -- Batch Upload
// ------------------------------------------------------------
// 🔧 REVISI: emotion voices ini KATALOG MANDIRI -- BUKAN varian dari
// speaker yang sudah ada. Tiap baris punya identitas lengkap sendiri
// (name, gender, language, emotion), gak nyambung/gak butuh ke
// collection `speakers` sama sekali. Makanya gak ada lagi logic
// "cari/auto-create speaker" -- langsung insert ke speaker_emotion_samples.
// ============================================================
function BatchUploadTab() {
  const [rows, setRows] = useState([]);
  const [uploading, setUploading] = useState(false);

  const handleFilesSelected = (e) => {
    const files = Array.from(e.target.files || []);
    const newRows = files.map((file) => {
      const parsed = parseEmotionFilename(file.name);
      return {
        file,
        parsed,
        status: !parsed ? 'invalid_name' : 'ready',
        error: null,
      };
    });
    setRows(newRows);
  };

  const updateRow = (index, patch) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const handleUploadAll = async () => {
    setUploading(true);
    const functions = new Functions(client);

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row.status !== 'ready') continue;

      updateRow(i, { status: 'uploading' });
      try {
        const fileBase64 = await fileToBase64(row.file);
        const execution = await functions.createExecution(
          UPLOAD_TO_R2_FUNCTION_ID,
          JSON.stringify({ action: 'upload', fileBase64, fileName: row.file.name, mimeType: row.file.type })
        );
        const result = JSON.parse(execution.responseBody || '{}');
        if (!result.success) throw new Error(result.error || 'Upload to R2 failed.');

        // Insert LANGSUNG sebagai entry mandiri -- name/gender/language/
        // emotion semuanya dari filename, gak ada speaker_id sama sekali.
        await databases.createDocument(DATABASE_ID, EMOTION_SAMPLES_COLLECTION_ID, ID.unique(), {
          name: row.parsed.speakerName,
          gender: row.parsed.gender,
          language: row.parsed.language,
          emotion: row.parsed.emotion,
          audio_url: result.url,
        });

        updateRow(i, { status: 'done' });
      } catch (err) {
        updateRow(i, { status: 'error', error: err?.message || 'Upload failed.' });
      }
    }
    setUploading(false);
  };

  const readyCount = rows.filter((r) => r.status === 'ready').length;

  return (
    <div className="admin-upload-card">
      <h2>Batch upload -- filename: Name-Gender-Language-Emotion.wav</h2>
      <p className="admin-hint">Tiap file jadi 1 entry mandiri di katalog Emotion Voices -- gak terhubung ke speaker biasa.</p>
      <input type="file" accept="audio/*" multiple onChange={handleFilesSelected} disabled={uploading} />

      {rows.length > 0 && (
        <>
          <div className="admin-list" style={{ marginTop: 16 }}>
            {rows.map((row, i) => (
              <div className="admin-list-item" key={i}>
                <div className="admin-list-item-info">
                  <strong>{row.file.name}</strong>
                  {row.parsed ? (
                    <p>
                      Name: {row.parsed.speakerName} · {row.parsed.gender} · {row.parsed.language} · {row.parsed.emotion}
                    </p>
                  ) : (
                    <p>Could not parse filename -- expected 4 parts separated by "-".</p>
                  )}
                  {row.status === 'error' && <p style={{ color: 'var(--err)' }}>{row.error}</p>}
                  {row.status === 'done' && <p style={{ color: 'var(--ok)' }}>Uploaded successfully.</p>}
                </div>
                <span className="admin-status-tag">{row.status}</span>
              </div>
            ))}
          </div>
          <button onClick={handleUploadAll} disabled={uploading || readyCount === 0} style={{ marginTop: 16 }}>
            {uploading ? 'Uploading…' : `Upload ${readyCount} ready file(s)`}
          </button>
        </>
      )}
    </div>
  );
}

// ============================================================
// TAB 2 -- Speakers table (edit/delete gampang)
// ============================================================
function SpeakersTab({ speakers, refreshSpeakers }) {
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});

  const startEdit = (speaker) => {
    setEditingId(speaker.$id);
    setEditForm({
      label: speaker.label || '',
      gender: speaker.gender || '',
      description: speaker.description || '',
      value: speaker.value || '',
      // 🏷️ tags itu Array attribute (BEDA dari voice_listings.tags yang
      // String) -- ditampilin sebagai teks dipisah koma buat gampang
      // diedit, tapi dipecah balik jadi array proper pas disimpan (bukan
      // disimpen sebagai 1 string gabungan).
      tagsText: Array.isArray(speaker.tags) ? speaker.tags.join(', ') : '',
    });
  };

  const saveEdit = async () => {
    const tags = editForm.tagsText
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    await databases.updateDocument(DATABASE_ID, SPEAKERS_COLLECTION_ID, editingId, {
      label: editForm.label,
      gender: editForm.gender,
      description: editForm.description,
      value: editForm.value,
      tags, // array asli, bukan string gabungan
    });
    setEditingId(null);
    refreshSpeakers();
  };

  const handleDelete = async (speaker) => {
    if (!window.confirm(`Delete speaker "${speaker.label}"? This cannot be undone.`)) return;
    await databases.deleteDocument(DATABASE_ID, SPEAKERS_COLLECTION_ID, speaker.$id);
    refreshSpeakers();
  };

  return (
    <div className="admin-upload-card">
      <h2>Speakers ({speakers.length})</h2>
      <div className="admin-table admin-table-speakers">
        <div className="admin-table-row admin-table-head">
          <span>Label</span><span>Gender</span><span>Description</span><span>Tags</span><span></span>
        </div>
        {speakers.map((s) => (
          <div className="admin-table-row" key={s.$id}>
            {editingId === s.$id ? (
              <>
                <input value={editForm.label} onChange={(e) => setEditForm({ ...editForm, label: e.target.value })} />
                <input value={editForm.gender} onChange={(e) => setEditForm({ ...editForm, gender: e.target.value })} />
                <input value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} />
                <input
                  value={editForm.tagsText}
                  onChange={(e) => setEditForm({ ...editForm, tagsText: e.target.value })}
                  placeholder="e.g. EXPRESSIVE, NARRATOR"
                />
                <div className="admin-table-actions">
                  <button onClick={saveEdit}>Save</button>
                  <button onClick={() => setEditingId(null)}>Cancel</button>
                </div>
              </>
            ) : (
              <>
                <span>{s.label}</span>
                <span>{s.gender}</span>
                <span>{s.description}</span>
                <span>
                  {Array.isArray(s.tags) && s.tags.length > 0 ? (
                    <div className="admin-tags-row">
                      {s.tags.map((tag) => (
                        <span className="admin-tag-pill" key={tag}>{tag}</span>
                      ))}
                    </div>
                  ) : (
                    <span style={{ color: 'var(--text-secondary, #b0bec5)', fontSize: '0.75rem' }}>--</span>
                  )}
                </span>
                <div className="admin-table-actions">
                  <button onClick={() => startEdit(s)}>Edit</button>
                  <button className="admin-delete-btn" onClick={() => handleDelete(s)}>Delete</button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// TAB 3 -- Emotion Voices table (katalog mandiri, edit/delete gampang)
// ============================================================
function EmotionSamplesTab() {
  const [samples, setSamples] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});

  const fetchSamples = async () => {
    setLoading(true);
    const res = await databases.listDocuments(DATABASE_ID, EMOTION_SAMPLES_COLLECTION_ID, [Query.limit(300)]);
    setSamples(res.documents);
    setLoading(false);
  };

  useEffect(() => { fetchSamples(); }, []);

  const startEdit = (sample) => {
    setEditingId(sample.$id);
    setEditForm({
      name: sample.name || '',
      gender: sample.gender || '',
      language: sample.language || '',
      emotion: sample.emotion || '',
    });
  };

  const saveEdit = async () => {
    await databases.updateDocument(DATABASE_ID, EMOTION_SAMPLES_COLLECTION_ID, editingId, editForm);
    setEditingId(null);
    fetchSamples();
  };

  const handleDelete = async (sample) => {
    if (!window.confirm('Delete this emotion voice? This cannot be undone.')) return;
    await databases.deleteDocument(DATABASE_ID, EMOTION_SAMPLES_COLLECTION_ID, sample.$id);
    fetchSamples();
  };

  if (loading) return <div className="admin-upload-card"><p className="admin-loading">Loading…</p></div>;

  return (
    <div className="admin-upload-card">
      <h2>Emotion Voices ({samples.length})</h2>
      <div className="admin-table">
        <div className="admin-table-row admin-table-head">
          <span>Name</span><span>Gender / Language</span><span>Emotion</span><span></span>
        </div>
        {samples.map((s) => (
          <div className="admin-table-row" key={s.$id}>
            {editingId === s.$id ? (
              <>
                <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
                <div style={{ display: 'flex', gap: 6 }}>
                  <input value={editForm.gender} onChange={(e) => setEditForm({ ...editForm, gender: e.target.value })} />
                  <input value={editForm.language} onChange={(e) => setEditForm({ ...editForm, language: e.target.value })} />
                </div>
                <input value={editForm.emotion} onChange={(e) => setEditForm({ ...editForm, emotion: e.target.value })} />
                <div className="admin-table-actions">
                  <button onClick={saveEdit}>Save</button>
                  <button onClick={() => setEditingId(null)}>Cancel</button>
                </div>
              </>
            ) : (
              <>
                <span>{s.name}</span>
                <span>{s.gender} · {s.language}</span>
                <span>{s.emotion}</span>
                <div className="admin-table-actions">
                  <audio controls src={s.audio_url} style={{ height: 28, maxWidth: 120 }} />
                  <button onClick={() => startEdit(s)}>Edit</button>
                  <button className="admin-delete-btn" onClick={() => handleDelete(s)}>Delete</button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// TAB 4 -- Background Music (upload + kelola, 1 tab gabungan)
// ------------------------------------------------------------
// Skema: title / audio_url / is_pro. File di-upload ke folder R2
// "background-music/" (lihat BACKGROUND_MUSIC_R2_FOLDER), hasilnya jadi
// https://media.naratorai.app/background-music/{timestamp}-{filename}.
//
// ⚠️ Tombol Delete di sini cuma hapus RECORD DATABASE-nya, BUKAN file
// fisiknya di R2 (skema collection yang diminta cuma title/audio_url/
// is_pro -- gak nyimpen R2 key-nya, jadi gak ada cara bersih buat manggil
// action 'delete' di upload-to-r2 dari sini). File lama bakal nganggur di
// R2 tapi gak nongol lagi di app. Kalau nanti mau bener-bener kehapus dari
// R2 juga, kasih tau -- tinggal tambah 1 attribute lagi (`r2_key`) di
// collection ini.
// ============================================================
function BackgroundMusicTab() {
  const [rows, setRows] = useState([]);
  const [uploading, setUploading] = useState(false);

  const [tracks, setTracks] = useState([]);
  const [loadingTracks, setLoadingTracks] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});

  const fetchTracks = async () => {
    setLoadingTracks(true);
    const res = await databases.listDocuments(DATABASE_ID, BACKGROUND_MUSIC_COLLECTION_ID, [Query.limit(300)]);
    setTracks(res.documents);
    setLoadingTracks(false);
  };

  useEffect(() => { fetchTracks(); }, []);

  const handleFilesSelected = (e) => {
    const files = Array.from(e.target.files || []);
    const newRows = files.map((file) => ({
      file,
      // Default title dari nama file (buang ekstensi, ganti dash/underscore
      // jadi spasi) -- admin masih bisa edit manual sebelum upload.
      title: file.name.replace(/\.(mp3|wav|m4a|ogg)$/i, '').replace(/[-_]+/g, ' ').trim(),
      isPro: false,
      status: 'ready',
      error: null,
    }));
    setRows(newRows);
  };

  const updateRow = (index, patch) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const handleUploadAll = async () => {
    setUploading(true);
    const functions = new Functions(client);

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row.status !== 'ready') continue;
      if (!row.title.trim()) {
        updateRow(i, { status: 'error', error: 'Title cannot be empty.' });
        continue;
      }

      updateRow(i, { status: 'uploading' });
      try {
        const fileBase64 = await fileToBase64(row.file);
        const execution = await functions.createExecution(
          UPLOAD_TO_R2_FUNCTION_ID,
          JSON.stringify({
            action: 'upload',
            fileBase64,
            fileName: row.file.name,
            mimeType: row.file.type,
            folder: BACKGROUND_MUSIC_R2_FOLDER,
          })
        );
        const result = JSON.parse(execution.responseBody || '{}');
        if (!result.success) throw new Error(result.error || 'Upload to R2 failed.');

        await databases.createDocument(DATABASE_ID, BACKGROUND_MUSIC_COLLECTION_ID, ID.unique(), {
          title: row.title.trim(),
          audio_url: result.url,
          is_pro: row.isPro,
        });

        updateRow(i, { status: 'done' });
      } catch (err) {
        updateRow(i, { status: 'error', error: err?.message || 'Upload failed.' });
      }
    }
    setUploading(false);
    fetchTracks();
  };

  const startEdit = (track) => {
    setEditingId(track.$id);
    setEditForm({ title: track.title || '', is_pro: !!track.is_pro });
  };

  const saveEdit = async () => {
    await databases.updateDocument(DATABASE_ID, BACKGROUND_MUSIC_COLLECTION_ID, editingId, {
      title: editForm.title,
      is_pro: editForm.is_pro,
    });
    setEditingId(null);
    fetchTracks();
  };

  const handleDelete = async (track) => {
    if (!window.confirm(`Delete "${track.title}" from the database? (The R2 file itself will stay, see note above.)`)) return;
    await databases.deleteDocument(DATABASE_ID, BACKGROUND_MUSIC_COLLECTION_ID, track.$id);
    fetchTracks();
  };

  const readyCount = rows.filter((r) => r.status === 'ready').length;

  return (
    <div className="admin-upload-card">
      <h2>Upload Background Music</h2>
      <p className="admin-hint">
        File masuk ke folder R2 "{BACKGROUND_MUSIC_R2_FOLDER}/" -- edit title & tandain Pro-only sebelum upload.
      </p>
      <input type="file" accept="audio/*" multiple onChange={handleFilesSelected} disabled={uploading} />

      {rows.length > 0 && (
        <>
          <div className="admin-list" style={{ marginTop: 16 }}>
            {rows.map((row, i) => (
              <div className="admin-list-item" key={i}>
                <div className="admin-list-item-info" style={{ flex: 1 }}>
                  <strong>{row.file.name}</strong>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 6 }}>
                    <input
                      value={row.title}
                      onChange={(e) => updateRow(i, { title: e.target.value })}
                      placeholder="Track title"
                      disabled={row.status === 'uploading' || row.status === 'done'}
                      style={{ flex: 1 }}
                    />
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                      <input
                        type="checkbox"
                        checked={row.isPro}
                        onChange={(e) => updateRow(i, { isPro: e.target.checked })}
                        disabled={row.status === 'uploading' || row.status === 'done'}
                      />
                      Pro-only
                    </label>
                  </div>
                  {row.status === 'error' && <p style={{ color: 'var(--err)' }}>{row.error}</p>}
                  {row.status === 'done' && <p style={{ color: 'var(--ok)' }}>Uploaded successfully.</p>}
                </div>
                <span className="admin-status-tag">{row.status}</span>
              </div>
            ))}
          </div>
          <button onClick={handleUploadAll} disabled={uploading || readyCount === 0} style={{ marginTop: 16 }}>
            {uploading ? 'Uploading…' : `Upload ${readyCount} ready file(s)`}
          </button>
        </>
      )}

      <h2 style={{ marginTop: 32 }}>Background Music Library ({tracks.length})</h2>
      {loadingTracks ? (
        <p className="admin-loading">Loading…</p>
      ) : (
        <div className="admin-table">
          <div className="admin-table-row admin-table-head">
            <span>Title</span><span>Pro-only</span><span>Preview</span><span></span>
          </div>
          {tracks.map((t) => (
            <div className="admin-table-row" key={t.$id}>
              {editingId === t.$id ? (
                <>
                  <input value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} />
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input
                      type="checkbox"
                      checked={editForm.is_pro}
                      onChange={(e) => setEditForm({ ...editForm, is_pro: e.target.checked })}
                    />
                    Pro-only
                  </label>
                  <audio controls src={t.audio_url} style={{ height: 28, maxWidth: 120 }} />
                  <div className="admin-table-actions">
                    <button onClick={saveEdit}>Save</button>
                    <button onClick={() => setEditingId(null)}>Cancel</button>
                  </div>
                </>
              ) : (
                <>
                  <span>{t.title}</span>
                  <span>{t.is_pro ? '👑 Pro' : '--'}</span>
                  <audio controls src={t.audio_url} style={{ height: 28, maxWidth: 120 }} />
                  <div className="admin-table-actions">
                    <button onClick={() => startEdit(t)}>Edit</button>
                    <button className="admin-delete-btn" onClick={() => handleDelete(t)}>Delete</button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


export default function AdminDataManager() {
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  const [activeTab, setActiveTab] = useState('upload');
  const [speakers, setSpeakers] = useState([]);

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

  const refreshSpeakers = async () => {
    const res = await databases.listDocuments(DATABASE_ID, SPEAKERS_COLLECTION_ID, [Query.limit(200)]);
    setSpeakers(res.documents);
  };

  useEffect(() => { if (isLoggedIn) refreshSpeakers(); }, [isLoggedIn]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    setLoginLoading(true);
    try {
      await account.createEmailSession(email, password);
      setIsLoggedIn(true);
    } catch (err) {
      setLoginError(err?.message || 'Login failed.');
    } finally {
      setLoginLoading(false);
    }
  };

  if (checkingAuth) {
    return <div className="admin-shell"><p className="admin-loading">Checking session…</p></div>;
  }

  if (!isLoggedIn) {
    return (
      <div className="admin-shell">
        <form className="admin-login-card" onSubmit={handleLogin}>
          <h1>Admin Login</h1>
          <p className="admin-subtitle">Speaker Data Manager</p>
          {!!loginError && <div className="admin-error">{loginError}</div>}
          <label>Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required disabled={loginLoading} />
          <label>Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required disabled={loginLoading} />
          <button type="submit" disabled={loginLoading}>{loginLoading ? 'Signing in…' : 'Sign In'}</button>
        </form>
      </div>
    );
  }

  return (
    <div className="admin-shell">
      <div className="admin-header">
        <h1>Speaker Data Manager</h1>
      </div>

      <div className="admin-tabs">
        <button className={activeTab === 'upload' ? 'admin-tab-active' : ''} onClick={() => setActiveTab('upload')}>Batch Upload</button>
        <button className={activeTab === 'speakers' ? 'admin-tab-active' : ''} onClick={() => setActiveTab('speakers')}>Speakers</button>
        <button className={activeTab === 'emotions' ? 'admin-tab-active' : ''} onClick={() => setActiveTab('emotions')}>Emotion Samples</button>
        <button className={activeTab === 'bgmusic' ? 'admin-tab-active' : ''} onClick={() => setActiveTab('bgmusic')}>Background Music</button>
      </div>

      {activeTab === 'upload' && <BatchUploadTab />}
      {activeTab === 'speakers' && <SpeakersTab speakers={speakers} refreshSpeakers={refreshSpeakers} />}
      {activeTab === 'emotions' && <EmotionSamplesTab />}
      {activeTab === 'bgmusic' && <BackgroundMusicTab />}
    </div>
  );
}