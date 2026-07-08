import { useState, useCallback, useEffect, useRef } from 'react';
import { format } from 'date-fns';
import { Meal, MealCheckin } from '../types';
import { storage } from '../services/storage';

export function useMealPlan() {
  const [meals, setMeals] = useState<Meal[]>([]);
  const [todayCheckins, setTodayCheckins] = useState<MealCheckin[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const initialized = useRef(false);

  const today = format(new Date(), 'yyyy-MM-dd');

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [plan, checkins] = await Promise.all([
        storage.getMealPlan(),
        storage.getCheckins(today),
      ]);
      setMeals(plan);
      setTodayCheckins(checkins);
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
    setMeals(newMeals);
    await storage.saveMealPlan(newMeals);
  }, []);

  const checkIn = useCallback(async (mealId: string, status: 'done' | 'skipped') => {
    const checkedAt = Date.now();
    setTodayCheckins((prev) => {
      const others = prev.filter((c) => c.mealId !== mealId);
      return [...others, { mealId, date: today, status, checkedAt }];
    });
    await storage.checkInMeal(mealId, today, status);
  }, [today]);

  return { meals, todayCheckins, isLoading, savePlan, checkIn, refresh: load, today };
}
