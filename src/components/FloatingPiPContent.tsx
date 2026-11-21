import React, { useEffect, useRef, useState } from 'react';
import { Maximize2, Mic, MicOff, Minus, Monitor, Send, Sparkles, Volume2, X } from 'lucide-react';
import type { ChatMessage } from '../types/zia';

interface FloatingPiPContentProps {
  messages: ChatMessage[];
  streamingBubble: ChatMessage | null;
  isTyping: boolean;
  isSpeaking: boolean;
  isListening: boolean;
  isVoiceOrbMode: boolean;
  isScreenSharing: boolean;
  hasScreenAudio: boolean;
  onSendMessage: (text: string) => void;
  onToggleMic: () => void;
  onToggleVoiceOrb: () => void;
  onResize: (width: number, height: number) => void;
  onClose: () => void;
}

export const FloatingPiPContent: React.FC<FloatingPiPContentProps> = ({
  messages,
  streamingBubble,
  isTyping,
  isSpeaking,
  isListening,
  isVoiceOrbMode,
  isScreenSharing,
  hasScreenAudio,
  onSendMessage,
  onToggleMic,
  onToggleVoiceOrb,
  onResize,
  onClose,
}) => {
  const [text, setText] = useState('');
  const [minimized, setMinimized] = useState(isVoiceOrbMode);
  const feedRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (isVoiceOrbMode) {
      setMinimized(true);
      onResize(240, 240);
    }
  }, [isVoiceOrbMode, onResize]);

  useEffect(() => {
    if (feedRef.current && !minimized) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [messages, streamingBubble, isTyping, minimized]);

  const handleToggleMinimize = () => {
    const next = !minimized;
    setMinimized(next);
    if (next) {
      onResize(240, 240);
    } else {
      onResize(370, 520);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    setText('');
    onSendMessage(trimmed);
  };

  if (minimized) {
    const latestZia =
      streamingBubble ||
      [...messages].reverse().find((m) => m.role === 'assistant');

    return (
      <div className="h-full w-full bg-[#090d16] text-slate-100 flex flex-col items-center justify-between p-3 select-none">
        <div className="w-full flex items-center justify-between">
          <div className="flex items-center gap-1 text-[10px] font-semibold text-sky-300">
            <Monitor className="w-3 h-3" />
            <span>{isScreenSharing ? (hasScreenAudio ? 'Tela+Som' : 'Tela 1s') : 'Zia Orb'}</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleToggleMinimize}
              className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/15 text-slate-200 flex items-center justify-center cursor-pointer"
              title="Expandir chat"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="w-7 h-7 rounded-lg bg-rose-500/20 hover:bg-rose-500/35 text-rose-200 flex items-center justify-center cursor-pointer"
              title="Fechar"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Glowing Voice Orb Button */}
        <button
          type="button"
          onClick={onToggleVoiceOrb}
          className={`relative w-24 h-24 rounded-full flex flex-col items-center justify-center transition-all cursor-pointer shadow-2xl ${
            isListening
              ? 'bg-gradient-to-br from-rose-500 to-purple-600 ring-4 ring-rose-400/50 animate-pulse'
              : isSpeaking
                ? 'bg-gradient-to-br from-sky-400 to-cyan-500 ring-4 ring-sky-300/60 scale-105'
                : isVoiceOrbMode
                  ? 'bg-gradient-to-br from-sky-500 to-purple-600 ring-4 ring-purple-400/35'
                  : 'bg-[#131b2e] border-2 border-sky-400/50'
          }`}
          title="Ligar ou desligar modo voz contínuo"
        >
          {isSpeaking ? (
            <Volume2 className="w-7 h-7 text-slate-950 animate-bounce" />
          ) : isListening ? (
            <Mic className="w-7 h-7 text-white" />
          ) : (
            <Sparkles className="w-7 h-7 text-white" />
          )}
          <span className="text-[10px] font-bold text-white mt-0.5">
            {isListening ? 'OUVINDO' : isSpeaking ? 'FALANDO' : isVoiceOrbMode ? 'VOZ ON' : 'ZIA'}
          </span>
        </button>

        <p className="w-full text-center text-[11px] text-slate-300 line-clamp-2 leading-tight px-1">
          {latestZia?.text || 'Toque na bola para conversar!'}
        </p>
      </div>
    );
  }

  return (
    <div className="h-full w-full bg-[#090d16] text-slate-100 flex flex-col overflow-hidden select-none">
      {/* Header Bar */}
      <header className="shrink-0 h-12 px-3 bg-[#131b2e] border-b border-sky-400/20 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles className="w-4 h-4 text-sky-400 shrink-0" />
          <span className="text-sm font-bold text-white truncate">Zia AI Flutuante</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => onResize(320, 420)}
            className="min-h-[30px] px-2 rounded-md bg-white/5 hover:bg-white/10 text-[10px] font-bold text-slate-300 cursor-pointer"
            title="Tamanho pequeno"
          >
            P
          </button>
          <button
            type="button"
            onClick={() => onResize(390, 540)}
            className="min-h-[30px] px-2 rounded-md bg-white/5 hover:bg-white/10 text-[10px] font-bold text-slate-300 cursor-pointer"
            title="Tamanho médio"
          >
            M
          </button>
          <button
            type="button"
            onClick={() => onResize(480, 640)}
            className="min-h-[30px] px-2 rounded-md bg-white/5 hover:bg-white/10 text-[10px] font-bold text-slate-300 cursor-pointer"
            title="Tamanho grande"
          >
            G
          </button>
          <button
            type="button"
            onClick={handleToggleMinimize}
            className="min-h-[34px] min-w-[34px] rounded-lg bg-white/5 hover:bg-white/10 text-slate-200 flex items-center justify-center cursor-pointer"
            title="Virar Bola Flutuante"
            aria-label="Virar Bola Flutuante"
          >
            <Minus className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[34px] min-w-[34px] rounded-lg bg-rose-500/20 hover:bg-rose-500/35 text-rose-200 flex items-center justify-center cursor-pointer"
            title="Fechar janela flutuante"
            aria-label="Fechar janela flutuante"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Compact Conversation History */}
      <div
        ref={feedRef}
        className="flex-1 overflow-y-auto zia-scroll p-3 space-y-2.5 select-text"
      >
        {messages.slice(-30).map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[88%] rounded-2xl px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap break-words ${
                msg.role === 'user'
                  ? 'bg-sky-500 text-slate-950 font-medium rounded-br-sm'
                  : 'bg-[#131b2e] border border-sky-400/15 text-slate-100 rounded-bl-sm'
              }`}
            >
              {msg.text}
            </div>
          </div>
        ))}

        {streamingBubble && (
          <div className="flex justify-start">
            <div className="max-w-[88%] rounded-2xl rounded-bl-sm px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap break-words bg-[#131b2e] border border-sky-400/20 text-slate-100">
              {streamingBubble.text}
            </div>
          </div>
        )}

        {isTyping && !streamingBubble && (
          <div className="text-[11px] text-sky-300 px-1">Zia está pensando... ⚡</div>
        )}
      </div>

      {/* Input + Mic + Send Bar */}
      <form
        onSubmit={handleSubmit}
        className="shrink-0 p-2.5 bg-[#0d1322] border-t border-white/10 flex items-center gap-1.5"
      >
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={isListening ? 'Ouvindo...' : 'Fale com a Zia...'}
          className="flex-1 min-h-[42px] rounded-xl bg-[#131b2e] border border-white/10 px-3 text-xs text-white placeholder:text-slate-400 focus:outline-none focus:border-sky-400"
        />
        <button
          type="button"
          onClick={onToggleMic}
          className={`min-h-[42px] min-w-[42px] rounded-xl flex items-center justify-center shrink-0 cursor-pointer ${
            isListening
              ? 'bg-rose-500 text-white animate-pulse'
              : 'bg-purple-500/25 border border-purple-400/40 text-purple-200 hover:bg-purple-500/35'
          }`}
          title="Microfone"
          aria-label="Microfone"
        >
          {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
        </button>
        <button
          type="submit"
          disabled={isTyping || !text.trim()}
          className="min-h-[42px] min-w-[42px] rounded-xl bg-sky-500 hover:bg-sky-400 disabled:opacity-40 text-slate-950 flex items-center justify-center shrink-0 cursor-pointer"
          title="Enviar"
          aria-label="Enviar"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
};
