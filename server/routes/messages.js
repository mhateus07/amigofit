const express = require('express');
const { pool, withTransaction } = require('../db');
const { HttpError } = require('../lib/http');

const router = express.Router();

// Cada mensagem é gravada individualmente (PUT idempotente por id). Antes o
// cliente mandava a conversa inteira e o servidor apagava o que não estivesse
// na lista — dois aparelhos, ou gravações fora de ordem, apagavam mensagens.
const MESSAGE_ROLES = ['user', 'assistant'];
const MAX_MESSAGE_LENGTH = 20000;

function validateMessage(m) {
  if (!m || typeof m !== 'object') return 'mensagem inválida';
  if (typeof m.id !== 'string' || !m.id || m.id.length > 100) return 'id inválido';
  if (!MESSAGE_ROLES.includes(m.role)) return 'role inválido';
  if (typeof m.content !== 'string' || m.content.length > MAX_MESSAGE_LENGTH) return 'content inválido';
  if (!Number.isFinite(m.timestamp)) return 'timestamp inválido';
  if (m.imageId !== undefined && m.imageId !== null && (typeof m.imageId !== 'string' || m.imageId.length > 100)) return 'imageId inválido';
  return null;
}

// Retorna false se o id já pertence a outra conta (nada é alterado nesse caso).
// extracted_at não é tocado aqui: só a extração (POST /api/extract) o define.
async function upsertMessage(db, userId, m) {
  if (m.imageId) {
    const owned = await db.query('SELECT 1 FROM chat_images WHERE id=$1 AND user_id=$2', [m.imageId, userId]);
    if (!owned.rowCount) throw new HttpError(400, 'Imagem não encontrada');
  }
  const { rowCount } = await db.query(
    `INSERT INTO messages (id, user_id, role, content, extracted_data, timestamp, image_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (id) DO UPDATE SET
       role = EXCLUDED.role,
       content = EXCLUDED.content,
       extracted_data = COALESCE(EXCLUDED.extracted_data, messages.extracted_data),
       timestamp = EXCLUDED.timestamp,
       image_id = COALESCE(EXCLUDED.image_id, messages.image_id)
     WHERE messages.user_id = EXCLUDED.user_id`,
    [m.id, userId, m.role, m.content, m.extractedData ? JSON.stringify(m.extractedData) : null, m.timestamp, m.imageId || null]
  );
  return rowCount > 0;
}

function toClient(r) {
  return {
    id: r.id,
    role: r.role,
    content: r.content,
    timestamp: Number(r.timestamp),
    extractedData: r.extracted_data || undefined,
    extractedAt: r.extracted_at ? Number(r.extracted_at) : undefined,
    imageId: r.image_id || undefined,
  };
}

const COLUMNS = 'id, role, content, extracted_data, extracted_at, image_id, timestamp';

router.get('/', async (req, res) => {
  // Sem limit, devolve o histórico completo (usado por reprocessamento/export).
  // Com limit, devolve as N mensagens mais recentes antes de "before".
  const limit = req.query.limit ? Math.min(Math.max(parseInt(req.query.limit, 10) || 0, 1), 500) : null;
  const before = req.query.before ? Number(req.query.before) : null;
  if (before !== null && !Number.isFinite(before)) throw new HttpError(400, 'before inválido');

  let rows;
  if (limit) {
    ({ rows } = await pool.query(
      `SELECT ${COLUMNS} FROM messages
       WHERE user_id=$1 AND ($2::bigint IS NULL OR timestamp < $2)
       ORDER BY timestamp DESC LIMIT $3`,
      [req.userId, before, limit + 1]
    ));
  } else {
    ({ rows } = await pool.query(
      `SELECT ${COLUMNS} FROM messages WHERE user_id=$1 ORDER BY timestamp ASC`,
      [req.userId]
    ));
  }
  const hasMore = limit ? rows.length > limit : false;
  if (limit) rows = rows.slice(0, limit).reverse();
  res.json({ messages: rows.map(toClient), hasMore });
});

router.put('/:id', async (req, res) => {
  const m = { ...req.body, id: req.params.id };
  const invalid = validateMessage(m);
  if (invalid) throw new HttpError(400, invalid);
  if (!(await upsertMessage(pool, req.userId, m))) {
    throw new HttpError(409, 'Conflito de identificador de mensagem');
  }
  res.json({ ok: true });
});

// Gravação em lote (upsert). Mantido para versões antigas do app, mas NÃO
// apaga mais as mensagens ausentes da lista — isso agora é DELETE /api/messages.
router.post('/', async (req, res) => {
  const { messages } = req.body;
  if (!Array.isArray(messages)) throw new HttpError(400, 'messages must be array');
  for (const m of messages) {
    const invalid = validateMessage(m);
    if (invalid) throw new HttpError(400, invalid);
  }
  await withTransaction(async (db) => {
    for (const m of messages) {
      if (!(await upsertMessage(db, req.userId, m))) {
        throw new HttpError(409, 'Conflito de identificador de mensagem');
      }
    }
  });
  res.json({ ok: true });
});

// Limpar conversa. Os registros do Diário gerados pelas mensagens ficam.
router.delete('/', async (req, res) => {
  await pool.query('DELETE FROM messages WHERE user_id=$1', [req.userId]);
  res.json({ ok: true });
});

module.exports = router;
