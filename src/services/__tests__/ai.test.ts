import { AIService } from '../ai';

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
