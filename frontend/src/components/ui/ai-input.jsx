import React, { useState, useRef, useEffect } from 'react';
import { Send, Mic, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils'; // Assuming utils exists, or simple replacement

const AIInput = ({
    value,
    onChange,
    onSubmit,
    onMicClick,
    onMicDown,
    onMicUp,
    voiceInputMode = 'toggle',
    onVoiceInputModeChange,
    isRecording,
    isLoading,
    placeholder = "Ask anything...",
    disabled
}) => {
    const textareaRef = useRef(null);
    const [isFocused, setIsFocused] = useState(false);

    // Auto-resize
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
        }
    }, [value]);

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            onSubmit?.();
        }
    };

    const handleSendClick = () => {
        onSubmit?.();
    };

    return (
        <div className={cn(
            "relative group transition-all duration-200 rounded-2xl p-2.5",
            "bg-card",
            "border border-border",
            isFocused && "border-foreground/30",
            !isFocused && "shadow-sm"
        )}>
            <div className="relative flex items-end gap-2">

                {/* Text Area */}
                <div className="flex-1 min-h-[44px] py-1">
                    <textarea
                        ref={textareaRef}
                        value={value}
                        onChange={onChange}
                        onKeyDown={handleKeyDown}
                        onFocus={() => setIsFocused(true)}
                        onBlur={() => setIsFocused(false)}
                        placeholder={placeholder}
                        disabled={disabled}
                        rows={1}
                        maxLength={700}
                        className="w-full bg-transparent border-none focus:ring-0 p-0 text-base placeholder:text-muted-foreground text-foreground resize-none max-h-[200px] scrollbar-hide"
                        style={{ minHeight: '24px' }}
                    />
                </div>

                {/* Right Actions */}
                <div className="flex items-center gap-1 pb-0.5">
                    {/* Voice Mode Toggle */}
                    <div className="flex items-center gap-1 mr-1">
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => onVoiceInputModeChange && onVoiceInputModeChange('toggle')}
                            className={cn(
                                "h-8 px-2 rounded-full text-[11px]",
                                voiceInputMode === 'toggle'
                                    ? "bg-primary/10 text-primary"
                                    : "text-muted-foreground"
                            )}
                            title="Toggle recording mode"
                        >
                            Toggle
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => onVoiceInputModeChange && onVoiceInputModeChange('ptt')}
                            className={cn(
                                "h-8 px-2 rounded-full text-[11px]",
                                voiceInputMode === 'ptt'
                                    ? "bg-primary/10 text-primary"
                                    : "text-muted-foreground"
                            )}
                            title="Push-to-talk mode"
                        >
                            Hold
                        </Button>
                    </div>

                    {/* Mic Button */}
                    <AnimatePresence mode="wait">
                        {!value.trim() && (
                            <motion.div
                                initial={{ scale: 0, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                exit={{ scale: 0, opacity: 0 }}
                            >
                                <Button
                                    type="button"
                                    onClick={onMicClick}
                                    onMouseDown={voiceInputMode === 'ptt' ? onMicDown : undefined}
                                    onMouseUp={voiceInputMode === 'ptt' ? onMicUp : undefined}
                                    onMouseLeave={voiceInputMode === 'ptt' ? onMicUp : undefined}
                                    onTouchStart={voiceInputMode === 'ptt' ? onMicDown : undefined}
                                    onTouchEnd={voiceInputMode === 'ptt' ? onMicUp : undefined}
                                    variant="ghost"
                                    size="icon"
                                    className={cn(
                                        "h-10 w-10 rounded-full transition-all duration-200",
                                        isRecording
                                            ? "bg-destructive text-destructive-foreground animate-pulse"
                                            : "text-muted-foreground hover:text-foreground hover:bg-muted"
                                    )}
                                >
                                    {isRecording ? <div className="h-3 w-3 bg-white rounded-sm" /> : <Mic className="h-5 w-5" />}
                                </Button>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* Send Button */}
                    <Button
                        onClick={handleSendClick}
                        disabled={!value.trim() || disabled}
                        size="icon"
                        className={cn(
                            "h-10 w-10 rounded-full transition-all duration-200",
                            value.trim()
                                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                                : "bg-muted text-muted-foreground cursor-not-allowed"
                        )}
                    >
                        {isLoading ? (
                            <Sparkles className="h-5 w-5 animate-spin" />
                        ) : (
                            <Send className="h-5 w-5" />
                        )}
                    </Button>
                </div>
            </div>

            <div className="mt-1 flex items-center justify-between px-1 text-[11px] text-muted-foreground">
                <span>{voiceInputMode === 'ptt' ? 'Hold mic to record' : 'Tap mic to start/stop'}</span>
                <span>{String(value || '').trim().length}/700</span>
            </div>

            {/* Helper Text / Mode Indicator */}
            {isRecording && (
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="absolute -top-10 left-0 right-0 flex justify-center"
                >
                    <div className="bg-destructive text-destructive-foreground text-xs px-3 py-1 rounded-full shadow-sm flex items-center gap-2">
                        <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
                        </span>
                        {voiceInputMode === 'ptt' ? 'Recording (release to send)...' : 'Listening...'}
                    </div>
                </motion.div>
            )}
        </div>
    );
};

export default AIInput;
