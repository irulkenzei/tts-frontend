import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Client, Functions, Databases, Storage, ID, Query, Account } from 'appwrite';

// 1. Inisialisasi Appwrite
// Ganti dengan Project ID dan Endpoint Anda
const APPWRITE_ENDPOINT = 'https://fra.cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = '6a3a48a1003d333b0268';

const client = new Client()
    .setEndpoint(APPWRITE_ENDPOINT)
    .setProject(APPWRITE_PROJECT_ID);

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
// 🧬 Collection TERPISAH dari `speakers` (yang dipakai app mobile) --
// khusus nampung voice hasil clone dari web, per-user (filter by user_id).
const WEB_SPEAKERS_COLLECTION_ID = 'web_speakers';
// 🆕 Collection buat nampung hasil generate dari eksekusi ASYNC -- karena
// Appwrite nggak pernah nyimpen responseBody eksekusi async, Function nulis
// hasilnya ke sini, dan kita polling ke sini (bukan ke status eksekusi).
const JOBS_COLLECTION_ID = 'web_generation_jobs';
const MAX_FREE_GENERATIONS = 2; // sama persis limit di app mobile
const MAX_FREE_CLONES = 2; // limit gratis clone voice, sama kayak generate
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
  if (!script || typeof script !== 'string') return [];
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
  const [language, setLanguage] = useState('en');
  const [speed, setSpeed] = useState(1.0);
  const [temperature, setTemperature] = useState(0.7);

  // ⚙️ Settings tambahan -- dulu cuma ada di Replicate Playground, sekarang
  // dipindah semua ke sini (Speed, Temperature, Comma/Period Pause), diakses
  // lewat modal Settings (ikon gear), bukan lagi tersebar di sidebar.
  const [commaPauseMs, setCommaPauseMs] = useState(300);
  const [periodPauseMs, setPeriodPauseMs] = useState(600);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [outputFormat, setOutputFormat] = useState('wav');

  const [customUrlText, setCustomUrlText] = useState('');
  const [voiceSource, setVoiceSource] = useState(''); 

  const [voiceLibrary, setVoiceLibrary] = useState([]);
  const [selectedLibraryVoiceId, setSelectedLibraryVoiceId] = useState('');
  const [loadingLibrary, setLoadingLibrary] = useState(true);

  const [isUploadingRecording, setIsUploadingRecording] = useState(false);
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  
  // Text Input & Refs untuk UI Baru
  const [text, setText] = useState('');
  const [dialogueScript, setDialogueScript] = useState('');
  const textRef = useRef(null);
  const dialogueRef = useRef(null);
  const MAX_CHARS = 3000;

  const [speakerAssignments, setSpeakerAssignments] = useState({});
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
  const [generatedFileName, setGeneratedFileName] = useState(null);
  const [generatedAudioBlob, setGeneratedAudioBlob] = useState(null);

  const [elapsedMs, setElapsedMs] = useState(0);
  const [finalProcessTime, setFinalProcessTime] = useState(null);
  const timerIntervalRef = useRef(null);
  const timerStartRef = useRef(null);

  const [isLiked, setIsLiked] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);
  const showToast = (message, durationMs = 3500) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(null), durationMs);
  };
  const [currentJobId, setCurrentJobId] = useState(null);

  // 🎵 Background music + auto-ducking -- opsional, kalau diisi otomatis
  // diikutsertakan sebagai parameter tambahan ke Replicate (background_music,
  // music_volume_db). Lihat predict.py untuk logic ducking-nya (ffmpeg
  // sidechaincompress). Pola upload-nya sama seperti fitur upload file
  // lokal (.wav) yang sudah ada.
  const [backgroundMusicUrl, setBackgroundMusicUrl] = useState(null);
  const [backgroundMusicName, setBackgroundMusicName] = useState(null);
  const [musicVolumeDb, setMusicVolumeDb] = useState(-6);
  const [isUploadingMusic, setIsUploadingMusic] = useState(false);

  const formatDuration = (ms) => {
    const totalCentiseconds = Math.floor(ms / 10);
    const minutes = Math.floor(totalCentiseconds / 6000);
    const seconds = Math.floor((totalCentiseconds % 6000) / 100);
    const centiseconds = totalCentiseconds % 100;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`;
  };

  // User & Quota State
  const [userId, setUserId] = useState(null);
  const [generationCount, setGenerationCount] = useState(0);
  const [statsDocId, setStatsDocId] = useState(null);
  const [checkingQuota, setCheckingQuota] = useState(true);
  const isLimitReached = generationCount >= MAX_FREE_GENERATIONS;

  // Clone Voice State
  const [cloneCount, setCloneCount] = useState(0);
  const [cloneVoiceName, setCloneVoiceName] = useState('');
  const [isCloningVoice, setIsCloningVoice] = useState(false);
  const [myClonedVoices, setMyClonedVoices] = useState([]);
  const [selectedClonedVoiceId, setSelectedClonedVoiceId] = useState('');
  const isCloneLimitReached = cloneCount >= MAX_FREE_CLONES;

  // --- Effects (Diambil utuh dari kode asli Anda) ---
  useEffect(() => {
    const initUserAndQuota = async () => {
      try {
        let currentUserId;
        try {
          const currentAccount = await account.get();
          currentUserId = currentAccount.$id;
        } catch (notLoggedInErr) {
          await account.createAnonymousSession();
          const newAccount = await account.get();
          currentUserId = newAccount.$id;
        }
        setUserId(currentUserId);

        const statsResponse = await databases.listDocuments(
          DATABASE_ID,
          USER_STATS_COLLECTION_ID,
          [Query.equal('user_id', currentUserId), Query.limit(1)]
        );

        if (statsResponse.documents.length > 0) {
          const doc = statsResponse.documents[0];
          setStatsDocId(doc.$id);
          setGenerationCount(doc.generation_count || 0);
          setCloneCount(doc.clone_count || 0);
        } else {
          const newDoc = await databases.createDocument(
            DATABASE_ID,
            USER_STATS_COLLECTION_ID,
            ID.unique(),
            { user_id: currentUserId, generation_count: 0 }
          );
          setStatsDocId(newDoc.$id);
          setGenerationCount(0);
          setCloneCount(0);
        }
      } catch (err) {
        console.error('Failed to init user/quota:', err);
      } finally {
        setCheckingQuota(false);
      }
    };
    initUserAndQuota();
  }, []);

  useEffect(() => {
    if (!userId) return;
    const fetchMyClonedVoices = async () => {
      try {
        const response = await databases.listDocuments(
          DATABASE_ID,
          WEB_SPEAKERS_COLLECTION_ID,
          [Query.equal('user_id', userId), Query.limit(100)]
        );
        setMyClonedVoices(response.documents);
      } catch (err) {
        console.error('Failed to fetch my cloned voices:', err);
      }
    };
    fetchMyClonedVoices();
  }, [userId]);

  useEffect(() => {
    const fetchVoiceLibrary = async () => {
      try {
        const response = await databases.listDocuments(
          DATABASE_ID,
          SPEAKERS_COLLECTION_ID,
          [Query.limit(500)]
        );
        setVoiceLibrary(response.documents);
      } catch (err) {
        console.error('Failed to retrieve voice library:', err);
      } finally {
        setLoadingLibrary(false);
      }
    };
    fetchVoiceLibrary();
  }, []);

  // --- Handlers ---
  const handleSelectLibraryVoice = (e) => {
    const voiceId = e.target.value;
    setSelectedLibraryVoiceId(voiceId);
    setVoiceSource(voiceId ? 'library' : '');
  };

  const getLibraryVoiceUrl = () => {
    const voice = voiceLibrary.find((v) => v.$id === selectedLibraryVoiceId);
    if (!voice) return '';
    return voice.sample_url || voice.audio_url || voice.voice_url || voice.value || '';
  };

  const getLibraryUrlById = (libraryId) => {
    const voice = voiceLibrary.find((v) => v.$id === libraryId);
    if (!voice) return '';
    return voice.sample_url || voice.audio_url || voice.voice_url || voice.value || '';
  };

  const handleAssignSpeakerLibrary = (name, libraryId) => {
    setSpeakerAssignments((prev) => ({
      ...prev,
      [name]: { ...(prev[name] || {}), source: 'library', libraryId },
    }));
  };

  const handleAssignSpeakerCustomUrl = (name, url) => {
    setSpeakerAssignments((prev) => ({
      ...prev,
      [name]: { ...(prev[name] || {}), source: 'custom', customUrl: url },
    }));
  };

  const getSpeakerVoiceUrl = (name) => {
    const assignment = speakerAssignments[name];
    if (!assignment) return '';
    if (assignment.source === 'library') {
      return getLibraryUrlById(assignment.libraryId);
    }
    return assignment.customUrl || '';
  };

  // --- Logic Perekam Suara ---
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
          stream.getTracks().forEach(track => track.stop()); 
          clearInterval(recordingTimerRef.current);
        };

        recorder.start();
        setIsRecording(true);
        setRecordingSeconds(0);

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
      const file = new File([recordedBlob], `web-recording-${Date.now()}.webm`, { type: 'audio/webm' });
      const uploadedFile = await storage.createFile(
        RECORDING_UPLOAD_BUCKET_ID,
        ID.unique(),
        file
      );
      const fileUrl = `https://fra.cloud.appwrite.io/v1/storage/buckets/${RECORDING_UPLOAD_BUCKET_ID}/files/${uploadedFile.$id}/view?project=6a3a48a1003d333b0268`;
      
      setCustomUrlText(fileUrl);
      setVoiceSource('custom');
      setSelectedLibraryVoiceId(''); 
      alert('The recording was successfully uploaded and immediately used as a voice reference.!');
    } catch (err) {
      console.error('Failed to upload recording:', err);
      alert('Failed to upload recording: ' + err.message);
    } finally {
      setIsUploadingRecording(false);
    }
  };

  const handleCloneVoice = async () => {
    if (isCloneLimitReached) {
      alert('You have reached the free voice clone limit. Please upgrade to continue.');
      return;
    }
    if (!recordedBlob) {
      alert('Please record your voice first before cloning.');
      return;
    }
    if (!cloneVoiceName.trim()) {
      alert('Please enter a name for this voice.');
      return;
    }
    if (!userId) {
      alert('Could not verify your account. Please reload the page.');
      return;
    }

    setIsCloningVoice(true);
    try {
      const file = new File([recordedBlob], `web-clone-${Date.now()}.webm`, { type: 'audio/webm' });
      const uploadedFile = await storage.createFile(
        RECORDING_UPLOAD_BUCKET_ID,
        ID.unique(),
        file
      );

      const fileUrl = `https://fra.cloud.appwrite.io/v1/storage/buckets/${RECORDING_UPLOAD_BUCKET_ID}/files/${uploadedFile.$id}/view?project=6a3a48a1003d333b0268`;

      await databases.createDocument(
        DATABASE_ID,
        WEB_SPEAKERS_COLLECTION_ID,
        ID.unique(),
        {
          user_id: userId,
          name: cloneVoiceName.trim().substring(0, 255),
          sample_url: fileUrl,
        }
      );

      if (statsDocId) {
        const newCloneCount = cloneCount + 1;
        await databases.updateDocument(
          DATABASE_ID,
          USER_STATS_COLLECTION_ID,
          statsDocId,
          { clone_count: newCloneCount }
        );
        setCloneCount(newCloneCount);
      }

      const response = await databases.listDocuments(
        DATABASE_ID,
        WEB_SPEAKERS_COLLECTION_ID,
        [Query.equal('user_id', userId), Query.limit(100)]
      );
      setMyClonedVoices(response.documents);

      setCloneVoiceName('');
      discardRecording();
      alert(`Voice "${cloneVoiceName.trim()}" cloned and saved successfully!`);
    } catch (err) {
      console.error('Failed to clone voice:', err);
      alert('Failed to clone voice: ' + err.message);
    } finally {
      setIsCloningVoice(false);
    }
  };

  const handleSelectClonedVoice = (e) => {
    const voiceId = e.target.value;
    setSelectedClonedVoiceId(voiceId);
    if (!voiceId) return;

    const voice = myClonedVoices.find((v) => v.$id === voiceId);
    if (voice) {
      setCustomUrlText(voice.sample_url);
      setVoiceSource('custom');
      setSelectedLibraryVoiceId('');
    }
  };

  const handleLocalFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.wav')) {
      alert('Please select a .wav file.');
      e.target.value = ''; 
      return;
    }

    setIsUploadingFile(true);
    try {
      const renamedFile = new File([file], `web-${file.name}`, { type: file.type });
      const uploadedFile = await storage.createFile(
        RECORDING_UPLOAD_BUCKET_ID,
        ID.unique(),
        renamedFile
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
      e.target.value = ''; 
    }
  };

  const MAX_MUSIC_DURATION_SECONDS = 30;

  // Baca durasi file audio SEBELUM upload, pakai elemen <audio> browser --
  // nggak perlu upload dulu baru ketauan kepanjangan, langsung ketolak di sisi client.
  const getAudioFileDuration = (file) => {
    return new Promise((resolve, reject) => {
      const audioEl = document.createElement('audio');
      audioEl.preload = 'metadata';
      audioEl.onloadedmetadata = () => {
        URL.revokeObjectURL(audioEl.src);
        resolve(audioEl.duration);
      };
      audioEl.onerror = () => {
        URL.revokeObjectURL(audioEl.src);
        reject(new Error('Could not read audio file duration'));
      };
      audioEl.src = URL.createObjectURL(file);
    });
  };

  // 🎵 Pilih & upload file musik latar dari komputer -- pola upload sama
  // persis dengan handleLocalFileSelect (file .wav) di atas, cuma bucket
  // & prefix nama file dibedain biar gampang dikenali di Storage.
  const handlePickBackgroundMusic = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingMusic(true);
    try {
      // ⏱️ Cek durasi dulu SEBELUM upload -- max 30 detik, sesuai request.
      // ffmpeg sebenarnya bisa loop musik berapa pun panjangnya (lihat
      // predict.py), tapi limit ini sengaja dipasang biar user nggak upload
      // file musik full-length yang nggak perlu (buang bandwidth & storage).
      let duration;
      try {
        duration = await getAudioFileDuration(file);
      } catch (durationErr) {
        console.error('Failed to read audio duration:', durationErr);
        alert('Could not read this audio file. Please try a different file.');
        setIsUploadingMusic(false);
        e.target.value = '';
        return;
      }

      if (duration > MAX_MUSIC_DURATION_SECONDS) {
        alert(
          `Background music must be ${MAX_MUSIC_DURATION_SECONDS} seconds or shorter ` +
          `(yours is ${Math.round(duration)}s). Please trim it first -- it will be looped automatically anyway.`
        );
        setIsUploadingMusic(false);
        e.target.value = '';
        return;
      }

      const renamedFile = new File([file], `web-bgmusic-${Date.now()}-${file.name}`, {
        type: file.type,
      });

      const uploadedFile = await storage.createFile(
        RECORDING_UPLOAD_BUCKET_ID,
        ID.unique(),
        renamedFile
      );

      const fileUrl = `https://fra.cloud.appwrite.io/v1/storage/buckets/${RECORDING_UPLOAD_BUCKET_ID}/files/${uploadedFile.$id}/view?project=6a3a48a1003d333b0268`;

      setBackgroundMusicUrl(fileUrl);
      setBackgroundMusicName(file.name);
    } catch (err) {
      console.error('Failed to upload background music:', err);
      alert('Failed to upload background music: ' + err.message);
    } finally {
      setIsUploadingMusic(false);
      e.target.value = '';
    }
  };

  const handleRemoveBackgroundMusic = () => {
    setBackgroundMusicUrl(null);
    setBackgroundMusicName(null);
  };

  const handleDownloadAudio = () => {
    if (!generatedAudio) return;
    const downloadUrl = generatedAudio.replace('/view?', '/download?');
    window.open(downloadUrl, '_blank');
  };

  const handleToggleLike = async () => {
    if (!currentJobId) return;
    const newLikedState = !isLiked;
    setIsLiked(newLikedState); 
    try {
      await databases.updateDocument(
        DATABASE_ID,
        JOBS_COLLECTION_ID,
        currentJobId,
        { is_liked: newLikedState }
      );
    } catch (err) {
      console.error('Failed to update like status:', err);
      setIsLiked(!newLikedState); 
      alert('Failed to save like status: ' + err.message);
    }
  };

  const handleShareAudio = async () => {
    if (!generatedAudio) return;
    try {
      let blob = generatedAudioBlob;
      if (!blob) {
        const downloadUrl = generatedAudio.replace('/view?', '/download?');
        const response = await fetch(downloadUrl);
        blob = await response.blob();
      }

      const ext = outputFormat || 'wav';
      const shareFile = new File([blob], generatedFileName || `narratorai-${Date.now()}.${ext}`, {
        type: blob.type || 'audio/wav',
      });

      if (navigator.canShare && navigator.canShare({ files: [shareFile] })) {
        await navigator.share({
          files: [shareFile],
          title: 'NarratorAI Voice Over',
        });
      } else {
        showToast("Direct sharing isn't available on this browser -- here's your file to download instead.");
        handleDownloadAudio();
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('Failed to share audio:', err);
      showToast("Direct sharing isn't available on this browser yet -- here's your file to download instead.");
      handleDownloadAudio();
    }
  };

  const handleGenerateSpeech = async (e) => {
    e.preventDefault();
    if (isLimitReached) {
      return alert('You have reached the free generation limit. Please upgrade to continue.');
    }
    if (mode === 'single' && !text) return alert("Text cannot be empty!");
    if (mode === 'dialogue' && !dialogueScript) return alert("Dialogue script cannot be empty!");

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
        comma_pause_ms: commaPauseMs,
        period_pause_ms: periodPauseMs,
        // 🎵 Opsional -- kalau backgroundMusicUrl null, field ini nggak
        // ngaruh apa-apa (Function/predict.py cuma proses ducking kalau ada)
        background_music: backgroundMusicUrl || undefined,
        music_volume_db: musicVolumeDb,
      };
    } else {
      const finalSpeakerWavUrl = voiceSource === 'library' ? getLibraryVoiceUrl() : customUrlText;

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
        comma_pause_ms: commaPauseMs,
        period_pause_ms: periodPauseMs,
        background_music: backgroundMusicUrl || undefined,
        music_volume_db: musicVolumeDb,
      };
    }

    setIsLoading(true);
    setGeneratedAudio(null);
    setGeneratedFileName(null);
    setFinalProcessTime(null);
    setIsLiked(false);
    setCurrentJobId(null);
    setGeneratedAudioBlob(null);

    const requestId = ID.unique();
    payload.requestId = requestId;

    setElapsedMs(0);
    timerStartRef.current = Date.now();
    timerIntervalRef.current = setInterval(() => {
      setElapsedMs(Date.now() - timerStartRef.current);
    }, 100);

    try {
      const createExecRes = await fetch(
        `${APPWRITE_ENDPOINT}/functions/${FUNCTION_ID}/executions`,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'X-Appwrite-Project': APPWRITE_PROJECT_ID,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            body: JSON.stringify(payload),
            async: true,
            method: 'POST',
          }),
        }
      );

      if (!createExecRes.ok) {
        const errBody = await createExecRes.json().catch(() => ({}));
        throw new Error(errBody.message || `Failed to start execution (status ${createExecRes.status})`);
      }

      let jobDoc = null;
      const maxWaitMs = 5 * 60 * 1000; 
      const pollStart = Date.now();

      while (!jobDoc || jobDoc.status === 'pending') {
        if (Date.now() - pollStart > maxWaitMs) {
          throw new Error('Generation timed out. Please check Appwrite Console logs.');
        }
        await new Promise((resolve) => setTimeout(resolve, 3000));
        try {
          jobDoc = await databases.getDocument(DATABASE_ID, JOBS_COLLECTION_ID, requestId);
        } catch (notFoundErr) {
          jobDoc = null;
        }
      }

      if (jobDoc.status === 'failed') {
        throw new Error(jobDoc.error_message || 'Function execution failed. Check Appwrite Console logs for details.');
      }

      const data = { success: true, audioUrl: jobDoc.audio_url, fileName: jobDoc.file_name };

      if (data.success && data.audioUrl) {
        setGeneratedAudio(data.audioUrl);
        setGeneratedFileName(data.fileName || null);
        setCurrentJobId(requestId);

        try {
          const downloadUrl = data.audioUrl.replace('/view?', '/download?');
          const blobResponse = await fetch(downloadUrl);
          const blob = await blobResponse.blob();
          setGeneratedAudioBlob(blob);
        } catch (blobErr) {
          console.error('Failed to pre-fetch audio blob for sharing:', blobErr);
          setGeneratedAudioBlob(null);
        }

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
      clearInterval(timerIntervalRef.current);
      if (timerStartRef.current) {
        setFinalProcessTime(Date.now() - timerStartRef.current);
      }
      setIsLoading(false);
    }
  };

  // --- Fungsi Clear & Pause UI Baru ---
  const handleClearText = (e) => {
    e.preventDefault(); 
    if (mode === 'single') {
      setText('');
      setTimeout(() => textRef.current?.focus(), 0);
    } else {
      setDialogueScript('');
      setTimeout(() => dialogueRef.current?.focus(), 0);
    }
  };

  const handleInsertPause = (e) => {
    const pauseValue = e.target.value;
    if (!pauseValue) return;

    const pauseTag = ` [pause ${pauseValue}s] `;
    const isSingle = mode === 'single';
    const currentText = isSingle ? text : dialogueScript;
    const currentRef = isSingle ? textRef.current : dialogueRef.current;
    const setTargetText = isSingle ? setText : setDialogueScript;

    if (currentText.length + pauseTag.length > MAX_CHARS) {
      alert("Kapasitas teks tidak cukup untuk menambahkan pause!");
      e.target.value = "";
      return;
    }

    if (currentRef) {
      const startPos = currentRef.selectionStart;
      const endPos = currentRef.selectionEnd;

      const newText = currentText.substring(0, startPos) + pauseTag + currentText.substring(endPos, currentText.length);
      setTargetText(newText);
      e.target.value = ""; 

      setTimeout(() => {
        currentRef.focus();
        const newCursorPos = startPos + pauseTag.length;
        currentRef.setSelectionRange(newCursorPos, newCursorPos);
      }, 0);
    }
  };

  const renderTextareaHeader = (currentTextLength) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', marginTop: '10px' }}>
      <span style={{ fontSize: '13px', background: '#f3f4f6', padding: '6px 14px', borderRadius: '20px', border: '1px solid #e5e7eb' }}>
        {currentTextLength} / {MAX_CHARS}
      </span>
      <div style={{ display: 'flex', gap: '10px' }}>
        <select 
          onChange={handleInsertPause} 
          defaultValue=""
          style={{ padding: '6px 14px', borderRadius: '20px', border: '1px solid #d1d5db', cursor: 'pointer', background: 'white' }}
        >
          <option value="" disabled>|| Pauses</option>
          <option value="0.5">0.5s</option>
          <option value="1">1s</option>
          <option value="2">2s</option>
          <option value="3">3s</option>
          <option value="4">4s</option>
          <option value="5">5s</option>
        </select>
        <button 
          type="button" 
          onClick={handleClearText}
          style={{ padding: '6px 14px', borderRadius: '20px', border: '1px solid #d1d5db', background: 'white', cursor: 'pointer' }}
        >
          Clear Text
        </button>
      </div>
    </div>
  );

  // --- UI Render ---
  return (
    <div style={{ fontFamily: 'sans-serif', maxWidth: '1000px', margin: '0 auto', padding: '20px' }}>
      {toastMessage && (
        <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', backgroundColor: 'rgba(20, 20, 20, 0.95)', color: 'white', padding: '20px 28px', borderRadius: '10px', maxWidth: '400px', textAlign: 'center', fontSize: '15px', lineHeight: '1.5', zIndex: 9999, boxShadow: '0 8px 24px rgba(0,0,0,0.35)' }}>
          {toastMessage}
        </div>
      )}

      {/* ⚙️ Modal Settings -- Speed, Temperature, Comma/Period Pause.
          Dulu tersebar di sidebar (Speed/Temp) dan cuma ada di Replicate
          Playground (Comma/Period Pause) -- sekarang semua terkonsentrasi
          di sini. */}
      {showSettingsModal && (
        <div
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 9998,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onClick={() => setShowSettingsModal(false)}
        >
          <div
            style={{
              backgroundColor: 'white', borderRadius: '10px', padding: '24px',
              width: '90%', maxWidth: '420px', maxHeight: '80vh', overflowY: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ margin: 0 }}>⚙️ Voice Settings</h2>
              <button
                onClick={() => setShowSettingsModal(false)}
                style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <div style={{ marginBottom: '18px' }}>
              <label>⚡ Speed: {speed}</label>
              <input type="range" min="0.5" max="2.0" step="0.05" value={speed} onChange={(e) => setSpeed(e.target.value)} style={{ width: '100%' }}/>
              <small style={{ color: '#666' }}>0.5 (slow) -- 2.0 (fast)</small>
            </div>

            <div style={{ marginBottom: '18px' }}>
              <label>🎭 Expressiveness (Temperature): {temperature}</label>
              <input type="range" min="0.1" max="1.0" step="0.05" value={temperature} onChange={(e) => setTemperature(e.target.value)} style={{ width: '100%' }}/>
              <small style={{ color: '#666' }}>0.1 (stable/monotone) -- 1.0 (expressive/varied)</small>
            </div>

            <div style={{ marginBottom: '18px' }}>
              <label>⏸️ Comma Pause: {commaPauseMs}ms</label>
              <input type="range" min="0" max="1500" step="50" value={commaPauseMs} onChange={(e) => setCommaPauseMs(parseInt(e.target.value, 10))} style={{ width: '100%' }}/>
              <small style={{ color: '#666' }}>Pause duration after a comma</small>
            </div>

            <div style={{ marginBottom: '8px' }}>
              <label>⏸️ Period Pause: {periodPauseMs}ms</label>
              <input type="range" min="0" max="3000" step="50" value={periodPauseMs} onChange={(e) => setPeriodPauseMs(parseInt(e.target.value, 10))} style={{ width: '100%' }}/>
              <small style={{ color: '#666' }}>Pause duration after a period</small>
            </div>

            <button
              onClick={() => setShowSettingsModal(false)}
              style={{
                width: '100%', marginTop: '16px', padding: '10px',
                backgroundColor: '#28a745', color: 'white', border: 'none',
                borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold',
              }}
            >
              Done
            </button>
          </div>
        </div>
      )}

      <h1>🎙️ Narator AI</h1>
      
      <div style={{ display: 'flex', gap: '30px', marginTop: '20px' }}>
        
        {/* SIDEBAR */}
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
             <small>Maximum {MAX_RECORDING_SECONDS} seconds per recording.</small>
             
             {recordedUrl && (
               <div style={{ marginTop: '10px' }}>
                 <audio src={recordedUrl} controls style={{ width: '100%' }} />
                 <div style={{ display: 'flex', gap: '10px', marginTop: '5px' }}>
                   <button onClick={useRecordingAsReference} disabled={isUploadingRecording}>
                     {isUploadingRecording ? '⏳ Uploading...' : '✅ Use Reference'}
                   </button>
                   <button onClick={discardRecording}>🗑️ Discard</button>
                 </div>

                 <div style={{ marginTop: '12px', padding: '10px', backgroundColor: '#fff3e0', borderRadius: '6px', border: '1px solid #ffcc80' }}>
                   <label style={{ fontWeight: 'bold', fontSize: '13px' }}>🧬 Or Save as New Voice (Clone):</label>
                   <input
                     type="text"
                     value={cloneVoiceName}
                     onChange={(e) => setCloneVoiceName(e.target.value)}
                     placeholder="Voice name (e.g. My Voice)"
                     disabled={isCloneLimitReached}
                     style={{ width: '100%', padding: '6px', marginTop: '6px', boxSizing: 'border-box' }}
                   />
                   <button
                     onClick={handleCloneVoice}
                     disabled={isCloningVoice || isCloneLimitReached}
                     style={{ width: '100%', marginTop: '6px', padding: '8px', backgroundColor: isCloneLimitReached ? '#9D4EDD' : '#fb8c00', color: 'white', border: 'none', borderRadius: '4px', cursor: isCloningVoice || isCloneLimitReached ? 'not-allowed' : 'pointer', fontWeight: 'bold' }}
                   >
                     {isCloningVoice ? '⏳ Cloning...' : isCloneLimitReached ? '⭐ Upgrade to Pro' : '🧬 Clone & Save Voice'}
                   </button>
                   {!isCloneLimitReached && (
                     <small style={{ display: 'block', marginTop: '4px', color: '#666' }}>
                       {cloneCount} / {MAX_FREE_CLONES} free clones used
                     </small>
                   )}
                 </div>
               </div>
             )}
          </div>

          {myClonedVoices.length > 0 && (
            <div style={{ marginBottom: '15px' }}>
              <label>🧬 My Cloned Voices:</label><br/>
              <select
                value={selectedClonedVoiceId}
                onChange={handleSelectClonedVoice}
                style={{ width: '100%', padding: '8px' }}
              >
                <option value="">-- Select one of your cloned voices --</option>
                {myClonedVoices.map((voice) => (
                  <option key={voice.$id} value={voice.$id}>
                    {voice.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <hr style={{ margin: '20px 0' }} />

          {/* ⚙️ Speed, Temperature, Comma/Period Pause sekarang di modal
              Settings (tombol gear), tidak lagi di sidebar. */}
          <button
            onClick={() => setShowSettingsModal(true)}
            style={{
              width: '100%',
              padding: '10px',
              marginBottom: '15px',
              backgroundColor: '#f5f5f5',
              border: '1px solid #ccc',
              borderRadius: '6px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              fontSize: '14px',
              fontWeight: 'bold',
            }}
          >
            ⚙️ Voice Settings
          </button>

          {/* 🎵 Background Music + Auto-Ducking */}
          <div style={{ marginBottom: '15px', padding: '10px', backgroundColor: '#fff3e0', borderRadius: '6px', border: '1px solid #ffcc80' }}>
            <label style={{ fontWeight: 'bold' }}>🎵 Background Music (optional, max 30s):</label>
            {backgroundMusicName ? (
              <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '13px' }} title={backgroundMusicName}>
                  🎶 {backgroundMusicName.length > 28 ? backgroundMusicName.substring(0, 28) + '...' : backgroundMusicName}
                </span>
                <button
                  onClick={handleRemoveBackgroundMusic}
                  style={{ padding: '4px 8px', backgroundColor: '#e0e0e0', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}
                >
                  ✕ Remove
                </button>
              </div>
            ) : (
              <input
                type="file"
                accept="audio/*"
                onChange={handlePickBackgroundMusic}
                disabled={isUploadingMusic}
                style={{ width: '100%', padding: '6px', marginTop: '6px', backgroundColor: 'white', border: '1px solid #ccc', borderRadius: '4px' }}
              />
            )}
            {isUploadingMusic && <small>⏳ Uploading music...</small>}

            {backgroundMusicUrl && (
              <>
                <small style={{ display: 'block', marginTop: '8px', color: '#666' }}>
                  Music automatically ducks (turns down) whenever the narration is speaking, and comes back up during silence.
                </small>
                <label style={{ display: 'block', marginTop: '6px', fontSize: '13px' }}>
                  Music Volume: {musicVolumeDb} dB
                </label>
                <input
                  type="range"
                  min="-30"
                  max="0"
                  step="1"
                  value={musicVolumeDb}
                  onChange={(e) => setMusicVolumeDb(parseInt(e.target.value, 10))}
                  style={{ width: '100%' }}
                />
              </>
            )}
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

        {/* MAIN CONTENT */}
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
                <label style={{ fontWeight: 'bold' }}>Text to Synthesize:</label>
                {renderTextareaHeader(text.length)}
                <textarea 
                  ref={textRef}
                  value={text} 
                  onChange={(e) => setText(e.target.value)}
                  maxLength={MAX_CHARS}
                  rows="8" 
                  style={{ width: '100%', padding: '15px', boxSizing: 'border-box', marginTop: '5px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none', fontSize: '15px', resize: 'vertical' }}
                  placeholder="Type or Paste your text here, wait until magic come...."
                />
              </div>
            ) : (
              <div>
                <label style={{ fontWeight: 'bold' }}>Dialogue Script:</label>
                {renderTextareaHeader(dialogueScript.length)}
                <textarea 
                  ref={dialogueRef}
                  value={dialogueScript} 
                  onChange={(e) => setDialogueScript(e.target.value)}
                  maxLength={MAX_CHARS}
                  rows="8" 
                  style={{ width: '100%', padding: '15px', boxSizing: 'border-box', marginTop: '5px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none', fontSize: '15px', resize: 'vertical' }}
                  placeholder="[Adam]: I just finished testing...&#10;[Anna]: Oh really?"
                />

                {detectedSpeakerNames.length > 0 && (
                  <div style={{ marginTop: '15px', padding: '15px', backgroundColor: '#f0f8ff', border: '1px solid #cce4ff', borderRadius: '8px' }}>
                    <label style={{ fontWeight: 'bold' }}>🎭 Assign Voice per Speaker:</label>
                    {detectedSpeakerNames.map((name) => {
                      const assignment = speakerAssignments[name] || {};
                      const hasVoice = !!getSpeakerVoiceUrl(name);
                      return (
                        <div key={name} style={{ marginTop: '10px', padding: '10px', backgroundColor: 'white', borderRadius: '6px', border: hasVoice ? '1px solid #28a745' : '1px solid #ddd' }}>
                          <strong>🎤 {name}</strong> {hasVoice && <span style={{ color: '#28a745', fontSize: '12px' }}>✓ assigned</span>}
                          <select
                            value={assignment.source === 'library' ? assignment.libraryId || '' : ''}
                            onChange={(e) => handleAssignSpeakerLibrary(name, e.target.value)}
                            style={{ width: '100%', padding: '6px', marginTop: '6px' }}
                          >
                            <option value="">-- Select from library --</option>
                            {voiceLibrary.map((voice) => (
                              <option key={voice.$id} value={voice.$id}>{voice.name || voice.label || voice.$id}</option>
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

            <style>{`
              @keyframes narratorai-spin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
              }
            `}</style>

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
                cursor: isLoading || checkingQuota ? 'not-allowed' : 'pointer',
                fontSize: '16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '10px',
                opacity: isLoading || checkingQuota ? 0.85 : 1,
              }}
            >
              {(isLoading || checkingQuota) && (
                <span style={{ display: 'inline-block', width: '16px', height: '16px', border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', animation: 'narratorai-spin 0.8s linear infinite' }} />
              )}
              {checkingQuota ? 'Checking quota...' : isLoading ? `Generating... ${formatDuration(elapsedMs)}` : isLimitReached ? '⭐ Upgrade to Pro' : '🎵 Generate Speech'}
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
              <div style={{ backgroundColor: '#28a745', color: 'white', padding: '12px', borderRadius: '6px', textAlign: 'center', fontWeight: 'bold' }}>
                ✅ Generated successfully! (Processed Time: {finalProcessTime !== null ? formatDuration(finalProcessTime) : '--:--.--'})
                {generatedFileName && <><br />File: {generatedFileName}</>}
              </div>
              <audio src={generatedAudio} controls autoPlay style={{ width: '100%', marginTop: '15px' }} />
              <div style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
                <button onClick={handleToggleLike} style={{ flex: 1, padding: '10px', backgroundColor: isLiked ? '#ff4d6d' : '#e0e0e0', color: isLiked ? 'white' : 'black', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold' }}>
                  {isLiked ? '❤️ Liked' : '🤍 Like'}
                </button>
                <button onClick={handleShareAudio} style={{ flex: 1, padding: '10px', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold' }}>
                  📤 Share
                </button>
                <button onClick={handleDownloadAudio} style={{ flex: 1, padding: '10px', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold' }}>
                  ⬇️ Download
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

export default TtsServer;
