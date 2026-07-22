import { ID } from 'appwrite';
import { appwriteFunctions, databases, DATABASE_ID } from './appwriteClient';

// 🌍 TERJEMAHAN TEKS (NLLB-200) -- versi web, port dari services/
// replicateService.ts (mobile), fungsi `translateText`. Pola start/check
// SAMA PERSIS: Appwrite Function `nllb-translate` dipanggil lewat SDK
// Functions.createExecution (bukan raw fetch kayak fitur web lain),
// action 'start' buat mulai prediction, action 'check' buat polling.
const NLLB_TRANSLATE_FUNCTION_ID = '6a5b31c3002ceca2e373';

// 🆕 WEBHOOK HYBRID -- opsional & backward-compatible, SAMA PERSIS pola
// yang dipakai mobile (replicateService.ts). Kalau collection
// `replicate_jobs` belum ada di Appwrite, requestId jadi null dan semua
// tetap jalan seperti sebelumnya (polling manual tiap 3 detik).
const JOBS_COLLECTION_ID = 'replicate_jobs';

async function createJobDocument() {
  try {
    const requestId = ID.unique();
    await databases.createDocument(DATABASE_ID, JOBS_COLLECTION_ID, requestId, { status: 'pending' });
    return requestId;
  } catch (e) {
    console.error('[translate] Job doc unavailable, falling back to polling only:', e?.message || e);
    return null;
  }
}

async function peekJobDocument(requestId) {
  try {
    const doc = await databases.getDocument(DATABASE_ID, JOBS_COLLECTION_ID, requestId);
    return doc.status && doc.status !== 'pending' ? doc : null;
  } catch (e) {
    return null;
  }
}

function jobDocToPrediction(doc) {
  return {
    id: doc.prediction_id || doc.$id,
    status: doc.status === 'completed' ? 'succeeded' : doc.status,
    output: doc.output,
    error: doc.error_message,
  };
}

async function waitWithJobDocRace(requestId, intervalMs) {
  if (!requestId) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    return null;
  }
  const subInterval = 500;
  const iterations = Math.max(1, Math.floor(intervalMs / subInterval));
  for (let i = 0; i < iterations; i++) {
    await new Promise((resolve) => setTimeout(resolve, subInterval));
    const doc = await peekJobDocument(requestId);
    if (doc) return jobDocToPrediction(doc);
  }
  return null;
}

async function startPrediction(input, functionId, requestId) {
  const execution = await Promise.race([
    appwriteFunctions.createExecution(
      functionId,
      JSON.stringify({ action: 'start', input, ...(requestId ? { requestId } : {}) })
    ),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Start prediction timed out after 45s')), 45000)
    ),
  ]);
  const body = JSON.parse(execution.responseBody || '{}');
  if (!body.success) {
    throw new Error(body.error || 'Failed to start prediction');
  }
  return body.prediction;
}

async function checkPrediction(predictionId, functionId) {
  const execution = await Promise.race([
    appwriteFunctions.createExecution(functionId, JSON.stringify({ action: 'check', predictionId })),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Check prediction timed out after 20s')), 20000)
    ),
  ]);
  const body = JSON.parse(execution.responseBody || '{}');
  if (!body.success) {
    throw new Error(body.error || 'Failed to check prediction');
  }
  return body.prediction;
}

// text: teks yang mau diterjemahkan
// srcLang / tgtLang: kode FLORES-200 (mis. 'eng_Latn', 'ind_Latn') dari NLLB_LANGUAGES
// onStatusUpdate: callback opsional, dipanggil tiap status prediction berubah
export async function translateText(text, srcLang, tgtLang, onStatusUpdate) {
  const requestId = await createJobDocument();

  let prediction = await startPrediction(
    { text, src_lang: srcLang, tgt_lang: tgtLang },
    NLLB_TRANSLATE_FUNCTION_ID,
    requestId
  );
  onStatusUpdate?.(prediction.status);

  let pollAttempts = 0;
  let consecutiveFailures = 0;
  const MAX_POLLS = 70; // 70 x 3s = ~3.5 menit -- teks jauh lebih cepat dari audio
  const MAX_CONSECUTIVE_FAILURES = 5;

  while (
    prediction.status !== 'succeeded' &&
    prediction.status !== 'failed' &&
    prediction.status !== 'canceled' &&
    pollAttempts < MAX_POLLS
  ) {
    const fromWebhook = await waitWithJobDocRace(requestId, 3000);
    if (fromWebhook) {
      prediction = fromWebhook;
      consecutiveFailures = 0;
      onStatusUpdate?.(prediction.status);
      pollAttempts++;
      continue;
    }

    try {
      prediction = await checkPrediction(prediction.id, NLLB_TRANSLATE_FUNCTION_ID);
      consecutiveFailures = 0;
    } catch (checkErr) {
      consecutiveFailures++;
      console.error(`[translate] Check gagal (percobaan ke-${consecutiveFailures}):`, checkErr?.message);
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        throw new Error('Could not check translation status after multiple attempts. Please try again.');
      }
    }

    onStatusUpdate?.(prediction.status);
    pollAttempts++;
  }

  if (pollAttempts >= MAX_POLLS && prediction.status !== 'succeeded') {
    throw new Error('Translation is taking too long. Please try again.');
  }
  if (prediction.status !== 'succeeded') {
    throw new Error(`Replicate process failed: ${prediction.error}`);
  }

  if (typeof prediction.output === 'string') {
    return prediction.output;
  }
  if (Array.isArray(prediction.output)) {
    return prediction.output.join('');
  }
  throw new Error('Unexpected translation output format.');
}