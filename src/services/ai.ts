import { Message, UserProfile, ExtractedData } from '../types';

const API_BASE = 'http://localhost:3001';

const SYSTEM_PROMPT = (profile: UserProfile | null) =>
  `Você é o AmigoFit, um companheiro de treino e saúde pessoal no estilo de um amigo que entende muito de fitness. Você fala em português brasileiro de forma natural, descontraída e motivadora — como um personal trainer que também é amigo.

${profile ? `
Perfil do usuário:
- Nome: ${profile.name}
- Objetivo: ${profile.goal === 'hypertrophy' ? 'Hipertrofia' : profile.goal === 'weight_loss' ? 'Emagrecimento' : profile.goal === 'conditioning' ? 'Condicionamento' : 'Saúde geral'}
- Nível: ${profile.level === 'beginner' ? 'Iniciante' : profile.level === 'intermediate' ? 'Intermediário' : 'Avançado'}
` : ''}

Regras:
- Respostas curtas e diretas (máx. 3-4 parágrafos)
- Linguagem informal mas profissional
- Nunca substitua consulta médica
- Quando houver sintomas preocupantes, sugira médico`;

export class AIService {
  private headers: Record<string, string>;

  constructor(private apiKey: string) {
    this.headers = {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    };
  }

  async chat(messages: Message[], profile: UserProfile | null): Promise<string> {
    const formatted = messages.slice(-20).map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    const res = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ messages: formatted, systemPrompt: SYSTEM_PROMPT(profile) }),
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
