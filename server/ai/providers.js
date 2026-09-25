// Chamadas aos provedores de IA (BYOK). Toda chamada passa por callModel,
// que recebe mensagens no formato Anthropic (texto ou partes image/text) e
// converte para cada provedor — inclusive imagens, que antes viravam o texto
// "[imagem]" no OpenAI/Gemini/Groq e a IA nunca via a foto.
const Anthropic = require('@anthropic-ai/sdk');
const { HttpError } = require('../lib/http');

const PROVIDERS = ['anthropic', 'openai', 'gemini', 'groq'];

const PROVIDER_MODELS = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-4o',
  // gemini-1.5-flash foi descontinuado pelo Google.
  gemini: 'gemini-2.5-flash',
  groq: 'openai/gpt-oss-20b',
};

// Provedores que aceitam imagem. Groq (gpt-oss) não tem visão.
const VISION_PROVIDERS = ['anthropic', 'openai', 'gemini'];

const AI_TIMEOUT_MS = 90_000;

// Os modelos Llama da Groq (llama-3.1-8b-instant, llama-3.3-70b-versatile)
// não estão acessíveis em todas as contas ("does not exist or you do not
// have access to it"), então usamos os modelos gpt-oss da Groq. Eles são
// modelos de raciocínio: por padrão gastam parte do orçamento de tokens
// pensando antes de responder, o que pode truncar o JSON em respostas com
// response_format: json_object. reasoning_effort: 'low' reduz isso.
function groqReasoningOptions(provider) {
  return provider === 'groq' ? { reasoning_effort: 'low' } : {};
}

function hasImage(messages) {
  return messages.some((m) => Array.isArray(m.content) && m.content.some((p) => p.type === 'image'));
}

function toOpenAIMessages(messages, system) {
  const result = system ? [{ role: 'system', content: system }] : [];
  for (const m of messages) {
    if (typeof m.content === 'string') {
      result.push({ role: m.role, content: m.content });
    } else {
      result.push({
        role: m.role,
        content: m.content.map((part) => (part.type === 'image'
          ? { type: 'image_url', image_url: { url: `data:${part.source.media_type};base64,${part.source.data}` } }
          : { type: 'text', text: part.text })),
      });
    }
  }
  return result;
}

function toGeminiContents(messages) {
  return messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: typeof m.content === 'string'
      ? [{ text: m.content }]
      : m.content.map((part) => (part.type === 'image'
        ? { inline_data: { mime_type: part.source.media_type, data: part.source.data } }
        : { text: part.text })),
  }));
}

async function readProviderResponse(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error?.message || `HTTP ${res.status}`);
    err.providerStatus = res.status;
    throw err;
  }
  return data;
}

/**
 * Chama o modelo do provedor e devolve o texto da resposta.
 * @param config { provider, apiKey }
 * @param opts { system?, messages, maxTokens, groqMaxTokens?, json? }
 */
async function callModel(config, { system, messages, maxTokens, groqMaxTokens, json = false }) {
  const { provider, apiKey } = config;
  const model = PROVIDER_MODELS[provider];
  if (!model) throw new HttpError(400, `Provedor desconhecido: ${provider}`);
  if (hasImage(messages) && !VISION_PROVIDERS.includes(provider)) {
    throw new HttpError(400, 'O provedor Groq não suporta análise de imagem. Troque para Anthropic, OpenAI ou Gemini em Perfil → Configuração da IA.');
  }

  if (provider === 'anthropic') {
    const client = new Anthropic({ apiKey, timeout: AI_TIMEOUT_MS, maxRetries: 1 });
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      ...(system ? { system } : {}),
      messages,
    });
    const block = response.content.find((b) => b.type === 'text');
    return block ? block.text : '';
  }

  if (provider === 'openai' || provider === 'groq') {
    const baseUrl = provider === 'groq' ? 'https://api.groq.com/openai/v1' : 'https://api.openai.com/v1';
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        max_tokens: provider === 'groq' ? (groqMaxTokens || maxTokens) : maxTokens,
        messages: toOpenAIMessages(messages, system),
        ...(json ? { response_format: { type: 'json_object' } } : {}),
        ...groqReasoningOptions(provider),
      }),
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    });
    const data = await readProviderResponse(res);
    return data.choices?.[0]?.message?.content || '';
  }

  // gemini
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        ...(system ? { system_instruction: { parts: [{ text: system }] } } : {}),
        contents: toGeminiContents(messages),
        generationConfig: { maxOutputTokens: maxTokens, ...(json ? { responseMimeType: 'application/json' } : {}) },
      }),
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    }
  );
  const data = await readProviderResponse(res);
  return data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
}

