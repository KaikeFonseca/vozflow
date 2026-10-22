const path = require('path');
const {
  app, BrowserWindow, Tray, Menu, ipcMain, screen, globalShortcut,
  nativeImage, systemPreferences, Notification, clipboard
} = require('electron');
const { uIOhook, UiohookKey } = require('uiohook-napi');
const settingsStore = require('./settings');
const { HotkeyMachine } = require('./hotkeys');
const { processAudio } = require('./transcribe');
const { insertText } = require('./inserter');
const { History } = require('./history');
const localWhisper = require('./localWhisper');

let widget = null;
let settingsWin = null;
let historyWin = null;
let tray = null;
let machine = null;
let maxTimer = null;
let history = null;

const WIDGET_SIZE = { idle: [56, 22], active: [180, 40] };

// Código de tecla do uiohook -> nome lógico usado nos combos.
const KEY_NAMES = (() => {
  const map = {};
  for (const [name, code] of Object.entries(UiohookKey)) map[code] = name;
  const alias = { CtrlRight: 'Ctrl', AltRight: 'Alt', MetaRight: 'Meta', ShiftRight: 'Shift' };
  for (const [name, code] of Object.entries(UiohookKey)) if (alias[name]) map[code] = alias[name];
  return map;
})();

function settings() {
  return settingsStore.load();
}

// ---------- Indicador flutuante ----------

function widgetBounds(state) {
  const [w, h] = WIDGET_SIZE[state === 'idle' ? 'idle' : 'active'];
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const m = 16;
  const pos = settings().widgetPosition;
  const x = pos.endsWith('left') ? area.x + m : pos.endsWith('right') ? area.x + area.width - w - m : area.x + (area.width - w) / 2;
  const y = pos.startsWith('top') ? area.y + m : area.y + area.height - h - m;
  return { x: Math.round(x), y: Math.round(y), width: w, height: h };
}

function createWidget() {
  widget = new BrowserWindow({
    ...widgetBounds('idle'),
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false, // nunca rouba o foco do campo onde o texto vai entrar
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });
  widget.setAlwaysOnTop(true, 'screen-saver');
  widget.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  widget.loadFile(path.join(__dirname, 'widget.html'));
  widget.once('ready-to-show', () => widget.showInactive());
}

function setWidgetState(state, extra = {}) {
  if (!widget) return;
  widget.setBounds(widgetBounds(state));
  widget.webContents.send('state', { state, ...extra });
}

// ---------- Fluxo de gravação ----------

function start(mode) {
  widget.webContents.send('record', 'start');
  setWidgetState('recording', { mode });
  clearTimeout(maxTimer);
  const max = settings().maxMinutes * 60_000;
  maxTimer = setTimeout(() => ['ptt', 'handsfree'].includes(machine.state) && machine.finish(), max);
}

function stop() {
  clearTimeout(maxTimer);
  setWidgetState('processing');
  widget.webContents.send('record', 'stop');
}

function cancel(reason) {
  clearTimeout(maxTimer);
  widget.webContents.send('record', 'cancel');
  setWidgetState(reason === 'tap' || reason === 'chord' ? 'idle' : 'cancelled');
  if (reason !== 'tap' && reason !== 'chord') setTimeout(() => machine.state === 'idle' && setWidgetState('idle'), 1500);
}

async function waitForModifiersReleased(timeout = 1500) {
  const t0 = Date.now();
  while (machine.down.size > 0 && Date.now() - t0 < timeout) await new Promise((r) => setTimeout(r, 30));
}

function checkApiKey(s) {
  if (s.stt.provider === 'local') return;
  if (!s.stt.apiKey && !/localhost|127\.0\.0\.1/.test(s.stt.baseUrl)) {
    throw new Error('Configure a chave da API de transcrição nas Configurações.');
  }
}

function broadcastHistory() {
  for (const win of [historyWin, settingsWin]) win?.webContents.send('history', history.list());
}

function lastText() {
  return history.list().find((i) => i.status === 'ok')?.text || '';
}

