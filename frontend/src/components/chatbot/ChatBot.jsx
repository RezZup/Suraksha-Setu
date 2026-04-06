import React, { useState, useEffect, useRef } from 'react';
import { MessageCircle, X, Send, Trash2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import axios from 'axios';
import ChatMessage from './ChatMessage';
import { motion, AnimatePresence } from 'framer-motion';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8000';
const API_URL = `${BACKEND_URL}/api/ai/chat`;
const DEFAULT_SUGGESTIONS = [
  'What should I do during an earthquake?',
  'How to prepare for a cyclone?',
  'Flood safety checklist for families',
  'Emergency contacts in India',
  'Heatwave precautions for children and elders',
];

const ChatBot = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [filteredSuggestions, setFilteredSuggestions] = useState([]);
  const [isTyping, setIsTyping] = useState(false);
  const scrollViewportRef = useRef(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const { user } = useAuth();

  const buildStorageKey = (id) => `chatbot_history_${id}`;

  // Generate session ID on mount
  useEffect(() => {
    const storedSessionId = localStorage.getItem('chatbot_session_id');
    if (storedSessionId) {
      setSessionId(storedSessionId);
      loadChatHistory(storedSessionId);
    } else {
      const newSessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      setSessionId(newSessionId);
      localStorage.setItem('chatbot_session_id', newSessionId);
      
      // Add welcome message for new sessions
      setMessages([{
        id: 'welcome',
        message: '',
        response: '👋 Hello! I\'m Suraksha Setu, your disaster management assistant. I can help you with:\n\n- **Real-time disaster alerts** and weather updates\n- **Emergency preparedness** tips and checklists\n- **Safety guidelines** for earthquakes, cyclones, floods, and more\n- **Air quality** information and health recommendations\n- **Evacuation** routes and shelter locations\n\nFeel free to ask me anything about staying safe during emergencies!',
        timestamp: new Date().toISOString(),
        isUser: false
      }]);
    }
  }, []);

  useEffect(() => {
    if (!sessionId || messages.length === 0) return;
    localStorage.setItem(buildStorageKey(sessionId), JSON.stringify(messages));
  }, [messages, sessionId]);

  // Load suggestions and focus input when opened
  useEffect(() => {
    if (isOpen) {
      if (suggestions.length === 0) {
        loadSuggestions();
      }
      // Focus input when chatbot opens
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, [isOpen]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    const scrollToBottom = () => {
      if (scrollViewportRef.current) {
        const viewport = scrollViewportRef.current.querySelector('[data-radix-scroll-area-viewport]');
        if (viewport) {
          setTimeout(() => {
            viewport.scrollTo({
              top: viewport.scrollHeight,
              behavior: 'smooth'
            });
          }, 100);
        }
      }
    };
    scrollToBottom();
  }, [messages, loading]);

  const loadChatHistory = async (sessionId) => {
    try {
      const stored = localStorage.getItem(buildStorageKey(sessionId));
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMessages(parsed);
          return;
        }
      }

      // Fall back to backend-persisted history for this session.
      const historyRes = await axios.get(`${BACKEND_URL}/api/ai/history`, {
        params: { session_id: sessionId, limit: 200 },
        timeout: 10000,
      });
      const rows = historyRes.data?.messages || [];
      if (Array.isArray(rows) && rows.length > 0) {
        const hydrated = rows.flatMap((row) => {
          const ts = row.timestamp || new Date().toISOString();
          return [
            {
              id: `${row.id}_u`,
              message: row.message || '',
              response: '',
              timestamp: ts,
              isUser: true,
            },
            {
              id: `${row.id}_b`,
              message: row.message || '',
              response: row.response || '',
              timestamp: ts,
              isUser: false,
            },
          ];
        });
        setMessages(hydrated);
        return;
      }

      setMessages([{
        id: 'welcome',
        message: '',
        response: '👋 Hello! I\'m Suraksha Setu, your disaster management assistant. Ask about weather, alerts, safety tips, and emergency readiness.',
        timestamp: new Date().toISOString(),
        isUser: false
      }]);
    } catch (error) {
      console.error('Error loading chat history:', error);
    }
  };

  const loadSuggestions = async () => {
    setSuggestions(DEFAULT_SUGGESTIONS);
    setFilteredSuggestions(DEFAULT_SUGGESTIONS.slice(0, 3));
  };

  // Filter suggestions based on user input
  useEffect(() => {
    if (!input.trim()) {
      setFilteredSuggestions(suggestions.slice(0, 3));
      return;
    }

    const inputLower = input.toLowerCase();
    const filtered = suggestions.filter(suggestion => 
      suggestion.toLowerCase().includes(inputLower) ||
      inputLower.split(' ').some(word => word.length > 2 && suggestion.toLowerCase().includes(word))
    );

    // If no matches, show smart suggestions based on keywords
    if (filtered.length === 0) {
      const smartSuggestions = getSmartSuggestions(inputLower);
      setFilteredSuggestions(smartSuggestions);
    } else {
      setFilteredSuggestions(filtered.slice(0, 3));
    }
  }, [input, suggestions]);

  // Get smart suggestions based on keywords - Comprehensive matching
  const getSmartSuggestions = (inputLower) => {
    const keywords = {
      // Earthquake
      'earth': ['What to do during earthquake?', 'Earthquake safety tips', 'Prepare for earthquakes'],
      'quake': ['Survive an earthquake', 'Earthquake preparedness', 'After earthquake safety'],
      // Flood  
      'flood': ['Flood safety measures', 'Stay safe in floods', 'Flood preparedness'],
      'rain': ['Heavy rainfall alerts', 'Monsoon safety', 'Flooding prevention'],
      'water': ['Water disaster safety', 'Waterlogging tips', 'Flood escape'],
      // Cyclone/Storm
      'cyclo': ['Cyclone safety tips', 'During cyclone actions', 'Cyclone preparation'],
      'storm': ['Storm safety', 'Prepare for storms', 'Storm warnings'],
      'wind': ['High wind safety', 'Storm damage prevention', 'Wind protection'],
      // Weather
      'weather': ['Current weather', 'Weather forecast', 'Weather alerts'],
      'forecast': ['Today weather', 'Weekly forecast', 'Weather predictions'],
      'temp': ['Temperature forecast', 'Heat wave safety', 'Cold weather tips'],
      // Air Quality
      'air': ['Air quality index', 'Is air safe?', 'Air pollution levels'],
      'aqi': ['Check AQI', 'Air quality today', 'What is AQI?'],
      'pollut': ['Air pollution effects', 'Protect from pollution', 'Pollution safety'],
      // Alerts
      'alert': ['Active alerts', 'Disaster warnings', 'Emergency notifications'],
      'warn': ['Disaster warnings', 'Alert notifications', 'Active warnings'],
      // Evacuation
      'evacu': ['Evacuation centers', 'Evacuation routes', 'How to evacuate'],
      'shelter': ['Emergency shelters', 'Find shelter', 'Shelter locations'],
      // Emergency
      'emerg': ['Emergency contacts', 'What to do emergency', 'Emergency kit'],
      'help': ['Get help', 'Emergency services', 'Helpline numbers'],
      'sos': ['Emergency SOS', 'Urgent help', 'Emergency response'],
      // Safety
      'safe': ['Safety tips', 'Stay safe', 'Safety guidelines'],
      'protect': ['Protect yourself', 'Safety measures', 'Protection tips'],
      // Preparation
      'prepar': ['Prepare for disasters', 'Preparedness checklist', 'Disaster preparation'],
      'ready': ['Be disaster ready', 'Prepare emergency', 'Readiness guide'],
      'kit': ['Emergency kit', 'Disaster kit items', 'Preparedness supplies'],
      // Fire
      'fire': ['Fire safety', 'During fire actions', 'Fire escape'],
      'burn': ['Fire prevention', 'Burn safety', 'Fire emergency'],
      // Tsunami
      'tsuna': ['Tsunami safety', 'Tsunami warnings', 'Coastal safety'],
      // Landslide
      'land': ['Landslide safety', 'Landslide causes', 'Mountain safety'],
      'slide': ['Prevent landslides', 'Slope safety', 'Hillside precautions'],
      // Question words
      'what': ['What is disaster management?', 'What disasters occur?', 'What to prepare?'],
      'how': ['How to stay safe?', 'How to prepare?', 'How to respond?'],
      'when': ['When to evacuate?', 'When disasters occur?', 'When seek help?'],
      'where': ['Where find shelter?', 'Where safe zones?', 'Where get help?']
    };

    // Match with partial keywords (first 3-4 chars)
    for (const [key, suggestionList] of Object.entries(keywords)) {
      const searchTerm = inputLower.length >= 3 ? inputLower.substring(0, Math.min(5, inputLower.length)) : inputLower;
      if (inputLower.includes(key) || key.includes(searchTerm)) {
        return suggestionList;
      }
    }

    // Default contextual suggestions
    if (inputLower.length < 3) {
      return ['Prepare for disasters', 'Emergency safety tips', 'Current weather alerts'];
    }

    return suggestions.slice(0, 3);
  };

  const sendMessage = async (messageText = null) => {
    const textToSend = messageText || input;
    if (!textToSend.trim() || loading) return;

    setLoading(true);
    const userMessage = {
      id: `temp_${Date.now()}`,
      message: textToSend,
      response: '',
      timestamp: new Date().toISOString(),
      isUser: true
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsTyping(true);

    try {
      const response = await axios.post(API_URL, {
        message: textToSend,
        query: textToSend,
        role: 'citizen',
        session_id: sessionId,
        user_id: user?.id,
        context: {
          user_location: 'India',
          session_id: sessionId,
          user_id: user?.id,
        }
      });

      // Add the bot response as a new message, keep the user message
      const botMessage = {
        id: response.data.id || `bot_${Date.now()}`,
        message: textToSend,
        response: response.data.response || response.data.answer || 'I could not generate a response right now.',
        timestamp: response.data.timestamp || new Date().toISOString(),
        isUser: false
      };
      
      setMessages(prev => [...prev, botMessage]);
      setIsTyping(false);
    } catch (error) {
      console.error('Error sending message:', error);
      setIsTyping(false);
      
      // Provide user-friendly error messages
      let errorMsg = 'Sorry, I encountered an error. Please try again in a moment.';
      
      if (error.response?.status === 503) {
        errorMsg = 'AI service is temporarily unavailable. Please try again in a moment.';
      } else if (error.response?.status === 500) {
        errorMsg = error.response?.data?.detail || 'Service temporarily unavailable. Please try again shortly.';
      } else if (error.response?.data?.detail) {
        errorMsg = error.response.data.detail;
      } else if (error.code === 'ECONNREFUSED' || error.message.includes('Network Error')) {
        errorMsg = 'Cannot connect to the server. Please check your internet connection and ensure the backend is running.';
      }
      
      // Add error message as bot response, keep user message
      const errorBotMessage = {
        id: `error_${Date.now()}`,
        message: textToSend,
        response: errorMsg,
        timestamp: new Date().toISOString(),
        isUser: false,
        error: true
      };
      
      setMessages(prev => [...prev, errorBotMessage]);
    } finally {
      setLoading(false);
    }
  };

  const clearHistory = async () => {
    if (window.confirm('Are you sure you want to clear chat history?')) {
      try {
        // Create new session
        const newSessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        if (sessionId) {
          localStorage.removeItem(buildStorageKey(sessionId));
        }
        setSessionId(newSessionId);
        localStorage.setItem('chatbot_session_id', newSessionId);
        
        // Add welcome message for fresh start
        setMessages([{
          id: 'welcome',
          message: '',
          response: '👋 Chat cleared! I\'m here to help with disaster management, safety tips, weather alerts, and emergency preparedness. What would you like to know?',
          timestamp: new Date().toISOString(),
          isUser: false
        }]);
      } catch (error) {
        console.error('Error clearing history:', error);
      }
    }
  };

  const handleSuggestionClick = (suggestion) => {
    sendMessage(suggestion);
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <>
      {/* Floating Button */}
      <AnimatePresence>
        {!isOpen && (
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            className="fixed bottom-6 right-6 z-50"
          >
            <Button
              onClick={() => setIsOpen(true)}
              size="lg"
              className="h-16 w-16 rounded-full shadow-2xl hover:shadow-3xl transition-all duration-300 hover:scale-110 bg-gradient-to-br from-primary to-primary/80"
              data-testid="chatbot-open-button"
              title="Open Disaster Assistant"
            >
              <MessageCircle className="h-7 w-7" />
              <span className="absolute -top-1 -right-1 h-5 w-5 bg-destructive rounded-full animate-pulse flex items-center justify-center">
                <span className="text-[10px] font-bold text-white">AI</span>
              </span>
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Chat Window */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.2 }}
            className="fixed bottom-6 right-6 z-50 w-[400px] h-[650px] flex flex-col"
          >
            <Card className="flex flex-col h-full shadow-2xl border-2">
              {/* Header */}
              <div className="flex items-center justify-between p-4 border-b bg-primary text-primary-foreground rounded-t-lg">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-primary-foreground/20 flex items-center justify-center">
                    <MessageCircle className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg" data-testid="chatbot-title">Suraksha Setu</h3>
                    <p className="text-xs opacity-90">Disaster Management Assistant</p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={clearHistory}
                    className="h-8 w-8 text-primary-foreground hover:bg-primary-foreground/20"
                    data-testid="chatbot-clear-button"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setIsOpen(false)}
                    className="h-8 w-8 text-primary-foreground hover:bg-primary-foreground/20"
                    data-testid="chatbot-close-button"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Messages */}
              <ScrollArea ref={scrollViewportRef} className="flex-1 p-4">
                {messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center space-y-4">
                    <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
                      <MessageCircle className="h-8 w-8 text-primary" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-lg mb-2">Welcome to Suraksha Setu! 🛡️</h4>
                      <p className="text-sm text-muted-foreground mb-4">
                        I'm your AI disaster management assistant. I can help you with real-time alerts, safety tips, emergency preparedness, and answer any questions about disasters and weather conditions in India.
                      </p>
                    </div>
                    {suggestions.length > 0 && (
                      <div className="w-full space-y-2">
                        <p className="text-xs text-muted-foreground">Try asking:</p>
                        {suggestions.slice(0, 3).map((suggestion, idx) => (
                          <Badge
                            key={idx}
                            variant="outline"
                            className="cursor-pointer hover:bg-primary/10 transition-colors w-full justify-start text-left py-2 px-3"
                            onClick={() => handleSuggestionClick(suggestion)}
                          >
                            {suggestion}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4" data-testid="chatbot-messages">
                    {messages.map((msg, idx) => (
                      <ChatMessage key={msg.id || idx} message={msg} />
                    ))}
                    {isTyping && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="flex items-center gap-3"
                      >
                        <div className="flex-shrink-0 h-8 w-8 rounded-full bg-secondary text-secondary-foreground flex items-center justify-center">
                          <MessageCircle className="h-4 w-4" />
                        </div>
                        <Card className="bg-muted p-3">
                          <div className="flex gap-1">
                            <motion.div
                              animate={{ scale: [1, 1.3, 1] }}
                              transition={{ repeat: Infinity, duration: 1, delay: 0 }}
                              className="w-2 h-2 bg-primary/60 rounded-full"
                            />
                            <motion.div
                              animate={{ scale: [1, 1.3, 1] }}
                              transition={{ repeat: Infinity, duration: 1, delay: 0.2 }}
                              className="w-2 h-2 bg-primary/60 rounded-full"
                            />
                            <motion.div
                              animate={{ scale: [1, 1.3, 1] }}
                              transition={{ repeat: Infinity, duration: 1, delay: 0.4 }}
                              className="w-2 h-2 bg-primary/60 rounded-full"
                            />
                          </div>
                        </Card>
                      </motion.div>
                    )}
                    <div ref={messagesEndRef} />
                  </div>
                )}
              </ScrollArea>

              {/* Quick Actions - Dynamic Suggestions */}
              {!loading && filteredSuggestions.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="px-4 pb-2 border-t pt-2 bg-muted/30"
                >
                  <p className="text-[10px] text-muted-foreground mb-1.5 px-1">
                    {input.trim() ? '💡 Related suggestions:' : '🚀 Quick actions:'}
                  </p>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {filteredSuggestions.map((suggestion, idx) => (
                      <motion.div
                        key={idx}
                        initial={{ scale: 0.9, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ delay: idx * 0.05 }}
                      >
                        <Badge
                          variant="secondary"
                          className="cursor-pointer hover:bg-primary hover:text-primary-foreground transition-all hover:scale-105 whitespace-nowrap text-xs"
                          onClick={() => handleSuggestionClick(suggestion)}
                        >
                          {suggestion.length > 35 ? suggestion.substring(0, 35) + '...' : suggestion}
                        </Badge>
                      </motion.div>
                    ))}
                  </div>
                </motion.div>
              )}

              {/* Input */}
              <div className="p-4 border-t bg-background">
                <div className="flex gap-2">
                  <Input
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyPress={handleKeyPress}
                    placeholder={loading ? "Please wait..." : "Ask about disasters, weather, safety..."}
                    disabled={loading}
                    className="flex-1"
                    data-testid="chatbot-input"
                  />
                  <Button
                    onClick={() => sendMessage()}
                    disabled={loading || !input.trim()}
                    size="icon"
                    className="transition-transform hover:scale-105"
                    data-testid="chatbot-send-button"
                  >
                    {loading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-2 text-center">
                  Press Enter to send • Shift+Enter for new line
                </p>
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

export default ChatBot;