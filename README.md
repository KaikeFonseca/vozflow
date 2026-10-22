# VozFlow

Seu app de ditado por voz, no estilo do Wispr Flow: você aperta um atalho em qualquer lugar,
fala, e o texto aparece no campo onde o cursor está (navegador, WhatsApp Desktop, VS Code, Word, Slack...).
Um indicador pequeno fica no canto da tela mostrando quando está ouvindo.

## O que ele faz

| Função | Como usar (Windows) | Como usar (Mac) |
|---|---|---|
| **Hands-free com toque duplo** | Toque duas vezes rápido em **Ctrl** para começar e mais duas para parar e colar | igual (Ctrl) |
| Segurar para falar | Segure **Ctrl+Win**, fale, solte | Segure **Ctrl+Option** |
| Hands-free (mãos livres) | **Ctrl+Win+Espaço** para começar e de novo para parar | **Ctrl+Option+Espaço** |
| Hands-free pelo push-to-talk | Toque duas vezes rápido em Ctrl+Win | Toque duas vezes em Ctrl+Option |
| Travar em hands-free | Segurando Ctrl+Win, aperte Espaço | Segurando Ctrl+Option, aperte Espaço |
| Cancelar | **Esc** ou o ✕ do indicador | igual |
| Parar e colar | ■ no indicador, ou o atalho hands-free | igual |
| Colar a última fala de novo | **Shift+Alt+Z** | **Cmd+Ctrl+V** |
| Abrir as últimas 10 falas | **Shift+Alt+H**, clique no ícone da bandeja ou botão direito no indicador | **Cmd+Ctrl+H** |
| Começar pelo mouse | Clique no indicador do canto | igual |

Todos os atalhos são editáveis em **Configurações**: clique no campo e aperte as teclas que quiser.
Ctrl+C, Ctrl+V e outros atalhos com Ctrl não disparam o toque duplo; só dois toques "limpos" no Ctrl sozinho.

**Português + inglês**: no modo padrão o app detecta sozinho se você está falando português ou inglês,
e aceita frases misturadas ("vou fazer o deploy amanhã") sem traduzir uma língua para a outra.

**Últimas falas**: cada fala é salva no histórico *antes* de ser colada. Ficam as 10 mais recentes;
as antigas vão sendo apagadas sozinhas. Se a internet cair ou a API falhar, o áudio fica guardado
e aparece no histórico com o botão **Tentar de novo**.

Outros comportamentos:
- Toque rápido (menos de 0,25 s) no atalho não conta como fala.
- Se você apertar outra tecla junto (ex.: Ctrl+Win+D), o app entende que era um atalho do sistema e cancela em silêncio.
- Se não ouvir voz, não cola nada.
- Limite de 20 minutos por gravação (configurável); ao atingir, ele transcreve o que tiver.
- A área de transferência é restaurada depois de colar.
- **Dicionário**: nomes e termos que o Whisper deve escrever certo.
- **Snippets**: diga "meu email" e ele digita o endereço completo.
- **Limpeza com IA (opcional)**: tira "é", "tipo", "né", aplica autocorreções ("às 5, quer dizer, às 6" vira "às 6"), pontua e formata listas. Funciona com Claude ou qualquer API compatível com OpenAI.
## Transcrição: grátis no seu computador ou na nuvem

