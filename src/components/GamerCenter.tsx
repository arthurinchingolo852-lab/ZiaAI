import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Gamepad2,
  MapPin,
  Mic,
  Palette,
  Plug,
  Send,
  Shield,
  Sparkles,
  Terminal,
  Unplug,
  Zap,
} from 'lucide-react';
import type { MemoryItem } from '../types/zia';

interface GamerCenterProps {
  onAskZia: (prompt: string) => void;
  onStartVoice: () => void;
  onAddMemory: (text: string, category: MemoryItem['category']) => void;
}

type GamerSection = 'allgames' | 'minecraft' | 'pvz' | 'shortcuts';
type McCategory = 'give' | 'summon' | 'fill' | 'effect' | 'command_block';

const MC_COMMANDS: Record<
  McCategory,
  Array<{ title: string; desc: string; cmd: string }>
> = {
  give: [
    {
      title: 'Espada de Netherite Suprema',
      desc: 'Entrega espada de netherite para você',
      cmd: '/give @s netherite_sword 1',
    },
    {
      title: 'Bloco de Comando',
      desc: 'Libera o Command Block no inventário',
      cmd: '/give @s command_block 1',
    },
    {
      title: 'Maçã Dourada Encantada (64x)',
      desc: 'Pack completo de maçã OP para chefões',
      cmd: '/give @s enchanted_golden_apple 64',
    },
    {
      title: 'Totem da Imortalidade + Élitro',
      desc: 'Proteção máxima e asas para voar',
      cmd: '/give @s totem_of_undying 1',
    },
  ],
  summon: [
    {
      title: 'Invocar Warden (Cuidado!)',
      desc: 'Cria um Warden na sua posição atual',
      cmd: '/summon warden ~ ~ ~5',
    },
    {
      title: 'Golem de Ferro Protetor',
      desc: 'Invoca um guardião para sua base',
      cmd: '/summon iron_golem ~ ~ ~3',
    },
    {
      title: 'Raio Relâmpago Épico',
      desc: 'Cai um raio 6 blocos à frente',
      cmd: '/summon lightning_bolt ^ ^ ^6',
    },
    {
      title: 'Allay Amigo',
      desc: 'Ajuda a coletar itens no chão',
      cmd: '/summon allay ~ ~1 ~2',
    },
  ],
  fill: [
    {
      title: 'Limpar Área Gigante (Ar)',
      desc: 'Limpa um cubo 15x10x15 à frente',
      cmd: '/fill ~-7 ~ ~-7 ~7 ~10 ~7 air',
    },
    {
      title: 'Plataforma de Quartzo e Vidro',
      desc: 'Cria piso brilhante 11x11 sob seus pés',
      cmd: '/fill ~-5 ~-1 ~-5 ~5 ~-1 ~5 smooth_quartz',
    },
    {
      title: 'Muralha Protetora de Obsidiana',
      desc: 'Ergue parede oca ao redor de você',
      cmd: '/fill ~-6 ~ ~-6 ~6 ~5 ~6 obsidian hollow',
    },
  ],
  effect: [
    {
      title: 'Modo Deus (Força + Resistência)',
      desc: 'Força nível 10 por 10 minutos',
      cmd: '/effect @s strength 600 10 true',
    },
    {
      title: 'Super Velocidade Flash',
      desc: 'Velocidade nível 5 sem partículas',
      cmd: '/effect @s speed 300 5 true',
    },
    {
      title: 'Visão Noturna Infinita',
      desc: 'Enxergue tudo em cavernas escuras',
      cmd: '/effect @s night_vision 99999 1 true',
    },
    {
      title: 'Regeneração Instantânea',
      desc: 'Recupera corações super rápido',
      cmd: '/effect @s regeneration 60 5 true',
    },
  ],
  command_block: [
    {
      title: 'Ponte Mágica Automática (Repetição)',
      desc: 'Coloca vidro azul onde você anda (Always Active)',
      cmd: '/execute at @p run setblock ~ ~-1 ~ stained_glass 3',
    },
    {
      title: 'Aura de Relâmpago em Mobs Próximos',
      desc: 'Atinge monstros a até 8 blocos',
      cmd: '/execute at @p run summon lightning_bolt ~ ~ ~',
    },
    {
      title: 'Teleporte Seguro para Casa',
      desc: 'Substitua X Y Z pelas suas coords',
      cmd: '/tp @s 0 70 0',
    },
  ],
};

