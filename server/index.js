const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3001;

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
  allowedHeaders: ['Content-Type', 'x-api-key', 'x-user-id'],
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  preflightContinue: false,
  optionsSuccessStatus: 204,
}));
app.use(express.json({ limit: '2mb' }));
app.use((req, _res, next) => {
  console.log(`${req.method} ${req.url} | user: ${req.headers['x-user-id']?.slice(0, 8) || 'anon'}`);
  next();
});

function getClient(req, res) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) { res.status(401).json({ error: 'API key ausente' }); return null; }
  return new Anthropic({ apiKey });
}

async function ensureUser(userId) {
  if (!userId) return;
  await pool.query(
    'INSERT INTO users (id) VALUES ($1) ON CONFLICT DO NOTHING',
    [userId]
  );
}

// ── Health ────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true }));

// ── Profile ───────────────────────────────────────────────
app.get('/api/profile', async (req, res) => {
  const userId = req.headers['x-user-id'];
  if (!userId) return res.json({ profile: null });
  try {
    const { rows } = await pool.query('SELECT data FROM profiles WHERE user_id=$1', [userId]);
    res.json({ profile: rows[0]?.data || null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/profile', async (req, res) => {
  const userId = req.headers['x-user-id'];
  if (!userId) return res.status(400).json({ error: 'user-id required' });
  try {
    await ensureUser(userId);
    await pool.query(`
      INSERT INTO profiles (user_id, data) VALUES ($1, $2)
      ON CONFLICT (user_id) DO UPDATE SET data=$2, updated_at=NOW()
    `, [userId, req.body]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Messages ──────────────────────────────────────────────
app.get('/api/messages', async (req, res) => {
  const userId = req.headers['x-user-id'];
  if (!userId) return res.json({ messages: [] });
  try {
    const { rows } = await pool.query(
      'SELECT id, role, content, extracted_data, timestamp FROM messages WHERE user_id=$1 ORDER BY timestamp ASC',
      [userId]
    );
    res.json({ messages: rows.map(r => ({ ...r, extractedData: r.extracted_data })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/messages', async (req, res) => {
  const userId = req.headers['x-user-id'];
  if (!userId) return res.status(400).json({ error: 'user-id required' });
  const { messages } = req.body;
  if (!Array.isArray(messages)) return res.status(400).json({ error: 'messages must be array' });
  try {
    await ensureUser(userId);
    await pool.query('DELETE FROM messages WHERE user_id=$1', [userId]);
    for (const m of messages) {
      await pool.query(
        'INSERT INTO messages (id, user_id, role, content, extracted_data, timestamp) VALUES ($1,$2,$3,$4,$5,$6)',
        [m.id, userId, m.role, m.content, JSON.stringify(m.extractedData || null), m.timestamp]
      );
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Extracted Data ────────────────────────────────────────
app.get('/api/extracted-data', async (req, res) => {
  const userId = req.headers['x-user-id'];
  if (!userId) return res.json({ data: [] });
  try {
    const { rows } = await pool.query(
      'SELECT category, label, value, raw_text as "rawText", timestamp FROM extracted_data WHERE user_id=$1 ORDER BY timestamp DESC',
      [userId]
    );
    res.json({ data: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/extracted-data', async (req, res) => {
  const userId = req.headers['x-user-id'];
  if (!userId) return res.status(400).json({ error: 'user-id required' });
  const { data } = req.body;
  if (!Array.isArray(data)) return res.status(400).json({ error: 'data must be array' });
  try {
    await ensureUser(userId);
    for (const d of data) {
      await pool.query(
        'INSERT INTO extracted_data (user_id, category, label, value, raw_text, timestamp) VALUES ($1,$2,$3,$4,$5,$6)',
        [userId, d.category, d.label, d.value, d.rawText || '', d.timestamp]
      );
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── AI: Chat ──────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  const client = getClient(req, res);
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
app.post('/api/extract', async (req, res) => {
  const client = getClient(req, res);
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
    const block = response.content[0];
    const text = block.text.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '');
    const parsed = JSON.parse(text);
    res.json({ data: parsed.data || [] });
  } catch (e) {
    console.error('Extract error:', e.message);
    res.json({ data: [], error: e.message });
  }
});

// ── Start ─────────────────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, () => console.log(`AmigoFit backend em http://localhost:${PORT}`));
}).catch(err => {
  console.error('DB init failed:', err.message);
  process.exit(1);
});
