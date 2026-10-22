// Máquina de estados dos atalhos, sem dependência do Electron (testável com node --test).
// Recebe teclas já normalizadas ('Ctrl', 'Alt', 'Meta', 'Shift', 'Space', 'Escape', 'A'...)
// e emite: start(mode), stop(), cancel().
//
// Comportamento (espelha o que a documentação pública do Wispr Flow descreve):
// - Segurar o combo de push-to-talk grava; soltar transcreve e cola.
// - Toque rápido (< TAP_MS) não conta como fala. Dois toques em < DOUBLE_TAP_MS entram no hands-free.
// - Combo hands-free (ex.: Ctrl+Win+Space) começa; o mesmo combo de novo para.
// - Se o combo hands-free for repetido em < CANCEL_WINDOW_MS depois de começar, cancela em vez de colar.
// - Esc cancela qualquer gravação.
// - Toque duplo "limpo" no combo doubleTap (ex.: só Ctrl) liga e desliga o hands-free.
//   Limpo = apertar e soltar rápido sem nenhuma outra tecla no meio, então Ctrl+C não conta.

const TAP_MS = 250;
const DOUBLE_TAP_MS = 500;
const CANCEL_WINDOW_MS = 500;

class HotkeyMachine {
  constructor({ pushToTalk, handsFree, doubleTap = [], now = Date.now }) {
    this.ptt = pushToTalk;
    this.hf = handsFree;
    this.dt = doubleTap;
    this.dtStart = 0; // quando o combo de toque duplo ficou pressionado (0 = toque "sujo" ou nenhum)
    this.dtLastTap = 0;
    this.now = now;
    this.down = new Set();
    this.state = 'idle'; // idle | ptt | handsfree | busy
    this.startedAt = 0;
    this.lastTapAt = 0;
    this.listeners = {};
  }

  on(evt, fn) {
    this.listeners[evt] = fn;
    return this;
  }

  emit(evt, ...args) {
    if (this.listeners[evt]) this.listeners[evt](...args);
  }

  // O app avisa quando terminou de processar, para liberar novos atalhos.
  setBusy(busy) {
    this.state = busy ? 'busy' : 'idle';
  }

  // Início/fim vindos de fora (clique no indicador).
  externalToggle() {
    if (this.state === 'idle') this.begin('handsfree');
    else if (this.state === 'ptt' || this.state === 'handsfree') this.finish();
  }

  held(combo) {
    return combo.length > 0 && combo.every((k) => this.down.has(k));
  }

  // O toque duplo só é tratado aqui quando é um combo diferente do push-to-talk
  // (o push-to-talk já tem o próprio toque duplo em keyUp).
  usesSeparateDoubleTap() {
    return this.dt.length > 0 && this.dt.join('+') !== this.ptt.join('+');
  }

  trackDoubleTapDown(key) {
    if (!this.usesSeparateDoubleTap()) return;
    const exact = this.down.size === this.dt.length && this.held(this.dt);
    if (exact && this.dt.includes(key)) this.dtStart = this.now();
    else this.dtStart = 0;
  }

  trackDoubleTapUp(key) {
    if (!this.usesSeparateDoubleTap() || !this.dt.includes(key) || !this.dtStart) return;
    const t = this.now();
    const clean = t - this.dtStart < TAP_MS;
    this.dtStart = 0;
    if (!clean) return (this.dtLastTap = 0);
    if (t - this.dtLastTap < DOUBLE_TAP_MS) {
      this.dtLastTap = 0;
      if (this.state === 'idle') this.begin('handsfree');
      else if (this.state === 'handsfree' || this.state === 'ptt') this.finish();
    } else {
      this.dtLastTap = t;
    }
  }

  begin(mode) {
    this.state = mode;
    this.startedAt = this.now();
    this.emit('start', mode);
  }

  finish() {
    this.state = 'busy';
    this.emit('stop');
  }

  abort(reason = 'user') {
    this.state = 'idle';
    this.emit('cancel', reason);
  }

  keyDown(key) {
    if (this.down.has(key)) return; // auto-repeat do SO
    this.down.add(key);
    this.trackDoubleTapDown(key);

    if (key === 'Escape' && (this.state === 'ptt' || this.state === 'handsfree')) {
      this.abort();
      return;
    }
    if (this.state === 'busy') return;

    const hfJustPressed = this.hf.includes(key) && this.held(this.hf);
    if (hfJustPressed) {
      if (this.state === 'idle') return this.begin('handsfree');
      if (this.state === 'ptt') {
        // Segurou o push-to-talk e apertou Space: trava em hands-free.
        this.state = 'handsfree';
        this.emit('mode', 'handsfree');
        return;
      }
      if (this.state === 'handsfree') {
        return this.now() - this.startedAt < CANCEL_WINDOW_MS ? this.abort('quick') : this.finish();
      }
    }

    if (this.state === 'idle' && this.ptt.includes(key) && this.held(this.ptt)) {
      // Teclas extras (que não fazem parte de nenhum combo) indicam outro atalho do usuário, ex.: Ctrl+Alt+T.
      const extras = [...this.down].filter((k) => !this.ptt.includes(k) && !this.hf.includes(k));
      if (extras.length === 0) this.begin('ptt');
      return;
    }

    if (this.state === 'ptt' && !this.ptt.includes(key) && !this.hf.includes(key)) {
      // Outra tecla no meio do push-to-talk: era um atalho comum, não ditado.
      this.abort('chord');
    }
  }

  keyUp(key) {
    const wasDown = this.down.delete(key);
    if (wasDown) this.trackDoubleTapUp(key);
    if (this.state !== 'ptt' || !this.ptt.includes(key)) return;

    const t = this.now();
    if (t - this.startedAt < TAP_MS) {
      const isDouble = t - this.lastTapAt < DOUBLE_TAP_MS;
      this.lastTapAt = isDouble ? 0 : t;
      if (isDouble) {
        // Já estamos gravando desde o segundo toque: continua em hands-free.
        this.state = 'handsfree';
        this.startedAt = t;
        this.emit('mode', 'handsfree');
      } else {
        this.abort('tap');
      }
      return;
    }
    this.finish();
  }
}

module.exports = { HotkeyMachine, TAP_MS, DOUBLE_TAP_MS, CANCEL_WINDOW_MS };
