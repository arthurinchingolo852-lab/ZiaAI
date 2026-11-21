import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy, Download, Eye, Film, ImageOff, Pencil, Sparkles, Volume2, X } from 'lucide-react';
import type { ChatMessage } from '../types/zia';

interface ChatMessageBubbleProps {
  message: ChatMessage;
  avatarSrc: string;
  onSpeak: (text: string) => void;
  onEditUserMessage?: (messageId: string, newText: string) => void;
  disabledEdit?: boolean;
  isSpeaking?: boolean;
  largeText?: boolean;
}

export const ChatMessageBubble: React.FC<ChatMessageBubbleProps> = React.memo(({
  message,
  avatarSrc,
  onSpeak,
  onEditUserMessage,
  disabledEdit = false,
  isSpeaking = false,
  largeText = false,
}) => {
  const isUser = message.role === 'user';
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [imageAttempt, setImageAttempt] = useState(0);
  const [activeImageSrc, setActiveImageSrc] = useState<string | undefined>(
    message.generatedImageDirectUrl || message.generatedImageUrl
  );
  const [downloading, setDownloading] = useState(false);
  const [avatarError, setAvatarError] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(message.text);
  const editTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setImageLoaded(false);
    setImageError(false);
    setImageAttempt(0);
    setActiveImageSrc(message.generatedImageDirectUrl || message.generatedImageUrl);
  }, [message.generatedImageDirectUrl, message.generatedImageUrl]);

  useEffect(() => {
    if (!isEditing) {
      setEditDraft(message.text);
    }
  }, [message.text, isEditing]);

  useEffect(() => {
    if (isEditing && editTextareaRef.current) {
      const el = editTextareaRef.current;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, [isEditing]);

  const timeLabel = new Date(message.timestamp).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });

  const handleCopyText = async () => {
    const content = message.text;
    if (!content) return;
    let ok = false;
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(content);
        ok = true;
      }
    } catch {
      ok = false;
    }

    if (!ok) {
      try {
        const ta = document.createElement('textarea');
        ta.value = content;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        ta.remove();
      } catch {
        ok = false;
      }
    }

    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    }
  };

  const handleSaveEdit = () => {
    const trimmed = editDraft.trim();
    if (!trimmed || !onEditUserMessage || disabledEdit) return;
    setIsEditing(false);
    if (trimmed === message.text.trim()) return;
    onEditUserMessage(message.id, trimmed);
  };

  const handleCancelEdit = () => {
    setEditDraft(message.text);
    setIsEditing(false);
  };

  const handleDownloadGeneratedImage = async () => {
    const src = message.generatedImageUrl || message.generatedImageDirectUrl;
    if (!src) return;
    setDownloading(true);
    try {
      const res = await fetch(src);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `zia-arte-${message.id.slice(-6)}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      if (message.generatedImageDirectUrl) {
        const a = document.createElement('a');
        a.href = message.generatedImageDirectUrl;
        a.download = `zia-arte-${message.id.slice(-6)}.png`;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    } finally {
      setDownloading(false);
    }
  };

  const handleDownloadVideo = () => {
    if (!message.videoBlobUrl) return;
    const ext = message.videoMimeType?.includes('mp4') ? 'mp4' : 'webm';
    const a = document.createElement('a');
    a.href = message.videoBlobUrl;
    a.download = `zia-video-${message.id.slice(-6)}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <div className={`flex items-end gap-2.5 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <div className="w-8 h-8 rounded-full overflow-hidden shrink-0 border border-sky-400/40 bg-gradient-to-br from-sky-500/30 to-purple-500/30 flex items-center justify-center mb-1">
          {!avatarError ? (
            <img
              src={avatarSrc}
              alt="Zia AI"
              referrerPolicy="no-referrer"
              onError={() => setAvatarError(true)}
              className="w-full h-full object-cover"
            />
          ) : (
            <Sparkles className="w-4 h-4 text-sky-300" />
          )}
        </div>
      )}

      <div
        className={`max-w-[85%] sm:max-w-[76%] rounded-2xl px-4 py-3 shadow-sm ${
          isUser
            ? 'bg-gradient-to-br from-sky-500 to-indigo-600 text-white rounded-br-md'
            : 'bg-[#131b2e] border border-sky-400/15 text-slate-100 rounded-bl-md'
        }`}
      >
        {!isUser && message.isProactive && (
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-purple-300 mb-1">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Modo Companhia</span>
          </div>
        )}

        {message.screenAttached && (
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-sky-100/90 mb-1.5">
            <Eye className="w-3.5 h-3.5" />
            <span>Tela ao vivo enviada</span>
          </div>
        )}

        {message.imagePreview && (
          <div className="mb-2.5 overflow-hidden rounded-xl border border-white/15 bg-[#090d16]">
            <img
              src={message.imagePreview}
              alt="Imagem enviada no chat"
              referrerPolicy="no-referrer"
              className="max-h-60 w-full object-cover"
            />
          </div>
        )}

        {message.userVideoUrl && (
          <div className="mb-2.5 overflow-hidden rounded-xl border border-white/15 bg-[#090d16]">
            <video
              src={message.userVideoUrl}
              controls
              playsInline
              className="max-h-60 w-full object-contain bg-black"
            />
          </div>
        )}

        {isEditing && isUser ? (
          <div className="space-y-2 min-w-[210px] sm:min-w-[250px]">
            <textarea
              ref={editTextareaRef}
              value={editDraft}
              onChange={(e) => setEditDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSaveEdit();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  handleCancelEdit();
                }
              }}
              rows={3}
              className={`w-full rounded-xl bg-black/25 border border-white/35 px-3 py-2 text-white placeholder:text-sky-100/60 focus:outline-none focus:border-white resize-y ${
                largeText ? 'text-[17px] leading-[1.5]' : 'text-[14px] leading-relaxed'
              }`}
              placeholder="Edite sua mensagem..."
            />
            <div className="flex items-center justify-end gap-1.5">
              <button
                type="button"
                onClick={handleCancelEdit}
                className="min-h-[32px] px-2.5 py-1 rounded-lg bg-black/25 hover:bg-black/40 text-sky-100 text-xs font-medium inline-flex items-center gap-1 cursor-pointer transition-colors"
              >
                <X className="w-3.5 h-3.5" />
                <span>Cancelar</span>
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                disabled={!editDraft.trim() || disabledEdit}
                className="min-h-[32px] px-3 py-1 rounded-lg bg-white text-indigo-700 hover:bg-sky-50 disabled:opacity-45 text-xs font-bold inline-flex items-center gap-1 cursor-pointer transition-colors"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Salvar e enviar</span>
              </button>
            </div>
          </div>
        ) : (
          <p
            className={`select-text whitespace-pre-wrap break-words ${
              largeText ? 'text-[18px] leading-[1.6] font-medium' : 'text-[15px] leading-relaxed'
            }`}
          >
            {message.text}
          </p>
        )}

        {/* Pollinations Generated Image (fast direct Flux + proxy fallback) */}
        {(message.generatedImageUrl || message.generatedImageDirectUrl) && (
          <div className="mt-3 space-y-2">
            <div className="relative overflow-hidden rounded-xl border border-sky-400/25 bg-[#090d16] aspect-square max-w-sm">
              {!imageLoaded && !imageError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-[#090d16] via-[#131b2e] to-[#1e1b4b] animate-pulse p-4 text-center">
                  <Sparkles className="w-6 h-6 text-sky-300" />
                  <span className="text-xs text-sky-200">Gerando arte super rápida...</span>
                </div>
              )}
              {imageError ? (
                <div className="w-full h-full flex flex-col items-center justify-center gap-3 p-6 text-center bg-gradient-to-br from-[#090d16] to-[#131b2e]">
                  <ImageOff className="w-7 h-7 text-slate-400" />
                  <p className="text-xs text-slate-300">
                    Não carregou ainda. Toque abaixo para gerar novamente!
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      const retrySeed = Date.now();
                      const fallbackBase = message.generatedImageUrl || message.generatedImageDirectUrl || '';
                      const separator = fallbackBase.includes('?') ? '&' : '?';
                      setImageError(false);
                      setImageLoaded(false);
                      setImageAttempt(2);
                      setActiveImageSrc(`${fallbackBase}${separator}retry=${retrySeed}`);
                    }}
                    className="min-h-[36px] px-3.5 py-1.5 rounded-xl bg-sky-500/25 hover:bg-sky-500/35 border border-sky-400/40 text-sky-200 text-xs font-semibold cursor-pointer"
                  >
                    Tentar novamente
                  </button>
                </div>
              ) : (
                <img
                  src={activeImageSrc}
                  alt={message.generatedImagePrompt || 'Arte gerada pela Zia AI'}
                  referrerPolicy="no-referrer"
                  onLoad={() => setImageLoaded(true)}
                  onError={() => {
                    if (
                      imageAttempt === 0 &&
                      message.generatedImageUrl &&
                      activeImageSrc !== message.generatedImageUrl
                    ) {
                      setImageAttempt(1);
                      setActiveImageSrc(message.generatedImageUrl);
                    } else {
                      setImageError(true);
                    }
                  }}
                  className={`w-full h-full object-cover transition-opacity duration-200 ${
                    imageLoaded ? 'opacity-100' : 'opacity-0'
                  }`}
                />
              )}
            </div>

            <button
              type="button"
              onClick={() => void handleDownloadGeneratedImage()}
              disabled={downloading}
              className="min-h-[44px] w-full sm:w-auto px-4 py-2 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 border border-sky-400/35 text-sky-200 text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-60"
            >
              <Download className="w-4 h-4" />
              <span>{downloading ? 'Baixando arte...' : '⬇️ Baixar Imagem'}</span>
            </button>
          </div>
        )}

        {/* HTML5 Canvas + MediaRecorder Animated Video OR Storyboard Fallback */}
        {(message.videoBlobUrl || (message.videoScenes && message.videoScenes.length > 0)) && (
          <div className="mt-3 space-y-2.5">
            {message.videoTitle && (
              <div className="flex items-center gap-1.5 text-xs font-semibold text-purple-300">
                <Film className="w-4 h-4" />
                <span>{message.videoTitle}</span>
              </div>
            )}
            {message.videoBlobUrl ? (
              <div className="overflow-hidden rounded-xl border border-purple-400/30 bg-[#090d16] max-w-sm">
                <video
                  src={message.videoBlobUrl}
                  controls
                  playsInline
                  className="w-full aspect-square object-cover"
                />
              </div>
            ) : (
              message.videoScenes && (
                <div className="grid grid-cols-2 gap-1.5 max-w-sm">
                  {message.videoScenes.map((scene, idx) => (
                    <div
                      key={`${message.id}-scene-${idx}`}
                      className="relative overflow-hidden rounded-xl border border-purple-400/30 bg-[#090d16] aspect-square"
                    >
                      {scene.imageUrl && (
                        <img
                          src={scene.imageUrl}
                          alt={scene.captionPt}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      )}
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-1.5">
                        <p className="text-[10px] font-semibold text-white leading-tight line-clamp-2">
                          {idx + 1}. {scene.captionPt}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}
            <div className="flex flex-wrap gap-2">
              {message.videoBlobUrl && (
                <button
                  type="button"
                  onClick={handleDownloadVideo}
                  className="min-h-[44px] px-4 py-2 rounded-xl bg-purple-500/20 hover:bg-purple-500/30 border border-purple-400/40 text-purple-200 text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>⬇️ Baixar Vídeo</span>
                </button>
              )}
              {message.videoScenes && message.videoScenes.length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    onSpeak(message.videoScenes!.map((s) => s.narrationPt).join('. '))
                  }
                  className="min-h-[44px] px-3.5 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-200 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Volume2 className="w-4 h-4 text-sky-300" />
                  <span>Narrar Vídeo</span>
                </button>
              )}
            </div>
          </div>
        )}

        <div
          className={`mt-1.5 flex items-center justify-between gap-3 text-[11px] ${
            isUser ? 'text-sky-100/85' : 'text-slate-400'
          }`}
        >
          <span className="tabular-nums">{timeLabel}</span>

          <div className="flex items-center gap-1.5">
            {!isEditing && (
              <button
                type="button"
                onClick={() => void handleCopyText()}
                className={`inline-flex items-center gap-1 rounded-md transition-colors cursor-pointer ${
                  copied
                    ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-400/40'
                    : isUser
                      ? 'text-sky-100/90 hover:text-white hover:bg-white/15'
                      : 'text-slate-200 bg-white/5 hover:text-white hover:bg-white/10 border border-white/10'
                } ${largeText ? 'py-1.5 px-2.5 text-xs font-semibold' : 'py-1 px-2 font-medium'}`}
                title="Copiar texto da mensagem"
              >
                {copied ? (
                  <>
                    <Check className={`${largeText ? 'w-4 h-4' : 'w-3.5 h-3.5'} text-emerald-300`} />
                    <span>Texto copiado!</span>
                  </>
                ) : (
                  <>
                    <Copy className={largeText ? 'w-4 h-4' : 'w-3.5 h-3.5'} />
                    <span>Copiar Texto</span>
                  </>
                )}
              </button>
            )}

            {isUser && onEditUserMessage && !isEditing && (
              <button
                type="button"
                onClick={() => {
                  setEditDraft(message.text);
                  setIsEditing(true);
                }}
                disabled={disabledEdit}
                className={`inline-flex items-center gap-1 rounded-md text-sky-100/90 hover:text-white hover:bg-white/15 disabled:opacity-40 transition-colors cursor-pointer ${
                  largeText ? 'py-1.5 px-2 text-xs font-semibold' : 'py-0.5 px-1.5'
                }`}
                title="Editar e reenviar mensagem"
              >
                <Pencil className={largeText ? 'w-3.5 h-3.5' : 'w-3 h-3'} />
                <span>Editar</span>
              </button>
            )}

            {!isUser && (
              <>
                {isSpeaking && (
                  <span
                    className="inline-flex items-end gap-0.5 h-3.5 px-1.5 py-0.5 rounded-full bg-sky-500/15 border border-sky-400/30"
                    aria-label="Zia está falando"
                  >
                    <span className="w-0.5 h-2 bg-sky-300 rounded-full animate-pulse" />
                    <span className="w-0.5 h-3 bg-purple-300 rounded-full animate-bounce" />
                    <span className="w-0.5 h-2.5 bg-sky-300 rounded-full animate-pulse" />
                    <span className="w-0.5 h-1.5 bg-purple-300 rounded-full animate-bounce" />
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => onSpeak(message.text)}
                  className={`inline-flex items-center gap-1 text-sky-300 hover:text-sky-200 rounded-md hover:bg-white/5 transition-colors cursor-pointer ${
                    largeText ? 'py-1.5 px-2.5 text-sm font-semibold' : 'py-0.5 px-1.5'
                  }`}
                  title="Ouvir mensagem novamente"
                >
                  <Volume2 className={largeText ? 'w-4 h-4' : 'w-3.5 h-3.5'} />
                  <span>{isSpeaking ? 'Falando...' : 'Ouvir'}</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});
