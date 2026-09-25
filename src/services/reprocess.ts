import { storage } from './storage';
import { AIService } from './ai';
import { errorMessage } from './api';

// Extrai dados das mensagens do usuário que ainda não foram processadas.
// Cada extração é vinculada ao ID da mensagem no servidor (idempotente):
// antes, "processada" era adivinhado pela proximidade de horário, o que
// pulava mensagens distintas ou duplicava extrações demoradas.
export async function reprocessHistory(
  onProgress?: (current: number, total: number) => void
): Promise<{ processed: number; dataPoints: number; failed: number; error?: string }> {
  let messages;
  try {
    messages = await storage.getAllMessages();
  } catch (e) {
    return { processed: 0, dataPoints: 0, failed: 0, error: errorMessage(e) };
  }

  const unprocessed = messages.filter(
    (m) => m.role === 'user' && !m.extractedAt && m.content.trim() && m.content !== '📷 Imagem enviada'
  );
  if (unprocessed.length === 0) return { processed: 0, dataPoints: 0, failed: 0 };

  const service = new AIService();
  let totalDataPoints = 0;
  let failed = 0;
  let lastError: string | undefined;

  for (let i = 0; i < unprocessed.length; i++) {
    onProgress?.(i + 1, unprocessed.length);
    try {
      const extracted = await service.extractData(unprocessed[i].content, unprocessed[i].id);
      totalDataPoints += extracted.length;
    } catch (e) {
      failed++;
      lastError = errorMessage(e);
    }
  }

  return {
    processed: unprocessed.length - failed,
    dataPoints: totalDataPoints,
    failed,
    error: failed === unprocessed.length ? lastError : undefined,
  };
}
