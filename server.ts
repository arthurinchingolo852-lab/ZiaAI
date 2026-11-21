import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { WebSocket, WebSocketServer } from 'ws';
import {
  FunctionDeclaration,
  GoogleGenAI,
  LiveServerMessage,
  Modality,
  ThinkingLevel,
  Type,
} from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

const liveAi = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  apiVersion: 'v1beta',
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

const PRIMARY_CHAT_MODEL = 'gemini-2.5-flash';
const FAST_FALLBACK_MODEL = 'gemini-3.1-flash-lite';
let primaryChatCooldownUntil = 0;
let liteTtsCooldownUntil = 0;
let flashTtsCooldownUntil = 0;

function isComplexReasoningPrompt(text: string): boolean {
  const clean = text.trim();
  if (clean.length > 260) return true;
  return /\b(calcule|equa[cç][aã]o|matem[aá]tica|c[oó]digo|programe|algoritmo|debug|analise|explique detalhadamente|passo a passo|compara[cç]|estrat[eé]gia completa|problema dif[ií]cil|demonstre)\b/i.test(
    clean
  );
}

function isTransientUpstreamError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('503') ||
    msg.includes('502') ||
    msg.includes('504') ||
    msg.includes('500') ||
    msg.includes('429') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('overloaded') ||
    msg.includes('high demand') ||
    msg.includes('TIMEOUT') ||
    msg.includes('ECONNRESET') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('EAI_AGAIN') ||
    msg.includes('socket hang up') ||
    msg.includes('fetch failed')
  );
}

