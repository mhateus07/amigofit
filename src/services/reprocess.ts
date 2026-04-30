import { storage } from './storage';
import { AIService } from './ai';
import { ExtractedData } from '../types';

const API_BASE = 'http://localhost:3001';

async function checkBackend(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'healthcheck' },
      body: JSON.stringify({ message: 'ping' }),
    });
    const text = await res.text();
    return text.startsWith('{');
  } catch {
    return false;
  }
}

export async function reprocessHistory(
  apiKey: string,
  onProgress?: (current: number, total: number) => void
): Promise<{ processed: number; dataPoints: number; error?: string }> {
  const alive = await checkBackend();
  if (!alive) {
    return { processed: 0, dataPoints: 0, error: 'Backend offline. Reinicie com: node server/index.js' };
  }

  const [messages, existingData] = await Promise.all([
    storage.getMessages(),
    storage.getExtractedData(),
  ]);

  const userMessages = messages.filter((m) => m.role === 'user');
  if (userMessages.length === 0) return { processed: 0, dataPoints: 0 };

  // Consider a message processed if there's extracted data within 10s of its timestamp
  const unprocessed = userMessages.filter((msg) =>
    !existingData.some((d) => Math.abs(d.timestamp - msg.timestamp) < 10000)
  );

  if (unprocessed.length === 0) return { processed: 0, dataPoints: 0 };

  const service = new AIService(apiKey);
  let totalDataPoints = 0;

  for (let i = 0; i < unprocessed.length; i++) {
    onProgress?.(i + 1, unprocessed.length);
    try {
      const extracted: ExtractedData[] = await service.extractData(unprocessed[i].content);
      const tagged = extracted.map((d, j) => ({
        ...d,
        timestamp: unprocessed[i].timestamp + j + 1,
      }));
      if (tagged.length > 0) {
        await storage.addExtractedData(tagged);
        totalDataPoints += tagged.length;
      }
    } catch (e) {
      console.warn('Extraction failed for message:', unprocessed[i].content.slice(0, 50), e);
    }
  }

  return { processed: unprocessed.length, dataPoints: totalDataPoints };
}
