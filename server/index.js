const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = 3001;

app.use(cors({
  origin: '*',
  allowedHeaders: ['Content-Type', 'x-api-key'],
  methods: ['GET', 'POST', 'OPTIONS'],
  preflightContinue: false,
  optionsSuccessStatus: 204,
}));
app.use(express.json());
app.use((req, _res, next) => { console.log(`${req.method} ${req.url} | key: ${req.headers['x-api-key']?.slice(0,15)}...`); next(); });

function getClient(req, res) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) {
    res.status(401).json({ error: 'API key ausente' });
    return null;
  }
  return new Anthropic({ apiKey });
}

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

app.post('/api/extract', async (req, res) => {
  const client = getClient(req, res);
  if (!client) return;

  const { message } = req.body;
  const EXTRACTION_PROMPT = `Analise a mensagem do usuário e extraia dados estruturados relevantes sobre saúde, treino, alimentação e bem-estar. Retorne APENAS um JSON válido no seguinte formato (sem markdown, sem explicações):

{"data":[{"category":"sleep|nutrition|performance|mood|health|workout","label":"descrição curta","value":"valor extraído","rawText":"trecho original"}]}

Extraia apenas dados CONCRETOS. Se não houver dados relevantes, retorne {"data":[]}.`;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      messages: [{ role: 'user', content: `${EXTRACTION_PROMPT}\n\nMensagem: "${message}"` }],
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

app.listen(PORT, () => {
  console.log(`AmigoFit backend em http://localhost:${PORT}`);
});
