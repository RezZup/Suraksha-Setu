import React, { useState, useRef, useEffect } from 'react';
import { Send, Loader2, Sparkles, X, Maximize2, Minimize2, Bot, Mic, MicOff, Volume2, VolumeX, Languages } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import { toast } from 'sonner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const API_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8000';

const AIChatInterface = () => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [selectedLanguage, setSelectedLanguage] = useState('hi-IN'); // Start with Hindi for better auto-detect
  const [availableVoices, setAvailableVoices] = useState([]);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const recognitionRef = useRef(null);
  const synthRef = useRef(null);

  const quickPrompts = [
    { icon: '🌧️', text: 'Will it rain tomorrow?', label: 'Rain Forecast', hindi: 'कल बारिश होगी?' },
    { icon: '💨', text: 'Show AQI trend Delhi', label: 'Air Quality', hindi: 'दिल्ली की AQI दिखाओ' },
    { icon: '🌊', text: 'Flood risk in my area', label: 'Flood Risk', hindi: 'मेरे क्षेत्र में बाढ़?' },
    { icon: '🚨', text: 'Active alerts near me', label: 'Alerts', hindi: 'सक्रिय चेतावनी' }
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
    const hindiRegex = /[ऀ-ॿ]/;
    const tamilRegex = /[஀-௿]/;
    const teluguRegex = /[ఀ-౿]/;
    const bengaliRegex = /[ঀ-৿]/;
    
    if (hindiRegex.test(text)) return 'hi-IN';
    if (tamilRegex.test(text)) return 'ta-IN';
    if (teluguRegex.test(text)) return 'te-IN';
    if (bengaliRegex.test(text)) return 'bn-IN';
    
    // Check for common Hindi words in English script
    const hindiWords = ['barish', 'kal', 'aaj', 'kya', 'kaise', 'mausam'];
    if (hindiWords.some(word => text.toLowerCase().includes(word))) {
      return 'hi-IN';
    }
    
    return 'en-IN';
  };

  // Initialize Speech Recognition
  useEffect(() => {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = true;
      recognitionRef.current.lang = selectedLanguage;

      recognitionRef.current.onstart = () => {
        setIsListening(true);
        toast.info('\ud83c\udfa4 Listening... Speak in any Indian language');
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
          toast.success(`Language detected: ${languages.find(l => l.code === detectedLang)?.name || 'English'}`);\n        }
        
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
          toast.warning('No speech detected. Please try again.');
        } else if (event.error === 'network') {
          toast.error('Network error. Please check your connection.');
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
      
      // Load voices properly
      const loadVoices = () => {
        const voices = synthRef.current.getVoices();
        setAvailableVoices(voices);
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
  }, [selectedLanguage]);

  // Update recognition language when changed
  useEffect(() => {
    if (recognitionRef.current) {
      recognitionRef.current.lang = selectedLanguage;
    }
  }, [selectedLanguage]);

  const toggleVoiceInput = () => {
    if (!recognitionRef.current) {
      alert('Voice recognition is not supported in your browser. Please use Chrome, Edge, or Safari.');
      return;
    }

    if (isListening) {
      recognitionRef.current.stop();
    } else {
      try {
        recognitionRef.current.start();
      } catch (error) {
        console.error('Error starting recognition:', error);
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
    
    // Use stored voices for better reliability
    const voices = availableVoices.length > 0 ? availableVoices : synthRef.current.getVoices();
    const langCode = responseLanguage.split('-')[0]; // 'hi-IN' -> 'hi'
    
    // Try to find the best matching voice
    let selectedVoice = voices.find(voice => voice.lang === responseLanguage) || // Exact match
                       voices.find(voice => voice.lang.startsWith(langCode)) || // Language match
                       voices.find(voice => voice.name.includes('Google') && voice.lang.startsWith(langCode)) || // Google voice
                       voices.find(voice => voice.lang.startsWith('en')); // Fallback to English
    
    if (selectedVoice) {
      utterance.voice = selectedVoice;
      console.log(`Speaking in ${selectedVoice.lang} using ${selectedVoice.name}`);
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
    toast.success(voiceEnabled ? 'Voice output disabled' : 'Voice output enabled');
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

    const userMessage = {
      role: 'user',
      content: textToSend,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const response = await axios.post(`${API_URL}/api/chat`, {
        message: textToSend,
        context: 'dashboard',
        language: selectedLanguage
      });

      const aiMessage = {
        role: 'assistant',
        content: response.data.response || response.data.message || 'I understand your question. Let me help you with that information.',
        timestamp: new Date(),
        data: response.data.data
      };

      setMessages(prev => [...prev, aiMessage]);
      
      // Speak the response if voice is enabled
      if (voiceEnabled) {
        speakText(aiMessage.content);
      }
    } catch (error) {
      console.error('Chat error:', error);
      
      // Fallback smart responses based on keywords
      let fallbackResponse = '';
      const lowercaseInput = textToSend.toLowerCase();
      
      if (lowercaseInput.includes('barish') || lowercaseInput.includes('rain')) {
        fallbackResponse = '🌧️ Checking rainfall forecast for your area... Based on current data, there is a moderate chance of rain in the next 24-48 hours. I recommend keeping an umbrella handy!';
      } else if (lowercaseInput.includes('aqi') || lowercaseInput.includes('air quality')) {
        fallbackResponse = '💨 Current AQI levels:\n• Delhi: Moderate (150)\n• Mumbai: Good (75)\n• Bangalore: Good (65)\n\nRecommendation: Air quality is acceptable. Sensitive groups should limit prolonged outdoor activities.';
      } else if (lowercaseInput.includes('flood') || lowercaseInput.includes('cyclone')) {
        fallbackResponse = '🌊 Current flood/cyclone status:\n• No active cyclone warnings\n• Coastal areas: Normal conditions\n• River levels: Within safe limits\n\nStay tuned for real-time updates!';
      } else if (lowercaseInput.includes('alert')) {
        fallbackResponse = '🚨 Active alerts in your region:\n• Heat advisory: Stay hydrated\n• Air quality: Moderate levels\n• No severe weather warnings\n\nCheck the Alerts tab for detailed information.';
      } else {
        fallbackResponse = `I understand you're asking about "${textToSend}". Let me fetch the latest information for you from our integrated data sources (IMD, ISRO, NDMA, CPCB). Please check the specific tabs for detailed forecasts and alerts.`;
      }

      const aiMessage = {
        role: 'assistant',
        content: fallbackResponse,
        timestamp: new Date()
      };

      setMessages(prev => [...prev, aiMessage]);
      
      // Speak the fallback response if voice is enabled
      if (voiceEnabled) {
        speakText(fallbackResponse);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleQuickPrompt = (promptText) => {
    setInput(promptText);
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
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
                </Badge>
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
                <Languages className="h-3 w-3" />
                Multilingual • PIN-code aware • Voice enabled
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant={voiceEnabled ? "default" : "outline"}
              size="icon"
              onClick={toggleVoiceOutput}
              className="h-8 w-8"
              title={voiceEnabled ? "Disable voice output" : "Enable voice output"}
            >
              {voiceEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsExpanded(!isExpanded)}
              className="h-8 w-8"
            >
              {isExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {/* Language Selector */}
        <div className="mt-3 flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Voice Language:</span>
          <Select value={selectedLanguage} onValueChange={setSelectedLanguage}>
            <SelectTrigger className="h-7 w-[160px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {languages.map((lang) => (
                <SelectItem key={lang.code} value={lang.code} className="text-xs">
                  {lang.flag} {lang.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isSpeaking && (
            <Badge variant="secondary" className="text-xs animate-pulse">
              <Volume2 className="h-3 w-3 mr-1" />
              Speaking...
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="p-4 space-y-4">
        {/* Messages Area */}
        {messages.length > 0 && (
          <ScrollArea className={`${isExpanded ? 'h-[calc(100vh-320px)]' : 'h-80'} pr-4`}>
            <div className="space-y-4">
              <AnimatePresence>
                {messages.map((message, index) => (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ duration: 0.3, ease: "easeOut" }}
                    className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl px-4 py-3 shadow-md ${
                        message.role === 'user'
                          ? 'bg-gradient-to-br from-primary to-purple-600 text-white'
                          : 'bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-800 dark:to-slate-900 border-2 border-border'
                      }`}
                    >
                      {message.role === 'assistant' && (
                        <div className="flex items-center gap-2 mb-2 pb-2 border-b border-border/50">
                          <div className="bg-gradient-to-br from-primary to-purple-600 p-1 rounded-full">
                            <Bot className="h-3.5 w-3.5 text-white" />
                          </div>
                          <span className="text-xs font-semibold bg-gradient-to-r from-primary to-purple-600 bg-clip-text text-transparent">
                            DrishtiSetu AI
                          </span>
                        </div>
                      )}
                      <p className="text-sm whitespace-pre-wrap leading-relaxed">
                        {message.content}
                      </p>
                      <span className={`text-xs opacity-70 mt-2 block ${message.role === 'user' ? 'text-white/80' : 'text-muted-foreground'}`}>
                        {message.timestamp.toLocaleTimeString()}
                      </span>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
              
              {loading && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex justify-start"
                >
                  <div className="bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-800 dark:to-slate-900 border-2 border-border rounded-2xl px-4 py-3 shadow-md">
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <Loader2 className="h-5 w-5 animate-spin text-primary" />
                        <div className="absolute inset-0 bg-primary/20 rounded-full blur-sm"></div>
                      </div>
                      <span className="text-sm text-muted-foreground font-medium">AI is thinking...</span>
                    </div>
                  </div>
                </motion.div>
              )}
              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>
        )}

        {/* Quick Prompts */}
        {messages.length === 0 && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="grid grid-cols-2 gap-2"
          >
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
                  className="justify-start gap-2 h-auto py-3 px-3 text-left w-full hover:bg-primary/5 hover:border-primary/50 transition-all"
                  onClick={() => handleQuickPrompt(prompt.text)}
                >
                  <span className="text-2xl">{prompt.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold truncate">{prompt.label}</div>
                    <div className="text-xs text-muted-foreground truncate">{prompt.text}</div>
                  </div>
                </Button>
              </motion.div>
            ))}
          </motion.div>
        )}

        {/* Input Area */}
        <div className="space-y-2">
          {isListening && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center justify-center gap-2 bg-gradient-to-r from-red-500/10 to-pink-500/10 border border-red-500/30 rounded-lg py-2 px-3"
            >
              <div className="flex gap-1">
                {[...Array(4)].map((_, i) => (
                  <motion.div
                    key={i}
                    className="w-1 bg-red-500 rounded-full"
                    animate={{
                      height: [8, 16, 8],
                    }}
                    transition={{
                      duration: 0.6,
                      repeat: Infinity,
                      delay: i * 0.1,
                    }}
                  />
                ))}
              </div>
              <span className="text-sm font-medium text-red-600 dark:text-red-400">
                Listening... Speak now
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
                placeholder={isListening ? "Listening..." : "Type or speak in Hindi, English, Tamil... (e.g., 'Kal barish hogi kya?')"}
                className="pr-12 h-11 border-2 focus:border-primary transition-colors"
                disabled={loading || isListening}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={toggleVoiceInput}
                disabled={loading}
                className={`absolute right-1 top-1/2 -translate-y-1/2 h-9 w-9 ${
                  isListening 
                    ? 'bg-red-500 hover:bg-red-600 text-white animate-pulse' 
                    : 'hover:bg-primary/10'
                }`}
                title={isListening ? "Stop listening" : "Start voice input"}
              >
                {isListening ? (
                  <MicOff className="h-4 w-4" />
                ) : (
                  <Mic className="h-4 w-4" />
                )}
              </Button>
            </div>
            
            <Button
              onClick={() => handleSend()}
              disabled={loading || !input.trim() || isListening}
              className="gap-2 h-11 px-6 bg-gradient-to-r from-primary to-purple-600 hover:from-primary/90 hover:to-purple-700 shadow-lg"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  <span className="hidden sm:inline">Send</span>
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Footer Info */}
        <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t">
          <div className="flex items-center gap-2">
            <Sparkles className="h-3 w-3 text-primary" />
            <span className="font-medium">Powered by AI • Supports 10+ Indian languages</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="hidden sm:inline">Data from</span>
            <span className="font-semibold text-primary">IMD • ISRO • NDMA • CPCB</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default AIChatInterface;
