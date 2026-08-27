import { subDays } from 'date-fns';
import { computeAchievements } from '../achievements';
import { Message, ExtractedData } from '../../types';

function userMessage(daysAgo: number): Message {
  return {
    id: `m-${daysAgo}`,
    role: 'user',
    content: 'oi',
    timestamp: subDays(new Date(), daysAgo).getTime(),
  };
}

function extracted(category: ExtractedData['category'], daysAgo = 0): ExtractedData {
  return {
    category,
    label: category,
    value: '1',
    rawText: category,
    timestamp: subDays(new Date(), daysAgo).getTime(),
  };
}

describe('computeAchievements', () => {
  it('não desbloqueia nada sem mensagens ou dados', () => {
    const result = computeAchievements([], []);
    expect(result.every((a) => !a.unlocked)).toBe(true);
    expect(result.every((a) => a.progress === 0)).toBe(true);
  });

  it('desbloqueia "Primeiro passo" com uma mensagem do usuário', () => {
    const result = computeAchievements([userMessage(0)], []);
    const first = result.find((a) => a.id === 'first-message');
    expect(first?.unlocked).toBe(true);
  });

  it('desbloqueia conquistas de streak conforme dias consecutivos', () => {
    const messages = [0, 1, 2].map(userMessage); // hoje, ontem, anteontem
    const result = computeAchievements(messages, []);
    expect(result.find((a) => a.id === 'streak-3')?.unlocked).toBe(true);
    expect(result.find((a) => a.id === 'streak-7')?.unlocked).toBe(false);
  });

  it('desbloqueia "10 treinos registrados" só ao atingir o total', () => {
    const nineWorkouts = Array.from({ length: 9 }, () => extracted('workout'));
    expect(computeAchievements([], nineWorkouts).find((a) => a.id === 'workouts-10')?.unlocked).toBe(false);

    const tenWorkouts = Array.from({ length: 10 }, () => extracted('workout'));
    const result = computeAchievements([], tenWorkouts);
    expect(result.find((a) => a.id === 'workouts-10')?.unlocked).toBe(true);
    expect(result.find((a) => a.id === 'workouts-10')?.progress).toBe(1);
  });

  it('conta dias distintos de sono, não quantidade de registros', () => {
    const sameDayTwice = [extracted('sleep', 0), extracted('sleep', 0), extracted('sleep', 0)];
    const result = computeAchievements([], sameDayTwice);
    expect(result.find((a) => a.id === 'sleep-week')?.description).toBe('1/7 dias');
  });
});
