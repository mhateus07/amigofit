import { AIService } from '../ai';
import * as storage from '../storage';

describe('AIService.extractData', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('retorna os dados extraídos com timestamp adicionado', async () => {
    const mockData = [
      { category: 'sleep', label: 'Sono', value: '7h', rawText: 'dormi 7h' },
      { category: 'workout', label: 'Treino', value: 'Pernas', rawText: 'treinei pernas' },
    ];
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: mockData }),
    }) as unknown as typeof fetch;

    const service = new AIService();
    const result = await service.extractData('dormi 7h e treinei pernas');

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject(mockData[0]);
    expect(typeof result[0].timestamp).toBe('number');
    expect(result[1]).toMatchObject(mockData[1]);
  });

  it('retorna array vazio quando a resposta não tem dados', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    }) as unknown as typeof fetch;

    const service = new AIService();
    const result = await service.extractData('mensagem sem dados relevantes');

    expect(result).toEqual([]);
  });

  it('retorna array vazio (não lança) quando a requisição falha', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network error')) as unknown as typeof fetch;

    const service = new AIService();
    const result = await service.extractData('qualquer mensagem');

    expect(result).toEqual([]);
  });
});

describe('AIService.generateInsights', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('retorna os insights gerados pela API', async () => {
    const mockInsights = [
      { icon: '🌙', title: 'Sono baixo', description: 'Durma mais.', severity: 'warning' },
    ];
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ insights: mockInsights }),
    }) as unknown as typeof fetch;

    const service = new AIService();
    const result = await service.generateInsights([], null);

    expect(result).toEqual(mockInsights);
  });

  it('lança erro com a mensagem do servidor quando a resposta não é ok', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'API key ausente' }),
    }) as unknown as typeof fetch;

    const service = new AIService();

    await expect(service.generateInsights([], null)).rejects.toThrow('API key ausente');
  });
});

describe('AIService.transcribeAudio', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('lança erro quando nenhum provedor com chave suporta transcrição', async () => {
    jest.spyOn(storage, 'authHeadersForTranscription').mockResolvedValue(null);

    const service = new AIService();

    await expect(service.transcribeAudio('base64audio', 'audio/m4a')).rejects.toThrow(
      'Nenhuma chave de IA compatível com transcrição encontrada'
    );
  });

  it('retorna o texto transcrito quando a chamada é bem-sucedida', async () => {
    jest.spyOn(storage, 'authHeadersForTranscription').mockResolvedValue({
      'x-provider': 'groq',
      'x-api-key': 'fake-key',
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: 'dormi bem essa noite' }),
    }) as unknown as typeof fetch;

    const service = new AIService();
    const result = await service.transcribeAudio('base64audio', 'audio/m4a');

    expect(result).toBe('dormi bem essa noite');
  });

  it('lança erro com a mensagem do servidor quando a transcrição falha', async () => {
    jest.spyOn(storage, 'authHeadersForTranscription').mockResolvedValue({
      'x-provider': 'groq',
      'x-api-key': 'fake-key',
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Provedor indisponível' }),
    }) as unknown as typeof fetch;

    const service = new AIService();

    await expect(service.transcribeAudio('base64audio', 'audio/m4a')).rejects.toThrow('Provedor indisponível');
  });
});
