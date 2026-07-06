import { renderHook, act, waitFor } from '@testing-library/react-native';
import { useChat } from '../useChat';
import { storage } from '../../services/storage';
import { AIService } from '../../services/ai';
import { UserProfile } from '../../types';

jest.mock('../../services/storage');
jest.mock('../../services/ai');

const mockedStorage = storage as jest.Mocked<typeof storage>;
const mockedAIServiceClass = AIService as jest.MockedClass<typeof AIService>;

// useChat.ts cria `new AIService()` uma única vez, no carregamento do módulo —
// captura essa instância aqui, antes que `clearAllMocks()` (em beforeEach) apague
// o registro de `mock.instances` da classe. Nota: o valor da instância fica em
// `mock.instances`, não em `mock.results[].value` (que registra o retorno explícito
// do construtor, `undefined` nesse caso).
const aiInstance = mockedAIServiceClass.mock.instances[0] as unknown as {
  chat: jest.Mock;
  extractData: jest.Mock;
};

const profile: UserProfile = {
  name: 'Mateus',
  goal: 'hypertrophy',
  level: 'intermediate',
  onboardingComplete: true,
};

describe('useChat', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedStorage.getMessages.mockResolvedValue([]);
    mockedStorage.saveMessages.mockResolvedValue(undefined);
    mockedStorage.getExtractedData.mockResolvedValue([]);
    mockedStorage.addExtractedData.mockResolvedValue(undefined);
    mockedStorage.hasAnyApiKey.mockResolvedValue(true);
    aiInstance.chat.mockResolvedValue('ok');
    aiInstance.extractData.mockResolvedValue([]);
  });

  it('inicializa com mensagem de boas-vindas quando não há histórico salvo', async () => {
    const { result } = await renderHook(() => useChat(profile));

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(1);
    });
    expect(result.current.messages[0].role).toBe('assistant');
    expect(result.current.messages[0].content).toContain('Mateus');
  });

  it('carrega o histórico salvo em vez da mensagem de boas-vindas', async () => {
    mockedStorage.getMessages.mockResolvedValue([
      { id: '1', role: 'user', content: 'oi', timestamp: 1 },
    ]);

    const { result } = await renderHook(() => useChat(profile));

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(1);
    });
    expect(result.current.messages[0].content).toBe('oi');
  });

  it('avisa quando não há chave de API configurada, sem chamar a IA', async () => {
    mockedStorage.hasAnyApiKey.mockResolvedValue(false);
    const { result } = await renderHook(() => useChat(profile));

    await waitFor(() => expect(result.current.messages).toHaveLength(1));

    await act(async () => {
      await result.current.sendMessage('quanto peso eu levanto hoje?');
    });

    const last = result.current.messages[result.current.messages.length - 1];
    expect(last.content).toContain('Configuração da IA');
    expect(aiInstance.chat).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
  });

  it('envia mensagem, chama a IA e adiciona a resposta do assistente', async () => {
    aiInstance.chat.mockResolvedValue('Boa! Manda ver no treino de hoje.');

    const { result } = await renderHook(() => useChat(profile));
    await waitFor(() => expect(result.current.messages).toHaveLength(1));

    await act(async () => {
      await result.current.sendMessage('acabei de treinar pernas');
    });

    expect(aiInstance.chat).toHaveBeenCalledTimes(1);
    expect(aiInstance.extractData).toHaveBeenCalledTimes(1);

    const last = result.current.messages[result.current.messages.length - 1];
    expect(last.role).toBe('assistant');
    expect(last.content).toBe('Boa! Manda ver no treino de hoje.');
    expect(result.current.isLoading).toBe(false);
  });

  it('mostra mensagem de erro amigável quando a chave de API é inválida', async () => {
    aiInstance.chat.mockRejectedValue(new Error('authentication_error: invalid x-api-key'));

    const { result } = await renderHook(() => useChat(profile));
    await waitFor(() => expect(result.current.messages).toHaveLength(1));

    await act(async () => {
      await result.current.sendMessage('bom dia');
    });

    const last = result.current.messages[result.current.messages.length - 1];
    expect(last.content).toContain('Chave de API inválida');
  });
});
