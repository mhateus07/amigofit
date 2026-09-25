import { AIService } from '../ai';
import { ExtractedData } from '../../types';

// Resposta mínima de fetch usada pelo apiRequest.
function response(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  };
}

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

function mockFetch(status: number, body: unknown) {
  const fn = jest.fn().mockResolvedValue(response(status, body));
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe('AIService.extractData', () => {
  it('manda o messageId e devolve os registros já salvos pelo servidor', async () => {
    const saved = [{ id: 1, category: 'sleep', label: 'Sono', value: '7h', rawText: 'dormi 7h', timestamp: 1001, messageId: 'm1' }];
    const fetchMock = mockFetch(200, { data: saved });

    const result = await new AIService().extractData('dormi 7h', 'm1');

    expect(result).toEqual(saved);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ message: 'dormi 7h', messageId: 'm1' });
  });

  it('lança erro (em vez de fingir que não havia dados) quando a requisição falha', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network error')) as unknown as typeof fetch;
    await expect(new AIService().extractData('qualquer mensagem')).rejects.toThrow('Sem conexão');
  });
});

describe('AIService.generateInsights', () => {
  it('retorna os insights gerados pela API', async () => {
    const mockInsights = [{ icon: '🌙', title: 'Sono baixo', description: 'Durma mais.', severity: 'warning' }];
    mockFetch(200, { insights: mockInsights });
    expect(await new AIService().generateInsights([], null)).toEqual(mockInsights);
  });

  it('lança erro com a mensagem do servidor quando a resposta não é ok', async () => {
    mockFetch(401, { error: 'API key ausente' });
    await expect(new AIService().generateInsights([], null)).rejects.toThrow('API key ausente');
  });
});

describe('AIService.transcribeAudio', () => {
  it('retorna o texto transcrito', async () => {
    mockFetch(200, { text: 'dormi bem essa noite' });
    expect(await new AIService().transcribeAudio('base64audio', 'audio/m4a')).toBe('dormi bem essa noite');
  });

  it('lança erro com a mensagem do servidor quando a transcrição falha', async () => {
    mockFetch(502, { error: 'Provedor indisponível' });
    await expect(new AIService().transcribeAudio('base64audio', 'audio/m4a')).rejects.toThrow('Provedor indisponível');
  });
});

describe('AIService.chat — contexto do diário', () => {
  it('usa os 6 registros MAIS RECENTES de cada categoria, mesmo com o diário em ordem decrescente', async () => {
    const fetchMock = mockFetch(200, { text: 'ok' });
    const now = Date.now();
    // Como o servidor devolve: do mais novo para o mais antigo.
    const diary: ExtractedData[] = Array.from({ length: 10 }, (_, i) => ({
      category: 'sleep', label: 'Sono', value: `${i}h-recente-${10 - i}`, rawText: '', timestamp: now - i * 3600_000,
    }));

    await new AIService().chat([{ id: 'u', role: 'user', content: 'oi', timestamp: now }], null, diary);

    const { systemPrompt } = JSON.parse(fetchMock.mock.calls[0][1].body);
    // Os 6 mais recentes (i = 0..5) entram; os mais antigos (i = 6..9) não.
    for (let i = 0; i < 6; i++) expect(systemPrompt).toContain(`${i}h-recente-`);
    for (let i = 6; i < 10; i++) expect(systemPrompt).not.toContain(`${i}h-recente-`);
  });
});
