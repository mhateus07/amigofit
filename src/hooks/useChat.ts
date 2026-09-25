import { useState, useCallback, useEffect, useRef } from 'react';
import { Message, UserProfile } from '../types';
import { storage } from '../services/storage';
import { AIService } from '../services/ai';
import { errorMessage, isStaleSession } from '../services/api';
import { isOfflineError, readCache, writeCache } from '../services/offline';

const uuidv4 = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

const aiService = new AIService();

const PAGE_SIZE = 100;

export type ChatLoadState = 'loading' | 'ready' | 'error';

function friendlyAiError(errText: string): string {
  // Anthropic: "credit balance"; OpenAI: "insufficient_quota" / "no credits remaining".
  const isBilling = /credit balance|insufficient_quota|no credits|exceeded your current quota/i.test(errText);
  const isMissingKey = errText.includes('API key ausente');
  const isAuth = (errText.includes('invalid') && errText.includes('key')) || errText.includes('authentication') || errText.includes('401');
  if (isBilling) return 'Seu provedor de IA está sem créditos. Adicione créditos no painel dele, ou troque de provedor em Perfil (⚙️ na aba Hoje) → Configuração da IA.';
  if (isMissingKey) return 'Para ativar a IA, vá em Perfil → Configuração da IA e adicione sua chave de API.';
  if (isAuth) return 'Chave de API inválida. Vá em Perfil → Configuração da IA e verifique sua chave.';
  return `Erro: ${errText}`;
}

export function useChat(profile: UserProfile | null) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadState, setLoadState] = useState<ChatLoadState>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [offline, setOffline] = useState(false);
  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = messages;

  const patchMessage = useCallback((id: string, patch: Partial<Message>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }, []);

  // Grava uma mensagem; em caso de falha ela fica marcada na tela com a opção
  // de tentar de novo, em vez de parecer salva.
  const persist = useCallback(async (message: Message): Promise<boolean> => {
    try {
      await storage.saveMessage(message);
      patchMessage(message.id, { saveFailed: false });
      return true;
    } catch (e) {
      if (isStaleSession(e)) return false;
      patchMessage(message.id, { saveFailed: true });
      return false;
    }
  }, [patchMessage]);

  const welcome = useCallback((content: string): Message => ({
    id: uuidv4(),
    role: 'assistant',
    content,
    timestamp: Date.now(),
  }), []);

  const load = useCallback(async () => {
    setLoadState('loading');
    setLoadError(null);
    try {
      const page = await storage.getMessages({ limit: PAGE_SIZE });
      setOffline(false);
      writeCache('chat', page.messages.slice(-50));
      setHasMore(page.hasMore);
      if (page.messages.length > 0) {
        setMessages(page.messages);
      } else {
        const first = welcome(`E aí${profile?.name ? `, ${profile.name}` : ''}! Sou o AmigoFit, seu parceiro de treino. Pode falar comigo sobre tudo: o que comeu, como dormiu, como foi o treino, o que tá sentindo. Tô aqui pra te ajudar! 💪`);
        setMessages([first]);
        persist(first);
      }
      setLoadState('ready');
    } catch (e) {
      if (isStaleSession(e)) return;
      // Sem internet: mostra as últimas mensagens salvas no aparelho.
      const cached = isOfflineError(e) ? await readCache<Message[]>('chat') : null;
      if (cached && cached.length) {
        setMessages(cached);
        setHasMore(false);
        setOffline(true);
        setLoadState('ready');
        return;
      }
      setLoadError(errorMessage(e));
      setLoadState('error');
    }
  }, [profile?.name, persist, welcome]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadMore = useCallback(async () => {
    const oldest = messagesRef.current[0];
    if (!hasMore || loadingMore || !oldest) return;
    setLoadingMore(true);
    try {
      const page = await storage.getMessages({ limit: PAGE_SIZE, before: oldest.timestamp });
      setMessages((prev) => [...page.messages, ...prev]);
      setHasMore(page.hasMore);
    } catch {
      // Mantém o que já está na tela; o usuário pode rolar de novo para tentar.
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadingMore]);

  const retrySave = useCallback(async (id: string) => {
    const message = messagesRef.current.find((m) => m.id === id);
    if (message) await persist(message);
  }, [persist]);

  const sendMessage = useCallback(
    async (text: string, imageBase64?: string, imageMimeType?: string, imageUri?: string) => {
      if (!text.trim() && !imageBase64) return;
      if (isLoading) return;

      const userMessage: Message = {
        id: uuidv4(),
        role: 'user',
        content: text.trim() || '📷 Imagem enviada',
        timestamp: Date.now(),
        imageUri,
      };
      const conversationForAI = [...messagesRef.current, userMessage];
      setMessages(conversationForAI);
      setIsLoading(true);

      try {
        // Anexo: envia a imagem antes, para a mensagem salva apontar para ela.
        let saved = false;
        try {
          if (imageBase64 && imageMimeType) {
            userMessage.imageId = await storage.uploadChatImage(imageBase64, imageMimeType);
            patchMessage(userMessage.id, { imageId: userMessage.imageId });
          }
          saved = await persist(userMessage);
        } catch (e) {
          if (isStaleSession(e)) return;
          patchMessage(userMessage.id, { saveFailed: true });
        }

        const diaryData = await storage.getExtractedData().catch(() => []);

        // A extração só roda se a mensagem foi salva: os dados ficam vinculados
        // a ela. Se falhar, a mensagem continua sem extractedAt e o
        // "Reprocessar histórico" do Perfil pega ela depois.
        const extraction = saved && text.trim()
          ? aiService.extractData(text, userMessage.id).catch(() => [])
          : Promise.resolve([]);

        const [aiResponse, extractedData] = await Promise.all([
          aiService.chat(conversationForAI, profile, diaryData, imageBase64, imageMimeType),
          extraction,
        ]);

        if (extractedData.length > 0) {
          patchMessage(userMessage.id, { extractedData, extractedAt: Date.now() });
        }

        const assistantMessage: Message = {
          id: uuidv4(),
          role: 'assistant',
          content: aiResponse,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, assistantMessage]);
        await persist(assistantMessage);
      } catch (error) {
        if (isStaleSession(error)) return;
        // Mensagem de erro só na tela: não vai para o histórico salvo.
        const errorMsg: Message = {
          id: uuidv4(),
          role: 'assistant',
          content: friendlyAiError(errorMessage(error)),
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, errorMsg]);
      } finally {
        setIsLoading(false);
      }
    },
    [isLoading, profile, persist, patchMessage]
  );

  // Lança erro se o servidor não confirmar — a tela avisa e mantém a conversa.
  const clearHistory = useCallback(async () => {
    await storage.clearMessages();
    const first = welcome(`Conversa reiniciada! Tô aqui quando quiser${profile?.name ? `, ${profile.name}` : ''}. 💪`);
    setMessages([first]);
    setHasMore(false);
    await persist(first);
  }, [profile, persist, welcome]);

  // "Não era isso": remove do Diário os registros que a IA extraiu da mensagem.
  const discardExtraction = useCallback(async (messageId: string) => {
    const message = messagesRef.current.find((m) => m.id === messageId);
    const items = message?.extractedData ?? [];
    for (const item of items) {
      if (item.id) await storage.deleteExtractedData(item.id);
    }
    patchMessage(messageId, { extractedData: [] });
  }, [patchMessage]);

  return {
    messages, isLoading, sendMessage, clearHistory, discardExtraction,
    loadState, loadError, reload: load, offline,
    hasMore, loadingMore, loadMore, retrySave,
  };
}
