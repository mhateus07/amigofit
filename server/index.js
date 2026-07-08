const express = require('express');
const cors = require('cors');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const Anthropic = require('@anthropic-ai/sdk');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3001;

if (!process.env.JWT_SECRET) {
  console.error('JWT_SECRET não definido. Configure a variável de ambiente JWT_SECRET antes de iniciar o servidor.');
  process.exit(1);
}
const JWT_SECRET = process.env.JWT_SECRET;

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
    CREATE TABLE IF NOT EXISTS meals (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id),
      name TEXT NOT NULL,
      time TEXT NOT NULL,
      description TEXT,
      items JSONB,
      source TEXT NOT NULL DEFAULT 'manual',
      active BOOLEAN NOT NULL DEFAULT true,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS meal_checkins (
      id SERIAL PRIMARY KEY,
      user_id TEXT REFERENCES users(id),
      meal_id TEXT REFERENCES meals(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      status TEXT NOT NULL,
      checked_at BIGINT,
      UNIQUE (meal_id, date)
    );
  `);
  console.log('Database ready');
}

// ── Rate limiting ─────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Muitas tentativas. Aguarde 15 minutos e tente novamente.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Limita chamadas às APIs de IA (pagas) por usuário autenticado, não por IP,
// já que requireAuth roda antes e popula req.userId.
const aiLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 30,
  message: { error: 'Muitas requisições de IA. Aguarde alguns minutos e tente novamente.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.userId || ipKeyGenerator(req.ip),
});

// ── Middleware ────────────────────────────────────────────
// O app mobile (React Native) não envia header Origin, então não é afetado pelo CORS.
// Isso protege apenas contra acesso via browser (build web / react-native-web) de domínios não autorizados.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:8081,http://localhost:19006')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error('Origem não permitida pelo CORS'));
  },
  allowedHeaders: ['Content-Type', 'x-api-key', 'x-provider', 'Authorization'],
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

// ── AI provider config ────────────────────────────────────
const PROVIDER_MODELS = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-4o',
  gemini: 'gemini-1.5-flash',
  groq: 'llama-3.3-70b-versatile',
};

function getProviderConfig(req, res) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) { res.status(401).json({ error: 'API key ausente' }); return null; }
  const provider = req.headers['x-provider'] || 'anthropic';
  return { provider, apiKey };
}

// Convert Anthropic-style messages to OpenAI/Groq format
function toOpenAIMessages(messages, systemPrompt) {
  const result = [{ role: 'system', content: systemPrompt }];
  for (const m of messages) {
    if (typeof m.content === 'string') {
      result.push({ role: m.role, content: m.content });
    } else if (Array.isArray(m.content)) {
      // Extract text from Anthropic multi-part content (images become placeholder)
      const text = m.content
        .map(part => part.type === 'text' ? part.text : '[imagem]')
        .join(' ');
      result.push({ role: m.role, content: text });
    }
  }
  return result;
}

// Convert Anthropic-style messages to Gemini format
function toGeminiContents(messages) {
  return messages.map(m => {
    let text = '';
    if (typeof m.content === 'string') {
      text = m.content;
    } else if (Array.isArray(m.content)) {
      text = m.content.map(p => p.type === 'text' ? p.text : '[imagem]').join(' ');
    }
    return { role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text }] };
  });
}

async function chatWithProvider(config, messages, systemPrompt) {
  const { provider, apiKey } = config;
  const model = PROVIDER_MODELS[provider] || PROVIDER_MODELS.anthropic;

  if (provider === 'anthropic') {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model,
      max_tokens: 1024,
      system: systemPrompt,
      messages,
    });
    const block = response.content[0];
    return block.type === 'text' ? block.text : '';
  }

  if (provider === 'openai' || provider === 'groq') {
    const baseUrl = provider === 'groq'
      ? 'https://api.groq.com/openai/v1'
      : 'https://api.openai.com/v1';
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        messages: toOpenAIMessages(messages, systemPrompt),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`);
    return data.choices[0]?.message?.content || '';
  }

  if (provider === 'gemini') {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: toGeminiContents(messages),
        }),
      }
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`);
    return data.candidates[0]?.content?.parts[0]?.text || '';
  }

  throw new Error(`Provedor desconhecido: ${provider}`);
}

async function extractWithProvider(config, message) {
  const { provider, apiKey } = config;
  const model = PROVIDER_MODELS[provider] || PROVIDER_MODELS.anthropic;

  const PROMPT = `Analise a mensagem e extraia dados estruturados sobre saúde, treino, alimentação e bem-estar. Retorne APENAS JSON válido (sem markdown):

{"data":[{"category":"sleep|nutrition|performance|mood|health|workout","label":"descrição curta","value":"valor extraído","rawText":"trecho original"}]}

