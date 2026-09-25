import { useState, useCallback, useEffect, useRef } from 'react';
import { format } from 'date-fns';
import { Meal, MealCheckin } from '../types';
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
export function useMealPlan() {
  const [meals, setMeals] = useState<Meal[]>([]);
  const [todayCheckins, setTodayCheckins] = useState<MealCheckin[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  const initialized = useRef(false);
  const mealsRef = useRef<Meal[]>([]);
  mealsRef.current = meals;
  const checkinsRef = useRef<MealCheckin[]>([]);
  checkinsRef.current = todayCheckins;

  const today = format(new Date(), 'yyyy-MM-dd');

  const refreshPending = useCallback(async () => {
    const queue = await getPendingCheckins();
    setPendingIds(queue.filter((q) => q.kind === 'meal' && q.date === today).map((q) => q.id));
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
        storage.getMealPlan(),
        storage.getCheckins(today),
      ]);
      setMeals(saved);
      setTodayCheckins(checkins);
      setOffline(false);
      writeCache('meal_plan', saved);
      writeCache(`meal_checkins_${today}`, checkins);
    } catch (e) {
      if (isStaleSession(e)) return;
      const cached = isOfflineError(e) ? await readCache<Meal[]>('meal_plan') : null;
      if (cached) {
        setMeals(cached);
        const cachedCheckins = (await readCache<MealCheckin[]>(`meal_checkins_${today}`)) ?? [];
        const queue = (await getPendingCheckins()).filter((q) => q.kind === 'meal' && q.date === today);
        const pendingSet = new Set(queue.map((q) => q.id));
        setTodayCheckins([
          ...cachedCheckins.filter((c) => !pendingSet.has(c.mealId)),
          ...queue.map((q) => ({ mealId: q.id, date: q.date, status: q.status, checkedAt: q.checkedAt })),
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

  const savePlan = useCallback(async (newMeals: Meal[]) => {
    const previous = mealsRef.current;
    setMeals(newMeals);
    try {
      await storage.saveMealPlan(newMeals);
      writeCache('meal_plan', newMeals);
    } catch (e) {
      setMeals(previous);
      throw e;
    }
  }, []);

  const checkIn = useCallback(async (mealId: string, status: 'done' | 'skipped') => {
    const previous = checkinsRef.current;
    const checkedAt = Date.now();
    const next = [...previous.filter((c) => c.mealId !== mealId), { mealId, date: today, status, checkedAt }];
    setTodayCheckins(next);
    try {
      await storage.checkInMeal(mealId, today, status);
      writeCache(`meal_checkins_${today}`, next);
    } catch (e) {
      if (isOfflineError(e)) {
        // Sem internet: guarda para enviar depois, sem desfazer na tela.
        await enqueueCheckin({ kind: 'meal', id: mealId, date: today, status, checkedAt });
        await refreshPending();
        return;
      }
      setTodayCheckins(previous);
      throw e;
    }
  }, [today, refreshPending]);

  return { meals, todayCheckins, isLoading, loadError, offline, pendingIds, savePlan, checkIn, refresh: load, today };
}
