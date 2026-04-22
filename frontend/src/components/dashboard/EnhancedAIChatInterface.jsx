import React, { useState, useRef, useEffect } from 'react';
import {
  MessageCircle, Send, Mic, MicOff, Loader2,
  Bot, User, Volume2, VolumeX, X, Minimize2, Maximize2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import AIInput from '@/components/ui/ai-input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import axios from 'axios';
import { useLocation as useAppLocation } from '@/contexts/LocationContext';
import { readTimedCache } from '@/utils/locationCache';

const API_URL = (process.env.REACT_APP_BACKEND_URL || 'http://localhost:8000') + '/api';
const DASHBOARD_CHAT_STORAGE_KEY = 'suraksha_dashboard_ai_chat_v1';
const WEATHER_BOOTSTRAP_CACHE_KEY = 'weather_dashboard_bootstrap_v1';
const DASHBOARD_WELCOME_MESSAGE = {
  id: 1,
  type: 'bot',
  text: 'Hi, I\'m Suraksha AI. Ask me anything about weather, disasters, safety, or emergency preparedness.',
  timestamp: new Date(),
};

const detectLanguage = (text = '') => {
  if (!text) return 'en-IN';
  if (/[\u0900-\u097F]/.test(text)) return 'hi-IN';
  if (/[\u0B80-\u0BFF]/.test(text)) return 'ta-IN';
  if (/[\u0C00-\u0C7F]/.test(text)) return 'te-IN';
  if (/[\u0980-\u09FF]/.test(text)) return 'bn-IN';
  const lower = text.toLowerCase();
    // Expanded Hinglish keyword detection (returns hi-IN for TTS, sent as hi-rom to backend)
    if (/(namaste|kaise|kya|mausam|barish|aaj|kal|kl|hogi|hoga|nahi|nhi|yaar|bhai|theek|thik|accha|achha|pata|chal|bata|skta|skti|ager|agar|sayd|shayad|bilkul|zaroor|bahut|bohot|ho\s|bas\s)/.test(lower)) return 'hi-IN';
  return 'en-IN';
};

const normalizeMessageText = (value, fallback = '') => {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return fallback;

  if (typeof value === 'object') {
    if (typeof value.text === 'string') return value.text;
    if (typeof value.message === 'string') return value.message;

    // Ignore UI events accidentally passed from click handlers.
    if (typeof value.preventDefault === 'function' || value.nativeEvent) {
      return fallback;
    }
  }

  return String(value);
};

const EnhancedAIChatInterface = () => {
  const { location: appLocation, alerts: appAlerts, gpsPincode, homePincode } = useAppLocation();
  const [messages, setMessages] = useState(() => {
    try {
      const saved = localStorage.getItem(DASHBOARD_CHAT_STORAGE_KEY);
      if (!saved) return [DASHBOARD_WELCOME_MESSAGE];
      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed) || parsed.length === 0) return [DASHBOARD_WELCOME_MESSAGE];
      return parsed.map((msg) => ({
        ...msg,
        timestamp: msg?.timestamp ? new Date(msg.timestamp) : new Date(),
      }));
    } catch {
      return [DASHBOARD_WELCOME_MESSAGE];
    }
  });
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false); // NEW: Voice conversation mode
  const [voiceInputMode, setVoiceInputMode] = useState('toggle'); // 'toggle' | 'ptt'
  const [detectedLanguage, setDetectedLanguage] = useState('en-IN'); // NEW: Auto-detected language
  const [liveTranscript, setLiveTranscript] = useState('');
  const liveTranscriptRef = useRef('');
  const pttHoldActiveRef = useRef(false);
  const [mediaRecorder, setMediaRecorder] = useState(null);
  const [audioChunks, setAudioChunks] = useState([]);
  const scrollAreaRef = useRef(null);
  const inputRef = useRef(null);
  const recognitionRef = useRef(null);

  const buildContextPayload = (detectedLang) => {
    const lat = Number(appLocation?.latitude ?? appLocation?.lat);
    const lon = Number(appLocation?.longitude ?? appLocation?.lon);
    const city = appLocation?.city || null;
    const state = appLocation?.state || null;
    const pinCode = appLocation?.gps_pincode || appLocation?.pin_code || gpsPincode || homePincode || null;

    const weatherCache = readTimedCache(WEATHER_BOOTSTRAP_CACHE_KEY);
    const weather = weatherCache?.weather || null;
    const aqi = weatherCache?.aqi || null;

    const alertSnapshot = Array.isArray(appAlerts)
      ? appAlerts.slice(0, 5).map((a) => ({
          id: a?.id,
          title: a?.title || a?.message || a?.description || 'Alert',
          severity: a?.severity || 'unknown',
          alert_type: a?.alert_type || a?.type || a?.report_type || 'general',
          location: a?.location || a?.location_data?.city || city || 'nearby',
        }))
      : [];

    return {
      domain: 'dashboard',
      language: detectedLang,
      locale: detectedLang,
      force_primary_llm: true,
      location: {
        city,
        state,
        pin_code: pinCode,
        lat: Number.isFinite(lat) ? lat : null,
        lon: Number.isFinite(lon) ? lon : null,
      },
      nearby_alerts: alertSnapshot,
      weather_snapshot: {
        condition: weather?.current?.condition || weather?.current?.weather || weather?.condition || null,
        temperature_c: weather?.current?.temperature || weather?.current?.temp || weather?.temperature || null,
        humidity: weather?.current?.humidity || weather?.humidity || null,
        wind_kph: weather?.current?.wind_speed || weather?.current?.wind_kph || weather?.wind_speed || null,
        aqi: aqi?.current?.aqi || aqi?.aqi || null,
      },
      data_timestamp: new Date().toISOString(),
    };
  };

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollAreaRef.current) {
      const scrollContainer = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }
  }, [messages]);

  useEffect(() => {
    try {
      localStorage.setItem(
        DASHBOARD_CHAT_STORAGE_KEY,
        JSON.stringify(
          messages.map((msg) => ({
            ...msg,
            timestamp:
              msg?.timestamp instanceof Date
                ? msg.timestamp.toISOString()
                : msg?.timestamp || new Date().toISOString(),
          }))
        )
      );
    } catch {
      // Ignore storage failures (private mode / quota limits)
    }
  }, [messages]);

  useEffect(() => {
    liveTranscriptRef.current = liveTranscript;
  }, [liveTranscript]);

  // Focus input on mount
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  // Load voices for better language support
  useEffect(() => {
    if ('speechSynthesis' in window) {
      // Load voices
      const loadVoices = () => {
        const voices = window.speechSynthesis.getVoices();
        console.log(`Loaded ${voices.length} voices for TTS`);
      };

      // Chrome loads voices asynchronously
      if (window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = loadVoices;
      }
      loadVoices();
    }
  }, []);

  const handleSendMessage = async (overrideText = null) => {
    const content = normalizeMessageText(overrideText, inputValue).trim();
    if (!content || isLoading) return;

    const userMessage = {
      id: Date.now(),
      type: 'user',
      text: content,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);

    try {
      const detectedLang = detectLanguage(userMessage.text);
      setDetectedLanguage(detectedLang);

      const response = await axios.post(`${API_URL}/ai/chat`, {
        message: content,
        query: content,
        role: 'citizen',
        language: detectedLang,
        locale: detectedLang,
        context: buildContextPayload(detectedLang),
      });

      const botText = normalizeMessageText(
        response?.data?.response ?? response?.data?.message,
        'I understood your request, but could not format the response. Please try again.'
      ).trim();

      const botMessage = {
        id: Date.now() + 1,
        type: 'bot',
        text: botText,
        timestamp: new Date(),
        data: response.data.data,
      };

      setMessages((prev) => [...prev, botMessage]);

      // Auto-speak response if speech synthesis is available
      if (botText) {
        speakText(botText, detectedLang);
      }
    } catch (error) {
      console.error('Error sending message:', error);
      const errorMessage = {
        id: Date.now() + 1,
        type: 'bot',
        text: '⚠️ I\'m having trouble connecting right now. Please check:\n• Your internet connection\n• Try again in a moment\n\n**Emergency Numbers:**\n• **112** - National Emergency\n• **1078** - NDMA Helpline',
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
      console.error('Failed to get chat response:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const clearConversation = () => {
    setMessages([
      {
        id: Date.now(),
        type: 'bot',
        text: 'Conversation cleared. Ask your next question about weather, alerts, emergency response, or preparedness.',
        timestamp: new Date(),
      },
    ]);
    setInputValue('');
    setLiveTranscript('');
    if (isSpeaking) stopSpeaking();
    if (isRecording) stopRecording();
  };

  // Voice Recording
  const startRecording = async () => {
    if (isRecording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType });
      const chunks = [];

      recorder.ondataavailable = (e) => {
        chunks.push(e.data);
      };

      recorder.onstop = async () => {
        const audioBlob = new Blob(chunks, { type: 'audio/webm' });
        await sendVoiceMessage(audioBlob, liveTranscriptRef.current);
        stream.getTracks().forEach(track => track.stop());
      };

      recorder.start();
      setMediaRecorder(recorder);
      setIsRecording(true);
      setAudioChunks(chunks);
      setLiveTranscript('');

      // Parallel browser speech recognition for live transcript display
      if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        const recog = new SR();
        recog.continuous = true;
        recog.interimResults = true;
          // Use detectedLanguage but try hi-IN for broader multilingual capture
          const recogLang = detectedLanguage && detectedLanguage !== 'en-IN' ? detectedLanguage : 'hi-IN';
          recog.lang = recogLang;
        recog.onresult = (event) => {
          const transcript = Array.from(event.results)
            .map(r => r[0]?.transcript || '')
            .join('')
            .trim();
          if (transcript) setLiveTranscript(transcript);
        };
          recog.onerror = (e) => {
            // If language model not available, retry with en-IN
            if (e.error === 'language-not-supported' && recog.lang !== 'en-IN') {
              try { recog.lang = 'en-IN'; recog.start(); } catch (_) {}
            }
          };
        try {
          recog.start();
          recognitionRef.current = recog;
        } catch (_) {}
      }
        toast.info('🎤 Listening... speak now', { duration: 2000 });
    } catch (error) {
      console.error('Error starting recording:', error);
      console.error('Microphone access denied');
    }
  };

  const stopRecording = () => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch (_) {}
      recognitionRef.current = null;
    }
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
      setIsRecording(false);
      // Processing voice
    }
  };

  const handleMicPressStart = (e) => {
    if (voiceInputMode !== 'ptt') return;
    e?.preventDefault?.();
    pttHoldActiveRef.current = true;
    startRecording();
  };

  const handleMicPressEnd = (e) => {
    if (voiceInputMode !== 'ptt') return;
    e?.preventDefault?.();
    if (!pttHoldActiveRef.current) return;
    pttHoldActiveRef.current = false;
    stopRecording();
  };

  const sendVoiceMessage = async (audioBlob, interimTranscript = '') => {
    setIsLoading(true);

    const userMessage = {
      id: Date.now(),
      type: 'user',
      text: interimTranscript?.trim() || '🎤 Voice message',
      timestamp: new Date(),
      isVoice: true
    };
    setMessages((prev) => [...prev, userMessage]);

    try {
      const formData = new FormData();
      formData.append('file', audioBlob, 'voice.webm');

        // Pass language hint so Sarvam STT picks the right model
        const hintLang = detectedLanguage || 'hi-IN';
        const response = await axios.post(`${API_URL}/ai/voice?role=citizen&language=${hintLang}`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
          timeout: 45000,
      });

      // Update user message with transcription
      setMessages((prev) =>
        prev.map(msg =>
          msg.id === userMessage.id
            ? { ...msg, text: response.data.transcript || '🎤 Voice message' }
            : msg
        )
      );

      // Add bot response
      const botMessage = {
        id: Date.now() + 1,
        type: 'bot',
        text: normalizeMessageText(response?.data?.response ?? response?.data?.message),
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, botMessage]);

      // Speak the response in detected speech language
        const rawLang = response.data.detected_language || detectLanguage(response.data.transcript || '');
        // Normalise to BCP-47 with -IN for Indian TTS (e.g. "hi" → "hi-IN")
        const transcriptLang = rawLang.includes('-') ? rawLang : (rawLang ? `${rawLang}-IN` : 'en-IN');
      setDetectedLanguage(transcriptLang || 'en-IN');
      speakText(response.data.response, transcriptLang || 'en-IN');
      setLiveTranscript('');

      // Voice processed
    } catch (error) {
      console.error('Error processing voice:', error);
      const isTimeout = error?.code === 'ECONNABORTED';
      const fallbackText = (interimTranscript || '').trim();

      // Best-effort recovery: if browser SR captured transcript, route it via text chat API.
      if (fallbackText) {
        try {
          const detectedLang = detectLanguage(fallbackText);
          const fallbackResponse = await axios.post(`${API_URL}/ai/chat`, {
            message: fallbackText,
            query: fallbackText,
            role: 'citizen',
            language: detectedLang,
            locale: detectedLang,
            context: {
              ...buildContextPayload(detectedLang),
              source: 'voice-fallback',
            },
          }, { timeout: 25000 });

          setMessages((prev) =>
            prev.map(msg =>
              msg.id === userMessage.id
                ? { ...msg, text: fallbackText }
                : msg
            ).concat({
              id: Date.now() + 2,
              type: 'bot',
              text: normalizeMessageText(
                fallbackResponse?.data?.response ?? fallbackResponse?.data?.message,
                'I heard you. Please retry once for better voice clarity.'
              ),
              timestamp: new Date(),
            })
          );
          toast.info('Recovered from voice issue using transcript');
        } catch (fallbackErr) {
          console.error('Voice fallback chat failed:', fallbackErr);
          setMessages((prev) =>
            prev.map(msg =>
              msg.id === userMessage.id
                ? { ...msg, text: fallbackText }
                : msg
            ).concat({
              id: Date.now() + 2,
              type: 'bot',
              text: isTimeout
                ? 'Voice request timed out. Try a shorter message (5-10 sec) and speak clearly.'
                : 'Voice failed and fallback also failed. Please type your message once.',
              timestamp: new Date(),
            })
          );
          toast.error('Voice + fallback failed');
        }
      } else {
        setMessages((prev) =>
          prev.map(msg =>
            msg.id === userMessage.id
              ? { ...msg, text: '🎤 Voice message (processing failed)' }
              : msg
          ).concat({
            id: Date.now() + 2,
            type: 'bot',
            text: isTimeout
              ? 'Voice request timed out. Try a shorter message (5-10 sec) and speak clearly.'
              : 'Could not capture enough voice. Please hold the mic and speak clearly, then release.',
            timestamp: new Date(),
          })
        );
        toast.error(isTimeout ? 'Voice request timed out' : 'Voice processing failed');
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Text-to-Speech with language support
  const speakText = async (text, languageCode = null) => {
    if (!text) return;

      // Normalise lang code — strip hi-rom (Sarvam TTS accepts hi-IN), ensure -IN suffix for Indian langs
      const rawLang = languageCode || detectedLanguage || 'en-IN';
      const lang = rawLang === 'hi-rom' ? 'hi-IN'
        : rawLang.includes('-') ? rawLang
        : rawLang ? `${rawLang}-IN` : 'en-IN';
    // Backend TTS first for consistent voice quality
    try {
      const ttsRes = await axios.post(
        `${API_URL}/ai/tts`,
          { text: text.substring(0, 600), language: lang, voice: 'alloy', speed: 1.05 },
        { responseType: 'blob' }
      );
      const audioUrl = URL.createObjectURL(ttsRes.data);
      const audio = new Audio(audioUrl);
      setIsSpeaking(true);
      audio.onended = () => { setIsSpeaking(false); URL.revokeObjectURL(audioUrl); };
      audio.onerror = () => { setIsSpeaking(false); URL.revokeObjectURL(audioUrl); };
      await audio.play();
      return;
    } catch (e) {
      // Fall back to browser speech synthesis
    }

    if (!('speechSynthesis' in window)) {
      console.warn('Speech synthesis not supported');
      return;
    }

    return new Promise((resolve) => {
      // Stop any ongoing speech
      window.speechSynthesis.cancel();

      // Clean text for speech
      const cleanText = text
        .replace(/\*\*/g, '')  // Remove bold markers
        .replace(/[•\-]/g, '')  // Remove bullet points
        .replace(/\n/g, '. ')   // Replace newlines with periods
        .replace(/#+/g, '')     // Remove markdown headers
        .substring(0, 500);     // Limit length

      const utterance = new SpeechSynthesisUtterance(cleanText);

      // Use detected language or default to Indian English
      utterance.lang = lang;

      utterance.rate = 0.9;
      utterance.pitch = 1.0;
      utterance.volume = 1.0;

      // Try to select best voice for the language
      const voices = window.speechSynthesis.getVoices();
      const preferredVoice = voices.find(voice =>
        voice.lang.startsWith(lang.split('-')[0]) &&
        (voice.lang.includes('IN') || voice.name.includes('India'))
      );

      if (preferredVoice) {
        utterance.voice = preferredVoice;
        console.log(`Using voice: ${preferredVoice.name} (${preferredVoice.lang})`);
      } else {
        console.log(`Using default voice for ${lang}`);
      }

      utterance.onstart = () => {
        setIsSpeaking(true);
        console.log(`Speaking in ${lang}...`);
      };

      utterance.onend = () => {
        setIsSpeaking(false);
        resolve();
      };

      utterance.onerror = (error) => {
        console.error('Speech synthesis error:', error);
        setIsSpeaking(false);
        resolve();
      };

      window.speechSynthesis.speak(utterance);
    });
  };

  const stopSpeaking = () => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const quickPrompts = [
    { icon: '🌤️', text: 'Today\'s weather', color: 'from-blue-500 to-cyan-500', shortText: 'Weather' },
    { icon: '💨', text: 'Air quality now', color: 'from-green-500 to-emerald-500', shortText: 'AQI' },
    { icon: '🌊', text: 'Flood safety tips', color: 'from-cyan-500 to-blue-600', shortText: 'Flood' },
    { icon: '⚡', text: 'Emergency kit list', color: 'from-orange-500 to-red-500', shortText: 'Kit' },
    { icon: '🏠', text: 'Earthquake safety', color: 'from-purple-500 to-pink-500', shortText: 'Earthquake' },
  ];

  const renderMessage = (message) => {
    const isBot = message.type === 'bot';

    // Format bot messages with markdown-like styling
    const formatText = (text) => {
      return text
        .split('\n')
        .map((line, i) => {
          // Bold text
          const parts = line.split(/(\*\*.*?\*\*)/g);
          const formatted = parts.map((part, j) => {
            if (part.startsWith('**') && part.endsWith('**')) {
              return <strong key={j} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
            }
            return part;
          });

          return (
            <span key={i}>
              {formatted}
              {i < text.split('\n').length - 1 && <br />}
            </span>
          );
        });
    };

    return (
      <motion.div
        initial={{ opacity: 0, y: 10, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className={`flex gap-2 ${isBot ? 'flex-row' : 'flex-row-reverse'} group`}
      >
        <Avatar className={`h-8 w-8 shrink-0 ${isBot ? 'bg-primary/10' : 'bg-primary'}`}>
          <AvatarFallback className={`${isBot ? 'text-primary' : 'text-primary-foreground'} bg-transparent`}>
            {isBot ? <Bot className="h-4 w-4" /> : <User className="h-4 w-4" />}
          </AvatarFallback>
        </Avatar>
        <div className={`flex-1 max-w-[85%] md:max-w-[75%] ${isBot ? '' : 'flex flex-col items-end'}`}>
          <div
            className={`rounded-2xl px-4 py-2.5 shadow-sm ${isBot
              ? 'bg-white/90 dark:bg-slate-900/80 text-foreground border border-cyan-100 dark:border-cyan-900/50'
              : 'bg-gradient-to-r from-cyan-600 to-emerald-600 text-white border border-cyan-500/30'
              }`}
          >
            <div className={`text-[13px] leading-relaxed ${isBot ? 'space-y-1' : ''}`}>
              {isBot ? formatText(message.text) : <span className="font-medium">{message.text}</span>}
            </div>
          </div>
          {message.data && (
            <div className="mt-1.5 flex gap-1.5 flex-wrap">
              {message.data.weather && (
                <Badge variant="secondary" className="text-[10px] gap-1 h-5 px-2">
                  🌡️ {message.data.weather.temperature}°C
                </Badge>
              )}
              {message.data.aqi && (
                <Badge variant="secondary" className="text-[10px] gap-1 h-5 px-2">
                  💨 AQI: {message.data.aqi.aqi}
                </Badge>
              )}
            </div>
          )}
          <p className={`text-[9px] text-muted-foreground mt-1 ${isBot ? '' : 'text-right'} opacity-0 group-hover:opacity-100 transition-opacity`}>
            {message.timestamp.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
      </motion.div>
    );
  };

  return (
    <Card className={`w-full ${isExpanded ? 'h-[78vh] min-h-[620px]' : 'h-[560px] md:h-[600px]'} flex flex-col shadow-xl border border-cyan-200/40 dark:border-cyan-900/40 overflow-hidden transition-all duration-300 bg-gradient-to-b from-slate-50 to-white dark:from-slate-900 dark:to-slate-950`}>
      {/* Immersive Header */}
      <CardHeader className="bg-gradient-to-r from-slate-900 via-cyan-900 to-emerald-900 text-white border-b border-white/10 pb-3 pt-3 px-4 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-11 h-11 rounded-xl bg-white/10 border border-white/20 backdrop-blur-sm flex items-center justify-center p-2">
                <img src="/ai_logo.png" alt="Suraksha AI" className="h-full w-full object-contain" />
              </div>
              <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 bg-emerald-400 rounded-full border-2 border-slate-900"></span>
            </div>
            <div>
              <CardTitle className="text-base font-semibold tracking-tight text-white">
                Suraksha AI
              </CardTitle>
              <div className="flex items-center gap-2 mt-1">
                <p className="text-[11px] text-cyan-100/90">Safety Assistant</p>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/15 border border-white/25">Live</span>
              </div>
            </div>
          </div>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setVoiceMode(!voiceMode);
                if (!voiceMode) {
                  // Voice mode enabled
                } else {
                  // Voice mode disabled
                  if (isRecording) stopRecording();
                }
              }}
              className={`h-8 w-8 rounded-lg transition-all ${voiceMode
                ? 'bg-emerald-400/20 text-emerald-200 hover:bg-emerald-400/30'
                : 'text-slate-300 hover:text-white'
                }`}
              title={voiceMode ? "Voice Mode: ON" : "Voice Mode: OFF"}
            >
              <Volume2 className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={clearConversation}
              className="h-8 px-2 text-[11px] text-slate-300 hover:text-white rounded-lg"
            >
              New
            </Button>
            {isSpeaking && (
              <Button
                variant="ghost"
                size="icon"
                onClick={stopSpeaking}
                className="h-8 w-8 text-slate-300 hover:text-white rounded-lg"
              >
                <VolumeX className="h-4 w-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsExpanded(!isExpanded)}
              className="h-8 w-8 text-slate-300 hover:text-white rounded-lg"
            >
              {isExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col p-0 space-y-0 overflow-hidden">
        {/* Quick Action Chips */}
        <div className="px-4 pt-3 pb-2 border-b border-cyan-100 dark:border-cyan-900/40 shrink-0 bg-white/70 dark:bg-slate-900/40 backdrop-blur-sm">
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            <AnimatePresence>
              {quickPrompts.map((prompt, i) => (
                <motion.button
                  key={i}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  transition={{ delay: i * 0.03 }}
                  onClick={() => handleSendMessage(prompt.text)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-semibold whitespace-nowrap transition-all border shadow-sm ${
                    i % 2 === 0
                      ? 'bg-cyan-50 text-cyan-900 border-cyan-200 hover:bg-cyan-100 dark:bg-cyan-950/30 dark:text-cyan-100 dark:border-cyan-900'
                      : 'bg-emerald-50 text-emerald-900 border-emerald-200 hover:bg-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-100 dark:border-emerald-900'
                  }`}
                >
                  <span className="text-sm">{prompt.icon}</span>
                  <span className="hidden md:inline">{prompt.shortText}</span>
                </motion.button>
              ))}
            </AnimatePresence>
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-2 text-[10px] text-muted-foreground">
            <span className="px-2 py-0.5 rounded-full bg-muted/70 border">Messages: {messages.length}</span>
            <span className="px-2 py-0.5 rounded-full bg-muted/70 border">Language: {detectedLanguage}</span>
            <span className="px-2 py-0.5 rounded-full bg-muted/70 border">Voice: {voiceMode ? 'On' : 'Off'}</span>
          </div>
        </div>

        {/* Messages Area */}
        <ScrollArea ref={scrollAreaRef} className="flex-1 px-4 bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.08),transparent_55%)] dark:bg-[radial-gradient(circle_at_top,rgba(16,185,129,0.12),transparent_55%)]">
          <div className="space-y-3 py-4">
            <AnimatePresence>
              {messages.map((message) => (
                <div key={message.id}>{renderMessage(message)}</div>
              ))}
            </AnimatePresence>
            {isLoading && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="flex gap-2"
              >
                <Avatar className="h-8 w-8 bg-primary/10">
                  <AvatarFallback className="text-primary bg-transparent">
                    <Bot className="h-4 w-4" />
                  </AvatarFallback>
                </Avatar>
                <div className="bg-white/90 dark:bg-slate-900/80 rounded-2xl px-4 py-3 border border-cyan-100 dark:border-cyan-900/50 shadow-sm">
                  <div className="flex gap-1.5">
                    <div className="w-1.5 h-1.5 bg-cyan-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-1.5 h-1.5 bg-cyan-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </motion.div>
            )}
          </div>
        </ScrollArea>

        {/* Input Area */}
        <div className="p-4 bg-white/80 dark:bg-slate-900/70 border-t border-cyan-100 dark:border-cyan-900/40 shrink-0 backdrop-blur-sm">
          {isRecording && (
            <div className="mb-2 text-xs text-muted-foreground">
              Listening: {liveTranscript || '...'}
            </div>
          )}
          <AIInput
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onSubmit={handleSendMessage}
            onMicClick={voiceInputMode === 'toggle' ? (isRecording ? stopRecording : startRecording) : undefined}
            onMicDown={handleMicPressStart}
            onMicUp={handleMicPressEnd}
            voiceInputMode={voiceInputMode}
            onVoiceInputModeChange={setVoiceInputMode}
            isRecording={isRecording}
            isLoading={isLoading}
            placeholder="Ask Suraksha AI..."
            disabled={isLoading}
          />
          <p className="mt-2 text-[11px] text-muted-foreground text-center">
            Press Enter to send. Use voice hold mode for quicker field updates.
          </p>
        </div>
      </CardContent>
    </Card>
  );
};

export default EnhancedAIChatInterface;
