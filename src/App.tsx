import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Camera,
  Eye,
  Gamepad2,
  Globe,
  ImagePlus,
  MessageSquare,
  Mic,
  MicOff,
  Monitor,
  MonitorOff,
  PictureInPicture2,
  Send,
  Settings,
  Sparkles,
  Video,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { ActionSuggestions } from './components/ActionSuggestions';
import { CameraModal, type RecordedVideoPayload } from './components/CameraModal';
import { ChatMessageBubble } from './components/ChatMessageBubble';
import { FloatingPiPContent } from './components/FloatingPiPContent';
import { GamerCenter } from './components/GamerCenter';
import { MemoryModal } from './components/MemoryModal';
import { OfflineIndicator, PWAInstallBanner, PWAInstallButton } from './components/PWAInstallButton';
import { useDocumentPiP } from './hooks/useDocumentPiP';
import { useVideoPiP } from './hooks/useVideoPiP';
import type { ActiveTab, ChatMessage, MemoryItem, VideoScene, ZiaPreferences } from './types/zia';
import { LiveAudioCapture } from './utils/liveAudioCapture';
import {
  createStreamingSpeechSession,
  markMicStopped,
  speakWithZiaVoice,
  stopZiaSpeech,
  unlockAndroidAudio,
} from './utils/speech';
import { renderAnimatedVideoFromScenes } from './utils/videoGenerator';

const ZIA_LOGO_URL = '/zia-logo.png';
const ZIA_AVATAR_URL = '/src/assets/images/zia_avatar_1794952008894.jpg';

const STORAGE_KEYS = {
  MESSAGES: 'zia_ai_messages_v1',
  MEMORIES: 'zia_ai_memories_v1',
  PREFS: 'zia_ai_prefs_v2',
  USER_NAME: 'zia_ai_user_name_v1',
};

const DEFAULT_PREFS: ZiaPreferences = {
  voiceEnabled: true,
  companionMode: false,
  voiceRate: 1.0,
  audienceMode: 'auto',
  largeText: false,
};

const NON_NAME_WORDS = new Set([
  'oi',
  'ola',
  'olá',
  'eae',
  'opa',
  'fala',
  'salve',
  'sim',
  'nao',
  'não',
  'ok',
  'beleza',
  'blz',
  'tudo',
  'bom',
  'boa',
  'ajuda',
  'jogar',
  'jogo',
  'game',
  'zia',
  'como',
  'oque',
  'quem',
  'qual',
  'bora',
  'valeu',
  'obrigado',
  'obrigada',
]);

function formatCleanName(raw: string): string {
  return raw
    .trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s+/g, ' ')
    .slice(0, 32)
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function extractUserNameFromInput(text: string, hasNameAlready: boolean): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;

  const explicit =
    /(?:meu nome [eé]|me chamo|pode me chamar de|eu sou o|eu sou a|sou o|sou a|chama de)\s+([\p{L}][\p{L}\p{N}_-]*(?:\s+[\p{L}][\p{L}\p{N}_-]*)?)/iu.exec(
      trimmed
    );
  if (explicit?.[1]) {
    const cleaned = formatCleanName(explicit[1]);
    if (cleaned && !NON_NAME_WORDS.has(cleaned.toLowerCase())) {
      return cleaned;
    }
  }

  if (!hasNameAlready && !trimmed.includes('?') && trimmed.length <= 28) {
    const words = trimmed.split(/\s+/).filter(Boolean);
    if (words.length >= 1 && words.length <= 2) {
      const candidate = formatCleanName(trimmed);
      if (
        candidate &&
        candidate.length >= 2 &&
        !NON_NAME_WORDS.has(candidate.toLowerCase()) &&
        !/\d{3,}/.test(candidate)
      ) {
        return candidate;
      }
    }
  }

  return undefined;
}

interface SpeechRecognitionAlternative {
  transcript: string;
}
interface SpeechRecognitionResultItem {
  isFinal: boolean;
  0: SpeechRecognitionAlternative;
}
interface SpeechRecognitionEventLike extends Event {
  results: ArrayLike<SpeechRecognitionResultItem>;
}
interface SpeechRecognitionErrorEventLike extends Event {
  error?: string;
}
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
    reader.readAsDataURL(file);
  });
}

function loadSavedUserName(): string {
  try {
    return (localStorage.getItem(STORAGE_KEYS.USER_NAME) || '').trim().slice(0, 32);
  } catch {
    return '';
  }
}

function loadSavedMessages(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.MESSAGES);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ChatMessage[];
    if (!Array.isArray(parsed) || parsed.length === 0) return [];
    const hasOnlyLegacyWelcome =
      parsed.every((m) => m.role === 'assistant' && m.id.startsWith('zia-welcome-'));
    if (hasOnlyLegacyWelcome) return [];
    return parsed.map((msg) => ({
      ...msg,
      // blob: URLs expire across reloads
      videoBlobUrl: undefined,
    }));
  } catch {
    return [];
  }
}

function loadSavedMemories(): MemoryItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.MEMORIES);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as MemoryItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadSavedPrefs(): ZiaPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.PREFS);
    if (!raw) return DEFAULT_PREFS;
    return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<ZiaPreferences>) };
  } catch {
    return DEFAULT_PREFS;
  }
}

