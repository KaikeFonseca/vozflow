const test = require('node:test');
const assert = require('node:assert');
const { applySnippets, cleanupPrompt, whisperPrompt } = require('../src/transcribe');

const snippets = [{ trigger: 'meu email', text: 'kaike@exemplo.com' }];

test('ditado que é só o gatilho vira o snippet', () => {
  assert.strictEqual(applySnippets('Meu email.', snippets), 'kaike@exemplo.com');
});

test('gatilho no meio da frase é substituído', () => {
  assert.strictEqual(applySnippets('Pode mandar para meu email hoje', snippets), 'Pode mandar para kaike@exemplo.com hoje');
});

test('prompt de limpeza inclui o dicionário e o estilo', () => {
  const p = cleanupPrompt({ dictionary: ['Supabase'], cleanup: { style: 'formal' } });
  assert.match(p, /Supabase/);
  assert.match(p, /formal/);
});

test('modo português + inglês manda um prompt bilíngue ao Whisper', () => {
  const p = whisperPrompt({ language: 'pt-en', dictionary: ['Kaike'] });
  assert.match(p, /tudo bem/);
  assert.match(p, /how are you/);
  assert.match(p, /Kaike/);
  assert.strictEqual(whisperPrompt({ language: 'pt', dictionary: [] }), '');
});
