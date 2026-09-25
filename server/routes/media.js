const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { pool } = require('../db');
const { HttpError } = require('../lib/http');

const router = express.Router();

// Precisa de volume Docker persistente montado em UPLOAD_DIR (ver
// docker-compose.yml) — sem isso, os arquivos somem a cada deploy.
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads/exercise-videos');
const CHAT_IMAGE_DIR = process.env.CHAT_IMAGE_DIR || path.join(UPLOAD_DIR, '..', 'chat-images');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(CHAT_IMAGE_DIR, { recursive: true });

// Limites de armazenamento por usuário.
const VIDEO_QUOTA_BYTES = Number(process.env.VIDEO_QUOTA_BYTES) || 1024 * 1024 * 1024; // 1 GB
const IMAGE_QUOTA_BYTES = Number(process.env.IMAGE_QUOTA_BYTES) || 300 * 1024 * 1024; // 300 MB
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/heic': '.heic' };

const videoUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname || '').slice(0, 10)}`),
  }),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('video/')) return cb(new Error('Arquivo precisa ser um vídeo'));
    cb(null, true);
  },
});

async function usedBytes(table, userId) {
  const { rows } = await pool.query(`SELECT COALESCE(SUM(size_bytes), 0)::bigint AS total FROM ${table} WHERE user_id=$1`, [userId]);
  return Number(rows[0]?.total ?? 0);
}

function unlinkQuiet(file) {
  fs.unlink(file, () => {});
}

function removeFiles({ videos = [], images = [] }) {
  videos.forEach((f) => unlinkQuiet(path.join(UPLOAD_DIR, f)));
  images.forEach((f) => unlinkQuiet(path.join(CHAT_IMAGE_DIR, f)));
}

// ── Vídeos de exercício ───────────────────────────────────
router.post('/exercise-videos', (req, res, next) => {
  videoUpload.single('video')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Arquivo de vídeo é obrigatório' });
    const filePath = path.join(UPLOAD_DIR, req.file.filename);
    try {
      if ((await usedBytes('exercise_videos', req.userId)) + req.file.size > VIDEO_QUOTA_BYTES) {
        unlinkQuiet(filePath);
        return res.status(413).json({ error: 'Limite de armazenamento de vídeos atingido. Remova vídeos antigos para enviar novos.' });
      }
      const id = crypto.randomUUID();
      await pool.query(
        'INSERT INTO exercise_videos (id, user_id, filename, mime_type, size_bytes) VALUES ($1,$2,$3,$4,$5)',
        [id, req.userId, req.file.filename, req.file.mimetype, req.file.size]
      );
      res.json({ id });
    } catch (e) {
      unlinkQuiet(filePath);
      next(e);
    }
  });
});

router.get('/exercise-videos/:id/file', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT filename, mime_type FROM exercise_videos WHERE id=$1 AND user_id=$2',
    [req.params.id, req.userId]
  );
  if (!rows.length) return res.status(404).end();
  res.sendFile(path.join(UPLOAD_DIR, rows[0].filename), (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
});

router.delete('/exercise-videos/:id', async (req, res) => {
  const { rows } = await pool.query(
    'DELETE FROM exercise_videos WHERE id=$1 AND user_id=$2 RETURNING filename',
    [req.params.id, req.userId]
  );
  if (!rows.length) throw new HttpError(404, 'Vídeo não encontrado');
  unlinkQuiet(path.join(UPLOAD_DIR, rows[0].filename));
  res.json({ ok: true });
});

// ── Imagens do chat ───────────────────────────────────────
// Antes a imagem só existia como arquivo local do aparelho (imageUri) e
// sumia ao recarregar a conversa ou trocar de aparelho.
router.post('/chat-images', async (req, res) => {
  const { imageBase64, mimeType } = req.body || {};
  const ext = IMAGE_TYPES[mimeType];
  if (!ext) throw new HttpError(400, 'Formato de imagem não suportado');
  if (typeof imageBase64 !== 'string' || !imageBase64) throw new HttpError(400, 'imageBase64 é obrigatório');
  const buffer = Buffer.from(imageBase64, 'base64');
  if (buffer.length > MAX_IMAGE_BYTES) throw new HttpError(413, 'Imagem grande demais (máx. 8 MB)');
  if ((await usedBytes('chat_images', req.userId)) + buffer.length > IMAGE_QUOTA_BYTES) {
    throw new HttpError(413, 'Limite de armazenamento de imagens atingido. Limpe a conversa para liberar espaço.');
  }
  const id = crypto.randomUUID();
  const filename = `${id}${ext}`;
  await fs.promises.writeFile(path.join(CHAT_IMAGE_DIR, filename), buffer);
  try {
    await pool.query(
      'INSERT INTO chat_images (id, user_id, filename, mime_type, size_bytes) VALUES ($1,$2,$3,$4,$5)',
      [id, req.userId, filename, mimeType, buffer.length]
    );
  } catch (e) {
    unlinkQuiet(path.join(CHAT_IMAGE_DIR, filename));
    throw e;
  }
  res.json({ id });
});

router.get('/chat-images/:id/file', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT filename, mime_type FROM chat_images WHERE id=$1 AND user_id=$2',
    [req.params.id, req.userId]
  );
  if (!rows.length) return res.status(404).end();
  res.type(rows[0].mime_type);
  res.sendFile(path.join(CHAT_IMAGE_DIR, rows[0].filename), (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
});

// ── Limpeza de órfãos ─────────────────────────────────────
// Remove (1) vídeos que nenhuma ficha — ativa ou arquivada — referencia,
// (2) imagens que nenhuma mensagem referencia e (3) arquivos no disco sem
// registro no banco. Só mexe no que tem mais de 1 dia, para não apagar um
// upload cuja ficha/mensagem ainda está sendo salva.
async function cleanupOrphans() {
  const videos = await pool.query(`
    DELETE FROM exercise_videos v
    WHERE v.created_at < NOW() - INTERVAL '1 day'
      AND NOT EXISTS (
        SELECT 1 FROM workout_plans p, jsonb_array_elements(p.exercises) e
        WHERE p.user_id = v.user_id AND e->>'videoId' = v.id
      )
    RETURNING filename`);
  const images = await pool.query(`
    DELETE FROM chat_images i
    WHERE i.created_at < NOW() - INTERVAL '1 day'
      AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.user_id = i.user_id AND m.image_id = i.id)
    RETURNING filename`);
  removeFiles({ videos: videos.rows.map((r) => r.filename), images: images.rows.map((r) => r.filename) });

  let strayFiles = 0;
  const dayAgo = Date.now() - 86400000;
  for (const [dir, table] of [[UPLOAD_DIR, 'exercise_videos'], [CHAT_IMAGE_DIR, 'chat_images']]) {
    const { rows } = await pool.query(`SELECT filename FROM ${table}`);
    const known = new Set(rows.map((r) => r.filename));
    for (const name of await fs.promises.readdir(dir)) {
      if (known.has(name)) continue;
      const stat = await fs.promises.stat(path.join(dir, name)).catch(() => null);
      if (stat?.isFile() && stat.mtimeMs < dayAgo) {
        unlinkQuiet(path.join(dir, name));
        strayFiles++;
      }
    }
  }
  const total = videos.rowCount + images.rowCount + strayFiles;
  if (total) console.log(`[limpeza] ${videos.rowCount} vídeo(s), ${images.rowCount} imagem(ns) e ${strayFiles} arquivo(s) solto(s) removidos`);
  return { videos: videos.rowCount, images: images.rowCount, strayFiles };
}

module.exports = router;
module.exports.cleanupOrphans = cleanupOrphans;
module.exports.removeFiles = removeFiles;
