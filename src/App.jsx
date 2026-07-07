import React, { useState, useRef } from 'react';
import { Client, Functions } from 'appwrite';

// 1. Inisialisasi Appwrite
// Ganti dengan Project ID dan Endpoint Anda
const client = new Client()
    .setEndpoint('https://fra.cloud.appwrite.io/v1')
    .setProject('6a3a48a1003d333b0268');

const appwriteFunctions = new Functions(client);
const FUNCTION_ID = '6a4bedd10009fe338821'; // Ganti dengan ID fungsi Replicate Anda

const TtsServer = () => {
  // --- State Management ---
  const [mode, setMode] = useState('single');
  const [language, setLanguage] = useState('id'); // Default bahasa Indonesia
  const [speakerWavUrl, setSpeakerWavUrl] = useState('');
  const [speed, setSpeed] = useState(1.0);
  const [temperature, setTemperature] = useState(0.7);
  const [outputFormat, setOutputFormat] = useState('wav');
  
  // Text Input
  const [text, setText] = useState('');
  const [dialogueScript, setDialogueScript] = useState('');

  // Recording State
  const [isRecording, setIsRecording] = useState(false);
  const [recordedUrl, setRecordedUrl] = useState(null);
  const [recordedBlob, setRecordedBlob] = useState(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  // Execution State
  const [isLoading, setIsLoading] = useState(false);
  const [generatedAudio, setGeneratedAudio] = useState(null);

  // --- Logic Perekam Suara (Voice Cloning Reference) ---
  const toggleRecording = async () => {
    if (isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const recorder = new MediaRecorder(stream);
        mediaRecorderRef.current = recorder;
        audioChunksRef.current = [];

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) audioChunksRef.current.push(e.data);
        };

        recorder.onstop = () => {
          const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          setRecordedBlob(blob);
          setRecordedUrl(URL.createObjectURL(blob));
          stream.getTracks().forEach(track => track.stop()); // Matikan mic
        };

        recorder.start();
        setIsRecording(true);
      } catch (err) {
        console.error("Gagal akses mikrofon:", err);
        alert("Pastikan Anda memberikan izin akses mikrofon.");
      }
    }
  };

  const discardRecording = () => {
    setRecordedBlob(null);
    setRecordedUrl(null);
  };

  const useRecordingAsReference = async () => {
    if (!recordedBlob) return;
    
    alert("Untuk menggunakan fitur ini, Anda perlu membuat fungsi upload ke Appwrite Storage Bucket terlebih dahulu, lalu mengambil URL file .wav tersebut dan memasukkannya ke state speakerWavUrl.");
    // Logika masa depan:
    // 1. Upload recordedBlob ke Appwrite Storage
    // 2. Dapatkan file URL
    // 3. setSpeakerWavUrl(fileUrl)
  };

  // --- Logic Eksekusi ke Appwrite Function ---
  const handleGenerateSpeech = async (e) => {
    e.preventDefault();
    if (!text && mode === 'single') return alert("Teks tidak boleh kosong!");

    setIsLoading(true);
    setGeneratedAudio(null);

    try {
      // Payload ini akan dikirim ke fungsi Node.js di Appwrite
      const payload = {
        mode,
        text: mode === 'single' ? text : dialogueScript,
        language,
        speed: parseFloat(speed),
        temperature: parseFloat(temperature),
        output_format: outputFormat,
        speaker_wav: speakerWavUrl // URL referensi suara untuk cloning
      };

      const result = await appwriteFunctions.createExecution(
        FUNCTION_ID,
        JSON.stringify(payload)
      );

      const data = JSON.parse(result.responseBody);

      if (data.success && data.audioUrl) {
        setGeneratedAudio(data.audioUrl);
      } else {
        throw new Error(data.error || "Gagal menghasilkan audio dari Replicate.");
      }
    } catch (err) {
      console.error(err);
      alert("Error: " + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // --- UI Render ---
  return (
    <div style={{ fontFamily: 'sans-serif', maxWidth: '1000px', margin: '0 auto', padding: '20px' }}>
      <h1>🎙️ Simple TTS Server (React)</h1>
      
      <div style={{ display: 'flex', gap: '30px', marginTop: '20px' }}>
        
        {/* SIDEBAR - Pengaturan */}
        <div style={{ flex: '1', backgroundColor: '#f5f5f5', padding: '20px', borderRadius: '8px' }}>
          <h2>🗣️ Selection:</h2>
          
          <div style={{ marginBottom: '15px' }}>
            <label>Language:</label><br/>
            <select value={language} onChange={(e) => setLanguage(e.target.value)} style={{ width: '100%', padding: '8px' }}>
                    <option value="en">English</option>
                    <option value="es">Spanish</option>
                    <option value="fr">French</option>
                    <option value="de">German</option>
                    <option value="it">Italian</option>
                    <option value="pt">Portuguese</option>
                    <option value="pl">Polish</option>
                    <option value="tr">Turkish</option>
                    <option value="ru">Russian</option>
                    <option value="nl">Dutch</option>
                    <option value="cs">Czech</option>
                    <option value="ar">Arabic</option>
                    <option value="zh-cn">Chinese</option>
                    <option value="ja">Japanese</option>
                    <option value="hu">Hungarian</option>
                    <option value="ko">Korean</option>
                    <option value="hi">Hindi</option> 
            </select>
          </div>

          <hr style={{ margin: '20px 0' }} />

          <div style={{ marginBottom: '15px' }}>
            <label>🔗 Custom Speaker Audio URL (Voice Clone):</label>
            <input 
              type="text" 
              value={speakerWavUrl} 
              onChange={(e) => setSpeakerWavUrl(e.target.value)}
              placeholder="https://example.com/voice.wav" 
              style={{ width: '100%', padding: '8px', boxSizing: 'border-box' }}
            />
            <small>Supports .WAV only.</small>
          </div>

          <div style={{ marginBottom: '15px' }}>
             <label>🎙️ Record Your Voice:</label><br/>
             <button onClick={toggleRecording} style={{ padding: '8px', backgroundColor: isRecording ? '#d9363e' : '#e0e0e0', color: isRecording ? 'white' : 'black' }}>
                {isRecording ? "⏹️ Stop Recording" : "⏺️ Start Recording"}
             </button>
             
             {recordedUrl && (
               <div style={{ marginTop: '10px' }}>
                 <audio src={recordedUrl} controls style={{ width: '100%' }} />
                 <div style={{ display: 'flex', gap: '10px', marginTop: '5px' }}>
                   <button onClick={useRecordingAsReference}>✅ Use Reference</button>
                   <button onClick={discardRecording}>🗑️ Discard</button>
                 </div>
               </div>
             )}
          </div>

          <hr style={{ margin: '20px 0' }} />

          <div style={{ marginBottom: '15px' }}>
             <label>⚡ Speed: {speed}</label>
             <input type="range" min="0.5" max="2.0" step="0.05" value={speed} onChange={(e) => setSpeed(e.target.value)} style={{ width: '100%' }}/>
          </div>

          <div style={{ marginBottom: '15px' }}>
             <label>🎭 Expressiveness (Temp): {temperature}</label>
             <input type="range" min="0.1" max="1.0" step="0.05" value={temperature} onChange={(e) => setTemperature(e.target.value)} style={{ width: '100%' }}/>
          </div>
          
          <div>
            <label>💾 Format:</label>
            <select value={outputFormat} onChange={(e) => setOutputFormat(e.target.value)} style={{ width: '100%', padding: '8px' }}>
              <option value="wav">WAV</option>
              <option value="mp3">MP3</option>
              <option value="ogg">OGG</option>
              <option value="flac">FLAC</option>
              <option value="m4a">M4A</option>
            </select>
          </div>
        </div>

        {/* MAIN CONTENT - Input Teks & Hasil */}
        <div style={{ flex: '2' }}>
          <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
             <button 
                onClick={() => setMode('single')}
                style={{ padding: '10px', backgroundColor: mode === 'single' ? '#00C2FF' : '#f5f5f5', color: mode === 'single' ? 'white' : 'black', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
             >
                🎙️ Single Voice
             </button>
             <button 
                onClick={() => setMode('dialogue')}
                style={{ padding: '10px', backgroundColor: mode === 'dialogue' ? '#00C2FF' : '#f5f5f5', color: mode === 'dialogue' ? 'white' : 'black', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
             >
                🎭 Dialogue Mode
             </button>
          </div>

          <form onSubmit={handleGenerateSpeech}>
            {mode === 'single' ? (
              <div>
                <label>Text to Synthesize:</label>
                <textarea 
                  value={text} 
                  onChange={(e) => setText(e.target.value)}
                  rows="8" 
                  style={{ width: '100%', padding: '10px', boxSizing: 'border-box', marginTop: '5px' }}
                  placeholder="Masukkan naskah voice over Anda di sini..."
                />
              </div>
            ) : (
              <div>
                <label>Dialogue Script:</label>
                <textarea 
                  value={dialogueScript} 
                  onChange={(e) => setDialogueScript(e.target.value)}
                  rows="8" 
                  style={{ width: '100%', padding: '10px', boxSizing: 'border-box', marginTop: '5px' }}
                  placeholder="[Speaker 1]: Halo...&#10;[Speaker 2]: Hai..."
                />
              </div>
            )}

            <button 
              type="submit" 
              disabled={isLoading}
              style={{ padding: '12px 24px', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '4px', marginTop: '15px', cursor: 'pointer', fontSize: '16px' }}
            >
              {isLoading ? '⏳ Generating Audio...' : '🎵 Generate Speech'}
            </button>
          </form>

          {/* Area Hasil Audio */}
          {generatedAudio && (
            <div style={{ marginTop: '30px', padding: '20px', backgroundColor: '#e9f7ef', border: '1px solid #c3e6cb', borderRadius: '8px' }}>
              <h3>✅ Audio Siap!</h3>
              <audio src={generatedAudio} controls autoPlay style={{ width: '100%', marginTop: '10px' }} />
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

export default TtsServer;