ipcMain.on('audio', async (_e, { buffer, mimeType, peak, durationMs }) => {
  const audio = Buffer.from(buffer);
  try {
    // Sem voz detectada: não cola nada (mesmo comportamento do Wispr).
    if (durationMs < 300 || peak < 0.02) {
      setWidgetState('empty');
      return;
    }
    const s = settings();
    let result;
    try {
      checkApiKey(s);
      result = await processAudio(audio, mimeType, s);
    } catch (err) {
      // Guarda o áudio para tentar de novo pelo histórico: a fala não se perde.
      history.add({ status: 'failed', text: '', error: String(err.message || err), mimeType, ext: mimeType.split('/')[1].split(';')[0] }, audio);
      broadcastHistory();
      throw err;
    }
    if (!result.text) {
      setWidgetState('empty');
      return;
    }
    // Salva no histórico ANTES de colar.
    history.add({ status: 'ok', text: result.text, raw: result.raw });
    broadcastHistory();
    await waitForModifiersReleased();
    await insertText(result.text, { restoreClipboard: s.restoreClipboard });
    setWidgetState('done');
  } catch (err) {
    console.error(err);
    setWidgetState('error', { message: String(err.message || err) });
    new Notification({
      title: 'VozFlow',
      body: `${err.message || err}\nO áudio ficou salvo no histórico para tentar de novo.`
    }).show();
  } finally {
    machine.setBusy(false);
    setTimeout(() => machine.state === 'idle' && setWidgetState('idle'), 1200);
  }
});

ipcMain.on('widget-click', (_e, action) => {
  if (action === 'history') return openHistory();
  if (action === 'cancel') {
    if (machine.state === 'ptt' || machine.state === 'handsfree') machine.abort('user');
  } else {
    machine.externalToggle();
  }
});

ipcMain.on('mic-error', (_e, message) => {
  machine.setBusy(false);
  setWidgetState('error', { message });
  new Notification({ title: 'VozFlow', body: `Microfone: ${message}` }).show();
});

// ---------- Atalhos ----------

function setupHotkeys() {
  const s = settings();
  machine = new HotkeyMachine({ pushToTalk: s.pushToTalk, handsFree: s.handsFree, doubleTap: s.doubleTap })
    .on('start', start)
    .on('stop', stop)
    .on('cancel', cancel)
    .on('mode', (mode) => setWidgetState('recording', { mode }));

  uIOhook.on('keydown', (e) => KEY_NAMES[e.keycode] && machine.keyDown(KEY_NAMES[e.keycode]));
  uIOhook.on('keyup', (e) => KEY_NAMES[e.keycode] && machine.keyUp(KEY_NAMES[e.keycode]));
  uIOhook.start();

  registerShortcuts();
}

function registerShortcuts() {
  globalShortcut.unregisterAll();
  const s = settings();
  const tryRegister = (accel, fn) => {
    if (!accel) return;
    try {
      if (!globalShortcut.register(accel, fn)) console.warn(`Atalho em uso por outro app: ${accel}`);
    } catch (err) {
      console.warn(`Atalho inválido: ${accel}`, err.message);
    }
  };
  tryRegister(s.pasteLast, async () => {
    const text = lastText();
    if (!text) return;
    await waitForModifiersReleased();
    insertText(text, { restoreClipboard: settings().restoreClipboard });
  });
  tryRegister(s.openHistory, openHistory);
}

// ---------- Histórico (últimas 10 falas) ----------

function openHistory() {
  if (historyWin) {
    historyWin.show();
    return historyWin.focus();
  }
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const [w, h] = [400, 520];
  historyWin = new BrowserWindow({
    width: w,
    height: h,
    x: area.x + area.width - w - 16,
    y: area.y + area.height - h - 64,
    title: 'VozFlow — Últimas falas',
    alwaysOnTop: true,
    minimizable: false,
    maximizable: false,
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });
  historyWin.loadFile(path.join(__dirname, 'history.html'));
  historyWin.on('closed', () => (historyWin = null));
}

ipcMain.handle('history:list', () => history.list());

