import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, Modal, ScrollView, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert,
  KeyboardAvoidingView, Platform, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { format, parseISO } from 'date-fns';
import { Exercise, ExerciseSessionHistory, LoggedSet, WorkoutPlan } from '../types';
import { storage, exerciseImageUrl, getToken } from '../services/storage';
import { techniquesOf, formatRest } from '../utils/workout';
import { errorMessage } from '../services/api';
import { colors, spacing, radius, fontSize, fontFamily } from '../constants/theme';

// Sessão de treino: registra o que foi feito de verdade (carga e repetições
// por série), com cronômetro de descanso e a evolução de cada exercício.

interface SetRow { reps: string; load: string; done: boolean }

const exerciseKey = (e: Exercise) => e.id || e.name;

function firstNumber(text?: string): string {
  const m = text?.match(/\d+([.,]\d+)?/);
  return m ? m[0].replace(',', '.') : '';
}

function parseNum(text: string): number | null {
  const n = parseFloat(text.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function formatLoad(kg: number | null): string {
  return kg === null ? 'sem carga' : `${kg.toLocaleString('pt-BR')} kg`;
}

function formatClock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function HistoryLine({ history }: { history: ExerciseSessionHistory[] }) {
  if (history.length === 0) return <Text style={styles.historyText}>Primeira vez registrando este exercício.</Text>;
  const [last, previous] = history;
  const trend = previous && last.maxLoadKg !== null && previous.maxLoadKg !== null
    ? last.maxLoadKg > previous.maxLoadKg ? ' ↑' : last.maxLoadKg < previous.maxLoadKg ? ' ↓' : ' ='
    : '';
  return (
    <Text style={styles.historyText}>
      Última vez ({format(parseISO(last.date), 'dd/MM')}): {formatLoad(last.maxLoadKg)}
      {last.repsAtMax !== null ? ` × ${last.repsAtMax}` : ''}{trend}
    </Text>
  );
}

function EvolutionList({ history }: { history: ExerciseSessionHistory[] }) {
  const maxLoad = Math.max(1, ...history.map((h) => h.maxLoadKg ?? 0));
  return (
    <View style={styles.evolution} accessibilityLabel="Evolução de carga">
      {[...history].reverse().map((h) => (
        <View key={h.date} style={styles.evolutionRow}>
          <Text style={styles.evolutionDate}>{format(parseISO(h.date), 'dd/MM')}</Text>
          <View style={styles.evolutionTrack}>
            <View style={[styles.evolutionBar, { width: `${((h.maxLoadKg ?? 0) / maxLoad) * 100}%` }]} />
          </View>
          <Text style={styles.evolutionValue}>{formatLoad(h.maxLoadKg)} · {h.totalReps} reps</Text>
        </View>
      ))}
    </View>
  );
}

export default function WorkoutSessionModal({
  visible, plan, date, onClose, onFinished,
}: {
  visible: boolean;
  plan: WorkoutPlan | null;
  date: string;
  onClose: () => void;
  onFinished: () => void;
}) {
  const [rows, setRows] = useState<Record<string, SetRow[]>>({});
  const [history, setHistory] = useState<Record<string, ExerciseSessionHistory[]>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rest, setRest] = useState<number | null>(null);
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => { getToken().then(setToken); }, []);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopRest = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setRest(null);
  };

  const startRest = (seconds: number) => {
    stopRest();
    setRest(seconds);
    timer.current = setInterval(() => {
      setRest((s) => {
        if (s === null || s <= 1) {
          if (timer.current) clearInterval(timer.current);
          timer.current = null;
          return null;
        }
        return s - 1;
      });
    }, 1000);
  };

  useEffect(() => () => stopRest(), []);

  useEffect(() => {
    if (!visible || !plan) return;
    let cancelled = false;
    setLoading(true);
    setExpanded(null);
    stopRest();
    (async () => {
      try {
        const [logged, ...histories] = await Promise.all([
          storage.getWorkoutLogs(date, plan.id),
          ...plan.exercises.map((e) => storage.getExerciseHistory(e.name, 8)),
        ]);
        if (cancelled) return;
        const nextHistory: Record<string, ExerciseSessionHistory[]> = {};
        const nextRows: Record<string, SetRow[]> = {};
        plan.exercises.forEach((e, i) => {
          const key = exerciseKey(e);
          // O histórico inclui hoje se já houver algo salvo; a referência é a sessão anterior.
          nextHistory[key] = histories[i].filter((h) => h.date !== date);
          const today = logged.filter((s) => s.exerciseId === key);
          if (today.length > 0) {
            nextRows[key] = today.map((s) => ({
              reps: s.reps === null ? '' : String(s.reps),
              load: s.loadKg === null ? '' : String(s.loadKg),
              done: true,
            }));
          } else {
            const lastLoad = nextHistory[key][0]?.maxLoadKg;
            const load = lastLoad !== null && lastLoad !== undefined ? String(lastLoad) : firstNumber(e.load);
            nextRows[key] = Array.from({ length: Math.max(1, e.sets ?? 3) }, () => ({ reps: firstNumber(e.reps), load, done: false }));
          }
        });
        setHistory(nextHistory);
        setRows(nextRows);
      } catch (e) {
        if (!cancelled) {
          Alert.alert('Não foi possível abrir o treino', errorMessage(e));
          onClose();
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, plan?.id, date]);

  const updateRow = (key: string, index: number, patch: Partial<SetRow>) => {
    setRows((prev) => ({ ...prev, [key]: prev[key].map((r, i) => (i === index ? { ...r, ...patch } : r)) }));
  };

  const toggleDone = (exercise: Exercise, index: number) => {
    const key = exerciseKey(exercise);
    const row = rows[key][index];
    updateRow(key, index, { done: !row.done });
    if (!row.done) startRest(exercise.restSeconds ?? 90);
  };

  const addSet = (key: string) => {
    setRows((prev) => {
      const last = prev[key][prev[key].length - 1];
      return { ...prev, [key]: [...prev[key], { reps: last?.reps ?? '', load: last?.load ?? '', done: false }] };
    });
  };

  const save = async () => {
    if (!plan) return;
    const toSave = plan.exercises
      .map((e) => ({ e, sets: (rows[exerciseKey(e)] ?? []).filter((r) => r.done) }))
      .filter(({ sets }) => sets.length > 0);
    if (toSave.length === 0) {
      Alert.alert('Nenhuma série marcada', 'Marque ✓ nas séries que você fez para registrá-las.');
      return;
    }
    setSaving(true);
    try {
      for (const { e, sets } of toSave) {
        const logged: LoggedSet[] = sets.map((r) => {
          const reps = parseNum(r.reps);
          return { reps: reps === null ? null : Math.round(reps), loadKg: parseNum(r.load) };
        });
        await storage.saveExerciseSets(plan.id, exerciseKey(e), e.name, date, logged);
      }
      stopRest();
      onFinished();
    } catch (err) {
      Alert.alert('Não foi possível salvar o treino', errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} accessibilityRole="button" style={styles.headerBtn}>
            <Text style={styles.headerBtnText}>Fechar</Text>
          </TouchableOpacity>
          <Text style={styles.title} numberOfLines={1}>{plan?.name}</Text>
          <TouchableOpacity onPress={save} disabled={saving || loading} accessibilityRole="button" style={styles.headerBtn}>
            {saving ? <ActivityIndicator color={colors.primary} /> : <Text style={[styles.headerBtnText, styles.headerSave]}>Salvar</Text>}
          </TouchableOpacity>
        </View>

        {rest !== null && (
          <View style={styles.restBanner} accessibilityRole="timer" accessibilityLiveRegion="polite">
            <Text style={styles.restText}>Descanso: {formatClock(rest)}</Text>
            <TouchableOpacity onPress={stopRest} accessibilityRole="button" style={styles.restSkip}>
              <Text style={styles.restSkipText}>Pular</Text>
            </TouchableOpacity>
          </View>
        )}

        {loading ? (
          <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.primary} />
        ) : (
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
              {plan?.exercises.map((e) => {
                const key = exerciseKey(e);
                const exerciseHistory = history[key] ?? [];
                return (
                  <View key={key} style={styles.exercise}>
                    <TouchableOpacity
                      onPress={() => setExpanded(expanded === key ? null : key)}
                      accessibilityRole="button"
                      accessibilityHint="Mostra a evolução de carga deste exercício"
                      style={styles.exerciseHeader}
                    >
                      {!!e.imageId && token && (
                        <Image
                          source={{ uri: exerciseImageUrl(e.imageId), headers: { Authorization: `Bearer ${token}` } }}
                          style={styles.thumb}
                          resizeMode="cover"
                        />
                      )}
                      <View style={{ flex: 1 }}>
                      <Text style={styles.exerciseName}>{e.name}</Text>
                      <Text style={styles.planned}>
                        Planejado: {[e.sets ? `${e.sets} × ${e.reps ?? '—'}` : e.reps, e.load, formatRest(e.restSeconds) && `descanso ${formatRest(e.restSeconds)}`].filter(Boolean).join(' · ')}
                      </Text>
                      {techniquesOf(e).length > 0 && (
                        <Text style={styles.techniques}>{techniquesOf(e).map((t) => t.label).join(' · ')}{e.notes ? ` — ${e.notes}` : ''}</Text>
                      )}
                      {!techniquesOf(e).length && !!e.notes && <Text style={styles.techniques}>{e.notes}</Text>}
                      <HistoryLine history={exerciseHistory} />
                      {exerciseHistory.length > 1 && (
                        <Text style={styles.evolutionToggle}>{expanded === key ? 'Ocultar evolução' : 'Ver evolução 📈'}</Text>
                      )}
                      </View>
                    </TouchableOpacity>
                    {expanded === key && <EvolutionList history={exerciseHistory} />}

                    <View style={styles.setHeader}>
                      <Text style={[styles.setHeaderText, { width: 44 }]}>Série</Text>
                      <Text style={[styles.setHeaderText, styles.flex]}>Carga (kg)</Text>
                      <Text style={[styles.setHeaderText, styles.flex]}>Reps</Text>
                      <View style={{ width: 48 }} />
                    </View>
                    {(rows[key] ?? []).map((r, i) => (
                      <View key={i} style={[styles.setRow, r.done && styles.setRowDone]}>
                        <Text style={styles.setIndex}>{i + 1}</Text>
                        <TextInput
                          style={[styles.input, styles.flex]}
                          value={r.load}
                          onChangeText={(v) => updateRow(key, i, { load: v })}
                          keyboardType="decimal-pad"
                          placeholder="—"
                          placeholderTextColor={colors.textMuted}
                          accessibilityLabel={`Carga da série ${i + 1} de ${e.name}`}
                        />
                        <TextInput
                          style={[styles.input, styles.flex]}
                          value={r.reps}
                          onChangeText={(v) => updateRow(key, i, { reps: v })}
                          keyboardType="number-pad"
                          placeholder="—"
                          placeholderTextColor={colors.textMuted}
                          accessibilityLabel={`Repetições da série ${i + 1} de ${e.name}`}
                        />
                        <TouchableOpacity
                          style={[styles.doneBtn, r.done && styles.doneBtnActive]}
                          onPress={() => toggleDone(e, i)}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: r.done }}
                          accessibilityLabel={`Série ${i + 1} feita`}
                        >
                          <Text style={[styles.doneBtnText, r.done && { color: '#fff' }]}>✓</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                    <TouchableOpacity onPress={() => addSet(key)} accessibilityRole="button" style={styles.addSet}>
                      <Text style={styles.addSetText}>+ Série</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </ScrollView>
          </KeyboardAvoidingView>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface },
  headerBtn: { minWidth: 64, minHeight: 44, justifyContent: 'center' },
  headerBtnText: { color: colors.textSecondary, fontSize: fontSize.md, fontFamily: fontFamily.medium },
  headerSave: { color: colors.primary, textAlign: 'right', fontFamily: fontFamily.semiBold },
  title: { flex: 1, textAlign: 'center', color: colors.text, fontSize: fontSize.md, fontFamily: fontFamily.semiBold },
  restBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.primary, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  restText: { color: '#fff', fontSize: fontSize.lg, fontFamily: fontFamily.semiBold },
  restSkip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.sm },
  restSkipText: { color: '#fff', fontFamily: fontFamily.medium },
  list: { padding: spacing.md, paddingBottom: 80 },
  exercise: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md },
  exerciseHeader: { flexDirection: 'row', gap: spacing.sm },
  thumb: { width: 56, height: 100, borderRadius: radius.md, backgroundColor: colors.background },
  planned: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
  techniques: { color: '#7C3AED', fontSize: fontSize.xs, fontFamily: fontFamily.medium, marginTop: 2 },
  exerciseName: { color: colors.text, fontSize: fontSize.md, fontFamily: fontFamily.semiBold },
  historyText: { color: colors.textSecondary, fontSize: fontSize.sm, marginTop: 2 },
  evolutionToggle: { color: colors.primary, fontSize: fontSize.sm, marginTop: 4, fontFamily: fontFamily.medium },
  evolution: { marginTop: spacing.sm, gap: 4 },
  evolutionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  evolutionDate: { width: 44, color: colors.textMuted, fontSize: fontSize.xs },
  evolutionTrack: { flex: 1, height: 8, backgroundColor: colors.border, borderRadius: 4, overflow: 'hidden' },
  evolutionBar: { height: '100%', backgroundColor: colors.primary },
  evolutionValue: { width: 120, color: colors.textSecondary, fontSize: fontSize.xs, textAlign: 'right' },
  setHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md, marginBottom: 4 },
  setHeaderText: { color: colors.textMuted, fontSize: fontSize.xs, fontFamily: fontFamily.medium },
  flex: { flex: 1 },
  setRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs, borderRadius: radius.md, paddingVertical: 2 },
  setRowDone: { backgroundColor: colors.background },
  setIndex: { width: 44, textAlign: 'center', color: colors.textSecondary, fontFamily: fontFamily.semiBold },
  input: { minHeight: 44, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, color: colors.text, fontSize: fontSize.md, textAlign: 'center', backgroundColor: colors.surface },
  doneBtn: { width: 48, height: 44, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  doneBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  doneBtnText: { color: colors.textMuted, fontSize: fontSize.lg, fontFamily: fontFamily.semiBold },
  addSet: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
  addSetText: { color: colors.primary, fontFamily: fontFamily.medium },
});
