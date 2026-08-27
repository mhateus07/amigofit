import { startOfDay } from 'date-fns';
import { Message, ExtractedData } from '../types';
import { calculateStreak } from './streak';

export interface Achievement {
  id: string;
  icon: string;
  title: string;
  description: string;
  unlocked: boolean;
  progress: number; // 0 a 1
}

function distinctDays(timestamps: number[]): number {
  return new Set(timestamps.map((t) => startOfDay(t).getTime())).size;
}

interface AchievementDef {
  id: string;
  icon: string;
  title: string;
  target: number;
  unit: string;
  current: (messages: Message[], data: ExtractedData[]) => number;
}

const DEFS: AchievementDef[] = [
  {
    id: 'first-message',
    icon: '👋',
    title: 'Primeiro passo',
    target: 1,
    unit: 'mensagem',
    current: (messages) => messages.filter((m) => m.role === 'user').length,
  },
  {
    id: 'streak-3',
    icon: '🔥',
    title: '3 dias seguidos',
    target: 3,
    unit: 'dias',
    current: (messages) => calculateStreak(messages),
  },
  {
    id: 'streak-7',
    icon: '🔥',
    title: '1 semana de streak',
    target: 7,
    unit: 'dias',
    current: (messages) => calculateStreak(messages),
  },
  {
    id: 'streak-30',
    icon: '🏆',
    title: '30 dias seguidos',
    target: 30,
    unit: 'dias',
    current: (messages) => calculateStreak(messages),
  },
  {
    id: 'workouts-10',
    icon: '💪',
    title: '10 treinos registrados',
    target: 10,
    unit: 'treinos',
    current: (_messages, data) => data.filter((d) => d.category === 'workout').length,
  },
  {
    id: 'sleep-week',
    icon: '🌙',
    title: 'Semana de sono completa',
    target: 7,
    unit: 'dias',
    current: (_messages, data) => distinctDays(data.filter((d) => d.category === 'sleep').map((d) => d.timestamp)),
  },
  {
    id: 'diary-50',
    icon: '📔',
    title: '50 registros no Diário',
    target: 50,
    unit: 'registros',
    current: (_messages, data) => data.length,
  },
  {
    id: 'diary-100',
    icon: '🎯',
    title: '100 registros no Diário',
    target: 100,
    unit: 'registros',
    current: (_messages, data) => data.length,
  },
];

export function computeAchievements(messages: Message[], data: ExtractedData[]): Achievement[] {
  return DEFS.map((def) => {
    const current = def.current(messages, data);
    const capped = Math.min(current, def.target);
    return {
      id: def.id,
      icon: def.icon,
      title: def.title,
      description: `${capped}/${def.target} ${def.unit}`,
      unlocked: current >= def.target,
      progress: def.target > 0 ? capped / def.target : 0,
    };
  });
}
