import { GoogleGenerativeAI } from '@google/generative-ai';

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

export default async ({ req, res, log, error }) => {
  // Pastikan request adalah POST
  if (req.method === 'POST') {
    try {
      // Ambil prompt & provider dari body request (dari frontend/mobile app)
      const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const userPrompt = payload.prompt;
      const requestedProvider = payload.provider || AIProviders.GEMINI;

      if (!userPrompt) {
        return res.json({ error: 'The prompt cannot be empty.' }, 400);
      }

      const handler = PROVIDER_HANDLERS[requestedProvider];
      if (!handler) {
        return res.json({ error: `Unknown provider: ${requestedProvider}` }, 400);
      }

      let usedProvider = requestedProvider;
      let responseText;
      try {
        responseText = await handler(userPrompt, log);
      } catch (providerErr) {
        // 🛟 Fallback ke Gemini kalau provider yang diminta gagal (mis. API
        // key-nya belum di-set) -- biar user tetap dapat jawaban daripada
        // error total, terutama berguna selagi ChatGPT/Claude/Qwen masih
        // dalam proses setup API key satu-satu.
        if (requestedProvider !== AIProviders.GEMINI) {
          error(`[${requestedProvider}] gagal, fallback ke Gemini: ${providerErr.message}`);
          usedProvider = AIProviders.GEMINI;
          responseText = await callGemini(userPrompt, log);
        } else {
          throw providerErr;
        }
      }

      // Kembalikan respon ke frontend/mobile app
      return res.json({ reply: responseText, provider: usedProvider });
    } catch (err) {
      error(`Error dari AI provider: ${err.message}`);
      return res.json({ error: 'Failed to process AI' }, 500);
    }
  }
  // Jika bukan POST request
  return res.json({ message: 'Use the POST method.' });
};
