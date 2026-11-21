# Zia AI Live — Aplicativo Android Multimodal (Gemini Live + Bolinha Flutuante + Copiloto)

Aplicativo nativo em Kotlin para Android que conecta diretamente ao endpoint WebSocket **`/api/zia/live`** da Zia AI (usando a **Gemini Multimodal Live API `gemini-3.8-live`** no servidor, sem armazenar chaves da API no celular).

## Recursos implementados
- **Modo de Voz Avançado (Gemini Multimodal Live API via WebSocket)**:
  - Áudio nativo para áudio nativo (`16kHz` PCM16 entrada -> `24kHz` PCM16 saída) sem o atraso de gravar -> transcrever -> pensar -> ler.
  - **Barge-in (Interrupção Natural)**: interrompa a Zia a qualquer instante enquanto ela fala; o áudio é cortado na hora.
  - **Microfone + Áudio Interno do Jogo (`AudioPlaybackCapture` Android 10+)**: mixagem em tempo real para a Zia ouvir você e o som do jogo juntos.
- **Bolinha Flutuante Animada (`WindowManager` `TYPE_APPLICATION_OVERLAY`)**:
  - `ZiaOrbView`: esfera viva que muda de forma, cor e tamanho conforme o volume da sua voz e da voz da Zia.
  - **Ímã nas Bordas + Botão `X`**: arraste livremente sobre jogos; ao soltar, desliza suavemente para a borda esquerda ou direita; ao arrastar aparece o `X` embaixo para encerrar o serviço com segurança.
  - **Controles Rápidos**:
    - **1 toque simples**: pausa ou retoma o microfone na hora.
    - **Toque longo**: abre o mini-menu flutuante transparente com `[👁️ Ver Tela]`, `[🎮 Pode Jogar]` e `[🏠 Abrir App ZIA]`.
- **Modo Copiloto de Jogos + Indicador Visual de Toque**:
  - Visão contínua de tela (`MediaProjection` em tempo real sem trava de 1s) integrada na mesma sessão Live.
  - `ZiaAccessibilityService`: converte coordenadas normalizadas (`0..1000`) para pixels reais (`DisplayMetrics` / `WindowMetrics`) e executa `tap` / `swipe` via `dispatchGesture`.
  - `TouchRippleOverlayView`: desenha uma onda luminosa animada por `0.6s` exatamente no ponto clicado sobre o jogo.
- **Estabilidade & Permissões**:
  - Checagem segura de `RECORD_AUDIO`, `POST_NOTIFICATIONS`, `SYSTEM_ALERT_WINDOW`, `MediaProjection` e `AccessibilityService`, com avisos amigáveis e atalho direto para as configurações.
  - `ForegroundService` compatível com Android 14+ e reconexão automática do WebSocket com aviso por voz.

## Como compilar e gerar `ZiaAI.apk`
1. **Via GitHub Actions (Automático)**: o workflow `.github/workflows/build-apk.yml` compila automaticamente este projeto Gradle (`gradle assembleDebug`) e disponibiliza o arquivo **`ZiaAI.apk`** pronto para instalar no celular em **Actions > Artifacts (`ZiaAI-APK`)**.
2. **Localmente no Android Studio**: abra a pasta `android-companion/` diretamente (já inclui `settings.gradle.kts`, `build.gradle.kts`, `gradle.properties` e `app/build.gradle.kts`) e rode **Build > Build APK(s)**.
3. Cole a URL do servidor Zia AI exibida em **Ajustes > Janela Flutuante** dentro do app e toque em **🎙️ Ativar ZIA Live + Ver Tela e Som**.
