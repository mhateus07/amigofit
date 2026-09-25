import { useState, useCallback, useEffect, useRef } from 'react';
import { format } from 'date-fns';
import { WorkoutPlan, WorkoutCheckin } from '../types';
import { storage } from '../services/storage';
import { errorMessage, isStaleSession } from '../services/api';

// Carregar falhou ≠ plano vazio: loadError guarda a mensagem para a tela
// mostrar "tentar de novo". savePlan/checkIn são otimistas, mas desfazem a
// mudança e lançam o erro se o servidor não confirmar.
export function useWorkoutPlan() {
  const [plans, setPlans] = useState<WorkoutPlan[]>([]);
  const [todayCheckins, setTodayCheckins] = useState<WorkoutCheckin[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const initialized = useRef(false);
  const plansRef = useRef<WorkoutPlan[]>([]);
  plansRef.current = plans;
  const checkinsRef = useRef<WorkoutCheckin[]>([]);
  checkinsRef.current = todayCheckins;

  const today = format(new Date(), 'yyyy-MM-dd');

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [saved, checkins] = await Promise.all([
        storage.getWorkoutPlans(),
        storage.getWorkoutCheckins(today),
      ]);
      setPlans(saved);
      setTodayCheckins(checkins);
    } catch (e) {
      if (!isStaleSession(e)) setLoadError(errorMessage(e));
    } finally {
      setIsLoading(false);
    }
  }, [today]);

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
    } catch (e) {
      setPlans(previous);
      throw e;
    }
  }, []);

  const checkIn = useCallback(async (workoutPlanId: string, status: 'done' | 'skipped') => {
    const previous = checkinsRef.current;
    const checkedAt = Date.now();
    setTodayCheckins((prev) => {
      const others = prev.filter((c) => c.workoutPlanId !== workoutPlanId);
      return [...others, { workoutPlanId, date: today, status, checkedAt }];
    });
    try {
      await storage.checkInWorkout(workoutPlanId, today, status);
    } catch (e) {
      setTodayCheckins(previous);
      throw e;
    }
  }, [today]);

  return { plans, todayCheckins, isLoading, loadError, savePlans, checkIn, refresh: load, today };
}
