// Chaves de API de IA (BYOK) de cada usuário, criptografadas no banco.
// O app não guarda nem envia mais a chave: o servidor a usa diretamente.
const { pool } = require('../db');
const secrets = require('./secrets');
const { HttpError } = require('./http');
const { PROVIDERS, TRANSCRIPTION_PROVIDERS } = require('../ai/providers');

async function listKeys(userId) {
  const { rows } = await pool.query('SELECT provider, last4 FROM ai_keys WHERE user_id=$1', [userId]);
  return Object.fromEntries(rows.map((r) => [r.provider, { last4: r.last4 }]));
}

async function saveKey(userId, provider, apiKey) {
  if (!secrets.isConfigured()) throw new HttpError(503, 'Armazenamento de chaves indisponível no servidor.');
  await pool.query(
    `INSERT INTO ai_keys (user_id, provider, secret, last4) VALUES ($1,$2,$3,$4)
     ON CONFLICT (user_id, provider) DO UPDATE SET secret=EXCLUDED.secret, last4=EXCLUDED.last4, updated_at=NOW()`,
    [userId, provider, secrets.encrypt(apiKey), apiKey.slice(-4)]
  );
}

async function deleteKey(userId, provider) {
  await pool.query('DELETE FROM ai_keys WHERE user_id=$1 AND provider=$2', [userId, provider]);
}

async function getKey(userId, provider) {
  const { rows } = await pool.query('SELECT secret FROM ai_keys WHERE user_id=$1 AND provider=$2', [userId, provider]);
  if (!rows.length || !secrets.isConfigured()) return null;
  try {
    return secrets.decrypt(rows[0].secret);
  } catch (e) {
    console.error(`[ai-keys] falha ao decifrar chave ${provider}:`, e.message);
    return null;
  }
}

async function activeProvider(userId) {
  const { rows } = await pool.query("SELECT data->>'aiProvider' AS provider FROM profiles WHERE user_id=$1", [userId]);
  const p = rows[0]?.provider;
  return PROVIDERS.includes(p) ? p : 'anthropic';
}

// Provedor e chave para uma chamada de IA. Aceita ainda x-provider/x-api-key
// (versões antigas do app mandam a chave em cada requisição).
async function resolveAiConfig(req) {
  const headerProvider = req.headers['x-provider'];
  const provider = PROVIDERS.includes(headerProvider) ? headerProvider : await activeProvider(req.userId);
  const apiKey = req.headers['x-api-key'] || await getKey(req.userId, provider);
  if (!apiKey) throw new HttpError(401, 'API key ausente. Configure a chave em Perfil → Configuração da IA.');
  return { provider, apiKey };
}

// Transcrição: usa o provedor ativo se ele transcreve, senão o primeiro
// provedor com chave salva na ordem Groq → OpenAI → Gemini.
async function resolveTranscriptionConfig(req) {
  if (req.headers['x-api-key'] && TRANSCRIPTION_PROVIDERS.includes(req.headers['x-provider'])) {
    return { provider: req.headers['x-provider'], apiKey: req.headers['x-api-key'] };
  }
  const active = PROVIDERS.includes(req.headers['x-provider']) ? req.headers['x-provider'] : await activeProvider(req.userId);
  const order = TRANSCRIPTION_PROVIDERS.includes(active)
    ? [active, ...TRANSCRIPTION_PROVIDERS.filter((p) => p !== active)]
    : TRANSCRIPTION_PROVIDERS;
  for (const provider of order) {
    const apiKey = await getKey(req.userId, provider);
    if (apiKey) return { provider, apiKey };
  }
  throw new HttpError(401, active === 'anthropic'
    ? 'O provedor Anthropic não suporta transcrição de áudio. Configure uma chave OpenAI, Groq ou Gemini em Perfil → Configuração da IA.'
    : 'Nenhuma chave de IA compatível com transcrição encontrada. Configure OpenAI, Groq ou Gemini em Perfil → Configuração da IA.');
}

// Move chaves que ainda estão em texto puro dentro de profiles.data para
// ai_keys (criptografadas) e as remove do JSON do perfil. Roda no startup.
async function migrateProfileKeys() {
  const { rows } = await pool.query("SELECT user_id, data->'aiApiKeys' AS keys FROM profiles WHERE data ? 'aiApiKeys'");
  if (!rows.length) return;
  if (!secrets.isConfigured()) {
    console.warn(`[ai-keys] ${rows.length} perfil(is) com chave em texto puro; defina AI_KEYS_SECRET para migrá-las.`);
    return;
  }
  for (const { user_id: userId, keys } of rows) {
    for (const [provider, key] of Object.entries(keys || {})) {
      if (PROVIDERS.includes(provider) && typeof key === 'string' && key.trim()) {
        await saveKey(userId, provider, key.trim());
      }
    }
    await pool.query("UPDATE profiles SET data = data - 'aiApiKeys' WHERE user_id=$1", [userId]);
  }
  console.log(`[ai-keys] chaves de ${rows.length} perfil(is) migradas para armazenamento criptografado.`);
}

module.exports = { listKeys, saveKey, deleteKey, getKey, resolveAiConfig, resolveTranscriptionConfig, migrateProfileKeys };
