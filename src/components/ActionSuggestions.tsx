import React, { useMemo } from 'react';
import { Sparkles } from 'lucide-react';
import type { AudienceMode, ChatMessage } from '../types/zia';

interface ActionSuggestionsProps {
  messages: ChatMessage[];
  audienceMode?: AudienceMode;
  isScreenSharing: boolean;
  dynamicSuggestions?: string[];
  isUpdatingSuggestions?: boolean;
  largeText?: boolean;
  disabled?: boolean;
  onSelectSuggestion: (prompt: string) => void;
}

export const ActionSuggestions: React.FC<ActionSuggestionsProps> = React.memo(({
  messages,
  audienceMode = 'auto',
  isScreenSharing,
  dynamicSuggestions,
  isUpdatingSuggestions = false,
  largeText = false,
  disabled = false,
  onSelectSuggestion,
}) => {
  const fallbackSuggestions = useMemo<string[]>(() => {
    if (isScreenSharing) {
      return [
        'O que você vê na tela agora?',
        'Me dê uma dica rápida pra tela',
        'Crie uma imagem épica disso',
        'Crie um desafio gamer',
      ];
    }

    const recentText = messages
      .slice(-4)
      .map((m) => m.text.toLowerCase())
      .join(' ');

    if (recentText.includes('minecraft') || recentText.includes('creeper') || recentText.includes('nether')) {
      return [
        'Como achar diamante rápido?',
        'Crie uma imagem do meu personagem',
        'Me dê uma dica do Minecraft',
        'Crie um desafio no Minecraft',
      ];
    }

    if (recentText.includes('pvz') || recentText.includes('zumbi') || recentText.includes('planta')) {
      return [
        'Melhor defesa no PvZ agora',
        'Gere uma arte épica de plantas vs zumbis',
        'Crie um desafio gamer no PvZ',
        'Explique algo novo',
      ];
    }

    if (recentText.includes('brawl') || recentText.includes('roblox') || recentText.includes('jogo') || recentText.includes('fase')) {
      return [
        'Qual a melhor estratégia pra vencer?',
        'Crie uma imagem gamer épica',
        'Crie um desafio gamer',
        'Faça um vídeo curto de dicas',
      ];
    }

    if (recentText.includes('vídeo') || recentText.includes('video') || recentText.includes('imagem') || recentText.includes('foto')) {
      return [
        'Gere uma imagem épica pra mim',
        'Crie um vídeo animado curto',
        'Explique algo novo',
        'Crie um desafio gamer',
      ];
    }

    if (audienceMode === 'crianca') {
      return [
        'Conte uma historinha curta legal',
        'Gere uma imagem mágica pra mim',
        'Crie um desafio divertido',
        'Explique uma curiosidade incrível',
      ];
    }

    if (audienceMode === 'idoso') {
      return [
        'Dica fácil para usar o celular',
        'Gere uma imagem bonita de paisagem',
        'Explique algo novo bem simples',
        'Receita ou dica boa pra hoje',
      ];
    }

    return [
      'Gere uma imagem épica pra mim',
      'Me dê uma dica do Minecraft',
      'Crie um vídeo animado curto',
      'Explique algo novo',
    ];
  }, [audienceMode, isScreenSharing, messages]);

  const suggestions = useMemo(() => {
    if (dynamicSuggestions && dynamicSuggestions.length >= 3) {
      return dynamicSuggestions.slice(0, 4);
    }
    return fallbackSuggestions;
  }, [dynamicSuggestions, fallbackSuggestions]);

  return (
    <div
      className="shrink-0 w-full px-2.5 py-1.5 bg-[#090d16]/90 border-t border-white/5 flex items-center gap-1.5 overflow-x-auto zia-scroll"
      aria-label="Sugestões de ação rápidas"
    >
      <Sparkles
        className={`w-3.5 h-3.5 text-sky-400 shrink-0 ml-0.5 ${
          isUpdatingSuggestions ? 'animate-spin' : ''
        }`}
      />
      <div className="flex items-center gap-1.5 shrink-0">
        {suggestions.map((label) => (
          <button
            key={label}
            type="button"
            disabled={disabled}
            onClick={() => onSelectSuggestion(label)}
            className={`rounded-xl bg-[#131b2e] hover:bg-sky-500/20 border border-sky-400/25 hover:border-sky-400/50 text-slate-200 hover:text-white font-medium whitespace-nowrap transition-colors cursor-pointer disabled:opacity-45 ${
              largeText ? 'min-h-[38px] px-3 text-[13px]' : 'min-h-[30px] px-2.5 text-[11px]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
});
