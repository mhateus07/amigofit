import { renderHook, act, waitFor } from '@testing-library/react-native';
import { useChat } from '../useChat';
import { storage } from '../../services/storage';
import { AIService } from '../../services/ai';
import { ApiError } from '../../services/api';
import { UserProfile } from '../../types';

jest.mock('../../services/storage');
jest.mock('../../services/ai');

const mockedStorage = storage as jest.Mocked<typeof storage>;
const mockedAIServiceClass = AIService as jest.MockedClass<typeof AIService>;

// useChat.ts cria `new AIService()` uma única vez, no carregamento do módulo —
// captura essa instância aqui, antes que `clearAllMocks()` (em beforeEach) apague
// o registro de `mock.instances` da classe.
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
    mockedStorage.getMessages.mockResolvedValue({ messages: [], hasMore: false });
    mockedStorage.saveMessage.mockResolvedValue(undefined);
    mockedStorage.clearMessages.mockResolvedValue(undefined);
    mockedStorage.getExtractedData.mockResolvedValue([]);
    aiInstance.chat.mockResolvedValue('ok');
    aiInstance.extractData.mockResolvedValue([]);
  });

  it('inicializa com mensagem de boas-vindas quando não há histórico salvo', async () => {
    const { result } = await renderHook(() => useChat(profile));

    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    expect(result.current.messages[0].role).toBe('assistant');
    expect(result.current.messages[0].content).toContain('Mateus');
    expect(mockedStorage.saveMessage).toHaveBeenCalledTimes(1);
  });

  it('carrega o histórico salvo em vez da mensagem de boas-vindas', async () => {
    mockedStorage.getMessages.mockResolvedValue({
      messages: [{ id: '1', role: 'user', content: 'oi', timestamp: 1 }],
      hasMore: true,
    });

    const { result } = await renderHook(() => useChat(profile));

    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    expect(result.current.messages[0].content).toBe('oi');
    expect(result.current.hasMore).toBe(true);
  });

  it('falha ao carregar vira estado de erro (não conversa vazia nem boas-vindas por cima)', async () => {
    mockedStorage.getMessages.mockRejectedValue(new ApiError(0, 'Sem conexão com o servidor.'));

    const { result } = await renderHook(() => useChat(profile));

    await waitFor(() => expect(result.current.loadState).toBe('error'));
    expect(result.current.loadError).toContain('Sem conexão');
    expect(result.current.messages).toHaveLength(0);
    expect(mockedStorage.saveMessage).not.toHaveBeenCalled();
  });

  it('avisa quando não há chave de API configurada', async () => {
    aiInstance.chat.mockRejectedValue(new ApiError(401, 'API key ausente. Configure a chave em Perfil → Configuração da IA.'));
    const { result } = await renderHook(() => useChat(profile));
    await waitFor(() => expect(result.current.messages).toHaveLength(1));

    await act(async () => {
      await result.current.sendMessage('quanto peso eu levanto hoje?');
    });

    const last = result.current.messages[result.current.messages.length - 1];
    expect(last.content).toContain('Configuração da IA');
    expect(result.current.isLoading).toBe(false);
  });

  it('grava cada mensagem individualmente e vincula a extração ao id da mensagem', async () => {
    aiInstance.chat.mockResolvedValue('Boa! Manda ver no treino de hoje.');
    aiInstance.extractData.mockResolvedValue([{ category: 'workout', label: 'Treino', value: 'pernas', rawText: '', timestamp: 1 }]);

    const { result } = await renderHook(() => useChat(profile));
    await waitFor(() => expect(result.current.messages).toHaveLength(1));

    await act(async () => {
      await result.current.sendMessage('acabei de treinar pernas');
    });

    const [, userMsg, assistantMsg] = result.current.messages;
    expect(aiInstance.extractData).toHaveBeenCalledWith('acabei de treinar pernas', userMsg.id);
    expect(mockedStorage.saveMessage).toHaveBeenCalledWith(expect.objectContaining({ id: userMsg.id, role: 'user' }));
    expect(mockedStorage.saveMessage).toHaveBeenCalledWith(expect.objectContaining({ id: assistantMsg.id, role: 'assistant' }));
    expect(userMsg.extractedData).toHaveLength(1);
    expect(assistantMsg.content).toBe('Boa! Manda ver no treino de hoje.');
    expect(result.current.isLoading).toBe(false);
  });

  it('marca a mensagem como não salva quando o servidor recusa, e permite tentar de novo', async () => {
    const { result } = await renderHook(() => useChat(profile));
    await waitFor(() => expect(result.current.messages).toHaveLength(1));

    mockedStorage.saveMessage.mockRejectedValueOnce(new ApiError(500, 'Erro interno'));
    await act(async () => {
      await result.current.sendMessage('dormi 6h');
    });

    const userMsg = result.current.messages[1];
    expect(userMsg.saveFailed).toBe(true);
    // Sem salvar, a extração não roda (ela precisa da mensagem no servidor).
    expect(aiInstance.extractData).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.retrySave(userMsg.id);
    });
    expect(result.current.messages[1].saveFailed).toBe(false);
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

  it('limpar histórico usa a operação de exclusão do servidor', async () => {
    const { result } = await renderHook(() => useChat(profile));
    await waitFor(() => expect(result.current.messages).toHaveLength(1));

    await act(async () => {
      await result.current.clearHistory();
    });
    expect(mockedStorage.clearMessages).toHaveBeenCalledTimes(1);
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].content).toContain('Conversa reiniciada');
  });
});
