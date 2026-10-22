// Configurações persistidas em <userData>/settings.json.
// Chaves de API são criptografadas com o cofre do sistema (safeStorage) quando disponível.
const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

const isMac = process.platform === 'darwin';

const DEFAULTS = {
  // Segure para falar; solte para transcrever. Toque duas vezes para entrar no hands-free.
  pushToTalk: isMac ? ['Ctrl', 'Alt'] : ['Ctrl', 'Meta'],
  // Pressione para começar e de novo para parar.
  handsFree: isMac ? ['Ctrl', 'Alt', 'Space'] : ['Ctrl', 'Meta', 'Space'],
  // Toque duplo rápido liga/desliga o hands-free. [] desativa.
  doubleTap: ['Ctrl'],
  pasteLast: isMac ? 'Command+Control+V' : 'Shift+Alt+Z',
  openHistory: isMac ? 'Command+Control+H' : 'Shift+Alt+H',
  // pt-en = detecta sozinho entre português e inglês (e frases misturadas).
  language: 'pt-en',
  stt: {
    // Qualquer API compatível com /audio/transcriptions da OpenAI:
    // Groq, OpenAI ou um servidor Whisper local (ex.: speaches / faster-whisper-server).
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'whisper-large-v3-turbo',
    apiKey: ''
  },
  cleanup: {
    // none | anthropic | openai (openai = qualquer /chat/completions compatível)
    provider: 'none',
    style: 'natural',
    anthropicModel: 'claude-haiku-5-5',
    anthropicKey: '',
    openaiBaseUrl: 'https://api.groq.com/openai/v1',
    openaiModel: 'llama-3.3-70b-versatile',
    openaiKey: ''
  },
  dictionary: [],
  snippets: [],
  widgetPosition: 'bottom-right',
  widgetOffset: null,
  sounds: true,
  restoreClipboard: true,
  maxMinutes: 20
};

const SECRET_PATHS = [['stt', 'apiKey'], ['cleanup', 'anthropicKey'], ['cleanup', 'openaiKey']];

function file() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function merge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object'
      ? merge(base[k], v)
      : v;
  }
  return out;
}

function mapSecrets(obj, fn) {
  const copy = JSON.parse(JSON.stringify(obj));
  for (const [a, b] of SECRET_PATHS) {
    if (copy[a] && copy[a][b]) copy[a][b] = fn(copy[a][b]);
  }
  return copy;
}

function encrypt(s) {
  if (!safeStorage.isEncryptionAvailable()) return s;
  return 'enc:' + safeStorage.encryptString(s).toString('base64');
}

function decrypt(s) {
  if (!s.startsWith('enc:')) return s;
  try {
    return safeStorage.decryptString(Buffer.from(s.slice(4), 'base64'));
  } catch {
    return '';
  }
}

let cache = null;

function load() {
  if (cache) return cache;
  let raw = {};
  try {
    raw = JSON.parse(fs.readFileSync(file(), 'utf8'));
  } catch {}
  cache = mapSecrets(merge(DEFAULTS, raw), decrypt);
  return cache;
}

function save(next) {
  cache = merge(DEFAULTS, next);
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(mapSecrets(cache, encrypt), null, 2));
  return cache;
}

module.exports = { load, save, DEFAULTS };
