import React, { useState, useRef, useEffect } from 'react';
import { Client, Functions } from 'appwrite';
import './ChatBot.css'; 

// Konfigurasi Appwrite (Sama dengan yang ada di App.jsx Anda)
const APPWRITE_ENDPOINT = 'https://fra.cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = '6a3a48a1003d333b0268';
const GEMINI_FUNCTION_ID = '76589327sdfuuiuxcf53'; // Ganti dengan Function ID dari Appwrite Console

const client = new Client()
    .setEndpoint(APPWRITE_ENDPOINT)
    .setProject(APPWRITE_PROJECT_ID);

const appwriteFunctions = new Functions(client);

const Chatbot = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([
    { text: "Halo! Ada yang bisa saya bantu terkait skrip atau narasi?", isBot: true }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
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
      // Memanggil Appwrite Function yang sudah kita buat
      const execution = await appwriteFunctions.createExecution(
        GEMINI_FUNCTION_ID,
        JSON.stringify({ prompt: userMessage }),
        false // false = mode synchronous (tunggu sampai AI membalas)
      );

      const responseData = JSON.parse(execution.responseBody);
      
      if (responseData.error) {
        throw new Error(responseData.error);
      }

      setMessages(prev => [...prev, { text: responseData.reply, isBot: true }]);
    } catch (error) {
      console.error("Chatbot Error:", error);
      setMessages(prev => [...prev, { text: "Maaf, terjadi kesalahan jaringan atau fungsi belum siap.", isBot: true }]);
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
            <h3>Gemini Assistant</h3>
          </div>
          
          <div className="chatbot-messages">
            {messages.map((msg, index) => (
              <div key={index} className={`message ${msg.isBot ? 'bot' : 'user'}`}>
                {msg.text}
              </div>
            ))}
            {isLoading && <div className="message bot typing">Mengetik...</div>}
            <div ref={messagesEndRef} />
          </div>

          <form onSubmit={handleSend} className="chatbot-input-form">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Tulis pesan..."
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
