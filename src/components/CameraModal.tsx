import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera,
  Check,
  ImagePlus,
  RefreshCw,
  RotateCcw,
  Send,
  Square,
  Video,
  X,
} from 'lucide-react';

export interface RecordedVideoPayload {
  dataUrl: string;
  mimeType: string;
  previewUrl: string;
}

interface CameraModalProps {
  isOpen: boolean;
  initialMode?: 'photo' | 'video';
  onClose: () => void;
  onAttachPhoto: (dataUrl: string) => void;
  onSendPhotoNow: (dataUrl: string) => void;
  onAttachVideo: (video: RecordedVideoPayload) => void;
  onSendVideoNow: (video: RecordedVideoPayload) => void;
  onOpenGallery: () => void;
}

const MAX_VIDEO_SECONDS = 15;
const MAX_VIDEO_BYTES = 24 * 1024 * 1024;

function pickSupportedVideoMimeType(hasAudio: boolean): string {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return '';
  }
  const candidates = hasAudio
    ? [
        'video/webm;codecs=vp8,opus',
        'video/webm;codecs=vp9,opus',
        'video/webm',
        'video/mp4',
      ]
    : [
        'video/webm;codecs=vp8',
        'video/webm;codecs=vp9',
        'video/webm',
        'video/mp4',
      ];
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  return '';
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Não foi possível ler o vídeo gravado.'));
    reader.readAsDataURL(blob);
  });
}

