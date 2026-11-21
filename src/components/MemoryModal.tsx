import React, { useState } from 'react';
import { Brain, Check, Copy, Globe, PictureInPicture2, Plus, Smartphone, Sparkles, Trash2, Users, Volume2, X } from 'lucide-react';
import type { AudienceMode, MemoryItem, ZiaPreferences } from '../types/zia';

interface MemoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  userName: string;
  onUpdateUserName: (name: string) => void;
  memories: MemoryItem[];
  onAddMemory: (text: string, category: MemoryItem['category']) => void;
  onRemoveMemory: (id: string) => void;
  onClearAll: () => void;
  preferences: ZiaPreferences;
  onUpdatePreferences: (patch: Partial<ZiaPreferences>) => void;
  messageCount: number;
  isPiPSupported: boolean;
  isPiPOpen: boolean;
  onTogglePiP: () => Promise<boolean>;
}

export const MemoryModal: React.FC<MemoryModalProps> = ({
  isOpen,
  onClose,
  userName,
  onUpdateUserName,
  memories,
  onAddMemory,
  onRemoveMemory,
  onClearAll,
  preferences,
  onUpdatePreferences,
  messageCount,
  isPiPSupported,
  isPiPOpen,
  onTogglePiP,
}) => {
  const [newNote, setNewNote] = useState('');
  const [category, setCategory] = useState<MemoryItem['category']>('geral');
  const [confirmClear, setConfirmClear] = useState(false);
  const [showAndroidGuide, setShowAndroidGuide] = useState(false);
  const [pipBlockedNotice, setPipBlockedNotice] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  if (!isOpen) return null;

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNote.trim()) return;
    onAddMemory(newNote.trim(), category);
    setNewNote('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm sm:p-4">
      <div className="w-full sm:max-w-lg max-h-[88dvh] flex flex-col rounded-t-3xl sm:rounded-3xl bg-[#131b2e] border border-sky-400/20 shadow-2xl overflow-hidden">
        <div className="sm:hidden w-10 h-1.5 bg-slate-600 rounded-full mx-auto mt-3 mb-1" />

        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-sky-500/15 border border-sky-400/30 flex items-center justify-center text-sky-300">
              <Brain className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">Memória Infinita & Ajustes</h2>
              <p className="text-xs text-slate-400 tabular-nums">
                {memories.length} lembranças · {messageCount} mensagens salvas
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-400 hover:text-white hover:bg-white/5 cursor-pointer"
            aria-label="Fechar configurações"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto zia-scroll p-5 space-y-6">
          {/* Floating Window (Document Picture-in-Picture / Native Android Companion) */}
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-purple-300">
              <PictureInPicture2 className="w-4 h-4" />
              <span>Modo Janela Flutuante (Sobre Outros Apps)</span>
            </div>
            <div className="rounded-2xl bg-[#090d16]/75 border border-purple-400/25 p-4 space-y-3">
              <p className="text-xs text-slate-300 leading-relaxed">
                {isPiPSupported
                  ? 'Abre uma janela flutuante real (Picture-in-Picture) sempre no topo sobre jogos e outros aplicativos.'
                  : 'Este navegador não liberou Picture-in-Picture aqui. Abra em uma aba normal ou use o app Android complementar com SYSTEM_ALERT_WINDOW.'}
              </p>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    void onTogglePiP().then((ok) => {
                      if (ok) {
                        setPipBlockedNotice(false);
                        onClose();
                      } else {
                        setPipBlockedNotice(true);
                        setShowAndroidGuide(true);
                      }
                    });
                  }}
                  className={`min-h-[44px] flex-1 px-4 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer ${
                    isPiPOpen
                      ? 'bg-rose-500/20 border border-rose-400/40 text-rose-200 hover:bg-rose-500/30'
                      : 'bg-gradient-to-r from-sky-500 to-purple-500 text-white hover:brightness-110'
                  }`}
                >
                  <PictureInPicture2 className="w-4 h-4 shrink-0" />
                  <span>{isPiPOpen ? 'Fechar Janela Flutuante' : 'Janela Flutuante'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowAndroidGuide((v) => !v)}
                  className="min-h-[44px] px-3.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium text-slate-200 flex items-center gap-1.5 cursor-pointer"
                >
                  <Smartphone className="w-4 h-4 text-sky-300" />
                  <span>Android APK</span>
                </button>
              </div>

              {pipBlockedNotice && (
                <div className="rounded-xl bg-amber-500/10 border border-amber-400/35 p-3 space-y-2 text-xs text-amber-100">
                  <p className="leading-relaxed">
                    A janela flutuante foi bloqueada porque o app está aberto dentro de uma prévia incorporada (iframe) ou navegador restrito. Abra direto em uma aba normal para liberar:
                  </p>
                  <a
                    href={typeof window !== 'undefined' ? window.location.origin : '/'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-h-[38px] px-3.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs inline-flex items-center gap-1.5"
                  >
                    <Globe className="w-3.5 h-3.5" />
                    <span>Abrir em Nova Aba (Liberar Janela)</span>
                  </a>
                </div>
              )}

              {showAndroidGuide && (
                <div className="rounded-xl bg-[#131b2e] border border-sky-400/20 p-3.5 space-y-2.5 text-xs text-slate-300">
                  <p className="font-semibold text-white">App Android Live (WindowManager + Gemini Live)</p>
                  <p className="leading-relaxed text-slate-300">
                    O projeto nativo em Kotlin está pronto em <code className="text-sky-300">android-companion/</code> com conexão WebSocket em tempo real (<code className="text-sky-300">/api/zia/live</code>), bolinha animada sobre jogos, áudio interno + microfone, visão contínua e Modo Copiloto com onda luminosa de toque.
                  </p>
                  <div className="flex items-center justify-between gap-2 rounded-lg bg-[#090d16] border border-white/10 px-3 py-2">
                    <span className="font-mono text-[11px] text-sky-300 truncate">
                      {typeof window !== 'undefined' ? window.location.origin : ''}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        if (typeof window !== 'undefined') {
                          void navigator.clipboard.writeText(window.location.origin);
                          setCopiedUrl(true);
                          setTimeout(() => setCopiedUrl(false), 2000);
                        }
                      }}
                      className="min-h-[34px] px-2.5 rounded-md bg-sky-500/20 text-sky-200 text-[11px] font-semibold flex items-center gap-1 shrink-0 cursor-pointer"
                    >
                      {copiedUrl ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedUrl ? 'Copiado' : 'Copiar URL'}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* User Name & Voice tuning */}
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-sky-300">
              <Volume2 className="w-4 h-4" />
              <span>Seu Nome & Voz da Zia (pt-BR)</span>
            </div>
            <div className="rounded-2xl bg-[#090d16]/70 border border-white/10 p-4 space-y-4">
              <div>
                <label className="block text-xs text-slate-300 mb-1.5" htmlFor="zia-user-name-input">
                  Como a Zia deve te chamar
                </label>
                <input
                  id="zia-user-name-input"
                  type="text"
                  value={userName}
                  onChange={(e) => onUpdateUserName(e.target.value)}
                  placeholder="Digite seu nome..."
                  className="w-full min-h-[40px] rounded-xl bg-[#131b2e] border border-white/10 px-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-sky-400/60"
                />
              </div>
              <div>
                <div className="flex justify-between text-xs text-slate-300 mb-1.5">
                  <span>Velocidade da fala</span>
                  <span className="font-mono tabular-nums text-sky-300">{preferences.voiceRate.toFixed(2)}x</span>
                </div>
                <input
                  type="range"
                  min="0.80"
                  max="1.25"
                  step="0.05"
                  value={preferences.voiceRate}
                  onChange={(e) => onUpdatePreferences({ voiceRate: Number(e.target.value) })}
                  className="w-full accent-sky-400 cursor-pointer"
                />
              </div>
            </div>
          </section>

          {/* Audience Adaptations: Criancinhas, Adultos & Idosos */}
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-emerald-300">
              <Users className="w-4 h-4" />
              <span>Adaptação para Idade (Crianças · Adultos · Idosos)</span>
            </div>
            <div className="rounded-2xl bg-[#090d16]/70 border border-emerald-400/20 p-4 space-y-3.5">
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    { id: 'auto', label: '✨ Automático', desc: 'Adapta sozinha' },
                    { id: 'crianca', label: '🧒 Criancinha', desc: 'Doce e lúdica' },
                    { id: 'adulto', label: '🧑 Adulto', desc: 'Direta e prática' },
                    { id: 'idoso', label: '👴 Idoso', desc: 'Calma + Letra Grande' },
                  ] as const
                ).map((item) => {
                  const active = (preferences.audienceMode ?? 'auto') === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        const mode = item.id as AudienceMode;
                        onUpdatePreferences({
                          audienceMode: mode,
                          ...(mode === 'idoso'
                            ? { largeText: true, voiceRate: Math.min(preferences.voiceRate, 0.92) }
                            : mode === 'crianca'
                              ? { largeText: false, voiceRate: 0.96 }
                              : mode === 'adulto'
                                ? { largeText: false }
                                : {}),
                        });
                      }}
                      className={`min-h-[48px] px-3 py-2 rounded-xl text-left transition-colors cursor-pointer border ${
                        active
                          ? 'bg-emerald-500/20 border-emerald-400/55 text-white'
                          : 'bg-[#131b2e] border-white/10 text-slate-300 hover:text-white'
                      }`}
                    >
                      <div className="text-xs font-semibold leading-tight">{item.label}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5">{item.desc}</div>
                    </button>
                  );
                })}
              </div>

              <label className="flex items-center justify-between gap-3 pt-1 cursor-pointer select-none">
                <div>
                  <div className="text-xs font-semibold text-white">Letra Maior (Leitura Fácil)</div>
                  <div className="text-[11px] text-slate-400">
                    Deixa textos e botões mais fáceis de ler para idosos
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={Boolean(preferences.largeText || preferences.audienceMode === 'idoso')}
                  onChange={(e) => onUpdatePreferences({ largeText: e.target.checked })}
                  className="w-5 h-5 accent-emerald-400 cursor-pointer shrink-0"
                />
              </label>
            </div>
          </section>

          {/* Add memory */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-white">Adicionar lembrança ou coordenada</h3>
            <form onSubmit={handleAdd} className="space-y-2.5">
              <div className="flex gap-2">
                {(['geral', 'preferencia', 'coordenada', 'jogo'] as const).map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategory(cat)}
                    className={`min-h-[36px] px-3 rounded-lg text-xs font-medium capitalize transition-colors cursor-pointer ${
                      category === cat
                        ? 'bg-sky-500 text-slate-950 font-semibold'
                        : 'bg-[#090d16] text-slate-400 hover:text-white border border-white/10'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder="Ex: Base principal em X: 140, Y: 68, Z: -220"
                  className="flex-1 min-h-[44px] rounded-xl bg-[#090d16] border border-white/10 px-3.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-sky-400/60"
                />
                <button
                  type="submit"
                  className="min-h-[44px] min-w-[44px] px-4 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-sm flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>Salvar</span>
                </button>
              </div>
            </form>
          </section>

          {/* Saved memories list */}
          <section className="space-y-2.5">
            <h3 className="text-sm font-semibold text-white">
              {userName.trim() ? `O que a Zia lembra de ${userName.trim()}` : 'O que a Zia lembra de você'}
            </h3>
            {memories.length === 0 ? (
              <div className="rounded-2xl bg-[#090d16]/50 border border-white/5 p-4 text-xs text-slate-400 leading-relaxed">
                Ainda não há anotações fixas. Conforme você conversa comigo sobre seus gostos, mundos de Minecraft e estratégias de PvZ, eu salvo tudo automaticamente aqui! 💙
              </div>
            ) : (
              <div className="space-y-2">
                {memories.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-3 rounded-xl bg-[#090d16]/75 border border-white/10 px-3.5 py-2.5"
                  >
                    <div className="min-w-0">
                      <span className="text-[11px] font-medium text-sky-300 capitalize">{item.category}</span>
                      <p className="text-sm text-slate-200 break-words">{item.text}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onRemoveMemory(item.id)}
                      className="min-h-[40px] min-w-[40px] shrink-0 flex items-center justify-center rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                      aria-label="Remover lembrança"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Full Feature Overview & Google Indexing */}
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-emerald-300">
              <Globe className="w-4 h-4" />
              <span>Zia AI no Google & Tudo que tem no App</span>
            </div>
            <div className="rounded-2xl bg-[#090d16]/75 border border-emerald-400/20 p-4 space-y-3 text-xs text-slate-300">
              <p className="leading-relaxed text-slate-200">
                O site já está configurado com <strong>SEO completo</strong>, meta tags OpenGraph, dados estruturados Schema.org (<code className="text-emerald-300">WebApplication</code>), <code className="text-emerald-300">/sitemap.xml</code> e <code className="text-emerald-300">/robots.txt</code> prontos para aparecer no Google!
              </p>
              <div className="space-y-1.5 pt-1 border-t border-white/10">
                <p className="font-semibold text-sky-300 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Tudo o que a Zia AI faz:</span>
                </p>
                <ul className="space-y-1 text-[11px] text-slate-300 leading-relaxed">
                  <li>• <strong>Voz Neural Humana (pt-BR)</strong> e <strong>Bola de Voz Flutuante</strong> contínua</li>
                  <li>• <strong>Chat em Tempo Real</strong> com personalidade descontraída</li>
                  <li>• <strong>Câmera ao Vivo & Galeria</strong> para tirar e analisar fotos</li>
                  <li>• <strong>Ver Tela + Som ao Vivo</strong> (a cada 1s) para qualquer jogo</li>
                  <li>• <strong>Gerador de Imagens e Vídeos Narrados</strong> grátis com download</li>
                  <li>• <strong>Modo Companhia</strong> (puxa assunto a cada 25s de silêncio)</li>
                  <li>• <strong>Memória Infinita</strong> salva no seu aparelho</li>
                  <li>• <strong>Central Gamer</strong> (Qualquer Jogo, Minecraft Bedrock, WebSocket e PvZ)</li>
                  <li>• <strong>App Android Complementar</strong> (Bola Flutuante, Tela+Som e Cliques Sem Cooldown via Accessibility)</li>
                </ul>
              </div>
            </div>
          </section>

          {/* Discreet Clear Memory Button */}
          <section className="pt-2 border-t border-white/10">
            {!confirmClear ? (
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                className="min-h-[44px] w-full rounded-xl border border-rose-500/25 bg-rose-500/5 hover:bg-rose-500/15 text-rose-300 text-xs font-medium flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
                <span>Limpar memória e histórico local</span>
              </button>
            ) : (
              <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 space-y-2.5">
                <p className="text-xs text-rose-200 text-center">
                  {userName.trim() ? `Tem certeza, ${userName.trim()}?` : 'Tem certeza?'} Isso apaga todas as conversas e lembranças salvas neste aparelho.
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmClear(false)}
                    className="flex-1 min-h-[44px] rounded-lg bg-white/10 text-slate-200 text-xs font-medium hover:bg-white/15 cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onClearAll();
                      setConfirmClear(false);
                      onClose();
                    }}
                    className="flex-1 min-h-[44px] rounded-lg bg-rose-500 text-white text-xs font-semibold hover:bg-rose-400 cursor-pointer"
                  >
                    Confirmar limpeza
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};
