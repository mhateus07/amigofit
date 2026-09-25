import { useState, useCallback, useEffect, useRef } from 'react';
import { format } from 'date-fns';
import { Meal, MealCheckin } from '../types';
import { storage } from '../services/storage';
import { errorMessage, isStaleSession } from '../services/api';

// Carregar falhou ≠ plano vazio: loadError guarda a mensagem para a tela
// mostrar "tentar de novo". savePlan/checkIn são otimistas, mas desfazem a
// mudança e lançam o erro se o servidor não confirmar.
export function useMealPlan() {
  const [meals, setMeals] = useState<Meal[]>([]);
  const [todayCheckins, setTodayCheckins] = useState<MealCheckin[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const initialized = useRef(false);
  const mealsRef = useRef<Meal[]>([]);
  mealsRef.current = meals;
  const checkinsRef = useRef<MealCheckin[]>([]);
  checkinsRef.current = todayCheckins;

  const today = format(new Date(), 'yyyy-MM-dd');

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [saved, checkins] = await Promise.all([
        storage.getMealPlan(),
        storage.getCheckins(today),
      ]);
      setMeals(saved);
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

  const savePlan = useCallback(async (newMeals: Meal[]) => {
    const previous = mealsRef.current;
    setMeals(newMeals);
    try {
      await storage.saveMealPlan(newMeals);
    } catch (e) {
      setMeals(previous);
      throw e;
    }
  }, []);

  const checkIn = useCallback(async (mealId: string, status: 'done' | 'skipped') => {
    const previous = checkinsRef.current;
    const checkedAt = Date.now();
    setTodayCheckins((prev) => {
      const others = prev.filter((c) => c.mealId !== mealId);
      return [...others, { mealId, date: today, status, checkedAt }];
    });
    try {
      await storage.checkInMeal(mealId, today, status);
    } catch (e) {
      setTodayCheckins(previous);
      throw e;
    }
  }, [today]);

  return { meals, todayCheckins, isLoading, loadError, savePlan, checkIn, refresh: load, today };
}