export const CameraModal: React.FC<CameraModalProps> = ({
  isOpen,
  initialMode = 'photo',
  onClose,
  onAttachPhoto,
  onSendPhotoNow,
  onAttachVideo,
  onSendVideoNow,
  onOpenGallery,
}) => {
  const [captureMode, setCaptureMode] = useState<'photo' | 'video'>(initialMode);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [capturedUrl, setCapturedUrl] = useState<string | null>(null);
  const [recordedVideo, setRecordedVideo] = useState<RecordedVideoPayload | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<number | null>(null);
  const nativeCameraInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      setCaptureMode(initialMode);
    }
  }, [isOpen, initialMode]);

  const clearRecordTimer = useCallback(() => {
    if (recordTimerRef.current !== null) {
      window.clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
  }, []);

  const stopCameraStream = useCallback(() => {
    clearRecordTimer();
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        // Ignore
      }
    }
    mediaRecorderRef.current = null;
    setIsRecording(false);
    setRecordSeconds(0);

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // Ignore
        }
      });
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, [clearRecordTimer]);

  const startCameraStream = useCallback(
    async (mode: 'environment' | 'user', needAudio: boolean) => {
      stopCameraStream();
      setCameraError(null);
      setIsStarting(true);

      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        setIsStarting(false);
        setCameraError(
          'Seu navegador não liberou a câmera ao vivo. Use o botão de câmera nativa abaixo!'
        );
        return;
      }

      try {
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: mode },
              width: { ideal: needAudio ? 720 : 1280 },
              height: { ideal: needAudio ? 480 : 720 },
            },
            audio: needAudio,
          });
        } catch {
          // Fallback without audio or facingMode constraints
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              video: {
                facingMode: { ideal: mode },
                width: { ideal: 720 },
                height: { ideal: 480 },
              },
              audio: false,
            });
          } catch {
            stream = await navigator.mediaDevices.getUserMedia({
              video: true,
              audio: false,
            });
          }
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch (err) {
        const errName = err instanceof DOMException ? err.name : '';
        if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
          setCameraError(
            'Permissão da câmera negada. Libere nas configurações ou use a câmera nativa abaixo!'
          );
        } else {
          setCameraError(
            'Não consegui abrir a câmera ao vivo aqui. Use a câmera nativa do celular abaixo!'
          );
        }
      } finally {
        setIsStarting(false);
      }
    },
    [stopCameraStream]
  );

  useEffect(() => {
    if (!isOpen) {
      stopCameraStream();
      setCapturedUrl(null);
      setRecordedVideo(null);
      setCameraError(null);
      return;
    }

    if (!capturedUrl && !recordedVideo) {
      void startCameraStream(facingMode, captureMode === 'video');
    }

    return () => {
      stopCameraStream();
    };
  }, [isOpen, facingMode, captureMode, capturedUrl, recordedVideo, startCameraStream, stopCameraStream]);

  if (!isOpen) return null;

  const handleCapturePhoto = () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) return;

    const maxDim = 1280;
    const scale = Math.min(1, maxDim / Math.max(video.videoWidth, video.videoHeight));
    const width = Math.max(1, Math.round(video.videoWidth * scale));
    const height = Math.max(1, Math.round(video.videoHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (facingMode === 'user') {
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, width, height);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
    stopCameraStream();
    setCapturedUrl(dataUrl);
  };

  const handleStopRecording = () => {
    clearRecordTimer();
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== 'inactive') {
      try {
        if (rec.state === 'recording' && typeof rec.requestData === 'function') {
          rec.requestData();
        }
        rec.stop();
      } catch {
        // Ignore
      }
    }
  };

  const handleStartRecording = () => {
    const stream = streamRef.current;
    if (!stream || typeof MediaRecorder === 'undefined') {
      setCameraError('Gravação ao vivo indisponível aqui. Use o botão Nativa abaixo!');
      return;
    }

    recordedChunksRef.current = [];
    setRecordSeconds(0);
    setCameraError(null);

    const hasAudio = stream.getAudioTracks().length > 0;
    const preferredMime = pickSupportedVideoMimeType(hasAudio);
    try {
      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(stream, {
          ...(preferredMime ? { mimeType: preferredMime } : {}),
          videoBitsPerSecond: 650_000,
        });
      } catch {
        recorder = new MediaRecorder(stream);
      }

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          recordedChunksRef.current.push(ev.data);
        }
      };

      recorder.onstop = () => {
        clearRecordTimer();
        setIsRecording(false);
        const rawMime = (recorder.mimeType || preferredMime || 'video/webm').split(';')[0];
        const blob = new Blob(recordedChunksRef.current, { type: rawMime });
        if (blob.size === 0) {
          setCameraError('Nenhum dado de vídeo capturado. Grave por pelo menos 1 segundo ou use o botão Nativa!');
          return;
        }
        if (blob.size > MAX_VIDEO_BYTES) {
          setCameraError('O vídeo ficou grande demais. Grave um trecho mais curto (até 15s)!');
          return;
        }
        const previewUrl = URL.createObjectURL(blob);
        void blobToDataUrl(blob)
          .then((dataUrl) => {
            stopCameraStream();
            setRecordedVideo({ dataUrl, mimeType: rawMime, previewUrl });
          })
          .catch(() => {
            setCameraError('Erro ao preparar o vídeo gravado. Tente novamente!');
          });
      };

      mediaRecorderRef.current = recorder;
      recorder.start(250);
      setIsRecording(true);

      let elapsed = 0;
      recordTimerRef.current = window.setInterval(() => {
        elapsed += 1;
        setRecordSeconds(elapsed);
        if (elapsed >= MAX_VIDEO_SECONDS) {
          handleStopRecording();
        }
      }, 1000);
    } catch {
      setCameraError('Não foi possível iniciar a gravação aqui. Use o botão Nativa abaixo!');
    }
  };

  const handleNativeCameraPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (file.type.startsWith('video/')) {
      if (file.size > MAX_VIDEO_BYTES) {
        setCameraError('Esse vídeo passa de 16 MB. Grave um vídeo mais curto (até 15s) para a Zia assistir!');
        return;
      }
      const previewUrl = URL.createObjectURL(file);
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          stopCameraStream();
          setCameraError(null);
          setCapturedUrl(null);
          setRecordedVideo({
            dataUrl: reader.result,
            mimeType: file.type.split(';')[0] || 'video/mp4',
            previewUrl,
          });
        }
      };
      reader.readAsDataURL(file);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        stopCameraStream();
        setCameraError(null);
        setRecordedVideo(null);
        setCapturedUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const hasPreview = Boolean(capturedUrl || recordedVideo);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-label="Câmera e Vídeo da Zia AI"
    >
      <input
        ref={nativeCameraInputRef}
        type="file"
        accept={captureMode === 'video' ? 'video/*' : 'image/*'}
        capture={facingMode}
        className="hidden"
        onChange={handleNativeCameraPick}
      />

      <div className="w-full max-w-md rounded-3xl bg-[#0d1322] border border-sky-400/25 shadow-2xl overflow-hidden flex flex-col max-h-[92dvh]">
        {/* Header */}
        <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between gap-2 bg-[#131b2e]/70">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-sky-500/20 border border-sky-400/40 flex items-center justify-center text-sky-300 shrink-0">
              {captureMode === 'video' ? <Video className="w-4 h-4" /> : <Camera className="w-4 h-4" />}
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-white leading-tight truncate">
                {captureMode === 'video' ? 'Gravar Vídeo para Zia' : 'Câmera da Zia AI'}
              </h2>
              <p className="text-[11px] text-slate-400 truncate">
                {recordedVideo
                  ? 'Vídeo pronto! Envie para a Zia assistir 🎬'
                  : capturedUrl
                    ? 'Ficou boa? Envie para a Zia analisar!'
                    : captureMode === 'video'
                      ? `Grave até ${MAX_VIDEO_SECONDS}s para ela assistir`
                      : 'Aponte a câmera e tire uma foto ✨'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="min-h-[38px] min-w-[38px] rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white flex items-center justify-center cursor-pointer shrink-0"
            aria-label="Fechar câmera"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode Switch (Foto vs Vídeo) */}
        {!hasPreview && (
          <div className="px-4 py-2 bg-[#090d16] border-b border-white/10 flex items-center justify-center gap-2">
            <button
              type="button"
              disabled={isRecording}
              onClick={() => setCaptureMode('photo')}
              className={`flex-1 h-9 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-colors disabled:opacity-50 ${
                captureMode === 'photo'
                  ? 'bg-sky-500/20 border border-sky-400/50 text-sky-200'
                  : 'bg-[#131b2e] border border-white/10 text-slate-400 hover:text-white'
              }`}
            >
              <Camera className="w-3.5 h-3.5" />
              <span>Foto</span>
            </button>
            <button
              type="button"
              disabled={isRecording}
              onClick={() => setCaptureMode('video')}
              className={`flex-1 h-9 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-colors disabled:opacity-50 ${
                captureMode === 'video'
                  ? 'bg-purple-500/25 border border-purple-400/50 text-purple-200'
                  : 'bg-[#131b2e] border border-white/10 text-slate-400 hover:text-white'
              }`}
            >
              <Video className="w-3.5 h-3.5" />
              <span>Gravar Vídeo</span>
            </button>
          </div>
        )}

        {/* Viewfinder / Preview Area */}
        <div className="relative bg-black aspect-[3/4] sm:aspect-[4/3] w-full flex items-center justify-center overflow-hidden">
          {recordedVideo ? (
            <video
              src={recordedVideo.previewUrl}
              controls
              autoPlay
              loop
              playsInline
              className="w-full h-full object-contain bg-black"
            />
          ) : capturedUrl ? (
            <img
              src={capturedUrl}
              alt="Foto capturada pela câmera"
              className="w-full h-full object-contain bg-black"
            />
          ) : cameraError ? (
            <div className="p-6 text-center space-y-4 max-w-sm">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-sky-500/15 border border-sky-400/35 flex items-center justify-center text-sky-300">
                {captureMode === 'video' ? <Video className="w-7 h-7" /> : <Camera className="w-7 h-7" />}
              </div>
              <p className="text-sm text-slate-200 leading-relaxed">{cameraError}</p>
              <div className="flex flex-col gap-2.5">
                <button
                  type="button"
                  onClick={() => nativeCameraInputRef.current?.click()}
                  className="min-h-[44px] px-4 rounded-2xl bg-gradient-to-r from-sky-400 to-purple-500 text-slate-950 font-bold text-sm flex items-center justify-center gap-2 cursor-pointer"
                >
                  {captureMode === 'video' ? <Video className="w-4 h-4" /> : <Camera className="w-4 h-4" />}
                  <span>
                    {captureMode === 'video' ? 'Gravar com Câmera do Celular' : 'Abrir Câmera do Celular'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenGallery();
                  }}
                  className="min-h-[42px] px-4 rounded-2xl bg-[#131b2e] border border-white/15 text-slate-200 font-semibold text-xs flex items-center justify-center gap-2 cursor-pointer"
                >
                  <ImagePlus className="w-4 h-4 text-sky-300" />
                  <span>Escolher Foto ou Vídeo da Galeria</span>
                </button>
              </div>
            </div>
          ) : (
            <>
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                className={`w-full h-full object-cover ${
                  facingMode === 'user' ? '-scale-x-100' : ''
                }`}
              />
              {isRecording && (
                <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-rose-600/90 text-white text-xs font-bold flex items-center gap-1.5 shadow-lg">
                  <span className="w-2 h-2 rounded-full bg-white animate-ping" />
                  <span className="tabular-nums">
                    REC 00:{String(recordSeconds).padStart(2, '0')} / 00:{MAX_VIDEO_SECONDS}
                  </span>
                </div>
              )}
              {isStarting && (
                <div className="absolute inset-0 bg-[#090d16]/75 flex flex-col items-center justify-center gap-2 text-xs text-sky-200">
                  <Camera className="w-6 h-6 animate-pulse text-sky-400" />
                  <span>Ligando câmera...</span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Bottom Action Bar */}
        <div className="p-3.5 bg-[#090d16] border-t border-white/10">
          {recordedVideo ? (
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setRecordedVideo(null)}
                className="min-h-[44px] px-3 rounded-2xl bg-[#131b2e] border border-white/10 text-slate-200 hover:text-white text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Gravar Outro</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const vid = recordedVideo;
                    onAttachVideo(vid);
                    onClose();
                  }}
                  className="min-h-[44px] px-3 rounded-2xl bg-[#131b2e] border border-sky-400/35 text-sky-200 hover:bg-sky-500/15 text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Check className="w-4 h-4" />
                  <span>Anexar</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const vid = recordedVideo;
                    onSendVideoNow(vid);
                    onClose();
                  }}
                  className="min-h-[44px] px-4 rounded-2xl bg-gradient-to-r from-sky-400 to-purple-500 text-slate-950 font-bold text-xs flex items-center justify-center gap-1.5 shadow-lg shadow-sky-500/25 cursor-pointer"
                >
                  <Send className="w-4 h-4" />
                  <span>Enviar Vídeo</span>
                </button>
              </div>
            </div>
          ) : capturedUrl ? (
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setCapturedUrl(null)}
                className="min-h-[44px] px-3 rounded-2xl bg-[#131b2e] border border-white/10 text-slate-200 hover:text-white text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Tirar Outra</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const url = capturedUrl;
                    onAttachPhoto(url);
                    onClose();
                  }}
                  className="min-h-[44px] px-3 rounded-2xl bg-[#131b2e] border border-sky-400/35 text-sky-200 hover:bg-sky-500/15 text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Check className="w-4 h-4" />
                  <span>Anexar</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const url = capturedUrl;
                    onSendPhotoNow(url);
                    onClose();
                  }}
                  className="min-h-[44px] px-4 rounded-2xl bg-gradient-to-r from-sky-400 to-purple-500 text-slate-950 font-bold text-xs flex items-center justify-center gap-1.5 shadow-lg shadow-sky-500/25 cursor-pointer"
                >
                  <Send className="w-4 h-4" />
                  <span>Enviar Agora ✨</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                disabled={isRecording}
                onClick={() =>
                  setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'))
                }
                className="min-h-[44px] px-3 rounded-2xl bg-[#131b2e] border border-white/10 text-slate-200 hover:text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
                title="Alternar entre câmera traseira e frontal"
              >
                <RefreshCw className="w-4 h-4 text-sky-300" />
                <span>{facingMode === 'environment' ? 'Traseira' : 'Frontal'}</span>
              </button>

              {captureMode === 'video' ? (
                <button
                  type="button"
                  disabled={isStarting || Boolean(cameraError)}
                  onClick={isRecording ? handleStopRecording : handleStartRecording}
                  className={`w-16 h-16 rounded-full disabled:opacity-40 border-4 flex items-center justify-center cursor-pointer transition-transform active:scale-95 ${
                    isRecording
                      ? 'bg-rose-600 border-rose-300 shadow-lg shadow-rose-500/40 animate-pulse'
                      : 'bg-white hover:bg-purple-100 border-purple-400 shadow-lg shadow-purple-500/30'
                  }`}
                  aria-label={isRecording ? 'Parar gravação' : 'Gravar vídeo'}
                  title={isRecording ? 'Parar gravação' : 'Gravar vídeo'}
                >
                  {isRecording ? (
                    <Square className="w-6 h-6 text-white fill-white" />
                  ) : (
                    <span className="w-11 h-11 rounded-full bg-gradient-to-br from-rose-500 to-purple-600 flex items-center justify-center text-white">
                      <Video className="w-5 h-5" />
                    </span>
                  )}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={isStarting || Boolean(cameraError)}
                  onClick={handleCapturePhoto}
                  className="w-16 h-16 rounded-full bg-white hover:bg-sky-100 disabled:opacity-40 border-4 border-sky-400 shadow-lg shadow-sky-500/30 flex items-center justify-center cursor-pointer transition-transform active:scale-95"
                  aria-label="Tirar foto agora"
                  title="Tirar foto"
                >
                  <span className="w-11 h-11 rounded-full bg-gradient-to-br from-sky-400 to-purple-500 flex items-center justify-center text-slate-950">
                    <Camera className="w-5 h-5" />
                  </span>
                </button>
              )}

              <button
                type="button"
                disabled={isRecording}
                onClick={() => nativeCameraInputRef.current?.click()}
                className="min-h-[44px] px-3 rounded-2xl bg-[#131b2e] border border-white/10 text-slate-200 hover:text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
                title="Abrir aplicativo nativo da câmera do celular"
              >
                <ImagePlus className="w-4 h-4 text-purple-300" />
                <span>Nativa</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
