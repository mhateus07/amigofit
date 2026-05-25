import { useState, useCallback, useEffect, useRef } from 'react';
import { Message, UserProfile } from '../types';

const uuidv4 = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
import { storage } from '../services/storage';
import { AIService } from '../services/ai';

export function useChat(profile: UserProfile | null, apiKey: string | null) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const initialized = useRef(false);
  const aiServiceRef = useRef<AIService | null>(null);

  useEffect(() => {
    aiServiceRef.current = apiKey ? new AIService(apiKey) : null;
  }, [apiKey]);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    const init = async () => {
      const saved = await storage.getMessages();
      if (saved.length > 0) {
        setMessages(saved);
      } else {
        const welcome: Message = {
          id: uuidv4(),
          role: 'assistant',
          content: `E aí${profile?.name ? `, ${profile.name}` : ''}! Sou o AmigoFit, seu parceiro de treino. Pode falar comigo sobre tudo: o que comeu, como dormiu, como foi o treino, o que tá sentindo. Tô aqui pra te ajudar! 💪`,
          timestamp: Date.now(),
        };
        setMessages([welcome]);
        await storage.saveMessages([welcome]);
      }
    };
    init();
  }, []);

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

      let conversationForAI: Message[] = [];
      setMessages((prev) => {
        const updated = [...prev, userMessage];
        conversationForAI = updated;
        storage.saveMessages(updated);
        return updated;
      });
      setIsLoading(true);

      try {
        if (!aiServiceRef.current) {
          const noKeyMsg: Message = {
            id: uuidv4(),
            role: 'assistant',
            content: 'Para ativar a IA, vá em Perfil e configure sua chave da API Anthropic.',
            timestamp: Date.now(),
          };
          setMessages((prev) => {
            const updated = [...prev, noKeyMsg];
            storage.saveMessages(updated);
            return updated;
          });
          return;
        }

        const diaryData = await storage.getExtractedData();

        const [aiResponse, extractedData] = await Promise.all([
          aiServiceRef.current.chat(conversationForAI, profile, diaryData, imageBase64, imageMimeType),
          aiServiceRef.current.extractData(text),
        ]);

        const assistantMessage: Message = {
          id: uuidv4(),
          role: 'assistant',
          content: aiResponse,
          timestamp: Date.now(),
          extractedData: extractedData.length > 0 ? extractedData : undefined,
        };

        setMessages((prev) => {
          const updated = [...prev, assistantMessage];
          storage.saveMessages(updated);
          return updated;
        });

        if (extractedData.length > 0) {
          await storage.addExtractedData(extractedData);
        }
      } catch (error) {
        const errText = error instanceof Error ? error.message : String(error);
        const isBilling = errText.includes('credit balance');
        const isAuth = errText.includes('invalid x-api-key') || errText.includes('authentication') || errText.includes('401');
        const errorMsg: Message = {
          id: uuidv4(),
          role: 'assistant',
          content: isBilling
            ? 'Saldo insuficiente na API Anthropic. Acesse console.anthropic.com → Plans & Billing para adicionar créditos.'
            : isAuth
            ? 'API key inválida. Vá em Perfil e verifique sua chave Anthropic.'
            : `Erro: ${errText}`,
          timestamp: Date.now(),
        };
        setMessages((prev) => {
          const updated = [...prev, errorMsg];
          storage.saveMessages(updated);
          return updated;
        });
      } finally {
        setIsLoading(false);
      }
    },
    [isLoading, profile]
  );

  const clearHistory = useCallback(async () => {
    await storage.saveMessages([]);
    initialized.current = false;
    setMessages([]);
    const welcome: Message = {
      id: uuidv4(),
      role: 'assistant',
      content: `Conversa reiniciada! Tô aqui quando quiser${profile?.name ? `, ${profile.name}` : ''}. 💪`,
      timestamp: Date.now(),
    };
    setMessages([welcome]);
    await storage.saveMessages([welcome]);
  }, [profile]);

  return { messages, isLoading, sendMessage, clearHistory };
}
