const express = require('express');
const { pool } = require('../db');
const { HttpError, isValidTime } = require('../lib/http');
const aiKeys = require('../lib/aiKeys');
const { PROVIDERS } = require('../ai/providers');

// Todas as rotas de /api passam por requireAuth (montado em index.js).
const router = express.Router();

const GOALS = ['hypertrophy', 'weight_loss', 'conditioning', 'health'];
const LEVELS = ['beginner', 'intermediate', 'advanced'];

// Campos aceitos no perfil. Qualquer outro campo (inclusive aiApiKeys, que
// agora tem armazenamento próprio e criptografado) é descartado.
const FIELDS = {
  name: (v) => typeof v === 'string' && v.length <= 100,
  goal: (v) => GOALS.includes(v),
  level: (v) => LEVELS.includes(v),
  age: (v) => Number.isFinite(v) && v > 0 && v < 130,
  weight: (v) => Number.isFinite(v) && v > 0 && v < 500,
  height: (v) => Number.isFinite(v) && v > 0 && v < 300,
  restrictions: (v) => Array.isArray(v) && v.length <= 50 && v.every((r) => typeof r === 'string' && r.length <= 100),
  onboardingComplete: (v) => typeof v === 'boolean',
  weeklyWorkoutGoal: (v) => Number.isInteger(v) && v >= 0 && v <= 14,
  sleepGoal: (v) => Number.isFinite(v) && v >= 0 && v <= 24,
  notificationEnabled: (v) => typeof v === 'boolean',
  notificationTime: (v) => isValidTime(v),
  aiProvider: (v) => PROVIDERS.includes(v),
};

function sanitizeProfile(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Perfil inválido');
  const clean = {};
  for (const [field, valid] of Object.entries(FIELDS)) {
    const value = body[field];
    if (value === undefined) continue;
    // null remove o campo (o merge abaixo não apaga campos omitidos).
    if (value !== null && !valid(value)) throw new HttpError(400, `Campo ${field} inválido`);
    clean[field] = value;
  }
  return clean;
}

router.get('/profile', async (req, res) => {
  const { rows } = await pool.query("SELECT data - 'aiApiKeys' AS data FROM profiles WHERE user_id=$1", [req.userId]);
  res.json({ profile: rows[0]?.data || null });
});

// Mescla com o perfil salvo: telas que mandam só parte dos campos não apagam
// o resto (antes, salvar o perfil na tela Perfil apagava o provedor de IA).
router.post('/profile', async (req, res) => {
  const updates = sanitizeProfile(req.body);
  const { rows } = await pool.query(
    `INSERT INTO profiles (user_id, data) VALUES ($1, jsonb_strip_nulls($2::jsonb))
     ON CONFLICT (user_id) DO UPDATE SET
       data = jsonb_strip_nulls((profiles.data - 'aiApiKeys') || $2::jsonb), updated_at = NOW()
     RETURNING data`,
    [req.userId, JSON.stringify(updates)]
  );
  res.json({ ok: true, profile: rows[0].data });
});

// ── Chaves de IA ──────────────────────────────────────────
// Nunca devolvem a chave completa, só os 4 últimos caracteres.
router.get('/ai-keys', async (req, res) => {
  res.json({ keys: await aiKeys.listKeys(req.userId) });
});

router.put('/ai-keys/:provider', async (req, res) => {
  const { provider } = req.params;
  if (!PROVIDERS.includes(provider)) throw new HttpError(400, 'Provedor inválido');
  const key = typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : '';
  if (key.length < 10 || key.length > 300) throw new HttpError(400, 'Chave inválida');
  await aiKeys.saveKey(req.userId, provider, key);
  res.json({ ok: true, keys: await aiKeys.listKeys(req.userId) });
});

router.delete('/ai-keys/:provider', async (req, res) => {
  const { provider } = req.params;
  if (!PROVIDERS.includes(provider)) throw new HttpError(400, 'Provedor inválido');
  await aiKeys.deleteKey(req.userId, provider);
  res.json({ ok: true, keys: await aiKeys.listKeys(req.userId) });
});

module.exports = router;