- **Whisper embutido (padrão)**: o app já vem com o [whisper.cpp](https://github.com/ggml-org/whisper.cpp) e o modelo
  `small` multilíngue. Funciona sem internet, sem chave e sem custo. O modelo fica carregado na memória
  enquanto o app está aberto, então cada ditado sai em poucos segundos. No Mac com chip Apple ele usa a GPU (Metal).
- **Modelo maior (opcional)**: em Configurações dá para baixar o `large-v3-turbo` (~550 MB), que acerta mais
  mas é mais lento em PC sem placa de vídeo.
- **Nuvem (opcional)**: troque para "Na nuvem" e cole uma chave da [Groq](https://console.groq.com/keys)
  (tem plano grátis) ou da OpenAI. É mais rápido, mas o áudio sai do seu computador.

## Baixar o instalador pronto

Cada atualização no GitHub gera os instaladores automaticamente (GitHub Actions):

1. No repositório, abra **Actions → Build**, clique na execução mais recente e baixe em **Artifacts**:
   - `VozFlow-windows` → `VozFlow-x.y.z-windows-setup.exe` (Windows 11)
   - `VozFlow-mac` → `VozFlow-x.y.z-mac-arm64.dmg` (Mac M1/M2/M3/M4) ou `-x64.dmg` (Mac Intel)
2. Quando houver uma versão marcada (tag `v0.2.0`), os instaladores também aparecem em **Releases**.

**Windows**: o SmartScreen pode avisar "app não reconhecido" porque o instalador não tem certificado pago. Clique em *Mais informações → Executar assim mesmo*.

**Mac**: arraste o VozFlow para Aplicativos. Como o app não é assinado pela Apple, na primeira vez rode no Terminal:

```bash
xattr -cr /Applications/VozFlow.app
```

e abra normalmente. Depois permita **Microfone** e **Acessibilidade** quando o Mac pedir. A cada versão nova instalada,
pode ser preciso remover e adicionar o VozFlow de novo em Acessibilidade.

## Rodar a partir do código

Precisa de [Node.js 20+](https://nodejs.org).

```bash
cd vozflow
npm install
npm start
```

Para rodar do código com o Whisper embutido, compile o motor uma vez (precisa de CMake e de um compilador C++):
`bash scripts/build-whisper.sh win x64` (ou `mac arm64`, `mac x64`, `linux x64`).

Para gerar o instalador na sua máquina: `npm run dist:win` (no Windows) ou `npm run dist:mac` (no Mac). Testes: `npm test`.

### Permissões por sistema

- **Mac**: permita **Microfone** e **Acessibilidade** (Ajustes do Sistema → Privacidade e Segurança). Acessibilidade é o que deixa o app ouvir o atalho global e simular Cmd+V. Depois de permitir, reabra o app. A tecla Fn não pode ser capturada por apps comuns, por isso o padrão no Mac é Ctrl+Option.
- **Windows**: funciona direto. Se Ctrl+Win+Espaço trocar o idioma do teclado no seu PC, mude o hands-free para outro combo, como Ctrl+Alt+Espaço.
- **Linux**: funciona em X11. No Wayland, atalhos globais e teclas simuladas são bloqueados pelo sistema; use uma sessão X11.

## Como funciona por dentro

```
 teclado (hook global, uiohook-napi)
        │ keydown/keyup
        ▼
 HotkeyMachine (src/hotkeys.js) ── start / stop / cancel ──┐
                                                           ▼
 Indicador flutuante (src/widget.html)  ← janela transparente, sempre no topo, que NUNCA recebe foco
   • abre o microfone (getUserMedia + MediaRecorder, Opus 32 kbps)
   • desenha a onda de áudio e mede o pico (detecção de silêncio)
        │ áudio
        ▼
 src/transcribe.js
   1. Whisper (/audio/transcriptions), detectando português/inglês, com o dicionário como "prompt"
   2. Limpeza opcional com LLM (Claude ou compatível com OpenAI)
   3. Snippets
        │ texto
        ▼
 src/history.js: salva nas últimas 10 falas (ou guarda o áudio se falhou)
        │
        ▼
 src/inserter.js: salva a área de transferência → escreve o texto → simula Ctrl/Cmd+V → restaura
```

O ponto que faz tudo funcionar "em qualquer app" é o indicador ser uma janela `focusable: false`:
o foco do teclado continua no campo onde você estava, então o Ctrl+V cai exatamente lá.

## O que estudamos do Wispr Flow

Baseado na documentação pública e no comportamento do app (sem copiar código dele):

- **Atalhos padrão**: push-to-talk em Fn (Mac) ou Ctrl+Win (Windows); hands-free em Fn+Espaço / Ctrl+Win+Espaço; Esc cancela; colar o último em Cmd+Ctrl+V / Shift+Alt+Z. Copiamos esses padrões, trocando Fn por Ctrl+Option no Mac.
- **Hands-free**: começa pelo atalho, por clique na Flow Bar ou com dois toques no push-to-talk em até 0,5 s. Repetir o atalho em menos de 0,5 s cancela em vez de colar. Aviso aos 19 minutos e parada aos 20, transcrevendo o áudio em vez de descartar.
- **Inserção**: o texto é colado no campo ativo, sem integração por app. É o mesmo método de área de transferência + colar simulado usado aqui.
- **Flow Bar**: pílula pequena sempre visível, clicável para começar, com ■ para parar e ✕ para cancelar.
- **Sem áudio = nada colado**; atalhos são ignorados enquanto processa.
- **Pós-processamento por IA**: remove vícios de fala, aplica autocorreções, formata listas, estilo por app (formal/casual), dicionário que aprende nomes, snippets por voz.
- **Permissões no Mac**: Input Monitoring + Acessibilidade, as mesmas que este app pede.

Fontes: [wisprflow.ai](https://wisprflow.ai/),
[Use Flow hands-free](https://docs.wisprflow.ai/articles/6391241694-use-flow-hands-free),
[Atalhos suportados](https://docs.wisprflow.ai/articles/2612050838-supported-unsupported-keyboard-hotkey-shortcuts).

## Ideias para a próxima versão

- Assinatura de código (Apple Developer / certificado Windows) para sumir com os avisos de segurança.
- Estilo por app (formal no e-mail, casual no WhatsApp) detectando a janela ativa.
- Command Mode: selecionar um texto e dizer "deixa mais formal".
- Whisper rodando embutido (whisper.cpp) para ficar 100% offline sem servidor separado.
- Manter o microfone "aquecido" para não perder a primeira sílaba.
