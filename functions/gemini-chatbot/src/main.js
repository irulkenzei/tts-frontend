import { GoogleGenerativeAI } from '@google/generative-ai';
import { Client, Databases } from 'node-appwrite';

// 🧩 Future-proof architecture -- satu Function ini nge-handle semua provider
// AI, tinggal kirim `provider` dari client (default: gemini, gratis).
// ChatGPT/Claude/Qwen dipanggil lewat fetch() langsung ke REST API
// masing-masing (bukan nambah SDK baru) -- lebih ringan, gak perlu ubah
// package.json/deploy ulang dependency tiap nambah provider baru.
const AIProviders = {
  GEMINI: 'gemini',   // Default (gratis, dipakai user biasa)
  CHATGPT: 'chatgpt', // Premium option
  CLAUDE: 'claude',   // Premium option
  QWEN: 'qwen',       // Alternative
};

// ============================================================
// GEMINI -- logic asli, TIDAK DIUBAH sama sekali dari main.js sebelumnya.
// ------------------------------------------------------------
async function callGemini(userPrompt, log) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY belum di-set di Function environment variables.');

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-flash-latest' });
  log(`[gemini] Memproses prompt: ${userPrompt}`);
  const result = await model.generateContent(userPrompt);
  return result.response.text();
}

// ============================================================
// CHATGPT (OpenAI) -- REST API langsung, format chat completions standar.
// ------------------------------------------------------------
async function callChatGPT(userPrompt, log) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY belum di-set di Function environment variables.');

  log(`[chatgpt] Memproses prompt: ${userPrompt}`);
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini', // ganti sesuai kebutuhan/budget kalau perlu
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`OpenAI API error (${res.status}): ${errBody}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

// ============================================================
// CLAUDE (Anthropic) -- REST API langsung, format Messages API.
// ------------------------------------------------------------
async function callClaude(userPrompt, log) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY belum di-set di Function environment variables.');

  log(`[claude] Memproses prompt: ${userPrompt}`);
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6', // sesuaikan model string terbaru kalau perlu
      max_tokens: 1024,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Anthropic API error (${res.status}): ${errBody}`);
  }

  const data = await res.json();
  return data.content?.[0]?.text || '';
}

// ============================================================
// QWEN (Alibaba DashScope) -- pakai endpoint "compatible-mode", formatnya
// sengaja dibikin Alibaba mirip OpenAI, jadi payload-nya sama persis
// kayak callChatGPT di atas -- cuma beda base URL & model name.
// ------------------------------------------------------------
async function callQwen(userPrompt, log) {
  const apiKey = process.env.QWEN_API_KEY;
  if (!apiKey) throw new Error('QWEN_API_KEY belum di-set di Function environment variables.');

  log(`[qwen] Memproses prompt: ${userPrompt}`);
  const res = await fetch('https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'qwen-plus', // ganti ke qwen-turbo/qwen-max sesuai kebutuhan
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Qwen API error (${res.status}): ${errBody}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

// ============================================================
// ROUTER -- pilih handler berdasarkan `provider` yang dikirim client.
// ------------------------------------------------------------
const PROVIDER_HANDLERS = {
  [AIProviders.GEMINI]: callGemini,
  [AIProviders.CHATGPT]: callChatGPT,
  [AIProviders.CLAUDE]: callClaude,
  [AIProviders.QWEN]: callQwen,
};

// ============================================================
// MAIN HANDLER
// ------------------------------------------------------------
// 🔧 ARSITEKTUR: sebelumnya dipanggil SYNCHRONOUS (client nunggu response
// langsung) -- kena limit KERAS 30 detik dari Appwrite ("Synchronous
// function execution timed out"), karena beberapa provider (Claude/GPT
// terutama, kadang Gemini juga) bisa aja butuh waktu lebih dari itu buat
// prompt yang agak panjang/kompleks. Sekarang dipanggil ASYNCHRONOUS --
// hasilnya ditulis ke Database (collection `chatbot_jobs`), client poll
// dokumen itu (bukan nunggu responseBody, yang TERBUKTI selalu kosong
// buat eksekusi async -- pelajaran dari fitur lain di project ini).
// ------------------------------------------------------------
export default async ({ req, res, log, error }) => {
  if (req.method !== 'POST') {
    return res.json({ message: 'Use the POST method.' });
  }

  const DATABASE_ID = process.env.APPWRITE_DATABASE_ID;
  const JOBS_COLLECTION_ID = 'chatbot_jobs';

  let requestId;
  let databases;

  try {
    const payload = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const { requestId: reqId, prompt: userPrompt, provider } = payload;
    requestId = reqId;
    const requestedProvider = provider || AIProviders.GEMINI;

    if (!requestId) return res.json({ success: false, error: 'requestId is required' }, 400);
    if (!userPrompt) return res.json({ success: false, error: 'prompt cannot be empty' }, 400);

    const client = new Client()
      .setEndpoint(process.env.APPWRITE_FUNCTION_API_ENDPOINT)
      .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
      .setKey(process.env.APPWRITE_API_KEY);
    databases = new Databases(client);

    const handler = PROVIDER_HANDLERS[requestedProvider];
    if (!handler) {
      await databases.updateDocument(DATABASE_ID, JOBS_COLLECTION_ID, requestId, { status: 'failed' });
      return res.json({ success: false, error: `Unknown provider: ${requestedProvider}` }, 400);
    }

    let usedProvider = requestedProvider;
    let responseText;
    try {
      responseText = await handler(userPrompt, log);
    } catch (providerErr) {
      // 🛟 Fallback ke Gemini kalau provider yang diminta gagal (mis. API
      // key-nya belum di-set) -- biar user tetap dapat jawaban daripada
      // error total.
      if (requestedProvider !== AIProviders.GEMINI) {
        error(`[${requestedProvider}] gagal, fallback ke Gemini: ${providerErr.message}`);
        usedProvider = AIProviders.GEMINI;
        responseText = await callGemini(userPrompt, log);
      } else {
        throw providerErr;
      }
    }

    // ⚠️ Attribute `reply` di collection chatbot_jobs dibatesin 10.000
    // karakter. Kalau balasan AI kebetulan lebih panjang dari itu (misal
    // user minta draft skrip panjang), databases.updateDocument() bakal
    // DITOLAK TOTAL sama Appwrite (bukan sekadar kepotong) -- seluruh
    // request jadi gagal (status: 'failed'). Dipotong di sini SUPAYA GAK
    // GAGAL TOTAL -- lebih baik balasan kepotong drpd request gagal.
    const MAX_REPLY_SIZE = 10000;
    if (responseText.length > MAX_REPLY_SIZE) {
      log(`WARNING: reply exceeds ${MAX_REPLY_SIZE} chars (${responseText.length}), truncating.`);
      responseText = responseText.slice(0, MAX_REPLY_SIZE);
    }

    // ✅ Hasil ditulis ke Database -- INI yang di-poll client, bukan
    // responseBody (selalu kosong buat async execution).
    await databases.updateDocument(DATABASE_ID, JOBS_COLLECTION_ID, requestId, {
      status: 'completed',
      reply: responseText,
      provider: usedProvider,
    });

    return res.json({ success: true });
  } catch (err) {
    error(`Error dari AI provider: ${err.message}`);
    if (requestId && databases) {
      try {
        await databases.updateDocument(DATABASE_ID, 'chatbot_jobs', requestId, { status: 'failed' });
      } catch (updateErr) {
        error(`Failed to update job status: ${updateErr.message}`);
      }
    }
    return res.json({ success: false, error: 'Failed to process AI' }, 500);
  }
};
