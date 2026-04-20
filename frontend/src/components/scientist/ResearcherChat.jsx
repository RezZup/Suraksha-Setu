import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Download, Loader2 } from 'lucide-react';
import './ResearcherChat.css';

const API_URL = (process.env.REACT_APP_BACKEND_URL || 'http://localhost:8000') + '/api';
const RESEARCHER_CHAT_STORAGE_KEY = 'suraksha_researcher_chat_v1';
const RESEARCHER_SETTINGS_STORAGE_KEY = 'suraksha_researcher_chat_settings_v1';
const RESEARCHER_WELCOME_MESSAGE = {
    id: 1,
    role: 'bot',
    text: "Welcome to **Vigyan Drishti**.\nI can analyze disaster data, generate structured reports, and provide source-cited summaries.\nToggle **RAG mode** for document-grounded answers.",
    timestamp: new Date(),
};

function detectLanguage(text = '') {
    if (!text) return 'en-IN';
    if (/[\u0900-\u097F]/.test(text)) return 'hi-IN';
    if (/[\u0B80-\u0BFF]/.test(text)) return 'ta-IN';
    if (/[\u0C00-\u0C7F]/.test(text)) return 'te-IN';
    if (/[\u0980-\u09FF]/.test(text)) return 'bn-IN';
    return 'en-IN';
}

function confidenceLabel(score) {
    if (score >= 0.8) return { level: 'high', text: `${(score * 100).toFixed(0)}%` };
    if (score >= 0.5) return { level: 'medium', text: `${(score * 100).toFixed(0)}%` };
    return { level: 'low', text: `${(score * 100).toFixed(0)}%` };
}

