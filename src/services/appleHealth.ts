import {
  isHealthDataAvailable,
  requestAuthorization,
  queryQuantitySamples,
  queryCategorySamples,
  queryWorkoutSamples,
  WorkoutTypeIdentifier,
  WorkoutActivityType,
} from '@kingstinct/react-native-healthkit';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ExtractedData } from '../types';
import { storage } from './storage';

const LAST_SYNC_KEY = 'amigofit_apple_health_last_sync';

const READ_PERMISSIONS = [
  'HKQuantityTypeIdentifierStepCount',
  'HKQuantityTypeIdentifierHeartRate',
  'HKQuantityTypeIdentifierBodyMass',
  'HKCategoryTypeIdentifierSleepAnalysis',
  WorkoutTypeIdentifier,
] as const;

// Amostras "adormecido" (exclui inBed e awake) — ver CategoryValueSleepAnalysis
const ASLEEP_VALUES = new Set([1, 3, 4, 5]);

const WORKOUT_NAMES: Partial<Record<WorkoutActivityType, string>> = {
  [WorkoutActivityType.running]: 'Corrida',
  [WorkoutActivityType.walking]: 'Caminhada',
  [WorkoutActivityType.cycling]: 'Ciclismo',
  [WorkoutActivityType.swimming]: 'Natação',
  [WorkoutActivityType.functionalStrengthTraining]: 'Treinamento funcional',
  [WorkoutActivityType.traditionalStrengthTraining]: 'Musculação',
  [WorkoutActivityType.yoga]: 'Yoga',
  [WorkoutActivityType.pilates]: 'Pilates',
  [WorkoutActivityType.coreTraining]: 'Treino de core',
  [WorkoutActivityType.highIntensityIntervalTraining]: 'HIIT',
  [WorkoutActivityType.boxing]: 'Boxe',
  [WorkoutActivityType.kickboxing]: 'Kickboxing',
  [WorkoutActivityType.dance]: 'Dança',
  [WorkoutActivityType.hiking]: 'Trilha',
  [WorkoutActivityType.rowing]: 'Remo',
  [WorkoutActivityType.basketball]: 'Basquete',
  [WorkoutActivityType.soccer]: 'Futebol',
  [WorkoutActivityType.tennis]: 'Tênis',
  [WorkoutActivityType.crossTraining]: 'Treino cruzado',
  [WorkoutActivityType.stairClimbing]: 'Escada',
  [WorkoutActivityType.elliptical]: 'Elíptico',
  [WorkoutActivityType.mixedMetabolicCardioTraining]: 'Cardio misto',
  [WorkoutActivityType.jumpRope]: 'Pular corda',
  [WorkoutActivityType.flexibility]: 'Alongamento',
};

function workoutName(type: WorkoutActivityType): string {
  return WORKOUT_NAMES[type] ?? 'Treino';
}

function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d;
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function getLastAppleHealthSyncTime(): Promise<Date | null> {
  const raw = await AsyncStorage.getItem(LAST_SYNC_KEY);
  return raw ? new Date(parseInt(raw, 10)) : null;
}

async function saveLastSyncTime(): Promise<void> {
  await AsyncStorage.setItem(LAST_SYNC_KEY, Date.now().toString());
}

