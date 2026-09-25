import { useState, useCallback, useEffect, useRef } from 'react';
import { format } from 'date-fns';
import { WorkoutPlan, WorkoutCheckin } from '../types';
import { storage } from '../services/storage';
import { errorMessage, isStaleSession } from '../services/api';
import {
  isOfflineError, readCache, writeCache, enqueueCheckin, flushPendingCheckins, getPendingCheckins,
} from '../services/offline';

// Carregar falhou ≠ plano vazio: loadError guarda a mensagem para a tela
// mostrar "tentar de novo". Sem internet, mostra a última cópia salva no
// aparelho (offline=true) e check-ins entram numa fila (pendingIds) que é
// enviada no próximo carregamento. savePlan é otimista, mas desfaz e lança
// o erro se o servidor não confirmar.
export function useWorkoutPlan() {
  const [plans, setPlans] = useState<WorkoutPlan[]>([]);
  const [todayCheckins, setTodayCheckins] = useState<WorkoutCheckin[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  const initialized = useRef(false);
  const plansRef = useRef<WorkoutPlan[]>([]);
  plansRef.current = plans;
  const checkinsRef = useRef<WorkoutCheckin[]>([]);
  checkinsRef.current = todayCheckins;

  const today = format(new Date(), 'yyyy-MM-dd');

  const refreshPending = useCallback(async () => {
    const queue = await getPendingCheckins();
    setPendingIds(queue.filter((q) => q.kind === 'workout' && q.date === today).map((q) => q.id));
    return queue;
  }, [today]);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      await flushPendingCheckins((q) => (q.kind === 'meal'
        ? storage.checkInMeal(q.id, q.date, q.status)
        : storage.checkInWorkout(q.id, q.date, q.status)));
      const [saved, checkins] = await Promise.all([
        storage.getWorkoutPlans(),
        storage.getWorkoutCheckins(today),
      ]);
      setPlans(saved);
      setTodayCheckins(checkins);
      setOffline(false);
      writeCache('workout_plan', saved);
      writeCache(`workout_checkins_${today}`, checkins);
    } catch (e) {
      if (isStaleSession(e)) return;
      const cached = isOfflineError(e) ? await readCache<WorkoutPlan[]>('workout_plan') : null;
      if (cached) {
        setPlans(cached);
        const cachedCheckins = (await readCache<WorkoutCheckin[]>(`workout_checkins_${today}`)) ?? [];
        const queue = (await getPendingCheckins()).filter((q) => q.kind === 'workout' && q.date === today);
        const pendingSet = new Set(queue.map((q) => q.id));
        setTodayCheckins([
          ...cachedCheckins.filter((c) => !pendingSet.has(c.workoutPlanId)),
          ...queue.map((q) => ({ workoutPlanId: q.id, date: q.date, status: q.status, checkedAt: q.checkedAt })),
        ]);
        setOffline(true);
      } else {
        setLoadError(errorMessage(e));
      }
    } finally {
      await refreshPending();
      setIsLoading(false);
    }
  }, [today, refreshPending]);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    load();
  }, [load]);

  const savePlans = useCallback(async (newPlans: WorkoutPlan[]) => {
    const previous = plansRef.current;
    setPlans(newPlans);
    try {
      await storage.saveWorkoutPlans(newPlans);
      writeCache('workout_plan', newPlans);
    } catch (e) {
      setPlans(previous);
      throw e;
    }
  }, []);

  const checkIn = useCallback(async (workoutPlanId: string, status: 'done' | 'skipped') => {
    const previous = checkinsRef.current;
    const checkedAt = Date.now();
    const next = [...previous.filter((c) => c.workoutPlanId !== workoutPlanId), { workoutPlanId, date: today, status, checkedAt }];
    setTodayCheckins(next);
    try {
      await storage.checkInWorkout(workoutPlanId, today, status);
      writeCache(`workout_checkins_${today}`, next);
    } catch (e) {
      if (isOfflineError(e)) {
        // Sem internet: guarda para enviar depois, sem desfazer na tela.
        await enqueueCheckin({ kind: 'workout', id: workoutPlanId, date: today, status, checkedAt });
        await refreshPending();
        return;
      }
      setTodayCheckins(previous);
      throw e;
    }
  }, [today, refreshPending]);

  return { plans, todayCheckins, isLoading, loadError, offline, pendingIds, savePlans, checkIn, refresh: load, today };
}