function parseJson(text, fallback) {
  const cleaned = (text || '').trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  if (!cleaned) return fallback;
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error('A IA retornou uma resposta em formato inválido. Tente novamente.');
  }
}

const clip = (value, max) => (typeof value === 'string' ? value.slice(0, max) : typeof value === 'number' ? String(value) : '');

// ── Chat ──────────────────────────────────────────────────
async function chat(config, messages, systemPrompt) {
  return callModel(config, { system: systemPrompt, messages, maxTokens: 1024 });
}

// ── Extração de dados de uma mensagem ─────────────────────
const CATEGORIES = ['sleep', 'nutrition', 'performance', 'mood', 'health', 'workout'];

const EXTRACT_PROMPT = `Analise a mensagem e extraia dados estruturados sobre saúde, treino, alimentação e bem-estar. Retorne APENAS JSON válido (sem markdown):

{"data":[{"category":"sleep|nutrition|performance|mood|health|workout","label":"descrição curta","value":"valor extraído","rawText":"trecho original"}]}

Se não houver dados relevantes: {"data":[]}`;

// Filtra o que a IA devolveu: categorias fora da lista quebravam telas que
// pressupõem as seis categorias conhecidas.
function sanitizeExtracted(items) {
  if (!Array.isArray(items)) return [];
  return items
    .filter((d) => d && CATEGORIES.includes(d.category) && clip(d.label, 200) && clip(d.value, 500))
    .slice(0, 20)
    .map((d) => ({
      category: d.category,
      label: clip(d.label, 200),
      value: clip(d.value, 500),
      rawText: clip(d.rawText, 1000),
    }));
}

async function extract(config, message) {
  const text = await callModel(config, {
    messages: [{ role: 'user', content: `${EXTRACT_PROMPT}\n\nMensagem: "${message}"` }],
    maxTokens: 512,
    groqMaxTokens: 1024,
    json: true,
  });
  return sanitizeExtracted(parseJson(text, { data: [] }).data);
}

// ── Insights ──────────────────────────────────────────────
function buildInsightsPrompt(data, profile) {
  const now = Date.now();
  const last30 = data.filter((d) => now - d.timestamp <= 30 * 86400000);
  if (last30.length === 0) return null;

  const byCategory = {};
  last30.forEach((d) => {
    (byCategory[d.category] || (byCategory[d.category] = [])).push(d);
  });

  const categoryLabels = {
    sleep: 'SONO', nutrition: 'ALIMENTAÇÃO', performance: 'PERFORMANCE',
    mood: 'HUMOR', health: 'SAÚDE', workout: 'TREINOS',
  };

  const lines = [];
  for (const [cat, entries] of Object.entries(byCategory)) {
    lines.push(`\n${categoryLabels[cat] || cat.toUpperCase()} (${entries.length} registros):`);
    // Os 25 mais recentes, em ordem cronológica.
    [...entries].sort((a, b) => a.timestamp - b.timestamp).slice(-25).forEach((e) => {
      const date = new Date(e.timestamp).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      lines.push(`  • ${date} — ${e.label}: ${e.value}`);
    });
  }

  const goalLabel = profile?.goal === 'hypertrophy' ? 'Hipertrofia'
    : profile?.goal === 'weight_loss' ? 'Emagrecimento'
    : profile?.goal === 'conditioning' ? 'Condicionamento'
    : 'Saúde geral';
  const levelLabel = profile?.level === 'beginner' ? 'Iniciante'
    : profile?.level === 'intermediate' ? 'Intermediário'
    : 'Avançado';
  const profileBlock = profile
    ? `Objetivo: ${goalLabel}. Nível: ${levelLabel}. Meta de treinos/semana: ${profile.weeklyWorkoutGoal ?? 3}. Meta de sono: ${profile.sleepGoal ?? 8}h.`
    : '';

  return `Você é um personal trainer analisando os dados dos últimos 30 dias de um usuário do AmigoFit. ${profileBlock}

DADOS REGISTRADOS:
${lines.join('\n')}

Gere de 3 a 5 insights personalizados, específicos e acionáveis em português brasileiro, com base em PADRÕES REAIS nos dados acima. Priorize EVOLUÇÃO e ADESÃO: o usuário está cumprindo as metas de treino e sono? Está melhorando ou piorando em relação às semanas anteriores? Há correlações entre sono, alimentação e performance? A quantidade de registros, sozinha, não indica melhora — não elogie só por registrar muito. Não invente números — use apenas o que está nos dados acima. Seja direto e evite generalidades óbvias que não dependem dos dados.

Retorne APENAS JSON válido (sem markdown):
{"insights":[{"icon":"um único emoji relevante","title":"título curto (máx 6 palavras)","description":"1-2 frases explicando o padrão e uma sugestão prática","severity":"positive|warning|neutral"}]}`;
}