export async function syncAppleHealth(): Promise<{ synced: number; error?: string }> {
  try {
    if (!isHealthDataAvailable()) {
      return { synced: 0, error: 'Apple Saúde não está disponível neste dispositivo.' };
    }

    await requestAuthorization({ toRead: READ_PERMISSIONS });

    const lastSync = await getLastAppleHealthSyncTime();
    const startDate = lastSync ?? daysAgo(7);
    const endDate = new Date();
    const dateFilter = { filter: { date: { startDate, endDate } }, limit: 0, ascending: true } as const;

    const extracted: ExtractedData[] = [];

    // Sono
    try {
      const samples = await queryCategorySamples('HKCategoryTypeIdentifierSleepAnalysis', dateFilter);
      const byDay = new Map<string, number>(); // ms dormidos
      for (const s of samples) {
        if (!ASLEEP_VALUES.has(s.value as number)) continue;
        const day = dayKey(new Date(s.startDate));
        const durationMs = new Date(s.endDate).getTime() - new Date(s.startDate).getTime();
        byDay.set(day, (byDay.get(day) ?? 0) + durationMs);
      }
      for (const [day, ms] of byDay) {
        const hours = Math.round((ms / 3_600_000) * 10) / 10;
        if (hours > 0) {
          extracted.push({
            category: 'sleep',
            label: 'Sono',
            value: `${hours} horas`,
            rawText: `[Apple Saúde] Sono: ${hours} horas`,
            timestamp: new Date(`${day}T12:00:00Z`).getTime(),
          });
        }
      }
    } catch { /* permissão não concedida */ }

    // Passos (agrupado por dia)
    try {
      const samples = await queryQuantitySamples('HKQuantityTypeIdentifierStepCount', { ...dateFilter, unit: 'count' });
      const byDay = new Map<string, number>();
      for (const s of samples) {
        const day = dayKey(new Date(s.startDate));
        byDay.set(day, (byDay.get(day) ?? 0) + s.quantity);
      }
      for (const [day, count] of byDay) {
        const total = Math.round(count);
        extracted.push({
          category: 'performance',
          label: 'Passos',
          value: `${total.toLocaleString('pt-BR')} passos`,
          rawText: `[Apple Saúde] Passos em ${day}: ${total}`,
          timestamp: new Date(`${day}T12:00:00Z`).getTime(),
        });
      }
    } catch { /* permissão não concedida */ }

    // Treinos
    try {
      const workouts = await queryWorkoutSamples({ filter: { date: { startDate, endDate } }, limit: 0, ascending: true });
      for (const w of workouts) {
        const mins = Math.round(w.duration.unit === 's' ? w.duration.quantity / 60 : w.duration.quantity);
        const name = workoutName(w.workoutActivityType);
        if (mins > 0) {
          extracted.push({
            category: 'workout',
            label: name,
            value: `${mins} minutos`,
            rawText: `[Apple Saúde] ${name}: ${mins} minutos`,
            timestamp: new Date(w.startDate).getTime(),
          });
        }
      }
    } catch { /* permissão não concedida */ }

    // Frequência cardíaca (média por dia)
    try {
      const samples = await queryQuantitySamples('HKQuantityTypeIdentifierHeartRate', { ...dateFilter, unit: 'count/min' });
      const byDay = new Map<string, { sum: number; count: number }>();
      for (const s of samples) {
        const day = dayKey(new Date(s.startDate));
        const entry = byDay.get(day) ?? { sum: 0, count: 0 };
        entry.sum += s.quantity;
        entry.count += 1;
        byDay.set(day, entry);
      }
      for (const [day, { sum, count }] of byDay) {
        if (count > 0) {
          const avg = Math.round(sum / count);
          extracted.push({
            category: 'health',
            label: 'Frequência cardíaca',
            value: `${avg} bpm`,
            rawText: `[Apple Saúde] FC média em ${day}: ${avg} bpm`,
            timestamp: new Date(`${day}T12:00:00Z`).getTime(),
          });
        }
      }
    } catch { /* permissão não concedida */ }

    // Peso
    try {
      const samples = await queryQuantitySamples('HKQuantityTypeIdentifierBodyMass', { ...dateFilter, unit: 'kg' });
      for (const s of samples) {
        const kg = Math.round(s.quantity * 10) / 10;
        extracted.push({
          category: 'health',
          label: 'Peso',
          value: `${kg} kg`,
          rawText: `[Apple Saúde] Peso: ${kg} kg`,
          timestamp: new Date(s.startDate).getTime(),
        });
      }
    } catch { /* permissão não concedida */ }

    if (extracted.length > 0) {
      await storage.addExtractedData(extracted);
    }
    await saveLastSyncTime();

    return { synced: extracted.length };
  } catch (e: any) {
    return { synced: 0, error: e?.message ?? 'Erro ao conectar ao Apple Saúde.' };
  }
}