const PVZ_COMBOS = [
  {
    name: 'Combo Infinito do Canhão de Milho',
    plants: '2x Girassol Duplo + Milho-pulta + Canhão de Milho + Noz-Gigante + Abóbora',
    tip: 'Coloque 4 Canhões de Milho nas colunas centrais (3 e 4) e dispare alternando a cada 18s para destruir ondas inteiras de Zumbões!',
  },
  {
    name: 'Muralha de Fogo Turbinada',
    plants: 'Disparervilha Tripla + Planta-Tocha + Noz-Obstáculo + Batata-Mina',
    tip: 'Ervilhas que passam pela Planta-Tocha dobram o dano e derretem Zumbis Balde rapidinho. Use Batata-Mina no início para economizar sóis!',
  },
  {
    name: 'Labirinto de Alho + Cogumelo-Triste',
    plants: 'Alho na frente das linhas 1 e 5 + Cogumelo-Triste protegido por Abóbora',
    tip: 'O Alho desvia os zumbis para as linhas 2 e 4, onde os Cogumelos-Tristes causam dano contínuo em área sem nem tomar mordida!',
  },
  {
    name: 'Controle Glacial na Piscina',
    plants: 'Melancia-Gelada + Vitória-Régia + Alga-Marinha + Ervilha-Gato',
    tip: 'A Melancia-Gelada reduz a velocidade de todos os zumbis pela metade em área, enquanto a Ervilha-Gato derruba Zumbis Balão de qualquer linha!',
  },
];

const PVZ_COUNTERS = [
  { zombie: 'Zumbi Balão', counter: 'Ervilha-Gato ou Trevo-Ventilador (sopra todos da tela)' },
  { zombie: 'Zumbão (Gargantuar)', counter: '2 Explosões: Bomba-Cereja + Esmagador ou Pimenta-Jalapenho' },
  { zombie: 'Zumbi Escavador', counter: 'Planta-Ímã ou Carambola/Cogumelo-Triste atrás da defesa' },
  { zombie: 'Zumbi Mergulhador / Golfinho', counter: 'Alga-Marinha ou Noz-Gigante na Vitória-Régia' },
  { zombie: 'Zumbi Com Carro (Zomboni)', counter: 'Erva-Espinhuda ou Espinhão-Pedra (fura o pneu na hora!)' },
];

