import React, { useState } from 'react';
import {
  View, Text, Image, TouchableOpacity, StyleSheet, ScrollView, Modal, Alert, Pressable,
} from 'react-native';
import { format, parseISO } from 'date-fns';
import { Exercise, ExerciseSessionHistory, WorkoutCheckin, WorkoutPlan } from '../types';
import { exerciseImageUrl } from '../services/storage';
import {
  techniquesOf, splitSections, estimateMinutes, totalSets, planBadge, formatRest, Technique,
} from '../utils/workout';
import { colors, spacing, radius, fontSize, fontFamily, shadow } from '../constants/theme';

// Visualização detalhada da ficha: seletor A/B/C, resumo do treino, seções
// (mobilidade × principal) e um cartão por exercício com foto, séries,
// carga, descanso, técnicas do personal e o que foi feito da última vez.

function authImage(id: string, token: string | null) {
  return { uri: exerciseImageUrl(id), headers: token ? { Authorization: `Bearer ${token}` } : undefined };
}

function Chip({ icon, text, tone = 'default' }: { icon: string; text: string; tone?: 'default' | 'accent' }) {
  return (
    <View style={[styles.chip, tone === 'accent' && styles.chipAccent]}>
      <Text style={styles.chipIcon}>{icon}</Text>
      <Text style={[styles.chipText, tone === 'accent' && styles.chipTextAccent]}>{text}</Text>
    </View>
  );
}

function TechniqueBadge({ technique }: { technique: Technique }) {
  return (
    <TouchableOpacity
      onPress={() => Alert.alert(technique.label, technique.description)}
      style={[styles.badge, { borderColor: technique.color, backgroundColor: `${technique.color}14` }]}
      accessibilityRole="button"
      accessibilityLabel={`Técnica ${technique.label}. Tocar para ver como fazer`}
      hitSlop={{ top: 8, bottom: 8 }}
    >
      <Text style={[styles.badgeText, { color: technique.color }]}>{technique.label} ⓘ</Text>
    </TouchableOpacity>
  );
}

function lastTimeText(h?: ExerciseSessionHistory): string | null {
  if (!h) return null;
  const load = h.maxLoadKg !== null ? `${h.maxLoadKg.toLocaleString('pt-BR')} kg` : 'sem carga';
  const reps = h.repsAtMax !== null ? ` × ${h.repsAtMax}` : '';
  return `Última vez (${format(parseISO(h.date), 'dd/MM')}): ${load}${reps}`;
}

