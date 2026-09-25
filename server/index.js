const express = require('express');
const cors = require('cors');
const { pool } = require('./db');
const { runMigrations } = require('./migrations');
const { requireAuth, JWT_SECRET } = require('./lib/auth');
const { errorHandler } = require('./lib/http');
const aiKeys = require('./lib/aiKeys');
const media = require('./routes/media');

const app = express();
const PORT = process.env.PORT || 3001;

async function initDB() {
  await runMigrations(pool);
  await aiKeys.migrateProfileKeys();
  console.log('Database ready');
}

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
  exposedHeaders: ['x-auth-token'],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  preflightContinue: false,
  optionsSuccessStatus: 204,
}));

// Log de acesso: método, rota (sem query string, que pode ter dados), status
// e latência. Nunca o corpo da requisição.
app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    const route = req.originalUrl.split('?')[0];
    const line = `${req.method} ${route} ${res.statusCode} ${ms.toFixed(0)}ms`;
    if (res.statusCode >= 500) console.error(line);
    else if (process.env.NODE_ENV !== 'test') console.log(line);
  });
  next();
});

// Depois do log de acesso, para requisições recusadas (ex.: 413) também
// aparecerem no log.
app.use(express.json({ limit: '15mb' }));

// ── Health ────────────────────────────────────────────────
// Confere o banco de verdade: o deploy usa isso para saber se subiu.
app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false, error: 'banco indisponível' });
  }
});

// ── Rotas ─────────────────────────────────────────────────
app.use('/auth', require('./routes/auth'));
app.use('/api', requireAuth);
app.use('/api', require('./routes/profile'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/extracted-data', require('./routes/extracted'));
app.use('/api', require('./routes/plans'));
app.use('/api/workout-logs', require('./routes/workoutLogs'));
app.use('/api', media);
app.use('/api/uploads', require('./routes/uploads'));
// Por último: o rate limit de IA vale para as rotas deste router.
app.use('/api', require('./routes/ai'));

app.use('/api', (_req, res) => res.status(404).json({ error: 'Rota não encontrada' }));
app.use(errorHandler);

// ── Start ─────────────────────────────────────────────────
if (require.main === module) {
  initDB().then(() => {
    app.listen(PORT, () => console.log(`AmigoFit backend em http://localhost:${PORT}`));
    const runCleanup = () => media.cleanupOrphans().catch((e) => console.error('[limpeza] falhou:', e.message));
    setTimeout(runCleanup, 60_000);
    setInterval(runCleanup, 24 * 3600_000).unref();
  }).catch(err => { console.error('DB init failed:', err); process.exit(1); });
}

module.exports = { app, pool, initDB, JWT_SECRET };
