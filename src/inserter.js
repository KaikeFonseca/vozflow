// Insere texto no campo focado de qualquer app: copia para a área de transferência,
// simula Ctrl+V / Cmd+V e devolve o conteúdo anterior da área de transferência.
// É a mesma estratégia que apps de ditado usam ("paste into the active text field"),
// porque funciona em praticamente qualquer app sem integração específica.
const { clipboard } = require('electron');
const { uIOhook, UiohookKey } = require('uiohook-napi');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function insertText(text, { restoreClipboard = true } = {}) {
  if (!text) return;
  const previous = restoreClipboard
    ? { text: clipboard.readText(), html: clipboard.readHTML(), image: clipboard.readImage() }
    : null;

  clipboard.writeText(text);
  await wait(30);
  const mod = process.platform === 'darwin' ? UiohookKey.Meta : UiohookKey.Ctrl;
  uIOhook.keyTap(UiohookKey.V, [mod]);

  if (previous) {
    // Dá tempo do app de destino ler a área de transferência antes de restaurar.
    await wait(400);
    if (clipboard.readText() !== text) return; // o usuário copiou outra coisa nesse meio-tempo
    if (!previous.image.isEmpty()) clipboard.writeImage(previous.image);
    else if (previous.html) clipboard.write({ text: previous.text, html: previous.html });
    else clipboard.writeText(previous.text);
  }
}

module.exports = { insertText };