function ExerciseCard({
  exercise, index, token, last, onPhoto, onVideo,
}: {
  exercise: Exercise;
  index: number;
  token: string | null;
  last?: ExerciseSessionHistory;
  onPhoto: (imageId: string) => void;
  onVideo: (videoId: string) => void;
}) {
  const techniques = techniquesOf(exercise);
  const rest = formatRest(exercise.restSeconds);
  const setsText = exercise.sets ? `${exercise.sets} × ${exercise.reps ?? '—'}` : exercise.reps;
  const lastText = lastTimeText(last);

  return (
    <View style={styles.card}>
      {exercise.imageId ? (
        <Pressable onPress={() => onPhoto(exercise.imageId!)} accessibilityRole="imagebutton" accessibilityLabel={`Foto de ${exercise.name}. Tocar para ampliar`}>
          <Image source={authImage(exercise.imageId, token)} style={styles.photo} resizeMode="cover" />
        </Pressable>
      ) : (
        <View style={[styles.photo, styles.photoEmpty]}>
          <Text style={styles.photoIndex}>{index}</Text>
        </View>
      )}
      <View style={styles.cardBody}>
        <Text style={styles.cardIndex}>{index}</Text>
        <Text style={styles.cardName}>{exercise.name}</Text>
        <View style={styles.chips}>
          {!!setsText && <Chip icon="🔁" text={setsText} tone="accent" />}
          {!!exercise.load && <Chip icon="🏋️" text={exercise.load} />}
          {!!rest && <Chip icon="⏱" text={rest} />}
        </View>
        {techniques.length > 0 && (
          <View style={styles.chips}>{techniques.map((t) => <TechniqueBadge key={t.key} technique={t} />)}</View>
        )}
        {!!exercise.notes && <Text style={styles.notes}>“{exercise.notes}”</Text>}
        {!!lastText && <Text style={styles.last}>{lastText}</Text>}
        {!!exercise.videoId && (
          <TouchableOpacity onPress={() => onVideo(exercise.videoId!)} style={styles.videoBtn} accessibilityRole="button">
            <Text style={styles.videoBtnText}>▶ Ver vídeo</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

export default function WorkoutPlanView({
  plans, selected, onSelect, checkin, pending, token, history,
  onStart, onCheckIn, onEdit, onDelete, onViewVideo,
}: {
  plans: WorkoutPlan[];
  selected: WorkoutPlan;
  onSelect: (id: string) => void;
  checkin: WorkoutCheckin | null;
  pending: boolean;
  token: string | null;
  history: Record<string, ExerciseSessionHistory | undefined>;
  onStart: () => void;
  onCheckIn: (status: 'done' | 'skipped') => void;
  onEdit: () => void;
  onDelete: () => void;
  onViewVideo: (videoId: string) => void;
}) {
  const [photo, setPhoto] = useState<string | null>(null);
  const { mobility, main } = splitSections(selected.exercises);
  const done = checkin?.status === 'done';

  const openMenu = () => {
    Alert.alert(selected.name, undefined, [
      { text: 'Editar ficha', onPress: onEdit },
      ...(checkin ? [] : [{ text: 'Pular hoje', onPress: () => onCheckIn('skipped') }]),
      { text: 'Excluir ficha', style: 'destructive' as const, onPress: onDelete },
      { text: 'Cancelar', style: 'cancel' as const },
    ]);
  };

  const renderList = (items: Exercise[], offset: number) => items.map((e, i) => (
    <ExerciseCard
      key={e.id ?? `${e.name}-${i}`}
      exercise={e}
      index={offset + i + 1}
      token={token}
      last={history[e.name.toLowerCase()]}
      onPhoto={setPhoto}
      onVideo={onViewVideo}
    />
  ));

  return (
    <>
      {/* Seletor de fichas (A / B / C) */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.switcher}>
        {plans.map((p) => {
          const active = p.id === selected.id;
          return (
            <TouchableOpacity
              key={p.id}
              onPress={() => onSelect(p.id)}
              style={[styles.pill, active && styles.pillActive]}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={p.name}
            >
              <Text style={[styles.pillLetter, active && styles.pillLetterActive]}>{planBadge(p)}</Text>
              <Text style={[styles.pillName, active && styles.pillNameActive]} numberOfLines={1}>{p.name}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Resumo da ficha */}
      <View style={styles.hero}>
        <View style={styles.heroTop}>
          <View style={styles.heroBadge}><Text style={styles.heroBadgeText}>{planBadge(selected)}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroTitle}>{selected.name}</Text>
            {!!(selected.routine || selected.dayLabel) && (
              <Text style={styles.heroSubtitle}>{[selected.routine, selected.dayLabel].filter(Boolean).join(' · ')}</Text>
            )}
          </View>
          <TouchableOpacity onPress={openMenu} style={styles.heroMenu} accessibilityRole="button" accessibilityLabel="Opções da ficha">
            <Text style={styles.heroMenuText}>⋯</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.heroStats}>
          <View style={styles.heroStat}><Text style={styles.heroStatValue}>{selected.exercises.length}</Text><Text style={styles.heroStatLabel}>exercícios</Text></View>
          <View style={styles.heroStat}><Text style={styles.heroStatValue}>{totalSets(selected) || '—'}</Text><Text style={styles.heroStatLabel}>séries</Text></View>
          <View style={styles.heroStat}><Text style={styles.heroStatValue}>~{estimateMinutes(selected)}</Text><Text style={styles.heroStatLabel}>minutos</Text></View>
        </View>
        {done ? (
          <View style={styles.heroDone}>
            <Text style={styles.heroDoneText}>✅ Concluído hoje{pending ? ' · pendente de sincronização' : ''}</Text>
            <TouchableOpacity onPress={onStart} accessibilityRole="button"><Text style={styles.heroLink}>Ver séries</Text></TouchableOpacity>
          </View>
        ) : checkin?.status === 'skipped' ? (
          <View style={styles.heroDone}><Text style={styles.heroDoneText}>⏭️ Pulado hoje</Text></View>
        ) : (
          <View style={styles.heroActions}>
            <TouchableOpacity style={styles.startBtn} onPress={onStart} accessibilityRole="button">
              <Text style={styles.startBtnText}>▶  Começar treino</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.doneBtn} onPress={() => onCheckIn('done')} accessibilityRole="button" accessibilityLabel="Marcar como concluído hoje">
              <Text style={styles.doneBtnText}>Já fiz ✅</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {mobility.length > 0 && (
        <>
          <Text style={styles.section}>🧘 Mobilidade e aquecimento</Text>
          {renderList(mobility, 0)}
          <Text style={styles.section}>💪 Treino principal</Text>
        </>
      )}
      {renderList(main, mobility.length)}

      <Modal visible={!!photo} transparent animationType="fade" onRequestClose={() => setPhoto(null)}>
        <Pressable style={styles.viewer} onPress={() => setPhoto(null)} accessibilityRole="button" accessibilityLabel="Fechar foto">
          {photo && <Image source={authImage(photo, token)} style={styles.viewerImage} resizeMode="contain" />}
          <Text style={styles.viewerHint}>Toque para fechar</Text>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  switcher: { gap: spacing.sm, paddingBottom: spacing.md },
  pill: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, minHeight: 44, borderRadius: radius.full, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  pillActive: { backgroundColor: colors.text, borderColor: colors.text },
  pillLetter: { fontSize: fontSize.md, fontFamily: fontFamily.bold, color: colors.primary },
  pillLetterActive: { color: '#fff' },
  pillName: { fontSize: fontSize.sm, fontFamily: fontFamily.medium, color: colors.textSecondary, maxWidth: 140 },
  pillNameActive: { color: '#fff' },

  hero: { backgroundColor: colors.primary, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md, gap: spacing.md, ...shadow.card },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  heroBadge: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  heroBadgeText: { color: '#fff', fontSize: 22, fontFamily: fontFamily.bold },
  heroTitle: { color: '#fff', fontSize: fontSize.xl, fontFamily: fontFamily.bold },
  heroSubtitle: { color: 'rgba(255,255,255,0.8)', fontSize: fontSize.sm, fontFamily: fontFamily.medium },
  heroMenu: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  heroMenuText: { color: '#fff', fontSize: 26, fontFamily: fontFamily.bold, marginTop: -8 },
  heroStats: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: radius.md, paddingVertical: spacing.sm },
  heroStat: { flex: 1, alignItems: 'center' },
  heroStatValue: { color: '#fff', fontSize: fontSize.lg, fontFamily: fontFamily.bold },
  heroStatLabel: { color: 'rgba(255,255,255,0.8)', fontSize: fontSize.xs, fontFamily: fontFamily.medium },
  heroActions: { flexDirection: 'row', gap: spacing.sm },
  startBtn: { flex: 1, minHeight: 48, borderRadius: radius.md, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  startBtnText: { color: colors.primary, fontSize: fontSize.md, fontFamily: fontFamily.bold },
  doneBtn: { minHeight: 48, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: 'rgba(255,255,255,0.6)', alignItems: 'center', justifyContent: 'center' },
  doneBtnText: { color: '#fff', fontFamily: fontFamily.semiBold },
  heroDone: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 44 },
  heroDoneText: { color: '#fff', fontFamily: fontFamily.semiBold, fontSize: fontSize.md },
  heroLink: { color: '#fff', textDecorationLine: 'underline', fontFamily: fontFamily.medium },

  section: { color: colors.text, fontSize: fontSize.md, fontFamily: fontFamily.semiBold, marginTop: spacing.sm, marginBottom: spacing.sm },

  card: { flexDirection: 'row', gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.sm, marginBottom: spacing.sm, ...shadow.card },
  photo: { width: 84, height: 150, borderRadius: radius.md, backgroundColor: colors.background },
  photoEmpty: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  photoIndex: { color: colors.textMuted, fontSize: 28, fontFamily: fontFamily.bold },
  cardBody: { flex: 1, gap: 6, paddingVertical: 2 },
  cardIndex: { color: colors.textMuted, fontSize: fontSize.xs, fontFamily: fontFamily.semiBold },
  cardName: { color: colors.text, fontSize: fontSize.md, fontFamily: fontFamily.semiBold, marginTop: -4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.full, backgroundColor: colors.background },
  chipAccent: { backgroundColor: `${colors.primary}1A` },
  chipIcon: { fontSize: 11 },
  chipText: { color: colors.text, fontSize: fontSize.xs, fontFamily: fontFamily.medium },
  chipTextAccent: { color: colors.primary, fontFamily: fontFamily.semiBold },
  badge: { borderWidth: 1, borderRadius: radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: fontSize.xs, fontFamily: fontFamily.semiBold },
  notes: { color: colors.textSecondary, fontSize: fontSize.sm, fontStyle: 'italic' },
  last: { color: colors.primary, fontSize: fontSize.xs, fontFamily: fontFamily.medium },
  videoBtn: { alignSelf: 'flex-start', minHeight: 32, justifyContent: 'center' },
  videoBtnText: { color: colors.primary, fontFamily: fontFamily.semiBold, fontSize: fontSize.sm },

  viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  viewerImage: { width: '100%', height: '80%' },
  viewerHint: { color: 'rgba(255,255,255,0.7)', marginTop: spacing.md, fontSize: fontSize.sm },
});
