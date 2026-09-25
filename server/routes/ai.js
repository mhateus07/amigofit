const express = require('express');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { PDFParse } = require('pdf-parse');
const multer = require('multer');
const ai = require('../ai/providers');
const aiKeys = require('../lib/aiKeys');
const { HttpError, text, arrayOf } = require('../lib/http');
const { replaceMessageExtraction } = require('./extracted');
const { consumeUpload } = require('./uploads');
const { saveExerciseImage } = require('./media');
const { extractWorkoutFromPdfLayout } = require('../ai/workoutPdf');

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

async function pdfText(buffer) {
  try {
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    await parser.destroy();
    return result.text || '';
  } catch (e) {
    console.error('PDF parse error:', e.message);
    return null;
  }
}

// PDFs chegam como arquivo (multipart) — base64 dentro de JSON aumenta o
// tamanho em ~33% e estourava o limite de 15 MB com fichas escaneadas.
const MAX_PDF_BYTES = 30 * 1024 * 1024;
const fileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PDF_BYTES },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf' || file.mimetype.startsWith('image/')) return cb(null, true);
    cb(new HttpError(400, 'Envie um PDF ou uma foto'));
  },
});

function receiveFile(req, res) {
  return new Promise((resolve, reject) => {
    fileUpload.single('file')(req, res, (err) => {
      if (err?.code === 'LIMIT_FILE_SIZE') return reject(new HttpError(413, 'Arquivo grande demais (máx. 30 MB).'));
      if (err) return reject(err instanceof HttpError ? err : new HttpError(400, err.message));
      if (!req.file) return reject(new HttpError(400, 'Arquivo é obrigatório'));
      resolve(req.file);
    });
  });
}

// PDF com texto → extração pelo texto (mais barata). PDF sem texto
// (escaneado/foto) → o PDF inteiro vai para o modelo ler as páginas.
async function extractFromPdf(req, config, buffer, { fromText, fromDocument }) {
  const content = await pdfText(buffer);
  if (content === null) throw new HttpError(422, 'Não conseguimos ler esse arquivo. Confira se é um PDF válido.');
  if (content.trim().length >= 30) return withProvider(req, (c) => fromText(c, content), () => config);
  return withProvider(req, (c) => fromDocument(c, buffer.toString('base64')), () => config);
}

const MEALS = { fromText: ai.extractMeals, fromDocument: ai.extractMealsFromPdfDocument };
const WORKOUT = { fromText: ai.extractWorkoutFromText, fromDocument: ai.extractWorkoutFromPdfDocument };

router.post('/extract-meals', async (req, res) => {
  const { pdfBase64 } = req.body;
  if (!pdfBase64) throw new HttpError(400, 'pdfBase64 é obrigatório');
  // Confere a chave antes de ler o PDF, para falhar rápido.
  const config = await aiKeys.resolveAiConfig(req);
  const meals = await extractFromPdf(req, config, Buffer.from(pdfBase64, 'base64'), MEALS);
  res.json({ meals });
});

router.post('/extract-meals/file', async (req, res) => {
  const config = await aiKeys.resolveAiConfig(req);
  const file = await receiveFile(req, res);
  if (file.mimetype !== 'application/pdf') throw new HttpError(400, 'Envie o plano em PDF');
  const meals = await extractFromPdf(req, config, file.buffer, MEALS);
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
  const plans = await extractFromPdf(req, config, Buffer.from(pdfBase64, 'base64'), WORKOUT);
  res.json({ plans });
});

router.post('/extract-workout/file', async (req, res) => {
  const config = await aiKeys.resolveAiConfig(req);
  const file = await receiveFile(req, res);
  const plans = file.mimetype === 'application/pdf'
    ? await extractFromPdf(req, config, file.buffer, WORKOUT)
    : await withProvider(req, (c) => ai.extractWorkoutFromImage(c, file.buffer.toString('base64'), file.mimetype), () => config);
  res.json({ plans });
});

// Processa um PDF pesado por vez (renderizar uma ficha de 75 MB usa ~1 GB de
// memória); os demais esperam na fila.
let pdfQueue = Promise.resolve();
function oneAtATime(fn) {
  const run = pdfQueue.then(fn, fn);
  pdfQueue = run.catch(() => {});
  return run;
}

// Limite para mandar o PDF inteiro ao modelo (PDF escaneado).
const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

// Ficha enviada em partes (/api/uploads). Tenta primeiro ler pelo layout
// (fichas de apps de personal: texto + foto por exercício), sem IA e sem
// custo, guardando a foto de cada exercício. Se o formato não for
// reconhecido, cai na extração por IA (texto; ou o PDF inteiro se escaneado).
router.post('/extract-workout/upload/:id', async (req, res) => {
  const { buffer } = await consumeUpload(req, req.params.id);
  const layout = await oneAtATime(() => extractWorkoutFromPdfLayout(buffer).catch((e) => {
    console.error('[pdf-layout] falhou:', e.message);
    return null;
  }));

  if (layout) {
    const exercises = [];
    for (const { photo, ...exercise } of layout.plan.exercises) {
      exercises.push({ ...exercise, imageId: photo ? await saveExerciseImage(req.userId, photo) : undefined });
    }
    return res.json({ plans: [{ ...layout.plan, routine: layout.routine, exercises, source: 'pdf' }], method: 'layout' });
  }

  const config = await aiKeys.resolveAiConfig(req);
  const content = await pdfText(buffer);
  if (content === null) throw new HttpError(422, 'Não conseguimos ler esse arquivo. Confira se é um PDF válido.');
  if (content.trim().length < 30 && buffer.length > MAX_DOCUMENT_BYTES) {
    throw new HttpError(413, 'Este PDF é escaneado e grande demais para a IA ler (máx. 25 MB). Tente exportá-lo com menos páginas ou em qualidade menor.');
  }
  const plans = await extractFromPdf(req, config, buffer, WORKOUT);
  res.json({ plans, method: 'ai' });
});

router.post('/extract-meals/upload/:id', async (req, res) => {
  const config = await aiKeys.resolveAiConfig(req);
  const { buffer } = await consumeUpload(req, req.params.id);
  const meals = await extractFromPdf(req, config, buffer, MEALS);
  res.json({ meals });
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
