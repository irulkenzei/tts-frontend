import React, { useState, useRef, useEffect } from 'react';
import './ChatBot.css';

// Gemini Service
class GeminiService {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent';
  }

  async generateContent(prompt) {
    try {
      const response = await fetch(this.baseUrl + '?key=' + this.apiKey, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            temperature: 0.7,
            topK: 40,
            topP: 0.95,
            maxOutputTokens: 1024,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`API Error: ${response.status}`);
      }

      const data = await response.json();
      if (data.candidates && data.candidates[0]?.content?.parts?.[0]?.text) {
        return data.candidates[0].content.parts[0].text;
      }
      throw new Error('No response from Gemini');
    } catch (error) {
      console.error('Gemini API Error:', error);
      throw error;
    }
  }
}

const ChatBot = ({ onGenerateIdea, onWriteScript }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([
    {
      id: 1,
      type: 'bot',
      text: "👋 Hi! I'm your AI Narration Assistant. I can help you:\n\n• 💡 Generate narration ideas\n• 📝 Write scripts & dialogues\n• 🎯 Plan your content\n• 🎨 Refine your story\n\nWhat would you like help with?",
      timestamp: new Date(),
    },
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef(null);
  const geminiService = useRef(null);

  // Initialize Gemini Service
  useEffect(() => {
    const apiKey = process.env.REACT_APP_GEMINI_API_KEY;
    if (!apiKey) {
      console.warn('REACT_APP_GEMINI_API_KEY not found in environment variables');
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now(),
          type: 'bot',
          text: '⚠️ Gemini API key not configured. Please add REACT_APP_GEMINI_API_KEY to your .env file.',
          timestamp: new Date(),
          isError: true,
        },
      ]);
    } else {
      geminiService.current = new GeminiService(apiKey);
    }
  }, []);

  // Auto scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Quick suggestion buttons
  const quickSuggestions = [
    {
      text: '💡 Generate Ideas',
      prompt:
        'Please give me 5 creative narration ideas for different topics (e.g., technology, history, motivation, education, entertainment). For each idea, provide a brief description and suggest the tone/style.',
    },
    {
      text: '📝 Write a Script',
      prompt:
        'Help me write a short 2-3 minute dialogue script about a conversation between two characters. Make it engaging and suitable for voice-over narration. Include character names and stage directions.',
    },
    {
      text: '🎯 Content Tips',
      prompt:
        'What are the best practices for creating engaging narration content? Give me 7 tips on how to write better scripts, improve voice performance, and keep audiences engaged.',
    },
  ];

  const handleSendMessage = async () => {
    if (!inputValue.trim()) return;
    if (!geminiService.current) {
      alert('Gemini API not configured');
      return;
    }

    // Add user message
    const userMessage = {
      id: Date.now(),
      type: 'user',
      text: inputValue,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);

    try {
      // Get response from Gemini
      const response = await geminiService.current.generateContent(inputValue);

      // Add bot response
      const botMessage = {
        id: Date.now() + 1,
        type: 'bot',
        text: response,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, botMessage]);
    } catch (error) {
      const errorMessage = {
        id: Date.now() + 1,
        type: 'bot',
        text: `❌ Error: ${error.message}. Please try again or check your API key.`,
        timestamp: new Date(),
        isError: true,
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickSuggestion = async (suggestion) => {
    // Add user message
    const userMessage = {
      id: Date.now(),
      type: 'user',
      text: suggestion.prompt,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);

    try {
      // Get response from Gemini
      const response = await geminiService.current.generateContent(suggestion.prompt);

      // Add bot response
      const botMessage = {
        id: Date.now() + 1,
        type: 'bot',
        text: response,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, botMessage]);
    } catch (error) {
      const errorMessage = {
        id: Date.now() + 1,
        type: 'bot',
        text: `❌ Error: ${error.message}. Please try again.`,
        timestamp: new Date(),
        isError: true,
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleUseResponse = (text) => {
    // Parse text ke textarea
    if (text.includes('dialogue') || text.includes('script')) {
      onWriteScript(text);
    } else {
      onGenerateIdea(text);
    }
    setIsOpen(false);
  };

  return (
    <>
      {/* Chat Button (Floating) */}
      {!isOpen && (
        <button className="chatbot-float-btn" onClick={() => setIsOpen(true)}>
          💬
        </button>
      )}

      {/* Chat Panel */}
      {isOpen && (
        <div className="chatbot-container">
          {/* Header */}
          <div className="chatbot-header">
            <h3>🤖 AI Narration Assistant</h3>
            <button className="chatbot-close-btn" onClick={() => setIsOpen(false)}>
              ✕
            </button>
          </div>

          {/* Messages Area */}
          <div className="chatbot-messages">
            {messages.map((msg) => (
              <div key={msg.id} className={`chat-message ${msg.type} ${msg.isError ? 'error' : ''}`}>
                <div className="message-content">
                  <p>{msg.text}</p>
                  {msg.type === 'bot' && !msg.isError && (
                    <button
                      className="use-response-btn"
                      onClick={() => handleUseResponse(msg.text)}
                    >
                      📝 Use This
                    </button>
                  )}
                </div>
                <span className="message-time">
                  {msg.timestamp.toLocaleTimeString('en-US', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
            ))}
            {isLoading && (
              <div className="chat-message bot loading">
                <div className="message-content">
                  <div className="typing-indicator">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick Suggestions (Show when no custom messages) */}
          {messages.length <= 1 && !isLoading && (
            <div className="quick-suggestions">
              {quickSuggestions.map((suggestion, index) => (
                <button
                  key={index}
                  className="quick-btn"
                  onClick={() => handleQuickSuggestion(suggestion)}
                >
                  {suggestion.text}
                </button>
              ))}
            </div>
          )}

          {/* Input Area */}
          <div className="chatbot-input-area">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
              placeholder="Ask me anything about narration..."
              className="chatbot-input"
              disabled={isLoading}
            />
            <button
              onClick={handleSendMessage}
              className="chatbot-send-btn"
              disabled={isLoading || !inputValue.trim()}
            >
              {isLoading ? '⏳' : '📤'}
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default ChatBot;
