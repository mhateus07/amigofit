const express = require('express');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { PDFParse } = require('pdf-parse');
const ai = require('../ai/providers');
const aiKeys = require('../lib/aiKeys');
const { HttpError, text, arrayOf } = require('../lib/http');
const { replaceMessageExtraction } = require('./extracted');

const router = express.Router();

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
router.use(aiLimiter);

// Erros do provedor (chave inválida, sem saldo, modelo indisponível) chegam
// ao app como 502 com a mensagem do provedor, que o app traduz para o usuário.
// Loga só provedor, rota e status — nunca o conteúdo da conversa.
function providerError(e, req, provider) {
  if (e instanceof HttpError) return e;
  const status = e.providerStatus || (e.name === 'TimeoutError' ? 504 : undefined);
  console.error(`[ia] ${req.path} provedor=${provider} status=${status ?? '-'}: ${e.message}`);
  return new HttpError(e.name === 'TimeoutError' ? 504 : 502, e.name === 'TimeoutError'
    ? 'A IA demorou demais para responder. Tente novamente.'
    : e.message);
}

async function withProvider(req, fn, resolver = aiKeys.resolveAiConfig) {
  const config = await resolver(req);
  try {
    return await fn(config);
  } catch (e) {
    throw providerError(e, req, config.provider);
  }
}

// Mensagens no formato Anthropic: texto, ou partes image/text.
function validateChatMessages(messages) {
  arrayOf(messages, 'messages', { max: 60 });
  for (const m of messages) {
    if (!m || !['user', 'assistant'].includes(m.role)) throw new HttpError(400, 'role inválido');
    if (typeof m.content === 'string') {
      text(m.content, 'content', { max: 20000 });
    } else if (Array.isArray(m.content)) {
      for (const part of m.content) {
        if (part?.type === 'text') text(part.text, 'content', { max: 20000, optional: true });
        else if (part?.type !== 'image' || typeof part.source?.data !== 'string') throw new HttpError(400, 'conteúdo inválido');
      }
    } else {
      throw new HttpError(400, 'content inválido');
    }
  }
}

router.post('/chat', async (req, res) => {
  const { messages, systemPrompt } = req.body;
  validateChatMessages(messages);
  text(systemPrompt, 'systemPrompt', { max: 30000 });
  const reply = await withProvider(req, (config) => ai.chat(config, messages, systemPrompt));
  res.json({ text: reply });
});

// Com messageId, os registros ficam vinculados à mensagem (idempotente:
// extrair de novo substitui) e a mensagem é marcada como processada.
router.post('/extract', async (req, res) => {
  const { message, messageId } = req.body;
  text(message, 'message', { max: 20000 });
  const items = await withProvider(req, (config) => ai.extract(config, message));
  if (!messageId) return res.json({ data: items.map((d) => ({ ...d, timestamp: Date.now() })) });
  const saved = await replaceMessageExtraction(req.userId, messageId, items);
  res.json({ data: saved });
});

router.post('/insights', async (req, res) => {
  const { data, profile } = req.body;
  if (!Array.isArray(data)) throw new HttpError(400, 'data must be array');
  const clean = data
    .filter((d) => d && ai.CATEGORIES.includes(d.category) && Number.isFinite(d.timestamp))
    .slice(0, 3000);
  const insights = await withProvider(req, (config) => ai.generateInsights(config, clean, profile));
  res.json({ insights });
});

async function pdfText(pdfBase64) {
  try {
    const parser = new PDFParse({ data: Buffer.from(pdfBase64, 'base64') });
    const result = await parser.getText();
    await parser.destroy();
    return result.text || '';
  } catch (e) {
    console.error('PDF parse error:', e.message);
    return null;
  }
}

router.post('/extract-meals', async (req, res) => {
  const { pdfBase64 } = req.body;
  if (!pdfBase64) throw new HttpError(400, 'pdfBase64 é obrigatório');
  // Confere a chave antes de ler o PDF, para falhar rápido.
  const config = await aiKeys.resolveAiConfig(req);
  const content = await pdfText(pdfBase64);
  if (content === null) throw new HttpError(422, 'Não conseguimos ler esse arquivo. Confira se é um PDF válido.');
  if (content.trim().length < 30) {
    throw new HttpError(422, 'Não conseguimos extrair texto deste PDF (pode ser uma imagem escaneada). Tente montar o plano manualmente.');
  }
  const meals = await withProvider(req, (c) => ai.extractMeals(c, content), () => config);
  res.json({ meals });
});

router.post('/extract-workout', async (req, res) => {
  const { pdfBase64, imageBase64, mimeType } = req.body;
  if (!pdfBase64 && !imageBase64) throw new HttpError(400, 'pdfBase64 ou imageBase64 é obrigatório');
  const config = await aiKeys.resolveAiConfig(req);

  if (imageBase64) {
    const plans = await withProvider(req, (c) => ai.extractWorkoutFromImage(c, imageBase64, mimeType || 'image/jpeg'), () => config);
    return res.json({ plans });
  }

  const content = await pdfText(pdfBase64);
  if (content === null) throw new HttpError(422, 'Não conseguimos ler esse arquivo. Confira se é um PDF válido.');
  if (content.trim().length < 30) {
    throw new HttpError(422, 'Não conseguimos extrair texto deste PDF (pode ser uma imagem escaneada). Tente enviar como foto, ou montar a ficha manualmente.');
  }
  const plans = await withProvider(req, (c) => ai.extractWorkoutFromText(c, content), () => config);
  res.json({ plans });
});

router.post('/transcribe', async (req, res) => {
  const { audioBase64, mimeType } = req.body;
  if (!audioBase64) throw new HttpError(400, 'audioBase64 é obrigatório');
  const transcript = await withProvider(
    req,
    (config) => ai.transcribe(config, audioBase64, mimeType),
    aiKeys.resolveTranscriptionConfig
  );
  res.json({ text: transcript });
});

module.exports = router;
