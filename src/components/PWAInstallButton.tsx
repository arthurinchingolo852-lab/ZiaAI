import React, { useState } from 'react';
import { CheckCircle2, Download, Globe, RefreshCw, Smartphone, Sparkles, WifiOff, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

const ZIA_FEATURES_SUMMARY = [
  '📱 Ícone e nome próprios na tela inicial — abre sozinho em tela cheia, fora do Chrome',
  '🎙️ Voz neural feminina em português (pt-BR) + Bola de Voz Flutuante',
  '📺 Visão de tela ao vivo (1s) + áudio do jogo em tempo real',
  '✨ Modo Companhia a cada 25s + Memória Infinita salva no aparelho',
  '🎮 Central Gamer para qualquer jogo (Minecraft, PvZ, Roblox, Brawl e mais)',
];

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, swActive, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  const isInIframe =
    typeof window !== 'undefined' &&
    (() => {
      try {
        return window.self !== window.top;
      } catch {
        return true;
      }
    })();

  const appOriginUrl = typeof window !== 'undefined' ? window.location.origin : '/';

  const handleInstallClick = async () => {
    if (isInstallable) {
      const ok = await install();
      if (ok) {
        setShowGuide(false);
        return;
      }
    }
    setShowGuide(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void handleInstallClick()}
        className={`min-h-[44px] px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all whitespace-nowrap shrink-0 cursor-pointer ${
          isInstallable
            ? 'bg-gradient-to-r from-sky-400 to-purple-500 text-slate-950 shadow-md shadow-sky-500/30 hover:brightness-110'
            : 'bg-gradient-to-r from-sky-500/20 to-purple-500/20 border border-sky-400/45 text-sky-200 hover:brightness-125'
        }`}
        title="Instalar Zia AI como aplicativo PWA na tela inicial"
      >
        {isIOS ? (
          <Smartphone className="w-4 h-4 shrink-0" />
        ) : (
          <Download className="w-4 h-4 shrink-0" />
        )}
        <span>Instalar App</span>
      </button>

      {showGuide && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Instalar Zia AI como Aplicativo PWA"
        >
          <div className="w-full max-w-md max-h-[88dvh] overflow-y-auto zia-scroll rounded-3xl bg-[#131b2e] border border-sky-400/30 p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <img
                  src="/pwa-192x192.png"
                  alt="Logo Zia AI"
                  className="w-11 h-11 rounded-2xl shrink-0"
                />
                <div>
                  <h3 className="text-base font-bold text-white">Instalar Zia AI (App PWA)</h3>
                  <p className="text-[11px] text-slate-400">
                    Cria o app na tela inicial com nome e ícone próprios, sem abrir dentro do Chrome
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-400 hover:text-white hover:bg-white/5 cursor-pointer"
                aria-label="Fechar"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {isInstallable && !isInIframe && (
              <button
                type="button"
                onClick={() => void handleInstallClick()}
                className="w-full min-h-[50px] rounded-2xl bg-gradient-to-r from-sky-400 to-purple-500 text-slate-950 font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-sky-500/25 hover:brightness-110 cursor-pointer"
              >
                <Download className="w-5 h-5" />
                <span>Instalar Aplicativo Agora</span>
              </button>
            )}

            {isInIframe ? (
              <div className="rounded-2xl bg-sky-500/10 border border-sky-400/30 p-3.5 space-y-2.5 text-xs text-sky-100">
                <p className="leading-relaxed">
                  Você está dentro da prévia embutida. Para o Android exibir o botão oficial{' '}
                  <strong>Instalar aplicativo</strong>, abra fora da prévia no Chrome:
                </p>
                <a
                  href={appOriginUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full min-h-[44px] px-4 rounded-xl bg-gradient-to-r from-sky-400 to-purple-500 text-slate-950 font-bold text-xs inline-flex items-center justify-center gap-2 hover:brightness-110"
                >
                  <Globe className="w-4 h-4" />
                  <span>Abrir no Chrome para Instalar App</span>
                </a>
              </div>
            ) : isIOS ? (
              <div className="rounded-2xl bg-[#090d16]/80 border border-white/10 p-3.5 space-y-1.5 text-xs text-slate-300">
                <p className="font-semibold text-white">📱 No iPhone / iPad (Safari):</p>
                <ol className="space-y-1 leading-relaxed list-decimal list-inside">
                  <li>
                    Toque em <strong>Compartilhar</strong> (quadrado com seta para cima).
                  </li>
                  <li>
                    Escolha <strong>Adicionar à Tela de Início</strong>.
                  </li>
                  <li>
                    Toque em <strong>Adicionar</strong> — a Zia AI abre sozinha como aplicativo!
                  </li>
                </ol>
              </div>
            ) : (
              <div className="rounded-2xl bg-[#090d16]/80 border border-white/10 p-3.5 space-y-2.5 text-xs text-slate-300">
                <div className="flex items-center gap-2 text-[11px]">
                  <CheckCircle2
                    className={`w-4 h-4 shrink-0 ${swActive ? 'text-emerald-400' : 'text-amber-300 animate-pulse'}`}
                  />
                  <span className={swActive ? 'text-emerald-300 font-medium' : 'text-amber-200'}>
                    {swActive
                      ? 'Service Worker e manifest.json prontos para instalação PWA.'
                      : 'Ativando Service Worker PWA...'}
                  </span>
                </div>
                <p className="font-semibold text-white">📱 Como instalar como App real no Android (Chrome):</p>
                <ol className="space-y-1.5 leading-relaxed list-decimal list-inside">
                  <li>
                    Toque nos <strong>3 pontinhos (⋮)</strong> no canto superior direito do Chrome.
                  </li>
                  <li>
                    Toque em <strong className="text-sky-300">Instalar aplicativo</strong> (ou{' '}
                    <strong>Adicionar à tela inicial → Instalar</strong>).
                  </li>
                  <li>
                    O ícone da <strong>Zia AI</strong> aparece na tela inicial e abre em tela cheia fora do Chrome!
                  </li>
                </ol>
                {!isInstallable && (
                  <button
                    type="button"
                    onClick={() => window.location.reload()}
                    className="w-full min-h-[40px] rounded-xl bg-white/10 hover:bg-white/15 text-slate-100 font-semibold text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Recarregar para liberar botão de 1 toque</span>
                  </button>
                )}
              </div>
            )}

            <div className="rounded-2xl bg-[#090d16]/80 border border-purple-400/20 p-3.5 space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-purple-300">
                <Sparkles className="w-3.5 h-3.5" />
                <span>O que vem no App Zia AI:</span>
              </div>
              <ul className="space-y-1 text-[11px] text-slate-300 leading-relaxed">
                {ZIA_FEATURES_SUMMARY.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>

            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="w-full min-h-[44px] rounded-xl bg-sky-500 text-slate-950 font-semibold text-sm hover:bg-sky-400 transition-colors cursor-pointer"
            >
              Fechar
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export const PWAInstallBanner: React.FC = () => {
  const { isInstallable, isInstalled, install } = usePWAInstall();
  const [dismissed, setDismissed] = useState(false);

  if (isInstalled || !isInstallable || dismissed) {
    return null;
  }

  return (
    <div className="mx-3 mt-2 rounded-2xl bg-gradient-to-r from-[#131b2e] to-[#1a1438] border border-sky-400/40 px-3.5 py-2.5 flex items-center justify-between gap-2.5 shadow-lg shrink-0">
      <div className="flex items-center gap-2.5 min-w-0">
        <img
          src="/pwa-192x192.png"
          alt="Zia AI"
          className="w-9 h-9 rounded-xl shrink-0"
        />
        <div className="min-w-0">
          <p className="text-xs font-bold text-white truncate">Instalar aplicativo Zia AI</p>
          <p className="text-[11px] text-sky-200/80 truncate">
            Ícone na tela inicial • Abre fora do Chrome
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={() => void install()}
          className="min-h-[38px] px-3.5 rounded-xl bg-gradient-to-r from-sky-400 to-purple-500 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow-md shadow-sky-500/25 hover:brightness-110 cursor-pointer"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Instalar</span>
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="min-h-[38px] min-w-[34px] rounded-xl text-slate-400 hover:text-white flex items-center justify-center cursor-pointer"
          aria-label="Dispensar banner"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div className="mx-3 mt-2 rounded-xl bg-amber-500/15 border border-amber-400/35 px-3.5 py-2 text-xs font-medium text-amber-200 flex items-center gap-2">
      <WifiOff className="w-4 h-4 shrink-0 text-amber-300" />
      <span>Sem internet no momento — histórico e comandos offline da Zia AI disponíveis.</span>
    </div>
  );
};