ipcMain.handle('history:paste', async (_e, id) => {
  const item = history.get(id);
  if (!item?.text) return;
  // Esconde a janela para o foco voltar ao app onde o texto deve entrar.
  historyWin?.hide();
  if (process.platform === 'darwin') app.hide();
  await new Promise((r) => setTimeout(r, 250));
  await insertText(item.text, { restoreClipboard: settings().restoreClipboard });
  widget.showInactive(); // app.hide() no Mac também esconde o indicador
});

ipcMain.handle('history:retry', async (_e, id) => {
  const item = history.get(id);
  if (!item || item.status !== 'failed') return history.list();
  try {
    const s = settings();
    checkApiKey(s);
    const { text, raw } = await processAudio(history.readAudio(item), item.mimeType || 'audio/webm', s);
    history.update(id, { status: 'ok', text: text || '(sem fala)', raw });
  } catch (err) {
    history.update(id, { error: String(err.message || err) });
  }
  broadcastHistory();
  return history.list();
});

ipcMain.handle('history:clear', () => {
  history.clear();
  broadcastHistory();
  return [];
});

// ---------- Configurações e bandeja ----------

function openSettings() {
  if (settingsWin) return settingsWin.focus();
  settingsWin = new BrowserWindow({
    width: 620,
    height: 760,
    title: 'VozFlow — Configurações',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });
  settingsWin.loadFile(path.join(__dirname, 'settings.html'));
  settingsWin.on('closed', () => (settingsWin = null));
}

ipcMain.handle('settings:get', () => ({ settings: settings(), history: history.list(), platform: process.platform }));
ipcMain.handle('settings:save', (_e, next) => {
  const saved = settingsStore.save(next);
  if (saved.stt.provider === 'local') warmUpLocal(saved);
  else localWhisper.stop();
  machine.ptt = saved.pushToTalk;
  machine.hf = saved.handsFree;
  machine.dt = saved.doubleTap;
  registerShortcuts();
  setWidgetState('idle');
  return saved;
});
ipcMain.on('copy', (_e, text) => clipboard.writeText(text));

// ---------- Whisper embutido ----------

function warmUpLocal(s = settings()) {
  // Sobe o servidor já na abertura para o primeiro ditado não esperar o modelo carregar.
  localWhisper.start(s.stt.localModel).catch((err) => {
    console.error(err);
    new Notification({ title: 'VozFlow', body: String(err.message || err) }).show();
  });
}

ipcMain.handle('whisper:status', () => ({ models: localWhisper.modelsStatus(), log: localWhisper.logLines.slice(-40) }));
ipcMain.handle('whisper:download', async (e, key) => {
  await localWhisper.downloadModel(key, (p) => e.sender.send('whisper:progress', { key, p }));
  return localWhisper.modelsStatus();
});

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'tray.png'));
  if (process.platform === 'darwin') icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('VozFlow');
  tray.on('click', openHistory);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Começar / parar ditado', click: () => machine.externalToggle() },
    { label: 'Últimas falas…', click: openHistory },
    { label: 'Configurações…', click: openSettings },
    { type: 'separator' },
    { label: 'Sair', click: () => app.quit() }
  ]));
}

async function ensurePermissions() {
  if (process.platform !== 'darwin') return;
  await systemPreferences.askForMediaAccess('microphone');
  // Necessário para ouvir atalhos globais e simular Cmd+V.
  if (!systemPreferences.isTrustedAccessibilityClient(true)) {
    new Notification({
      title: 'VozFlow precisa de Acessibilidade',
      body: 'Ative o VozFlow em Ajustes do Sistema → Privacidade e Segurança → Acessibilidade e reabra o app.'
    }).show();
  }
}

if (!app.requestSingleInstanceLock()) app.quit();

app.whenReady().then(async () => {
  if (process.platform === 'darwin') app.dock.hide();
  history = new History(app.getPath('userData'));
  await ensurePermissions();
  createWidget();
  createTray();
  setupHotkeys();
  const s = settings();
  if (s.stt.provider === 'local') warmUpLocal(s);
  else if (!s.stt.apiKey) openSettings();
});

// App de bandeja: fechar a janela de configurações não encerra o app.
app.on('window-all-closed', () => {});
app.on('will-quit', () => {
  localWhisper.stop();
  globalShortcut.unregisterAll();
  uIOhook.stop();
});
