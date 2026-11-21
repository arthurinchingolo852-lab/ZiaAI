import type { VideoScene } from '../types/zia';

function loadImageWithTimeout(url: string, timeoutMs = 10000): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const timer = window.setTimeout(() => {
      img.onload = null;
      img.onerror = null;
      resolve(null);
    }, timeoutMs);

    img.onload = () => {
      window.clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      resolve(null);
    };
    img.src = url;
  });
}

async function loadSceneImageFast(
  directUrl: string,
  proxyUrl: string
): Promise<HTMLImageElement | null> {
  const direct = await loadImageWithTimeout(directUrl, 9000);
  if (direct) return direct;
  return loadImageWithTimeout(proxyUrl, 9000);
}

function wrapTextLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 3);
}

function getSupportedRecorderMimeType(): string {
  const candidates = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4',
  ];
  for (const type of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  return '';
}

export async function renderAnimatedVideoFromScenes(
  title: string,
  scenes: VideoScene[],
  onProgress?: (label: string) => void
): Promise<{ blobUrl?: string; mimeType?: string; scenesWithUrls: VideoScene[] }> {
  const safeScenes = scenes.slice(0, 4);

  onProgress?.('Gerando as cenas em paralelo...');

  const baseSeed = Date.now();
  const sceneTargets = safeScenes.map((scene, idx) => {
    const encoded = encodeURIComponent(scene.promptEn);
    const seed = baseSeed + idx * 71;
    const directUrl = `https://image.pollinations.ai/prompt/${encoded}?width=512&height=512&model=flux&nologo=true&seed=${seed}`;
    const proxyUrl = `/api/media/image?prompt=${encoded}&width=512&height=512&model=flux&seed=${seed}`;
    return {
      scene: { ...scene, imageUrl: idx === 1 ? proxyUrl : directUrl },
      primaryUrl: idx === 1 ? proxyUrl : directUrl,
      fallbackUrl: idx === 1 ? directUrl : proxyUrl,
    };
  });

  const scenesWithUrls: VideoScene[] = sceneTargets.map((item) => item.scene);

  const loadedImages = await Promise.all(
    sceneTargets.map((item) => loadSceneImageFast(item.primaryUrl, item.fallbackUrl))
  );

  const canRecordCanvas =
    typeof MediaRecorder !== 'undefined' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function';

  if (!canRecordCanvas) {
    return { scenesWithUrls };
  }

  onProgress?.('Montando história animada com legendas...');

  const width = 512;
  const height = 512;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { scenesWithUrls };
  }

  let stream: MediaStream;
  try {
    stream = canvas.captureStream(24);
  } catch {
    return { scenesWithUrls };
  }

  const mimeType = getSupportedRecorderMimeType();
  let recorder: MediaRecorder;
  try {
    recorder = mimeType
      ? new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 1_500_000 })
      : new MediaRecorder(stream);
  } catch {
    try {
      recorder = new MediaRecorder(stream);
    } catch {
      return { scenesWithUrls };
    }
  }

  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (ev) => {
    if (ev.data && ev.data.size > 0) {
      chunks.push(ev.data);
    }
  };

  const recordingDone = new Promise<{ blobUrl?: string; mimeType?: string }>((resolve) => {
    recorder.onstop = () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      const finalType = recorder.mimeType || mimeType || 'video/webm';
      const blob = new Blob(chunks, { type: finalType });
      if (blob.size === 0) {
        resolve({});
        return;
      }
      const blobUrl = URL.createObjectURL(blob);
      resolve({ blobUrl, mimeType: finalType });
    };
    recorder.onerror = () => resolve({});
  });

  try {
    recorder.start(250);
  } catch {
    return { scenesWithUrls };
  }

  const fps = 24;
  const secondsPerScene = 2.0;
  const framesPerScene = Math.round(fps * secondsPerScene);
  const totalScenes = Math.max(1, scenesWithUrls.length);

  for (let sIdx = 0; sIdx < totalScenes; sIdx++) {
    const scene = scenesWithUrls[sIdx];
    const img = loadedImages[sIdx];
    const nextImg = loadedImages[sIdx + 1] ?? null;

    for (let f = 0; f < framesPerScene; f++) {
      const progress = f / framesPerScene;

      // Deep dark fallback background
      const bgGrad = ctx.createLinearGradient(0, 0, width, height);
      bgGrad.addColorStop(0, '#090d16');
      bgGrad.addColorStop(0.5, '#131b2e');
      bgGrad.addColorStop(1, '#1e1b4b');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, width, height);

      if (img) {
        const zoom = 1 + progress * 0.1;
        const panX = (sIdx % 2 === 0 ? 1 : -1) * progress * 18;
        const drawW = width * zoom;
        const drawH = height * zoom;
        const dx = (width - drawW) / 2 + panX;
        const dy = (height - drawH) / 2;

        ctx.save();
        ctx.globalAlpha = 1;
        ctx.drawImage(img, dx, dy, drawW, drawH);
        ctx.restore();
      } else {
        // Stylized futuristic ambient fallback frame if image timed out
        ctx.save();
        const orbGrad = ctx.createRadialGradient(
          width * (0.35 + progress * 0.3),
          height * 0.4,
          20,
          width * 0.5,
          height * 0.45,
          320
        );
        orbGrad.addColorStop(0, 'rgba(56, 189, 248, 0.38)');
        orbGrad.addColorStop(0.6, 'rgba(168, 85, 247, 0.18)');
        orbGrad.addColorStop(1, 'rgba(9, 13, 22, 0)');
        ctx.fillStyle = orbGrad;
        ctx.fillRect(0, 0, width, height);
        ctx.restore();
      }

      // Crossfade into next scene during last 15% of frames
      if (nextImg && progress > 0.85) {
        const fadeAlpha = (progress - 0.85) / 0.15;
        ctx.save();
        ctx.globalAlpha = fadeAlpha;
        ctx.drawImage(nextImg, 0, 0, width, height);
        ctx.restore();
      }

      // Top & bottom contrast scrims for crisp legibility
      const topScrim = ctx.createLinearGradient(0, 0, 0, 96);
      topScrim.addColorStop(0, 'rgba(9, 13, 22, 0.8)');
      topScrim.addColorStop(1, 'rgba(9, 13, 22, 0)');
      ctx.fillStyle = topScrim;
      ctx.fillRect(0, 0, width, 96);

      const bottomScrim = ctx.createLinearGradient(0, height - 175, 0, height);
      bottomScrim.addColorStop(0, 'rgba(9, 13, 22, 0)');
      bottomScrim.addColorStop(0.45, 'rgba(9, 13, 22, 0.78)');
      bottomScrim.addColorStop(1, 'rgba(9, 13, 22, 0.95)');
      ctx.fillStyle = bottomScrim;
      ctx.fillRect(0, height - 175, width, 175);

      // Header title & scene counter
      ctx.font = '600 16px "Outfit", sans-serif';
      ctx.fillStyle = '#38bdf8';
      ctx.fillText(`Zia AI · ${title}`.slice(0, 34), 20, 36);

      ctx.font = '500 13px "JetBrains Mono", monospace';
      ctx.fillStyle = 'rgba(226, 232, 240, 0.85)';
      ctx.fillText(`Cena ${sIdx + 1}/${totalScenes}`, width - 86, 36);

      // Subtitle caption
      ctx.font = '600 22px "Plus Jakarta Sans", sans-serif';
      ctx.fillStyle = '#f8fafc';
      const lines = wrapTextLines(ctx, scene.captionPt, width - 48);
      const startY = height - 38 - (lines.length - 1) * 28;
      lines.forEach((line, lIdx) => {
        ctx.fillText(line, 24, startY + lIdx * 28);
      });

      // Overall progress bar at bottom edge
      const totalProgress = (sIdx + progress) / totalScenes;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
      ctx.fillRect(0, height - 6, width, 6);
      const barGrad = ctx.createLinearGradient(0, 0, width, 0);
      barGrad.addColorStop(0, '#38bdf8');
      barGrad.addColorStop(1, '#a855f7');
      ctx.fillStyle = barGrad;
      ctx.fillRect(0, height - 6, width * totalProgress, 6);

      // Wait ~42ms per frame so captureStream(24) captures smooth timing
      await new Promise((r) => setTimeout(r, 42));
    }
  }

  try {
    if (recorder.state === 'recording' && typeof recorder.requestData === 'function') {
      recorder.requestData();
    }
    if (recorder.state !== 'inactive') {
      recorder.stop();
    }
  } catch {
    // Ignore stop errors
  }
  const { blobUrl, mimeType: finalMime } = await recordingDone;
  return { blobUrl, mimeType: finalMime, scenesWithUrls };
}
