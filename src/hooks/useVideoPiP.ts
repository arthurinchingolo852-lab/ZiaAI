import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../types/zia';

interface UseVideoPiPParams {
  userName?: string;
  messages: ChatMessage[];
  streamingBubble: ChatMessage | null;
  isTyping: boolean;
  isSpeaking: boolean;
  isListening: boolean;
  isVoiceOrbMode: boolean;
  isScreenSharing: boolean;
  hasScreenAudio: boolean;
  onToggleMic: () => void;
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width <= maxWidth) {
      current = test;
    } else {
      if (current) lines.push(current);
      current = word;
      if (lines.length >= maxLines) break;
    }
  }
  if (current && lines.length < maxLines) {
    lines.push(current);
  }
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, Math.max(0, lines[maxLines - 1].length - 3))}...`;
  }
  return lines;
}

export function useVideoPiP({
  userName = '',
  messages,
  streamingBubble,
  isTyping,
  isSpeaking,
  isListening,
  isVoiceOrbMode,
  isScreenSharing,
  hasScreenAudio,
  onToggleMic,
}: UseVideoPiPParams) {
  const [isOpen, setIsOpen] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pulseTickRef = useRef(0);
  const stateRef = useRef({
    userName,
    messages,
    streamingBubble,
    isTyping,
    isSpeaking,
    isListening,
    isVoiceOrbMode,
    isScreenSharing,
    hasScreenAudio,
    onToggleMic,
  });
  stateRef.current = {
    userName,
    messages,
    streamingBubble,
    isTyping,
    isSpeaking,
    isListening,
    isVoiceOrbMode,
    isScreenSharing,
    hasScreenAudio,
    onToggleMic,
  };

  const isSupported =
    typeof document !== 'undefined' &&
    'pictureInPictureEnabled' in document &&
    document.pictureInPictureEnabled !== false;

  const drawHudFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    pulseTickRef.current += 1;
    const pulse = (Math.sin(pulseTickRef.current * 0.45) + 1) / 2;

    const {
      messages: msgs,
      streamingBubble: streamMsg,
      isTyping: typing,
      isSpeaking: speaking,
      isListening: listening,
      isVoiceOrbMode: orbMode,
      isScreenSharing: screenOn,
      hasScreenAudio: soundOn,
    } = stateRef.current;

    const w = canvas.width;
    const h = canvas.height;

    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, '#070b14');
    grad.addColorStop(1, '#111a30');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    if (orbMode) {
      const cx = w / 2;
      const cy = 148;
      const baseR = 66;
      const animR = baseR + (speaking || listening ? pulse * 14 : pulse * 4);
      const orbColor = listening
        ? '#f43f5e'
        : speaking
          ? '#38bdf8'
          : typing
            ? '#a855f7'
            : '#22d3ee';

      // Outer pulse ring
      ctx.beginPath();
      ctx.arc(cx, cy, animR + 22, 0, Math.PI * 2);
      ctx.strokeStyle = listening
        ? 'rgba(244, 63, 94, 0.35)'
        : speaking
          ? 'rgba(56, 189, 248, 0.42)'
          : 'rgba(168, 85, 247, 0.32)';
      ctx.lineWidth = 4;
      ctx.stroke();

      // Main glowing orb
      const orbGrad = ctx.createRadialGradient(cx - 18, cy - 18, 12, cx, cy, animR);
      orbGrad.addColorStop(0, '#ffffff');
      orbGrad.addColorStop(0.32, orbColor);
      orbGrad.addColorStop(1, '#1e1b4b');
      ctx.beginPath();
      ctx.arc(cx, cy, animR, 0, Math.PI * 2);
      ctx.fillStyle = orbGrad;
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 26px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('ZIA', cx, cy + 9);

      const statusLabel = listening
        ? 'Ouvindo você...'
        : speaking
          ? 'Zia falando...'
          : typing
            ? 'Pensando...'
            : 'Bola de Voz Ativa';
      ctx.fillStyle = '#7dd3fc';
      ctx.font = 'bold 21px sans-serif';
      ctx.fillText(statusLabel, cx, 265);

      const badges = [
        screenOn ? (soundOn ? '📺 Tela + Som ON' : '📺 Tela 1s ON') : '📺 Tela OFF',
        '🎙️ Modo Voz Contínuo',
      ].join('  ·  ');
      ctx.fillStyle = '#94a3b8';
      ctx.font = '15px sans-serif';
      ctx.fillText(badges, cx, 294);

      const allMsgs = streamMsg ? [...msgs, streamMsg] : msgs;
      const lastZia = [...allMsgs].reverse().find((m) => m.role === 'assistant');
      if (lastZia) {
        ctx.fillStyle = '#f1f5f9';
        ctx.font = '17px sans-serif';
        const lines = wrapLines(ctx, lastZia.text, w - 48, 3);
        let ty = 332;
        for (const line of lines) {
          ctx.fillText(line, cx, ty);
          ty += 24;
        }
      }
      ctx.textAlign = 'left';
      return;
    }

    // Standard PiP Chat HUD
    ctx.fillStyle = '#131b2e';
    ctx.fillRect(0, 0, w, 64);
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 64);
    ctx.lineTo(w, 64);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(34, 32, 10, 0, Math.PI * 2);
    ctx.fillStyle = listening ? '#f43f5e' : speaking ? '#38bdf8' : typing ? '#a855f7' : '#22d3ee';
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 24px sans-serif';
    ctx.fillText('Zia AI Flutuante', 56, 40);

    const statusText = listening
      ? 'Ouvindo...'
      : speaking
        ? 'Falando...'
        : typing
          ? 'Pensando...'
          : screenOn
            ? soundOn
              ? 'Tela+Som'
              : 'Tela 1s'
            : 'Ao vivo';
    ctx.fillStyle = '#7dd3fc';
    ctx.font = '600 18px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(statusText, w - 20, 39);
    ctx.textAlign = 'left';

    const allMsgs = streamMsg ? [...msgs, streamMsg] : msgs;
    const lastUser = [...allMsgs].reverse().find((m) => m.role === 'user');
    const lastZia = [...allMsgs].reverse().find((m) => m.role === 'assistant');

    let y = 96;
    if (lastUser) {
      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 17px sans-serif';
      ctx.fillText(`${stateRef.current.userName.trim() || 'Você'}:`, 20, y);
      y += 24;
      ctx.fillStyle = '#cbd5e1';
      ctx.font = '18px sans-serif';
      const uLines = wrapLines(ctx, lastUser.text, w - 40, 2);
      for (const line of uLines) {
        ctx.fillText(line, 20, y);
        y += 24;
      }
      y += 12;
    }

    if (lastZia) {
      ctx.fillStyle = '#c084fc';
      ctx.font = 'bold 18px sans-serif';
      ctx.fillText('Zia AI:', 20, y);
      y += 26;
      ctx.fillStyle = '#f8fafc';
      ctx.font = '20px sans-serif';
      const zLines = wrapLines(ctx, lastZia.text, w - 40, 6);
      for (const line of zLines) {
        ctx.fillText(line, 20, y);
        y += 28;
      }
    }

    ctx.fillStyle = 'rgba(148, 163, 184, 0.85)';
    ctx.font = '15px sans-serif';
    ctx.fillText('Toque em Play/Pausar na janela para falar no mic', 20, h - 18);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    drawHudFrame();
    const timer = window.setInterval(drawHudFrame, 250);
    return () => window.clearInterval(timer);
  }, [
    isOpen,
    drawHudFrame,
    messages,
    streamingBubble,
    isTyping,
    isSpeaking,
    isListening,
    isVoiceOrbMode,
    isScreenSharing,
    hasScreenAudio,
  ]);

  const closeVideoPiP = useCallback(async () => {
    try {
      if (typeof document !== 'undefined' && document.pictureInPictureElement === videoRef.current) {
        await document.exitPictureInPicture();
      }
    } catch {
      // Ignore
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }
    setIsOpen(false);
  }, []);

  const openVideoPiP = useCallback(async (): Promise<boolean> => {
    if (typeof document === 'undefined' || !isSupported) return false;

    if (!canvasRef.current) {
      const c = document.createElement('canvas');
      c.width = 520;
      c.height = 420;
      canvasRef.current = c;
    }

    if (!videoRef.current) {
      const v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.style.position = 'fixed';
      v.style.width = '1px';
      v.style.height = '1px';
      v.style.opacity = '0.001';
      v.style.pointerEvents = 'none';
      v.style.bottom = '0';
      v.style.right = '0';
      document.body.appendChild(v);
      videoRef.current = v;

      v.addEventListener('leavepictureinpicture', () => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        setIsOpen(false);
      });
    }

    drawHudFrame();

    const canvas = canvasRef.current;
    const video = videoRef.current;

    if (!streamRef.current) {
      streamRef.current = canvas.captureStream(8);
    }
    video.srcObject = streamRef.current;
    await video.play();

    if (typeof video.requestPictureInPicture !== 'function') {
      return false;
    }

    await video.requestPictureInPicture();
    setIsOpen(true);

    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: 'Zia AI — Bola Flutuante',
          artist: stateRef.current.userName.trim()
            ? `Parceira de ${stateRef.current.userName.trim()}`
            : 'Sua parceira gamer',
        });
        navigator.mediaSession.setActionHandler('play', () => stateRef.current.onToggleMic());
        navigator.mediaSession.setActionHandler('pause', () => stateRef.current.onToggleMic());
      } catch {
        // Ignore MediaSession restrictions
      }
    }

    return true;
  }, [drawHudFrame, isSupported]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (videoRef.current) {
        videoRef.current.remove();
        videoRef.current = null;
      }
    };
  }, []);

  return {
    isSupported,
    isOpen,
    openVideoPiP,
    closeVideoPiP,
  };
}
