export function cleanTextForSpeech(input: string): string {
  return input
    // Remove emojis, pictographs, dingbats, symbols, skin-tone modifiers, ZWJ, variation selectors
    .replace(/[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\u200D\uFE0F]/gu, '')
    // Remove markdown formatting characters
    .replace(/```[\s\S]*?```/g, ' código pronto na tela. ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[*_~#>|]/g, '')
    .replace(/https?:\/\/\S+/g, '')
    // Expand common chat abbreviations so voice sounds naturally spoken in Portuguese
    .replace(/\bvc\b/gi, 'você')
    .replace(/\bvcs\b/gi, 'vocês')
    .replace(/\bpq\b/gi, 'porque')
    .replace(/\btbm\b/gi, 'também')
    .replace(/\btb\b/gi, 'também')
    .replace(/\bblz\b/gi, 'beleza')
    .replace(/\bobg\b/gi, 'obrigada')
    .replace(/\bmsg\b/gi, 'mensagem')
    .replace(/\s+/g, ' ')
    .trim();
}

// 1-sample silent WAV used to unlock HTMLAudioElement on Android/iOS user gestures
const SILENT_WAV_DATA_URI =
  'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';

let sharedAudioCtx: AudioContext | null = null;
let sharedAudioEl: HTMLAudioElement | null = null;
let currentAbortController: AbortController | null = null;
const activeAudioSources = new Set<AudioBufferSourceNode>();
let nextScheduledTime = 0;
let activeWavUrl: string | null = null;
let lastMicEndedAt = 0;
let autoUnlockAttached = false;
let neuralTtsBackoffUntil = 0;

export function markMicStopped(): void {
  lastMicEndedAt = Date.now();
}

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;
  if (!sharedAudioCtx) {
    sharedAudioCtx = new AudioCtx();
  }
  return sharedAudioCtx;
}

function getSharedAudioElement(): HTMLAudioElement | null {
  if (typeof window === 'undefined' || typeof Audio === 'undefined') return null;
  if (!sharedAudioEl) {
    sharedAudioEl = new Audio();
    sharedAudioEl.preload = 'auto';
  }
  return sharedAudioEl;
}

let cachedVoices: SpeechSynthesisVoice[] = [];

function refreshSpeechVoices(): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  try {
    const list = window.speechSynthesis.getVoices();
    if (list && list.length > 0) {
      cachedVoices = list;
    }
  } catch {
    // Ignore
  }
}

function attachAutoUnlockListeners(): void {
  if (autoUnlockAttached || typeof window === 'undefined') return;
  autoUnlockAttached = true;

  const unlockOnce = () => {
    unlockAndroidAudio();
  };

  window.addEventListener('pointerdown', unlockOnce, { passive: true });
  window.addEventListener('keydown', unlockOnce, { passive: true });

  if ('speechSynthesis' in window) {
    refreshSpeechVoices();
    window.speechSynthesis.addEventListener?.('voiceschanged', refreshSpeechVoices);
  }
}

if (typeof window !== 'undefined') {
  attachAutoUnlockListeners();
}

export function unlockAndroidAudio(): void {
  try {
    const ctx = getAudioContext();
    if (ctx) {
      if (ctx.state === 'suspended') {
        void ctx.resume().catch(() => {});
      }
      const buffer = ctx.createBuffer(1, 1, 22050);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      src.start(0);
    }
  } catch {
    // Ignore AudioContext errors on restricted devices
  }

  try {
    const el = getSharedAudioElement();
    if (el && !el.dataset.unlocked) {
      el.dataset.unlocked = '1';
      el.muted = true;
      el.src = SILENT_WAV_DATA_URI;
      void el
        .play()
        .then(() => {
          el.pause();
          el.muted = false;
          el.currentTime = 0;
        })
        .catch(() => {
          el.muted = false;
          delete el.dataset.unlocked;
        });
    }
  } catch {
    // Ignore HTMLAudioElement unlock errors
  }
}

export function stopZiaSpeech(): void {
  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
  }
  for (const src of activeAudioSources) {
    try {
      src.stop();
      src.disconnect();
    } catch {
      // Ignore already-stopped nodes
    }
  }
  activeAudioSources.clear();
  nextScheduledTime = 0;

  if (sharedAudioEl) {
    try {
      sharedAudioEl.pause();
      sharedAudioEl.currentTime = 0;
    } catch {
      // Ignore
    }
  }
  if (activeWavUrl) {
    URL.revokeObjectURL(activeWavUrl);
    activeWavUrl = null;
  }
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      // Ignore
    }
  }
}