function parseZiaStreamOutput(raw: string, isFinal: boolean): {
  visibleText: string;
  imagePromptEn?: string;
  videoTitle?: string;
  videoScenes?: VideoScene[];
  memoryNotes: string[];
  discoveredName?: string;
} {
  const memoryNotes: string[] = [];
  let imagePromptEn: string | undefined;
  let videoTitle: string | undefined;
  let videoScenes: VideoScene[] | undefined;
  let discoveredName: string | undefined;

  let text = raw
    .replace(/\[NAME:\s*([^\]]+)\]/gi, (_m, rawName: string) => {
      const cleaned = formatCleanName(rawName);
      if (cleaned) discoveredName = cleaned;
      return '';
    })
    .replace(/\[MEM:\s*([^\]]+)\]/gi, (_m, note: string) => {
      if (note.trim()) memoryNotes.push(note.trim());
      return '';
    })
    .replace(/\[IMG:\s*([^\]]+)\]/gi, (_m, prompt: string) => {
      if (prompt.trim()) imagePromptEn = prompt.trim();
      return '';
    })
    .replace(/\[(?:TAP|BURST|SWIPE):[^\]]*\]/gi, '')
    .replace(/\[VID:\s*([^\]]+)\]/gi, (_m, payload: string) => {
      const pipeIdx = payload.indexOf('|');
      const titlePart = pipeIdx >= 0 ? payload.slice(0, pipeIdx).trim() : 'Vídeo da Zia AI';
      const scenesPart = pipeIdx >= 0 ? payload.slice(pipeIdx + 1) : payload;
      const parsedScenes = scenesPart
        .split('||')
        .map((chunk) => chunk.trim())
        .filter(Boolean)
        .map((chunk) => {
          const [promptEn = '', captionPt = '', narrationPt = ''] = chunk
            .split('::')
            .map((s) => s.trim());
          return {
            promptEn: promptEn || 'Futuristic colorful digital art',
            captionPt: captionPt || titlePart,
            narrationPt: narrationPt || captionPt || titlePart,
          };
        });
      if (parsedScenes.length > 0) {
        videoTitle = titlePart;
        videoScenes = parsedScenes;
      }
      return '';
    });

  if (!isFinal) {
    // Hide partial trailing tag while still streaming so raw [IMG / [VID / [MEM / [NAME syntax never flickers
    const partialTagIdx = text.search(/\[(?:IMG|VID|MEM|NAME|TAP|BURST|SWIPE|I|V|M|N|T|B|S)?(?::[^\]]*)?$/i);
    if (partialTagIdx !== -1) {
      text = text.slice(0, partialTagIdx);
    }
  }

  return {
    visibleText: text.trimEnd(),
    imagePromptEn,
    videoTitle,
    videoScenes,
    memoryNotes,
    discoveredName,
  };
}

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>(loadSavedMessages);
  const [memories, setMemories] = useState<MemoryItem[]>(loadSavedMemories);
  const [preferences, setPreferences] = useState<ZiaPreferences>(loadSavedPrefs);
  const [userName, setUserName] = useState<string>(loadSavedUserName);
  const [nameDraft, setNameDraft] = useState<string>('');
  const userNameRef = useRef<string>(userName);
  userNameRef.current = userName;

  const [activeTab, setActiveTab] = useState<ActiveTab>('chat');
  const [inputText, setInputText] = useState('');
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [pendingVideo, setPendingVideo] = useState<RecordedVideoPayload | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [streamingBubble, setStreamingBubble] = useState<ChatMessage | null>(null);
  const [videoStatus, setVideoStatus] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [isMemoryOpen, setIsMemoryOpen] = useState(false);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [cameraMode, setCameraMode] = useState<'photo' | 'video'>('photo');
  const [headerNotice, setHeaderNotice] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState(false);
  const [dynamicSuggestions, setDynamicSuggestions] = useState<string[]>([]);
  const [isUpdatingSuggestions, setIsUpdatingSuggestions] = useState(false);
  const [isVoiceOrbMode, setIsVoiceOrbMode] = useState(false);
  const voiceOrbModeRef = useRef(false);
  const [orbPos, setOrbPos] = useState({ x: 20, y: 120 });
  const orbDragRef = useRef<{
    active: boolean;
    moved: boolean;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  }>({ active: false, moved: false, startX: 0, startY: 0, origX: 20, origY: 120 });

  // Live screen + game/mic audio sharing state (real-time ~80ms frame capture + WAV audio)
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [hasScreenAudio, setHasScreenAudio] = useState(false);
  const [isMicAudioLive, setIsMicAudioLive] = useState(false);
  const isMicAudioLiveRef = useRef(false);
  const [screenPulseCount, setScreenPulseCount] = useState(0);
  const [screenAutoWatch, setScreenAutoWatch] = useState(true);
  const [screenBlockedHelp, setScreenBlockedHelp] = useState(false);
  const [pipBlockedHelp, setPipBlockedHelp] = useState(false);

  const pip = useDocumentPiP();
  const micActionRef = useRef<() => void>(() => {});
  const startListeningIfOrbRef = useRef<() => void>(() => {});
  const videoPiP = useVideoPiP({
    messages,
    streamingBubble,
    isTyping,
    isSpeaking,
    isListening,
    isVoiceOrbMode,
    isScreenSharing,
    hasScreenAudio: hasScreenAudio || isMicAudioLive,
    userName,
    onToggleMic: () => micActionRef.current(),
  });

  const screenStreamRef = useRef<MediaStream | null>(null);
  const screenVideoRef = useRef<HTMLVideoElement | null>(null);
  const liveAudioCaptureRef = useRef<LiveAudioCapture | null>(null);
  const screenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const diffCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const latestScreenFrameRef = useRef<string | undefined>(undefined);
  const lastFrameSigRef = useRef<number[]>([]);
  const lastScreenObserveAtRef = useRef<number>(0);
  const screenObserveBusyRef = useRef<boolean>(false);
  const isTypingRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const isListeningRef = useRef(false);
  const recognitionStartingRef = useRef(false);
  const lastRecognitionNetErrAtRef = useRef(0);
  const speechActiveRef = useRef(false);
  const silenceCommitTimerRef = useRef<number | null>(null);
  const screenAutoWatchRef = useRef(true);
  const memorySummaryRef = useRef('');
  const audienceModeRef = useRef(preferences.audienceMode ?? 'auto');
  isTypingRef.current = isTyping;
  isSpeakingRef.current = isSpeaking;
  isListeningRef.current = isListening;
  screenAutoWatchRef.current = screenAutoWatch;
  audienceModeRef.current = preferences.audienceMode ?? 'auto';

  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const screenFallbackInputRef = useRef<HTMLInputElement | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const lastActivityRef = useRef<number>(Date.now());
  const proactiveBusyRef = useRef<boolean>(false);

  // Persist messages ONLY when not actively streaming (avoids main-thread JSON.stringify lag per token)
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const serializable = messages.slice(-100).map((m) => ({
          ...m,
          videoBlobUrl: undefined,
          userVideoUrl: undefined,
        }));
        localStorage.setItem(STORAGE_KEYS.MESSAGES, JSON.stringify(serializable));
      } catch {
        // Ignore storage quota overflow
      }
    }, 150);
    return () => window.clearTimeout(timer);
  }, [messages]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.MEMORIES, JSON.stringify(memories));
    } catch {
      // Ignore
    }
  }, [memories]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.PREFS, JSON.stringify(preferences));
    } catch {
      // Ignore
    }
  }, [preferences]);

  const messagesRef = useRef<ChatMessage[]>(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const scrollToBottomInstant = useCallback(() => {
    const el = scrollContainerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottomInstant();
  }, [messages, streamingBubble, isTyping, videoStatus, scrollToBottomInstant]);

  // Cleanup screen & live audio capture on unmount
  useEffect(() => {
    return () => {
      screenStreamRef.current?.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {
          // Ignore
        }
      });
      liveAudioCaptureRef.current?.dispose();
      liveAudioCaptureRef.current = null;
    };
  }, []);

  // Attach MediaStream to <video> whenever active
  useEffect(() => {
    if (isScreenSharing && screenVideoRef.current && screenStreamRef.current) {
      screenVideoRef.current.srcObject = screenStreamRef.current;
      void screenVideoRef.current.play().catch(() => {});
    }
  }, [isScreenSharing]);

  const showTempNotice = useCallback((msg: string) => {
    setHeaderNotice(msg);
    window.setTimeout(() => {
      setHeaderNotice((prev) => (prev === msg ? null : prev));
    }, 3500);
  }, []);

  const speakZia = useCallback(
    (text: string, force = false) => {
      unlockAndroidAudio();
      setAudioUnlocked(true);
      lastActivityRef.current = Date.now();
      speakWithZiaVoice(text, {
        enabled: force || preferences.voiceEnabled,
        rate: preferences.voiceRate,
        onStart: () => setIsSpeaking(true),
        onEnd: () => {
          setIsSpeaking(false);
          lastActivityRef.current = Date.now();
          if (voiceOrbModeRef.current) {
            window.setTimeout(() => {
              startListeningIfOrbRef.current();
            }, 120);
          }
        },
      });
    },
    [preferences.voiceEnabled, preferences.voiceRate]
  );

  const latestAssistantId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') return messages[i].id;
    }
    return null;
  }, [messages]);

  const memorySummary = useMemo(() => {
    if (memories.length === 0) return '';
    return memories.map((m) => `- [${m.category}] ${m.text}`).join('\n');
  }, [memories]);
  memorySummaryRef.current = memorySummary;

  const addMemory = useCallback((text: string, category: MemoryItem['category'] = 'geral') => {
    const clean = text.trim();
    if (!clean) return;
    setMemories((prev) => {
      const exists = prev.some((item) => item.text.toLowerCase() === clean.toLowerCase());
      if (exists) return prev;
      return [{ id: `mem-${Date.now()}`, text: clean, category, createdAt: Date.now() }, ...prev];
    });
  }, []);

  const removeMemory = useCallback((id: string) => {
    setMemories((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const persistUserName = useCallback((nextRaw: string) => {
    const cleaned = formatCleanName(nextRaw);
    userNameRef.current = cleaned;
    setUserName(cleaned);
    try {
      if (cleaned) {
        localStorage.setItem(STORAGE_KEYS.USER_NAME, cleaned);
      } else {
        localStorage.removeItem(STORAGE_KEYS.USER_NAME);
      }
    } catch {
      // Ignore
    }
    return cleaned;
  }, []);

  const clearAllMemory = useCallback(() => {
    localStorage.removeItem(STORAGE_KEYS.MESSAGES);
    localStorage.removeItem(STORAGE_KEYS.MEMORIES);
    localStorage.removeItem(STORAGE_KEYS.USER_NAME);
    setMemories([]);
    setMessages([]);
    userNameRef.current = '';
    setUserName('');
    setNameDraft('');
    showTempNotice('Tudo zerado! Bora do começo.');
  }, [showTempNotice]);

  const refreshDynamicSuggestions = useCallback(
    async (recentHistory: Array<{ role: 'user' | 'assistant'; text: string }>) => {
      if (recentHistory.length === 0) {
        setDynamicSuggestions([]);
        return;
      }
      setIsUpdatingSuggestions(true);
      try {
        const res = await fetch('/api/zia/suggestions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            history: recentHistory.slice(-6),
            audienceMode: preferences.audienceMode ?? 'auto',
            isScreenSharing,
            userName: userNameRef.current,
          }),
        });
        if (!res.ok) return;
        const data = (await res.json()) as { suggestions?: string[] };
        if (Array.isArray(data.suggestions) && data.suggestions.length >= 3) {
          setDynamicSuggestions(data.suggestions.slice(0, 4));
        }
      } catch {
        // Silent fallback to local topic suggestions
      } finally {
        setIsUpdatingSuggestions(false);
      }
    },
    [isScreenSharing, preferences.audienceMode]
  );

  const captureCurrentScreenFrame = useCallback((): string | undefined => {
    const video = screenVideoRef.current;
    if (!isScreenSharing) return undefined;
    try {
      if (video && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
        const maxW = 640;
        const scale = Math.min(1, maxW / video.videoWidth);
        const w = Math.max(1, Math.round(video.videoWidth * scale));
        const h = Math.max(1, Math.round(video.videoHeight * scale));
        if (!screenCanvasRef.current) {
          screenCanvasRef.current = document.createElement('canvas');
        }
        const canvas = screenCanvasRef.current;
        if (canvas.width !== w) canvas.width = w;
        if (canvas.height !== h) canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, w, h);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.62);
          latestScreenFrameRef.current = dataUrl;
          return dataUrl;
        }
      }
    } catch {
      // Fallback to most recent valid frame
    }
    return latestScreenFrameRef.current;
  }, [isScreenSharing]);

  const streamZiaReply = useCallback(
    async ({
      messageText,
      effectiveUserName,
      historyPayload,
      imageToSend,
      videoDataUrl,
      screenFrame,
      screenAudio,
    }: {
      messageText: string;
      effectiveUserName: string;
      historyPayload: Array<{ role: 'user' | 'assistant'; text: string }>;
      imageToSend?: string | null;
      videoDataUrl?: string;
      screenFrame?: string;
      screenAudio?: string;
    }) => {
      const assistantId = `zia-${Date.now()}`;
      const assistantTimestamp = Date.now();
      let rawAccumulated = '';

      const speechSession = createStreamingSpeechSession({
        enabled: preferences.voiceEnabled,
        rate: preferences.voiceRate,
        onStart: () => setIsSpeaking(true),
        onEnd: () => {
          setIsSpeaking(false);
          lastActivityRef.current = Date.now();
          if (voiceOrbModeRef.current) {
            window.setTimeout(() => {
              startListeningIfOrbRef.current();
            }, 140);
          }
        },
      });

      const requestBodyStr = JSON.stringify({
        message: messageText,
        userName: effectiveUserName,
        audienceMode: preferences.audienceMode ?? 'auto',
        history: historyPayload,
        memorySummary,
        imageBase64: imageToSend || undefined,
        videoBase64: videoDataUrl || undefined,
        screenBase64: screenFrame,
        audioBase64: screenAudio,
        fastMode: Boolean(voiceOrbModeRef.current),
      });

      const isTransientStatus = (status: number) =>
        status === 429 || status === 502 || status === 503 || status === 504;

      const isTransientErrMessage = (msg: string) => {
        const lower = msg.toLowerCase();
        return (
          lower.includes('503') ||
          lower.includes('502') ||
          lower.includes('504') ||
          lower.includes('unavailable') ||
          lower.includes('high demand') ||
          lower.includes('overloaded') ||
          lower.includes('timeout') ||
          lower.includes('failed to fetch') ||
          lower.includes('networkerror') ||
          lower.includes('load failed') ||
          lower.includes('network')
        );
      };

      const fetchChatWithRetry = async (): Promise<Response> => {
        const retryDelays = [350, 850];
        let lastErr: unknown = null;

        for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
          try {
            const res = await fetch('/api/zia/chat', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: requestBodyStr,
            });
            if (!res.ok && isTransientStatus(res.status) && attempt < retryDelays.length) {
              await new Promise((r) => window.setTimeout(r, retryDelays[attempt]));
              continue;
            }
            return res;
          } catch (err) {
            lastErr = err;
            if (attempt < retryDelays.length) {
              await new Promise((r) => window.setTimeout(r, retryDelays[attempt]));
              continue;
            }
          }
        }
        throw lastErr ?? new Error('Conexão instável no momento.');
      };

      const consumeChatStreamOnce = async (): Promise<void> => {
        const res = await fetchChatWithRetry();

        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          throw new Error(errJson.error || `Erro HTTP ${res.status} ao conversar com a Zia AI.`);
        }

        if (!res.body) {
          throw new Error('Streaming indisponível na resposta.');
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let sseBuffer = '';

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          sseBuffer += decoder.decode(value, { stream: true });
          const events = sseBuffer.split('\n\n');
          sseBuffer = events.pop() ?? '';

          for (const evt of events) {
            const line = evt
              .split('\n')
              .find((l) => l.startsWith('data:'));
            if (!line) continue;

            const payloadStr = line.slice(5).trim();
            if (!payloadStr) continue;

            const payload = JSON.parse(payloadStr) as {
              delta?: string;
              done?: boolean;
              error?: string;
            };

            if (payload.error) {
              throw new Error(payload.error);
            }

            if (payload.delta) {
              rawAccumulated += payload.delta;
              const { visibleText } = parseZiaStreamOutput(rawAccumulated, false);
              if (visibleText) {
                setIsTyping(false);
                setStreamingBubble({
                  id: assistantId,
                  role: 'assistant',
                  text: visibleText,
                  timestamp: assistantTimestamp,
                });
                speechSession.pushText(visibleText);
              }
            }
          }
        }
      };

      try {
        try {
          await consumeChatStreamOnce();
        } catch (streamAttemptErr) {
          const msg = streamAttemptErr instanceof Error ? streamAttemptErr.message : String(streamAttemptErr);
          if (!rawAccumulated && isTransientErrMessage(msg)) {
            await new Promise((r) => window.setTimeout(r, 450));
            await consumeChatStreamOnce();
          } else {
            throw streamAttemptErr;
          }
        }

        const finalParsed = parseZiaStreamOutput(rawAccumulated, true);
        if (finalParsed.discoveredName && finalParsed.discoveredName !== userNameRef.current) {
          persistUserName(finalParsed.discoveredName);
        }
        const activeName = finalParsed.discoveredName || effectiveUserName;
        const finalText =
          finalParsed.visibleText ||
          (activeName ? `Prontinho, ${activeName}! Pode mandar.` : 'Prontinho! Pode mandar.');

        let finalImageFields: Partial<ChatMessage> = {};
        if (finalParsed.imagePromptEn) {
          const encodedPrompt = encodeURIComponent(finalParsed.imagePromptEn);
          const imgSeed = Date.now();
          const directFluxUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=512&height=512&model=flux&nologo=true&seed=${imgSeed}`;
          const proxyFluxUrl = `/api/media/image?prompt=${encodedPrompt}&width=512&height=512&model=flux&seed=${imgSeed}`;

          // Pre-warm directly in the browser (uses user IP, keeping server IP free for fallback)
          try {
            const preload = new Image();
            preload.referrerPolicy = 'no-referrer';
            preload.src = directFluxUrl;
          } catch {
            // Ignore browser preload issues
          }

          finalImageFields = {
            generatedImageDirectUrl: directFluxUrl,
            generatedImageUrl: proxyFluxUrl,
            generatedImagePrompt: finalParsed.imagePromptEn,
          };
        }

        const committedMessage: ChatMessage = {
          id: assistantId,
          role: 'assistant',
          text: finalText,
          timestamp: assistantTimestamp,
          ...finalImageFields,
          ...(finalParsed.videoTitle ? { videoTitle: finalParsed.videoTitle } : {}),
        };

        setStreamingBubble(null);
        setIsTyping(false);
        setMessages((prev) => [...prev, committedMessage]);
        speechSession.finish(finalText);

        void refreshDynamicSuggestions([
          ...historyPayload,
          { role: 'user', text: messageText },
          { role: 'assistant', text: finalText },
        ]);

        for (const note of finalParsed.memoryNotes) {
          addMemory(note, 'geral');
        }

        if (finalParsed.videoScenes && finalParsed.videoScenes.length > 0) {
          const title = finalParsed.videoTitle || (activeName ? `Vídeo de ${activeName}` : 'Vídeo da Zia AI');
          setVideoStatus('Preparando cenas ilustradas...');
          try {
            const { blobUrl, mimeType, scenesWithUrls } =
              await renderAnimatedVideoFromScenes(
                title,
                finalParsed.videoScenes,
                (label) => setVideoStatus(label)
              );

            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      videoTitle: title,
                      videoBlobUrl: blobUrl,
                      videoMimeType: mimeType,
                      videoScenes: scenesWithUrls,
                    }
                  : m
              )
            );

            const fullNarration = scenesWithUrls
              .map((s) => s.narrationPt)
              .filter(Boolean)
              .join('. ');
            if (fullNarration) {
              speakZia(fullNarration);
            }
          } catch (videoErr) {
            const errMsg =
              videoErr instanceof Error
                ? videoErr.message
                : 'Não deu pra finalizar o vídeo.';
            setMessages((prev) => [
              ...prev,
              {
                id: `zia-vid-err-${Date.now()}`,
                role: 'assistant',
                text: `Não consegui montar o vídeo agora${activeName ? `, ${activeName}` : ''}: ${errMsg}`,
                timestamp: Date.now(),
              },
            ]);
          } finally {
            setVideoStatus(null);
          }
        }
      } catch (err) {
        setStreamingBubble(null);
        const rawErr = err instanceof Error ? err.message : '';
        const friendlyErr =
          !rawErr || rawErr.trim().startsWith('{') || isTransientErrMessage(rawErr)
            ? 'A conexão ou o servidor oscilou rapidinho. Já estou pronta — tente mandar de novo!'
            : rawErr;
        speechSession.finish('');
        setMessages((prev) => [
          ...prev,
          {
            id: `zia-err-${Date.now()}`,
            role: 'assistant',
            text: `Ops${effectiveUserName ? `, ${effectiveUserName}` : ''}: ${friendlyErr}`,
            timestamp: Date.now(),
          },
        ]);
      } finally {
        setIsTyping(false);
        lastActivityRef.current = Date.now();
      }
    },
    [
      addMemory,
      memorySummary,
      persistUserName,
      preferences.audienceMode,
      preferences.voiceEnabled,
      preferences.voiceRate,
      refreshDynamicSuggestions,
      speakZia,
    ]
  );

  const sendMessageToZia = useCallback(
    async (
      rawText: string,
      attachedImage?: string | null,
      attachedVideo?: RecordedVideoPayload | null
    ) => {
      const trimmed = rawText.trim();
      const imageToSend = attachedImage ?? pendingImage;
      const videoToSend = attachedVideo ?? pendingVideo;
      if (!trimmed && !imageToSend && !videoToSend) return;

      lastActivityRef.current = Date.now();
      if (!audioUnlocked) {
        unlockAndroidAudio();
        setAudioUnlocked(true);
      }

      const screenFrame = captureCurrentScreenFrame();
      const screenAudio = liveAudioCaptureRef.current?.hasSources()
        ? await liveAudioCaptureRef.current.getRecentWavBase64().catch(() => undefined)
        : undefined;

      const userMessage: ChatMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        text:
          trimmed ||
          (videoToSend
            ? 'Zia, assiste esse vídeo que gravei pra você! 🎥✨'
            : 'Zia, olha essa imagem aqui! 📸⚡'),
        timestamp: Date.now(),
        imagePreview: imageToSend || undefined,
        userVideoUrl: videoToSend?.previewUrl,
        userVideoMimeType: videoToSend?.mimeType,
        screenAttached: !!screenFrame,
      };

      const extractedName = extractUserNameFromInput(trimmed, !!userNameRef.current);
      const effectiveUserName = extractedName || userNameRef.current;
      if (extractedName && extractedName !== userNameRef.current) {
        persistUserName(extractedName);
      }

      const historyPayload = messagesRef.current.slice(-8).map((m) => ({
        role: m.role,
        text: m.text.length > 700 ? m.text.slice(0, 700) : m.text,
      }));

      setMessages((prev) => [...prev, userMessage]);
      setInputText('');
      setPendingImage(null);
      setPendingVideo(null);
      setIsTyping(true);

      await streamZiaReply({
        messageText: userMessage.text,
        effectiveUserName,
        historyPayload,
        imageToSend,
        videoDataUrl: videoToSend?.dataUrl,
        screenFrame,
        screenAudio,
      });
    },
    [
      audioUnlocked,
      captureCurrentScreenFrame,
      pendingImage,
      pendingVideo,
      persistUserName,
      streamZiaReply,
    ]
  );

  const handleEditUserMessage = useCallback(
    async (messageId: string, newText: string) => {
      const trimmed = newText.trim();
      if (!trimmed || isTypingRef.current) return;

      stopZiaSpeech();
      setIsSpeaking(false);
      lastActivityRef.current = Date.now();

      if (!audioUnlocked) {
        unlockAndroidAudio();
        setAudioUnlocked(true);
      }

      const currentMessages = messagesRef.current;
      const targetIndex = currentMessages.findIndex(
        (m) => m.id === messageId && m.role === 'user'
      );
      if (targetIndex === -1) return;

      const targetMessage = currentMessages[targetIndex];
      const priorMessages = currentMessages.slice(0, targetIndex);
      const updatedUserMessage: ChatMessage = {
        ...targetMessage,
        text: trimmed,
        timestamp: Date.now(),
      };

      const extractedName = extractUserNameFromInput(trimmed, !!userNameRef.current);
      const effectiveUserName = extractedName || userNameRef.current;
      if (extractedName && extractedName !== userNameRef.current) {
        persistUserName(extractedName);
      }

      const historyPayload = priorMessages.slice(-8).map((m) => ({
        role: m.role,
        text: m.text.length > 700 ? m.text.slice(0, 700) : m.text,
      }));

      const screenFrame = captureCurrentScreenFrame();
      const screenAudio = liveAudioCaptureRef.current?.hasSources()
        ? await liveAudioCaptureRef.current.getRecentWavBase64().catch(() => undefined)
        : undefined;

      setMessages([...priorMessages, updatedUserMessage]);
      setIsTyping(true);

      await streamZiaReply({
        messageText: updatedUserMessage.text,
        effectiveUserName,
        historyPayload,
        imageToSend: updatedUserMessage.imagePreview || null,
        screenFrame,
        screenAudio,
      });
    },
    [audioUnlocked, captureCurrentScreenFrame, persistUserName, streamZiaReply]
  );

  // Real-time Continuous Screen + Audio Capture Loop: runs in foreground AND background tabs without dropping
  useEffect(() => {
    if (!isScreenSharing) {
      latestScreenFrameRef.current = undefined;
      lastFrameSigRef.current = [];
      setScreenPulseCount(0);
      return;
    }

    let cancelled = false;
    let rafId = 0;
    let lastSampleAt = 0;
    let lastUiTickAt = 0;

    const triggerLiveObservation = async (frameUrl: string, sig: number[]) => {
      lastFrameSigRef.current = sig;
      lastScreenObserveAtRef.current = Date.now();
      screenObserveBusyRef.current = true;

      try {
        const audioWav = liveAudioCaptureRef.current?.hasSources()
          ? await liveAudioCaptureRef.current.getRecentWavBase64().catch(() => undefined)
          : undefined;

        const res = await fetch('/api/zia/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message:
              'Vendo sua tela e som ao vivo agora: manda em 1 frase curta e direta o que rolou ou uma dica rápida!',
            userName: userNameRef.current,
            audienceMode: audienceModeRef.current,
            history: messagesRef.current.slice(-4).map((m) => ({
              role: m.role,
              text: m.text.slice(0, 300),
            })),
            memorySummary: memorySummaryRef.current,
            screenBase64: frameUrl,
            audioBase64: audioWav,
            fastMode: true,
          }),
        });
        if (!res.ok || !res.body || cancelled) return;

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let sseBuf = '';
        let fullRaw = '';

        while (true) {
          const { value, done } = await reader.read();
          if (done || cancelled) break;
          sseBuf += decoder.decode(value, { stream: true });
          const events = sseBuf.split('\n\n');
          sseBuf = events.pop() ?? '';
          for (const evt of events) {
            const line = evt.split('\n').find((l) => l.startsWith('data:'));
            if (!line) continue;
            try {
              const parsed = JSON.parse(line.slice(5).trim()) as { delta?: string };
              if (parsed.delta) fullRaw += parsed.delta;
            } catch {
              // Ignore partial parse
            }
          }
        }

        const clean = parseZiaStreamOutput(fullRaw, true).visibleText;
        if (clean && !cancelled) {
          setMessages((prev) => [
            ...prev,
            {
              id: `zia-screen-${Date.now()}`,
              role: 'assistant',
              text: clean,
              timestamp: Date.now(),
            },
          ]);
          speakZia(clean);
        }
      } catch {
        // Ignore transient live observation errors
      } finally {
        screenObserveBusyRef.current = false;
        lastScreenObserveAtRef.current = Date.now();
      }
    };

    const sampleScreenNow = (ts: number) => {
      if (cancelled) return;
      if (ts - lastSampleAt < 90) return;
      lastSampleAt = ts;

      try {
        const video = screenVideoRef.current;
        if (!video || video.readyState < 2 || video.videoWidth <= 0 || video.videoHeight <= 0) return;

        const maxW = 640;
        const scale = Math.min(1, maxW / video.videoWidth);
        const w = Math.max(1, Math.round(video.videoWidth * scale));
        const h = Math.max(1, Math.round(video.videoHeight * scale));

        if (!screenCanvasRef.current) {
          screenCanvasRef.current = document.createElement('canvas');
        }
        const canvas = screenCanvasRef.current;
        if (canvas.width !== w) canvas.width = w;
        if (canvas.height !== h) canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.drawImage(video, 0, 0, w, h);
        const frameUrl = canvas.toDataURL('image/jpeg', 0.62);
        latestScreenFrameRef.current = frameUrl;

        if (ts - lastUiTickAt >= 500) {
          lastUiTickAt = ts;
          setScreenPulseCount((c) => c + 1);
        }

        if (!diffCanvasRef.current) {
          const tiny = document.createElement('canvas');
          tiny.width = 4;
          tiny.height = 4;
          diffCanvasRef.current = tiny;
        }
        const tCtx = diffCanvasRef.current.getContext('2d', { willReadFrequently: true });
        if (!tCtx) return;
        tCtx.drawImage(canvas, 0, 0, 4, 4);
        const pixels = tCtx.getImageData(0, 0, 4, 4).data;
        const sig: number[] = [];
        for (let i = 0; i < pixels.length; i += 4) {
          sig.push((pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3);
        }

        const prevSig = lastFrameSigRef.current;
        let diff = prevSig.length === 0 ? 100 : 0;
        if (prevSig.length === sig.length) {
          for (let i = 0; i < sig.length; i++) {
            diff += Math.abs(sig[i] - prevSig[i]);
          }
          diff /= sig.length;
        }

        const now = Date.now();
        const canObserve =
          screenAutoWatchRef.current &&
          !isTypingRef.current &&
          !isSpeakingRef.current &&
          !speechActiveRef.current &&
          !screenObserveBusyRef.current &&
          diff >= 10 &&
          now - lastScreenObserveAtRef.current >= 7000;

        if (canObserve) {
          void triggerLiveObservation(frameUrl, sig);
        }
      } catch {
        // Ignore transient video/canvas frame read errors while stream initializes or ends
      }
    };

    const loop = (ts: number) => {
      if (cancelled) return;
      rafId = window.requestAnimationFrame(loop);
      sampleScreenNow(ts);
    };

    rafId = window.requestAnimationFrame(loop);
    // Keep continuous capture active even when switching tabs/windows
    const backgroundInterval = window.setInterval(() => {
      sampleScreenNow(performance.now());
    }, 480);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(rafId);
      window.clearInterval(backgroundInterval);
    };
  }, [isScreenSharing, speakZia]);

  // Proactive Companion Mode: every 25s of silence
  useEffect(() => {
    if (!preferences.companionMode) return;

    const interval = window.setInterval(async () => {
      const silenceMs = Date.now() - lastActivityRef.current;
      if (
        silenceMs < 25000 ||
        isTyping ||
        isListening ||
        isSpeaking ||
        proactiveBusyRef.current
      ) {
        return;
      }

      proactiveBusyRef.current = true;
      lastActivityRef.current = Date.now();

      try {
        const recentTopics = messages
          .slice(-4)
          .map((m) => m.text)
          .join(' | ');
        const res = await fetch('/api/zia/proactive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userName: userNameRef.current,
            audienceMode: preferences.audienceMode ?? 'auto',
            memorySummary,
            recentTopics,
          }),
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data.reply) {
          const proactiveMsg: ChatMessage = {
            id: `zia-proactive-${Date.now()}`,
            role: 'assistant',
            text: data.reply,
            timestamp: Date.now(),
            isProactive: true,
          };
          setMessages((prev) => [...prev, proactiveMsg]);
          speakZia(data.reply);
        }
      } catch {
        // Silent retry on next cycle
      } finally {
        proactiveBusyRef.current = false;
        lastActivityRef.current = Date.now();
      }
    }, 2000);

    return () => window.clearInterval(interval);
  }, [
    isListening,
    isSpeaking,
    isTyping,
    memorySummary,
    messages,
    preferences.audienceMode,
    preferences.companionMode,
    speakZia,
  ]);

  const handleToggleVoiceButton = () => {
    unlockAndroidAudio();
    setAudioUnlocked(true);
    const nextEnabled = !preferences.voiceEnabled;
    setPreferences((prev) => ({ ...prev, voiceEnabled: nextEnabled }));

    if (!nextEnabled) {
      stopZiaSpeech();
      setIsSpeaking(false);
      showTempNotice('Voz da Zia mutada 🔇');
    } else {
      showTempNotice('Voz da Zia ligada! 🔊');
      const greeting = userNameRef.current
        ? `Oi ${userNameRef.current}! Voz ativada, pode falar comigo!`
        : 'Oi! Voz ativada, pode falar comigo quando quiser!';
      speakWithZiaVoice(greeting, {
        enabled: true,
        rate: preferences.voiceRate,
        onStart: () => setIsSpeaking(true),
        onEnd: () => setIsSpeaking(false),
      });
    }
  };

  const handleToggleCompanionMode = () => {
    unlockAndroidAudio();
    setAudioUnlocked(true);
    lastActivityRef.current = Date.now();
    const nextVal = !preferences.companionMode;
    setPreferences((prev) => ({ ...prev, companionMode: nextVal }));
    showTempNotice(
      nextVal
        ? 'Modo Companhia ligado! Puxo assunto a cada 25s de silêncio ✨'
        : 'Modo Companhia pausado'
    );
  };

  const stopScreenShare = useCallback(() => {
    liveAudioCaptureRef.current?.detachStream('screen');
    screenStreamRef.current?.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch {
        // Ignore
      }
    });
    screenStreamRef.current = null;
    latestScreenFrameRef.current = undefined;
    if (screenVideoRef.current) {
      screenVideoRef.current.srcObject = null;
    }
    setHasScreenAudio(false);
    setIsScreenSharing(false);
    setScreenPulseCount(0);
  }, []);

  const handleToggleScreenShare = async () => {
    unlockAndroidAudio();
    setAudioUnlocked(true);

    if (isScreenSharing) {
      stopScreenShare();
      showTempNotice('Compartilhamento de tela encerrado.');
      return;
    }

    setScreenBlockedHelp(false);

    const mediaDevices = navigator.mediaDevices as MediaDevices & {
      getDisplayMedia?: (constraints?: MediaStreamConstraints) => Promise<MediaStream>;
    };

    if (!mediaDevices || typeof mediaDevices.getDisplayMedia !== 'function') {
      setScreenBlockedHelp(true);
      showTempNotice('Para tela + som em tempo real, abra fora da prévia no Chrome ou envie um print! 📺');
      return;
    }

    try {
      let stream: MediaStream;
      try {
        stream = await mediaDevices.getDisplayMedia({
          video: { frameRate: { ideal: 15, max: 30 } },
          audio: true,
        });
      } catch {
        // Fallback when browser/device refuses system audio track
        stream = await mediaDevices.getDisplayMedia({
          video: { frameRate: { ideal: 15, max: 30 } },
          audio: false,
        });
      }

      screenStreamRef.current = stream;
      lastScreenObserveAtRef.current = 0;

      if (!liveAudioCaptureRef.current) {
        liveAudioCaptureRef.current = new LiveAudioCapture(3.5);
      }
      const gotAudio = liveAudioCaptureRef.current.attachStream('screen', stream, false);
      setHasScreenAudio(gotAudio);

      setIsScreenSharing(true);
      showTempNotice(
        gotAudio
          ? 'Zia vendo sua tela em tempo real E ouvindo o som! 📺🔊'
          : 'Zia vendo sua tela em tempo real instantâneo! 📺⚡'
      );

      const [videoTrack] = stream.getVideoTracks();
      if (videoTrack) {
        videoTrack.onended = () => {
          stopScreenShare();
        };
      }
    } catch {
      setScreenBlockedHelp(true);
      showTempNotice('Permissão de tela ao vivo bloqueada aqui — veja a opção na tela! 📺');
    }
  };

  const handleToggleFloatingWindow = useCallback(async (): Promise<boolean> => {
    unlockAndroidAudio();
    setAudioUnlocked(true);
    setPipBlockedHelp(false);

    if (pip.isOpen) {
      pip.closePiP();
      showTempNotice('Janela flutuante fechada.');
      return true;
    }
    if (videoPiP.isOpen) {
      await videoPiP.closeVideoPiP();
      showTempNotice('Janela flutuante fechada.');
      return true;
    }

    if (pip.isSupported) {
      try {
        const opened = await pip.openPiP();
        if (opened) {
          showTempNotice('Janela flutuante ativa sobre os apps! 🪟✨');
          return true;
        }
      } catch {
        // Fallback to OS Video PiP if Document PiP is blocked by iframe or browser
      }
    }

    if (videoPiP.isSupported) {
      try {
        const opened = await videoPiP.openVideoPiP();
        if (opened) {
          showTempNotice('Janela flutuante Picture-in-Picture ativada! 🪟✨');
          return true;
        }
      } catch {
        // Blocked by iframe/browser policy
      }
    }

    setPipBlockedHelp(true);
    showTempNotice('Abra em nova aba para liberar a janela flutuante! 🌐');
    return false;
  }, [pip, showTempNotice, videoPiP]);

  const handleStartSpeechRecognition = useCallback(() => {
    unlockAndroidAudio();
    setAudioUnlocked(true);

    // ChatGPT-style barge-in: tapping Orb/mic while Zia is speaking interrupts her and listens immediately
    if (isSpeakingRef.current) {
      stopZiaSpeech();
      setIsSpeaking(false);
    }

    if (isListeningRef.current) {
      if (silenceCommitTimerRef.current !== null) {
        window.clearTimeout(silenceCommitTimerRef.current);
        silenceCommitTimerRef.current = null;
      }
      try {
        recognitionRef.current?.stop();
      } catch {
        // Ignore
      }
      speechActiveRef.current = false;
      setIsListening(false);
      return;
    }

    const win = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const SpeechRec = win.SpeechRecognition || win.webkitSpeechRecognition;

    if (!SpeechRec) {
      showTempNotice('Seu navegador não suporta ditado direto — use Ouvir Áudio ou digite! 💬');
      return;
    }

    try {
      stopZiaSpeech();
      recognitionStartingRef.current = true;
      const recognition = new SpeechRec();
      const continuousOrb = Boolean(voiceOrbModeRef.current || isMicAudioLiveRef.current);
      recognition.lang = 'pt-BR';
      recognition.interimResults = true;
      recognition.continuous = continuousOrb;

      let latestTranscript = '';
      let committed = false;

      const commitUtterance = (textToSend: string) => {
        if (committed) return;
        const clean = textToSend.trim();
        if (!clean) return;
        committed = true;
        speechActiveRef.current = false;
        if (silenceCommitTimerRef.current !== null) {
          window.clearTimeout(silenceCommitTimerRef.current);
          silenceCommitTimerRef.current = null;
        }
        try {
          recognition.stop();
        } catch {
          // Ignore
        }
        markMicStopped();
        setIsListening(false);
        void sendMessageToZia(clean);
      };

      recognition.onresult = (event) => {
        let combined = '';
        let hasFinal = false;
        for (let i = 0; i < event.results.length; i++) {
          const result = event.results[i];
          combined += result[0].transcript;
          if (result.isFinal) hasFinal = true;
        }
        latestTranscript = combined.trim();
        if (latestTranscript) {
          speechActiveRef.current = true;
          setInputText(latestTranscript);
        }

        if (silenceCommitTimerRef.current !== null) {
          window.clearTimeout(silenceCommitTimerRef.current);
          silenceCommitTimerRef.current = null;
        }

        if (!continuousOrb) {
          if (hasFinal && latestTranscript) {
            commitUtterance(latestTranscript);
          }
        } else if (latestTranscript) {
          // Wait briefly after pause so user isn't cut off mid-sentence, then reply fast
          const waitMs = hasFinal ? 520 : 1050;
          silenceCommitTimerRef.current = window.setTimeout(() => {
            commitUtterance(latestTranscript);
          }, waitMs);
        }
      };

      recognition.onerror = (event) => {
        recognitionStartingRef.current = false;
        speechActiveRef.current = false;
        markMicStopped();
        setIsListening(false);
        const errCode = event?.error || '';
        if (errCode === 'no-speech' || errCode === 'aborted') {
          return;
        }
        if (errCode === 'not-allowed' || errCode === 'service-not-allowed') {
          voiceOrbModeRef.current = false;
          setIsVoiceOrbMode(false);
          showTempNotice('Permissão de microfone bloqueada — libere o mic no navegador! 🎤');
          return;
        }
        if (errCode === 'audio-capture') {
          // Free getUserMedia mic track if Android browser blocks simultaneous SpeechRecognition + MediaStream
          if (isMicAudioLiveRef.current) {
            liveAudioCaptureRef.current?.detachStream('mic');
          } else if (!voiceOrbModeRef.current) {
            showTempNotice('Microfone ocupado ou indisponível no momento. 🎤');
          }
          return;
        }
        if (errCode === 'network') {
          lastRecognitionNetErrAtRef.current = Date.now();
          if (!voiceOrbModeRef.current && !isMicAudioLiveRef.current) {
            showTempNotice('Oscilação rápida no serviço de voz. Tenta falar de novo!');
          }
          return;
        }
        if (!voiceOrbModeRef.current && !isMicAudioLiveRef.current) {
          showTempNotice('Não deu pra ouvir o mic. Tenta de novo aí! 🎤');
        }
      };

      recognition.onend = () => {
        recognitionStartingRef.current = false;
        speechActiveRef.current = false;
        if (silenceCommitTimerRef.current !== null) {
          window.clearTimeout(silenceCommitTimerRef.current);
          silenceCommitTimerRef.current = null;
        }
        markMicStopped();
        setIsListening(false);
        if (!committed && latestTranscript && continuousOrb) {
          commitUtterance(latestTranscript);
          return;
        }
        if ((voiceOrbModeRef.current || isMicAudioLiveRef.current) && !isTypingRef.current && !isSpeakingRef.current) {
          const waitMs = Date.now() - lastRecognitionNetErrAtRef.current < 1800 ? 1800 : 180;
          window.setTimeout(() => {
            startListeningIfOrbRef.current();
          }, waitMs);
        }
      };

      recognitionRef.current = recognition;
      setIsListening(true);
      recognition.start();
      recognitionStartingRef.current = false;
    } catch {
      recognitionStartingRef.current = false;
      speechActiveRef.current = false;
      setIsListening(false);
      if (!voiceOrbModeRef.current) {
        showTempNotice('Permita o uso do microfone no navegador para falar com a Zia! 🎤');
      }
    }
  }, [sendMessageToZia, showTempNotice]);

  micActionRef.current = handleStartSpeechRecognition;
  startListeningIfOrbRef.current = () => {
    if (
      (voiceOrbModeRef.current || isMicAudioLiveRef.current) &&
      !isListeningRef.current &&
      !isTypingRef.current &&
      !isSpeakingRef.current &&
      !recognitionStartingRef.current &&
      Date.now() - lastRecognitionNetErrAtRef.current >= 1800
    ) {
      handleStartSpeechRecognition();
    }
  };

  // Unbreakable Voice Orb / Continuous Listen Watchdog: never lets listening die mid-conversation
  useEffect(() => {
    if (!isVoiceOrbMode && !isMicAudioLive) return;
    const watchdog = window.setInterval(() => {
      if (
        (voiceOrbModeRef.current || isMicAudioLiveRef.current) &&
        !isListeningRef.current &&
        !isTypingRef.current &&
        !isSpeakingRef.current &&
        !recognitionStartingRef.current &&
        Date.now() - lastRecognitionNetErrAtRef.current >= 1800
      ) {
        startListeningIfOrbRef.current();
      }
    }, 950);
    return () => window.clearInterval(watchdog);
  }, [isVoiceOrbMode, isMicAudioLive]);

  const handleToggleMicAudioLive = useCallback(async () => {
    unlockAndroidAudio();
    setAudioUnlocked(true);

    if (isMicAudioLiveRef.current) {
      isMicAudioLiveRef.current = false;
      setIsMicAudioLive(false);
      liveAudioCaptureRef.current?.detachStream('mic');
      if (silenceCommitTimerRef.current !== null) {
        window.clearTimeout(silenceCommitTimerRef.current);
        silenceCommitTimerRef.current = null;
      }
      speechActiveRef.current = false;
      try {
        recognitionRef.current?.stop();
      } catch {
        // Ignore
      }
      setIsListening(false);
      showTempNotice('Escuta contínua de áudio pausada.');
      return;
    }

    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      showTempNotice('Microfone indisponível neste ambiente — abra no Chrome para ouvir seu áudio! 🎧');
      return;
    }

    try {
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (!liveAudioCaptureRef.current) {
        liveAudioCaptureRef.current = new LiveAudioCapture(3.5);
      }
      liveAudioCaptureRef.current.attachStream('mic', micStream, true);
      const [micTrack] = micStream.getAudioTracks();
      if (micTrack) {
        micTrack.onended = () => {
          isMicAudioLiveRef.current = false;
          setIsMicAudioLive(false);
          liveAudioCaptureRef.current?.detachStream('mic');
        };
      }
      isMicAudioLiveRef.current = true;
      setIsMicAudioLive(true);
      showTempNotice('Zia ouvindo seu áudio em tempo real sem erros! 🎧⚡');
      const win = window as unknown as {
        SpeechRecognition?: new () => SpeechRecognitionLike;
        webkitSpeechRecognition?: new () => SpeechRecognitionLike;
      };
      if ((win.SpeechRecognition || win.webkitSpeechRecognition) && !isListeningRef.current) {
        handleStartSpeechRecognition();
      }
    } catch {
      showTempNotice('Libere a permissão do microfone no navegador para a Zia ouvir seu áudio! 🎤');
    }
  }, [handleStartSpeechRecognition, showTempNotice]);

  const handleToggleVoiceOrbMode = useCallback(async () => {
    unlockAndroidAudio();
    setAudioUnlocked(true);
    const next = !isVoiceOrbMode;
    voiceOrbModeRef.current = next;
    setIsVoiceOrbMode(next);

    if (!next) {
      if (silenceCommitTimerRef.current !== null) {
        window.clearTimeout(silenceCommitTimerRef.current);
        silenceCommitTimerRef.current = null;
      }
      speechActiveRef.current = false;
      try {
        recognitionRef.current?.stop();
      } catch {
        // Ignore
      }
      setIsListening(false);
      if (pip.isOpen) pip.closePiP();
      if (videoPiP.isOpen) await videoPiP.closeVideoPiP();
      showTempNotice('Modo Bola de Voz encerrado.');
      return;
    }

    setPreferences((prev) => ({ ...prev, voiceEnabled: true }));

    // Open floating window/orb if supported & not already open
    if (!pip.isOpen && !videoPiP.isOpen) {
      let opened = false;
      if (pip.isSupported) {
        try {
          opened = await pip.openPiP();
        } catch {
          opened = false;
        }
      }
      if (!opened && videoPiP.isSupported) {
        try {
          opened = await videoPiP.openVideoPiP();
        } catch {
          opened = false;
        }
      }
    }

    showTempNotice('Bola de Voz da Zia ativa! Pode falar direto 🎙️🔵');
    if (!isListening) {
      handleStartSpeechRecognition();
    }
  }, [handleStartSpeechRecognition, isListening, isVoiceOrbMode, pip, showTempNotice, videoPiP]);

  const handleFilePick = async (e: React.ChangeEvent<HTMLInputElement>, autoSend = false) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      if (file.type.startsWith('video/')) {
        if (file.size > 24 * 1024 * 1024) {
          showTempNotice('Esse vídeo passa de 24 MB. Mande um vídeo mais curto (até 15s)!');
          return;
        }
        const dataUrl = await readFileAsDataUrl(file);
        const previewUrl = URL.createObjectURL(file);
        const vidPayload: RecordedVideoPayload = {
          dataUrl,
          mimeType: file.type.split(';')[0] || 'video/mp4',
          previewUrl,
        };
        if (autoSend) {
          void sendMessageToZia(
            inputText.trim() || 'Zia, assiste esse vídeo aqui pra mim!',
            null,
            vidPayload
          );
        } else {
          setPendingVideo(vidPayload);
        }
        return;
      }

      const dataUrl = await readFileAsDataUrl(file);
      if (autoSend) {
        void sendMessageToZia(
          inputText.trim() || 'Zia, olha esse print da minha tela! O que você vê e como posso melhorar?',
          dataUrl
        );
      } else {
        setPendingImage(dataUrl);
      }
    } catch {
      showTempNotice('Não consegui abrir esse arquivo.');
    }
  };

  const handleSubmitForm = (e: React.FormEvent) => {
    e.preventDefault();
    void sendMessageToZia(inputText);
  };

  const handleConfirmInlineName = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = persistUserName(nameDraft);
    if (!cleaned) return;
    setNameDraft('');
    unlockAndroidAudio();
    setAudioUnlocked(true);
    showTempNotice(`Prazer, ${cleaned}! Como posso te ajudar hoje?`);
    if (preferences.voiceEnabled) {
      speakZia(`Oi ${cleaned}, prazer! O que você precisa hoje?`, true);
    }
  };

  return (
    <div className="h-[100dvh] w-full bg-[#050810] text-slate-100 flex items-center justify-center overflow-hidden">
      <div className="h-[100dvh] sm:h-[94dvh] w-full max-w-[460px] bg-[#090d16] sm:rounded-3xl sm:border sm:border-sky-400/20 sm:shadow-2xl flex flex-col overflow-hidden relative">
      {/* Hidden File Inputs for Gallery (Foto/Vídeo) & Screen Fallback */}
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*,video/*"
        className="hidden"
        onChange={(e) => void handleFilePick(e, false)}
      />
      <input
        ref={screenFallbackInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void handleFilePick(e, true)}
      />

      {/* Compact Sticky Top Bar */}
      <header className="shrink-0 z-30 bg-[#090d16]/90 backdrop-blur-md border-b border-sky-400/15 pt-safe">
        <div className="w-full px-2.5 h-12 flex items-center justify-between gap-1.5">
          {/* Brand */}
          <div className="flex items-center gap-2 min-w-0 shrink-0">
            <div className="w-8 h-8 rounded-xl overflow-hidden bg-[#020a31] flex items-center justify-center shrink-0 shadow-md shadow-sky-500/20">
              {!avatarError ? (
                <img
                  src={ZIA_LOGO_URL}
                  alt="Logo oficial da Zia AI"
                  onError={() => setAvatarError(true)}
                  className="w-full h-full object-contain"
                />
              ) : (
                <Sparkles className="w-4 h-4 text-sky-300" />
              )}
            </div>
            <h1 className="text-sm font-bold tracking-tight text-white whitespace-nowrap">
              Zia AI
            </h1>
          </div>

          {/* Core Action Controls */}
          <div className="flex items-center gap-1 flex-1 min-w-0 justify-end">
            <div className="flex items-center gap-1 overflow-x-auto zia-scroll py-1 min-w-0">
              <button
                type="button"
                onClick={handleToggleVoiceButton}
                className={`min-h-[36px] px-2.5 rounded-xl text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors cursor-pointer border ${
                  preferences.voiceEnabled
                    ? 'bg-sky-500/20 border-sky-400/45 text-sky-200 hover:bg-sky-500/30'
                    : 'bg-[#131b2e] border-white/10 text-slate-400 hover:text-white'
                }`}
                title="Ligar ou mutar voz da Zia"
              >
                {preferences.voiceEnabled ? (
                  <Volume2 className={`w-4 h-4 text-sky-300 shrink-0 ${isSpeaking ? 'animate-pulse' : ''}`} />
                ) : (
                  <VolumeX className="w-4 h-4 shrink-0" />
                )}
                <span>
                  {preferences.voiceEnabled
                    ? isSpeaking
                      ? '🔊 Falando...'
                      : '🔊 Voz Ativada'
                    : '🔇 Voz Mutada'}
                </span>
              </button>

              <button
                type="button"
                onClick={handleToggleCompanionMode}
                className={`min-h-[36px] px-2.5 rounded-xl text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors cursor-pointer border ${
                  preferences.companionMode
                    ? 'bg-purple-500/25 border-purple-400/50 text-purple-200 hover:bg-purple-500/35'
                    : 'bg-[#131b2e] border-white/10 text-slate-300 hover:text-white'
                }`}
                title="Quando ativado, a Zia puxa assunto a cada 25s de silêncio"
              >
                <Sparkles
                  className={`w-3.5 h-3.5 shrink-0 ${
                    preferences.companionMode ? 'text-purple-300' : 'text-slate-400'
                  }`}
                />
                <span>✨ Companhia</span>
                <span
                  className={`text-[10px] font-mono ${
                    preferences.companionMode ? 'text-purple-200' : 'text-slate-500'
                  }`}
                >
                  {preferences.companionMode ? 'ON' : 'OFF'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => void handleToggleScreenShare()}
                className={`min-h-[36px] px-2.5 rounded-xl text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors cursor-pointer border ${
                  isScreenSharing
                    ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-200 hover:bg-emerald-500/30'
                    : 'bg-[#131b2e] border-white/10 text-slate-300 hover:text-white'
                }`}
                title="Compartilhar tela em tempo real para a Zia analisar"
              >
                {isScreenSharing ? (
                  <MonitorOff className="w-3.5 h-3.5 text-emerald-300 shrink-0" />
                ) : (
                  <Monitor className="w-3.5 h-3.5 text-sky-300 shrink-0" />
                )}
                <span>{isScreenSharing ? '📺 Parar Tela' : '📺 Ver Tela'}</span>
              </button>

              <button
                type="button"
                onClick={() => void handleToggleMicAudioLive()}
                className={`min-h-[36px] px-2.5 rounded-xl text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors cursor-pointer border ${
                  isMicAudioLive
                    ? 'bg-cyan-500/20 border-cyan-400/50 text-cyan-200 hover:bg-cyan-500/30'
                    : 'bg-[#131b2e] border-white/10 text-slate-300 hover:text-white'
                }`}
                title="Ouvir seu áudio e microfone continuamente"
              >
                <Mic className={`w-3.5 h-3.5 shrink-0 ${isMicAudioLive ? 'text-cyan-300 animate-pulse' : 'text-purple-300'}`} />
                <span>{isMicAudioLive ? '🎧 Ouvindo' : '🎧 Ouvir Áudio'}</span>
              </button>

              <button
                type="button"
                onClick={() => void handleToggleVoiceOrbMode()}
                className={`min-h-[36px] px-2.5 rounded-xl text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors cursor-pointer border ${
                  isVoiceOrbMode
                    ? 'bg-gradient-to-r from-rose-500/30 to-purple-500/35 border-rose-400/60 text-white animate-pulse'
                    : 'bg-[#131b2e] border-sky-400/30 text-sky-200 hover:bg-sky-500/20'
                }`}
                title="Transformar a Zia em Bola de Voz Flutuante contínua"
              >
                <Mic className={`w-3.5 h-3.5 shrink-0 ${isVoiceOrbMode ? 'text-rose-300' : 'text-sky-300'}`} />
                <span>{isVoiceOrbMode ? '🔵 Orb ON' : '🎙️ Bola Voz'}</span>
              </button>

              <button
                type="button"
                onClick={() => void handleToggleFloatingWindow()}
                className={`min-h-[36px] px-2.5 rounded-xl text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors cursor-pointer border ${
                  pip.isOpen || videoPiP.isOpen
                    ? 'bg-purple-500/25 border-purple-400/50 text-purple-200 hover:bg-purple-500/35'
                    : 'bg-[#131b2e] border-white/10 text-slate-300 hover:text-white'
                }`}
                title="Abrir Janela Flutuante sobre jogos e outros apps"
              >
                <PictureInPicture2 className="w-3.5 h-3.5 text-purple-300 shrink-0" />
                <span>{pip.isOpen || videoPiP.isOpen ? '🪟 Flutua ON' : '🪟 Flutuante'}</span>
              </button>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <PWAInstallButton />

              <button
                type="button"
                onClick={() => setIsMemoryOpen(true)}
                className="min-h-[36px] min-w-[36px] rounded-xl bg-[#131b2e] border border-white/10 text-slate-300 hover:text-white hover:border-sky-400/30 flex items-center justify-center shrink-0 cursor-pointer"
                aria-label="Memória e Configurações"
                title="Memória Infinita e Ajustes"
              >
                <Settings className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </header>

      <OfflineIndicator />
      <PWAInstallBanner />

      {headerNotice && (
        <div className="mx-auto mt-2 px-4 py-1.5 rounded-xl bg-[#131b2e] border border-sky-400/30 text-xs font-medium text-sky-200 shadow-lg max-w-[92%] text-center">
          {headerNotice}
        </div>
      )}

      {screenBlockedHelp && !isScreenSharing && (
        <div className="mx-auto mt-2 w-[94%] max-w-2xl rounded-2xl bg-[#131b2e] border border-sky-400/30 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 shadow-xl">
          <div className="text-xs text-slate-200 leading-relaxed">
            <strong className="text-sky-300">Tela ao vivo a cada 1s:</strong> este ambiente incorporado ou navegador bloqueou a captura contínua de tela. Abra em uma aba normal para ver a tela a cada 1s, ou envie um print agora:
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <a
              href={typeof window !== 'undefined' ? window.location.origin : '/'}
              target="_blank"
              rel="noopener noreferrer"
              className="min-h-[36px] px-3 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-bold inline-flex items-center gap-1.5"
            >
              <Globe className="w-3.5 h-3.5" />
              <span>Abrir em Nova Aba</span>
            </a>
            <button
              type="button"
              onClick={() => {
                setScreenBlockedHelp(false);
                screenFallbackInputRef.current?.click();
              }}
              className="min-h-[36px] px-3 rounded-xl bg-white/10 hover:bg-white/15 text-slate-100 text-xs font-semibold cursor-pointer"
            >
              Enviar Print
            </button>
            <button
              type="button"
              onClick={() => setScreenBlockedHelp(false)}
              className="min-h-[36px] min-w-[36px] rounded-xl text-slate-400 hover:text-white flex items-center justify-center cursor-pointer"
              aria-label="Fechar aviso"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {pipBlockedHelp && !pip.isOpen && !videoPiP.isOpen && (
        <div className="mx-auto mt-2 w-[94%] max-w-2xl rounded-2xl bg-[#131b2e] border border-purple-400/35 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 shadow-xl">
          <div className="text-xs text-slate-200 leading-relaxed">
            <strong className="text-purple-300">Janela Flutuante:</strong> este ambiente incorporado bloqueou a janela sobreposta. Abra a Zia AI fora da prévia em uma aba normal (ou use o app Android em <code className="text-sky-300">android-companion/</code>):
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <a
              href={typeof window !== 'undefined' ? window.location.origin : '/'}
              target="_blank"
              rel="noopener noreferrer"
              className="min-h-[36px] px-3 rounded-xl bg-gradient-to-r from-sky-500 to-purple-500 text-white text-xs font-bold inline-flex items-center gap-1.5"
            >
              <Globe className="w-3.5 h-3.5" />
              <span>Abrir em Nova Aba</span>
            </a>
            <button
              type="button"
              onClick={() => setPipBlockedHelp(false)}
              className="min-h-[36px] min-w-[36px] rounded-xl text-slate-400 hover:text-white flex items-center justify-center cursor-pointer"
              aria-label="Fechar aviso"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Main Compact Mobile-First Workspace */}
      <main className="flex-1 min-h-0 w-full relative flex flex-col">
        {/* CHAT TAB */}
        <section
          className={`h-full flex-col min-h-0 ${
            activeTab === 'chat' ? 'flex' : 'hidden'
          }`}
        >
          {/* Live Screen Preview Mini-Window */}
          {isScreenSharing && (
            <div className="mx-3 mt-2.5 rounded-2xl bg-[#131b2e] border border-emerald-400/35 p-2 flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-16 h-10 rounded-xl overflow-hidden bg-black border border-white/10 shrink-0">
                  <video
                    ref={screenVideoRef}
                    autoPlay
                    muted
                    playsInline
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-300">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="truncate">
                      {hasScreenAudio || isMicAudioLive
                        ? 'Tela + Áudio · Tempo Real'
                        : 'Tela ao vivo · Tempo Real'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 truncate">
                    {screenAutoWatch
                      ? hasScreenAudio || isMicAudioLive
                        ? 'Zia vendo tela em tempo real e ouvindo seu áudio'
                        : 'Zia vendo tela em tempo real e reagindo na hora'
                      : `Leitura instantânea ativa (${screenPulseCount}) — pergunte quando quiser`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setScreenAutoWatch((v) => !v)}
                  className={`min-h-[34px] px-2 rounded-xl text-[11px] font-semibold flex items-center gap-1 cursor-pointer border ${
                    screenAutoWatch
                      ? 'bg-emerald-500/20 border-emerald-400/40 text-emerald-200'
                      : 'bg-white/5 border-white/10 text-slate-400'
                  }`}
                  title="Ativar ou pausar comentários automáticos ao vivo"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>{screenAutoWatch ? 'Auto ON' : 'Auto OFF'}</span>
                </button>
                <button
                  type="button"
                  onClick={stopScreenShare}
                  className="min-h-[34px] px-2.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 text-xs font-semibold shrink-0 cursor-pointer"
                >
                  Parar
                </button>
              </div>
            </div>
          )}

          {/* Scrollable Messages Feed OR Clean Centered Home Prompt */}
          <div
            ref={scrollContainerRef}
            className="flex-1 overflow-y-auto zia-scroll px-3.5 py-4 space-y-3.5"
          >
            {messages.length === 0 && !streamingBubble && !isTyping ? (
              <div className="h-full min-h-[240px] flex flex-col items-center justify-center text-center px-4">
                <div className="w-14 h-14 rounded-2xl overflow-hidden bg-[#020a31] border border-sky-400/25 shadow-lg shadow-sky-500/20 flex items-center justify-center mb-4">
                  {!avatarError ? (
                    <img
                      src={ZIA_LOGO_URL}
                      alt="Zia AI"
                      onError={() => setAvatarError(true)}
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <Sparkles className="w-6 h-6 text-sky-300" />
                  )}
                </div>

                <h2 className="text-xl font-bold text-white tracking-tight leading-snug max-w-[280px]">
                  {userName ? `O que você precisa hoje, ${userName}?` : 'O que você precisa hoje?'}
                </h2>

                {!userName ? (
                  <form
                    onSubmit={handleConfirmInlineName}
                    className="mt-4 w-full max-w-[280px] rounded-2xl bg-[#131b2e]/90 border border-sky-400/25 p-3 shadow-lg"
                  >
                    <p className="text-xs font-semibold text-sky-200 mb-2">
                      Qual é o seu nome?
                    </p>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={nameDraft}
                        onChange={(e) => setNameDraft(e.target.value)}
                        placeholder="Digita seu nome..."
                        maxLength={32}
                        className="flex-1 min-w-0 h-9 rounded-xl bg-[#090d16] border border-white/10 px-3 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-sky-400"
                      />
                      <button
                        type="submit"
                        disabled={!nameDraft.trim()}
                        className="h-9 px-3 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:opacity-40 text-slate-950 text-xs font-bold shrink-0 cursor-pointer transition-colors"
                      >
                        Salvar
                      </button>
                    </div>
                  </form>
                ) : (
                  <p className="mt-1.5 text-xs text-slate-400">
                    {preferences.audienceMode === 'crianca'
                      ? 'Pode perguntar, brincar ou aprender comigo!'
                      : preferences.audienceMode === 'idoso'
                        ? 'Estou aqui com muita calma e letra grande para te ajudar.'
                        : 'Manda texto, voz ou mostra sua tela aí embaixo.'}
                  </p>
                )}

                {/* Quick Age Adaptation Switcher (Criancinhas · Adultos · Idosos) */}
                <div className="mt-4 flex items-center justify-center gap-1.5 w-full max-w-[280px]">
                  {(
                    [
                      { id: 'crianca', label: '🧒 Criança' },
                      { id: 'adulto', label: '🧑 Adulto' },
                      { id: 'idoso', label: '👴 Idoso' },
                    ] as const
                  ).map((modeBtn) => {
                    const isActive = preferences.audienceMode === modeBtn.id;
                    return (
                      <button
                        key={modeBtn.id}
                        type="button"
                        onClick={() => {
                          const nextMode = isActive ? 'auto' : modeBtn.id;
                          setPreferences((prev) => ({
                            ...prev,
                            audienceMode: nextMode,
                            ...(nextMode === 'idoso'
                              ? { largeText: true, voiceRate: Math.min(prev.voiceRate, 0.92) }
                              : nextMode === 'crianca'
                                ? { largeText: false, voiceRate: 0.96 }
                                : { largeText: false }),
                          }));
                        }}
                        className={`flex-1 min-h-[36px] px-2 rounded-xl text-[11px] font-semibold transition-colors cursor-pointer border ${
                          isActive
                            ? 'bg-emerald-500/20 border-emerald-400/55 text-emerald-200'
                            : 'bg-[#131b2e]/80 border-white/10 text-slate-400 hover:text-white'
                        }`}
                        title="Adaptar jeito de conversar e leitura"
                      >
                        {modeBtn.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <>
                {messages.map((msg) => (
                  <ChatMessageBubble
                    key={msg.id}
                    message={msg}
                    avatarSrc={ZIA_AVATAR_URL}
                    onSpeak={(text) => speakZia(text, true)}
                    onEditUserMessage={(id, nextText) => void handleEditUserMessage(id, nextText)}
                    disabledEdit={isTyping}
                    isSpeaking={isSpeaking && !streamingBubble && msg.id === latestAssistantId}
                    largeText={Boolean(preferences.largeText || preferences.audienceMode === 'idoso')}
                  />
                ))}

                {streamingBubble && (
                  <ChatMessageBubble
                    key={streamingBubble.id}
                    message={streamingBubble}
                    avatarSrc={ZIA_AVATAR_URL}
                    onSpeak={(text) => speakZia(text, true)}
                    isSpeaking={isSpeaking}
                    largeText={Boolean(preferences.largeText || preferences.audienceMode === 'idoso')}
                  />
                )}

                {isTyping && !streamingBubble && (
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-full overflow-hidden border border-sky-400/40 bg-[#131b2e] flex items-center justify-center shrink-0">
                      <Sparkles className="w-4 h-4 text-sky-300 animate-pulse" />
                    </div>
                    <div className="rounded-2xl rounded-bl-md bg-[#131b2e] border border-sky-400/20 px-4 py-2.5 text-xs font-medium text-sky-200">
                      Zia está digitando... ✨
                    </div>
                  </div>
                )}

                {videoStatus && (
                  <div className="rounded-2xl bg-[#131b2e] border border-purple-400/30 px-4 py-3 text-xs font-medium text-purple-200 flex items-center gap-2.5">
                    <Sparkles className="w-4 h-4 text-purple-300 animate-spin" />
                    <span>{videoStatus}</span>
                  </div>
                )}
              </>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* Pending Media Attachment Previews */}
          {pendingImage && (
            <div className="mx-3.5 mb-2 rounded-2xl bg-[#131b2e] border border-sky-400/30 p-2.5 flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <img
                  src={pendingImage}
                  alt="Prévia da foto selecionada"
                  className="w-12 h-12 rounded-xl object-cover border border-white/10 shrink-0"
                />
                <span className="text-xs text-slate-200 truncate">
                  Foto pronta para a Zia analisar! ✨
                </span>
              </div>
              <button
                type="button"
                onClick={() => setPendingImage(null)}
                className="min-h-[40px] min-w-[40px] rounded-xl text-slate-400 hover:text-white flex items-center justify-center cursor-pointer"
                aria-label="Remover foto"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {pendingVideo && (
            <div className="mx-3.5 mb-2 rounded-2xl bg-[#131b2e] border border-purple-400/35 p-2.5 flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <video
                  src={pendingVideo.previewUrl}
                  muted
                  playsInline
                  className="w-14 h-12 rounded-xl object-cover border border-white/10 bg-black shrink-0"
                />
                <span className="text-xs text-purple-200 truncate">
                  Vídeo pronto para a Zia assistir! 🎬
                </span>
              </div>
              <button
                type="button"
                onClick={() => setPendingVideo(null)}
                className="min-h-[40px] min-w-[40px] rounded-xl text-slate-400 hover:text-white flex items-center justify-center cursor-pointer"
                aria-label="Remover vídeo"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Contextual Dynamic AI Suggestions above composer */}
          <ActionSuggestions
            messages={messages}
            audienceMode={preferences.audienceMode ?? 'auto'}
            isScreenSharing={isScreenSharing}
            dynamicSuggestions={dynamicSuggestions}
            isUpdatingSuggestions={isUpdatingSuggestions}
            largeText={Boolean(preferences.largeText || preferences.audienceMode === 'idoso')}
            disabled={isTyping}
            onSelectSuggestion={(prompt) => void sendMessageToZia(prompt)}
          />

          {/* Bottom Composer Bar */}
          <form
            onSubmit={handleSubmitForm}
            className="shrink-0 w-full bg-[#0d1322]/95 border-t border-white/10 px-2 py-2 flex items-center gap-1.5 overflow-hidden"
          >
            <button
              type="button"
              onClick={() => {
                setCameraMode('photo');
                setIsCameraOpen(true);
              }}
              className="w-8 h-9 sm:w-9 sm:h-10 rounded-xl bg-[#131b2e] hover:bg-[#19233b] border border-sky-400/25 text-sky-300 flex items-center justify-center shrink-0 cursor-pointer transition-colors"
              aria-label="Tirar foto com a câmera"
              title="Tirar foto com a câmera"
            >
              <Camera className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => {
                setCameraMode('video');
                setIsCameraOpen(true);
              }}
              className="w-8 h-9 sm:w-9 sm:h-10 rounded-xl bg-[#131b2e] hover:bg-[#19233b] border border-purple-400/30 text-purple-300 flex items-center justify-center shrink-0 cursor-pointer transition-colors"
              aria-label="Gravar vídeo para a Zia assistir"
              title="Gravar vídeo para a Zia assistir"
            >
              <Video className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => photoInputRef.current?.click()}
              className="w-8 h-9 sm:w-9 sm:h-10 rounded-xl bg-[#131b2e] hover:bg-[#19233b] border border-white/10 text-slate-200 flex items-center justify-center shrink-0 cursor-pointer transition-colors"
              aria-label="Escolher foto ou vídeo da galeria"
              title="Escolher foto ou vídeo da galeria"
            >
              <ImagePlus className="w-4 h-4" />
            </button>

            <input
              type="text"
              value={inputText}
              onChange={(e) => {
                setInputText(e.target.value);
                lastActivityRef.current = Date.now();
              }}
              placeholder={
                isListening
                  ? 'Ouvindo você... 🎤'
                  : 'Converse com a Zia...'
              }
              className={`flex-1 min-w-0 h-9 sm:h-10 rounded-xl bg-[#131b2e] border border-white/10 px-2.5 text-white placeholder:text-slate-400 focus:outline-none focus:border-sky-400/60 ${
                preferences.largeText || preferences.audienceMode === 'idoso' ? 'text-base' : 'text-sm'
              }`}
            />

            {/* Compact Glowing Microphone Button */}
            <button
              type="button"
              onClick={handleStartSpeechRecognition}
              className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center shrink-0 cursor-pointer transition-all ${
                isListening
                  ? 'bg-rose-500 text-white shadow-md shadow-rose-500/40 animate-pulse'
                  : 'bg-gradient-to-br from-sky-400 to-purple-500 text-slate-950 shadow-md shadow-sky-500/30 hover:brightness-110'
              }`}
              aria-label={isListening ? 'Parar gravação' : 'Falar com a Zia no microfone'}
              title="Falar com a Zia AI em português"
            >
              {isListening ? (
                <MicOff className="w-4 h-4" />
              ) : (
                <Mic className="w-4 h-4" />
              )}
            </button>

            <button
              type="submit"
              disabled={isTyping || (!inputText.trim() && !pendingImage && !pendingVideo)}
              className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:opacity-40 disabled:hover:bg-sky-500 text-slate-950 flex items-center justify-center shrink-0 cursor-pointer transition-colors"
              aria-label="Enviar mensagem"
              title="Enviar mensagem"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </section>

        {/* CENTRAL GAMER TAB */}
        <aside
          className={`h-full min-h-0 ${
            activeTab === 'gamer' ? 'block' : 'hidden'
          }`}
        >
          <GamerCenter
            onAskZia={(prompt) => void sendMessageToZia(prompt)}
            onStartVoice={() => {
              handleStartSpeechRecognition();
            }}
            onAddMemory={addMemory}
          />
        </aside>
      </main>

      {/* Mobile Bottom Thumb-Zone Navigation */}
      <nav className="shrink-0 bg-[#090d16]/95 backdrop-blur-md border-t border-white/10 pb-safe">
        <div className="grid grid-cols-2 h-13">
          <button
            type="button"
            onClick={() => setActiveTab('chat')}
            className={`relative flex items-center justify-center gap-2 text-xs font-semibold transition-colors cursor-pointer ${
              activeTab === 'chat' ? 'text-sky-300' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            <span>Chat Zia</span>
            {activeTab !== 'chat' && (isTyping || isSpeaking) && (
              <span className="w-2 h-2 rounded-full bg-sky-400 animate-pulse" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('gamer')}
            className={`flex items-center justify-center gap-2 text-xs font-semibold transition-colors cursor-pointer ${
              activeTab === 'gamer' ? 'text-purple-300' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Gamepad2 className="w-4 h-4" />
            <span>Central Gamer</span>
          </button>
        </div>
      </nav>

      {/* Memory & Voice Settings Drawer/Modal */}
      <MemoryModal
        isOpen={isMemoryOpen}
        onClose={() => setIsMemoryOpen(false)}
        memories={memories}
        onAddMemory={addMemory}
        onRemoveMemory={removeMemory}
        onClearAll={clearAllMemory}
        userName={userName}
        onUpdateUserName={persistUserName}
        preferences={preferences}
        onUpdatePreferences={(patch) =>
          setPreferences((prev) => ({ ...prev, ...patch }))
        }
        messageCount={messages.length}
        isPiPSupported={pip.isSupported || videoPiP.isSupported}
        isPiPOpen={pip.isOpen || videoPiP.isOpen}
        onTogglePiP={handleToggleFloatingWindow}
      />

      {/* Live Camera Photo & Video Modal */}
      <CameraModal
        isOpen={isCameraOpen}
        initialMode={cameraMode}
        onClose={() => setIsCameraOpen(false)}
        onAttachPhoto={(dataUrl) => setPendingImage(dataUrl)}
        onSendPhotoNow={(dataUrl) =>
          void sendMessageToZia(
            inputText.trim() ||
              'Zia, olha essa foto que eu acabei de tirar na câmera! O que você vê?',
            dataUrl
          )
        }
        onAttachVideo={(vid) => setPendingVideo(vid)}
        onSendVideoNow={(vid) =>
          void sendMessageToZia(
            inputText.trim() ||
              'Zia, assiste esse vídeo que eu gravei agora e me diz o que você acha!',
            null,
            vid
          )
        }
        onOpenGallery={() => photoInputRef.current?.click()}
      />

      {/* In-App Draggable ChatGPT-Style Voice Orb (continuous voice communication) */}
      {isVoiceOrbMode && !pip.isOpen && !videoPiP.isOpen && (
        <div
          style={{ left: orbPos.x, top: orbPos.y }}
          onPointerDown={(e) => {
            orbDragRef.current = {
              active: true,
              moved: false,
              startX: e.clientX,
              startY: e.clientY,
              origX: orbPos.x,
              origY: orbPos.y,
            };
          }}
          onPointerMove={(e) => {
            if (!orbDragRef.current.active) return;
            const dx = e.clientX - orbDragRef.current.startX;
            const dy = e.clientY - orbDragRef.current.startY;
            if (Math.abs(dx) > 6 || Math.abs(dy) > 6) orbDragRef.current.moved = true;
            setOrbPos({
              x: Math.max(8, Math.min(window.innerWidth - 88, orbDragRef.current.origX + dx)),
              y: Math.max(60, Math.min(window.innerHeight - 140, orbDragRef.current.origY + dy)),
            });
          }}
          onPointerUp={() => {
            const wasMoved = orbDragRef.current.moved;
            orbDragRef.current.active = false;
            if (!wasMoved) {
              handleStartSpeechRecognition();
            }
          }}
          className="fixed z-50 touch-none select-none flex flex-col items-center gap-1.5"
        >
          <div className="relative flex items-center justify-center">
            {(isListening || isSpeaking) && (
              <span
                className={`absolute -inset-2 rounded-full blur-sm opacity-60 animate-ping ${
                  isListening ? 'bg-rose-400' : 'bg-sky-400'
                }`}
              />
            )}
            <div
              className={`relative w-[68px] h-[68px] rounded-full flex flex-col items-center justify-center shadow-2xl cursor-pointer transition-transform ${
                isListening
                  ? 'bg-gradient-to-br from-rose-500 to-purple-600 ring-4 ring-rose-400/55 scale-105'
                  : isSpeaking
                    ? 'bg-gradient-to-br from-sky-400 via-cyan-400 to-indigo-500 ring-4 ring-sky-300/65 scale-105'
                    : isTyping
                      ? 'bg-gradient-to-br from-purple-500 to-indigo-600 ring-4 ring-purple-400/50 animate-pulse'
                      : 'bg-gradient-to-br from-sky-500 to-purple-600 ring-4 ring-purple-400/40'
              }`}
              title={isSpeaking ? 'Toque para interromper e falar' : 'Conversa contínua por voz'}
            >
              {isSpeaking ? (
                <Volume2 className="w-6 h-6 text-slate-950 animate-bounce" />
              ) : isTyping ? (
                <Sparkles className="w-6 h-6 text-white animate-spin" />
              ) : (
                <Mic className="w-6 h-6 text-white" />
              )}
              <span className="text-[9px] font-bold text-white leading-none mt-0.5 tracking-wide">
                {isListening ? 'OUVINDO' : isSpeaking ? 'FALANDO' : isTyping ? 'RÁPIDO' : 'VOZ ON'}
              </span>
            </div>
          </div>

          {isListening && inputText.trim() && (
            <div className="max-w-[160px] px-2 py-1 rounded-xl bg-[#090d16]/95 border border-sky-400/35 text-[10px] text-sky-100 text-center line-clamp-2 shadow-lg">
              {inputText}
            </div>
          )}

          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              void handleToggleVoiceOrbMode();
            }}
            className="px-2.5 py-0.5 rounded-full bg-slate-900/95 border border-white/15 text-[10px] font-semibold text-slate-200 hover:text-white cursor-pointer shadow"
          >
            Sair Orb
          </button>
        </div>
      )}

      {/* Real OS-Level Document Picture-in-Picture Floating Window */}
      {pip.isOpen &&
        pip.pipContainer &&
        createPortal(
          <FloatingPiPContent
            messages={messages}
            streamingBubble={streamingBubble}
            isTyping={isTyping}
            isSpeaking={isSpeaking}
            isListening={isListening}
            isVoiceOrbMode={isVoiceOrbMode}
            isScreenSharing={isScreenSharing}
            hasScreenAudio={hasScreenAudio}
            onSendMessage={(text) => void sendMessageToZia(text)}
            onToggleMic={handleStartSpeechRecognition}
            onToggleVoiceOrb={() => void handleToggleVoiceOrbMode()}
            onResize={pip.resizePiP}
            onClose={pip.closePiP}
          />,
          pip.pipContainer
        )}
      </div>
    </div>
  );
}
