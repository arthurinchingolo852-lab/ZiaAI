// Rolling 16kHz mono PCM -> standalone RIFF WAV ring buffer for error-free Gemini audio input.
// Avoids headerless WebM chunks produced by MediaRecorder timeslices.

function encodeMonoWav(samples: Float32Array, sampleRate: number): Blob {
  const byteLength = samples.length * 2;
  const buffer = new ArrayBuffer(44 + byteLength);
  const view = new DataView(buffer);

  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + byteLength, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, byteLength, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

function blobToBase64DataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Falha ao converter áudio.'));
      }
    };
    reader.onerror = () => reject(new Error('Erro ao ler áudio capturado.'));
    reader.readAsDataURL(blob);
  });
}

export class LiveAudioCapture {
  private ctx: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private silentGain: GainNode | null = null;
  private sources = new Map<string, { stream: MediaStream; node: MediaStreamAudioSourceNode; ownTracks: boolean }>();
  private ringBuffer: Float32Array;
  private writeIndex = 0;
  private filledSamples = 0;
  private targetSampleRate = 16000;

  constructor(durationSeconds = 3.5) {
    this.ringBuffer = new Float32Array(Math.floor(this.targetSampleRate * durationSeconds));
  }

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      try {
        this.ctx = new AudioCtx({ sampleRate: this.targetSampleRate });
      } catch {
        this.ctx = new AudioCtx();
      }
      this.targetSampleRate = this.ctx.sampleRate || 16000;
      const desiredLength = Math.floor(this.targetSampleRate * 3.5);
      if (this.ringBuffer.length !== desiredLength) {
        this.ringBuffer = new Float32Array(desiredLength);
        this.writeIndex = 0;
        this.filledSamples = 0;
      }

      this.processor = this.ctx.createScriptProcessor(4096, 1, 1);
      this.silentGain = this.ctx.createGain();
      this.silentGain.gain.value = 0;

      this.processor.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0);
        const len = this.ringBuffer.length;
        for (let i = 0; i < input.length; i++) {
          this.ringBuffer[this.writeIndex] = input[i];
          this.writeIndex = (this.writeIndex + 1) % len;
        }
        this.filledSamples = Math.min(len, this.filledSamples + input.length);
      };

      this.processor.connect(this.silentGain);
      this.silentGain.connect(this.ctx.destination);
    }

    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  attachStream(key: string, stream: MediaStream, ownTracks = false): boolean {
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) return false;

    this.detachStream(key);

    const ctx = this.ensureContext();
    if (!ctx || !this.processor) return false;

    try {
      const audioOnly = new MediaStream(audioTracks);
      const node = ctx.createMediaStreamSource(audioOnly);
      node.connect(this.processor);
      this.sources.set(key, { stream, node, ownTracks });
      return true;
    } catch {
      return false;
    }
  }

  detachStream(key: string): void {
    const existing = this.sources.get(key);
    if (!existing) return;
    try {
      existing.node.disconnect();
    } catch {
      // Ignore disconnect errors
    }
    if (existing.ownTracks) {
      existing.stream.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {
          // Ignore
        }
      });
    }
    this.sources.delete(key);
  }

  hasSources(): boolean {
    return this.sources.size > 0;
  }

  async getRecentWavBase64(minDurationMs = 400): Promise<string | undefined> {
    if (this.sources.size === 0) return undefined;
    const minSamples = Math.floor((this.targetSampleRate * minDurationMs) / 1000);
    if (this.filledSamples < minSamples) return undefined;

    const count = this.filledSamples;
    const ordered = new Float32Array(count);
    const len = this.ringBuffer.length;
    const startIdx = (this.writeIndex - count + len) % len;

    let sumSquares = 0;
    for (let i = 0; i < count; i++) {
      const sample = this.ringBuffer[(startIdx + i) % len];
      ordered[i] = sample;
      sumSquares += sample * sample;
    }

    // Skip dead silence to avoid wasting bandwidth/tokens on silent frames
    const rms = Math.sqrt(sumSquares / count);
    if (rms < 0.002) return undefined;

    try {
      const wavBlob = encodeMonoWav(ordered, this.targetSampleRate);
      return await blobToBase64DataUrl(wavBlob);
    } catch {
      return undefined;
    }
  }

  dispose(): void {
    for (const key of Array.from(this.sources.keys())) {
      this.detachStream(key);
    }
    try {
      this.processor?.disconnect();
      this.silentGain?.disconnect();
    } catch {
      // Ignore
    }
    this.processor = null;
    this.silentGain = null;
    if (this.ctx) {
      void this.ctx.close().catch(() => {});
      this.ctx = null;
    }
    this.writeIndex = 0;
    this.filledSamples = 0;
  }
}
