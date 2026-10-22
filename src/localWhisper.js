// Whisper embutido: roda o whisper-server (whisper.cpp) como processo filho, só em 127.0.0.1,
// com o modelo carregado na memória para cada ditado sair rápido. Funciona sem internet e sem chave.
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { app } = require('electron');

// Modelos multilíngues do whisper.cpp (português + inglês).
const MODELS = {
  small: {
    file: 'ggml-small-q5_1.bin',
    label: 'Padrão (small, já vem no app)',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin'
  },
  turbo: {
    file: 'ggml-large-v3-turbo-q5_0.bin',
    label: 'Melhor qualidade (large-v3-turbo, ~550 MB, mais lento sem placa de vídeo)',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin'
  }
};

const osName = { win32: 'win', darwin: 'mac', linux: 'linux' }[process.platform];

// Empacotado: <resources>/whisper e <resources>/models. Em desenvolvimento: bin/<os>-<arch> e models/ do repositório.
function binaryPath() {
  const exe = process.platform === 'win32' ? 'whisper-server.exe' : 'whisper-server';
  return app.isPackaged
    ? path.join(process.resourcesPath, 'whisper', exe)
    : path.join(__dirname, '..', 'bin', `${osName}-${process.arch}`, exe);
}

function bundledModelsDir() {
  return app.isPackaged ? path.join(process.resourcesPath, 'models') : path.join(__dirname, '..', 'models');
}

function userModelsDir() {
  return path.join(app.getPath('userData'), 'models');
}

function modelPath(key) {
  const { file } = MODELS[key] || MODELS.small;
  for (const dir of [userModelsDir(), bundledModelsDir()]) {
    const p = path.join(dir, file);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

let proc = null;
let ready = null; // Promise<string> com a URL base do servidor
let runningModel = null;

async function waitHealthy(base, child, timeoutMs = 120_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (child.exitCode !== null) throw new Error('O Whisper local fechou ao iniciar. Veja o log em Configurações.');
    try {
      const res = await fetch(`${base}/health`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('O Whisper local demorou demais para iniciar.');
}

const logLines = [];
function log(chunk) {
  for (const line of String(chunk).split(/\r?\n/)) if (line.trim()) logLines.push(line);
  logLines.splice(0, Math.max(0, logLines.length - 200));
}

function start(modelKey = 'small') {
  if (ready && runningModel === modelKey) return ready;
  stop();
  runningModel = modelKey;
  const p = (async () => {
    const bin = binaryPath();
    if (!fs.existsSync(bin)) throw new Error(`Whisper local não encontrado em ${bin}.`);
    const model = modelPath(modelKey);
    if (!model) throw new Error('Modelo do Whisper não encontrado. Baixe um modelo em Configurações.');
    const port = await freePort();
    const threads = Math.max(2, Math.min(8, Math.floor(os.cpus().length / 2)));
    const child = spawn(bin, ['-m', model, '-l', 'auto', '-t', String(threads), '--host', '127.0.0.1', '--port', String(port), '-nt'], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    proc = child;
    child.stdout.on('data', log);
    child.stderr.on('data', log);
    child.on('exit', (code) => {
      log(`whisper-server saiu com código ${code}`);
      if (proc === child) {
        proc = null;
        ready = null;
      }
    });
    const base = `http://127.0.0.1:${port}`;
    await waitHealthy(base, child);
    return base;
  })();
  ready = p;
  p.catch(() => {
    if (ready === p) ready = null;
  });
  return p;
}

function stop() {
  if (proc) proc.kill();
  proc = null;
  ready = null;
}

async function transcribeLocal(wav, settings) {
  const base = await start(settings.stt.localModel);
  const form = new FormData();
  form.append('file', new Blob([wav], { type: 'audio/wav' }), 'audio.wav');
  form.append('response_format', 'json');
  form.append('temperature', '0.0');
  form.append('temperature_inc', '0.2');
  form.append('language', ['pt', 'en', 'es'].includes(settings.language) ? settings.language : 'auto');
  if (settings.whisperPrompt) form.append('prompt', settings.whisperPrompt);
  const res = await fetch(`${base}/inference`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`Whisper local falhou (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  if (data.error) throw new Error(`Whisper local: ${data.error}`);
  return (data.text || '').trim();
}

// Baixa um modelo maior para <userData>/models, com progresso de 0 a 1.
async function downloadModel(key, onProgress) {
  const m = MODELS[key];
  if (!m) throw new Error(`Modelo desconhecido: ${key}`);
  fs.mkdirSync(userModelsDir(), { recursive: true });
  const dest = path.join(userModelsDir(), m.file);
  const tmp = `${dest}.part`;
  const res = await fetch(m.url);
  if (!res.ok || !res.body) throw new Error(`Download falhou (${res.status}).`);
  const total = Number(res.headers.get('content-length')) || 0;
  const out = fs.createWriteStream(tmp);
  let done = 0;
  for await (const chunk of res.body) {
    done += chunk.length;
    if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
    if (total) onProgress?.(done / total);
  }
  await new Promise((r, j) => out.end((err) => (err ? j(err) : r())));
  fs.renameSync(tmp, dest);
  return dest;
}

function modelsStatus() {
  return Object.fromEntries(Object.entries(MODELS).map(([k, m]) => [k, { label: m.label, installed: !!modelPath(k) }]));
}

module.exports = { start, stop, transcribeLocal, downloadModel, modelsStatus, logLines, MODELS };
