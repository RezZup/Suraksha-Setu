import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Mic, MicOff, Loader2 } from 'lucide-react';
import './StudentChat.css';

const API_URL = (process.env.REACT_APP_BACKEND_URL || 'http://localhost:8000') + '/api';
const STUDENT_CHAT_STORAGE_KEY = 'suraksha_student_chat_v1';
const STUDENT_WELCOME_MESSAGE = {
    id: 1,
    role: 'bot',
    text: "Namaste! 🙏 I'm **Gyan Setu** — your disaster-education buddy.\nAsk me anything about earthquakes, floods, cyclones, or safety! I can also quiz you. 🎯",
    timestamp: new Date(),
};

const QUICK_ACTIONS = [
    { label: '💡 Explain', prompt: 'Explain simply' },
    { label: '🧠 Quiz me', prompt: 'Quiz me about disasters' },
    { label: '📝 Example', prompt: 'Give me a real-life example' },
];

const MAX_HISTORY = 6;

function detectLanguage(text = '') {
    if (!text) return 'en-IN';
    if (/[\u0900-\u097F]/.test(text)) return 'hi-IN';
    if (/[\u0B80-\u0BFF]/.test(text)) return 'ta-IN';
    if (/[\u0C00-\u0C7F]/.test(text)) return 'te-IN';
    if (/[\u0980-\u09FF]/.test(text)) return 'bn-IN';
    return 'en-IN';
}

function confidenceLabel(score) {
    if (score >= 0.8) return { level: 'high', text: `${Math.round(score * 100)}% confident` };
    if (score >= 0.5) return { level: 'medium', text: `${Math.round(score * 100)}% confident` };
    return { level: 'low', text: `${Math.round(score * 100)}% confident` };
}

