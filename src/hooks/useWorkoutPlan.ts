import { useState, useCallback, useEffect, useRef } from 'react';
import { format } from 'date-fns';
import { WorkoutPlan, WorkoutCheckin } from '../types';
import { storage } from '../services/storage';

export function useWorkoutPlan() {
  const [plans, setPlans] = useState<WorkoutPlan[]>([]);
  const [todayCheckins, setTodayCheckins] = useState<WorkoutCheckin[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const initialized = useRef(false);

  const today = format(new Date(), 'yyyy-MM-dd');

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [savedPlans, checkins] = await Promise.all([
        storage.getWorkoutPlans(),
        storage.getWorkoutCheckins(today),
      ]);
      setPlans(savedPlans);
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

  const savePlans = useCallback(async (newPlans: WorkoutPlan[]) => {
    setPlans(newPlans);
    await storage.saveWorkoutPlans(newPlans);
  }, []);

  const checkIn = useCallback(async (workoutPlanId: string, status: 'done' | 'skipped') => {
    const checkedAt = Date.now();
    setTodayCheckins((prev) => {
      const others = prev.filter((c) => c.workoutPlanId !== workoutPlanId);
      return [...others, { workoutPlanId, date: today, status, checkedAt }];
    });
    await storage.checkInWorkout(workoutPlanId, today, status);
  }, [today]);

  return { plans, todayCheckins, isLoading, savePlans, checkIn, refresh: load, today };
}
