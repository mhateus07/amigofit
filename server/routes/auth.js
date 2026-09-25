const express = require('express');
const bcrypt = require('bcryptjs');
const { rateLimit } = require('express-rate-limit');
const { pool, withTransaction } = require('../db');
const { signToken, requireAuth } = require('../lib/auth');
const { HttpError, newId } = require('../lib/http');
const media = require('./media');

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Muitas tentativas. Aguarde 15 minutos e tente novamente.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const MIN_PASSWORD = 6;

router.post('/register', authLimiter, async (req, res) => {
  const { name, email, password } = req.body;
  if (!name?.trim() || !email?.trim() || !password?.trim()) {
    return res.status(400).json({ error: 'Nome, e-mail e senha são obrigatórios' });
  }
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
    return res.status(400).json({ error: `Senha deve ter pelo menos ${MIN_PASSWORD} caracteres` });
  }
  if (name.length > 100 || email.length > 200 || password.length > 200) {
    return res.status(400).json({ error: 'Dados longos demais' });
  }
  try {
    const exists = await pool.query('SELECT id FROM users WHERE email=$1', [email.toLowerCase()]);
    if (exists.rows.length > 0) {
      return res.status(409).json({ error: 'E-mail já cadastrado' });
    }
    const id = newId('u_');
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO users (id, name, email, password_hash) VALUES ($1,$2,$3,$4)',
      [id, name.trim(), email.toLowerCase(), hash]
    );
    const token = signToken({ id, name: name.trim() }, 0);
    res.json({ token, user: { id, name: name.trim(), email: email.toLowerCase() } });
  } catch (e) {
    console.error('Register error:', e.message);
    res.status(500).json({ error: 'Erro ao criar conta' });
  }
});

router.post('/login', authLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email?.trim() || !password?.trim()) {
    return res.status(400).json({ error: 'E-mail e senha são obrigatórios' });
  }
  try {
    const { rows } = await pool.query(
      'SELECT id, name, email, password_hash, token_version FROM users WHERE email=$1',
      [email.toLowerCase()]
    );
    if (rows.length === 0) {
      return res.status(401).json({ error: 'E-mail ou senha incorretos' });
    }
    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'E-mail ou senha incorretos' });
    }
    const token = signToken(user, user.token_version ?? 0);
    res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
  } catch (e) {
    console.error('Login error:', e.message);
    res.status(500).json({ error: 'Erro ao fazer login' });
  }
});

router.get('/me', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT id, name, email FROM users WHERE id=$1', [req.userId]);
  res.json({ user: rows[0] || null });
});

async function checkPassword(userId, password) {
  const { rows } = await pool.query('SELECT password_hash FROM users WHERE id=$1', [userId]);
  if (!rows.length || typeof password !== 'string' || !(await bcrypt.compare(password, rows[0].password_hash))) {
    throw new HttpError(403, 'Senha atual incorreta');
  }
}

// Troca a senha e encerra as sessões nos outros aparelhos.
router.post('/password', authLimiter, requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD || newPassword.length > 200) {
    throw new HttpError(400, `Nova senha deve ter pelo menos ${MIN_PASSWORD} caracteres`);
  }
  await checkPassword(req.userId, currentPassword);
  const hash = await bcrypt.hash(newPassword, 10);
  const { rows } = await pool.query(
    'UPDATE users SET password_hash=$2, token_version = token_version + 1 WHERE id=$1 RETURNING token_version',
    [req.userId, hash]
  );
  res.json({ token: signToken({ id: req.userId, name: req.userName }, rows[0].token_version) });
});

// Invalida todos os tokens, inclusive o deste aparelho.
router.post('/logout-all', requireAuth, async (req, res) => {
  await pool.query('UPDATE users SET token_version = token_version + 1 WHERE id=$1', [req.userId]);
  res.json({ ok: true });
});

// Exclusão definitiva da conta e de todos os dados (inclusive arquivos).
router.delete('/account', authLimiter, requireAuth, async (req, res) => {
  await checkPassword(req.userId, req.body?.password);
  const files = await withTransaction(async (db) => {
    const videos = await db.query('SELECT filename FROM exercise_videos WHERE user_id=$1', [req.userId]);
    const images = await db.query('SELECT filename FROM chat_images WHERE user_id=$1', [req.userId]);
    const exerciseImages = await db.query('SELECT filename FROM exercise_images WHERE user_id=$1', [req.userId]);
    for (const table of [
      'meal_checkins', 'workout_checkins', 'workout_set_logs', 'extracted_data', 'messages', 'meals',
      'workout_plans', 'exercise_videos', 'exercise_images', 'chat_images', 'ai_keys', 'profiles',
    ]) {
      await db.query(`DELETE FROM ${table} WHERE user_id=$1`, [req.userId]);
    }
    await db.query('DELETE FROM users WHERE id=$1', [req.userId]);
    return {
      videos: videos.rows.map((r) => r.filename),
      images: images.rows.map((r) => r.filename),
      exerciseImages: exerciseImages.rows.map((r) => r.filename),
    };
  });
  media.removeFiles(files);
  res.json({ ok: true });
});

module.exports = router;