function stripLeadingWavHeader(bytes: Uint8Array): Uint8Array {
  if (
    bytes.length > 44 &&
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x41 && // A
    bytes[10] === 0x56 && // V
    bytes[11] === 0x45 // E
  ) {
    return bytes.subarray(44);
  }
  return bytes;
}

function buildWavFromPcmChunks(chunks: Uint8Array[], sampleRate = 24000): Blob {
  let totalPcmBytes = 0;
  for (const chunk of chunks) {
    totalPcmBytes += chunk.byteLength;
  }
  totalPcmBytes -= totalPcmBytes % 2;

  const buffer = new ArrayBuffer(44 + totalPcmBytes);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + totalPcmBytes, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, totalPcmBytes, true);

  const out = new Uint8Array(buffer, 44);
  let offset = 0;
  for (const chunk of chunks) {
    const remaining = totalPcmBytes - offset;
    if (remaining <= 0) break;
    const toCopy = Math.min(chunk.byteLength, remaining);
    out.set(chunk.subarray(0, toCopy), offset);
    offset += toCopy;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

async function playWavChunksViaAudioElement(
  chunks: Uint8Array[],
  sampleRate: number,
  rate: number,
  signal: AbortSignal,
  onFirstAudio?: () => void
): Promise<boolean> {
  if (signal.aborted || chunks.length === 0) return false;
  const el = getSharedAudioElement() ?? new Audio();
  const wavBlob = buildWavFromPcmChunks(chunks, sampleRate);
  if (wavBlob.size <= 44) return false;

  if (activeWavUrl) {
    URL.revokeObjectURL(activeWavUrl);
    activeWavUrl = null;
  }
  const url = URL.createObjectURL(wavBlob);
  activeWavUrl = url;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      el.onended = null;
      el.onerror = null;
      resolve(ok);
    };

    const onAbort = () => {
      try {
        el.pause();
      } catch {
        // Ignore
      }
      finish(false);
    };

    signal.addEventListener('abort', onAbort, { once: true });

    el.muted = false;
    el.volume = 1;
    el.playbackRate = rate;
    el.src = url;
    el.onended = () => {
      signal.removeEventListener('abort', onAbort);
      finish(true);
    };
    el.onerror = () => {
      signal.removeEventListener('abort', onAbort);
      finish(false);
    };

    onFirstAudio?.();
    void el.play().catch(() => {
      signal.removeEventListener('abort', onAbort);
      finish(false);
    });
  });
}

async function resumeContextFast(ctx: AudioContext): Promise<boolean> {
  if (ctx.state === 'running') return true;
  try {
    await Promise.race([
      ctx.resume(),
      new Promise<void>((resolve) => window.setTimeout(resolve, 60)),
    ]);
  } catch {
    // Ignore resume rejection
  }
  return (ctx.state as AudioContextState) === 'running';
}

function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const a of arrays) total += a.byteLength;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.byteLength;
  }
  return out;
}

