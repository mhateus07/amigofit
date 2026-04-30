const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'amigofit_secret_change_in_prod';

// ── Database ──────────────────────────────────────────────
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'amigofit',
  user: process.env.DB_USER || 'amigofit',
  password: process.env.DB_PASSWORD || 'amigofit',
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS profiles (
      user_id TEXT PRIMARY KEY REFERENCES users(id),
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id),
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      extracted_data JSONB,
      timestamp BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS extracted_data (
      id SERIAL PRIMARY KEY,
      user_id TEXT REFERENCES users(id),
      category TEXT NOT NULL,
      label TEXT NOT NULL,
      value TEXT NOT NULL,
      raw_text TEXT,
      timestamp BIGINT NOT NULL
    );
  `);
  console.log('Database ready');
}

// ── Middleware ────────────────────────────────────────────
app.use(cors({
  origin: '*',
  allowedHeaders: ['Content-Type', 'x-api-key', 'Authorization'],
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  preflightContinue: false,
  optionsSuccessStatus: 204,
}));
app.use(express.json({ limit: '2mb' }));
app.use((req, _res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// ── Auth middleware ───────────────────────────────────────
function requireAuth(req, res, next) {
  const auth = req.headers['authorization'];
  if (!auth?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token ausente' });
  }
  try {
    const payload = jwt.verify(auth.slice(7), JWT_SECRET);
    req.userId = payload.userId;
    req.userName = payload.name;
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido ou expirado' });
  }
}

function getAnthropicClient(req, res) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) { res.status(401).json({ error: 'API key ausente' }); return null; }
  return new Anthropic({ apiKey });
}

// ── Health ────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true }));

// ── Auth: Register ────────────────────────────────────────
app.post('/auth/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name?.trim() || !email?.trim() || !password?.trim()) {
    return res.status(400).json({ error: 'Nome, e-mail e senha são obrigatórios' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Senha deve ter pelo menos 6 caracteres' });
  }
  try {
    const exists = await pool.query('SELECT id FROM users WHERE email=$1', [email.toLowerCase()]);
    if (exists.rows.length > 0) {
      return res.status(409).json({ error: 'E-mail já cadastrado' });
    }
    const id = 'u_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO users (id, name, email, password_hash) VALUES ($1,$2,$3,$4)',
      [id, name.trim(), email.toLowerCase(), hash]
    );
    const token = jwt.sign({ userId: id, name: name.trim() }, JWT_SECRET, { expiresIn: '90d' });
    res.json({ token, user: { id, name: name.trim(), email: email.toLowerCase() } });
  } catch (e) {
    console.error('Register error:', e.message);
    res.status(500).json({ error: 'Erro ao criar conta' });
  }
});

// ── Auth: Login ───────────────────────────────────────────
app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email?.trim() || !password?.trim()) {
    return res.status(400).json({ error: 'E-mail e senha são obrigatórios' });
  }
  try {
    const { rows } = await pool.query(
      'SELECT id, name, email, password_hash FROM users WHERE email=$1',
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
    const token = jwt.sign({ userId: user.id, name: user.name }, JWT_SECRET, { expiresIn: '90d' });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
  } catch (e) {
    console.error('Login error:', e.message);
    res.status(500).json({ error: 'Erro ao fazer login' });
  }
});

// ── Auth: Me ──────────────────────────────────────────────
app.get('/auth/me', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT id, name, email FROM users WHERE id=$1', [req.userId]);
  res.json({ user: rows[0] || null });
});

// ── Profile ───────────────────────────────────────────────
app.get('/api/profile', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT data FROM profiles WHERE user_id=$1', [req.userId]);
  res.json({ profile: rows[0]?.data || null });
});

app.post('/api/profile', requireAuth, async (req, res) => {
  await pool.query(`
    INSERT INTO profiles (user_id, data) VALUES ($1,$2)
    ON CONFLICT (user_id) DO UPDATE SET data=$2, updated_at=NOW()
  `, [req.userId, req.body]);
  res.json({ ok: true });
});

// ── Messages ──────────────────────────────────────────────
app.get('/api/messages', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, role, content, extracted_data, timestamp FROM messages WHERE user_id=$1 ORDER BY timestamp ASC',
    [req.userId]
  );
  res.json({ messages: rows.map(r => ({ ...r, extractedData: r.extracted_data })) });
});

app.post('/api/messages', requireAuth, async (req, res) => {
  const { messages } = req.body;
  if (!Array.isArray(messages)) return res.status(400).json({ error: 'messages must be array' });
  await pool.query('DELETE FROM messages WHERE user_id=$1', [req.userId]);
  for (const m of messages) {
    await pool.query(
      'INSERT INTO messages (id, user_id, role, content, extracted_data, timestamp) VALUES ($1,$2,$3,$4,$5,$6)',
      [m.id, req.userId, m.role, m.content, JSON.stringify(m.extractedData || null), m.timestamp]
    );
  }
  res.json({ ok: true });
});

// ── Extracted Data ────────────────────────────────────────
app.get('/api/extracted-data', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT category, label, value, raw_text as "rawText", timestamp FROM extracted_data WHERE user_id=$1 ORDER BY timestamp DESC',
    [req.userId]
  );
  res.json({ data: rows });
});

app.post('/api/extracted-data', requireAuth, async (req, res) => {
  const { data } = req.body;
  if (!Array.isArray(data)) return res.status(400).json({ error: 'data must be array' });
  for (const d of data) {
    await pool.query(
      'INSERT INTO extracted_data (user_id, category, label, value, raw_text, timestamp) VALUES ($1,$2,$3,$4,$5,$6)',
      [req.userId, d.category, d.label, d.value, d.rawText || '', d.timestamp]
    );
  }
  res.json({ ok: true });
});

// ── AI: Chat ──────────────────────────────────────────────
app.post('/api/chat', requireAuth, async (req, res) => {
  const client = getAnthropicClient(req, res);
  if (!client) return;
  const { messages, systemPrompt } = req.body;
  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      messages,
    });
    const block = response.content[0];
    res.json({ text: block.type === 'text' ? block.text : '' });
  } catch (e) {
    console.error('Chat error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── AI: Extract ───────────────────────────────────────────
app.post('/api/extract', requireAuth, async (req, res) => {
  const client = getAnthropicClient(req, res);
  if (!client) return;
  const { message } = req.body;
  const PROMPT = `Analise a mensagem e extraia dados estruturados sobre saúde, treino, alimentação e bem-estar. Retorne APENAS JSON válido (sem markdown):

{"data":[{"category":"sleep|nutrition|performance|mood|health|workout","label":"descrição curta","value":"valor extraído","rawText":"trecho original"}]}

Se não houver dados relevantes: {"data":[]}`;
  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      messages: [{ role: 'user', content: `${PROMPT}\n\nMensagem: "${message}"` }],
    });
    const text = response.content[0].text.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '');
    res.json({ data: JSON.parse(text).data || [] });
  } catch (e) {
    console.error('Extract error:', e.message);
    res.json({ data: [] });
  }
});

// ── Start ─────────────────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, () => console.log(`AmigoFit backend em http://localhost:${PORT}`));
}).catch(err => { console.error('DB init failed:', err); process.exit(1); });
