import { Message, UserProfile, ExtractedData } from '../types';
import { format, subDays, isAfter } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const API_BASE = 'http://localhost:3001';

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
    entries.slice(-6).forEach((e) => {
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
  private headers: Record<string, string>;

  constructor(private apiKey: string) {
    this.headers = {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    };
  }

  async chat(
    messages: Message[],
    profile: UserProfile | null,
    diaryData: ExtractedData[] = []
  ): Promise<string> {
    const formatted = messages.slice(-20).map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    const systemPrompt = buildSystemPrompt(profile, diaryData);

    const res = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ messages: formatted, systemPrompt }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(data.error || 'Erro na API');
    }
    const data = await res.json();
    return data.text;
  }

  async extractData(userMessage: string): Promise<ExtractedData[]> {
    try {
      const res = await fetch(`${API_BASE}/api/extract`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({ message: userMessage }),
      });
      const data = await res.json();
      const now = Date.now();
      return (data.data || []).map((item: Omit<ExtractedData, 'timestamp'>) => ({
        ...item,
        timestamp: now,
      }));
    } catch {
      return [];
    }
  }
}
