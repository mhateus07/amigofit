const jwt = require('jsonwebtoken');
const sessions = require('./sessions');

if (!process.env.JWT_SECRET) {
  console.error('JWT_SECRET não definido. Configure a variável de ambiente JWT_SECRET antes de iniciar o servidor.');
  process.exit(1);
}
const JWT_SECRET = process.env.JWT_SECRET;

const TOKEN_TTL = '30d';
// Token com mais de 7 dias é renovado automaticamente (header x-auth-token):
// quem usa o app segue logado, e um token vazado para de valer em 30 dias.
const RENEW_AFTER_SECONDS = 7 * 86400;

function signToken(user, tokenVersion = 0) {
  return jwt.sign({ userId: user.id, name: user.name, tv: tokenVersion }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

async function requireAuth(req, res, next) {
  const auth = req.headers['authorization'];
  if (!auth?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token ausente' });
  }
  let payload;
  try {
    payload = jwt.verify(auth.slice(7), JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Token inválido ou expirado' });
  }
  try {
    const version = await sessions.currentTokenVersion(payload.userId);
    // Conta excluída, ou sessão revogada (tokens antigos sem "tv" valem como 0).
    if (version === null || version !== (payload.tv ?? 0)) {
      return res.status(401).json({ error: 'Sessão encerrada. Entre novamente.' });
    }
    req.userId = payload.userId;
    req.userName = payload.name;
    req.tokenVersion = version;
    if (Date.now() / 1000 - payload.iat > RENEW_AFTER_SECONDS) {
      res.setHeader('x-auth-token', signToken({ id: payload.userId, name: payload.name }, version));
    }
    next();
  } catch (e) {
    next(e);
  }
}

module.exports = { JWT_SECRET, signToken, requireAuth };
