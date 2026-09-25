// Erro com status HTTP e mensagem segura para mostrar ao usuário. Qualquer
// outro erro vira 500 com mensagem genérica (ver errorHandler).
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function newId(prefix) {
  return prefix + require('crypto').randomUUID();
}

function isValidDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

function isValidTime(value) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

// Texto obrigatório (ou opcional) com tamanho máximo. Lança 400 se inválido.
function text(value, field, { max = 500, optional = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (optional) return null;
    throw new HttpError(400, `${field} é obrigatório`);
  }
  if (typeof value !== 'string') throw new HttpError(400, `${field} deve ser texto`);
  if (value.length > max) throw new HttpError(400, `${field} excede ${max} caracteres`);
  return value;
}

function oneOf(value, field, allowed, { optional = false, fallback } = {}) {
  if ((value === undefined || value === null) && optional) return fallback ?? null;
  if (!allowed.includes(value)) throw new HttpError(400, `${field} inválido`);
  return value;
}

function arrayOf(value, field, { max = 200 } = {}) {
  if (!Array.isArray(value)) throw new HttpError(400, `${field} must be array`);
  if (value.length > max) throw new HttpError(400, `${field} excede ${max} itens`);
  return value;
}

// Registrado por último no app: converte HttpError em resposta e esconde
// detalhes de erros inesperados (logados sem corpo da requisição).
function errorHandler(err, req, res, _next) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Arquivo ou requisição grande demais' });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido' });
  console.error(`[erro] ${req.method} ${req.path}:`, err?.message);
  res.status(500).json({ error: 'Erro interno. Tente novamente.' });
}

module.exports = { HttpError, newId, isValidDate, isValidTime, text, oneOf, arrayOf, errorHandler };
