const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { HttpError } = require('../lib/http');
const { UPLOAD_ROOT } = require('./media');

// Envio de arquivos grandes em partes. O proxy da VPS corta requisições que
// levam mais de 60s para chegar; um PDF de ficha de 75 MB pela rede do
// celular não passa inteiro. Em partes de ~2 MB, cada requisição é curta.
const router = express.Router();

const TMP_DIR = path.join(UPLOAD_ROOT, 'tmp');
fs.mkdirSync(TMP_DIR, { recursive: true });

const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
const MAX_CHUNK_BYTES = 8 * 1024 * 1024;
const TTL_MS = 60 * 60 * 1000;
const uploads = new Map(); // id → { userId, size, received, nextIndex, file, mimeType, createdAt }

function discard(id) {
  const u = uploads.get(id);
  if (!u) return;
  uploads.delete(id);
  fs.unlink(u.file, () => {});
}

// Envios abandonados há mais de 1h são apagados.
setInterval(() => {
  for (const [id, u] of uploads) if (Date.now() - u.createdAt > TTL_MS) discard(id);
}, 10 * 60 * 1000).unref();

function getOwned(req) {
  const u = uploads.get(req.params.id);
  if (!u || u.userId !== req.userId) throw new HttpError(404, 'Envio não encontrado ou expirado. Tente de novo.');
  return u;
}

router.post('/', (req, res) => {
  const size = Number(req.body?.size);
  const mimeType = String(req.body?.mimeType || '');
  if (!Number.isInteger(size) || size <= 0) throw new HttpError(400, 'size inválido');
  if (size > MAX_UPLOAD_BYTES) throw new HttpError(413, 'Arquivo grande demais (máx. 200 MB).');
  if (mimeType !== 'application/pdf') throw new HttpError(400, 'Só PDFs podem ser enviados em partes');
  const id = crypto.randomUUID();
  uploads.set(id, { userId: req.userId, size, received: 0, nextIndex: 0, mimeType, file: path.join(TMP_DIR, id), createdAt: Date.now() });
  res.json({ id });
});

// Quanto já chegou — para o app retomar um envio interrompido.
router.get('/:id', (req, res) => {
  const u = getOwned(req);
  res.json({ received: u.received, nextIndex: u.nextIndex, size: u.size });
});

// Parte em binário puro (application/octet-stream) ou, em versões antigas do
// app, base64 dentro do JSON. Reenviar uma parte já recebida é aceito
// (idempotente), para o app poder repetir após uma falha de rede.
router.put('/:id/chunks/:index', express.raw({ type: 'application/octet-stream', limit: '8mb' }), async (req, res) => {
  const u = getOwned(req);
  const index = parseInt(req.params.index, 10);
  if (!Number.isInteger(index) || index < 0) throw new HttpError(400, 'index inválido');
  if (index < u.nextIndex) return res.json({ received: u.received });
  if (index > u.nextIndex) throw new HttpError(409, `Parte fora de ordem (esperada ${u.nextIndex})`);
  const data = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body?.data || ''), 'base64');
  if (!data.length || data.length > MAX_CHUNK_BYTES) throw new HttpError(400, 'Parte inválida');
  if (u.received + data.length > u.size) throw new HttpError(400, 'Parte excede o tamanho declarado');
  await fs.promises.appendFile(u.file, data);
  u.received += data.length;
  u.nextIndex += 1;
  res.json({ received: u.received });
});

// Entrega o arquivo completo a quem vai processá-lo e apaga o temporário.
async function consumeUpload(req, id) {
  const u = uploads.get(id);
  if (!u || u.userId !== req.userId) throw new HttpError(404, 'Envio não encontrado ou expirado. Tente de novo.');
  if (u.received !== u.size) throw new HttpError(400, 'Envio incompleto. Tente de novo.');
  try {
    return { buffer: await fs.promises.readFile(u.file), mimeType: u.mimeType };
  } finally {
    discard(id);
  }
}

module.exports = router;
module.exports.consumeUpload = consumeUpload;
