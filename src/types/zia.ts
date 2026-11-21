export type ActiveTab = 'chat' | 'gamer' | 'memory';

export interface VideoScene {
  promptEn: string;
  captionPt: string;
  narrationPt: string;
  imageUrl?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
  imagePreview?: string;
  userVideoUrl?: string;
  userVideoMimeType?: string;
  screenAttached?: boolean;
  generatedImageUrl?: string;
  generatedImageDirectUrl?: string;
  generatedImagePrompt?: string;
  videoTitle?: string;
  videoScenes?: VideoScene[];
  videoBlobUrl?: string;
  videoMimeType?: string;
  isProactive?: boolean;
}

export interface MemoryItem {
  id: string;
  text: string;
  category: 'preferencia' | 'coordenada' | 'jogo' | 'geral';
  createdAt: number;
}

export type AudienceMode = 'auto' | 'crianca' | 'adulto' | 'idoso';

export interface ZiaPreferences {
  voiceEnabled: boolean;
  companionMode: boolean;
  voiceRate: number;
  audienceMode?: AudienceMode;
  largeText?: boolean;
}
