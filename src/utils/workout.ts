import { Exercise, WorkoutPlan } from '../types';

// Técnicas que o personal escreve na ficha, com explicação curta para o
// aluno lembrar o que fazer na hora.
export interface Technique {
  key: string;
  label: string;
  color: string;
  description: string;
}

const TECHNIQUES: (Technique & { pattern: RegExp })[] = [
  { key: 'dropset', label: 'Drop-set', color: '#C2410C', pattern: /drop\s?-?set/i,
    description: 'Ao chegar na falha, reduza a carga (cerca de 20–30%) e continue sem descanso.' },
  { key: 'restpause', label: 'Rest-pause', color: '#7C3AED', pattern: /rest\s?-?pause/i,
    description: 'Ao chegar na falha, descanse 10–15 s e faça mais repetições com a mesma carga.' },
  { key: 'piramide', label: 'Pirâmide', color: '#0E7490', pattern: /pir[âa]mide/i,
    description: 'A cada série, aumente a carga e diminua as repetições (ex.: 12-10-8).' },
  { key: 'escada', label: 'Escada', color: '#0E7490', pattern: /escada/i,
    description: 'Carga crescente a cada série, seguindo as repetições indicadas (ex.: 10-6-6).' },
  { key: 'iso', label: 'Isometria', color: '#1D4ED8', pattern: /\biso\b|isom[ée]tric/i,
    description: 'Segure a posição parada pelo tempo indicado antes (ou depois) das repetições.' },
  { key: 'cadencia', label: 'Cadência', color: '#B45309', pattern: /exc[êe]ntric|cad[êe]ncia/i,
    description: 'Controle a descida no tempo indicado (ex.: 3 segundos) em cada repetição.' },
  { key: 'max', label: 'Até a falha', color: '#B91C1C', pattern: /falha|rep\.?\s*m[áa]x|\bm[áa]x\b/i,
    description: 'Faça repetições até não conseguir completar mais uma com boa execução.' },
  { key: 'biset', label: 'Bi-set', color: '#047857', pattern: /bi-?set|conjugad/i,
    description: 'Dois exercícios seguidos, sem descanso entre eles.' },
];

export function techniquesOf(e: Exercise): Technique[] {
  const text = [e.name, e.reps, e.notes].filter(Boolean).join(' ');
  return TECHNIQUES.filter((t) => t.pattern.test(text)).map(({ pattern: _p, ...t }) => t);
}

// Exercícios de mobilidade/aquecimento que abrem a ficha ficam numa seção
// própria, separados do treino principal.
const MOBILITY = /alongamento|circundu|rota[çc][ãa]o (externa|interna)|mobilidade|giro de quadril|piriforme|reza [áa]rabe|esfinge|cossack|adutor ajoelhado|aquecimento/i;

export function isMobility(e: Exercise): boolean {
  return MOBILITY.test(e.name);
}

export function splitSections(exercises: Exercise[]): { mobility: Exercise[]; main: Exercise[] } {
  let i = 0;
  while (i < exercises.length && isMobility(exercises[i])) i++;
  // Só vale a seção se sobrar treino principal depois dela.
  if (i === 0 || i === exercises.length) return { mobility: [], main: exercises };
  return { mobility: exercises.slice(0, i), main: exercises.slice(i) };
}

// Duração estimada: ~40s de execução por série + o descanso indicado.
export function estimateMinutes(plan: WorkoutPlan): number {
  const seconds = plan.exercises.reduce((sum, e) => {
    const sets = e.sets ?? 3;
    return sum + sets * (40 + (e.restSeconds ?? 60));
  }, 0);
  return Math.max(5, Math.round(seconds / 60 / 5) * 5);
}

export function totalSets(plan: WorkoutPlan): number {
  return plan.exercises.reduce((sum, e) => sum + (e.sets ?? 0), 0);
}

// "Treino B" → "B"; outros nomes → primeiras letras.
export function planBadge(plan: WorkoutPlan): string {
  const letter = plan.name.match(/\b([A-Z])$/);
  if (letter) return letter[1];
  return plan.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

export function formatRest(seconds?: number): string | null {
  if (!seconds) return null;
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m}min${String(s).padStart(2, '0')}` : `${m}min`;
}

const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

// Ficha do dia: a que tem o dia da semana no rótulo; senão a primeira ainda
// não feita hoje.
export function pickTodayPlan(plans: WorkoutPlan[], doneIds: Set<string>): WorkoutPlan | null {
  const weekday = normalize(WEEKDAYS[new Date().getDay()]);
  const byDay = plans.find((p) => p.dayLabel && normalize(p.dayLabel).includes(weekday));
  return byDay ?? plans.find((p) => !doneIds.has(p.id)) ?? plans[0] ?? null;
}
