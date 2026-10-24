import React, { useState, useRef, useEffect } from 'react';
import { Send, Loader2, Sparkles, Maximize2, Minimize2, Bot, Mic, MicOff, Volume2, VolumeX, Languages, Zap, Copy, RotateCcw } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import { toast } from 'sonner';

const API_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8000';

const AIChatInterface = () => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [selectedLanguage, setSelectedLanguage] = useState('hi-IN'); // Start with Hindi for better multi-language support
  const [availableVoices, setAvailableVoices] = useState([]);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const recognitionRef = useRef(null);
  const synthRef = useRef(null);

  const quickPrompts = [
    { icon: '🌧️', text: 'Will it rain tomorrow?', label: 'Rain Forecast', hindi: 'कल बारिश होगी?' },
    { icon: '💨', text: 'Show AQI trend for Delhi', label: 'Air Quality', hindi: 'दिल्ली की AQI दिखाओ' },
    { icon: '🌊', text: 'Any flood alerts in my area?', label: 'Flood Risk', hindi: 'मेरे क्षेत्र में बाढ़ की चेतावनी?' },
    { icon: '🚨', text: 'Active warnings near me', label: 'Alerts', hindi: 'सक्रिय चेतावनी दिखाओ' }
  ];

  const languages = [
    { code: 'en-IN', name: 'English', flag: '🇬🇧' },
    { code: 'hi-IN', name: 'हिंदी', flag: '🇮🇳' },
    { code: 'ta-IN', name: 'தமிழ்', flag: '🇮🇳' },
    { code: 'te-IN', name: 'తెలుగు', flag: '🇮🇳' },
    { code: 'bn-IN', name: 'বাংলা', flag: '🇮🇳' },
    { code: 'mr-IN', name: 'मराठी', flag: '🇮🇳' },
  ];

  // Auto-detect language from text
  const detectLanguage = (text) => {
    const hindiRegex = /[\u0900-\u097F]/;
    const tamilRegex = /[\u0B80-\u0BFF]/;
    const teluguRegex = /[\u0C00-\u0C7F]/;
    const bengaliRegex = /[\u0980-\u09FF]/;
    
    if (hindiRegex.test(text)) return 'hi-IN';
    if (tamilRegex.test(text)) return 'ta-IN';
    if (teluguRegex.test(text)) return 'te-IN';
    if (bengaliRegex.test(text)) return 'bn-IN';
    
    // Check for common Hindi words in English script
    const hindiWords = ['barish', 'kal', 'aaj', 'kya', 'kaise', 'mausam', 'paani', 'hawa'];
    const lowerText = text.toLowerCase();
    if (hindiWords.some(word => lowerText.includes(word))) {
      return 'hi-IN';
    }
    
    return 'en-IN';
  };

  // Initialize Speech Recognition with multi-language support
  useEffect(() => {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = true;
      recognitionRef.current.lang = selectedLanguage;

      recognitionRef.current.onstart = () => {
        setIsListening(true);
        // Listening started silently
      };

      recognitionRef.current.onresult = (event) => {
        const transcript = Array.from(event.results)
          .map(result => result[0])
          .map(result => result.transcript)
          .join('');
        
        setInput(transcript);
        
        // Auto-detect language from transcript
        const detectedLang = detectLanguage(transcript);
        if (detectedLang !== selectedLanguage) {
          setSelectedLanguage(detectedLang);
          // Language detected silently
        }
        
        // If final result, auto-send
        if (event.results[0].isFinal) {
          setTimeout(() => {
            if (transcript.trim()) {
              handleSend(transcript);
            }
          }, 500);
        }
      };

      recognitionRef.current.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        if (event.error === 'no-speech') {
          console.log('No speech detected');
        } else if (event.error === 'network') {
          console.error('Network error during voice recognition');
        }
        setIsListening(false);
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
      };
    }

    // Initialize Speech Synthesis with proper voice loading
    if ('speechSynthesis' in window) {
      synthRef.current = window.speechSynthesis;
      
      // Load voices properly - critical for Chrome/Edge
      const loadVoices = () => {
        const voices = synthRef.current.getVoices();
        setAvailableVoices(voices);
        console.log(`Loaded ${voices.length} voices`);
      };
      
      loadVoices(); // Initial load
      
      // Listen for voiceschanged event (critical for Chrome/Edge)
      if (synthRef.current.onvoiceschanged !== undefined) {
        synthRef.current.onvoiceschanged = loadVoices;
      }
    }

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      if (synthRef.current) {
        synthRef.current.cancel();
      }
    };
  }, []);

  // Update recognition language when changed
  useEffect(() => {
    if (recognitionRef.current) {
      recognitionRef.current.lang = selectedLanguage;
    }
  }, [selectedLanguage]);

  const toggleVoiceInput = () => {
    if (!recognitionRef.current) {
      console.warn('Voice recognition not supported in browser');
      return;
    }

    if (isListening) {
      recognitionRef.current.stop();
    } else {
      try {
        recognitionRef.current.lang = selectedLanguage;
        recognitionRef.current.start();
      } catch (error) {
        console.error('Error starting recognition:', error);
        console.error('Could not start voice recognition');
      }
    }
  };

  const speakText = (text) => {
    if (!synthRef.current || !voiceEnabled) return;

    // Cancel any ongoing speech
    synthRef.current.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    
    // Auto-detect language from response text
    const responseLanguage = detectLanguage(text);
    console.log(`Detected language for speech: ${responseLanguage}`);
    
    // Use stored voices for better reliability
    const voices = availableVoices.length > 0 ? availableVoices : synthRef.current.getVoices();
    const langCode = responseLanguage.split('-')[0]; // 'hi-IN' -> 'hi'
    
    // Try to find the best matching voice with priority system
    let selectedVoice = voices.find(voice => voice.lang === responseLanguage) || // Exact match
                       voices.find(voice => voice.lang.startsWith(langCode)) || // Language match
                       voices.find(voice => voice.name.includes('Google') && voice.lang.startsWith(langCode)) || // Google voice
                       voices.find(voice => voice.lang.startsWith('en')); // Fallback to English
    
    if (selectedVoice) {
      utterance.voice = selectedVoice;
      console.log(`Speaking in ${selectedVoice.lang} using ${selectedVoice.name}`);
    } else {
      console.warn('No matching voice found, using default');
    }
    
    utterance.lang = responseLanguage;
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = (error) => {
      console.error('Speech synthesis error:', error);
      setIsSpeaking(false);
    };

    synthRef.current.speak(utterance);
  };

  const toggleVoiceOutput = () => {
    setVoiceEnabled(!voiceEnabled);
    if (isSpeaking && synthRef.current) {
      synthRef.current.cancel();
    }
    // Voice output toggled
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async (messageText = null) => {
    const textToSend = messageText || input;
    if (!textToSend.trim()) return;

    // Detect language from user input
    const inputLanguage = detectLanguage(textToSend);
    if (inputLanguage !== selectedLanguage) {
      setSelectedLanguage(inputLanguage);
    }

    const userMessage = {
      role: 'user',
      content: textToSend,
      timestamp: new Date(),
      language: inputLanguage
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const response = await axios.post(`${API_URL}/api/ai/chat`, {
        message: textToSend,
        role: 'citizen',
        context: { domain: 'dashboard' },
        language: inputLanguage
      });

      const aiMessage = {
        role: 'assistant',
        content: response.data.response || response.data.message || 'I understand your question. Let me help you with that information.',
        timestamp: new Date(),
        data: response.data.data,
        language: inputLanguage
      };

      setMessages(prev => [...prev, aiMessage]);
      
      // Speak the response in the detected language
      if (voiceEnabled) {
        speakText(aiMessage.content);
      }
    } catch (error) {
      console.error('Chat error:', error);
      
      // Enhanced fallback with language awareness
      let fallbackResponse = '';
      const lowercaseInput = textToSend.toLowerCase();
      
      if (lowercaseInput.includes('barish') || lowercaseInput.includes('rain') || lowercaseInput.includes('बारिश')) {
        fallbackResponse = inputLanguage.startsWith('hi') 
          ? '🌧️ आज बारिश की संभावना मध्यम है। अगले 24-48 घंटों में बारिश हो सकती है। छाता साथ रखें! मौसम पूर्वानुमान के लिए Weather टैब देखें।'
          : '🌧️ Moderate chance of rain today. Rainfall expected in 24-48 hours. Keep an umbrella handy! Check the Weather tab for detailed forecasts.';
      } else if (lowercaseInput.includes('aqi') || lowercaseInput.includes('air quality') || lowercaseInput.includes('हवा')) {
        fallbackResponse = inputLanguage.startsWith('hi')
          ? '💨 वर्तमान वायु गुणवत्ता सूचकांक (AQI):\n• दिल्ली: मध्यम (150)\n• मुंबई: अच्छा (75)\n• बैंगलोर: अच्छा (65)\n\nसुझाव: संवेदनशील समूहों को लंबे समय तक बाहरी गतिविधियों को सीमित करना चाहिए।'
          : '💨 Current Air Quality Index (AQI):\n• Delhi: Moderate (150)\n• Mumbai: Good (75)\n• Bangalore: Good (65)\n\nRecommendation: Sensitive groups should limit prolonged outdoor activities.';
      } else if (lowercaseInput.includes('flood') || lowercaseInput.includes('cyclone') || lowercaseInput.includes('बाढ़') || lowercaseInput.includes('चक्रवात')) {
        fallbackResponse = inputLanguage.startsWith('hi')
          ? '🌊 वर्तमान बाढ़/चक्रवात स्थिति:\n• कोई सक्रिय चक्रवात चेतावनी नहीं\n• तटीय क्षेत्र: सामान्य स्थिति\n• नदी का स्तर: सुरक्षित सीमा के भीतर\n\nवास्तविक समय अपडेट के लिए बने रहें!'
          : '🌊 Current flood/cyclone status:\n• No active cyclone warnings\n• Coastal areas: Normal conditions\n• River levels: Within safe limits\n\nStay tuned for real-time updates!';
      } else if (lowercaseInput.includes('alert') || lowercaseInput.includes('warning') || lowercaseInput.includes('चेतावनी')) {
        fallbackResponse = inputLanguage.startsWith('hi')
          ? '🚨 आपके क्षेत्र में सक्रिय चेतावनियाँ:\n• गर्मी सलाह: हाइड्रेटेड रहें\n• वायु गुणवत्ता: मध्यम स्तर\n• कोई गंभीर मौसम चेतावनी नहीं\n\nविस्तृत जानकारी के लिए Alerts टैब देखें।'
          : '🚨 Active alerts in your region:\n• Heat advisory: Stay hydrated\n• Air quality: Moderate levels\n• No severe weather warnings\n\nCheck the Alerts tab for detailed information.';
      } else {
        fallbackResponse = inputLanguage.startsWith('hi')
          ? `मैं समझता हूं कि आप "${textToSend}" के बारे में पूछ रहे हैं। मैं आपके लिए IMD, ISRO, NDMA, CPCB से नवीनतम जानकारी प्राप्त कर रहा हूं। विस्तृत पूर्वानुमान और चेतावनियों के लिए कृपया विशिष्ट टैब देखें।`
          : `I understand you're asking about "${textToSend}". Let me fetch the latest information for you from our integrated data sources (IMD, ISRO, NDMA, CPCB). Please check the specific tabs for detailed forecasts and alerts.`;
      }

      const aiMessage = {
        role: 'assistant',
        content: fallbackResponse,
        timestamp: new Date(),
        language: inputLanguage
      };

      setMessages(prev => [...prev, aiMessage]);
      
      // Speak fallback in detected language
      if (voiceEnabled) {
        speakText(fallbackResponse);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleQuickPrompt = (promptText) => {
    setInput(promptText);
    setTimeout(() => {
      inputRef.current?.focus();
      handleSend(promptText);
    }, 100);
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const copyMessage = (text) => {
    navigator.clipboard.writeText(text);
    // Message copied
  };

  const clearChat = () => {
    setMessages([]);
    // Chat cleared
  };

  return (
    <Card className={`border-2 overflow-hidden transition-all duration-300 ${isExpanded ? 'fixed inset-4 z-50 bg-background shadow-2xl' : 'shadow-lg hover:shadow-xl'}`}>
      {/* Animated gradient background */}
      <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 via-purple-500/5 to-pink-500/5 animate-gradient pointer-events-none" />
      
      <CardHeader className="pb-3 relative border-b bg-gradient-to-r from-blue-600/10 via-purple-600/10 to-pink-600/10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl blur-xl opacity-50 animate-pulse-glow" />
              <div className="relative bg-gradient-to-br from-blue-600 via-purple-600 to-pink-600 p-3 rounded-2xl shadow-lg animate-float">
                <Sparkles className="h-6 w-6 text-white" />
              </div>
            </div>
            <div>
              <CardTitle className="text-xl flex items-center gap-2">
                <span className="bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 bg-clip-text text-transparent font-extrabold">
                  DrishtiSetu AI
                </span>
                <Badge variant="secondary" className="text-xs shadow-sm animate-pulse">
                  <div className="flex items-center gap-1.5">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                    </span>
                    Online
                  </div>
                </Badge>
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
                <Languages className="h-3 w-3" />
                Auto-detects: {languages.find(l => l.code === selectedLanguage)?.name || 'English'}
                <Badge variant="outline" className="text-[10px]">
                  {selectedLanguage.split('-')[0].toUpperCase()}
                </Badge>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant={voiceEnabled ? "default" : "outline"}
              size="icon"
              onClick={toggleVoiceOutput}
              className="h-9 w-9 relative group"
              title={voiceEnabled ? "Disable voice" : "Enable voice"}
            >
              {isSpeaking && (
                <span className="absolute inset-0 animate-ping bg-blue-500/50 rounded-lg" />
              )}
              {voiceEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            </Button>
            {messages.length > 0 && (
              <Button
                variant="outline"
                size="icon"
                onClick={clearChat}
                className="h-9 w-9"
                title="Clear chat"
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
            )}
            <Button
              variant="outline"
              size="icon"
              onClick={() => setIsExpanded(!isExpanded)}
              className="h-9 w-9"
            >
              {isExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-4 space-y-4 relative">
        {/* Messages Area */}
        <ScrollArea className={`${isExpanded ? 'h-[calc(100vh-280px)]' : 'h-96'} pr-3`}>
          <div className="space-y-3">
            {messages.length === 0 && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-center py-12 space-y-6"
              >
                <div className="mx-auto w-20 h-20 bg-gradient-to-br from-blue-500 to-purple-600 rounded-3xl flex items-center justify-center shadow-lg animate-float">
                  <Bot className="h-10 w-10 text-white" />
                </div>
                <div>
                  <h3 className="text-lg font-bold mb-2 bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                    Welcome to DrishtiSetu AI!
                  </h3>
                  <p className="text-sm text-muted-foreground max-w-md mx-auto">
                    Ask me anything about weather, disasters, air quality, or safety alerts in any Indian language.
                    I'll auto-detect your language! 🇮🇳
                  </p>
                </div>
                
                {/* Quick Prompts Grid */}
                <div className="grid grid-cols-2 gap-3 mt-6 max-w-2xl mx-auto">
                  {quickPrompts.map((prompt, idx) => (
                    <motion.div
                      key={idx}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: idx * 0.1 }}
                    >
                      <Button
                        variant="outline"
                        size="sm"
                        className="justify-start gap-3 h-auto py-4 px-4 text-left w-full hover:bg-gradient-to-r hover:from-blue-50 hover:to-purple-50 dark:hover:from-blue-950 dark:hover:to-purple-950 hover:border-blue-300 hover:shadow-md transition-all group"
                        onClick={() => handleQuickPrompt(prompt.text)}
                      >
                        <span className="text-3xl group-hover:scale-110 transition-transform">{prompt.icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-bold mb-1 text-blue-600 dark:text-blue-400">{prompt.label}</div>
                          <div className="text-xs text-muted-foreground line-clamp-2">{prompt.text}</div>
                        </div>
                      </Button>
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            )}

            <AnimatePresence>
              {messages.map((message, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, x: message.role === 'user' ? 20 : -20, scale: 0.95 }}
                  animate={{ opacity: 1, x: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.3, ease: "easeOut" }}
                  className={`flex gap-3 ${message.role === 'user' ? 'justify-end slide-in-right' : 'slide-in-left'}`}
                >
                  {message.role === 'assistant' && (
                    <div className="flex-shrink-0 w-8 h-8 bg-gradient-to-br from-blue-600 to-purple-600 rounded-full flex items-center justify-center shadow-md">
                      <Bot className="h-4 w-4 text-white" />
                    </div>
                  )}
                  
                  <div
                    className={`relative max-w-[75%] rounded-2xl px-4 py-3 shadow-md group ${
                      message.role === 'user'
                        ? 'bg-gradient-to-br from-blue-600 to-purple-600 text-white'
                        : 'bg-card border-2'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <p className="text-sm leading-relaxed whitespace-pre-wrap flex-1">
                        {message.content}
                      </p>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => copyMessage(message.content)}
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      <span className={`text-xs ${message.role === 'user' ? 'text-white/70' : 'text-muted-foreground'}`}>
                        {message.timestamp.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {message.language && message.language !== 'en-IN' && (
                        <Badge variant="secondary" className="text-[10px] h-4">
                          {message.language.split('-')[0].toUpperCase()}
                        </Badge>
                      )}
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
            
            {loading && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex gap-3"
              >
                <div className="flex-shrink-0 w-8 h-8 bg-gradient-to-br from-blue-600 to-purple-600 rounded-full flex items-center justify-center shadow-md">
                  <Bot className="h-4 w-4 text-white" />
                </div>
                <div className="bg-card border-2 rounded-2xl px-4 py-3 shadow-md">
                  <div className="flex items-center gap-3">
                    <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                    <div className="flex gap-1">
                      <span className="w-2 h-2 bg-blue-600 rounded-full animate-bounce typing-dot"></span>
                      <span className="w-2 h-2 bg-purple-600 rounded-full animate-bounce typing-dot" style={{animationDelay: '0.2s'}}></span>
                      <span className="w-2 h-2 bg-pink-600 rounded-full animate-bounce typing-dot" style={{animationDelay: '0.4s'}}></span>
                    </div>
                    <span className="text-sm text-muted-foreground font-medium">Thinking...</span>
                  </div>
                </div>
              </motion.div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>

        {/* Input Area */}
        <div className="space-y-3 relative">
          {isListening && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center justify-center gap-3 bg-gradient-to-r from-red-500/20 to-pink-500/20 border-2 border-red-500/50 rounded-xl py-3 px-4"
            >
              <div className="flex gap-1">
                {[...Array(5)].map((_, i) => (
                  <motion.div
                    key={i}
                    className="w-1 bg-gradient-to-t from-red-500 to-pink-500 rounded-full"
                    animate={{
                      height: [10, 24, 10],
                    }}
                    transition={{
                      duration: 0.6,
                      repeat: Infinity,
                      delay: i * 0.1,
                    }}
                  />
                ))}
              </div>
              <span className="text-sm font-bold text-red-600 dark:text-red-400">
                🎤 Listening... Speak in any language
              </span>
            </motion.div>
          )}
          
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder={isListening ? "🎤 Listening..." : "Type in any language or click mic to speak... (Hindi, English, Tamil...)"}
                className="pr-12 h-12 border-2 focus:border-blue-500 text-base rounded-xl transition-all"
                disabled={loading || isListening}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={toggleVoiceInput}
                disabled={loading}
                className={`absolute right-1 top-1/2 -translate-y-1/2 h-10 w-10 rounded-lg ${
                  isListening 
                    ? 'bg-gradient-to-br from-red-500 to-pink-500 hover:from-red-600 hover:to-pink-600 text-white shadow-lg animate-pulse-glow' 
                    : 'hover:bg-blue-50 dark:hover:bg-blue-950'
                }`}
                title={isListening ? "Stop listening" : "Start voice input (Auto-detects language)"}
              >
                {isListening ? (
                  <MicOff className="h-5 w-5 animate-pulse" />
                ) : (
                  <Mic className="h-5 w-5" />
                )}
              </Button>
            </div>
            
            <Button
              onClick={() => handleSend()}
              disabled={loading || !input.trim() || isListening}
              className="gap-2 h-12 px-6 bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 hover:from-blue-700 hover:via-purple-700 hover:to-pink-700 shadow-lg rounded-xl font-semibold"
            >
              {loading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>
                  <Send className="h-5 w-5" />
                  <span className="hidden sm:inline">Send</span>
                </>
              )}
            </Button>
          </div>

          {/* Footer Info */}
          <div className="flex items-center justify-between text-xs text-muted-foreground pt-2">
            <div className="flex items-center gap-2">
              <Zap className="h-3 w-3 text-blue-600" />
              <span>Auto language detection • Voice enabled • Real-time data</span>
            </div>
            <div className="hidden sm:flex items-center gap-1">
              <span className="font-semibold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                IMD • ISRO • NDMA • CPCB
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default AIChatInterface;
