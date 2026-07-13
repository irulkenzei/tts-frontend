import { useState, useEffect, useRef } from 'react';
import { databases, storage, Query, DATABASE_ID, VOICE_LISTINGS_COLLECTION_ID, RECORDING_UPLOAD_BUCKET_ID } from './appwriteConfig';
import './PublicVoiceListings.css';

function ListingCard({ listing }) {
  const audioRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [shareStatus, setShareStatus] = useState('');

  const audioUrl = storage.getFileView(RECORDING_UPLOAD_BUCKET_ID, listing.audio_file_id).toString();

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
  };

  const handleShare = async () => {
    const shareData = {
      title: listing.title,
      text: listing.quote_text || listing.title,
      url: audioUrl,
    };
    // 📤 Web Share API -- native share sheet di mobile/browser yang support.
    // Fallback: copy link ke clipboard buat browser desktop yang gak
    // support navigator.share (Firefox desktop, browser lama, dst).
    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch {
        // user cancel share sheet -- gak perlu ditampilin sebagai error
      }
    } else {
      try {
        await navigator.clipboard.writeText(audioUrl);
        setShareStatus('Link copied!');
        setTimeout(() => setShareStatus(''), 2000);
      } catch {
        setShareStatus('Could not copy link.');
        setTimeout(() => setShareStatus(''), 2000);
      }
    }
  };

  return (
    <div className="voice-card">
      {!!listing.quote_text && <p className="voice-card-quote">&ldquo;{listing.quote_text}&rdquo;</p>}
      <div className="voice-card-footer">
        <div className="voice-card-title-row">
          <button className="voice-play-btn" onClick={togglePlay} aria-label={isPlaying ? 'Pause' : 'Play'}>
            {isPlaying ? (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="2" width="4" height="12" rx="1" /><rect x="9" y="2" width="4" height="12" rx="1" /></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M4 2.5v11l10-5.5-10-5.5z" /></svg>
            )}
          </button>
          <strong>{listing.title}</strong>
        </div>
        <button className="voice-share-btn" onClick={handleShare}>
          {shareStatus || 'Share'}
        </button>
      </div>
      <audio
        ref={audioRef}
        src={audioUrl}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
        style={{ display: 'none' }}
      />
    </div>
  );
}

export default function PublicVoiceListings() {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await databases.listDocuments(DATABASE_ID, VOICE_LISTINGS_COLLECTION_ID, [
          Query.orderDesc('$createdAt'),
          Query.limit(50),
        ]);
        setListings(res.documents);
      } catch (e) {
        console.error('Failed to load voice listings:', e);
        setError('Could not load voice listings right now. Please try again later.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="voices-shell">
      <header className="voices-header">
        <h1>Voice Listings</h1>
        <p>A showcase of voiceovers narrated by Narator AI.</p>
      </header>

      {loading ? (
        <p className="voices-loading">Loading voices…</p>
      ) : error ? (
        <p className="voices-error">{error}</p>
      ) : listings.length === 0 ? (
        <p className="voices-empty">No voices published yet. Check back soon.</p>
      ) : (
        <div className="voices-grid">
          {listings.map((listing) => (
            <ListingCard key={listing.$id} listing={listing} />
          ))}
        </div>
      )}
    </div>
  );
}