export default function ResearcherChat() {
    const [messages, setMessages] = useState(() => {
        try {
            const saved = localStorage.getItem(RESEARCHER_CHAT_STORAGE_KEY);
            if (!saved) return [RESEARCHER_WELCOME_MESSAGE];
            const parsed = JSON.parse(saved);
            if (!Array.isArray(parsed) || parsed.length === 0) return [RESEARCHER_WELCOME_MESSAGE];
            return parsed.map((msg) => ({
                ...msg,
                timestamp: msg?.timestamp ? new Date(msg.timestamp) : new Date(),
            }));
        } catch {
            return [RESEARCHER_WELCOME_MESSAGE];
        }
    });
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [ragEnabled, setRagEnabled] = useState(() => {
        try {
            const saved = localStorage.getItem(RESEARCHER_SETTINGS_STORAGE_KEY);
            if (!saved) return false;
            const parsed = JSON.parse(saved);
            return Boolean(parsed?.ragEnabled);
        } catch {
            return false;
        }
    });
    const [reportMode, setReportMode] = useState(() => {
        try {
            const saved = localStorage.getItem(RESEARCHER_SETTINGS_STORAGE_KEY);
            if (!saved) return 'summary';
            const parsed = JSON.parse(saved);
            return parsed?.reportMode === 'detailed' ? 'detailed' : 'summary';
        } catch {
            return 'summary';
        }
    }); // 'summary' | 'detailed'
    const messagesEndRef = useRef(null);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    useEffect(() => {
        try {
            localStorage.setItem(
                RESEARCHER_CHAT_STORAGE_KEY,
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
        try {
            localStorage.setItem(
                RESEARCHER_SETTINGS_STORAGE_KEY,
                JSON.stringify({ ragEnabled, reportMode })
            );
        } catch {
            // Ignore storage failures (private mode / quota limits)
        }
    }, [ragEnabled, reportMode]);

    const sendMessage = useCallback(async (text) => {
        if (!text?.trim() || loading) return;
        const userMsg = { id: Date.now(), role: 'user', text: text.trim(), timestamp: new Date() };
        setMessages(prev => [...prev, userMsg]);
        setInput('');
        setLoading(true);

        try {
            const detectedLang = detectLanguage(userMsg.text);
            const res = await fetch(`${API_URL}/ai`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    query: userMsg.text,
                    role: 'scientist',
                    rag_mode: ragEnabled,
                    report_mode: reportMode,
                    language: detectedLang,
                    locale: detectedLang,
                    context: { language: detectedLang, locale: detectedLang },
                }),
            });
            const data = await res.json();

            const botMsg = {
                id: Date.now() + 1,
                role: 'bot',
                text: data.response || data.answer || 'Analysis unavailable.',
                timestamp: new Date(),
                confidence: data.confidence ?? null,
                tokenCost: data.token_cost ?? null,
                sources: data.sources ?? [],
                csvUrl: data.csv_url ?? null,
                methods: data.methods ?? null,
                cached: data.cached ?? false,
            };
            setMessages(prev => [...prev, botMsg]);
        } catch (err) {
            console.error('ResearcherChat error:', err);
            setMessages(prev => [
                ...prev,
                { id: Date.now() + 1, role: 'bot', text: 'Connection error — retry or check backend.', timestamp: new Date() },
            ]);
        } finally {
            setLoading(false);
        }
    }, [loading, ragEnabled, reportMode]);

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage(input);
        }
    };

    return (
        <div className="researcher-chat" id="researcher-chat-widget">
            {/* Header */}
            <div className="researcher-chat__header">
                <div className="researcher-chat__header-left">
                    <div className="researcher-chat__header-icon">🔬</div>
                    <div className="researcher-chat__header-text">
                        <h3>Vigyan Drishti — Data & Reports</h3>
                        <p>Scientific analysis engine</p>
                    </div>
                </div>
                <div className="researcher-chat__header-chip">
                    {ragEnabled ? 'RAG ON' : 'RAG OFF'}
                </div>
            </div>

            {/* Controls */}
            <div className="researcher-chat__controls">
                <div className="researcher-chat__toggle">
                    <span
                        className={`researcher-chat__toggle-switch ${ragEnabled ? 'researcher-chat__toggle-switch--active' : ''}`}
                        onClick={() => setRagEnabled(!ragEnabled)}
                        role="switch"
                        aria-checked={ragEnabled}
                        id="researcher-rag-toggle"
                    />
                    <span>Run with RAG</span>
                </div>

                <div className="researcher-chat__mode-selector">
                    <button
                        className={`researcher-chat__mode-btn ${reportMode === 'summary' ? 'researcher-chat__mode-btn--active' : ''}`}
                        onClick={() => setReportMode('summary')}
                        id="researcher-mode-summary"
                    >
                        Short summary
                    </button>
                    <button
                        className={`researcher-chat__mode-btn ${reportMode === 'detailed' ? 'researcher-chat__mode-btn--active' : ''}`}
                        onClick={() => setReportMode('detailed')}
                        id="researcher-mode-detailed"
                    >
                        Detailed (CSV)
                    </button>
                </div>
            </div>

            {/* Messages */}
            <div className="researcher-chat__messages">
                {messages.map((msg) => (
                    <div key={msg.id} className={`researcher-chat__msg researcher-chat__msg--${msg.role}`}>
                        <div className="researcher-chat__bubble">
                            {msg.role === 'bot' ? renderBotText(msg.text) : msg.text}

                            {/* Methods line */}
                            {msg.methods && (
                                <div style={{ fontSize: '10.5px', fontStyle: 'italic', marginTop: '8px', color: '#6366f1' }}>
                                    {msg.methods}
                                </div>
                            )}

                            {/* Source citations */}
                            {msg.sources?.length > 0 && (
                                <div className="researcher-chat__sources">
                                    <div className="researcher-chat__sources-title">Sources ({msg.sources.length})</div>
                                    {msg.sources.slice(0, 3).map((src, i) => (
                                        <div key={i} className="researcher-chat__source-item">{src}</div>
                                    ))}
                                </div>
                            )}

                            {/* CSV export link */}
                            {msg.csvUrl && (
                                <a
                                    href={msg.csvUrl}
                                    className="researcher-chat__csv-link"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    <Download size={12} /> Export CSV
                                </a>
                            )}

                            {msg.role === 'bot' && msg.cached && (
                                <div className="researcher-chat__cache-hint">Response from cache</div>
                            )}

                            {/* Confidence + Token cost hidden per user request */}
                        </div>
                    </div>
                ))}

                {loading && (
                    <div className="researcher-chat__msg researcher-chat__msg--bot">
                        <div className="researcher-chat__typing">
                            <span className="researcher-chat__typing-dot" />
                            <span className="researcher-chat__typing-dot" />
                            <span className="researcher-chat__typing-dot" />
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="researcher-chat__input-area">
                <input
                    className="researcher-chat__input"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={ragEnabled ? 'Ask with RAG — attach dataset or query...' : 'Analyze data, generate reports...'}
                    disabled={loading}
                    id="researcher-chat-input"
                />
                <button
                    className="researcher-chat__send-btn"
                    onClick={() => sendMessage(input)}
                    disabled={!input.trim() || loading}
                    id="researcher-chat-send"
                >
                    {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                </button>
            </div>
        </div>
    );
}

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
