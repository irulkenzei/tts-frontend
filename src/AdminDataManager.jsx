import { useState, useEffect } from 'react';
import { Client, Functions } from 'appwrite';
import {
  account, databases, ID, Query,
  DATABASE_ID, APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, UPLOAD_TO_R2_FUNCTION_ID,
} from './appwriteConfig';
import './AdminListings.css';
import './AdminDataManager.css';

const SPEAKERS_COLLECTION_ID = 'speakers';
const EMOTION_SAMPLES_COLLECTION_ID = 'speaker_emotion_samples';
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
// TAB 1 -- Batch Upload (parse filename, auto-create speaker kalau
// belum ada, upload ke R2, insert speaker_emotion_samples)
// ============================================================
function BatchUploadTab({ speakers, refreshSpeakers }) {
  const [rows, setRows] = useState([]);
  const [uploading, setUploading] = useState(false);

  const handleFilesSelected = (e) => {
    const files = Array.from(e.target.files || []);
    const newRows = files.map((file) => {
      const parsed = parseEmotionFilename(file.name);
      const existingSpeaker = parsed
        ? speakers.find((s) => s.label?.toLowerCase() === parsed.speakerName.toLowerCase())
        : null;
      return {
        file,
        parsed,
        existingSpeaker, // null = akan dibikin baru otomatis
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
    let speakerCreatedCount = 0;

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

        let speakerId = row.existingSpeaker?.$id;
        if (!speakerId) {
          const newSpeaker = await databases.createDocument(DATABASE_ID, SPEAKERS_COLLECTION_ID, ID.unique(), {
            label: row.parsed.speakerName,
            gender: row.parsed.gender,
            description: row.parsed.language,
            value: result.url,
            avatar_url: DEFAULT_AVATAR,
          });
          speakerId = newSpeaker.$id;
          speakerCreatedCount++;
        }

        await databases.createDocument(DATABASE_ID, EMOTION_SAMPLES_COLLECTION_ID, ID.unique(), {
          speaker_id: speakerId,
          emotion: row.parsed.emotion,
          audio_url: result.url,
        });

        updateRow(i, { status: 'done' });
      } catch (err) {
        updateRow(i, { status: 'error', error: err?.message || 'Upload failed.' });
      }
    }
    setUploading(false);
    if (speakerCreatedCount > 0) refreshSpeakers();
  };

  const readyCount = rows.filter((r) => r.status === 'ready').length;

  return (
    <div className="admin-upload-card">
      <h2>Batch upload -- filename: Speaker-Gender-Language-Emotion.wav</h2>
      <p className="admin-hint">Speaker baru yang belum ada di daftar akan otomatis dibuat.</p>
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
                      Speaker: {row.parsed.speakerName} {row.existingSpeaker ? '(existing)' : '(new)'} · {row.parsed.gender} · {row.parsed.language} · {row.parsed.emotion}
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
    setEditForm({ label: speaker.label || '', gender: speaker.gender || '', description: speaker.description || '', value: speaker.value || '' });
  };

  const saveEdit = async () => {
    await databases.updateDocument(DATABASE_ID, SPEAKERS_COLLECTION_ID, editingId, editForm);
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
      <div className="admin-table">
        <div className="admin-table-row admin-table-head">
          <span>Label</span><span>Gender</span><span>Description</span><span></span>
        </div>
        {speakers.map((s) => (
          <div className="admin-table-row" key={s.$id}>
            {editingId === s.$id ? (
              <>
                <input value={editForm.label} onChange={(e) => setEditForm({ ...editForm, label: e.target.value })} />
                <input value={editForm.gender} onChange={(e) => setEditForm({ ...editForm, gender: e.target.value })} />
                <input value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} />
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
// TAB 3 -- Emotion Samples table (edit/delete gampang)
// ============================================================
function EmotionSamplesTab({ speakers }) {
  const [samples, setSamples] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});

  const fetchSamples = async () => {
    setLoading(true);
    const res = await databases.listDocuments(DATABASE_ID, EMOTION_SAMPLES_COLLECTION_ID, [Query.limit(200)]);
    setSamples(res.documents);
    setLoading(false);
  };

  useEffect(() => { fetchSamples(); }, []);

  const speakerLabel = (speakerId) => speakers.find((s) => s.$id === speakerId)?.label || speakerId;

  const startEdit = (sample) => {
    setEditingId(sample.$id);
    setEditForm({ emotion: sample.emotion || '', speaker_id: sample.speaker_id || '' });
  };

  const saveEdit = async () => {
    await databases.updateDocument(DATABASE_ID, EMOTION_SAMPLES_COLLECTION_ID, editingId, editForm);
    setEditingId(null);
    fetchSamples();
  };

  const handleDelete = async (sample) => {
    if (!window.confirm('Delete this emotion sample? This cannot be undone.')) return;
    await databases.deleteDocument(DATABASE_ID, EMOTION_SAMPLES_COLLECTION_ID, sample.$id);
    fetchSamples();
  };

  if (loading) return <div className="admin-upload-card"><p className="admin-loading">Loading…</p></div>;

  return (
    <div className="admin-upload-card">
      <h2>Emotion Samples ({samples.length})</h2>
      <div className="admin-table">
        <div className="admin-table-row admin-table-head">
          <span>Speaker</span><span>Emotion</span><span>Audio</span><span></span>
        </div>
        {samples.map((s) => (
          <div className="admin-table-row" key={s.$id}>
            {editingId === s.$id ? (
              <>
                <select value={editForm.speaker_id} onChange={(e) => setEditForm({ ...editForm, speaker_id: e.target.value })}>
                  {speakers.map((sp) => <option key={sp.$id} value={sp.$id}>{sp.label}</option>)}
                </select>
                <input value={editForm.emotion} onChange={(e) => setEditForm({ ...editForm, emotion: e.target.value })} />
                <span />
                <div className="admin-table-actions">
                  <button onClick={saveEdit}>Save</button>
                  <button onClick={() => setEditingId(null)}>Cancel</button>
                </div>
              </>
            ) : (
              <>
                <span>{speakerLabel(s.speaker_id)}</span>
                <span>{s.emotion}</span>
                <audio controls src={s.audio_url} style={{ height: 28, maxWidth: 160 }} />
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
// MAIN -- login gate + tab switcher
// ============================================================
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
      </div>

      {activeTab === 'upload' && <BatchUploadTab speakers={speakers} refreshSpeakers={refreshSpeakers} />}
      {activeTab === 'speakers' && <SpeakersTab speakers={speakers} refreshSpeakers={refreshSpeakers} />}
      {activeTab === 'emotions' && <EmotionSamplesTab speakers={speakers} />}
    </div>
  );
}
