import React, { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl, Alert, Platform, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { format, subDays, isAfter, startOfDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Meal, UserProfile, WorkoutPlan } from '../types';
import { useMealPlan } from '../hooks/useMealPlan';
import { useWorkoutPlan } from '../hooks/useWorkoutPlan';
import { storage } from '../services/storage';
import { errorMessage } from '../services/api';
import { syncAppleHealth } from '../services/appleHealth';
import WorkoutSessionModal from '../components/WorkoutSessionModal';
import { pickTodayPlan } from '../utils/workout';
import { colors, spacing, radius, fontSize, fontFamily, shadow } from '../constants/theme';

// Resumo do dia num lugar só: próximo treino, refeições pendentes e ações
// rápidas — antes a rotina ficava espalhada entre seis abas.

export default function HojeScreen({ profile, onOpenProfile }: { profile: UserProfile; onOpenProfile: () => void }) {
  const navigation = useNavigation<{ navigate: (tab: string) => void }>();
  const meal = useMealPlan();
  const workout = useWorkoutPlan();
  const [refreshing, setRefreshing] = useState(false);
  const [sessionPlan, setSessionPlan] = useState<WorkoutPlan | null>(null);
  const [workoutsLast7, setWorkoutsLast7] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);

  const loadProgress = useCallback(async () => {
    try {
      const data = await storage.getExtractedData();
      const days = new Set(
        data
          .filter((d) => d.category === 'workout' && isAfter(d.timestamp, subDays(Date.now(), 7)))
          .map((d) => startOfDay(d.timestamp).getTime())
      );
      setWorkoutsLast7(days.size);
    } catch {
      setWorkoutsLast7(null);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([meal.refresh(), workout.refresh(), loadProgress()]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meal.refresh, workout.refresh, loadProgress]);

  // Recarrega ao voltar para a aba (check-ins feitos nas abas Dieta/Treino).
  useFocusEffect(useCallback(() => { refreshAll(); }, [refreshAll]));

  const onRefresh = async () => { setRefreshing(true); await refreshAll(); setRefreshing(false); };

  const mealDone = new Set(meal.todayCheckins.map((c) => c.mealId));
  const pendingMeals = [...meal.meals].sort((a, b) => a.time.localeCompare(b.time)).filter((m) => !mealDone.has(m.id));
  const workoutDone = new Set(workout.todayCheckins.filter((c) => c.status === 'done').map((c) => c.workoutPlanId));
  const todayPlan = pickTodayPlan(workout.plans, workoutDone);
  const todayPlanCheckin = todayPlan ? workout.todayCheckins.find((c) => c.workoutPlanId === todayPlan.id) : undefined;
  const goal = profile.weeklyWorkoutGoal ?? 3;
  const now = format(new Date(), 'HH:mm');

  const checkInMeal = async (m: Meal, status: 'done' | 'skipped') => {
    try {
      await meal.checkIn(m.id, status);
    } catch (e) {
      Alert.alert('Check-in não registrado', errorMessage(e));
    }
  };

  const checkInWorkout = async (plan: WorkoutPlan) => {
    try {
      await workout.checkIn(plan.id, 'done');
      loadProgress();
    } catch (e) {
      Alert.alert('Check-in não registrado', errorMessage(e));
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    const result = await syncAppleHealth();
    setSyncing(false);
    if (result.error) Alert.alert('Apple Saúde', result.error);
    else {
      Alert.alert('Sincronizado!', result.synced > 0 ? `${result.synced} registro(s) atualizados.` : 'Nada novo desde a última sincronização.');
      loadProgress();
    }
  };

  const firstName = profile.name.split(' ')[0];
  const offline = meal.offline || workout.offline;
  const loadError = meal.loadError || workout.loadError;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.date}>{format(new Date(), "EEEE, d 'de' MMMM", { locale: ptBR })}</Text>
          <Text style={styles.title}>Olá, {firstName}</Text>
        </View>
        <TouchableOpacity onPress={onOpenProfile} style={styles.gear} accessibilityRole="button" accessibilityLabel="Abrir perfil e configurações">
          <Text style={styles.gearIcon}>⚙️</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {offline && (
          <View style={styles.banner}><Text style={styles.bannerText}>Sem conexão — mostrando a última versão salva no aparelho.</Text></View>
        )}
        {!offline && loadError && (
          <TouchableOpacity style={styles.banner} onPress={refreshAll} accessibilityRole="button">
            <Text style={styles.bannerText}>Não foi possível atualizar: {loadError}. Tocar para tentar de novo.</Text>
          </TouchableOpacity>
        )}

        {/* Progresso da semana */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Semana</Text>
          {workoutsLast7 === null ? (
            <Text style={styles.cardBody}>—</Text>
          ) : (
            <>
              <Text style={styles.bigNumber}>{workoutsLast7}<Text style={styles.bigNumberUnit}> / {goal} treinos</Text></Text>
              <View style={styles.progressTrack} accessibilityLabel={`${workoutsLast7} de ${goal} treinos nos últimos 7 dias`}>
                <View style={[styles.progressFill, { width: `${Math.min(1, workoutsLast7 / goal) * 100}%` }]} />
              </View>
            </>
          )}
        </View>

        {/* Treino do dia */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Treino de hoje</Text>
          {workout.isLoading && workout.plans.length === 0 ? (
            <ActivityIndicator color={colors.primary} />
          ) : !todayPlan ? (
            <TouchableOpacity onPress={() => navigation.navigate('Treino')} accessibilityRole="button">
              <Text style={styles.cardBody}>Nenhuma ficha cadastrada. Toque para montar a sua.</Text>
            </TouchableOpacity>
          ) : (
            <>
              <Text style={styles.cardTitle}>{todayPlan.name}</Text>
              <Text style={styles.cardBody} numberOfLines={2}>{todayPlan.exercises.map((e) => e.name).join(' · ')}</Text>
              {todayPlanCheckin?.status === 'done' ? (
                <Text style={styles.doneText}>✅ Concluído hoje</Text>
              ) : (
                <View style={styles.row}>
                  <TouchableOpacity style={styles.primaryBtn} onPress={() => setSessionPlan(todayPlan)} accessibilityRole="button">
                    <Text style={styles.primaryBtnText}>Começar treino</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.secondaryBtn} onPress={() => checkInWorkout(todayPlan)} accessibilityRole="button">
                    <Text style={styles.secondaryBtnText}>Já fiz ✅</Text>
                  </TouchableOpacity>
                </View>
              )}
            </>
          )}
        </View>

        {/* Refeições pendentes */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Refeições de hoje</Text>
          {meal.meals.length === 0 ? (
            <TouchableOpacity onPress={() => navigation.navigate('Dieta')} accessibilityRole="button">
              <Text style={styles.cardBody}>Nenhum plano alimentar. Toque para cadastrar.</Text>
            </TouchableOpacity>
          ) : pendingMeals.length === 0 ? (
            <Text style={styles.doneText}>✅ Todas registradas</Text>
          ) : (
            pendingMeals.slice(0, 4).map((m) => (
              <View key={m.id} style={styles.mealRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.mealTime, m.time <= now && styles.mealLate]}>{m.time}</Text>
                  <Text style={styles.mealName}>{m.name}</Text>
                  {meal.pendingIds.includes(m.id) && <Text style={styles.pendingText}>pendente de sincronização</Text>}
                </View>
                <TouchableOpacity style={styles.smallBtn} onPress={() => checkInMeal(m, 'done')} accessibilityRole="button" accessibilityLabel={`Comi ${m.name}`}>
                  <Text style={styles.smallBtnText}>Comi</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.smallGhost} onPress={() => checkInMeal(m, 'skipped')} accessibilityRole="button" accessibilityLabel={`Pulei ${m.name}`}>
                  <Text style={styles.smallGhostText}>Pulei</Text>
                </TouchableOpacity>
              </View>
            ))
          )}
        </View>

        {/* Ações rápidas */}
        <Text style={styles.sectionTitle}>Registrar</Text>
        <View style={styles.quickGrid}>
          <TouchableOpacity style={styles.quick} onPress={() => navigation.navigate('Chat')} accessibilityRole="button">
            <Text style={styles.quickIcon}>💬</Text>
            <Text style={styles.quickText}>Contar no chat</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quick} onPress={() => navigation.navigate('Diário')} accessibilityRole="button">
            <Text style={styles.quickIcon}>📝</Text>
            <Text style={styles.quickText}>Anotar no Diário</Text>
          </TouchableOpacity>
          {Platform.OS === 'ios' && (
            <TouchableOpacity style={styles.quick} onPress={handleSync} disabled={syncing} accessibilityRole="button">
              {syncing ? <ActivityIndicator color={colors.primary} /> : <Text style={styles.quickIcon}>❤️</Text>}
              <Text style={styles.quickText}>Sincronizar Apple Saúde</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.quick} onPress={() => navigation.navigate('Insights')} accessibilityRole="button">
            <Text style={styles.quickIcon}>📈</Text>
            <Text style={styles.quickText}>Ver evolução</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <WorkoutSessionModal
        visible={!!sessionPlan}
        plan={sessionPlan}
        date={workout.today}
        onClose={() => setSessionPlan(null)}
        onFinished={() => {
          const plan = sessionPlan;
          setSessionPlan(null);
          if (plan) {
            Alert.alert('Treino salvo', 'Marcar como concluído hoje?', [
              { text: 'Agora não', style: 'cancel' },
              { text: 'Concluir ✅', onPress: () => checkInWorkout(plan) },
            ]);
          }
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.sm },
  date: { color: colors.textSecondary, fontSize: fontSize.sm, fontFamily: fontFamily.medium, textTransform: 'capitalize' },
  title: { color: colors.text, fontSize: fontSize.xxl, fontFamily: fontFamily.bold },
  gear: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  gearIcon: { fontSize: 22 },
  content: { padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.md },
  banner: { padding: spacing.sm, borderRadius: radius.md, backgroundColor: '#FFF4E5' },
  bannerText: { color: '#8A5300', fontSize: fontSize.sm },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, gap: spacing.xs, ...shadow.card },
  cardLabel: { color: colors.textSecondary, fontSize: fontSize.xs, fontFamily: fontFamily.semiBold, textTransform: 'uppercase', letterSpacing: 0.5 },
  cardTitle: { color: colors.text, fontSize: fontSize.lg, fontFamily: fontFamily.semiBold },
  cardBody: { color: colors.textSecondary, fontSize: fontSize.sm, fontFamily: fontFamily.regular },
  bigNumber: { color: colors.text, fontSize: 32, fontFamily: fontFamily.bold },
  bigNumberUnit: { color: colors.textSecondary, fontSize: fontSize.md, fontFamily: fontFamily.medium },
  progressTrack: { height: 8, borderRadius: 4, backgroundColor: colors.border, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: colors.primary },
  doneText: { color: colors.success, fontSize: fontSize.sm, fontFamily: fontFamily.semiBold, marginTop: spacing.xs },
  row: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  primaryBtn: { flex: 1, minHeight: 44, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: '#fff', fontFamily: fontFamily.semiBold, fontSize: fontSize.md },
  secondaryBtn: { minHeight: 44, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  secondaryBtnText: { color: colors.text, fontFamily: fontFamily.medium },
  mealRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border },
  mealTime: { color: colors.textSecondary, fontSize: fontSize.xs, fontFamily: fontFamily.semiBold },
  mealLate: { color: colors.warning },
  mealName: { color: colors.text, fontSize: fontSize.md, fontFamily: fontFamily.medium },
  pendingText: { color: '#8A5300', fontSize: fontSize.xs },
  smallBtn: { minHeight: 44, minWidth: 64, paddingHorizontal: spacing.sm, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  smallBtnText: { color: '#fff', fontFamily: fontFamily.semiBold },
  smallGhost: { minHeight: 44, minWidth: 56, paddingHorizontal: spacing.sm, alignItems: 'center', justifyContent: 'center' },
  smallGhostText: { color: colors.textSecondary, fontFamily: fontFamily.medium },
  sectionTitle: { color: colors.text, fontSize: fontSize.md, fontFamily: fontFamily.semiBold, marginTop: spacing.xs },
  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  quick: { width: '48%', flexGrow: 1, minHeight: 88, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, justifyContent: 'center', gap: 4, ...shadow.card },
  quickIcon: { fontSize: 22 },
  quickText: { color: colors.text, fontSize: fontSize.sm, fontFamily: fontFamily.medium },
});
