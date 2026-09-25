import {
  initialize,
  requestPermission,
  readRecords,
} from 'react-native-health-connect';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ExtractedData } from '../types';
import { storage, userScopedKey } from './storage';

// Separado por conta: trocar de conta não herda o marcador da anterior.
const lastSyncKey = () => userScopedKey('amigofit_health_last_sync');

const PERMISSIONS = [
  { accessType: 'read' as const, recordType: 'SleepSession' as const },
  { accessType: 'read' as const, recordType: 'Steps' as const },
  { accessType: 'read' as const, recordType: 'ExerciseSession' as const },
  { accessType: 'read' as const, recordType: 'HeartRate' as const },
  { accessType: 'read' as const, recordType: 'Weight' as const },
];

const EXERCISE_NAMES: Record<number, string> = {
  0: 'Exercício',
  2: 'Badminton',
  4: 'Ciclismo',
  8: 'Basquete',
  9: 'Boxe',
  10: 'Ciclismo indoor',
  11: 'Aula em grupo',
  13: 'Caminhada',
  16: 'Treinamento funcional',
  26: 'Pilates',
  29: 'Corrida',
  30: 'Esteira',
  32: 'Natação',
  38: 'Treino de força',
  44: 'Tênis',
  56: 'Yoga',
  57: 'Caminhada indoor',
  79: 'HIIT',
  82: 'Musculação',
};

function exerciseName(type: number): string {
  return EXERCISE_NAMES[type] ?? 'Treino';
}

function daysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export async function getLastSyncTime(): Promise<Date | null> {
  const raw = await AsyncStorage.getItem(lastSyncKey());
  return raw ? new Date(parseInt(raw, 10)) : null;
}

async function saveLastSyncTime(time: number): Promise<void> {
  await AsyncStorage.setItem(lastSyncKey(), time.toString());
}

// Relê desde o início do dia ANTERIOR à última sincronização: totais diários
// são recalculados por inteiro e substituem o registro do dia via sourceRef.
function windowStart(lastSync: Date | null): string {
  if (!lastSync) return daysAgo(7);
  const d = new Date(lastSync);
  d.setDate(d.getDate() - 1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export async function syncHealthConnect(): Promise<{ synced: number; error?: string }> {
  try {
    const available = await initialize();
    if (!available) {
      return { synced: 0, error: 'Health Connect não está disponível neste dispositivo. Instale o app Health Connect da Google Play.' };
    }

    await requestPermission(PERMISSIONS);

    const lastSync = await getLastSyncTime();
    const startTime = windowStart(lastSync);
    const syncedAt = Date.now();
    const endTime = new Date(syncedAt).toISOString();
    const timeRangeFilter = { operator: 'between' as const, startTime, endTime };

    const extracted: ExtractedData[] = [];

    // Sono
    try {
      const { records } = await readRecords('SleepSession', { timeRangeFilter });
      for (const r of records) {
        const start = new Date(r.startTime).getTime();
        const end = new Date(r.endTime).getTime();
        const hours = Math.round(((end - start) / 3_600_000) * 10) / 10;
        if (hours > 0) {
          extracted.push({
            category: 'sleep',
            label: 'Sono',
            value: `${hours} horas`,
            rawText: `[Health Connect] Sono: ${hours} horas`,
            timestamp: start,
            source: 'health_connect',
            sourceRef: `health_connect:sleep:${r.metadata?.id ?? r.startTime}`,
          });
        }
      }
    } catch { /* permissão não concedida */ }

    // Passos (agrupado por dia)
    try {
      const { records } = await readRecords('Steps', { timeRangeFilter });
      const byDay = new Map<string, number>();
      for (const r of records) {
        const day = r.startTime.slice(0, 10);
        byDay.set(day, (byDay.get(day) ?? 0) + r.count);
      }
      for (const [day, count] of byDay) {
        extracted.push({
          category: 'performance',
          label: 'Passos',
          value: `${count.toLocaleString('pt-BR')} passos`,
          rawText: `[Health Connect] Passos em ${day}: ${count}`,
          timestamp: new Date(`${day}T12:00:00Z`).getTime(),
          source: 'health_connect',
          sourceRef: `health_connect:steps:${day}`,
        });
      }
    } catch { /* permissão não concedida */ }

    // Treinos
    try {
      const { records } = await readRecords('ExerciseSession', { timeRangeFilter });
      for (const r of records) {
        const start = new Date(r.startTime).getTime();
        const end = new Date(r.endTime).getTime();
        const mins = Math.round((end - start) / 60_000);
        const name = exerciseName(r.exerciseType);
        if (mins > 0) {
          extracted.push({
            category: 'workout',
            label: name,
            value: `${mins} minutos`,
            rawText: `[Health Connect] ${name}: ${mins} minutos`,
            timestamp: start,
            source: 'health_connect',
            sourceRef: `health_connect:workout:${r.metadata?.id ?? r.startTime}`,
          });
        }
      }
    } catch { /* permissão não concedida */ }

    // Frequência cardíaca (média por dia)
    try {
      const { records } = await readRecords('HeartRate', { timeRangeFilter });
      const byDay = new Map<string, { sum: number; count: number }>();
      for (const r of records) {
        const day = r.startTime.slice(0, 10);
        const entry = byDay.get(day) ?? { sum: 0, count: 0 };
        for (const s of r.samples) {
          entry.sum += s.beatsPerMinute;
          entry.count += 1;
        }
        byDay.set(day, entry);
      }
      for (const [day, { sum, count }] of byDay) {
        if (count > 0) {
          extracted.push({
            category: 'health',
            label: 'Frequência cardíaca',
            value: `${Math.round(sum / count)} bpm`,
            rawText: `[Health Connect] FC média em ${day}: ${Math.round(sum / count)} bpm`,
            timestamp: new Date(`${day}T12:00:00Z`).getTime(),
            source: 'health_connect',
            sourceRef: `health_connect:hr:${day}`,
          });
        }
      }
    } catch { /* permissão não concedida */ }

    // Peso
    try {
      const { records } = await readRecords('Weight', { timeRangeFilter });
      for (const r of records) {
        const kg = Math.round(r.weight.inKilograms * 10) / 10;
        extracted.push({
          category: 'health',
          label: 'Peso',
          value: `${kg} kg`,
          rawText: `[Health Connect] Peso: ${kg} kg`,
          timestamp: new Date(r.time).getTime(),
          source: 'health_connect',
          sourceRef: `health_connect:weight:${r.metadata?.id ?? r.time}`,
        });
      }
    } catch { /* permissão não concedida */ }

    // Só avança o marcador depois que o servidor confirmou a gravação.
    await storage.addExtractedData(extracted);
    await saveLastSyncTime(syncedAt);

    return { synced: extracted.length };
  } catch (e: any) {
    return { synced: 0, error: e?.message ?? 'Erro ao conectar ao Health Connect.' };
  }
}
