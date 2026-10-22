// Histórico das últimas falas, salvo em disco ANTES de colar, para nada se perder.
// Guarda só as últimas MAX; as mais antigas vão sendo apagadas sozinhas.
// Quando a transcrição falha, o áudio fica salvo para dar para tentar de novo.
const fs = require('fs');
const path = require('path');

const MAX = 10;

class History {
  constructor(dir, max = MAX) {
    this.dir = dir;
    this.max = max;
    this.file = path.join(dir, 'history.json');
    this.audioDir = path.join(dir, 'failed-audio');
    try {
      this.items = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      this.items = [];
    }
  }

  list() {
    return this.items;
  }

  get(id) {
    return this.items.find((i) => i.id === id);
  }

  add(entry, audio) {
    const item = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, at: new Date().toISOString(), ...entry };
    if (audio) {
      fs.mkdirSync(this.audioDir, { recursive: true });
      item.audio = `${item.id}.${entry.ext || 'webm'}`;
      fs.writeFileSync(path.join(this.audioDir, item.audio), audio);
    }
    delete item.ext;
    this.items.unshift(item);
    for (const old of this.items.splice(this.max)) this.removeAudio(old);
    this.persist();
    return item;
  }

  update(id, patch) {
    const item = this.get(id);
    if (!item) return null;
    Object.assign(item, patch);
    if (patch.status === 'ok') {
      this.removeAudio(item);
      delete item.audio;
      delete item.error;
    }
    this.persist();
    return item;
  }

  readAudio(item) {
    return item.audio ? fs.readFileSync(path.join(this.audioDir, item.audio)) : null;
  }

  clear() {
    for (const item of this.items) this.removeAudio(item);
    this.items = [];
    this.persist();
  }

  removeAudio(item) {
    if (!item.audio) return;
    try {
      fs.unlinkSync(path.join(this.audioDir, item.audio));
    } catch {}
  }

  persist() {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.items, null, 2));
  }
}

module.exports = { History, MAX };
