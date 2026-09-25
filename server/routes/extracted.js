const express = require('express');
const { pool, withTransaction } = require('../db');
const { HttpError, text, oneOf, arrayOf } = require('../lib/http');
const { CATEGORIES } = require('../ai/providers');

const router = express.Router();

// Origem de cada registro do Diário (mostrada na tela, e permite ao usuário
// entender de onde veio uma extração errada antes de corrigir/excluir).
const SOURCES = ['chat', 'manual', 'apple_health', 'health_connect', 'meal_checkin', 'workout_checkin'];

function toClient(r) {
  return {
    id: r.id,
    category: r.category,
    label: r.label,
    value: r.value,
    rawText: r.raw_text || '',
    timestamp: Number(r.timestamp),
    source: r.source || undefined,
    messageId: r.message_id || undefined,
  };
}

function validateItem(d) {
  if (!d || typeof d !== 'object') throw new HttpError(400, 'registro inválido');
  if (!Number.isFinite(d.timestamp)) throw new HttpError(400, 'timestamp inválido');
  return {
    category: oneOf(d.category, 'category', CATEGORIES),
    label: text(d.label, 'label', { max: 200 }),
    value: text(d.value, 'value', { max: 500 }),
    rawText: text(d.rawText, 'rawText', { max: 1000, optional: true }) || '',
    timestamp: d.timestamp,
    source: oneOf(d.source, 'source', SOURCES, { optional: true, fallback: 'manual' }),
    sourceRef: text(d.sourceRef, 'sourceRef', { max: 200, optional: true }),
  };
}

// Com sourceRef, grava de forma idempotente (substitui o registro com o mesmo
// sourceRef): sincronizar o Apple Saúde de novo atualiza em vez de duplicar.
async function insertItem(db, userId, d, messageId = null) {
  const { rows } = await db.query(
    `INSERT INTO extracted_data (user_id, category, label, value, raw_text, timestamp, source, source_ref, message_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (user_id, source_ref) WHERE source_ref IS NOT NULL DO UPDATE SET
       category = EXCLUDED.category, label = EXCLUDED.label, value = EXCLUDED.value,
       raw_text = EXCLUDED.raw_text, timestamp = EXCLUDED.timestamp, source = EXCLUDED.source
     RETURNING id`,
    [userId, d.category, d.label, d.value, d.rawText, d.timestamp, d.source, d.sourceRef || null, messageId]
  );
  return rows[0].id;
}

// Substitui os registros extraídos de uma mensagem (idempotente: reprocessar
// a mesma mensagem não duplica) e marca a mensagem como processada.
async function replaceMessageExtraction(userId, messageId, items) {
  return withTransaction(async (db) => {
    const { rows } = await db.query(
      'SELECT timestamp FROM messages WHERE id=$1 AND user_id=$2 FOR UPDATE',
      [messageId, userId]
    );
    if (!rows.length) throw new HttpError(404, 'Mensagem não encontrada');
    const base = Number(rows[0].timestamp);
    await db.query('DELETE FROM extracted_data WHERE user_id=$1 AND message_id=$2', [userId, messageId]);
    const saved = [];
    for (const [i, d] of items.entries()) {
      const item = { ...d, timestamp: base + i + 1, source: 'chat', sourceRef: null };
      const id = await insertItem(db, userId, item, messageId);
      saved.push(toClient({ id, ...item, raw_text: item.rawText, message_id: messageId }));
    }
    await db.query(
      'UPDATE messages SET extracted_at=$3, extracted_data=$4 WHERE id=$1 AND user_id=$2',
      [messageId, userId, Date.now(), items.length ? JSON.stringify(saved) : null]
    );
    return saved;
  });
}

router.get('/', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, category, label, value, raw_text, timestamp, source, message_id
     FROM extracted_data WHERE user_id=$1 ORDER BY timestamp DESC`,
    [req.userId]
  );
  res.json({ data: rows.map(toClient) });
});

router.post('/', async (req, res) => {
  const items = arrayOf(req.body.data, 'data', { max: 1000 }).map(validateItem);
  const ids = await withTransaction(async (db) => {
    const result = [];
    for (const d of items) result.push(await insertItem(db, req.userId, d));
    return result;
  });
  res.json({ ok: true, ids });
});

// Corrigir um registro (ex.: extração errada da IA).
router.patch('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) throw new HttpError(400, 'id inválido');
  const b = req.body || {};
  const updates = {
    category: b.category === undefined ? undefined : oneOf(b.category, 'category', CATEGORIES),
    label: b.label === undefined ? undefined : text(b.label, 'label', { max: 200 }),
    value: b.value === undefined ? undefined : text(b.value, 'value', { max: 500 }),
  };
  const { rows } = await pool.query(
    `UPDATE extracted_data SET
       category = COALESCE($3, category), label = COALESCE($4, label), value = COALESCE($5, value)
     WHERE id=$1 AND user_id=$2
     RETURNING id, category, label, value, raw_text, timestamp, source, message_id`,
    [id, req.userId, updates.category ?? null, updates.label ?? null, updates.value ?? null]
  );
  if (!rows.length) throw new HttpError(404, 'Registro não encontrado');
  res.json({ data: toClient(rows[0]) });
});

router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) throw new HttpError(400, 'id inválido');
  const { rowCount } = await pool.query('DELETE FROM extracted_data WHERE id=$1 AND user_id=$2', [id, req.userId]);
  if (!rowCount) throw new HttpError(404, 'Registro não encontrado');
  res.json({ ok: true });
});

module.exports = router;
module.exports.replaceMessageExtraction = replaceMessageExtraction;