async function streamNeuralTtsChunked(
  cleanedText: string,
  options: {
    rate?: number;
    signal: AbortSignal;
    onFirstAudio?: () => void;
  }
): Promise<boolean> {
  if (Date.now() < neuralTtsBackoffUntil) {
    return false;
  }

  // Brief yield after Android SpeechRecognition stop so media audio isn't ducked
  const msSinceMic = Date.now() - lastMicEndedAt;
  if (msSinceMic >= 0 && msSinceMic < 90) {
    await new Promise((r) => window.setTimeout(r, 90 - msSinceMic));
  }
  if (options.signal.aborted) return false;

  const ctx = getAudioContext();
  const canUseWebAudio = ctx ? await resumeContextFast(ctx) : false;

  let res: Response | null = null;
  try {
    res = await fetch('/api/zia/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: cleanedText }),
      signal: options.signal,
    });
  } catch {
    return false;
  }

  if (!res || !res.ok || !res.body) {
    if (res?.status === 429) {
      // Brief backoff so neural voice recovers automatically once quota window opens
      neuralTtsBackoffUntil = Date.now() + 25 * 1000;
    }
    return false;
  }

  const headerRate = Number(res.headers.get('X-Audio-Sample-Rate'));
  const sampleRate = Number.isFinite(headerRate) && headerRate >= 8000 ? headerRate : 24000;

  const reader = res.body.getReader();
  const rate = Math.min(1.35, Math.max(0.8, options.rate ?? 1.0));

  // Coalesce chunks into >= 9600 bytes (~200ms of 24kHz PCM) for fast start without clicks/chiado
  const MIN_BATCH_BYTES = 9600;
  const pendingChunks: Uint8Array[] = [];
  let pendingBytes = 0;
  const allPcmChunks: Uint8Array[] = [];
  let checkedWavHeader = false;
  let leftoverByte: number | null = null;
  let firedStart = false;
  let playedAnyBytes = false;

  if (ctx && canUseWebAudio) {
    if (nextScheduledTime < ctx.currentTime) {
      nextScheduledTime = ctx.currentTime + 0.03;
    }
  }

  const flushToWebAudio = (force: boolean) => {
    if (!ctx || ctx.state !== 'running') return;
    if (pendingBytes === 0) return;
    if (!force && pendingBytes < MIN_BATCH_BYTES) return;

    const merged = concatUint8Arrays(pendingChunks);
    pendingChunks.length = 0;
    pendingBytes = 0;

    let working = merged;
    if (leftoverByte !== null) {
      const prefixed = new Uint8Array(1 + merged.length);
      prefixed[0] = leftoverByte;
      prefixed.set(merged, 1);
      working = prefixed;
      leftoverByte = null;
    }

    const usableBytes = working.length - (working.length % 2);
    if (usableBytes < working.length) {
      leftoverByte = working[working.length - 1];
    }
    if (usableBytes < 2) return;

    const sampleCount = usableBytes / 2;
    const floatSamples = new Float32Array(sampleCount);
    const view = new DataView(working.buffer, working.byteOffset, usableBytes);
    for (let i = 0; i < sampleCount; i++) {
      floatSamples[i] = view.getInt16(i * 2, true) / 32768;
    }

    // Gentle 3ms fade-in on very first chunk to prevent any DC click
    if (!firedStart) {
      const fadeSamples = Math.min(sampleCount, Math.round(sampleRate * 0.004));
      for (let i = 0; i < fadeSamples; i++) {
        floatSamples[i] *= i / fadeSamples;
      }
    }

    const audioBuffer = ctx.createBuffer(1, sampleCount, sampleRate);
    audioBuffer.copyToChannel(floatSamples, 0);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.playbackRate.value = rate;
    source.connect(ctx.destination);

    const startAt = Math.max(ctx.currentTime + 0.02, nextScheduledTime);
    nextScheduledTime = startAt + audioBuffer.duration / rate;

    activeAudioSources.add(source);
    source.onended = () => {
      activeAudioSources.delete(source);
    };

    if (!firedStart) {
      firedStart = true;
      options.onFirstAudio?.();
    }
    playedAnyBytes = true;
    source.start(startAt);
  };

  while (true) {
    if (options.signal.aborted) return false;
    const { value, done } = await reader.read();
    if (done) break;
    if (!value || value.length === 0) continue;

    let cleanChunk: Uint8Array = value;
    if (!checkedWavHeader) {
      cleanChunk = stripLeadingWavHeader(value);
      if (cleanChunk.length > 0) checkedWavHeader = true;
    }
    if (cleanChunk.length === 0) continue;

    allPcmChunks.push(cleanChunk);

    if (ctx && canUseWebAudio && ctx.state === 'running') {
      pendingChunks.push(cleanChunk);
      pendingBytes += cleanChunk.byteLength;
      if (pendingBytes >= MIN_BATCH_BYTES) {
        flushToWebAudio(false);
      }
    }
  }

  if (options.signal.aborted) return false;

  if (ctx && canUseWebAudio && ctx.state === 'running') {
    flushToWebAudio(true);
    if (playedAnyBytes) return true;
  }

  if (allPcmChunks.length > 0) {
    return playWavChunksViaAudioElement(
      allPcmChunks,
      sampleRate,
      rate,
      options.signal,
      options.onFirstAudio
    );
  }

  return false;
}

