import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Client, Functions, Databases, Storage, ID, Query, Account } from 'appwrite';

// 1. Inisialisasi Appwrite
// Ganti dengan Project ID dan Endpoint Anda
const client = new Client()
    .setEndpoint('https://fra.cloud.appwrite.io/v1')
    .setProject('6a3a48a1003d333b0268');

const appwriteFunctions = new Functions(client);
const databases = new Databases(client);
const storage = new Storage(client);
const account = new Account(client);
const FUNCTION_ID = '6a4bedd10009fe338821'; // Ganti dengan ID fungsi Replicate Anda

// 🗂️ Konfigurasi database & storage untuk fitur Voice Library dan Upload
// Rekaman -- SESUAIKAN nilai-nilai ini dengan project Appwrite Anda.
const DATABASE_ID = 'naratorai'; // ganti kalau database ID Anda beda
const SPEAKERS_COLLECTION_ID = 'speakers'; // collection yang sama dipakai app mobile
const USER_STATS_COLLECTION_ID = 'user_stats'; // collection quota yang sama dipakai app mobile
const MAX_FREE_GENERATIONS = 2; // sama persis limit di app mobile
// Bucket untuk upload hasil rekaman suara sebagai referensi speaker baru --
// WAJIB punya permission "Read: Any" di Appwrite Console, karena Replicate
// perlu bisa fetch URL file ini dari luar (public read, bukan cuma
// authenticated user Anda sendiri).
const RECORDING_UPLOAD_BUCKET_ID = '6a40a942000c72f7a8f1';

// 🎭 Deteksi nama speaker unik dari skrip dialog, urutan sesuai kemunculan
// pertama. Pattern regex ini SENGAJA disamakan persis dengan yang dipakai
// di predict.py & app mobile, supaya konsisten di semua platform. Nambah
// speaker baru cukup dengan menulis nama baru di skrip -- otomatis scale
// ke berapa pun yang terdeteksi, tidak dibatasi ke 2/3 speaker.
function parseSpeakersFromScript(script) {
  const names = [];
  const seen = new Set();
  const tagPattern = /^\[([^\]]+)\]:/;

  script.split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim();
    const match = line.match(tagPattern);
    if (match) {
      const name = match[1].trim();
      if (!seen.has(name)) {
        seen.add(name);
        names.push(name);
      }
    }
  });

  return names;
}

