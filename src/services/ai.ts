import { Message, UserProfile, ExtractedData, AiInsight } from '../types';
import { format, subDays, isAfter } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { apiRequest, AI_TIMEOUT_MS } from './api';

function buildDiaryContext(diaryData: ExtractedData[]): string {
  if (diaryData.length === 0) return '';

  const last14days = diaryData.filter((d) => isAfter(d.timestamp, subDays(Date.now(), 14)));
  if (last14days.length === 0) return '';

  const byCategory: Record<string, ExtractedData[]> = {};
  last14days.forEach((d) => {
    if (!byCategory[d.category]) byCategory[d.category] = [];
    byCategory[d.category].push(d);
  });

  const lines: string[] = ['--- HISTÓRICO RECENTE DO USUÁRIO (últimos 14 dias) ---'];

  const categoryLabels: Record<string, string> = {
    sleep: 'SONO', nutrition: 'ALIMENTAÇÃO', performance: 'PERFORMANCE',
    mood: 'HUMOR', health: 'SAÚDE', workout: 'TREINOS',
  };

  Object.entries(byCategory).forEach(([cat, entries]) => {
    lines.push(`\n${categoryLabels[cat] || cat.toUpperCase()}:`);
    // Os 6 mais recentes, exibidos em ordem cronológica. O servidor devolve
    // o Diário do mais novo para o mais antigo, então slice(-6) sem ordenar
    // pegava os 6 MAIS ANTIGOS da janela.
    [...entries].sort((a, b) => a.timestamp - b.timestamp).slice(-6).forEach((e) => {
      const date = format(e.timestamp, "dd/MM 'às' HH:mm", { locale: ptBR });
      lines.push(`  • ${date} — ${e.label}: ${e.value}`);
    });
  });

  lines.push('\n--- USE ESTE HISTÓRICO para personalizar suas respostas. Mencione padrões relevantes quando pertinente, mas não despeje todos os dados de uma vez. ---');

  return lines.join('\n');
}

function buildSystemPrompt(profile: UserProfile | null, diaryData: ExtractedData[]): string {
  const goalLabel = profile?.goal === 'hypertrophy' ? 'Hipertrofia'
    : profile?.goal === 'weight_loss' ? 'Emagrecimento'
    : profile?.goal === 'conditioning' ? 'Condicionamento'
    : 'Saúde geral';

  const levelLabel = profile?.level === 'beginner' ? 'Iniciante'
    : profile?.level === 'intermediate' ? 'Intermediário'
    : 'Avançado';

  const profileBlock = profile ? `
PERFIL DO USUÁRIO:
- Nome: ${profile.name}
- Objetivo: ${goalLabel}
- Nível: ${levelLabel}` : '';

  const diaryBlock = buildDiaryContext(diaryData);

  return `Você é o AmigoFit, um companheiro de treino e saúde pessoal. Fale em português brasileiro de forma natural, descontraída e motivadora — como um personal trainer que também é amigo próximo.
${profileBlock}
${diaryBlock}

REGRAS DE COMPORTAMENTO:
- Use o histórico acima para dar respostas personalizadas e contextualizadas
- Se o usuário mencionar algo que se relaciona com dados do histórico, conecte os pontos (ex: "você teve azia na última vez que comeu pesado à noite também")
- Respostas curtas e diretas (máx. 3-4 parágrafos)
- Linguagem informal mas profissional
- Nunca substitua consulta médica
- Quando houver sintomas preocupantes, sugira médico
- A conversa atual também importa: considere tudo que foi dito nessa sessão`;
}

export class AIService {
  async chat(
    messages: Message[],
    profile: UserProfile | null,
    diaryData: ExtractedData[] = [],
    imageBase64?: string,
    imageMimeType?: string
  ): Promise<string> {
    const sliced = messages.slice(-20);

    const firstUserIdx = sliced.findIndex((m) => m.role === 'user');
    const trimmed = firstUserIdx >= 0 ? sliced.slice(firstUserIdx) : sliced;

    type ApiMessage = { role: 'user' | 'assistant'; content: string | object[] };
    const formatted: ApiMessage[] = trimmed.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    while (formatted.length > 0 && formatted[formatted.length - 1].role === 'assistant') {
      formatted.pop();
    }

    if (formatted.length === 0) return 'Pode me contar mais?';

    if (imageBase64 && imageMimeType && formatted.length > 0) {
      const last = formatted[formatted.length - 1];
      formatted[formatted.length - 1] = {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: imageMimeType, data: imageBase64 } },
          { type: 'text', text: typeof last.content === 'string' ? last.content : '' },
        ],
      };
    }

    const systemPrompt = buildSystemPrompt(profile, diaryData);
    const data = await apiRequest<{ text: string }>('/api/chat', {
      method: 'POST',
      body: { messages: formatted, systemPrompt },
      timeoutMs: AI_TIMEOUT_MS,
    });
    return data.text;
  }

  // Com messageId, o servidor grava os dados extraídos vinculados à mensagem
  // (idempotente) e já os devolve salvos — não é preciso gravar de novo.
  async extractData(userMessage: string, messageId?: string): Promise<ExtractedData[]> {
    const data = await apiRequest<{ data: ExtractedData[] }>('/api/extract', {
      method: 'POST',
      body: { message: userMessage, messageId },
      timeoutMs: AI_TIMEOUT_MS,
    });
    return data.data;
  }

  async transcribeAudio(audioBase64: string, mimeType: string): Promise<string> {
    // O servidor escolhe um provedor com chave que transcreva (Groq, OpenAI ou Gemini).
    const data = await apiRequest<{ text: string }>('/api/transcribe', {
      method: 'POST',
      body: { audioBase64, mimeType },
      timeoutMs: AI_TIMEOUT_MS,
    });
    return data.text || '';
  }

  async generateInsights(data: ExtractedData[], profile: UserProfile | null): Promise<AiInsight[]> {
    const resData = await apiRequest<{ insights: AiInsight[] }>('/api/insights', {
      method: 'POST',
      body: { data, profile },
      timeoutMs: AI_TIMEOUT_MS,
    });
    return resData.insights || [];
  }
}