function waitForScheduledAudioEnd(ctx: AudioContext, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (
        signal.aborted ||
        ctx.state !== 'running' ||
        activeAudioSources.size === 0 ||
        ctx.currentTime >= nextScheduledTime - 0.02
      ) {
        resolve();
        return;
      }
      window.setTimeout(check, 60);
    };
    check();
  });
}

function pickBrazilianFemaleVoice(): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  refreshSpeechVoices();
  const voices = cachedVoices.length > 0 ? cachedVoices : window.speechSynthesis.getVoices();
  if (!voices.length) return null;

  const ptBrVoices = voices.filter((v) => v.lang.toLowerCase().startsWith('pt-br'));
  const ptVoices =
    ptBrVoices.length > 0
      ? ptBrVoices
      : voices.filter((v) => v.lang.toLowerCase().startsWith('pt'));
  if (!ptVoices.length) return null;

  const malePattern =
    /\b(antonio|antônio|daniel|ricardo|fabio|fábio|felipe|tiago|thiago|pedro|joao|joão|lucas|mateus|rafael|male|masculin|homem|reed|eddy|rocko|grandpa|nicolas|humberto|donato|julio|valerio)\b/i;
  const femalePriority = [
    /francisca.*(natural|neural|online)/i,
    /thalita.*(natural|neural|online)/i,
    /yara.*(natural|neural|online)/i,
    /google\s*portugu[êe]s\s*do\s*brasil/i,
    /francisca|thalita|yara|luciana|maria|fernanda|leticia|letícia|raquel|camila|vitoria|vitória|emanuela|leila|giovanna|heloisa|brenda|elsa|female|feminina|mulher/i,
    /natural|neural|online/i,
  ];

  const nonMale = ptVoices.filter((v) => !malePattern.test(v.name));
  const cloudNonMale = nonMale.filter((v) => !v.localService);
  const pool = cloudNonMale.length > 0 ? cloudNonMale : nonMale.length > 0 ? nonMale : ptVoices;

  for (const regex of femalePriority) {
    const match = pool.find((v) => regex.test(v.name));
    if (match) return match;
  }
  return pool[0];
}

function splitTextIntoNaturalSentences(text: string): string[] {
  const parts = text
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length <= 1) return [text];

  // Merge very short fragments so prosody stays fluid without awkward pauses
  const merged: string[] = [];
  for (const part of parts) {
    const prev = merged[merged.length - 1];
    if (prev && prev.length + part.length < 130) {
      merged[merged.length - 1] = `${prev} ${part}`;
    } else {
      merged.push(part);
    }
  }
  return merged;
}

async function speakSingleUtterance(
  synth: SpeechSynthesis,
  chunkText: string,
  voice: SpeechSynthesisVoice | null,
  rate: number,
  signal: AbortSignal,
  onFirstAudio?: () => void
): Promise<boolean> {
  if (signal.aborted) return false;
  return new Promise((resolve) => {
    let settled = false;
    let started = false;
    const utterance = new SpeechSynthesisUtterance(chunkText);
    utterance.lang = 'pt-BR';
    utterance.rate = rate;
    utterance.pitch = 1.02;
    utterance.volume = 1;

    if (voice) {
      utterance.voice = voice;
    }

    const maxMs = Math.max(3500, chunkText.length * 105);
    const watchdog = window.setTimeout(() => finish(true), maxMs);

    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(watchdog);
      signal.removeEventListener('abort', onAbort);
      resolve(ok);
    };

    const onAbort = () => {
      try {
        synth.cancel();
      } catch {
        // Ignore
      }
      finish(false);
    };

    signal.addEventListener('abort', onAbort, { once: true });

    utterance.onstart = () => {
      if (!started) {
        started = true;
        onFirstAudio?.();
      }
    };
    utterance.onend = () => finish(true);
    utterance.onerror = () => finish(false);

    try {
      window.setTimeout(() => {
        if (!settled && !started && !signal.aborted) {
          started = true;
          onFirstAudio?.();
        }
      }, 140);
      synth.speak(utterance);
    } catch {
      finish(false);
    }
  });
}

