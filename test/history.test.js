const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { History } = require('../src/history');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'vozflow-'));

test('guarda só as últimas 10 falas, a mais recente primeiro', () => {
  const h = new History(tmp());
  for (let i = 1; i <= 12; i++) h.add({ text: `fala ${i}`, status: 'ok' });
  assert.strictEqual(h.list().length, 10);
  assert.strictEqual(h.list()[0].text, 'fala 12');
  assert.strictEqual(h.list()[9].text, 'fala 3');
});

test('persiste em disco e recarrega', () => {
  const dir = tmp();
  new History(dir).add({ text: 'olá', status: 'ok' });
  assert.strictEqual(new History(dir).list()[0].text, 'olá');
});

test('áudio de falha é salvo e apagado quando a fala sai do histórico ou dá certo', () => {
  const dir = tmp();
  const h = new History(dir, 2);
  const failed = h.add({ text: '', status: 'failed', error: 'rede', ext: 'webm' }, Buffer.from('audio'));
  assert.strictEqual(h.readAudio(failed).toString(), 'audio');
  h.update(failed.id, { status: 'ok', text: 'recuperado' });
  assert.strictEqual(fs.readdirSync(path.join(dir, 'failed-audio')).length, 0);

  const f2 = h.add({ status: 'failed', ext: 'webm' }, Buffer.from('x'));
  h.add({ text: 'a', status: 'ok' });
  h.add({ text: 'b', status: 'ok' });
  assert.ok(!h.get(f2.id));
  assert.strictEqual(fs.readdirSync(path.join(dir, 'failed-audio')).length, 0);
});