async function generateInsights(config, data, profile) {
  const prompt = buildInsightsPrompt(data, profile);
  if (!prompt) return [];
  const text = await callModel(config, {
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 1024,
    groqMaxTokens: 2048,
    json: true,
  });
  const parsed = parseJson(text, { insights: [] });
  const insights = Array.isArray(parsed.insights) ? parsed.insights : [];
  return insights
    .filter((i) => i && i.title && i.description)
    .slice(0, 6)
    .map((i) => ({
      icon: typeof i.icon === 'string' && i.icon ? i.icon.slice(0, 8) : '💡',
      title: clip(String(i.title), 120),
      description: clip(String(i.description), 600),
      severity: ['positive', 'warning', 'neutral'].includes(i.severity) ? i.severity : 'neutral',
    }));
}

// ── Plano alimentar (PDF) ─────────────────────────────────
const MEALS_PROMPT = `Analise o texto extraído de um plano alimentar em PDF e retorne APENAS JSON válido (sem markdown):

{"meals":[{"name":"...","time":"HH:mm","description":"...","items":["item 1","item 2"]}]}

Regras:
- "time" em formato 24h HH:mm. Se não estiver explícito, estime pelo nome da refeição (café da manhã ~07:00, almoço ~12:00, lanche ~15:30, jantar ~19:00, ceia ~21:30).
- "items" é a lista de alimentos/quantidades.
- Se não houver refeições identificáveis: {"meals":[]}`;

function sanitizeMeals(meals) {
  if (!Array.isArray(meals)) return [];
  return meals
    .filter((m) => m && clip(m.name, 100))
    .slice(0, 20)
    .map((m) => ({
      name: clip(m.name, 100),
      time: /^([01]\d|2[0-3]):[0-5]\d$/.test(m.time) ? m.time : '12:00',
      description: clip(m.description, 1000) || undefined,
      items: Array.isArray(m.items) ? m.items.map((i) => clip(i, 200)).filter(Boolean).slice(0, 50) : [],
    }));
}

async function extractMeals(config, text) {
  const response = await callModel(config, {
    messages: [{ role: 'user', content: `${MEALS_PROMPT}\n\nTexto do PDF:\n"""${text}"""` }],
    maxTokens: 2048,
    groqMaxTokens: 3072,
    json: true,
  });
  return sanitizeMeals(parseJson(response, { meals: [] }).meals);
}

// ── Ficha de treino (PDF ou foto) ─────────────────────────
const WORKOUT_EXTRACTION_PROMPT = `Analise {SOURCE} de uma ficha de treino e retorne APENAS JSON válido (sem markdown):

{"plans":[{"name":"...","dayLabel":"...","exercises":[{"name":"...","sets":N,"reps":"...","load":"...","restSeconds":N,"notes":"..."}]}]}

Regras:
- "name" do plano é o nome do treino (ex: "Treino A - Peito/Tríceps"). Se a ficha tiver vários treinos (A, B, C...), cada um vira um item de "plans".
- "dayLabel" é o dia da semana ou letra do treino, se identificável (ex: "Segunda", "Treino A"). Pode ficar null se não houver.
- "sets" é número de séries. "reps" e "load" são texto livre (ex: "8-12", "até a falha", "20kg", "peso corporal"). "restSeconds" é o descanso em segundos, se informado. Qualquer campo não identificável fica null/omitido.
- Se não houver exercícios identificáveis: {"plans":[]}`;

