const test = require('node:test');
const assert = require('node:assert');
const { HotkeyMachine } = require('../src/hotkeys');

function setup() {
  let t = 1000;
  const events = [];
  const m = new HotkeyMachine({ pushToTalk: ['Ctrl', 'Meta'], handsFree: ['Ctrl', 'Meta', 'Space'], now: () => t });
  m.on('start', (mode) => events.push(`start:${mode}`))
    .on('stop', () => events.push('stop'))
    .on('cancel', (r) => events.push(`cancel:${r}`))
    .on('mode', (mode) => events.push(`mode:${mode}`));
  return { m, events, advance: (ms) => (t += ms) };
}

test('segurar e soltar o push-to-talk transcreve', () => {
  const { m, events, advance } = setup();
  m.keyDown('Ctrl'); m.keyDown('Meta');
  advance(1200);
  m.keyUp('Meta'); m.keyUp('Ctrl');
  assert.deepStrictEqual(events, ['start:ptt', 'stop']);
  assert.strictEqual(m.state, 'busy');
});

test('toque rápido é descartado e dois toques entram no hands-free', () => {
  const { m, events, advance } = setup();
  m.keyDown('Ctrl'); m.keyDown('Meta'); advance(100); m.keyUp('Meta'); m.keyUp('Ctrl');
  advance(150);
  m.keyDown('Ctrl'); m.keyDown('Meta'); advance(100); m.keyUp('Meta'); m.keyUp('Ctrl');
  assert.deepStrictEqual(events, ['start:ptt', 'cancel:tap', 'start:ptt', 'mode:handsfree']);
  assert.strictEqual(m.state, 'handsfree');
});

test('combo hands-free liga e desliga', () => {
  const { m, events, advance } = setup();
  m.keyDown('Ctrl'); m.keyDown('Meta'); m.keyDown('Space');
  m.keyUp('Space'); m.keyUp('Meta'); m.keyUp('Ctrl');
  assert.strictEqual(m.state, 'handsfree');
  advance(5000);
  m.keyDown('Ctrl'); m.keyDown('Meta'); m.keyDown('Space');
  assert.deepStrictEqual(events, ['start:ptt', 'mode:handsfree', 'stop']);
});

test('repetir o combo hands-free logo depois de começar cancela', () => {
  const { m, events, advance } = setup();
  m.keyDown('Ctrl'); m.keyDown('Space'); m.keyDown('Meta');
  m.keyUp('Space');
  advance(200);
  m.keyDown('Space');
  assert.deepStrictEqual(events, ['start:handsfree', 'cancel:quick']);
});

test('Esc cancela a gravação', () => {
  const { m, events, advance } = setup();
  m.keyDown('Ctrl'); m.keyDown('Meta'); advance(800);
  m.keyDown('Escape');
  assert.deepStrictEqual(events, ['start:ptt', 'cancel:user']);
});

test('outra tecla durante o push-to-talk é tratada como atalho comum', () => {
  const { m, events } = setup();
  m.keyDown('Ctrl'); m.keyDown('Meta'); m.keyDown('D');
  assert.deepStrictEqual(events, ['start:ptt', 'cancel:chord']);
});

test('auto-repeat do SO não reinicia a gravação', () => {
  const { m, events } = setup();
  m.keyDown('Ctrl'); m.keyDown('Meta'); m.keyDown('Meta'); m.keyDown('Ctrl');
  assert.deepStrictEqual(events, ['start:ptt']);
});

test('atalhos ignorados enquanto processa', () => {
  const { m, events, advance } = setup();
  m.keyDown('Ctrl'); m.keyDown('Meta'); advance(1000); m.keyUp('Meta'); m.keyUp('Ctrl');
  m.keyDown('Ctrl'); m.keyDown('Meta');
  assert.deepStrictEqual(events, ['start:ptt', 'stop']);
  m.keyUp('Meta'); m.keyUp('Ctrl');
  m.setBusy(false);
  m.keyDown('Ctrl'); m.keyDown('Meta');
  assert.deepStrictEqual(events, ['start:ptt', 'stop', 'start:ptt']);
});

function setupDoubleTap() {
  let t = 1000;
  const events = [];
  const m = new HotkeyMachine({
    pushToTalk: ['Ctrl', 'Meta'], handsFree: ['Ctrl', 'Meta', 'Space'], doubleTap: ['Ctrl'], now: () => t
  });
  m.on('start', (mode) => events.push(`start:${mode}`))
    .on('stop', () => events.push('stop'))
    .on('cancel', (r) => events.push(`cancel:${r}`));
  const tap = (key = 'Ctrl') => { m.keyDown(key); t += 80; m.keyUp(key); t += 120; };
  return { m, events, tap, advance: (ms) => (t += ms) };
}

test('Ctrl duplo liga e desliga o hands-free', () => {
  const { m, events, tap, advance } = setupDoubleTap();
  tap(); tap();
  assert.deepStrictEqual(events, ['start:handsfree']);
  advance(3000);
  tap(); tap();
  assert.deepStrictEqual(events, ['start:handsfree', 'stop']);
  assert.strictEqual(m.state, 'busy');
});

test('Ctrl+C duas vezes não liga o hands-free', () => {
  const { m, events } = setupDoubleTap();
  for (let i = 0; i < 2; i++) { m.keyDown('Ctrl'); m.keyDown('C'); m.keyUp('C'); m.keyUp('Ctrl'); }
  assert.deepStrictEqual(events, []);
});

test('dois toques de Ctrl muito separados não contam', () => {
  const { events, tap, advance } = setupDoubleTap();
  tap(); advance(900); tap();
  assert.deepStrictEqual(events, []);
});

test('segurar Ctrl sozinho não conta como toque', () => {
  const { m, events, tap, advance } = setupDoubleTap();
  m.keyDown('Ctrl'); advance(600); m.keyUp('Ctrl'); advance(100);
  tap();
  assert.deepStrictEqual(events, []);
});

test('toque duplo pode ser desativado', () => {
  const m = new HotkeyMachine({ pushToTalk: ['Ctrl', 'Meta'], handsFree: [], doubleTap: [] });
  const events = [];
  m.on('start', (x) => events.push(x));
  m.keyDown('Ctrl'); m.keyUp('Ctrl'); m.keyDown('Ctrl'); m.keyUp('Ctrl'); m.keyDown('Space');
  assert.deepStrictEqual(events, []);
});
