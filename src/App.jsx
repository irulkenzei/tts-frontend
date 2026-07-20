import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Client, Functions, Databases, Storage, Query, Account } from 'appwrite';
import { segmentsToPlainText, segmentsToSrt, segmentsToVtt } from './subtitleUtils';
import './App.css';
import ChatBot from './components/ChatBot';

// Appwrite Configuration
const APPWRITE_ENDPOINT = 'https://fra.cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = '6a3a48a1003d333b0268';

const client = new Client()
    .setEndpoint(APPWRITE_ENDPOINT)
    .setProject(APPWRITE_PROJECT_ID);

const appwriteFunctions = new Functions(client);
const databases = new Databases(client);
const storage = new Storage(client);
const account = new Account(client);
const FUNCTION_ID = '6a4bedd10009fe338821';

function generateFileId() {
  return `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

// Database & Storage Configuration
const DATABASE_ID = 'naratorai';
const SPEAKERS_COLLECTION_ID = 'speakers';
const USER_STATS_COLLECTION_ID = 'user_stats';
const WEB_SPEAKERS_COLLECTION_ID = 'web_speakers';
const JOBS_COLLECTION_ID = 'web_generation_jobs';
const MAX_FREE_GENERATIONS = 2;
const MAX_FREE_CLONES = 2;
const RECORDING_UPLOAD_BUCKET_ID = '6a40a942000c72f7a8f1';

const SUBTITLE_JOBS_COLLECTION_ID = 'subtitle_jobs';
const GENERATE_SUBTITLE_FUNCTION_ID = '6a50418800361531d89d';
const MAX_VIDEO_DURATION_SECONDS = 30;

const CONVERT_JOBS_COLLECTION_ID = 'convert_jobs';
const CONVERT_DOCUMENT_FUNCTION_ID = '6a508da3001c54e3a019';
const SUPPORTED_DOC_FORMATS = ['txt', 'docx', 'pdf', 'epub'];

// Parse speakers from script
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
  // State Management
  const [mode, setMode] = useState('single');
  const [language, setLanguage] = useState('en');
  const [speed, setSpeed] = useState(1.0);
  const [temperature, setTemperature] = useState(0.7);
  const [commaPauseMs, setCommaPauseMs] = useState(300);
  const [periodPauseMs, setPeriodPauseMs] = useState(600);
  const [outputFormat, setOutputFormat] = useState('wav');

  const [customUrlText, setCustomUrlText] = useState('');
  const [voiceSource, setVoiceSource] = useState('');

  const [voiceLibrary, setVoiceLibrary] = useState([]);
  const [selectedLibraryVoiceId, setSelectedLibraryVoiceId] = useState('');
  const [loadingLibrary, setLoadingLibrary] = useState(true);

  const [isUploadingRecording, setIsUploadingRecording] = useState(false);
  const [isUploadingFile, setIsUploadingFile] = useState(false);

  const [text, setText] = useState('');
  const [dialogueScript, setDialogueScript] = useState('');
  const textRef = useRef(null);
  const dialogueRef = useRef(null);
  const MAX_CHARS = 500;

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
  const [toastType, setToastType] = useState('info');
  
  const showToast = (message, durationMs = 3500, type = 'info') => {
    setToastMessage(message);
    setToastType(type);
    setTimeout(() => setToastMessage(null), durationMs);
  };
  const [currentJobId, setCurrentJobId] = useState(null);

  // Background music
  const [backgroundMusicUrl, setBackgroundMusicUrl] = useState(null);
  const [backgroundMusicName, setBackgroundMusicName] = useState(null);
  const [musicVolumeDb, setMusicVolumeDb] = useState(-6);
  const [isUploadingMusic, setIsUploadingMusic] = useState(false);

  // Subtitle Generator
  const [subtitleVideoFile, setSubtitleVideoFile] = useState(null);
  const [isUploadingVideo, setIsUploadingVideo] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [subtitleSegments, setSubtitleSegments] = useState(null);
  const [subtitleError, setSubtitleError] = useState('');

  // Document Converter
  const [convertSourceFile, setConvertSourceFile] = useState(null);
  const [convertTargetFormat, setConvertTargetFormat] = useState('txt');
  const [isUploadingDoc, setIsUploadingDoc] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [convertResultUrl, setConvertResultUrl] = useState(null);
  const [convertPreviewText, setConvertPreviewText] = useState('');
  const [convertError, setConvertError] = useState('');

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

  // Effects
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
            generateFileId(),
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

  // Handlers
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

  // Recording logic
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
        showToast("Please grant microphone access to record your voice", 3500, 'error');
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
        generateFileId(),
        file
      );
      const fileUrl = `https://fra.cloud.appwrite.io/v1/storage/buckets/${RECORDING_UPLOAD_BUCKET_ID}/files/${uploadedFile.$id}/view?project=6a3a48a1003d333b0268`;

      setCustomUrlText(fileUrl);
      setVoiceSource('custom');
      setSelectedLibraryVoiceId('');
      showToast('Recording uploaded successfully and used as voice reference!', 3500, 'success');
    } catch (err) {
      console.error('Failed to upload recording:', err);
      showToast('Failed to upload recording: ' + err.message, 3500, 'error');
    } finally {
      setIsUploadingRecording(false);
    }
  };

  const handleCloneVoice = async () => {
    if (isCloneLimitReached) {
      showToast('You have reached the free voice clone limit. Upgrade to Pro!', 3500, 'warning');
      return;
    }
    if (!recordedBlob) {
      showToast('Please record your voice first', 3500, 'warning');
      return;
    }
    if (!cloneVoiceName.trim()) {
      showToast('Please provide a name for this voice', 3500, 'warning');
      return;
    }
    if (!userId) {
      showToast('Could not verify account. Please refresh the page', 3500, 'error');
      return;
    }

    setIsCloningVoice(true);
    try {
      const file = new File([recordedBlob], `web-clone-${Date.now()}.webm`, { type: 'audio/webm' });
      const uploadedFile = await storage.createFile(
        RECORDING_UPLOAD_BUCKET_ID,
        generateFileId(),
        file
      );

      const fileUrl = `https://fra.cloud.appwrite.io/v1/storage/buckets/${RECORDING_UPLOAD_BUCKET_ID}/files/${uploadedFile.$id}/view?project=6a3a48a1003d333b0268`;

      await databases.createDocument(
        DATABASE_ID,
        WEB_SPEAKERS_COLLECTION_ID,
        generateFileId(),
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

      const savedName = cloneVoiceName.trim();
      setCloneVoiceName('');
      discardRecording();
      showToast(`Voice "${savedName}" saved successfully!`, 3500, 'success');
    } catch (err) {
      console.error('Failed to clone voice:', err);
      showToast('Failed to save voice: ' + err.message, 3500, 'error');
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
      showToast('Please select a .wav file', 3500, 'warning');
      e.target.value = '';
      return;
    }

    setIsUploadingFile(true);
    try {
      const renamedFile = new File([file], `web-${file.name}`, { type: file.type });
      const uploadedFile = await storage.createFile(
        RECORDING_UPLOAD_BUCKET_ID,
        generateFileId(),
        renamedFile
      );
      const fileUrl = `https://fra.cloud.appwrite.io/v1/storage/buckets/${RECORDING_UPLOAD_BUCKET_ID}/files/${uploadedFile.$id}/view?project=6a3a48a1003d333b0268`;

      setCustomUrlText(fileUrl);
      setVoiceSource('custom');
      setSelectedLibraryVoiceId('');
      showToast(`File "${file.name}" uploaded successfully!`, 3500, 'success');
    } catch (err) {
      console.error('Failed to upload local file:', err);
      showToast('Failed to upload file: ' + err.message, 3500, 'error');
    } finally {
      setIsUploadingFile(false);
      e.target.value = '';
    }
  };

  const MAX_MUSIC_DURATION_SECONDS = 30;
  const MUSIC_LIBRARY_COLLECTION_ID = 'background_music_library';

  const getFileHash = async (file) => {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  };

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

  const handlePickBackgroundMusic = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingMusic(true);
    try {
      let duration;
      try {
        duration = await getAudioFileDuration(file);
      } catch (durationErr) {
        console.error('Failed to read audio duration:', durationErr);
        showToast('Could not read this audio file', 3500, 'error');
        setIsUploadingMusic(false);
        e.target.value = '';
        return;
      }

      if (duration > MAX_MUSIC_DURATION_SECONDS) {
        showToast(
          `Background music must be ${MAX_MUSIC_DURATION_SECONDS} seconds or shorter (yours is ${Math.round(duration)}s). Please trim it first.`,
          3500,
          'warning'
        );
        setIsUploadingMusic(false);
        e.target.value = '';
        return;
      }

      const fileHash = await getFileHash(file);
      if (userId) {
        try {
          const existing = await databases.listDocuments(
            DATABASE_ID,
            MUSIC_LIBRARY_COLLECTION_ID,
            [Query.equal('user_id', userId), Query.equal('file_hash', fileHash), Query.limit(1)]
          );
          if (existing.documents.length > 0) {
            const doc = existing.documents[0];
            setBackgroundMusicUrl(doc.sample_url);
            setBackgroundMusicName(doc.file_name);
            setIsUploadingMusic(false);
            e.target.value = '';
            showToast('This music was already uploaded - reusing existing file');
            return;
          }
        } catch (dedupErr) {
          console.error('Failed to check for duplicate music:', dedupErr);
        }
      }

      const renamedFile = new File([file], `web-bgmusic-${Date.now()}-${file.name}`, {
        type: file.type,
      });

      const uploadedFile = await storage.createFile(
        RECORDING_UPLOAD_BUCKET_ID,
        generateFileId(),
        renamedFile
      );

      const fileUrl = `https://fra.cloud.appwrite.io/v1/storage/buckets/${RECORDING_UPLOAD_BUCKET_ID}/files/${uploadedFile.$id}/view?project=${APPWRITE_PROJECT_ID}`;

      if (userId) {
        try {
          await databases.createDocument(
            DATABASE_ID,
            MUSIC_LIBRARY_COLLECTION_ID,
            generateFileId(),
            { user_id: userId, file_hash: fileHash, file_name: file.name, sample_url: fileUrl }
          );
        } catch (saveHashErr) {
          console.error('Failed to save music hash record:', saveHashErr);
        }
      }

      setBackgroundMusicUrl(fileUrl);
      setBackgroundMusicName(file.name);
      showToast('Background music uploaded successfully!', 3500, 'success');
    } catch (err) {
      console.error('Failed to upload background music:', err);
      showToast('Failed to upload music: ' + err.message, 3500, 'error');
    } finally {
      setIsUploadingMusic(false);
      e.target.value = '';
    }
  };

  const handleRemoveBackgroundMusic = () => {
    setBackgroundMusicUrl(null);
    setBackgroundMusicName(null);
  };

  const getVideoDuration = (file) => {
    return new Promise((resolve, reject) => {
      const videoEl = document.createElement('video');
      videoEl.preload = 'metadata';
      videoEl.onloadedmetadata = () => {
        URL.revokeObjectURL(videoEl.src);
        resolve(videoEl.duration);
      };
      videoEl.onerror = () => {
        URL.revokeObjectURL(videoEl.src);
        reject(new Error('Could not read video duration'));
      };
      videoEl.src = URL.createObjectURL(file);
    });
  };

  const handlePickSubtitleVideo = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    let duration;
    try {
      duration = await getVideoDuration(file);
    } catch (durationErr) {
      console.error('Failed to read video duration:', durationErr);
      showToast('Could not read this video file', 3500, 'error');
      e.target.value = '';
      return;
    }

    if (duration > MAX_VIDEO_DURATION_SECONDS) {
      showToast(`Video must be ${MAX_VIDEO_DURATION_SECONDS} seconds or shorter (yours is ${Math.round(duration)}s)`, 3500, 'warning');
      e.target.value = '';
      return;
    }

    setSubtitleVideoFile(file);
    setSubtitleSegments(null);
    setSubtitleError('');
  };

  const handleGenerateSubtitle = async () => {
    if (!subtitleVideoFile) return;
    setSubtitleError('');
    setSubtitleSegments(null);
    setIsUploadingVideo(true);

    try {
      const renamedFile = new File([subtitleVideoFile], `web-video-${Date.now()}-${subtitleVideoFile.name}`, {
        type: subtitleVideoFile.type,
      });
      const uploadedFile = await storage.createFile(RECORDING_UPLOAD_BUCKET_ID, generateFileId(), renamedFile);
      const videoUrl = `https://fra.cloud.appwrite.io/v1/storage/buckets/${RECORDING_UPLOAD_BUCKET_ID}/files/${uploadedFile.$id}/view?project=${APPWRITE_PROJECT_ID}`;

      setIsUploadingVideo(false);
      setIsTranscribing(true);

      const requestId = generateFileId();
      await databases.createDocument(DATABASE_ID, SUBTITLE_JOBS_COLLECTION_ID, requestId, {
        user_id: userId,
        status: 'pending',
        video_url: videoUrl,
      });

      await fetch(`${APPWRITE_ENDPOINT}/functions/${GENERATE_SUBTITLE_FUNCTION_ID}/executions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Appwrite-Project': APPWRITE_PROJECT_ID,
        },
        body: JSON.stringify({
          body: JSON.stringify({ requestId, videoUrl }),
          async: true,
        }),
      });

      let attempts = 0;
      const maxAttempts = 60;
      let job = null;
      while (attempts < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        job = await databases.getDocument(DATABASE_ID, SUBTITLE_JOBS_COLLECTION_ID, requestId);
        if (job.status === 'completed' || job.status === 'failed') break;
        attempts++;
      }

      if (!job || job.status !== 'completed') {
        throw new Error(job?.error_message || 'Transcription timed out or failed.');
      }

      setSubtitleSegments(JSON.parse(job.segments));
      showToast('Subtitle generated successfully!', 3500, 'success');
    } catch (e) {
      console.error('Failed to generate subtitle:', e);
      setSubtitleError(e.message || 'Failed to generate subtitle. Please try again.');
    } finally {
      setIsUploadingVideo(false);
      setIsTranscribing(false);
    }
  };

  const handleDownloadSubtitle = (format) => {
    if (!subtitleSegments) return;
    const content = format === 'srt' ? segmentsToSrt(subtitleSegments) : segmentsToVtt(subtitleSegments);
    const baseName = (subtitleVideoFile?.name || 'subtitle').replace(/\.[^/.]+$/, '');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${baseName}.${format}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadAudio = () => {
    if (!generatedAudio) return;
    const downloadUrl = generatedAudio.replace('/view?', '/download?');
    window.open(downloadUrl, '_blank');
  };

  const detectFormatFromFileName = (fileName) => {
    const ext = fileName.split('.').pop().toLowerCase();
    return SUPPORTED_DOC_FORMATS.includes(ext) ? ext : null;
  };

  const handlePickDocument = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const format = detectFormatFromFileName(file.name);
    if (!format) {
      showToast(`Unsupported file type. Please upload: ${SUPPORTED_DOC_FORMATS.join(', ')}`, 3500, 'warning');
      e.target.value = '';
      return;
    }

    setConvertSourceFile(file);
    setConvertResultUrl(null);
    setConvertPreviewText('');
    setConvertError('');
  };

  const handleConvertDocument = async () => {
    if (!convertSourceFile) return;
    setConvertError('');
    setConvertResultUrl(null);
    setConvertPreviewText('');
    setIsUploadingDoc(true);

    try {
      const sourceFormat = detectFormatFromFileName(convertSourceFile.name);
      if (!sourceFormat) throw new Error('Could not detect source file format.');

      const renamedFile = new File([convertSourceFile], `web-doc-${Date.now()}-${convertSourceFile.name}`, {
        type: convertSourceFile.type,
      });
      const uploadedFile = await storage.createFile(RECORDING_UPLOAD_BUCKET_ID, generateFileId(), renamedFile);
      const sourceUrl = `https://fra.cloud.appwrite.io/v1/storage/buckets/${RECORDING_UPLOAD_BUCKET_ID}/files/${uploadedFile.$id}/view?project=${APPWRITE_PROJECT_ID}`;

      setIsUploadingDoc(false);
      setIsConverting(true);

      const requestId = generateFileId();
      const title = convertSourceFile.name.replace(/\.[^/.]+$/, '');
      await databases.createDocument(DATABASE_ID, CONVERT_JOBS_COLLECTION_ID, requestId, {
        status: 'pending',
        source_url: sourceUrl,
        user_id: userId,
      });

      await fetch(`${APPWRITE_ENDPOINT}/functions/${CONVERT_DOCUMENT_FUNCTION_ID}/executions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Appwrite-Project': APPWRITE_PROJECT_ID,
        },
        body: JSON.stringify({
          body: JSON.stringify({ requestId, sourceUrl, sourceFormat, targetFormat: convertTargetFormat, title }),
          async: true,
        }),
      });

      let attempts = 0;
      const maxAttempts = 40;
      let job = null;
      while (attempts < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        job = await databases.getDocument(DATABASE_ID, CONVERT_JOBS_COLLECTION_ID, requestId);
        if (job.status === 'completed' || job.status === 'failed') break;
        attempts++;
      }

      if (!job || job.status !== 'completed') {
        throw new Error(job?.error_message || 'Conversion timed out or failed.');
      }

      setConvertResultUrl(job.output_url);
      setConvertPreviewText(job.extracted_text_preview || '');
      showToast('Document converted successfully!', 3500, 'success');
    } catch (e) {
      console.error('Failed to convert document:', e);
      setConvertError(e.message || 'Failed to convert document. Please try again.');
    } finally {
      setIsUploadingDoc(false);
      setIsConverting(false);
    }
  };

  const handleDownloadConverted = () => {
    if (!convertResultUrl) return;
    const downloadUrl = convertResultUrl.replace('/view?', '/download?');
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
      showToast('Failed to save like status: ' + err.message, 3500, 'error');
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
        showToast("Direct sharing isn't supported on this browser - download instead");
        handleDownloadAudio();
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('Failed to share audio:', err);
      showToast("Direct sharing isn't supported on this browser");
      handleDownloadAudio();
    }
  };

  const handleGenerateSpeech = async (e) => {
    e.preventDefault();
    if (isLimitReached) {
      // 🆕 Arahkan ke halaman pricing, bukan cuma toast -- konsisten
      // dengan pola "Upgrade to Pro" di mobile app (onNavigateToPro).
      window.location.href = '/pricing';
      return;
    }
    if (mode === 'single' && !text) {
      showToast("Text cannot be empty!", 3500, 'warning');
      return;
    }
    if (mode === 'dialogue' && !dialogueScript) {
      showToast("Dialogue script cannot be empty!", 3500, 'warning');
      return;
    }

    let payload;

    if (mode === 'dialogue') {
      if (detectedSpeakerNames.length === 0) {
        showToast('No speakers detected. Use format [Name]: text...', 3500, 'warning');
        return;
      }
      const missing = detectedSpeakerNames.filter((name) => !getSpeakerVoiceUrl(name));
      if (missing.length > 0) {
        showToast(`Please assign a voice for: ${missing.join(', ')}`, 3500, 'warning');
        return;
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
        background_music: backgroundMusicUrl || undefined,
        music_volume_db: musicVolumeDb,
      };
    } else {
      const finalSpeakerWavUrl = voiceSource === 'library' ? getLibraryVoiceUrl() : customUrlText;

      if (!finalSpeakerWavUrl) {
        showToast('Please select a voice from library, enter a custom URL, or record your voice first.', 3500, 'warning');
        return;
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

    const requestId = generateFileId();
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
        await new Promise((resolve) => setTimeout(resolve, 500));
        try {
          jobDoc = await databases.getDocument(DATABASE_ID, JOBS_COLLECTION_ID, requestId);
        } catch (notFoundErr) {
          jobDoc = null;
        }
      }

      if (jobDoc.status === 'failed') {
        throw new Error(jobDoc.error_message || 'Function execution failed. Check Appwrite Console logs.');
      }

      const data = { success: true, audioUrl: jobDoc.audio_url, fileName: jobDoc.file_name };

      if (data.success && data.audioUrl) {
        setGeneratedAudio(data.audioUrl);
        setGeneratedFileName(data.fileName || null);
        setCurrentJobId(requestId);
        showToast('Audio generated successfully!', 3500, 'success');

        try {
          const downloadUrl = data.audioUrl.replace('/view?', '/download?');
          const blobResponse = await fetch(downloadUrl);
          const blob = await blobResponse.blob();
          setGeneratedAudioBlob(blob);
        } catch (blobErr) {
          console.error('Failed to pre-fetch audio blob:', blobErr);
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
        throw new Error(data.error || "Failed to generate audio.");
      }
    } catch (err) {
      console.error(err);
      showToast('Error: ' + err.message, 3500, 'error');
    } finally {
      clearInterval(timerIntervalRef.current);
      if (timerStartRef.current) {
        setFinalProcessTime(Date.now() - timerStartRef.current);
      }
      setIsLoading(false);
    }
  };

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
      showToast("Not enough text capacity for pause!", 3500, 'warning');
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
    <div className="textarea-header">
      <span className="char-count">{currentTextLength} / {MAX_CHARS}</span>
      <div className="button-group">
        <select 
          onChange={handleInsertPause} 
          defaultValue=""
          className="pause-select"
        >
          <option value="" disabled>⏸ Pause</option>
          <option value="0.5">0.50s</option>
          <option value="1">1.00s</option>
          <option value="2">2.00s</option>
          <option value="3">3.00s</option>
          <option value="4">4.00s</option>
          <option value="5">5.00s</option>
        </select>
        <button 
          type="button" 
          onClick={handleClearText}
          className="clear-btn"
        >
          🗑️ Clear
        </button>
      </div>
    </div>
  );

  return (
    <div className="app-container">
      {toastMessage && (
        <div className={`toast toast-${toastType}`}>
          {toastMessage}
        </div>
      )}

      <header className="app-header">
        <div className="header-content">
          <h1 className="app-title">🎙️ NarratorAI</h1>
          <p className="app-subtitle">Powerful AI Text-to-Speech Platform</p>
        </div>
      </header>

      {/* --- START OF RESTRUCTURED MAIN --- */}
      <main className="app-main">
        <div className="content-wrapper">
          
          {/* ======================================= */}
          {/* 1. KIRI: SELECT VOICE CARD                */}
          {/* ======================================= */}
          <aside className="sidebar-left">
            <div className="card">
              <h3 className="card-title">🎵 Select Voice</h3>

              <div className="setting-group">
                <label>📚 Voice Library</label>
                <select
                  value={selectedLibraryVoiceId}
                  onChange={handleSelectLibraryVoice}
                  disabled={loadingLibrary}
                  className="form-select"
                >
                  <option value="">
                    {loadingLibrary ? 'Loading...' : 'Select voice'}
                  </option>
                  {voiceLibrary.map((voice) => (
                    <option key={voice.$id} value={voice.$id}>
                      {voice.name || voice.label || voice.$id}
                    </option>
                  ))}
                </select>
              </div>

              <div className="divider">or</div>

              <div className="setting-group">
                <label>🔗 Custom URL</label>
                <input 
                  type="text" 
                  value={customUrlText} 
                  onChange={(e) => {
                    setCustomUrlText(e.target.value);
                    setVoiceSource('custom');
                  }}
                  placeholder="https://example.com/voice.wav" 
                  className="form-input"
                />
              </div>

              <div className="setting-group">
                <label>📁 Upload WAV File</label>
                <input
                  type="file"
                  accept=".wav,audio/wav"
                  onChange={handleLocalFileSelect}
                  disabled={isUploadingFile}
                  className="form-file"
                />
                {isUploadingFile && <small className="loading">⏳ Uploading...</small>}
              </div>

              <div className="recording-section">
                <label>🎙️ Record Voice</label>
                <button 
                  onClick={toggleRecording} 
                  className={`btn-record ${isRecording ? 'recording' : ''}`}
                >
                  {isRecording ? "⏹️ Stop" : "🎤 Record"}
                </button>
                {isRecording && (
                  <div className="recording-timer">
                    {String(Math.floor(recordingSeconds / 60)).padStart(2, '0')}:{String(recordingSeconds % 60).padStart(2, '0')} / 00:{MAX_RECORDING_SECONDS}
                  </div>
                )}
                
                {recordedUrl && (
                  <div className="recorded-actions">
                    <audio src={recordedUrl} controls className="audio-player" />
                    <div className="button-row">
                      <button onClick={useRecordingAsReference} disabled={isUploadingRecording} className="btn-small btn-primary">
                        {isUploadingRecording ? '⏳' : '✅'} Use
                      </button>
                      <button onClick={discardRecording} className="btn-small btn-danger">🗑️ Discard</button>
                    </div>

                    <div className="clone-section">
                      <label>🧬 Save as New Voice</label>
                      <input
                        type="text"
                        value={cloneVoiceName}
                        onChange={(e) => setCloneVoiceName(e.target.value)}
                        placeholder="Voice name (e.g., My Voice)"
                        disabled={isCloneLimitReached}
                        className="form-input"
                      />
                      <button
                        onClick={handleCloneVoice}
                        disabled={isCloningVoice || isCloneLimitReached}
                        className={`btn-full ${isCloneLimitReached ? 'btn-disabled' : 'btn-primary'}`}
                      >
                        {isCloningVoice ? '⏳ Cloning...' : isCloneLimitReached ? '⭐ Upgrade' : '🧬 Clone & Save'}
                      </button>
                      {!isCloneLimitReached && (
                        <small>{cloneCount} / {MAX_FREE_CLONES} clones used</small>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {myClonedVoices.length > 0 && (
                <div className="setting-group" style={{marginTop: '16px'}}>
                  <label>🧬 My Cloned Voices</label>
                  <select
                    value={selectedClonedVoiceId}
                    onChange={handleSelectClonedVoice}
                    className="form-select"
                  >
                    <option value="">Select your voice</option>
                    {myClonedVoices.map((voice) => (
                      <option key={voice.$id} value={voice.$id}>
                        {voice.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="music-section">
                <h4>🎵 Background Music (Optional)</h4>
                {backgroundMusicName ? (
                  <div className="music-info">
                    <span>🎶 {backgroundMusicName.substring(0, 30)}</span>
                    <button onClick={handleRemoveBackgroundMusic} className="btn-small btn-danger">✕</button>
                  </div>
                ) : (
                  <input
                    type="file"
                    accept="audio/*"
                    onChange={handlePickBackgroundMusic}
                    disabled={isUploadingMusic}
                    className="form-file"
                  />
                )}
                {isUploadingMusic && <small className="loading">⏳ Uploading...</small>}

                {backgroundMusicUrl && (
                  <>
                    <audio src={backgroundMusicUrl} controls className="audio-player" />
                    <div className="setting-group">
                      <label>🔊 Volume: <strong>{musicVolumeDb}dB</strong></label>
                      <input
                        type="range"
                        min="-30"
                        max="0"
                        step="1"
                        value={musicVolumeDb}
                        onChange={(e) => setMusicVolumeDb(parseInt(e.target.value, 10))}
                        className="form-range"
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
          </aside>

          {/* ======================================= */}
          {/* 2. TENGAH: MENU & MAIN FORM             */}
          {/* ======================================= */}
          <section className="content-main">
            
            {/* Mode Nav dipindah ke dalam kolom tengah */}
            <nav className="mode-nav">
              <button 
                onClick={() => setMode('single')}
                className={`mode-btn ${mode === 'single' ? 'active' : ''}`}
              >
                <span className="mode-icon">🎙️</span>
                <span className="mode-text">Single Voice</span>
              </button>
              <button 
                onClick={() => setMode('dialogue')}
                className={`mode-btn ${mode === 'dialogue' ? 'active' : ''}`}
              >
                <span className="mode-icon">🎭</span>
                <span className="mode-text">Dialogue</span>
              </button>
              <button 
                onClick={() => setMode('subtitle')}
                className={`mode-btn ${mode === 'subtitle' ? 'active' : ''}`}
              >
                <span className="mode-icon">🎬</span>
                <span className="mode-text">Subtitle</span>
              </button>
              <button 
                onClick={() => setMode('convert')}
                className={`mode-btn ${mode === 'convert' ? 'active' : ''}`}
              >
                <span className="mode-icon">📄</span>
                <span className="mode-text">Document</span>
              </button>
            </nav>

            {mode === 'convert' ? (
              <div className="card">
                <h2 className="card-title">📄 Document Converter</h2>
                <p className="card-description">Upload a document (.epub, .docx, .pdf, .txt) and convert to another format.</p>

                <div className="setting-group">
                  <label>📂 Select File</label>
                  <input type="file" accept=".epub,.docx,.pdf,.txt" onChange={handlePickDocument} disabled={isUploadingDoc || isConverting} className="form-file" />
                </div>

                {convertSourceFile && (
                  <div className="setting-group">
                    <label>🔄 Convert To</label>
                    <select value={convertTargetFormat} onChange={(e) => setConvertTargetFormat(e.target.value)} disabled={isUploadingDoc || isConverting} className="form-select">
                      {SUPPORTED_DOC_FORMATS.map((fmt) => (
                        <option key={fmt} value={fmt}>.{fmt.toUpperCase()}</option>
                      ))}
                    </select>
                  </div>
                )}

                {convertError && <div className="error-box">{convertError}</div>}

                <button onClick={handleConvertDocument} disabled={!convertSourceFile || isUploadingDoc || isConverting} className={`btn-full btn-primary ${isConverting ? 'btn-loading' : ''}`}>
                  {isUploadingDoc ? 'Uploading...' : isConverting ? 'Converting...' : 'Convert'}
                </button>

                {convertResultUrl && (
                  <div className="success-box">
                    <h3>✅ Conversion Complete</h3>
                    {convertPreviewText && <p className="preview-text">{convertPreviewText.substring(0, 300)}...</p>}
                    <button onClick={handleDownloadConverted} className="btn-full btn-success">⬇️ Download .{convertTargetFormat.toUpperCase()}</button>
                  </div>
                )}
              </div>
            ) : mode === 'subtitle' ? (
              <div className="card">
                <h2 className="card-title">🎬 Subtitle Generator</h2>
                <p className="card-description">Upload a video (max {MAX_VIDEO_DURATION_SECONDS}s) and generate .srt or .vtt subtitle file.</p>

                <div className="setting-group">
                  <label>🎥 Select Video</label>
                  <input type="file" accept="video/*" onChange={handlePickSubtitleVideo} disabled={isUploadingVideo || isTranscribing} className="form-file" />
                </div>

                {subtitleError && <div className="error-box">{subtitleError}</div>}

                <button onClick={handleGenerateSubtitle} disabled={!subtitleVideoFile || isUploadingVideo || isTranscribing} className={`btn-full btn-primary ${isTranscribing ? 'btn-loading' : ''}`}>
                  {isUploadingVideo ? 'Uploading...' : isTranscribing ? 'Transcribing...' : 'Generate Subtitle'}
                </button>

                {subtitleSegments && (
                  <div className="success-box">
                    <h3>✅ Subtitle Ready</h3>
                    <p className="preview-text">{segmentsToPlainText(subtitleSegments).substring(0, 300)}...</p>
                    <div className="button-row">
                      <button onClick={() => handleDownloadSubtitle('srt')} className="btn-half btn-primary">⬇️ .SRT</button>
                      <button onClick={() => handleDownloadSubtitle('vtt')} className="btn-half btn-primary">⬇️ .VTT</button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <form onSubmit={handleGenerateSpeech} className="card">
                <h2 className="card-title">{mode === 'single' ? '🎙️ Single Voice' : '🎭 Dialogue Mode'}</h2>

                <div className="setting-group">
                  <label>{mode === 'single' ? 'Enter Text' : 'Dialogue Script'}</label>
                  {renderTextareaHeader(mode === 'single' ? text.length : dialogueScript.length)}
                  
                  <textarea 
                    ref={mode === 'single' ? textRef : dialogueRef}
                    value={mode === 'single' ? text : dialogueScript}
                    onChange={(e) => mode === 'single' ? setText(e.target.value) : setDialogueScript(e.target.value)}
                    maxLength={MAX_CHARS}
                    rows="10" 
                    className="form-textarea"
                    placeholder={mode === 'single' ? 'Type or paste your text here...' : '[Name]: Dialogue text...\n[Name2]: Response...'}
                  />
                </div>

                {mode === 'dialogue' && detectedSpeakerNames.length > 0 && (
                  <div className="speakers-box">
                    <h4>🎭 Assign Voice per Speaker</h4>
                    {detectedSpeakerNames.map((name) => {
                      const hasVoice = !!getSpeakerVoiceUrl(name);
                      return (
                        <div key={name} className={`speaker-assign ${hasVoice ? 'assigned' : ''}`}>
                          <strong>🎤 {name} {hasVoice && <span className="badge">✓</span>}</strong>
                          <select
                            value={speakerAssignments[name]?.source === 'library' ? speakerAssignments[name]?.libraryId || '' : ''}
                            onChange={(e) => handleAssignSpeakerLibrary(name, e.target.value)}
                            className="form-select"
                          >
                            <option value="">Library</option>
                            {voiceLibrary.map((voice) => (
                              <option key={voice.$id} value={voice.$id}>{voice.name || voice.label}</option>
                            ))}
                          </select>
                          <input
                            type="text"
                            placeholder="Or custom voice URL..."
                            value={speakerAssignments[name]?.source === 'custom' ? speakerAssignments[name]?.customUrl || '' : ''}
                            onChange={(e) => handleAssignSpeakerCustomUrl(name, e.target.value)}
                            className="form-input"
                          />
                        </div>
                      );
                    })}
                  </div>
                )}

                <button 
                  type="submit" 
                  disabled={isLoading || checkingQuota}
                  className={`btn-generate ${isLimitReached ? 'btn-upgrade' : 'btn-primary'} ${isLoading ? 'btn-loading' : ''}`}
                >
                  {checkingQuota ? 'Checking quota...' : isLoading ? `Generating... ${formatDuration(elapsedMs)}` : isLimitReached ? '⭐ Upgrade to Pro' : '🎵 Generate'}
                </button>

                {!checkingQuota && !isLimitReached && (
                  <small style={{display: 'block', marginTop: '6px', color: '#b0bec5'}}>{generationCount} / {MAX_FREE_GENERATIONS} generations used</small>
                )}
              </form>
            )}

            {generatedAudio && (
              <div className="result-card">
                <div className="result-header">
                  <h3>✅ Audio Generated!</h3>
                  <p className="result-time">Time: {finalProcessTime !== null ? formatDuration(finalProcessTime) : '--:--'}</p>
                  {generatedFileName && <p className="file-name">{generatedFileName}</p>}
                </div>

                <audio src={generatedAudio} controls autoPlay className="audio-player" />

                <div className="result-actions">
                  <button onClick={handleToggleLike} className={`btn-action ${isLiked ? 'liked' : ''}`}>
                    {isLiked ? '❤️ Liked' : '🤍 Like'}
                  </button>
                  <button onClick={handleShareAudio} className="btn-action btn-primary">📤 Share</button>
                  <button onClick={handleDownloadAudio} className="btn-action btn-success">⬇️ Download</button>
                </div>
              </div>
            )}
          </section>

          {/* ======================================= */}
          {/* 3. KANAN: VOICE SETTINGS CARD             */}
          {/* ======================================= */}
          <aside className="sidebar-right">
            <div className="card settings-card">
              <h3 className="card-title">⚙️ Voice Settings</h3>
              
              <div className="setting-group">
                <label>🌐 Language</label>
                <select value={language} onChange={(e) => setLanguage(e.target.value)} className="form-select">
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

              <div className="setting-group">
                <label>⚡ Speed: <strong>{speed}</strong></label>
                <input type="range" min="0.5" max="2.0" step="0.05" value={speed} onChange={(e) => setSpeed(e.target.value)} className="form-range"/>
                <small>0.5 (slow) — 2.0 (fast)</small>
              </div>

              <div className="setting-group">
                <label>🎭 Expressiveness: <strong>{temperature}</strong></label>
                <input type="range" min="0.1" max="1.0" step="0.05" value={temperature} onChange={(e) => setTemperature(e.target.value)} className="form-range"/>
                <small>0.1 (stable) — 1.0 (expressive)</small>
              </div>

              <div className="setting-group">
                <label>⏸️ Comma Pause: <strong>{commaPauseMs}ms</strong></label>
                <input type="range" min="0" max="1500" step="50" value={commaPauseMs} onChange={(e) => setCommaPauseMs(parseInt(e.target.value, 10))} className="form-range"/>
              </div>

              <div className="setting-group">
                <label>⏸️ Period Pause: <strong>{periodPauseMs}ms</strong></label>
                <input type="range" min="0" max="5000" step="50" value={periodPauseMs} onChange={(e) => setPeriodPauseMs(parseInt(e.target.value, 10))} className="form-range"/>
              </div>

              <div className="setting-group">
                <label>💾 Output Format</label>
                <select value={outputFormat} onChange={(e) => setOutputFormat(e.target.value)} className="form-select">
                  <option value="wav">WAV</option>
                  <option value="mp3">MP3</option>
                  <option value="ogg">OGG</option>
                  <option value="flac">FLAC</option>
                  <option value="m4a">M4A</option>
                </select>
              </div>
            </div>
          </aside>
          
        </div>
      </main>
      {/* --- END OF RESTRUCTURED MAIN --- */}

      <footer className="site-footer">
        <p>Narator AI</p>
        <nav className="footer-links" aria-label="Support navigation">
          <a href="/voices">Voices Listing</a>
          <a href="/faq">FAQ</a>
          <a href="/troubleshoot">Troubleshoot</a>
          <a href="/contact">Contact</a>
          <a href="/request-feature">Request a Feature</a>
          <a href="/privacy-policy">Privacy Policy</a>
          <a href="/terms-of-service">Terms</a>
          <a href="/delete-account">Delete Account</a>
        </nav>
      </footer>

      <ChatBot />
    </div>
  );
};

export default TtsServer;