Se não houver dados relevantes: {"data":[]}`;

  const userContent = `${PROMPT}\n\nMensagem: "${message}"`;
  let text;

  if (provider === 'anthropic') {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model,
      max_tokens: 512,
      messages: [{ role: 'user', content: userContent }],
    });
    text = response.content[0].text;
  } else if (provider === 'openai' || provider === 'groq') {
    const baseUrl = provider === 'groq'
      ? 'https://api.groq.com/openai/v1'
      : 'https://api.openai.com/v1';
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        max_tokens: 512,
        messages: [{ role: 'user', content: userContent }],
        response_format: { type: 'json_object' },
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`);
    text = data.choices[0]?.message?.content || '{"data":[]}';
  } else if (provider === 'gemini') {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: userContent }] }],
          generationConfig: { responseMimeType: 'application/json' },
        }),
      }
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`);
    text = data.candidates[0]?.content?.parts[0]?.text || '{"data":[]}';
  } else {
    return [];
  }

  text = text.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '');
  return JSON.parse(text).data || [];
}

// ── Health ────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true }));

// ── Auth: Register ────────────────────────────────────────
app.post('/auth/register', authLimiter, async (req, res) => {
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
app.post('/auth/login', authLimiter, async (req, res) => {
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
  res.json({ messages: rows.map(r => ({ ...r, timestamp: Number(r.timestamp), extractedData: r.extracted_data })) });
});

app.post('/api/messages', requireAuth, async (req, res) => {
  const { messages } = req.body;
  if (!Array.isArray(messages)) return res.status(400).json({ error: 'messages must be array' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // O cliente sempre envia a lista completa e atual de mensagens. Em vez de apagar
    // tudo e reinserir (reescreve a tabela inteira a cada mensagem nova), removemos só
    // as que não estão mais na lista (ex: "Limpar chat") e fazemos upsert do resto.
    const ids = messages.map((m) => m.id);
    await client.query(
      'DELETE FROM messages WHERE user_id=$1 AND NOT (id = ANY($2::text[]))',
      [req.userId, ids]
    );
    for (const m of messages) {
      await client.query(
        `INSERT INTO messages (id, user_id, role, content, extracted_data, timestamp)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (id) DO UPDATE SET
           role = EXCLUDED.role,
           content = EXCLUDED.content,
           extracted_data = EXCLUDED.extracted_data,
           timestamp = EXCLUDED.timestamp`,
        [m.id, req.userId, m.role, m.content, JSON.stringify(m.extractedData || null), m.timestamp]
      );
    }
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Save messages error:', e.message);
    res.status(500).json({ error: 'Erro ao salvar mensagens' });
  } finally {
    client.release();
  }
});

// ── Extracted Data ────────────────────────────────────────
app.get('/api/extracted-data', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT category, label, value, raw_text as "rawText", timestamp FROM extracted_data WHERE user_id=$1 ORDER BY timestamp DESC',
    [req.userId]
  );
  res.json({ data: rows.map(r => ({ ...r, timestamp: Number(r.timestamp) })) });
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

// ── Meal Plan ─────────────────────────────────────────────
app.get('/api/meal-plan', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, name, time, description, items, source FROM meals WHERE user_id=$1 AND active=true ORDER BY time ASC',
    [req.userId]
  );
  res.json({ meals: rows });
});

app.post('/api/meal-plan', requireAuth, async (req, res) => {
  const { meals } = req.body;
  if (!Array.isArray(meals)) return res.status(400).json({ error: 'meals must be array' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM meals WHERE user_id=$1', [req.userId]);
    for (const [i, m] of meals.entries()) {
      const id = m.id || ('meal_' + Math.random().toString(36).slice(2) + Date.now().toString(36));
      await client.query(
        'INSERT INTO meals (id, user_id, name, time, description, items, source, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [id, req.userId, m.name, m.time, m.description || null, JSON.stringify(m.items || []), m.source || 'manual', i]
      );
    }
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Save meal plan error:', e.message);
    res.status(500).json({ error: 'Erro ao salvar plano alimentar' });
  } finally {
    client.release();
  }
});

app.get('/api/meal-plan/checkins', requireAuth, async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'date é obrigatório' });
  const { rows } = await pool.query(
    'SELECT meal_id as "mealId", date, status, checked_at as "checkedAt" FROM meal_checkins WHERE user_id=$1 AND date=$2',
    [req.userId, date]
  );
  res.json({ checkins: rows.map(r => ({ ...r, checkedAt: r.checkedAt ? Number(r.checkedAt) : null })) });
});

app.post('/api/meal-plan/checkins', requireAuth, async (req, res) => {
  const { mealId, date, status } = req.body;
  if (!mealId || !date || !status) return res.status(400).json({ error: 'mealId, date e status são obrigatórios' });
  await pool.query(
    `INSERT INTO meal_checkins (user_id, meal_id, date, status, checked_at) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (meal_id, date) DO UPDATE SET status=$4, checked_at=$5`,
    [req.userId, mealId, date, status, Date.now()]
  );
  res.json({ ok: true });
});

// ── AI: Chat ──────────────────────────────────────────────
app.post('/api/chat', requireAuth, aiLimiter, async (req, res) => {
  const config = getProviderConfig(req, res);
  if (!config) return;
  const { messages, systemPrompt } = req.body;
  try {
    const text = await chatWithProvider(config, messages, systemPrompt);
    res.json({ text });
  } catch (e) {
    console.error('Chat error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── AI: Extract ───────────────────────────────────────────
app.post('/api/extract', requireAuth, aiLimiter, async (req, res) => {
  const config = getProviderConfig(req, res);
  if (!config) return;
  const { message } = req.body;
  try {
    const data = await extractWithProvider(config, message);
    res.json({ data });
  } catch (e) {
    console.error('Extract error:', e.message);
    res.json({ data: [] });
  }
});

// ── Start ─────────────────────────────────────────────────
if (require.main === module) {
  initDB().then(() => {
    app.listen(PORT, () => console.log(`AmigoFit backend em http://localhost:${PORT}`));
  }).catch(err => { console.error('DB init failed:', err); process.exit(1); });
}

module.exports = { app, pool, JWT_SECRET };
