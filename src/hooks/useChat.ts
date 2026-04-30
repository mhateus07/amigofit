import { useState, useCallback, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Message, UserProfile } from '../types';
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
    async (text: string) => {
      if (!text.trim() || isLoading) return;

      const userMessage: Message = {
        id: uuidv4(),
        role: 'user',
        content: text.trim(),
        timestamp: Date.now(),
      };

      setMessages((prev) => {
        const updated = [...prev, userMessage];
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

        // Load current conversation + diary data in parallel
        const [currentMessages, diaryData] = await Promise.all([
          storage.getMessages(),
          storage.getExtractedData(),
        ]);

        const [aiResponse, extractedData] = await Promise.all([
          aiServiceRef.current.chat(currentMessages, profile, diaryData),
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
        const errorMsg: Message = {
          id: uuidv4(),
          role: 'assistant',
          content: isBilling
            ? 'Saldo insuficiente na API Anthropic. Acesse console.anthropic.com → Plans & Billing para adicionar créditos.'
            : 'Ops, tive um problema de conexão. Tenta de novo?',
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