const TtsServer = () => {
  // --- State Management ---
  const [mode, setMode] = useState('single');
  const [language, setLanguage] = useState('id'); // Default bahasa Indonesia
  const [speed, setSpeed] = useState(1.0);
  const [temperature, setTemperature] = useState(0.7);
  const [outputFormat, setOutputFormat] = useState('wav');

  // 🎙️ Referensi speaker bisa dari 3 sumber: pilih dari library, ketik URL
  // manual, atau hasil upload rekaman. `voiceSource` nentuin mana yang
  // dipakai untuk generate -- library & custom TIDAK saling auto-isi,
  // biar custom URL murni manual sesuai request.
  const [customUrlText, setCustomUrlText] = useState('');
  const [voiceSource, setVoiceSource] = useState(''); // 'library' | 'custom' | ''

  // 🎵 Voice Library -- daftar speaker dari collection Appwrite yang sama
  // dipakai app mobile.
  const [voiceLibrary, setVoiceLibrary] = useState([]);
  const [selectedLibraryVoiceId, setSelectedLibraryVoiceId] = useState('');
  const [loadingLibrary, setLoadingLibrary] = useState(true);

  // 📤 Status upload rekaman ke Appwrite Storage
  const [isUploadingRecording, setIsUploadingRecording] = useState(false);
  // 📤 Status upload file .wav lokal yang dipilih user (fitur terpisah dari rekaman)
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  
  // Text Input
  const [text, setText] = useState('');
  const [dialogueScript, setDialogueScript] = useState('');

  // 🎭 Assignment voice per speaker di mode dialog -- key: nama speaker,
  // value: { source: 'library'|'custom', libraryId, customUrl }
  const [speakerAssignments, setSpeakerAssignments] = useState({});

  // Deteksi live nama-nama speaker dari skrip, dihitung ulang tiap skrip berubah
  const detectedSpeakerNames = useMemo(
    () => parseSpeakersFromScript(dialogueScript),
    [dialogueScript]
  );

  // Recording State
  const [isRecording, setIsRecording] = useState(false);
  const [recordedUrl, setRecordedUrl] = useState(null);
  const [recordedBlob, setRecordedBlob] = useState(null);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recordingTimerRef = useRef(null);
  const MAX_RECORDING_SECONDS = 30;

  // Execution State
  const [isLoading, setIsLoading] = useState(false);
  const [generatedAudio, setGeneratedAudio] = useState(null);

  // 🔒 Sistem quota -- reuse collection `user_stats` yang sama dipakai app
  // mobile. Web ini pakai Appwrite Anonymous Session supaya tetap ada
  // "userId" yang konsisten antar reload, tanpa perlu login manual.
  const [userId, setUserId] = useState(null);
  const [generationCount, setGenerationCount] = useState(0);
  const [statsDocId, setStatsDocId] = useState(null);
  const [checkingQuota, setCheckingQuota] = useState(true);
  const isLimitReached = generationCount >= MAX_FREE_GENERATIONS;

  // --- Restore/buat Anonymous Session + sync quota dari `user_stats` ---
  // Session anonymous dipakai supaya ada "userId" yang konsisten antar
  // reload browser (session-nya nyangkut di cookie), tanpa perlu bikin
  // sistem login. Reuse persis collection `user_stats` yang sudah dipakai
  // app mobile untuk quota generate.
  useEffect(() => {
    const initUserAndQuota = async () => {
      try {
        let currentUserId;
        try {
          const currentAccount = await account.get();
          currentUserId = currentAccount.$id;
        } catch (notLoggedInErr) {
          // Belum ada session -- buat anonymous session baru
          await account.createAnonymousSession();
          const newAccount = await account.get();
          currentUserId = newAccount.$id;
        }
        setUserId(currentUserId);

        // Cari dokumen user_stats untuk user ini
        const statsResponse = await databases.listDocuments(
          DATABASE_ID,
          USER_STATS_COLLECTION_ID,
          [Query.equal('user_id', currentUserId), Query.limit(1)]
        );

        if (statsResponse.documents.length > 0) {
          const doc = statsResponse.documents[0];
          setStatsDocId(doc.$id);
          setGenerationCount(doc.generation_count || 0);
        } else {
          // Belum ada dokumen quota untuk user ini -- buat baru dengan count 0
          const newDoc = await databases.createDocument(
            DATABASE_ID,
            USER_STATS_COLLECTION_ID,
            ID.unique(),
            { user_id: currentUserId, generation_count: 0, clone_count: 0 }
          );
          setStatsDocId(newDoc.$id);
          setGenerationCount(0);
        }
      } catch (err) {
        console.error('Failed to init user/quota:', err);
        // Kalau gagal (mis. collection belum ada), biarkan generationCount
        // tetap 0 -- user tetap bisa coba generate, cuma quota-nya nggak
        // ke-track dengan benar sampai masalahnya diperbaiki.
      } finally {
        setCheckingQuota(false);
      }
    };
    initUserAndQuota();
  }, []);

  // --- Ambil Voice Library dari Appwrite (collection yang sama dipakai app mobile) ---
  useEffect(() => {
    const fetchVoiceLibrary = async () => {
      try {
        // Query.limit default Appwrite cuma 25 dokumen -- kalau nggak
        // di-set eksplisit, cuma 25 speaker pertama yang kemuat walau
        // total speaker Anda 199. Naikin ke 500 biar semua kemuat aman.
        const response = await databases.listDocuments(
          DATABASE_ID,
          SPEAKERS_COLLECTION_ID,
          [Query.limit(500)]
        );
        setVoiceLibrary(response.documents);
      } catch (err) {
        console.error('Failed to retrieve voice library:', err);
        // Tidak alert ke user -- kalau library gagal load, "Custom Speaker
        // Audio URL" tetap bisa dipakai manual sebagai fallback.
      } finally {
        setLoadingLibrary(false);
      }
    };
    fetchVoiceLibrary();
  }, []);

  // Ketika user pilih voice dari dropdown library, nggak isi/sentuh
  // customUrlText sama sekali -- itu tetep murni manual. Cukup catat
  // sumbernya via voiceSource, URL asli-nya diambil ulang saat generate.
  const handleSelectLibraryVoice = (e) => {
    const voiceId = e.target.value;
    setSelectedLibraryVoiceId(voiceId);
    setVoiceSource(voiceId ? 'library' : '');
  };

  // Ambil URL audio dari voice library yang lagi dipilih (kalau ada)
  const getLibraryVoiceUrl = () => {
    const voice = voiceLibrary.find((v) => v.$id === selectedLibraryVoiceId);
    if (!voice) return '';
    return voice.sample_url || voice.audio_url || voice.voice_url || voice.value || '';
  };

  // 🎭 Ambil URL library dari sebuah ID (helper generik, dipakai untuk voice
  // utama maupun assignment per-speaker di mode dialog)
  const getLibraryUrlById = (libraryId) => {
    const voice = voiceLibrary.find((v) => v.$id === libraryId);
    if (!voice) return '';
    return voice.sample_url || voice.audio_url || voice.voice_url || voice.value || '';
  };

  // Assign voice untuk 1 speaker di mode dialog -- dari dropdown library
  const handleAssignSpeakerLibrary = (name, libraryId) => {
    setSpeakerAssignments((prev) => ({
      ...prev,
      [name]: { ...(prev[name] || {}), source: 'library', libraryId },
    }));
  };

  // Assign voice untuk 1 speaker di mode dialog -- dari ketik URL manual
  const handleAssignSpeakerCustomUrl = (name, url) => {
    setSpeakerAssignments((prev) => ({
      ...prev,
      [name]: { ...(prev[name] || {}), source: 'custom', customUrl: url },
    }));
  };

  // URL final yang dipakai untuk 1 speaker, sesuai source yang lagi aktif
  const getSpeakerVoiceUrl = (name) => {
    const assignment = speakerAssignments[name];
    if (!assignment) return '';
    if (assignment.source === 'library') {
      return getLibraryUrlById(assignment.libraryId);
    }
    return assignment.customUrl || '';
  };

  // --- Logic Perekam Suara (Voice Cloning Reference) ---
  const toggleRecording = async () => {
    if (isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      clearInterval(recordingTimerRef.current);
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
          clearInterval(recordingTimerRef.current);
        };

        recorder.start();
        setIsRecording(true);
        setRecordingSeconds(0);

        // ⏱️ Timer 1 detik + auto-stop di batas MAX_RECORDING_SECONDS (30s)
        // -- pakai functional update (prev => prev + 1) supaya closure-nya
        // selalu baca nilai terbaru, bukan nilai stale dari saat interval dibuat.
        recordingTimerRef.current = setInterval(() => {
          setRecordingSeconds((prev) => {
            const next = prev + 1;
            if (next >= MAX_RECORDING_SECONDS) {
              recorder.stop();
              setIsRecording(false);
              clearInterval(recordingTimerRef.current);
            }
            return next;
          });
        }, 1000);
      } catch (err) {
        console.error("Failed to access microphone:", err);
        alert("Ensure you grant microphone access permission..");
      }
    }
  };

  const discardRecording = () => {
    setRecordedBlob(null);
    setRecordedUrl(null);
  };

  const useRecordingAsReference = async () => {
    if (!recordedBlob) return;

    setIsUploadingRecording(true);
    try {
      // Browser MediaRecorder biasanya keluarin format webm, bukan wav --
      // dikasih nama .webm di sini apa adanya (jujur soal formatnya).
      // Kalau model Replicate Anda strict cuma nerima .wav, perlu convert
      // dulu di sisi Function (pakai ffmpeg) sebelum dipakai sebagai
      // speaker_wav -- untuk sekarang langsung dipakai apa adanya.
      const file = new File([recordedBlob], `recording-${Date.now()}.webm`, { type: 'audio/webm' });

      const uploadedFile = await storage.createFile(
        RECORDING_UPLOAD_BUCKET_ID,
        ID.unique(),
        file
      );

      // Bangun URL publik file ini -- format standar Appwrite Storage view URL.
      const fileUrl = `https://fra.cloud.appwrite.io/v1/storage/buckets/${RECORDING_UPLOAD_BUCKET_ID}/files/${uploadedFile.$id}/view?project=6a3a48a1003d333b0268`;

      // Rekaman diperlakukan sebagai "custom URL" (bukan bagian dari
      // library) -- isi customUrlText & set source-nya ke 'custom'.
      setCustomUrlText(fileUrl);
      setVoiceSource('custom');
      setSelectedLibraryVoiceId(''); // reset visual dropdown library
      alert('The recording was successfully uploaded and immediately used as a voice reference.!');
    } catch (err) {
      console.error('Failed to upload recording:', err);
      alert('Failed to upload recording: ' + err.message);
    } finally {
      setIsUploadingRecording(false);
    }
  };

  // --- Pilih file .wav dari komputer lokal ---
  // Path lokal (mis. /Users/nama/voice.wav) TIDAK bisa langsung dipakai
  // sebagai speaker_wav karena Replicate cuma bisa fetch URL publik lewat
  // internet, bukan baca file dari komputer Anda. Jadi begitu user pilih
  // file, langsung di-upload ke Appwrite Storage (bucket yang sama dengan
  // rekaman), dan URL hasil upload itu yang dipakai -- bukan path lokalnya.
  const handleLocalFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.wav')) {
      alert('Please select a .wav file.');
      e.target.value = ''; // reset input biar bisa pilih ulang
      return;
    }

    setIsUploadingFile(true);
    try {
      const uploadedFile = await storage.createFile(
        RECORDING_UPLOAD_BUCKET_ID,
        ID.unique(),
        file
      );

      const fileUrl = `https://fra.cloud.appwrite.io/v1/storage/buckets/${RECORDING_UPLOAD_BUCKET_ID}/files/${uploadedFile.$id}/view?project=6a3a48a1003d333b0268`;

      setCustomUrlText(fileUrl);
      setVoiceSource('custom');
      setSelectedLibraryVoiceId('');
      alert(`"${file.name}" uploaded successfully and is now used as the voice reference!`);
    } catch (err) {
      console.error('Failed to upload local file:', err);
      alert('Failed to upload file: ' + err.message);
    } finally {
      setIsUploadingFile(false);
      e.target.value = ''; // reset input, biar bisa pilih file yang sama lagi kalau perlu
    }
  };

  // --- Logic Eksekusi ke Appwrite Function ---
  const handleGenerateSpeech = async (e) => {
    e.preventDefault();
    if (isLimitReached) {
      return alert('You have reached the free generation limit. Please upgrade to continue.');
    }
    if (mode === 'single' && !text) return alert("Teks tidak boleh kosong!");
    if (mode === 'dialogue' && !dialogueScript) return alert("Dialogue script tidak boleh kosong!");

    // Siapkan payload spesifik per mode SEBELUM setIsLoading(true), supaya
    // validasi yang gagal (speaker belum lengkap, dll) tidak sempat
    // nge-lock tombol generate.
    let payload;

    if (mode === 'dialogue') {
      if (detectedSpeakerNames.length === 0) {
        return alert('No speakers detected. Use the format [Name]: text... for each line.');
      }
      const missing = detectedSpeakerNames.filter((name) => !getSpeakerVoiceUrl(name));
      if (missing.length > 0) {
        return alert(`Please assign a voice for: ${missing.join(', ')}`);
      }

      const speakerMap = {};
      detectedSpeakerNames.forEach((name) => {
        speakerMap[name] = getSpeakerVoiceUrl(name);
      });

      payload = {
        mode,
        text: dialogueScript,
        speaker_map: speakerMap,
        language,
        speed: parseFloat(speed),
        temperature: parseFloat(temperature),
        output_format: outputFormat,
      };
    } else {
      // Tentukan URL speaker final berdasarkan sumber yang lagi aktif --
      // library dan custom URL sengaja TIDAK saling override otomatis,
      // voiceSource yang nentuin mana yang beneran dipakai untuk generate.
      const finalSpeakerWavUrl =
        voiceSource === 'library' ? getLibraryVoiceUrl() : customUrlText;

      if (!finalSpeakerWavUrl) {
        return alert('Please select a voice from the library, enter a custom URL, or record your voice first.');
      }

      payload = {
        mode,
        text,
        speaker_wav: finalSpeakerWavUrl,
        language,
        speed: parseFloat(speed),
        temperature: parseFloat(temperature),
        output_format: outputFormat,
      };
    }

    setIsLoading(true);
    setGeneratedAudio(null);

    try {

      // ⏱️ PENTING: eksekusi SYNCHRONOUS (async: false, default) di Appwrite
      // punya hard-cap 30 detik dari sisi API gateway-nya sendiri -- ini
      // TIDAK bisa diubah lewat setting "Timeout" di halaman Function.
      // Generate audio (apalagi dengan cold start container Replicate)
      // hampir pasti lebih dari 30 detik, jadi WAJIB pakai async: true di
      // sini, lalu polling status eksekusi secara manual sampai selesai.
      const execution = await appwriteFunctions.createExecution({
        functionId: FUNCTION_ID,
        body: JSON.stringify(payload),
        async: true,
        method: 'POST',
      });

      let currentExecution = execution;
      while (
        currentExecution.status !== 'completed' &&
        currentExecution.status !== 'failed'
      ) {
        console.log('Execution status:', currentExecution.status);
        await new Promise((resolve) => setTimeout(resolve, 3000));
        currentExecution = await appwriteFunctions.getExecution(FUNCTION_ID, execution.$id);
      }

      if (currentExecution.status === 'failed') {
        throw new Error('Function execution failed. Check Appwrite Console logs for details.');
      }

      const data = JSON.parse(currentExecution.responseBody);

      if (data.success && data.audioUrl) {
        setGeneratedAudio(data.audioUrl);

        // Increment generation_count di user_stats -- dilakukan setelah
        // sukses, bukan sebelum, biar percobaan yang gagal nggak ikut
        // makan quota gratis user.
        if (statsDocId) {
          try {
            const newCount = generationCount + 1;
            await databases.updateDocument(
              DATABASE_ID,
              USER_STATS_COLLECTION_ID,
              statsDocId,
              { generation_count: newCount }
            );
            setGenerationCount(newCount);
          } catch (quotaErr) {
            console.error('Failed to update generation count:', quotaErr);
          }
        }
      } else {
        throw new Error(data.error || "Failed to generate audio from Source.");
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
            <label>🎵 Select Voice from Library:</label><br/>
            <select
              value={selectedLibraryVoiceId}
              onChange={handleSelectLibraryVoice}
              disabled={loadingLibrary}
              style={{ width: '100%', padding: '8px' }}
            >
              <option value="">
                {loadingLibrary ? '-- Loading voices... --' : '-- Select a voice from library --'}
              </option>
              {voiceLibrary.map((voice) => (
                <option key={voice.$id} value={voice.$id}>
                  {voice.name || voice.label || voice.$id}
                </option>
              ))}
            </select>
            <small>Choose a saved voice from your library.</small>
          </div>

          <div style={{ textAlign: 'center', color: '#999', margin: '10px 0' }}>OR</div>

          <div style={{ marginBottom: '15px' }}>
            <label>🔗 Custom Speaker Audio URL (Voice Clone):</label>
            <input 
              type="text" 
              value={customUrlText} 
              onChange={(e) => {
                setCustomUrlText(e.target.value);
                setVoiceSource('custom');
              }}
              placeholder="https://example.com/voice.wav or /path/to/file.wav" 
              style={{ width: '100%', padding: '8px', boxSizing: 'border-box' }}
            />
            <small>Supports .WAV only.</small>
          </div>

          <div style={{ marginBottom: '15px' }}>
            <label>📁 Or Select File from Computer:</label><br/>
            <input
              type="file"
              accept=".wav,audio/wav"
              onChange={handleLocalFileSelect}
              disabled={isUploadingFile}
              style={{ width: '100%', padding: '8px', backgroundColor: 'white', border: '1px solid #ccc', borderRadius: '4px' }}
            />
            {isUploadingFile && <small>⏳ Uploading file...</small>}
            <br/>
            <small>Picks a .wav file from your computer, uploads it automatically, and uses it as the voice reference.</small>
          </div>

          <div style={{ marginBottom: '15px' }}>
             <label>🎙️ Record Your Voice:</label><br/>
             <button onClick={toggleRecording} style={{ padding: '8px', backgroundColor: isRecording ? '#d9363e' : '#e0e0e0', color: isRecording ? 'white' : 'black' }}>
                {isRecording ? "⏹️ Stop Recording" : "⏺️ Start Recording"}
             </button>
             {isRecording && (
               <span style={{ marginLeft: '10px', fontWeight: 'bold', color: recordingSeconds >= MAX_RECORDING_SECONDS - 5 ? '#d9363e' : '#333' }}>
                 {String(Math.floor(recordingSeconds / 60)).padStart(2, '0')}:{String(recordingSeconds % 60).padStart(2, '0')} / 00:{MAX_RECORDING_SECONDS}
               </span>
             )}
             <br/>
             <small>Maximum {MAX_RECORDING_SECONDS} seconds per recording -- will stop automatically.</small>
             
             {recordedUrl && (
               <div style={{ marginTop: '10px' }}>
                 <audio src={recordedUrl} controls style={{ width: '100%' }} />
                 <div style={{ display: 'flex', gap: '10px', marginTop: '5px' }}>
                   <button onClick={useRecordingAsReference} disabled={isUploadingRecording}>
                     {isUploadingRecording ? '⏳ Uploading...' : '✅ Use Reference'}
                   </button>
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
                  placeholder="Type or Paste your text here, wait until magic come...."
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
                  placeholder="[Adam]: I just finished testing that new mobile app Narator AI for my latest video project, and I am honestly blown away.&#10;[Anna]: Oh really? I have been skeptical about AI voices for a long time. Are they finally sounding natural?"
                />

                {/* 🎭 Kartu assignment voice, muncul otomatis begitu ada
                    nama speaker terdeteksi dari skrip -- reuse voiceLibrary
                    yang sama dengan mode single-voice. */}
                {detectedSpeakerNames.length > 0 && (
                  <div style={{ marginTop: '15px', padding: '15px', backgroundColor: '#f0f8ff', border: '1px solid #cce4ff', borderRadius: '8px' }}>
                    <label style={{ fontWeight: 'bold' }}>🎭 Assign Voice per Speaker:</label>
                    {detectedSpeakerNames.map((name) => {
                      const assignment = speakerAssignments[name] || {};
                      const hasVoice = !!getSpeakerVoiceUrl(name);
                      return (
                        <div
                          key={name}
                          style={{
                            marginTop: '10px',
                            padding: '10px',
                            backgroundColor: 'white',
                            borderRadius: '6px',
                            border: hasVoice ? '1px solid #28a745' : '1px solid #ddd',
                          }}
                        >
                          <strong>🎤 {name}</strong> {hasVoice && <span style={{ color: '#28a745', fontSize: '12px' }}>✓ assigned</span>}
                          <select
                            value={assignment.source === 'library' ? assignment.libraryId || '' : ''}
                            onChange={(e) => handleAssignSpeakerLibrary(name, e.target.value)}
                            style={{ width: '100%', padding: '6px', marginTop: '6px' }}
                          >
                            <option value="">-- Select from library --</option>
                            {voiceLibrary.map((voice) => (
                              <option key={voice.$id} value={voice.$id}>
                                {voice.name || voice.label || voice.$id}
                              </option>
                            ))}
                          </select>
                          <input
                            type="text"
                            placeholder="Or paste a custom voice URL..."
                            value={assignment.source === 'custom' ? assignment.customUrl || '' : ''}
                            onChange={(e) => handleAssignSpeakerCustomUrl(name, e.target.value)}
                            style={{ width: '100%', padding: '6px', marginTop: '6px', boxSizing: 'border-box' }}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <button 
              type="submit" 
              disabled={isLoading || checkingQuota}
              style={{
                padding: '12px 24px',
                backgroundColor: isLimitReached ? '#9D4EDD' : '#28a745',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                marginTop: '15px',
                cursor: 'pointer',
                fontSize: '16px',
              }}
            >
              {checkingQuota
                ? '⏳ Checking quota...'
                : isLoading
                ? '⏳ Generating Audio...'
                : isLimitReached
                ? '⭐ Upgrade to Pro'
                : '🎵 Generate Speech'}
            </button>
            {!checkingQuota && !isLimitReached && (
              <small style={{ display: 'block', marginTop: '6px', color: '#666' }}>
                {generationCount} / {MAX_FREE_GENERATIONS} free generations used
              </small>
            )}
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
