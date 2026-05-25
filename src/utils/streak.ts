import { startOfDay, subDays } from 'date-fns';
import { Message } from '../types';

export function calculateStreak(messages: Message[]): number {
  const userDays = new Set(
    messages
      .filter(m => m.role === 'user')
      .map(m => startOfDay(m.timestamp).getTime())
  );

  if (userDays.size === 0) return 0;

  let streak = 0;
  let current = startOfDay(Date.now()).getTime();

  // Se não tem mensagem hoje, começa a contar a partir de ontem
  if (!userDays.has(current)) {
    current = startOfDay(subDays(Date.now(), 1)).getTime();
  }

  while (userDays.has(current)) {
    streak++;
    current = startOfDay(subDays(current, 1)).getTime();
  }

  return streak;
}
