import React, { useState, useRef, useEffect } from 'react';
import { Client, Functions } from 'appwrite';
import '../styles/ChatBot.css';

// Konfigurasi Appwrite (Sama dengan yang ada di App.jsx Anda)
const APPWRITE_ENDPOINT = 'https://fra.cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = '6a3a48a1003d333b0268';
const GEMINI_FUNCTION_ID = '76589327sdfuuiuxcf53'; // Ganti dengan Function ID dari Appwrite Console

const client = new Client()
    .setEndpoint(APPWRITE_ENDPOINT)
    .setProject(APPWRITE_PROJECT_ID);
const appwriteFunctions = new Functions(client);

// 🧩 Daftar provider yang bisa dipilih -- harus PERSIS sama dengan key di
// `AIProviders` / `PROVIDER_HANDLERS` pada functions/gemini-chatbot/src/main.js.
// Kalau nambah provider baru di main.js, tambahkan juga di sini.
const AI_PROVIDERS = [
  { value: 'gemini', label: 'Gemini (Free)' },
  { value: 'chatgpt', label: 'ChatGPT' },
  { value: 'claude', label: 'Claude' },
  { value: 'qwen', label: 'Qwen' },
];

const Chatbot = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([
    { text: "Hello! Is there anything I can help you with regarding scripts or narration?", isBot: true }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [provider, setProvider] = useState('gemini');
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMessage = input.trim();
    setMessages(prev => [...prev, { text: userMessage, isBot: false }]);
    setInput('');
    setIsLoading(true);

    try {
      // Memanggil Appwrite Function -- sekarang ikut kirim `provider` yang
      // dipilih user dari dropdown. Kalau provider itu gagal (mis. API key
      // belum di-set di server), main.js otomatis fallback ke Gemini, dan
      // field `provider` di response bakal nunjukin provider yang BENERAN
      // kepakai (bisa beda dari yang diminta kalau fallback kejadian).
      const execution = await appwriteFunctions.createExecution(
        GEMINI_FUNCTION_ID,
        JSON.stringify({ prompt: userMessage, provider }),
        false // false = mode synchronous (wait until the AI replies)
      );
      const responseData = JSON.parse(execution.responseBody);

      if (responseData.error) {
        throw new Error(responseData.error);
      }

      // Kasih tau user kalau provider yang beneran jawab beda dari yang
      // dipilih (fallback) -- transparan, bukan diam-diam ganti.
      const fellBack = responseData.provider && responseData.provider !== provider;
      const replyText = fellBack
        ? `${responseData.reply}\n\n(⚠️ ${provider} unavailable, answered by ${responseData.provider})`
        : responseData.reply;

      setMessages(prev => [...prev, { text: replyText, isBot: true }]);
    } catch (error) {
      console.error("Chatbot Error:", error);
      setMessages(prev => [...prev, { text: "Sorry, a network error occurred or the function is not yet ready.", isBot: true }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="chatbot-wrapper">
      <button className="chatbot-toggle-btn" onClick={() => setIsOpen(!isOpen)}>
        {isOpen ? '✕' : '🤖 AI Chat'}
      </button>

      {isOpen && (
        <div className="chatbot-window">
          <div className="chatbot-header">
            <h3>AI Assistant</h3>
            {/* 🧩 Dropdown pilihan provider -- dikirim sebagai `provider`
                di payload createExecution di atas. */}
            <select
              className="chatbot-provider-select"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              disabled={isLoading}
            >
              {AI_PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>

          <div className="chatbot-messages">
            {messages.map((msg, index) => (
              <div key={index} className={`message ${msg.isBot ? 'bot' : 'user'}`}>
                {msg.text}
              </div>
            ))}
            {isLoading && <div className="message bot typing">Typing...</div>}
            <div ref={messagesEndRef} />
          </div>

          <form onSubmit={handleSend} className="chatbot-input-form">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Write a message..."
              disabled={isLoading}
            />
            <button type="submit" disabled={isLoading || !input.trim()}>➤</button>
          </form>
        </div>
      )}
    </div>
  );
};

export default Chatbot;
