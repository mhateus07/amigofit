import AsyncStorage from '@react-native-async-storage/async-storage';
import { userScopedKey } from './storage';
import { ApiError } from './api';

// Cópia local (por conta) do que o usuário precisa ver sem internet — o
// plano alimentar e as fichas — e fila de check-ins feitos offline.

export function isOfflineError(e: unknown): boolean {
  // status 0 = sem resposta do servidor (sem rede ou timeout).
  return e instanceof ApiError && e.status === 0;
}

export async function readCache<T>(name: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(userScopedKey(`amigofit_cache_${name}`));
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function writeCache<T>(name: string, value: T): Promise<void> {
  try {
    await AsyncStorage.setItem(userScopedKey(`amigofit_cache_${name}`), JSON.stringify(value));
  } catch {
    // Cache é só conveniência: falhar aqui não pode quebrar a tela.
  }
}

export interface PendingCheckin {
  kind: 'meal' | 'workout';
  id: string; // mealId ou workoutPlanId
  date: string;
  status: 'done' | 'skipped';
  checkedAt: number;
}

const QUEUE = 'pending_checkins';

export async function getPendingCheckins(): Promise<PendingCheckin[]> {
  return (await readCache<PendingCheckin[]>(QUEUE)) ?? [];
}

export async function enqueueCheckin(item: PendingCheckin): Promise<void> {
  const queue = await getPendingCheckins();
  // Só o último status de cada refeição/ficha no dia importa.
  const others = queue.filter((q) => !(q.kind === item.kind && q.id === item.id && q.date === item.date));
  await writeCache(QUEUE, [...others, item]);
}

// Envia a fila. Para no primeiro erro de rede (continua offline); descarta
// itens que o servidor recusou de vez (ex.: refeição apagada em outro aparelho).
export async function flushPendingCheckins(
  send: (item: PendingCheckin) => Promise<void>
): Promise<{ sent: number; remaining: number }> {
  const queue = await getPendingCheckins();
  const remaining: PendingCheckin[] = [];
  let sent = 0;
  let offline = false;
  for (const item of queue) {
    if (offline) { remaining.push(item); continue; }
    try {
      await send(item);
      sent++;
    } catch (e) {
      if (isOfflineError(e)) {
        offline = true;
        remaining.push(item);
      }
    }
  }
  await writeCache(QUEUE, remaining);
  return { sent, remaining: remaining.length };
}
