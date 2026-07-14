import { useState, useEffect } from 'react';
import { Client, Functions } from 'appwrite';
import {
  account, databases, ID, Query,
  DATABASE_ID, APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, UPLOAD_TO_R2_FUNCTION_ID,
} from './appwriteConfig';
import './AdminListings.css';

const SPEAKERS_COLLECTION_ID = 'speakers';
const EMOTION_SAMPLES_COLLECTION_ID = 'speaker_emotion_samples';

const client = new Client().setEndpoint(APPWRITE_ENDPOINT).setProject(APPWRITE_PROJECT_ID);

// 🔍 Parse filename "Ailany-Female-English-Angry.wav" -> {speakerName,
// gender, language, emotion}. Sesuaikan di sini kalau konvensi nama file
// Anda beda dari 4-bagian ini.
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

export default function AdminEmotionUpload() {
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  const [speakers, setSpeakers] = useState([]);
  const [rows, setRows] = useState([]); // [{ file, parsed, matchedSpeaker, status, error }]
  const [uploading, setUploading] = useState(false);

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
    if (!isLoggedIn) return;
    databases
      .listDocuments(DATABASE_ID, SPEAKERS_COLLECTION_ID, [Query.limit(200)])
      .then((res) => setSpeakers(res.documents))
      .catch((e) => console.error('Failed to load speakers:', e));
  }, [isLoggedIn]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    setLoginLoading(true);
    try {
      // 🐛 Ingat: SDK v13 pakai createEmailSession, bukan
      // createEmailPasswordSession (beda dari dokumentasi terbaru Appwrite).
      await account.createEmailSession(email, password);
      setIsLoggedIn(true);
    } catch (err) {
      setLoginError(err?.message || 'Login failed.');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleFilesSelected = (e) => {
    const files = Array.from(e.target.files || []);
    const newRows = files.map((file) => {
      const parsed = parseEmotionFilename(file.name);
      const matchedSpeaker = parsed
        ? speakers.find((s) => s.label?.toLowerCase() === parsed.speakerName.toLowerCase())
        : null;
      return {
        file,
        parsed,
        matchedSpeaker,
        status: !parsed ? 'invalid_name' : !matchedSpeaker ? 'speaker_not_found' : 'ready',
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
      if (row.status !== 'ready') continue; // skip yang invalid/speaker gak ketemu

      updateRow(i, { status: 'uploading' });
      try {
        const fileBase64 = await fileToBase64(row.file);
        const execution = await functions.createExecution(
          UPLOAD_TO_R2_FUNCTION_ID,
          JSON.stringify({ action: 'upload', fileBase64, fileName: row.file.name, mimeType: row.file.type })
        );
        const result = JSON.parse(execution.responseBody || '{}');
        if (!result.success) throw new Error(result.error || 'Upload to R2 failed.');

        await databases.createDocument(DATABASE_ID, EMOTION_SAMPLES_COLLECTION_ID, ID.unique(), {
          speaker_id: row.matchedSpeaker.$id,
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
          <p className="admin-subtitle">Speaker Emotion Samples</p>
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
        <h1>Speaker Emotion Samples</h1>
      </div>

      <div className="admin-upload-card">
        <h2>Batch upload -- filename format: Speaker-Gender-Language-Emotion.wav</h2>
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
                        Speaker: {row.parsed.speakerName} · Gender: {row.parsed.gender} · Language: {row.parsed.language} · Emotion: {row.parsed.emotion}
                      </p>
                    ) : (
                      <p>Could not parse filename -- expected 4 parts separated by "-".</p>
                    )}
                    {row.status === 'speaker_not_found' && (
                      <p style={{ color: '#ff8fab' }}>No matching speaker named "{row.parsed?.speakerName}" found in the speakers collection.</p>
                    )}
                    {row.status === 'error' && <p style={{ color: '#ff8fab' }}>{row.error}</p>}
                    {row.status === 'done' && <p style={{ color: '#6ee7b7' }}>Uploaded successfully.</p>}
                  </div>
                  <span style={{ fontSize: 12, color: '#8F8CAB', textTransform: 'uppercase' }}>{row.status}</span>
                </div>
              ))}
            </div>
            <button onClick={handleUploadAll} disabled={uploading || readyCount === 0} style={{ marginTop: 16 }}>
              {uploading ? 'Uploading…' : `Upload ${readyCount} ready file(s)`}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