export const GamerCenter: React.FC<GamerCenterProps> = ({
  onAskZia,
  onStartVoice,
  onAddMemory,
}) => {
  const [section, setSection] = useState<GamerSection>('allgames');
  const [customGameName, setCustomGameName] = useState('');
  const [customGameQuestion, setCustomGameQuestion] = useState('');
  const [mcCat, setMcCat] = useState<McCategory>('give');
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);

  // Custom command builder
  const [customItem, setCustomItem] = useState('diamond');
  const [customAmount, setCustomAmount] = useState('64');

  // Coords saver
  const [coordName, setCoordName] = useState('');
  const [coordX, setCoordX] = useState('');
  const [coordY, setCoordY] = useState('64');
  const [coordZ, setCoordZ] = useState('');
  const [coordSaved, setCoordSaved] = useState(false);

  // Local WebSocket Connector
  const [wsUrl, setWsUrl] = useState('ws://localhost:8080');
  const [wsStatus, setWsStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
  const [wsLogs, setWsLogs] = useState<string[]>([]);
  const [wsCustomCmd, setWsCustomCmd] = useState('/say Zia AI conectada!');
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    return () => {
      wsRef.current?.close();
    };
  }, []);

  const appendLog = (entry: string) => {
    setWsLogs((prev) => [`[${new Date().toLocaleTimeString('pt-BR')}] ${entry}`, ...prev].slice(0, 12));
  };

  const handleCopy = async (cmd: string) => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopiedCmd(cmd);
      setTimeout(() => setCopiedCmd((prev) => (prev === cmd ? null : prev)), 1800);
    } catch {
      // Fallback
    }
  };

  const handleToggleWs = () => {
    if (wsStatus === 'connected' || wsStatus === 'connecting') {
      wsRef.current?.close();
      wsRef.current = null;
      setWsStatus('disconnected');
      appendLog('Conexão WebSocket encerrada.');
      return;
    }

    try {
      setWsStatus('connecting');
      appendLog(`Conectando em ${wsUrl}...`);
      const socket = new WebSocket(wsUrl);
      wsRef.current = socket;

      socket.onopen = () => {
        setWsStatus('connected');
        appendLog('Conectado ao servidor local Minecraft Bedrock!');
      };

      socket.onmessage = (event) => {
        appendLog(`Recebido: ${typeof event.data === 'string' ? event.data.slice(0, 100) : 'pacote binário'}`);
      };

      socket.onerror = () => {
        setWsStatus('error');
        appendLog('Não foi possível conectar. Verifique se o servidor local está rodando em ws://localhost:8080.');
      };

      socket.onclose = () => {
        setWsStatus((prev) => (prev === 'error' ? 'error' : 'disconnected'));
      };
    } catch {
      setWsStatus('error');
      appendLog('URL WebSocket inválida.');
    }
  };

  const sendCommandViaWs = (command: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      appendLog('Conecte ao WebSocket primeiro antes de enviar comandos.');
      return;
    }
    const payload = JSON.stringify({
      header: {
        requestId: crypto.randomUUID(),
        messagePurpose: 'commandRequest',
        version: 1,
        messageType: 'commandRequest',
      },
      body: {
        origin: { type: 'player' },
        commandLine: command.replace(/^\//, ''),
        version: 1,
      },
    });
    wsRef.current.send(payload);
    appendLog(`Enviado: ${command}`);
  };

  const handleSaveCoords = (e: React.FormEvent) => {
    e.preventDefault();
    if (!coordName.trim() || !coordX.trim() || !coordZ.trim()) return;
    onAddMemory(
      `Minecraft Bedrock - ${coordName.trim()}: X ${coordX.trim()}, Y ${coordY.trim() || '64'}, Z ${coordZ.trim()}`,
      'coordenada'
    );
    setCoordName('');
    setCoordX('');
    setCoordZ('');
    setCoordSaved(true);
    setTimeout(() => setCoordSaved(false), 2500);
  };

  const customGiveCmd = `/give @s ${customItem.trim() || 'diamond'} ${Math.max(1, Number(customAmount) || 1)}`;

  return (
    <div className="flex flex-col h-full overflow-y-auto zia-scroll px-4 py-4 space-y-5 pb-28 lg:pb-6">
      {/* Header & Section Tabs */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-white tracking-tight">Central Gamer</h2>
            <p className="text-xs text-slate-400">
              Qualquer jogo na tela, Minecraft Bedrock, PvZ e comandos sem cooldown
            </p>
          </div>
          <Gamepad2 className="w-6 h-6 text-sky-400 shrink-0" />
        </div>

        <div className="grid grid-cols-4 gap-1 p-1 rounded-2xl bg-[#131b2e] border border-white/10">
          <button
            type="button"
            onClick={() => setSection('allgames')}
            className={`min-h-[42px] rounded-xl text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap px-1.5 ${
              section === 'allgames'
                ? 'bg-gradient-to-r from-sky-500 to-purple-500 text-white'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            Qualquer Jogo
          </button>
          <button
            type="button"
            onClick={() => setSection('minecraft')}
            className={`min-h-[42px] rounded-xl text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap px-1.5 ${
              section === 'minecraft'
                ? 'bg-sky-500 text-slate-950'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            Minecraft
          </button>
          <button
            type="button"
            onClick={() => setSection('pvz')}
            className={`min-h-[42px] rounded-xl text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap px-1.5 ${
              section === 'pvz'
                ? 'bg-emerald-500 text-slate-950'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            PvZ
          </button>
          <button
            type="button"
            onClick={() => setSection('shortcuts')}
            className={`min-h-[42px] rounded-xl text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap px-1.5 ${
              section === 'shortcuts'
                ? 'bg-purple-500 text-white'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            Atalhos
          </button>
        </div>
      </div>

      {/* QUALQUER JOGO */}
      {section === 'allgames' && (
        <div className="space-y-4">
          <div className="rounded-2xl bg-[#131b2e] border border-sky-400/25 p-4 space-y-3">
            <h3 className="text-sm font-semibold text-white">Pedir ajuda ou estratégia em QUALQUER jogo</h3>
            <div className="space-y-2">
              <input
                type="text"
                value={customGameName}
                onChange={(e) => setCustomGameName(e.target.value)}
                placeholder="Nome do jogo (ex: Roblox, Brawl Stars, Geometry Dash, Free Fire...)"
                className="w-full min-h-[42px] rounded-xl bg-[#090d16] border border-white/10 px-3 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-sky-400"
              />
              <input
                type="text"
                value={customGameQuestion}
                onChange={(e) => setCustomGameQuestion(e.target.value)}
                placeholder="O que quer fazer? (ex: melhor combo, passar fase, build apelona)"
                className="w-full min-h-[42px] rounded-xl bg-[#090d16] border border-white/10 px-3 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-sky-400"
              />
              <button
                type="button"
                onClick={() => {
                  const game = customGameName.trim() || 'esse jogo que estou jogando';
                  const q = customGameQuestion.trim() || 'me passa as melhores dicas e jogadas rápidas agora!';
                  onAskZia(`Zia, no jogo ${game}: ${q}`);
                }}
                className="w-full min-h-[44px] rounded-xl bg-gradient-to-r from-sky-500 to-purple-500 text-white font-semibold text-xs hover:brightness-110 cursor-pointer"
              >
                Mandar pra Zia Agora ⚡
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            {[
              { name: 'Roblox', prompt: 'Zia, tô no Roblox! Qual estratégia ou segredo tá valendo mais agora?' },
              { name: 'Brawl Stars', prompt: 'Zia, me dá a melhor comp e dica rápida pra subir troféu no Brawl Stars!' },
              { name: 'Free Fire / FPS', prompt: 'Zia, manda dica de movimentação, sensibilidade e posicionamento pra amassar na partida!' },
              { name: 'Clash Royale', prompt: 'Zia, monta um deck insano de Clash Royale pra counterar tudo!' },
              { name: 'Geometry Dash', prompt: 'Zia, me ajuda no timing e estratégia pra passar fases demon no Geometry Dash!' },
              { name: 'Subway Surfers', prompt: 'Zia, bora bater recorde no Subway Surfers! Qual o segredo da pontuação alta?' },
            ].map((g) => (
              <button
                key={g.name}
                type="button"
                onClick={() => onAskZia(g.prompt)}
                className="min-h-[54px] rounded-2xl bg-[#131b2e] hover:bg-[#19233b] border border-white/10 p-3 text-left transition-colors cursor-pointer"
              >
                <div className="text-xs font-bold text-sky-300">{g.name}</div>
                <div className="text-[11px] text-slate-400 mt-0.5">Dicas e calls ao vivo</div>
              </button>
            ))}
          </div>

          <div className="rounded-2xl bg-[#131b2e] border border-purple-400/25 p-4 space-y-1.5 text-xs text-slate-300">
            <p className="font-semibold text-purple-300">Auto-Jogar Sem Cooldown de Clique (Android APK)</p>
            <p className="leading-relaxed text-[11px] text-slate-300">
              Pelo navegador o Android bloqueia cliques fora do site por segurança. No app Android nativo em <code className="text-sky-300">android-companion/</code>, a Zia vira uma bola flutuante sobre qualquer jogo, vê a tela, ouve o som do jogo e usa <code className="text-sky-300">AccessibilityService</code> para clicar sem cooldown onde você mandar!
            </p>
          </div>
        </div>
      )}

      {/* MINECRAFT BEDROCK */}
      {section === 'minecraft' && (
        <div className="space-y-5">
          {/* Quick Custom /give Builder */}
          <div className="rounded-2xl bg-[#131b2e] border border-sky-400/20 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">Gerador Rápido (/give)</h3>
              <span className="text-[11px] font-mono text-sky-300">Bedrock Edition</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <input
                type="text"
                value={customItem}
                onChange={(e) => setCustomItem(e.target.value)}
                placeholder="item (ex: diamond)"
                className="col-span-2 min-h-[44px] rounded-xl bg-[#090d16] border border-white/10 px-3 text-xs font-mono text-white focus:outline-none focus:border-sky-400"
              />
              <input
                type="number"
                min={1}
                max={640}
                value={customAmount}
                onChange={(e) => setCustomAmount(e.target.value)}
                className="min-h-[44px] rounded-xl bg-[#090d16] border border-white/10 px-3 text-xs font-mono tabular-nums text-white focus:outline-none focus:border-sky-400"
              />
            </div>
            <div className="flex items-center justify-between gap-2 rounded-xl bg-[#090d16] border border-white/10 px-3 py-2.5">
              <code className="text-xs font-mono text-sky-300 truncate">{customGiveCmd}</code>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => void handleCopy(customGiveCmd)}
                  className="min-h-[38px] px-3 rounded-lg bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  {copiedCmd === customGiveCmd ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedCmd === customGiveCmd ? 'Copiado!' : 'Copiar'}</span>
                </button>
                {wsStatus === 'connected' && (
                  <button
                    type="button"
                    onClick={() => sendCommandViaWs(customGiveCmd)}
                    className="min-h-[38px] px-2.5 rounded-lg bg-emerald-500/20 text-emerald-300 text-xs font-semibold cursor-pointer"
                  >
                    Enviar WS
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Preset Categories */}
          <div className="space-y-3">
            <div className="flex gap-1.5 overflow-x-auto pb-1 zia-scroll">
              {(
                [
                  ['give', '/give'],
                  ['summon', '/summon'],
                  ['fill', '/fill'],
                  ['effect', '/effect'],
                  ['command_block', 'Command Block'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setMcCat(key)}
                  className={`min-h-[40px] px-3.5 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                    mcCat === key
                      ? 'bg-sky-500/20 text-sky-300 border border-sky-400/40'
                      : 'bg-[#131b2e] text-slate-400 border border-white/10 hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="space-y-2.5">
              {MC_COMMANDS[mcCat].map((item) => (
                <div
                  key={item.cmd}
                  className="rounded-2xl bg-[#131b2e] border border-white/10 p-3.5 space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h4 className="text-sm font-semibold text-white">{item.title}</h4>
                      <p className="text-xs text-slate-400">{item.desc}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onAskZia(`Zia, me explica como usar e personalizar esse comando de Minecraft Bedrock: ${item.cmd}`)}
                      className="min-h-[36px] px-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-[11px] font-medium text-sky-300 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      Dica da Zia
                    </button>
                  </div>
                  <div className="flex items-center justify-between gap-2 rounded-xl bg-[#090d16] px-3 py-2 border border-white/5">
                    <code className="text-xs font-mono text-cyan-300 overflow-x-auto whitespace-nowrap">
                      {item.cmd}
                    </code>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => void handleCopy(item.cmd)}
                        className="min-h-[38px] px-3 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                      >
                        {copiedCmd === item.cmd ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedCmd === item.cmd ? 'Copiado' : 'Copiar'}</span>
                      </button>
                      {wsStatus === 'connected' && (
                        <button
                          type="button"
                          onClick={() => sendCommandViaWs(item.cmd)}
                          className="min-h-[38px] px-2.5 rounded-lg bg-emerald-500 text-slate-950 text-xs font-semibold cursor-pointer"
                        >
                          Executar
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Save Coords into Zia Infinite Memory */}
          <form
            onSubmit={handleSaveCoords}
            className="rounded-2xl bg-[#131b2e] border border-white/10 p-4 space-y-3"
          >
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-purple-300" />
              <h3 className="text-sm font-semibold text-white">Salvar Coordenadas na Memória da Zia</h3>
            </div>
            <input
              type="text"
              value={coordName}
              onChange={(e) => setCoordName(e.target.value)}
              placeholder="Nome do local (ex: Portal do End, Vila)"
              className="w-full min-h-[44px] rounded-xl bg-[#090d16] border border-white/10 px-3 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-purple-400"
            />
            <div className="grid grid-cols-3 gap-2">
              <input
                type="number"
                value={coordX}
                onChange={(e) => setCoordX(e.target.value)}
                placeholder="X"
                className="min-h-[44px] rounded-xl bg-[#090d16] border border-white/10 px-3 text-xs font-mono tabular-nums text-white"
              />
              <input
                type="number"
                value={coordY}
                onChange={(e) => setCoordY(e.target.value)}
                placeholder="Y"
                className="min-h-[44px] rounded-xl bg-[#090d16] border border-white/10 px-3 text-xs font-mono tabular-nums text-white"
              />
              <input
                type="number"
                value={coordZ}
                onChange={(e) => setCoordZ(e.target.value)}
                placeholder="Z"
                className="min-h-[44px] rounded-xl bg-[#090d16] border border-white/10 px-3 text-xs font-mono tabular-nums text-white"
              />
            </div>
            <button
              type="submit"
              className="w-full min-h-[44px] rounded-xl bg-purple-500/20 hover:bg-purple-500/30 border border-purple-400/35 text-purple-200 text-xs font-semibold transition-colors cursor-pointer"
            >
              {coordSaved ? 'Coordenadas guardadas na memória! ✨' : 'Guardar Coordenadas para Nunca Esquecer'}
            </button>
          </form>

          {/* Local WebSocket Connector (ws://localhost:8080) */}
          <div className="rounded-2xl bg-[#131b2e] border border-sky-400/20 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-sky-300" />
                <h3 className="text-sm font-semibold text-white">Conector WebSocket Local</h3>
              </div>
              <div className="flex items-center gap-1.5 text-xs font-medium">
                {wsStatus === 'connected' && (
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                )}
                <span
                  className={
                    wsStatus === 'connected'
                      ? 'text-emerald-300'
                      : wsStatus === 'error'
                      ? 'text-rose-300'
                      : 'text-slate-400'
                  }
                >
                  {wsStatus === 'connected'
                    ? 'Conectado'
                    : wsStatus === 'connecting'
                    ? 'Conectando...'
                    : wsStatus === 'error'
                    ? 'Offline / Recusado'
                    : 'Desconectado'}
                </span>
              </div>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={wsUrl}
                onChange={(e) => setWsUrl(e.target.value)}
                className="flex-1 min-h-[44px] rounded-xl bg-[#090d16] border border-white/10 px-3 text-xs font-mono text-slate-200 focus:outline-none focus:border-sky-400"
              />
              <button
                type="button"
                onClick={handleToggleWs}
                className={`min-h-[44px] px-4 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors ${
                  wsStatus === 'connected'
                    ? 'bg-rose-500/20 border border-rose-400/35 text-rose-200 hover:bg-rose-500/30'
                    : 'bg-sky-500 text-slate-950 hover:bg-sky-400'
                }`}
              >
                {wsStatus === 'connected' ? <Unplug className="w-4 h-4" /> : <Plug className="w-4 h-4" />}
                <span>{wsStatus === 'connected' ? 'Desconectar' : 'Conectar'}</span>
              </button>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={wsCustomCmd}
                onChange={(e) => setWsCustomCmd(e.target.value)}
                placeholder="/say Olá mundo!"
                className="flex-1 min-h-[44px] rounded-xl bg-[#090d16] border border-white/10 px-3 text-xs font-mono text-white"
              />
              <button
                type="button"
                onClick={() => sendCommandViaWs(wsCustomCmd)}
                className="min-h-[44px] px-4 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Enviar</span>
              </button>
            </div>

            {wsLogs.length > 0 && (
              <div className="rounded-xl bg-[#090d16] border border-white/5 p-2.5 max-h-28 overflow-y-auto zia-scroll space-y-1">
                {wsLogs.map((log, i) => (
                  <p key={i} className="text-[11px] font-mono text-slate-400 break-all">
                    {log}
                  </p>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* PLANTS VS ZOMBIES */}
      {section === 'pvz' && (
        <div className="space-y-5">
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-emerald-300 flex items-center gap-2">
              <Shield className="w-4 h-4" />
              <span>Combos Invencíveis de Plantas</span>
            </h3>
            {PVZ_COMBOS.map((combo) => (
              <div
                key={combo.name}
                className="rounded-2xl bg-[#131b2e] border border-emerald-400/20 p-4 space-y-2"
              >
                <h4 className="text-sm font-semibold text-white">{combo.name}</h4>
                <p className="text-xs font-medium text-emerald-300">{combo.plants}</p>
                <p className="text-xs text-slate-300 leading-relaxed">{combo.tip}</p>
                <button
                  type="button"
                  onClick={() =>
                    onAskZia(
                      `Zia, me dê o passo a passo exato de como montar o "${combo.name}" no Plants vs. Zombies desde o começo da fase!`
                    )
                  }
                  className="min-h-[40px] px-3.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-400/30 text-emerald-200 text-xs font-semibold cursor-pointer"
                >
                  Pedir estratégia passo a passo
                </button>
              </div>
            ))}
          </div>

          <div className="rounded-2xl bg-[#131b2e] border border-white/10 p-4 space-y-3">
            <h3 className="text-sm font-semibold text-white">Guia Rápido Contra Zumbis Difíceis</h3>
            <div className="divide-y divide-white/10">
              {PVZ_COUNTERS.map((row) => (
                <div key={row.zombie} className="py-2.5 space-y-0.5">
                  <div className="text-xs font-semibold text-sky-300">{row.zombie}</div>
                  <div className="text-xs text-slate-300">{row.counter}</div>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() =>
                onAskZia(
                  'Zia, estou em uma fase difícil do Plants vs. Zombies! Me pergunta qual é a fase e me ajuda a escolher as melhores plantas!'
                )
              }
              className="w-full min-h-[44px] rounded-xl bg-emerald-500 text-slate-950 font-semibold text-xs hover:bg-emerald-400 transition-colors cursor-pointer"
            >
              Pedir ajuda na minha fase atual do PvZ
            </button>
          </div>
        </div>
      )}

      {/* ATALHOS RÁPIDOS */}
      {section === 'shortcuts' && (
        <div className="space-y-3">
          <button
            type="button"
            onClick={onStartVoice}
            className="w-full min-h-[56px] rounded-2xl bg-gradient-to-r from-sky-500 to-purple-600 text-white font-semibold text-sm flex items-center justify-center gap-2.5 shadow-lg shadow-sky-500/20 cursor-pointer"
          >
            <Mic className="w-5 h-5" />
            <span>Conversar por Voz Agora</span>
          </button>

          {[
            {
              icon: Zap,
              title: 'Ideia de Construção Épica no Minecraft',
              prompt: 'Zia, me dê 3 ideias incríveis e fáceis de construir no Minecraft Bedrock hoje com lista de blocos!',
            },
            {
              icon: Shield,
              title: 'Montar Time Invencível no PvZ',
              prompt: 'Zia, me ajuda a montar a melhor formação de 8 plantas para ganhar qualquer fase difícil de Plants vs. Zombies!',
            },
            {
              icon: Palette,
              title: 'Criar Arte Futurista Grátis',
              prompt: 'Zia, desenhe uma imagem épica de um dragão cibernético azul neon voando sobre uma cidade de Minecraft futurista!',
            },
            {
              icon: Sparkles,
              title: 'Criar Mini Vídeo Animado',
              prompt: 'Zia, crie um vídeo animado curto de uma aventura espacial épica explorando um planeta brilhante!',
            },
          ].map((shortcut) => {
            const Icon = shortcut.icon;
            return (
              <button
                key={shortcut.title}
                type="button"
                onClick={() => onAskZia(shortcut.prompt)}
                className="w-full min-h-[56px] rounded-2xl bg-[#131b2e] hover:bg-[#19233b] border border-white/10 px-4 py-3 flex items-center gap-3 text-left transition-colors cursor-pointer"
              >
                <div className="w-10 h-10 rounded-xl bg-sky-500/15 border border-sky-400/25 flex items-center justify-center text-sky-300 shrink-0">
                  <Icon className="w-5 h-5" />
                </div>
                <span className="text-sm font-medium text-slate-100">{shortcut.title}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