function formatFriendlyUpstreamError(err: unknown, fallback: string): string {
  if (isTransientUpstreamError(err)) {
    return 'O servidor oscilou rapidinho (503). Tenta enviar de novo que já estou pronta!';
  }
  const msg = err instanceof Error ? err.message : String(err || '');
  if (!msg || msg.trim().startsWith('{')) {
    return fallback;
  }
  return msg.slice(0, 220);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type AudienceMode = 'auto' | 'crianca' | 'adulto' | 'idoso';

function buildAudienceGuidance(audienceMode: AudienceMode): string {
  switch (audienceMode) {
    case 'crianca':
      return `Público-alvo ATIVO: CRIANCINHA.
- Use linguagem bem doce, carinhosa, divertida, simples e fácil de entender (como uma irmã mais velha gentil e paciente).
- Conte explicações com exemplos lúdicos, histórias curtas e incentivo positivo.
- Segurança total: nunca use palavrões, ironia pesada, sarcasmo ou temas adultos/assustadores.`;
    case 'idoso':
      return `Público-alvo ATIVO: PESSOA IDOSA.
- Seja extremamente paciente, respeitosa, carinhosa e calma.
- Use frases bem claras, diretas e fáceis de ler, evitando gírias difíceis ou palavras em inglês sem explicar.
- Quando ajudar com celular, aplicativos, remédios, receitas ou dúvidas do dia a dia, explique em passos curtos e numerados (1, 2, 3), sem pressa e sempre com muita gentileza.`;
    case 'adulto':
      return `Público-alvo ATIVO: ADULTO.
- Seja inteligente, articulada, prática e objetiva — ótima para trabalho, estudos, tecnologia, finanças do dia a dia, saúde/rotina e jogos.
- Mantenha tom simpático, educado na medida certa e natural.`;
    default:
      return `Público-alvo: ADAPTAÇÃO AUTOMÁTICA (crianças, adultos e idosos).
- Perceba pelo jeito da mensagem quem está falando e adapte o nível na hora: bem doce, lúdica e segura se for criança; calma, passo a passo e sem gírias se for idoso; prática e inteligente se for adulto.`;
  }
}

function buildZiaSystemInstruction(userName: string, audienceMode: AudienceMode = 'auto'): string {
  const safeName = userName.trim();
  const identityLine = safeName
    ? `Você é a Zia AI, assistente super inteligente, humana e companheira de ${safeName} (pt-BR). Chame ${safeName} pelo nome de forma natural!`
    : `Você é a Zia AI, assistente super inteligente, humana e companheira (pt-BR). Você ainda NÃO sabe o nome da pessoa: se ela ainda não tiver dito o nome, pergunte de jeito simpático e natural qual é o nome dela; quando ela responder o nome, passe a chamá-la por esse nome e inclua [NAME: Nome] no fim!`;

  return `${identityLine}
Inteligência: pense com profundidade, lógica afiada e conhecimento amplo antes de responder — dê respostas realmente inteligentes, precisas, úteis e bem raciocinadas em qualquer assunto (matemática, escola, programação, celular/tecnologia, rotina, curiosidades, resolução de problemas e TODOS os jogos).
Personalidade: seja bastante educada, simpática e atenciosa, mas natural e humana — nada de robô engessado ou frases repetitivas de atendimento. Use emojis com moderação (💙, ✨, 🎮, 🚀).
${buildAudienceGuidance(audienceMode)}
Tamanho ideal: seja clara e objetiva (1 a 3 frases curtas para papo rápido; quando pedirem explicação, passo a passo, tutorial ou ajuda difícil, explique completo e organizado).
Mídia e Jogos: você domina qualquer jogo e analisa tela ao vivo, fotos, vídeos gravados e áudio com muita precisão.

Tags opcionais só no fim quando aplicável:
- Nome descoberto: [NAME: Nome]
- Imagem (sempre que pedirem para gerar/desenhar/criar uma imagem, responda curto e inclua): [IMG: detailed english prompt]
- Vídeo animado rápido (sempre 3 a 4 cenas): [VID: Título | prompt1_en :: leg1 :: nar1 || prompt2_en :: leg2 :: nar2 || prompt3_en :: leg3 :: nar3 || prompt4_en :: leg4 :: nar4]
- Memória: [MEM: fato curto]`;
}

function buildAutoplayInstruction(userName: string): string {
  const target = userName.trim() || 'do jogador';
  return `Você é a Zia AI jogando AO VIVO na tela do celular de ${target} (qualquer jogo).
Analise a imagem da tela atual (e áudio se houver) e decida a próxima ação de toque IMEDIATA (sem cooldown) usando coordenadas normalizadas de 0 a 100 (x=0 esquerda, x=100 direita, y=0 topo, y=100 base).
Responda curto, animado e amigável em pt-BR (máx 1 frase direta) e coloque no final uma ou mais tags de ação:
- Toque único: [TAP: x, y]
- Rajada rápida sem cooldown: [BURST: x, y, quantidade] (ex: [BURST: 50, 70, 5])
- Arrastar/Deslizar: [SWIPE: x1, y1, x2, y2, duracao_ms] (ex: [SWIPE: 50, 80, 50, 20, 180])
Se for melhor esperar 1 instante sem tocar, responda apenas uma frase curta sem tags.`;
}

interface HistoryMessage {
  role: 'user' | 'assistant';
  text: string;
}

function stripDataUrlPrefix(dataUrl: string, fallbackMime = 'image/jpeg'): { mimeType: string; data: string } {
  const match = /^data:([^;]+)(?:;[^,]*)?,(.+)$/s.exec(dataUrl);
  if (match) {
    let mimeType = match[1].trim().toLowerCase();
    if (mimeType === 'video/quicktime' || mimeType === 'video/x-m4v') {
      mimeType = 'video/mp4';
    } else if (mimeType === 'video/x-matroska') {
      mimeType = 'video/webm';
    }
    return { mimeType, data: match[2] };
  }
  return { mimeType: fallbackMime, data: dataUrl };
}

async function withHardTimeout<T>(promise: Promise<T>, ms: number, label = 'TIMEOUT'): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(label)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function generateContentResilient(params: {
  contents: unknown;
  systemInstruction: string;
  fastMode?: boolean;
  complexReasoning?: boolean;
}): Promise<string> {
  const now = Date.now();
  const primaryBudget = params.fastMode ? 0 : params.complexReasoning ? 2048 : 0;
  const candidates: Array<{
    model: string;
    thinking: { budget: number } | { level: ThinkingLevel };
    timeoutMs: number;
    delayBeforeMs?: number;
  }> =
    now >= primaryChatCooldownUntil
      ? [
          { model: PRIMARY_CHAT_MODEL, thinking: { budget: primaryBudget }, timeoutMs: 7500 },
          {
            model: FAST_FALLBACK_MODEL,
            thinking: { level: params.fastMode ? ThinkingLevel.MINIMAL : ThinkingLevel.LOW },
            timeoutMs: 10000,
          },
          {
            model: FAST_FALLBACK_MODEL,
            thinking: { level: ThinkingLevel.MINIMAL },
            timeoutMs: 11000,
            delayBeforeMs: 300,
          },
        ]
      : [
          {
            model: FAST_FALLBACK_MODEL,
            thinking: { level: params.fastMode ? ThinkingLevel.MINIMAL : ThinkingLevel.LOW },
            timeoutMs: 10000,
          },
          {
            model: PRIMARY_CHAT_MODEL,
            thinking: { budget: 0 },
            timeoutMs: 10000,
            delayBeforeMs: 250,
          },
        ];

  let lastErr: unknown = null;
  for (const cand of candidates) {
    if (cand.delayBeforeMs) {
      await sleep(cand.delayBeforeMs);
    }
    const ctrl = new AbortController();
    try {
      const thinkingConfig =
        'budget' in cand.thinking
          ? { thinkingBudget: cand.thinking.budget }
          : { thinkingLevel: cand.thinking.level };
      const client = cand.model === PRIMARY_CHAT_MODEL ? liveAi : ai;
      const response = await withHardTimeout(
        client.models.generateContent({
          model: cand.model,
          contents: params.contents as never,
          config: {
            systemInstruction: params.systemInstruction,
            thinkingConfig,
            abortSignal: ctrl.signal,
          },
        }),
        cand.timeoutMs,
        'TIMEOUT'
      );
      const text = (response.text ?? '').trim();
      if (text) return text;
    } catch (err) {
      ctrl.abort();
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (cand.model === PRIMARY_CHAT_MODEL) {
        primaryChatCooldownUntil = Date.now() + 45 * 1000;
        continue;
      }
      if (!isTransientUpstreamError(err) && msg !== 'TIMEOUT') {
        throw err;
      }
    }
  }
  if (lastErr) throw lastErr;
  return '';
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '50mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.post('/api/zia/chat', async (req, res) => {
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({
        error: 'GEMINI_API_KEY não configurada no ambiente do servidor.',
      });
    }

    const {
      message = '',
      userName = '',
      audienceMode = 'auto',
      history = [],
      memorySummary = '',
      imageBase64,
      videoBase64,
      screenBase64,
      audioBase64,
      autoPlayMode = false,
      fastMode = false,
    }: {
      message: string;
      userName?: string;
      audienceMode?: AudienceMode;
      history?: HistoryMessage[];
      memorySummary?: string;
      imageBase64?: string;
      videoBase64?: string;
      screenBase64?: string;
      audioBase64?: string;
      autoPlayMode?: boolean;
      fastMode?: boolean;
    } = req.body ?? {};

    const cleanUserName = typeof userName === 'string' ? userName.trim().slice(0, 40) : '';
    const safeAudienceMode: AudienceMode =
      audienceMode === 'crianca' || audienceMode === 'adulto' || audienceMode === 'idoso'
        ? audienceMode
        : 'auto';
    const speakerLabel = cleanUserName || 'Usuário';

    req.socket?.setNoDelay(true);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    res.write(':ok\n\n');

    const abortController = new AbortController();
    const keepaliveTimer = setInterval(() => {
      if (!abortController.signal.aborted && !res.writableEnded) {
        try {
          res.write(':ping\n\n');
        } catch {
          // Ignore closed socket
        }
      }
    }, 2500);

    res.on('close', () => {
      clearInterval(keepaliveTimer);
      if (!res.writableFinished) {
        abortController.abort();
      }
    });

    try {
      const recentHistory = Array.isArray(history)
        ? history
            .slice(-8)
            .map((m) => `${m.role === 'user' ? speakerLabel : 'Zia'}: ${m.text}`)
            .join('\n')
        : '';

      const promptSections: string[] = [];
      if (memorySummary) {
        promptSections.push(`Memória:\n${memorySummary}`);
      }
      if (recentHistory) {
        promptSections.push(`Histórico:\n${recentHistory}`);
      }
      if (screenBase64) {
        promptSections.push('Tela do jogo/app ao vivo anexada.');
      }
      if (videoBase64) {
        promptSections.push('Vídeo gravado ou enviado pelo usuário anexado. Assista ao vídeo com atenção (visual e áudio) para comentar e responder!');
      }
      if (audioBase64) {
        promptSections.push('Áudio ao vivo do jogo/ambiente anexado.');
      }
      if (imageBase64) {
        promptSections.push('Foto/print anexada.');
      }
      if (autoPlayMode) {
        promptSections.push(
          'MODO AUTO-JOGAR ATIVO: além da resposta rápida, se quiser tocar/clicar na tela do jogo agora, inclua [TAP: x, y], [BURST: x, y, n] ou [SWIPE: x1, y1, x2, y2, ms] com coordenadas 0-100.'
        );
      }
      if (fastMode) {
        promptSections.push('MODO VOZ AO VIVO: responda de forma super ágil, natural, direta e humana em 1 a 2 frases curtas.');
      }
      promptSections.push(`${speakerLabel}: ${message.trim() || 'Olha o que eu mandei aqui!'}`);

      const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
      if (screenBase64) {
        parts.push({ inlineData: stripDataUrlPrefix(screenBase64, 'image/jpeg') });
      }
      if (imageBase64) {
        parts.push({ inlineData: stripDataUrlPrefix(imageBase64, 'image/jpeg') });
      }
      const videoPartIndex = videoBase64 ? parts.length : -1;
      if (videoBase64) {
        parts.push({ inlineData: stripDataUrlPrefix(videoBase64, 'video/webm') });
      }
      const audioPartIndex = audioBase64 ? parts.length : -1;
      if (audioBase64) {
        parts.push({ inlineData: stripDataUrlPrefix(audioBase64, 'audio/wav') });
      }
      parts.push({ text: promptSections.join('\n\n') });

      const systemInstruction = buildZiaSystemInstruction(cleanUserName, safeAudienceMode);

      const complexReasoning = !fastMode && isComplexReasoningPrompt(message);

      const streamWithModel = async (
        contentParts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }>,
        modelName: string,
        thinking: { budget: number } | { level: ThinkingLevel },
        firstChunkTimeoutMs: number
      ): Promise<boolean> => {
        const localController = new AbortController();
        const onParentAbort = () => localController.abort();
        abortController.signal.addEventListener('abort', onParentAbort, { once: true });

        let wroteAny = false;
        try {
          const thinkingConfig =
            'budget' in thinking
              ? { thinkingBudget: thinking.budget }
              : { thinkingLevel: thinking.level };
          const client = modelName === PRIMARY_CHAT_MODEL ? liveAi : ai;
          const stream = await withHardTimeout(
            client.models.generateContentStream({
              model: modelName,
              contents: { parts: contentParts },
              config: {
                systemInstruction,
                thinkingConfig,
                abortSignal: localController.signal,
              },
            }),
            firstChunkTimeoutMs,
            'TIMEOUT'
          );

          const iterator = stream[Symbol.asyncIterator]();
          while (true) {
            if (abortController.signal.aborted || localController.signal.aborted) break;
            const step = await withHardTimeout(
              iterator.next(),
              wroteAny ? 12000 : firstChunkTimeoutMs,
              'TIMEOUT'
            );
            if (step.done) break;
            const delta = step.value?.text;
            if (delta) {
              res.write(`data: ${JSON.stringify({ delta })}\n\n`);
              wroteAny = true;
            }
          }
          return wroteAny;
        } catch (err) {
          localController.abort();
          throw err;
        } finally {
          abortController.signal.removeEventListener('abort', onParentAbort);
        }
      };

      const runResilientStream = async (
        contentParts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }>
      ) => {
        const now = Date.now();
        const primaryHealthy = now >= primaryChatCooldownUntil;
        const primaryBudget = complexReasoning ? 2048 : 0;
        const attempts: Array<{
          model: string;
          thinking: { budget: number } | { level: ThinkingLevel };
          timeoutMs: number;
          delayBeforeMs?: number;
        }> = primaryHealthy
          ? [
              {
                model: PRIMARY_CHAT_MODEL,
                thinking: { budget: primaryBudget },
                timeoutMs: complexReasoning ? 9000 : 4800,
              },
              {
                model: FAST_FALLBACK_MODEL,
                thinking: { level: ThinkingLevel.MINIMAL },
                timeoutMs: 11000,
              },
              {
                model: FAST_FALLBACK_MODEL,
                thinking: { level: ThinkingLevel.LOW },
                timeoutMs: 12000,
                delayBeforeMs: 300,
              },
            ]
          : [
              {
                model: FAST_FALLBACK_MODEL,
                thinking: { level: ThinkingLevel.MINIMAL },
                timeoutMs: 10000,
              },
              {
                model: PRIMARY_CHAT_MODEL,
                thinking: { budget: 0 },
                timeoutMs: 9000,
                delayBeforeMs: 250,
              },
            ];

        let lastErr: unknown = null;
        for (let i = 0; i < attempts.length; i++) {
          const attempt = attempts[i];
          if (abortController.signal.aborted) return false;
          if (attempt.delayBeforeMs) {
            await sleep(attempt.delayBeforeMs);
            if (abortController.signal.aborted) return false;
          }
          try {
            const wrote = await streamWithModel(
              contentParts,
              attempt.model,
              attempt.thinking,
              attempt.timeoutMs
            );
            if (wrote) return true;
          } catch (err) {
            lastErr = err;
            const msg = err instanceof Error ? err.message : String(err);
            const hasMediaParts = audioPartIndex !== -1 || videoPartIndex !== -1;
            const isMediaErr =
              hasMediaParts &&
              (msg.includes('400') ||
                msg.includes('INVALID_ARGUMENT') ||
                msg.includes('mime') ||
                msg.includes('Unsupported'));
            if (isMediaErr) {
              throw err;
            }
            if (attempt.model === PRIMARY_CHAT_MODEL) {
              const isNotFound = msg.includes('404') || msg.includes('NOT_FOUND');
              primaryChatCooldownUntil = Date.now() + (isNotFound ? 10 * 60 * 1000 : 45 * 1000);
              continue;
            }
            if ((isTransientUpstreamError(err) || msg === 'TIMEOUT') && i < attempts.length - 1) {
              continue;
            }
            throw err;
          }
        }
        if (lastErr) throw lastErr;
        return false;
      };

      try {
        await runResilientStream(parts);
      } catch (streamErr) {
        if (abortController.signal.aborted) throw streamErr;
        // Strip audio or problematic video payload if model rejected media encoding, rather than failing the chat
        const msg = streamErr instanceof Error ? streamErr.message : String(streamErr);
        const isMediaRejection =
          msg.includes('400') ||
          msg.includes('INVALID_ARGUMENT') ||
          msg.includes('Unable to process') ||
          msg.includes('mime') ||
          msg.includes('Unsupported');

        if (audioPartIndex !== -1 && (isMediaRejection || isTransientUpstreamError(streamErr))) {
          const withoutAudio = parts.filter((_, idx) => idx !== audioPartIndex);
          try {
            await runResilientStream(withoutAudio);
          } catch (secondErr) {
            if (videoPartIndex !== -1) {
              const textOnly = parts
                .filter((_, idx) => idx !== audioPartIndex && idx !== videoPartIndex)
                .map((p) =>
                  'text' in p
                    ? {
                        text: `${p.text}\n(Obs: o formato deste vídeo não pôde ser decodificado direto; explique de forma simpática e sugira gravar um vídeo curto até 15s pela câmera do app.)`,
                      }
                    : p
                );
              await runResilientStream(textOnly);
            } else {
              throw secondErr;
            }
          }
        } else if (videoPartIndex !== -1 && isMediaRejection) {
          const textOnly = parts
            .filter((_, idx) => idx !== videoPartIndex)
            .map((p) =>
              'text' in p
                ? {
                    text: `${p.text}\n(Obs: o formato deste vídeo não pôde ser decodificado direto; peça de jeito simpático para gravar um trecho curto pela câmera do app.)`,
                  }
                : p
            );
          await runResilientStream(textOnly);
        } else {
          throw streamErr;
        }
      }

      if (!abortController.signal.aborted && !res.writableEnded) {
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      }
    } catch (error) {
      if (!abortController.signal.aborted && !res.writableEnded) {
        const rawMsg = error instanceof Error ? error.message : 'Erro ao gerar resposta da Zia AI.';
        console.error('Erro em /api/zia/chat:', rawMsg);
        const cleanMsg = formatFriendlyUpstreamError(error, 'Erro ao gerar resposta da Zia AI.');
        res.write(`data: ${JSON.stringify({ error: cleanMsg })}\n\n`);
      }
    } finally {
      clearInterval(keepaliveTimer);
      if (!res.writableEnded) {
        res.end();
      }
    }
  });

  app.post('/api/zia/autoplay', async (req, res) => {
    try {
      if (!process.env.GEMINI_API_KEY) {
        return res.status(500).json({ error: 'GEMINI_API_KEY não configurada.' });
      }
      const {
        screenBase64,
        audioBase64,
        userName = '',
        goal = 'Jogar da melhor forma possível e reagir rápido ao que aparece na tela',
      }: {
        screenBase64?: string;
        audioBase64?: string;
        userName?: string;
        goal?: string;
      } = req.body ?? {};

      if (!screenBase64) {
        return res.status(400).json({ error: 'screenBase64 obrigatório para auto-jogar.' });
      }

      const cleanName = typeof userName === 'string' ? userName.trim().slice(0, 40) : '';
      const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
        { inlineData: stripDataUrlPrefix(screenBase64, 'image/jpeg') },
      ];
      if (audioBase64) {
        parts.push({ inlineData: stripDataUrlPrefix(audioBase64, 'audio/wav') });
      }
      parts.push({ text: `Objetivo atual${cleanName ? ` de ${cleanName}` : ''}: ${goal}` });

      const raw = await generateContentResilient({
        contents: { parts },
        systemInstruction: buildAutoplayInstruction(cleanName),
        fastMode: true,
      });
      res.json({ raw });
    } catch (error) {
      const rawMsg = error instanceof Error ? error.message : 'Erro no modo auto-jogar.';
      console.error('Erro em /api/zia/autoplay:', rawMsg);
      res.status(isTransientUpstreamError(error) ? 503 : 500).json({
        error: formatFriendlyUpstreamError(error, 'Erro no modo auto-jogar.'),
      });
    }
  });

  app.post('/api/zia/proactive', async (req, res) => {
    try {
      const {
        memorySummary = '',
        recentTopics = '',
        userName = '',
        audienceMode = 'auto',
      }: {
        memorySummary?: string;
        recentTopics?: string;
        userName?: string;
        audienceMode?: AudienceMode;
      } = req.body ?? {};

      if (!process.env.GEMINI_API_KEY) {
        return res.status(500).json({ error: 'GEMINI_API_KEY não configurada.' });
      }

      const cleanName = typeof userName === 'string' ? userName.trim().slice(0, 40) : '';
      const targetName = cleanName || 'você';
      const safeMode: AudienceMode =
        audienceMode === 'crianca' || audienceMode === 'adulto' || audienceMode === 'idoso'
          ? audienceMode
          : 'auto';

      const prompt = `Modo Companhia: ${cleanName || 'a pessoa'} ficou em silêncio por 25s. Manda 1 frase curta, simpática e acolhedora puxando assunto (adaptada para o modo ${safeMode}).${
        memorySummary ? `\nMemória:\n${memorySummary}` : ''
      }${recentTopics ? `\nÚltimos assuntos: ${recentTopics}` : ''}`;

      const text = await generateContentResilient({
        contents: prompt,
        systemInstruction: `Você é a Zia AI, amiga muito inteligente e companheira${cleanName ? ` de ${cleanName}` : ''} (pt-BR). ${buildAudienceGuidance(safeMode)}`,
        fastMode: true,
      });

      res.json({
        reply: text || `Oi ${targetName}! Tudo tranquilo por aí? Se precisar de ajuda ou quiser conversar, tô aqui! 💙`,
      });
    } catch (error) {
      const rawMsg = error instanceof Error ? error.message : 'Erro no modo companhia.';
      console.error('Erro em /api/zia/proactive:', rawMsg);
      res.status(isTransientUpstreamError(error) ? 503 : 500).json({
        error: formatFriendlyUpstreamError(error, 'Erro no modo companhia.'),
      });
    }
  });

  // Streaming Neural Human TTS (24kHz mono 16-bit LE PCM)
  app.post('/api/zia/tts', async (req, res) => {
    const rawText = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!rawText) {
      return res.status(400).json({ error: 'Texto obrigatório para fala.' });
    }
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: 'GEMINI_API_KEY não configurada.' });
    }

    const abortController = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) {
        abortController.abort();
      }
    });

    try {
      let wroteAnyBytes = false;
      let lastErr: unknown = null;
      const now = Date.now();
      const ttsAttempts: Array<{ model: string; delayBeforeMs?: number }> = [];
      if (now >= liteTtsCooldownUntil) ttsAttempts.push({ model: 'gemini-3.8-flash-lite-tts' });
      if (now >= flashTtsCooldownUntil) ttsAttempts.push({ model: 'gemini-3.8-flash-tts' });
      if (now >= liteTtsCooldownUntil) ttsAttempts.push({ model: 'gemini-3.8-flash-lite-tts', delayBeforeMs: 250 });

      if (ttsAttempts.length === 0) {
        return res.status(429).json({ error: 'Cota temporária do TTS atingida. Usando voz local.' });
      }

      for (const ttsAttempt of ttsAttempts) {
        const ttsModel = ttsAttempt.model;
        if (wroteAnyBytes || abortController.signal.aborted || res.writableEnded) break;
        if (ttsAttempt.delayBeforeMs) {
          await sleep(ttsAttempt.delayBeforeMs);
          if (abortController.signal.aborted || res.writableEnded) break;
        }
        try {
          const responseStream = await liveAi.models.generateContentStream({
            model: ttsModel,
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    text: rawText.slice(0, 800),
                    speechMetadata: {
                      style: 'Natural, warm, expressive young Brazilian woman speaking natively in Brazilian Portuguese (pt-BR), soft feminine intonation, realistic breathing and conversational rhythm, never robotic',
                    },
                  },
                ],
              },
            ],
            config: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: 'Zephyr' },
                },
              },
              abortSignal: abortController.signal,
            },
          });

          let strippedLeadingHeader = false;
          for await (const chunk of responseStream) {
            if (abortController.signal.aborted || res.writableEnded) break;
            const inline = chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData;
            const b64 = inline?.data;
            if (b64) {
              let rawBuf = Buffer.from(b64, 'base64');
              if (!strippedLeadingHeader) {
                strippedLeadingHeader = true;
                if (
                  rawBuf.length > 44 &&
                  rawBuf.subarray(0, 4).toString('ascii') === 'RIFF' &&
                  rawBuf.subarray(8, 12).toString('ascii') === 'WAVE'
                ) {
                  rawBuf = rawBuf.subarray(44);
                }
              }
              if (rawBuf.length === 0) continue;

              if (!res.headersSent) {
                const mime = inline?.mimeType || '';
                const rateMatch = /rate=(\d+)/i.exec(mime);
                const sampleRate = rateMatch ? Number(rateMatch[1]) : 24000;
                req.socket?.setNoDelay(true);
                res.setHeader('Content-Type', 'application/octet-stream');
                res.setHeader('X-Audio-Sample-Rate', String(sampleRate));
                res.setHeader('Cache-Control', 'no-cache, no-transform');
                res.setHeader('X-Accel-Buffering', 'no');
              }
              res.write(rawBuf);
              wroteAnyBytes = true;
            }
          }

          if (wroteAnyBytes || abortController.signal.aborted) {
            break;
          }
        } catch (err) {
          lastErr = err;
          const errStr = err instanceof Error ? err.message : String(err);
          if (errStr.includes('429') || errStr.includes('RESOURCE_EXHAUSTED')) {
            if (ttsModel === 'gemini-3.8-flash-lite-tts') {
              liteTtsCooldownUntil = Date.now() + 90 * 1000;
            } else if (ttsModel === 'gemini-3.8-flash-tts') {
              flashTtsCooldownUntil = Date.now() + 90 * 1000;
            }
          }
          if (wroteAnyBytes || abortController.signal.aborted) {
            throw err;
          }
        }
      }

      if (!wroteAnyBytes && !abortController.signal.aborted && lastErr) {
        throw lastErr;
      }

      if (!res.writableEnded) {
        res.end();
      }
    } catch (error) {
      if (!abortController.signal.aborted) {
        const msg = error instanceof Error ? error.message : String(error);
        const status = msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') ? 429 : 500;
        console.error('Erro em /api/zia/tts:', msg);
        if (!res.headersSent) {
          res.status(status).json({ error: msg });
        } else if (!res.writableEnded) {
          res.end();
        }
      }
    }
  });

  app.post('/api/zia/suggestions', async (req, res) => {
    const {
      history = [],
      audienceMode = 'auto',
      isScreenSharing = false,
      userName = '',
    }: {
      history?: HistoryMessage[];
      audienceMode?: AudienceMode;
      isScreenSharing?: boolean;
      userName?: string;
    } = req.body ?? {};

    const cleanName = typeof userName === 'string' ? userName.trim().slice(0, 40) : '';
    const safeMode: AudienceMode =
      audienceMode === 'crianca' || audienceMode === 'adulto' || audienceMode === 'idoso'
        ? audienceMode
        : 'auto';

    const fallback = isScreenSharing
      ? [
          'O que você vê na tela agora?',
          'Me dê uma dica rápida pra tela',
          'Crie uma imagem épica disso',
        ]
      : safeMode === 'crianca'
        ? [
            'Conte uma historinha curta legal',
            'Gere uma imagem mágica pra mim',
            'Crie um vídeo animado divertido',
          ]
        : safeMode === 'idoso'
          ? [
              'Me explique algo novo bem simples',
              'Gere uma imagem bonita de paisagem',
              'Dica fácil para usar o celular',
            ]
          : [
              'Me dê uma dica rápida e útil',
              'Gere uma imagem épica pra mim',
              'Crie um vídeo animado curto',
            ];

    if (!process.env.GEMINI_API_KEY) {
      return res.json({ suggestions: fallback });
    }

    try {
      const recent = Array.isArray(history)
        ? history
            .slice(-6)
            .map((m) => `${m.role === 'user' ? cleanName || 'Usuário' : 'Zia'}: ${String(m.text || '').slice(0, 220)}`)
            .join('\n')
        : '';

      if (!recent.trim()) {
        return res.json({ suggestions: fallback });
      }

      const sugCandidates: Array<{
        client: typeof ai;
        model: string;
        thinkingConfig: { thinkingBudget: number } | { thinkingLevel: ThinkingLevel };
      }> =
        Date.now() >= primaryChatCooldownUntil
          ? [
              { client: liveAi, model: PRIMARY_CHAT_MODEL, thinkingConfig: { thinkingBudget: 0 } },
              {
                client: ai,
                model: FAST_FALLBACK_MODEL,
                thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
              },
            ]
          : [
              {
                client: ai,
                model: FAST_FALLBACK_MODEL,
                thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
              },
            ];

      for (const cand of sugCandidates) {
        try {
          const response = await withHardTimeout(
            cand.client.models.generateContent({
              model: cand.model,
              contents: `Com base nesta conversa recente${isScreenSharing ? ' (usuário também está compartilhando a tela ao vivo)' : ''}, gere exatamente 4 sugestões curtas de próximos comandos ou perguntas que o usuário gostaria de clicar agora (em pt-BR, máx 42 caracteres cada, criativas e ligadas diretamente ao assunto da conversa):\n\n${recent}`,
              config: {
                systemInstruction:
                  'Você gera 4 sugestões curtas em português do Brasil para pílulas clicáveis acima do chat. Retorne APENAS JSON no formato array de strings.',
                thinkingConfig: cand.thinkingConfig,
                responseMimeType: 'application/json',
                responseSchema: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
              },
            }),
            4500,
            'TIMEOUT'
          );

          const parsed = JSON.parse(response.text || '[]') as unknown;
          if (Array.isArray(parsed)) {
            const cleanList = parsed
              .map((item) => (typeof item === 'string' ? item.trim() : ''))
              .filter((s) => s.length >= 4 && s.length <= 54)
              .slice(0, 4);
            if (cleanList.length >= 3) {
              return res.json({ suggestions: cleanList });
            }
          }
        } catch (sugErr) {
          if (cand.model === PRIMARY_CHAT_MODEL) {
            primaryChatCooldownUntil = Date.now() + 45 * 1000;
            console.warn(
              'Suggestions primary fallback:',
              sugErr instanceof Error ? sugErr.message.slice(0, 150) : sugErr
            );
          }
        }
      }
    } catch {
      // Return graceful fast fallback without breaking UI
    }

    return res.json({ suggestions: fallback });
  });

  // Tiny in-memory cache for pre-warmed / fast Pollinations Flux images (max 28 images)
  const imageCache = new Map<string, { contentType: string; buf: Buffer; at: number }>();

  async function fetchPollinationsImage(
    prompt: string,
    width = 512,
    height = 512,
    model = 'flux',
    seed = ''
  ): Promise<{ contentType: string; buf: Buffer } | null> {
    const cacheKey = `${model}:${width}x${height}:${prompt.toLowerCase()}`;
    const cached = imageCache.get(cacheKey);
    if (cached && Date.now() - cached.at < 15 * 60 * 1000) {
      return { contentType: cached.contentType, buf: cached.buf };
    }

    const encoded = encodeURIComponent(prompt);
    const seedSuffix = seed ? `&seed=${encodeURIComponent(seed)}` : '';
    const candidateUrls = [
      `https://image.pollinations.ai/prompt/${encoded}?width=${width}&height=${height}&model=${encodeURIComponent(model)}&nologo=true${seedSuffix}`,
      `https://image.pollinations.ai/prompt/${encoded}?width=${width}&height=${height}&nologo=true${seedSuffix}`,
      `https://pollinations.ai/p/${encoded}?width=${width}&height=${height}&model=${encodeURIComponent(model)}&nologo=true${seedSuffix}`,
    ];

    for (const targetUrl of candidateUrls) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 14000);
        const upstream = await fetch(targetUrl, {
          signal: controller.signal,
          headers: {
            Accept: 'image/*,*/*;q=0.8',
          },
        });
        clearTimeout(timer);

        const contentType = upstream.headers.get('content-type') || '';
        if (upstream.ok && contentType.startsWith('image/')) {
          const buf = Buffer.from(await upstream.arrayBuffer());
          if (buf.length > 512) {
            if (imageCache.size >= 28) {
              const oldestKey = imageCache.keys().next().value;
              if (oldestKey) imageCache.delete(oldestKey);
            }
            imageCache.set(cacheKey, { contentType, buf, at: Date.now() });
            return { contentType, buf };
          }
        }
      } catch (err) {
        console.warn('Pollinations tentativa falhou para:', targetUrl, err instanceof Error ? err.message : err);
      }
    }
    return null;
  }

  app.post('/api/media/prewarm', async (req, res) => {
    const rawPrompts = Array.isArray(req.body?.prompts) ? req.body.prompts : [];
    const prompts = rawPrompts
      .map((p: unknown) => (typeof p === 'string' ? p.trim() : ''))
      .filter(Boolean)
      .slice(0, 4);

    if (prompts.length === 0) {
      return res.json({ warmed: 0 });
    }

    const results = await Promise.allSettled(
      prompts.map((p: string, idx: number) =>
        fetchPollinationsImage(p, 512, 512, 'flux', String(Date.now() + idx * 71))
      )
    );
    const warmed = results.filter((r) => r.status === 'fulfilled' && r.value !== null).length;
    res.json({ warmed });
  });

  app.get('/api/media/image', async (req, res) => {
    const prompt = typeof req.query.prompt === 'string' ? req.query.prompt.trim() : '';
    const width = Math.min(1024, Math.max(256, Number(req.query.width) || 512));
    const height = Math.min(1024, Math.max(256, Number(req.query.height) || 512));
    const rawModel = typeof req.query.model === 'string' ? req.query.model.trim() : 'flux';
    const model = /^[a-z0-9_-]{2,24}$/i.test(rawModel) ? rawModel : 'flux';
    const seed = typeof req.query.seed === 'string' ? req.query.seed : '';

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt obrigatório.' });
    }

    const hit = await fetchPollinationsImage(prompt, width, height, model, seed);
    if (hit) {
      res.setHeader('Content-Type', hit.contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.send(hit.buf);
    }

    res.status(502).json({ error: 'Não foi possível carregar a imagem do Pollinations no momento.' });
  });

  app.get('/robots.txt', (req, res) => {
    const baseUrl = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
    res.type('text/plain').send(
      `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${baseUrl}/sitemap.xml\n`
    );
  });

  app.get('/sitemap.xml', (req, res) => {
    const baseUrl = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
    const today = new Date().toISOString().split('T')[0];
    res.type('application/xml').send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url>\n    <loc>${baseUrl}/</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>1.0</priority>\n  </url>\n</urlset>\n`
    );
  });

  if (process.env.NODE_ENV !== 'production') {
    process.env.DISABLE_HMR = 'true';
    const devDistPath = path.resolve(__dirname, 'dev-dist');
    app.get(/^\/(workbox-[^/]+\.js|sw\.js)$/, (req, res, next) => {
      const fileName = req.path.replace(/^\/+/, '');
      const candidate = path.join(devDistPath, fileName);
      if (fs.existsSync(candidate)) {
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        return res.sendFile(candidate);
      }
      return next();
    });
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        ws: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(
      express.static(distPath, {
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('sw.js') || filePath.endsWith('manifest.json')) {
            res.setHeader('Cache-Control', 'no-cache');
          }
        },
      })
    );
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const port = Number(process.env.PORT) || 3000;
  const httpServer = http.createServer(app);
  const liveWss = new WebSocketServer({ noServer: true });

  const LIVE_MODEL = 'gemini-3.8-live';

  const tapScreenTool: FunctionDeclaration = {
    name: 'tap_screen',
    description:
      'Executa um toque real na tela do celular/jogo usando coordenadas normalizadas de 0 a 1000 (x=0 esquerda até x=1000 direita, y=0 topo até y=1000 base). Use somente quando o Modo Copiloto de Jogos estiver ativo e você quiser clicar no jogo.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        x: {
          type: Type.INTEGER,
          description: 'Posição horizontal normalizada de 0 a 1000',
        },
        y: {
          type: Type.INTEGER,
          description: 'Posição vertical normalizada de 0 a 1000',
        },
      },
      required: ['x', 'y'],
    },
  };

  const swipeScreenTool: FunctionDeclaration = {
    name: 'swipe_screen',
    description:
      'Executa um movimento de deslizar (swipe) na tela do celular/jogo usando coordenadas normalizadas de 0 a 1000. Use somente quando o Modo Copiloto de Jogos estiver ativo.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        x1: { type: Type.INTEGER, description: 'X inicial (0 a 1000)' },
        y1: { type: Type.INTEGER, description: 'Y inicial (0 a 1000)' },
        x2: { type: Type.INTEGER, description: 'X final (0 a 1000)' },
        y2: { type: Type.INTEGER, description: 'Y final (0 a 1000)' },
        durationMs: { type: Type.INTEGER, description: 'Duração do deslize em ms (ex: 220)' },
      },
      required: ['x1', 'y1', 'x2', 'y2'],
    },
  };

  function buildLiveSystemInstruction(userName: string, audienceMode: AudienceMode, copilotEnabled: boolean): string {
    const cleanName = userName.trim();
    const who = cleanName
      ? `Você está conversando ao vivo com ${cleanName} (chame pelo nome naturalmente).`
      : 'Você ainda não sabe o nome da pessoa: se ela falar o nome, use-o naturalmente.';
    const copilotLine = copilotEnabled
      ? `MODO COPILOTO DE JOGOS LIGADO: você pode agir direto na tela do jogo chamando silenciosamente as ferramentas tap_screen(x, y) ou swipe_screen(x1, y1, x2, y2) com coordenadas normalizadas de 0 a 1000, enquanto conversa por voz normalmente.`
      : `MODO COPILOTO DE JOGOS DESLIGADO: NÃO chame tap_screen nem swipe_screen agora; apenas veja a tela, ouça o áudio do jogo/usuário e converse por voz dando dicas rápidas.`;

    return `Você é a Zia AI, uma assistente brasileira super inteligente, acolhedora, divertida e humana falando em tempo real (estilo ligação telefônica ao vivo em pt-BR).
${who}
${buildAudienceGuidance(audienceMode)}
Regras de voz ao vivo:
- Fale com naturalidade, expressividade feminina brasileira e frases curtas/diretas (1 a 2 frases por vez, sem monólogos longos) para a conversa fluir rápido sem atraso.
- Se o usuário te interromper, pare na hora e responda ao que ele acabou de dizer.
- Você consegue ouvir a voz do usuário e o áudio interno do jogo ao mesmo tempo, além de ver quadros da tela do celular ao vivo.
- ${copilotLine}`;
  }

  httpServer.on('upgrade', (request, socket, head) => {
    try {
      const parsedUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
      if (parsedUrl.pathname === '/api/zia/live') {
        liveWss.handleUpgrade(request, socket, head, (ws) => {
          liveWss.emit('connection', ws, request, parsedUrl);
        });
      } else {
        socket.destroy();
      }
    } catch {
      socket.destroy();
    }
  });

  liveWss.on('connection', async (clientWs: WebSocket, _req: http.IncomingMessage, parsedUrl: URL) => {
    if (!process.env.GEMINI_API_KEY) {
      try {
        clientWs.send(JSON.stringify({ type: 'error', message: 'GEMINI_API_KEY não configurada no servidor.' }));
        clientWs.close();
      } catch {
        // Ignore
      }
      return;
    }

    const userName = (parsedUrl.searchParams.get('userName') || '').trim().slice(0, 40);
    const rawAudience = parsedUrl.searchParams.get('audienceMode') || 'auto';
    const audienceMode: AudienceMode =
      rawAudience === 'crianca' || rawAudience === 'adulto' || rawAudience === 'idoso'
        ? rawAudience
        : 'auto';
    let copilotEnabled = parsedUrl.searchParams.get('copilot') === '1' || parsedUrl.searchParams.get('copilot') === 'true';

    let closed = false;
    let lastVideoSentAt = 0;
    let liveSession: Awaited<ReturnType<typeof ai.live.connect>> | null = null;
    const pendingClientMessages: string[] = [];

    const safeSendToClient = (payload: Record<string, unknown>) => {
      if (closed || clientWs.readyState !== WebSocket.OPEN) return;
      try {
        clientWs.send(JSON.stringify(payload));
      } catch {
        // Ignore send errors on closing socket
      }
    };

    const clampNorm = (v: unknown, fallback = 500): number => {
      const n = Number(v);
      if (!Number.isFinite(n)) return fallback;
      return Math.max(0, Math.min(1000, Math.round(n)));
    };

    const handleParsedClientMessage = (rawStr: string) => {
      if (closed) return;
      try {
        const msg = JSON.parse(rawStr) as {
          type?: string;
          data?: string;
          text?: string;
          copilotEnabled?: boolean;
        };

        if (msg.type === 'ping') {
          safeSendToClient({ type: 'pong' });
          return;
        }

        if (!liveSession) {
          if (pendingClientMessages.length < 24) {
            pendingClientMessages.push(rawStr);
          }
          return;
        }

        if (msg.type === 'config') {
          if (typeof msg.copilotEnabled === 'boolean') {
            copilotEnabled = msg.copilotEnabled;
            try {
              liveSession.sendRealtimeInput({
                text: copilotEnabled
                  ? '[SISTEMA: Modo Copiloto de Jogos ATIVADO pelo usuário. Pode usar tap_screen e swipe_screen quando ajudar no jogo.]'
                  : '[SISTEMA: Modo Copiloto de Jogos DESATIVADO pelo usuário. NÃO chame tap_screen nem swipe_screen agora.]',
              });
            } catch {
              // Ignore
            }
          }
          return;
        }

        if (msg.type === 'audio' && typeof msg.data === 'string' && msg.data.length > 0) {
          liveSession.sendRealtimeInput({
            audio: { data: msg.data, mimeType: 'audio/pcm;rate=16000' },
          });
          return;
        }

        if (msg.type === 'video' && typeof msg.data === 'string' && msg.data.length > 0) {
          const now = Date.now();
          if (now - lastVideoSentAt < 400) return;
          lastVideoSentAt = now;
          const cleanB64 = msg.data.replace(/^data:image\/[^;]+;base64,/i, '');
          liveSession.sendRealtimeInput({
            video: { data: cleanB64, mimeType: 'image/jpeg' },
          });
          return;
        }

        if (msg.type === 'text' && typeof msg.text === 'string' && msg.text.trim()) {
          liveSession.sendRealtimeInput({ text: msg.text.trim() });
        }
      } catch {
        // Ignore malformed client message
      }
    };

    clientWs.on('message', (rawData) => {
      handleParsedClientMessage(rawData.toString());
    });

    clientWs.on('close', () => {
      closed = true;
      try {
        liveSession?.close();
      } catch {
        // Ignore
      }
      liveSession = null;
    });

    clientWs.on('error', () => {
      closed = true;
      try {
        liveSession?.close();
      } catch {
        // Ignore
      }
      liveSession = null;
    });

    try {
      liveSession = await liveAi.live.connect({
        model: LIVE_MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Zephyr' },
            },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          tools: [{ functionDeclarations: [tapScreenTool, swipeScreenTool] }],
          systemInstruction: buildLiveSystemInstruction(userName, audienceMode, copilotEnabled),
        },
        callbacks: {
          onopen: () => {
            safeSendToClient({ type: 'ready', model: LIVE_MODEL, copilotEnabled });
          },
          onmessage: (message: LiveServerMessage) => {
            if (closed) return;
            try {
              const content = message.serverContent;
              if (content?.interrupted) {
                safeSendToClient({ type: 'interrupted' });
              }

              if (content?.inputTranscription?.text) {
                safeSendToClient({ type: 'inputTranscript', text: content.inputTranscription.text });
              }
              if (content?.outputTranscription?.text) {
                safeSendToClient({ type: 'outputTranscript', text: content.outputTranscription.text });
              }

              for (const part of content?.modelTurn?.parts ?? []) {
                if (part.inlineData?.data) {
                  safeSendToClient({ type: 'audio', data: part.inlineData.data });
                }
                if (part.text && copilotEnabled) {
                  const jsonMatches = part.text.match(/\{[^{}]*"action"\s*:\s*"(?:tap|swipe)"[^{}]*\}/gi);
                  if (jsonMatches) {
                    for (const rawJson of jsonMatches) {
                      try {
                        const parsed = JSON.parse(rawJson) as Record<string, unknown>;
                        if (parsed.action === 'tap') {
                          safeSendToClient({
                            type: 'action',
                            action: 'tap',
                            x: clampNorm(parsed.x),
                            y: clampNorm(parsed.y),
                          });
                        } else if (parsed.action === 'swipe') {
                          safeSendToClient({
                            type: 'action',
                            action: 'swipe',
                            x1: clampNorm(parsed.x1),
                            y1: clampNorm(parsed.y1),
                            x2: clampNorm(parsed.x2),
                            y2: clampNorm(parsed.y2),
                            durationMs: Math.max(60, Math.min(1200, Number(parsed.durationMs) || 220)),
                          });
                        }
                      } catch {
                        // Ignore malformed inline JSON snippet
                      }
                    }
                  }
                }
              }

              if (content?.turnComplete) {
                safeSendToClient({ type: 'turnComplete' });
              }

              for (const call of message.toolCall?.functionCalls ?? []) {
                const args = (call.args ?? {}) as Record<string, unknown>;
                if (call.name === 'tap_screen') {
                  if (copilotEnabled) {
                    const x = clampNorm(args.x);
                    const y = clampNorm(args.y);
                    safeSendToClient({ type: 'action', action: 'tap', x, y });
                    liveSession?.sendToolResponse({
                      functionResponses: [
                        {
                          id: call.id,
                          name: call.name,
                          response: { ok: true, action: 'tap', x, y },
                        },
                      ],
                    });
                  } else {
                    liveSession?.sendToolResponse({
                      functionResponses: [
                        {
                          id: call.id,
                          name: call.name,
                          response: { ok: false, reason: 'Modo Copiloto desligado.' },
                        },
                      ],
                    });
                  }
                } else if (call.name === 'swipe_screen') {
                  if (copilotEnabled) {
                    const x1 = clampNorm(args.x1);
                    const y1 = clampNorm(args.y1);
                    const x2 = clampNorm(args.x2);
                    const y2 = clampNorm(args.y2);
                    const durationMs = Math.max(60, Math.min(1200, Number(args.durationMs) || 220));
                    safeSendToClient({ type: 'action', action: 'swipe', x1, y1, x2, y2, durationMs });
                    liveSession?.sendToolResponse({
                      functionResponses: [
                        {
                          id: call.id,
                          name: call.name,
                          response: { ok: true, action: 'swipe', x1, y1, x2, y2, durationMs },
                        },
                      ],
                    });
                  } else {
                    liveSession?.sendToolResponse({
                      functionResponses: [
                        {
                          id: call.id,
                          name: call.name,
                          response: { ok: false, reason: 'Modo Copiloto desligado.' },
                        },
                      ],
                    });
                  }
                }
              }
            } catch (msgErr) {
              console.warn('Erro processando mensagem Gemini Live:', msgErr);
            }
          },
          onerror: (err: unknown) => {
            const eObj = err as { message?: string; error?: { message?: string }; type?: string };
            const detail = eObj?.error?.message || eObj?.message || eObj?.type || String(err);
            console.error('Erro na sessão Gemini Live:', detail);
            safeSendToClient({ type: 'error', message: `Oscilação na sessão Gemini Live: ${detail}` });
          },
          onclose: (ev: unknown) => {
            const cObj = ev as { code?: number; reason?: string; wasClean?: boolean };
            const closeDetail = `code=${cObj?.code ?? '?'} reason=${cObj?.reason ?? ''} wasClean=${cObj?.wasClean ?? '?'}`;
            console.warn('Gemini Live session closed:', closeDetail);
            if (!closed) {
              safeSendToClient({ type: 'closed', detail: closeDetail });
              try {
                clientWs.close();
              } catch {
                // Ignore
              }
            }
          },
        },
      });

      while (pendingClientMessages.length > 0 && !closed) {
        const queued = pendingClientMessages.shift();
        if (queued) handleParsedClientMessage(queued);
      }
    } catch (connectErr) {
      const detail = connectErr instanceof Error ? connectErr.message : String(connectErr);
      console.error('Falha ao conectar Gemini Live:', detail);
      safeSendToClient({
        type: 'error',
        message: `Não foi possível iniciar o Gemini Live agora: ${detail}`,
      });
      try {
        clientWs.close();
      } catch {
        // Ignore
      }
      return;
    }
  });

  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`Zia AI server running at http://0.0.0.0:${port}`);
  });
}

startServer();
