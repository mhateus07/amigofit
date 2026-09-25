// Criptografia das chaves de API de IA guardadas no banco (AES-256-GCM).
// A chave mestra vem de AI_KEYS_SECRET e nunca vai para o banco: um backup
// do PostgreSQL sozinho não expõe as chaves dos usuários.
const crypto = require('crypto');

function masterKey() {
  const secret = process.env.AI_KEYS_SECRET;
  if (!secret || secret.length < 32) return null;
  return crypto.createHash('sha256').update(secret).digest();
}

function isConfigured() {
  return masterKey() !== null;
}

function encrypt(plain) {
  const key = masterKey();
  if (!key) throw new Error('AI_KEYS_SECRET não configurado');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  // Formato: v1.<iv>.<tag>.<dados>, tudo em base64.
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join('.');
}

function decrypt(payload) {
  const key = masterKey();
  if (!key) throw new Error('AI_KEYS_SECRET não configurado');
  const [version, iv, tag, data] = String(payload).split('.');
  if (version !== 'v1') throw new Error('Formato de segredo desconhecido');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

module.exports = { isConfigured, encrypt, decrypt };
