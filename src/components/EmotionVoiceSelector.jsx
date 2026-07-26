import { useEffect, useRef, useState } from 'react';
import { Query } from 'appwrite';
import { databases, DATABASE_ID } from '../services/appwriteClient';
import '../styles/EmotionVoiceSelector.css';

const EMOTION_SAMPLES_COLLECTION_ID = 'speaker_emotion_samples';

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

// 🎭 Web equivalent dari EmotionModeSelector.tsx (mobile). BEDA dari
// EmotionPicker.jsx: di sini emotion voices adalah LIBRARY TERSENDIRI
// (speaker_id NULL, punya name/gender/language sendiri) -- BUKAN filter
// tambahan atas voice yang sudah dipilih dari `speakers`. Alur 2 level:
//   Level 1 -- pilih tag emotion (angry, sad, happy, dst)
//   Level 2 -- muncul list voice yang punya emotion itu, pilih salah satu
//
// Props:
//   onSelectVoice(voice) -- dipanggil pas user pilih salah satu voice,
//                            voice = { $id, name, gender, language, emotion, audio_url }
//   selectedVoiceId      -- $id voice yang lagi aktif (buat highlight)
export default function EmotionVoiceSelector({ onSelectVoice, selectedVoiceId }) {
  const [allVoices, setAllVoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [activeEmotion, setActiveEmotion] = useState(null);
  const [previewingId, setPreviewingId] = useState(null);
  const audioRef = useRef(null);

  useEffect(() => {
    setLoadError('');
    Promise.race([
      databases.listDocuments(DATABASE_ID, EMOTION_SAMPLES_COLLECTION_ID, [Query.limit(500)]),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Loading voices timed out after 10s.')), 10000)
      ),
    ])
      .then((res) => setAllVoices(res.documents))
      .catch((e) => {
        console.error('[EmotionVoiceSelector] Failed to load:', e);
        setLoadError(e?.message || 'Failed to load voices.');
      })
      .finally(() => setLoading(false));

    return () => {
      audioRef.current?.pause?.();
    };
  }, []);

  const emotionCounts = {};
  allVoices.forEach((v) => {
    emotionCounts[v.emotion] = (emotionCounts[v.emotion] || 0) + 1;
  });
  const availableEmotions = Object.keys(emotionCounts);

  const voicesForActiveEmotion = activeEmotion
    ? allVoices.filter((v) => v.emotion === activeEmotion)
    : [];

  const handlePreview = (voice) => {
    audioRef.current?.pause?.();
    if (previewingId === voice.$id) {
      setPreviewingId(null);
      return;
    }
    try {
      const audio = new Audio(voice.audio_url);
      audioRef.current = audio;
      audio.play();
      audio.onended = () => setPreviewingId(null);
      setPreviewingId(voice.$id);
    } catch (e) {
      console.error('[EmotionVoiceSelector] Preview failed:', e);
    }
  };

  if (loading) {
    return <div className="emo-voice-loading">Loading emotion voices…</div>;
  }

  if (loadError) {
    return <div className="emo-voice-hint">{loadError}</div>;
  }

  return (
    <div className="emo-voice-container">
      <label className="emo-voice-label">Choose an emotion</label>
      <div className="emo-voice-tag-row">
        {availableEmotions.map((emotion) => {
          const isActive = activeEmotion === emotion;
          return (
            <button
              type="button"
              key={emotion}
              className={`emo-voice-tag ${isActive ? 'active' : ''}`}
              onClick={() => setActiveEmotion(emotion)}
            >
              <span className="emo-voice-tag-emoji">{EMOTION_EMOJI[emotion] || '🎙️'}</span>
              <span>{emotion.charAt(0).toUpperCase() + emotion.slice(1)}</span>
              <span className="emo-voice-tag-count">{emotionCounts[emotion]}</span>
            </button>
          );
        })}
      </div>

      {voicesForActiveEmotion.length > 0 && (
        <div className="emo-voice-list">
          <label className="emo-voice-label">
            {voicesForActiveEmotion.length} voice{voicesForActiveEmotion.length !== 1 ? 's' : ''} available
          </label>
          {voicesForActiveEmotion.map((voice) => {
            const isSelected = selectedVoiceId === voice.$id;
            const isPreviewing = previewingId === voice.$id;
            return (
              <div
                key={voice.$id}
                className={`emo-voice-row ${isSelected ? 'selected' : ''}`}
                onClick={() => onSelectVoice(voice)}
              >
                <button
                  type="button"
                  className="emo-voice-preview-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    handlePreview(voice);
                  }}
                >
                  {isPreviewing ? '⏸' : '▶'}
                </button>
                <div className="emo-voice-info">
                  <div className="emo-voice-name">{voice.name}</div>
                  <div className="emo-voice-meta">{voice.gender} · {voice.language}</div>
                </div>
                {isSelected && <span className="emo-voice-check">✓</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