function parseWorkoutPlansJson(responseText) {
  const parsed = parseJson(responseText, { plans: [] }).plans;
  if (!Array.isArray(parsed)) return [];
  return parsed.slice(0, 14).map((p) => ({
    name: clip(p?.name, 100) || 'Treino',
    dayLabel: clip(p?.dayLabel, 50) || null,
    exercises: Array.isArray(p?.exercises) ? p.exercises.slice(0, 40).map((e) => ({
      name: clip(e?.name, 100),
      sets: typeof e?.sets === 'number' ? e.sets : undefined,
      reps: clip(e?.reps, 50) || undefined,
      load: clip(e?.load, 50) || undefined,
      restSeconds: typeof e?.restSeconds === 'number' ? e.restSeconds : undefined,
      notes: clip(e?.notes, 500) || undefined,
    })).filter((e) => e.name) : [],
  }));
}

async function extractWorkoutFromText(config, text) {
  const prompt = WORKOUT_EXTRACTION_PROMPT.replace('{SOURCE}', 'o texto extraído de um PDF');
  const response = await callModel(config, {
    messages: [{ role: 'user', content: `${prompt}\n\nTexto do PDF:\n"""${text}"""` }],
    maxTokens: 2048,
    groqMaxTokens: 3072,
    json: true,
  });
  return parseWorkoutPlansJson(response);
}

async function extractWorkoutFromImage(config, imageBase64, mimeType) {
  if (config.provider === 'groq') {
    throw new HttpError(400, 'O provedor Groq não suporta análise de imagem. Troque para Anthropic, OpenAI ou Gemini em Perfil → Configuração da IA, ou envie um PDF.');
  }
  const prompt = WORKOUT_EXTRACTION_PROMPT.replace('{SOURCE}', 'a foto a seguir');
  const response = await callModel(config, {
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBase64 } },
        { type: 'text', text: prompt },
      ],
    }],
    maxTokens: 2048,
    json: true,
  });
  return parseWorkoutPlansJson(response);
}

// ── Transcrição de áudio ──────────────────────────────────
const TRANSCRIPTION_MODELS = {
  openai: 'whisper-1',
  groq: 'whisper-large-v3-turbo',
};

// Anthropic não transcreve áudio. Ordem de preferência quando o provedor
// ativo não serve: Groq (mais rápido/barato), OpenAI, Gemini.
const TRANSCRIPTION_PROVIDERS = ['groq', 'openai', 'gemini'];

function extensionFromMime(mimeType) {
  if (mimeType?.includes('mp4') || mimeType?.includes('m4a')) return 'm4a';
  if (mimeType?.includes('webm')) return 'webm';
  if (mimeType?.includes('wav')) return 'wav';
  return 'm4a';
}

async function transcribe(config, audioBase64, mimeType) {
  const { provider, apiKey } = config;

  if (provider === 'openai' || provider === 'groq') {
    const baseUrl = provider === 'groq' ? 'https://api.groq.com/openai/v1' : 'https://api.openai.com/v1';
    const buffer = Buffer.from(audioBase64, 'base64');
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: mimeType || 'audio/m4a' }), `audio.${extensionFromMime(mimeType)}`);
    form.append('model', TRANSCRIPTION_MODELS[provider]);
    form.append('language', 'pt');
    const res = await fetch(`${baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    });
    const data = await readProviderResponse(res);
    return (data.text || '').trim();
  }

  if (provider === 'gemini') {
    const text = await callModel(config, {
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Transcreva literalmente o áudio a seguir em português brasileiro. Responda apenas com o texto transcrito, sem comentários nem formatação.' },
          // callModel converte "image" em inline_data; o Gemini aceita áudio no mesmo formato.
          { type: 'image', source: { type: 'base64', media_type: mimeType || 'audio/m4a', data: audioBase64 } },
        ],
      }],
      maxTokens: 2048,
    });
    return text.trim();
  }

  throw new HttpError(400, 'O provedor Anthropic não suporta transcrição de áudio. Configure uma chave OpenAI, Groq ou Gemini em Perfil → Configuração da IA.');
}

module.exports = {
  PROVIDERS, PROVIDER_MODELS, VISION_PROVIDERS, TRANSCRIPTION_PROVIDERS, CATEGORIES,
  callModel, chat, extract, sanitizeExtracted, generateInsights, extractMeals,
  extractWorkoutFromText, extractWorkoutFromImage, transcribe,
  // exportados para testes
  toOpenAIMessages, toGeminiContents, buildInsightsPrompt, parseWorkoutPlansJson,
};
