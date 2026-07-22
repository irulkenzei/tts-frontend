import { useEffect, useRef, useState } from 'react';
import { Query } from 'appwrite';
import { databases, DATABASE_ID } from './appwriteClient';
import './EmotionPicker.css';

const EMOTION_SAMPLES_COLLECTION_ID = 'speaker_emotion_samples';

// 🎭 Sama persis mapping yang dipakai di mobile (EmotionPicker.tsx) --
// biar konsisten emoji-nya di dua platform.
const EMOTION_EMOJI = {
  angry: '😠',
  anxious: '😟',
  apologetic: '🙏',
  assertive: '💪',
  concerned: '😟',
  encouraging: '💬',
  excited: '🤩',
  happy: '😊',
  neutral: '😐',
  sad: '😢',
};

// 🎙️ Web equivalent dari EmotionPicker.tsx (mobile) -- collection & field
// SAMA PERSIS (`speaker_emotion_samples`, keyed by `speaker_id`), jadi
// emotion samples yang di-upload lewat admin (AdminDataManager.jsx) bisa
// dipakai bareng oleh mobile app & website tanpa duplikasi data.
//
// Props:
//   speakerId        -- $id dari voice library (collection `speakers`)
//   selectedEmotion  -- nama emotion yang lagi aktif (null = Default/no emotion)
//   onSelectEmotion(emotionName, audioUrl) -- dipanggil pas user pilih pill
export default function EmotionPicker({ speakerId, selectedEmotion, onSelectEmotion }) {
  const [samples, setSamples] = useState([]);
  const [loading, setLoading] = useState(true);
  const [previewingId, setPreviewingId] = useState(null);
  const audioRef = useRef(null);

  useEffect(() => {
    if (!speakerId) {
      setSamples([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setSamples([]);

    databases
      .listDocuments(DATABASE_ID, EMOTION_SAMPLES_COLLECTION_ID, [
        Query.equal('speaker_id', speakerId),
        Query.limit(20),
      ])
      .then((res) => {
        if (!cancelled) setSamples(res.documents);
      })
      .catch((e) => console.error('[EmotionPicker] Failed to load emotions:', e))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      audioRef.current?.pause?.();
    };
  }, [speakerId]);

  const handlePreview = (sample) => {
    audioRef.current?.pause?.();
    if (previewingId === sample.$id) {
      setPreviewingId(null);
      return;
    }
    try {
      const audio = new Audio(sample.audio_url);
      audioRef.current = audio;
      audio.play();
      audio.onended = () => setPreviewingId(null);
      setPreviewingId(sample.$id);
    } catch (e) {
      console.error('[EmotionPicker] Preview failed:', e);
    }
  };

  // Speaker ini gak punya sample emotion sama sekali -- gak usah render
  // apa-apa (fallback ke sample dasar speaker seperti biasa).
  if (!speakerId || (!loading && samples.length === 0)) return null;

  return (
    <div className="emotion-picker">
      <label className="emotion-picker-label">Emotion (optional)</label>
      {loading ? (
        <div className="emotion-picker-loading">Loading emotions…</div>
      ) : (
        <div className="emotion-picker-row">
          <button
            type="button"
            className={`emotion-pill ${selectedEmotion === null ? 'active' : ''}`}
            onClick={() => onSelectEmotion(null, null)}
          >
            Default
          </button>

          {samples.map((sample) => {
            const isActive = selectedEmotion === sample.emotion;
            const isPreviewing = previewingId === sample.$id;
            return (
              <button
                type="button"
                key={sample.$id}
                className={`emotion-pill ${isActive ? 'active' : ''}`}
                onClick={() => onSelectEmotion(sample.emotion, sample.audio_url)}
              >
                <span className="emotion-pill-emoji">{EMOTION_EMOJI[sample.emotion] || '🎙️'}</span>
                <span>{sample.emotion.charAt(0).toUpperCase() + sample.emotion.slice(1)}</span>
                <span
                  className="emotion-pill-preview"
                  onClick={(e) => {
                    e.stopPropagation();
                    handlePreview(sample);
                  }}
                  role="button"
                  aria-label="Preview"
                >
                  {isPreviewing ? '⏸' : '▶'}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