async function speakWithBrowserSynthesis(
  cleanedText: string,
  options: {
    rate?: number;
    signal: AbortSignal;
    onFirstAudio?: () => void;
  }
): Promise<boolean> {
  if (typeof window === 'undefined' || !('speechSynthesis' in window) || options.signal.aborted) {
    return false;
  }

  const synth = window.speechSynthesis;
  try {
    synth.cancel();
  } catch {
    // Ignore
  }

  // Wait briefly if browser voices are still loading asynchronously
  if (cachedVoices.length === 0 && synth.getVoices().length === 0) {
    await new Promise((r) => window.setTimeout(r, 120));
  }
  if (options.signal.aborted) return false;

  const rate = Math.min(1.25, Math.max(0.85, options.rate ?? 1.0));
  const voice = pickBrazilianFemaleVoice();
  const sentences = splitTextIntoNaturalSentences(cleanedText);
  let firedFirst = false;

  for (const sentence of sentences) {
    if (options.signal.aborted) return false;
    const ok = await speakSingleUtterance(synth, sentence, voice, rate, options.signal, () => {
      if (!firedFirst) {
        firedFirst = true;
        options.onFirstAudio?.();
      }
    });
    if (!ok) return firedFirst;
  }
  return true;
}

export function speakWithZiaVoice(
  text: string,
  options: {
    enabled: boolean;
    rate?: number;
    onStart?: () => void;
    onEnd?: () => void;
  }
): void {
  if (!options.enabled || typeof window === 'undefined') {
    options.onEnd?.();
    return;
  }

  const cleaned = cleanTextForSpeech(text);
  if (!cleaned) {
    options.onEnd?.();
    return;
  }

  stopZiaSpeech();
  const controller = new AbortController();
  currentAbortController = controller;

  void (async () => {
    try {
      const ok = await streamNeuralTtsChunked(cleaned, {
        rate: options.rate,
        signal: controller.signal,
        onFirstAudio: () => options.onStart?.(),
      });

      if (ok && sharedAudioCtx && sharedAudioCtx.state === 'running' && !controller.signal.aborted) {
        await waitForScheduledAudioEnd(sharedAudioCtx, controller.signal);
      } else if (!ok && !controller.signal.aborted) {
        await speakWithBrowserSynthesis(cleaned, {
          rate: options.rate,
          signal: controller.signal,
          onFirstAudio: () => options.onStart?.(),
        });
      }
    } catch {
      if (!controller.signal.aborted) {
        await speakWithBrowserSynthesis(cleaned, {
          rate: options.rate,
          signal: controller.signal,
          onFirstAudio: () => options.onStart?.(),
        }).catch(() => {});
      }
    } finally {
      options.onEnd?.();
    }
  })();
}

export function createStreamingSpeechSession(options: {
  enabled: boolean;
  rate?: number;
  onStart?: () => void;
  onEnd?: () => void;
}) {
  let controller: AbortController | null = null;

  if (options.enabled && typeof window !== 'undefined') {
    stopZiaSpeech();
    controller = new AbortController();
    currentAbortController = controller;
  }

  return {
    // Keep text streaming uninterrupted and speak the complete clean answer once ready
    // (avoids chopped micro-requests, static clicks, and quota exhaustion).
    pushText(_fullVisibleText: string) {
      // Intentional no-op; finish() triggers seamless single-stream voice output
    },
    finish(fullVisibleText: string) {
      if (!options.enabled || !controller) {
        options.onEnd?.();
        return;
      }

      const cleaned = cleanTextForSpeech(fullVisibleText);
      if (!cleaned || controller.signal.aborted) {
        options.onEnd?.();
        return;
      }

      const sessionController = controller;
      void (async () => {
        try {
          const ok = await streamNeuralTtsChunked(cleaned, {
            rate: options.rate,
            signal: sessionController.signal,
            onFirstAudio: () => options.onStart?.(),
          });

          if (
            ok &&
            sharedAudioCtx &&
            sharedAudioCtx.state === 'running' &&
            !sessionController.signal.aborted
          ) {
            await waitForScheduledAudioEnd(sharedAudioCtx, sessionController.signal);
          } else if (!ok && !sessionController.signal.aborted) {
            await speakWithBrowserSynthesis(cleaned, {
              rate: options.rate,
              signal: sessionController.signal,
              onFirstAudio: () => options.onStart?.(),
            });
          }
        } catch {
          if (!sessionController.signal.aborted) {
            await speakWithBrowserSynthesis(cleaned, {
              rate: options.rate,
              signal: sessionController.signal,
              onFirstAudio: () => options.onStart?.(),
            }).catch(() => {});
          }
        } finally {
          options.onEnd?.();
        }
      })();
    },
  };
}
