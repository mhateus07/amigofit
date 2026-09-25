import { techniquesOf, splitSections, estimateMinutes, planBadge, formatRest } from '../workout';
import { Exercise, WorkoutPlan } from '../../types';

const ex = (name: string, extra: Partial<Exercise> = {}): Exercise => ({ id: name, name, ...extra });

describe('techniquesOf', () => {
  it('reconhece as técnicas escritas pelo personal', () => {
    expect(techniquesOf(ex('Pulldown com barra aberta', { notes: 'DROPSET na última série' })).map((t) => t.key)).toEqual(['dropset']);
    expect(techniquesOf(ex('Puxador alto', { notes: 'Pegada semi-pronada · RESTPAUSE na última série' })).map((t) => t.key)).toEqual(['restpause']);
    expect(techniquesOf(ex('Tríceps arado', { reps: '12-10-8', notes: 'pirâmide crescente na carga' })).map((t) => t.key)).toEqual(['piramide']);
    expect(techniquesOf(ex('Cadeira flexora c/ iso', { reps: '10” iso + 12' })).map((t) => t.key)).toEqual(['iso']);
    expect(techniquesOf(ex('Remada cavalinho', { notes: 'Excêntrica em cadência de 3”' })).map((t) => t.key)).toEqual(['cadencia']);
    expect(techniquesOf(ex('Supino reto', { reps: '8 a 10' }))).toEqual([]);
  });
});

describe('splitSections', () => {
  it('separa a mobilidade do começo da ficha do treino principal', () => {
    const plan = [
      ex('Circundução de ombro c/ megaband'), ex('Alongamento de ombro c/ megaband na grade'),
      ex('Barra livre aberta pronada'), ex('Alongamento final'),
    ];
    const { mobility, main } = splitSections(plan);
    expect(mobility.map((e) => e.name)).toEqual(['Circundução de ombro c/ megaband', 'Alongamento de ombro c/ megaband na grade']);
    expect(main.map((e) => e.name)).toEqual(['Barra livre aberta pronada', 'Alongamento final']);
  });

  it('sem mobilidade no começo, tudo é treino principal', () => {
    expect(splitSections([ex('Supino'), ex('Alongamento')]).mobility).toEqual([]);
  });
});

describe('outros', () => {
  const plan: WorkoutPlan = { id: 'p', name: 'Treino B', source: 'pdf', exercises: [ex('a', { sets: 3, restSeconds: 90 }), ex('b', { sets: 2, restSeconds: 20 })] };
  it('estima a duração em múltiplos de 5 minutos', () => {
    expect(estimateMinutes(plan)).toBe(10); // 3*(40+90) + 2*(40+20) = 510s ≈ 8,5 → 10
  });
  it('mostra a letra da ficha e o descanso legível', () => {
    expect(planBadge(plan)).toBe('B');
    expect(formatRest(90)).toBe('1min30');
    expect(formatRest(45)).toBe('45s');
  });
});