export default function StudentChat() {
    const [messages, setMessages] = useState(() => {
        try {
            const saved = localStorage.getItem(STUDENT_CHAT_STORAGE_KEY);
            if (!saved) return [STUDENT_WELCOME_MESSAGE];
            const parsed = JSON.parse(saved);
            if (!Array.isArray(parsed) || parsed.length === 0) return [STUDENT_WELCOME_MESSAGE];
            return parsed.map((msg) => ({
                ...msg,
                timestamp: msg?.timestamp ? new Date(msg.timestamp) : new Date(),
            }));
        } catch {
            return [STUDENT_WELCOME_MESSAGE];
        }
    });
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [recording, setRecording] = useState(false);
    const messagesEndRef = useRef(null);
    const inputRef = useRef(null);
    const mediaRecorderRef = useRef(null);

    // Auto-scroll
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    useEffect(() => {
        try {
            localStorage.setItem(
                STUDENT_CHAT_STORAGE_KEY,
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

    // ─── Send message ───
    const sendMessage = useCallback(async (text) => {
        if (!text?.trim() || loading) return;
        const userMsg = { id: Date.now(), role: 'user', text: text.trim(), timestamp: new Date() };
        setMessages(prev => [...prev.slice(-(MAX_HISTORY - 1)), userMsg]);
        setInput('');
        setLoading(true);

        try {
            const detectedLang = detectLanguage(userMsg.text);
            const res = await fetch(`${API_URL}/ai`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    query: userMsg.text,
                    role: 'student',
                    language: detectedLang,
                    locale: detectedLang,
                    context: { language: detectedLang, locale: detectedLang },
                }),
            });
            const data = await res.json();

            const botMsg = {
                id: Date.now() + 1,
                role: 'bot',
                text: data.response || data.answer || 'I could not process that. Try again!',
                timestamp: new Date(),
                confidence: data.confidence ?? null,
                tokenCost: data.token_cost ?? null,
                quiz: data.quiz ?? null,
                sources: data.sources ?? [],
                cached: data.cached ?? false,
            };
            setMessages(prev => [...prev.slice(-(MAX_HISTORY - 1)), botMsg]);
        } catch (err) {
            console.error('StudentChat error:', err);
            setMessages(prev => [
                ...prev,
                { id: Date.now() + 1, role: 'bot', text: 'Connection error — please retry.', timestamp: new Date() },
            ]);
        } finally {
            setLoading(false);
        }
    }, [loading]);

    // ─── Voice recording ───
    const toggleMic = useCallback(async () => {
        if (recording) {
            mediaRecorderRef.current?.stop();
            setRecording(false);
            return;
        }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mediaRecorder = new MediaRecorder(stream);
            const chunks = [];

            mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
            mediaRecorder.onstop = async () => {
                stream.getTracks().forEach(t => t.stop());
                const blob = new Blob(chunks, { type: 'audio/webm' });
                const formData = new FormData();
                formData.append('file', blob, 'recording.webm');
                formData.append('role', 'student');

                setLoading(true);
                try {
                    const res = await fetch(`${API_URL}/ai/voice?role=student`, { method: 'POST', body: formData });
                    const data = await res.json();
                    if (data.transcript) {
                        // Show transcript as user message
                        const userMsg = { id: Date.now(), role: 'user', text: data.transcript, timestamp: new Date() };
                        setMessages(prev => [...prev.slice(-(MAX_HISTORY - 1)), userMsg]);
                        // Show AI response
                        const botMsg = {
                            id: Date.now() + 1,
                            role: 'bot',
                            text: data.response || 'I could not process that. Try again!',
                            timestamp: new Date(),
                            confidence: data.usage ? 0.85 : null,
                            tokenCost: data.usage?.total_tokens ?? null,
                        };
                        setMessages(prev => [...prev.slice(-(MAX_HISTORY - 1)), botMsg]);
                    }
                } catch (err) {
                    console.error('Voice API error:', err);
                    setMessages(prev => [
                        ...prev,
                        { id: Date.now() + 1, role: 'bot', text: 'Voice transcription failed — please retry.', timestamp: new Date() },
                    ]);
                } finally {
                    setLoading(false);
                }
            };

            mediaRecorder.start();
            mediaRecorderRef.current = mediaRecorder;
            setRecording(true);
        } catch (err) {
            console.error('Mic access denied:', err);
        }
    }, [recording, sendMessage]);

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage(input);
        }
    };

    // ─── Render quiz card ───
    const renderQuiz = (quiz) => {
        if (!quiz?.questions?.length) return null;
        return (
            <div className="student-chat__quiz">
                <h4>🎯 Quiz: {quiz.topic || 'Disaster Safety'}</h4>
                {quiz.questions.map((q) => (
                    <QuizQuestion key={q.id} question={q} />
                ))}
            </div>
        );
    };

    return (
        <div className="student-chat" id="student-chat-widget">
            {/* Header */}
            <div className="student-chat__header">
                <div className="student-chat__header-icon">📚</div>
                <div className="student-chat__header-text">
                    <h3>Gyan Setu — Ask about disasters</h3>
                    <p>Powered by NDMA guidelines</p>
                </div>
                <div className="student-chat__header-badge">Learn Mode</div>
            </div>

            {/* Messages */}
            <div className="student-chat__messages">
                {messages.map((msg) => (
                    <div key={msg.id} className={`student-chat__msg student-chat__msg--${msg.role}`}>
                        <div className="student-chat__bubble">
                            {msg.role === 'bot' ? renderBotText(msg.text) : msg.text}

                            {/* Quiz */}
                            {msg.quiz && renderQuiz(msg.quiz)}

                            {/* Confidence badge */}
                            {msg.role === 'bot' && msg.confidence != null && (
                                <div className={`student-chat__confidence student-chat__confidence--${confidenceLabel(msg.confidence).level}`}>
                                    <span>●</span> {confidenceLabel(msg.confidence).text}
                                </div>
                            )}

                            {/* Token cost */}
                            {msg.role === 'bot' && msg.tokenCost != null && (
                                <div className="student-chat__token-cost">
                                    ~{msg.tokenCost} tokens {msg.cached ? '(cached)' : ''}
                                </div>
                            )}

                            {msg.role === 'bot' && msg.cached && (
                                <div className="student-chat__cache-hint">Fast reply from cache</div>
                            )}
                        </div>
                    </div>
                ))}

                {loading && (
                    <div className="student-chat__msg student-chat__msg--bot">
                        <div className="student-chat__typing">
                            <span className="student-chat__typing-dot" />
                            <span className="student-chat__typing-dot" />
                            <span className="student-chat__typing-dot" />
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Quick actions */}
            <div className="student-chat__quick-actions">
                {QUICK_ACTIONS.map((action) => (
                    <button
                        key={action.label}
                        className="student-chat__quick-btn"
                        onClick={() => sendMessage(action.prompt)}
                        disabled={loading}
                    >
                        {action.label}
                    </button>
                ))}
            </div>

            {/* Input */}
            <div className="student-chat__input-area">
                <input
                    ref={inputRef}
                    className="student-chat__input"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Ask about earthquakes, floods..."
                    disabled={loading}
                    id="student-chat-input"
                />
                <button
                    className={`student-chat__mic-btn ${recording ? 'student-chat__mic-btn--recording' : ''}`}
                    onClick={toggleMic}
                    title={recording ? 'Stop recording' : 'Voice input'}
                    id="student-chat-mic"
                >
                    {recording ? <MicOff size={16} /> : <Mic size={16} />}
                </button>
                <button
                    className="student-chat__send-btn"
                    onClick={() => sendMessage(input)}
                    disabled={!input.trim() || loading}
                    id="student-chat-send"
                >
                    {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                </button>
            </div>
        </div>
    );
}

// ─── Helpers ───

function renderBotText(text) {
    return text.split('\n').map((line, i) => {
        const parts = line.split(/(\*\*.*?\*\*)/g);
        return (
            <span key={i}>
                {parts.map((part, j) =>
                    part.startsWith('**') && part.endsWith('**')
                        ? <strong key={j}>{part.slice(2, -2)}</strong>
                        : part
                )}
                {i < text.split('\n').length - 1 && <br />}
            </span>
        );
    });
}

function QuizQuestion({ question }) {
    const [selected, setSelected] = useState(null);

    return (
        <div className="student-chat__quiz-question">
            <p>{question.id}. {question.question}</p>
            {question.options.map((opt, i) => {
                let cls = 'student-chat__quiz-option';
                if (selected !== null) {
                    const letter = opt.charAt(0);
                    if (letter === question.answer) cls += ' student-chat__quiz-option--correct';
                    else if (i === selected) cls += ' student-chat__quiz-option--wrong';
                }
                return (
                    <button
                        key={i}
                        className={cls}
                        onClick={() => selected === null && setSelected(i)}
                        disabled={selected !== null}
                    >
                        {opt}
                    </button>
                );
            })}
        </div>
    );
}
