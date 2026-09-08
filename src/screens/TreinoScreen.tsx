import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Exercise, WorkoutPlan, WorkoutCheckin } from '../types';
import { useWorkoutPlan } from '../hooks/useWorkoutPlan';
import { storage, getToken, exerciseVideoUrl } from '../services/storage';
import { colors, spacing, radius, fontSize } from '../constants/theme';

type WorkoutDraft = Omit<WorkoutPlan, 'id'>;

const newExerciseId = () => `ex_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;

function checkinFor(planId: string, checkins: WorkoutCheckin[]) {
  return checkins.find((c) => c.workoutPlanId === planId) || null;
}

function exerciseSummary(e: Exercise): string {
  const parts: string[] = [];
  if (e.sets) parts.push(`${e.sets}x`);
  if (e.reps) parts.push(e.reps);
  const setsReps = parts.join(' ');
  const extra = [setsReps, e.load].filter(Boolean).join(' · ');
  return extra;
}

// Player só é montado quando a URI/token já estão prontos - evita chamar
// useVideoPlayer com uma fonte vazia/placeholder e ter que trocar depois.
function VideoPlayerView({ uri, token }: { uri: string; token: string }) {
  const player = useVideoPlayer({ uri, headers: { Authorization: `Bearer ${token}` } }, (p) => {
    p.play();
  });
  return <VideoView player={player} style={styles.videoPlayer} contentFit="contain" nativeControls />;
}

function ExerciseVideoModal({ videoId, onClose }: { videoId: string | null; onClose: () => void }) {
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    if (!videoId) { setToken(null); return; }
    getToken().then(setToken);
  }, [videoId]);

  return (
    <Modal visible={!!videoId} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.videoModalOverlay}>
        <TouchableOpacity style={styles.videoModalClose} onPress={onClose}>
          <Text style={styles.videoModalCloseText}>✕</Text>
        </TouchableOpacity>
        {videoId && token ? (
          <VideoPlayerView uri={exerciseVideoUrl(videoId)} token={token} />
        ) : (
          <ActivityIndicator size="large" color={colors.primary} />
        )}
      </View>
    </Modal>
  );
}

function ExerciseEditorRow({
  exercise,
  onChange,
  onRemove,
}: {
  exercise: Exercise;
  onChange: (updated: Exercise) => void;
  onRemove: () => void;
}) {
  const [uploadingVideo, setUploadingVideo] = useState(false);

  const attachVideo = async (fromCamera: boolean) => {
    const { status } = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permissão necessária', fromCamera ? 'Precisamos acessar a câmera para gravar o vídeo.' : 'Precisamos acessar sua galeria para escolher o vídeo.');
      return;
    }
    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['videos'], quality: 0.6 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], quality: 0.6 });
    if (result.canceled || !result.assets?.[0]) return;

    setUploadingVideo(true);
    try {
      const asset = result.assets[0];
      const { id, error } = await storage.uploadExerciseVideo(asset.uri, asset.mimeType || 'video/mp4');
      if (error || !id) {
        Alert.alert('Erro ao enviar vídeo', error || 'Tente novamente.');
        return;
      }
      onChange({ ...exercise, videoId: id });
    } finally {
      setUploadingVideo(false);
    }
  };

  const removeVideo = () => {
    const videoId = exercise.videoId;
    onChange({ ...exercise, videoId: undefined });
    if (videoId) storage.deleteExerciseVideo(videoId).catch(() => {});
  };

  return (
    <View style={styles.exerciseEditorCard}>
      <View style={styles.exerciseRowTop}>
        <TextInput
          style={[styles.modalInput, styles.exerciseNameInput]}
          value={exercise.name}
          onChangeText={(v) => onChange({ ...exercise, name: v })}
          placeholder="Nome do exercício"
          placeholderTextColor={colors.textMuted}
        />
        <TouchableOpacity onPress={onRemove}><Text style={styles.cardActionIcon}>🗑️</Text></TouchableOpacity>
      </View>

      <View style={styles.exerciseFieldsRow}>
        <TextInput
          style={[styles.modalInput, styles.exerciseSmallInput]}
          value={exercise.sets != null ? String(exercise.sets) : ''}
          onChangeText={(v) => onChange({ ...exercise, sets: v ? (parseInt(v, 10) || undefined) : undefined })}
          placeholder="Séries"
          placeholderTextColor={colors.textMuted}
          keyboardType="number-pad"
        />
        <TextInput
          style={[styles.modalInput, styles.exerciseSmallInput]}
          value={exercise.reps || ''}
          onChangeText={(v) => onChange({ ...exercise, reps: v || undefined })}
          placeholder="Reps"
          placeholderTextColor={colors.textMuted}
        />
        <TextInput
          style={[styles.modalInput, styles.exerciseSmallInput]}
          value={exercise.load || ''}
          onChangeText={(v) => onChange({ ...exercise, load: v || undefined })}
          placeholder="Carga"
          placeholderTextColor={colors.textMuted}
        />
      </View>

      {exercise.videoId ? (
        <View style={styles.videoAttachedRow}>
          <Text style={styles.videoAttachedText}>🎥 Vídeo anexado</Text>
          <TouchableOpacity onPress={removeVideo}><Text style={styles.videoRemoveText}>Remover</Text></TouchableOpacity>
        </View>
      ) : (
        <View style={styles.videoAttachRow}>
          <TouchableOpacity style={styles.videoAttachBtn} onPress={() => attachVideo(true)} disabled={uploadingVideo}>
            <Text style={styles.videoAttachBtnText}>🎥 Gravar</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.videoAttachBtn} onPress={() => attachVideo(false)} disabled={uploadingVideo}>
            <Text style={styles.videoAttachBtnText}>🖼 Galeria</Text>
          </TouchableOpacity>
          {uploadingVideo && <ActivityIndicator size="small" color={colors.primary} style={{ marginLeft: spacing.xs }} />}
        </View>
      )}
    </View>
  );
}

function WorkoutCard({
  plan,
  checkin,
  onCheckIn,
  onEdit,
  onDelete,
  onViewVideo,
}: {
  plan: WorkoutPlan;
  checkin: WorkoutCheckin | null;
  onCheckIn: (status: 'done' | 'skipped') => void;
  onEdit: () => void;
  onDelete: () => void;
  onViewVideo: (videoId: string) => void;
}) {
  const borderColor = checkin?.status === 'done' ? colors.success : checkin?.status === 'skipped' ? colors.textMuted : colors.primary;

  return (
    <View style={[styles.card, { borderLeftColor: borderColor }]}>
      <View style={styles.cardTop}>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardName}>{plan.name}</Text>
          {!!plan.dayLabel && <Text style={styles.cardDayLabel}>{plan.dayLabel}</Text>}
        </View>
        <View style={styles.cardActions}>
          <TouchableOpacity onPress={onEdit}><Text style={styles.cardActionIcon}>✏️</Text></TouchableOpacity>
          <TouchableOpacity onPress={onDelete}><Text style={styles.cardActionIcon}>🗑️</Text></TouchableOpacity>
        </View>
      </View>

      {plan.exercises.map((e) => (
        <View key={e.id} style={styles.exerciseLine}>
          <View style={{ flex: 1 }}>
            <Text style={styles.exerciseLineName}>• {e.name}</Text>
            {!!exerciseSummary(e) && <Text style={styles.exerciseLineDetail}>{exerciseSummary(e)}</Text>}
          </View>
          {e.videoId && (
            <TouchableOpacity style={styles.playBtn} onPress={() => onViewVideo(e.videoId!)}>
              <Text style={styles.playBtnText}>▶</Text>
            </TouchableOpacity>
          )}
        </View>
      ))}

      {checkin ? (
        <View style={styles.statusBadge}>
          <Text style={styles.statusText}>
            {checkin.status === 'done' ? '✅ Concluído' : '⏭️ Pulado'}
          </Text>
        </View>
      ) : (
        <View style={styles.checkinRow}>
          <TouchableOpacity style={styles.checkinBtn} onPress={() => onCheckIn('done')}>
            <Text style={styles.checkinBtnText}>Concluí hoje ✅</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.skipBtn} onPress={() => onCheckIn('skipped')}>
            <Text style={styles.skipBtnText}>Pular</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

function WorkoutFormModal({
  visible,
  initial,
  onClose,
  onSave,
}: {
  visible: boolean;
  initial: WorkoutDraft | null;
  onClose: () => void;
  onSave: (plan: WorkoutDraft) => void;
}) {
  const [name, setName] = useState(initial?.name || '');
  const [dayLabel, setDayLabel] = useState(initial?.dayLabel || '');
  const [exercises, setExercises] = useState<Exercise[]>(initial?.exercises || []);

  useEffect(() => {
    if (visible) {
      setName(initial?.name || '');
      setDayLabel(initial?.dayLabel || '');
      setExercises(initial?.exercises || []);
    }
  }, [visible, initial]);

  const addExercise = () => {
    setExercises([...exercises, { id: newExerciseId(), name: '' }]);
  };
  const updateExercise = (index: number, updated: Exercise) => {
    setExercises(exercises.map((e, i) => (i === index ? updated : e)));
  };
  const removeExercise = (index: number) => {
    setExercises(exercises.filter((_, i) => i !== index));
  };

  const handleSave = () => {
    if (!name.trim()) {
      Alert.alert('Campo obrigatório', 'Preencha o nome da ficha (ex: "Treino A - Peito/Tríceps").');
      return;
    }
    const cleanExercises = exercises.map((e) => ({ ...e, name: e.name.trim() })).filter((e) => e.name);
    if (cleanExercises.length === 0) {
      Alert.alert('Adicione ao menos um exercício', 'Toque em "Adicionar exercício" para montar a ficha.');
      return;
    }
    onSave({
      name: name.trim(),
      dayLabel: dayLabel.trim() || undefined,
      exercises: cleanExercises,
      source: initial?.source || 'manual',
    });
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
        <View style={[styles.modalSheet, styles.formSheet]}>
          <View style={styles.modalHandle} />
          <Text style={styles.modalTitle}>{initial ? 'Editar ficha' : 'Nova ficha de treino'}</Text>

          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={styles.modalLabel}>Nome da ficha</Text>
            <TextInput
              style={styles.modalInput}
              value={name}
              onChangeText={setName}
              placeholder="Ex: Treino A - Peito/Tríceps"
              placeholderTextColor={colors.textMuted}
            />

            <Text style={styles.modalLabel}>Dia/Rótulo (opcional)</Text>
            <TextInput
              style={styles.modalInput}
              value={dayLabel}
              onChangeText={setDayLabel}
              placeholder="Ex: Segunda"
              placeholderTextColor={colors.textMuted}
            />

            <Text style={[styles.modalLabel, { marginTop: spacing.md }]}>Exercícios</Text>
            {exercises.map((e, i) => (
              <ExerciseEditorRow
                key={e.id}
                exercise={e}
                onChange={(updated) => updateExercise(i, updated)}
                onRemove={() => removeExercise(i)}
              />
            ))}
            <TouchableOpacity style={styles.addExerciseBtn} onPress={addExercise}>
              <Text style={styles.addExerciseBtnText}>+ Adicionar exercício</Text>
            </TouchableOpacity>
          </ScrollView>

          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelBtnText}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
              <Text style={styles.saveBtnText}>Salvar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function WorkoutReviewModal({
  visible,
  drafts,
  onClose,
  onEditDraft,
  onRemoveDraft,
  onConfirm,
}: {
  visible: boolean;
  drafts: WorkoutDraft[];
  onClose: () => void;
  onEditDraft: (index: number) => void;
  onRemoveDraft: (index: number) => void;
  onConfirm: () => void;
}) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalSheet, styles.reviewSheet]}>
          <View style={styles.modalHandle} />
          <Text style={styles.modalTitle}>Revisar fichas extraídas</Text>
          <Text style={styles.reviewSubtitle}>
            Confira e ajuste antes de salvar. Você pode editar ou remover qualquer ficha.
          </Text>

          <ScrollView style={styles.reviewList} showsVerticalScrollIndicator={false}>
            {drafts.map((draft, i) => (
              <View key={i} style={styles.reviewCard}>
                <View style={styles.cardTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardName}>{draft.name}</Text>
                    {!!draft.dayLabel && <Text style={styles.cardDayLabel}>{draft.dayLabel}</Text>}
                  </View>
                  <View style={styles.cardActions}>
                    <TouchableOpacity onPress={() => onEditDraft(i)}><Text style={styles.cardActionIcon}>✏️</Text></TouchableOpacity>
                    <TouchableOpacity onPress={() => onRemoveDraft(i)}><Text style={styles.cardActionIcon}>🗑️</Text></TouchableOpacity>
                  </View>
                </View>
                {draft.exercises.map((e) => (
                  <Text key={e.id} style={styles.exerciseLineName}>• {e.name} {exerciseSummary(e) ? `(${exerciseSummary(e)})` : ''}</Text>
                ))}
              </View>
            ))}
          </ScrollView>

          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelBtnText}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.saveBtn, drafts.length === 0 && styles.saveBtnDisabled]}
              onPress={onConfirm}
              disabled={drafts.length === 0}
            >
              <Text style={styles.saveBtnText}>Salvar {drafts.length} ficha{drafts.length === 1 ? '' : 's'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export default function TreinoScreen() {
  const { plans, todayCheckins, isLoading, savePlans, checkIn, refresh } = useWorkoutPlan();
  const [refreshing, setRefreshing] = useState(false);
  const [formVisible, setFormVisible] = useState(false);
  const [editingPlan, setEditingPlan] = useState<WorkoutPlan | null>(null);
  const [importing, setImporting] = useState(false);
  const [pdfDrafts, setPdfDrafts] = useState<WorkoutDraft[] | null>(null);
  const [editingDraftIndex, setEditingDraftIndex] = useState<number | null>(null);
  const [viewingVideoId, setViewingVideoId] = useState<string | null>(null);

  const onRefresh = async () => { setRefreshing(true); await refresh(); setRefreshing(false); };

  const doneCount = todayCheckins.filter((c) => c.status === 'done').length;

  const openAdd = () => { setEditingPlan(null); setEditingDraftIndex(null); setFormVisible(true); };
  const openEdit = (plan: WorkoutPlan) => { setEditingPlan(plan); setEditingDraftIndex(null); setFormVisible(true); };
  const openEditDraft = (index: number) => { setEditingPlan(null); setEditingDraftIndex(index); setFormVisible(true); };

  const handleFormSave = async (data: WorkoutDraft) => {
    if (editingDraftIndex !== null && pdfDrafts) {
      const updated = [...pdfDrafts];
      updated[editingDraftIndex] = { ...updated[editingDraftIndex], ...data };
      setPdfDrafts(updated);
      setEditingDraftIndex(null);
    } else if (editingPlan) {
      await savePlans(plans.map((p) => (p.id === editingPlan.id ? { ...p, ...data } : p)));
    } else {
      const newPlan: WorkoutPlan = { id: `local_${Date.now()}`, ...data };
      await savePlans([...plans, newPlan]);
    }
    setFormVisible(false);
    setEditingPlan(null);
  };

  const handleDelete = (plan: WorkoutPlan) => {
    Alert.alert('Excluir ficha', `Remover "${plan.name}"?`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Excluir', style: 'destructive', onPress: () => savePlans(plans.filter((p) => p.id !== plan.id)) },
    ]);
  };

  const handleUploadPdf = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: 'application/pdf' });
    if (result.canceled || !result.assets?.[0]) return;

    setImporting(true);
    try {
      const base64 = await FileSystem.readAsStringAsync(result.assets[0].uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const { plans: extracted, error } = await storage.extractWorkoutFromPdf(base64);
      if (error) {
        Alert.alert('Não foi possível ler o PDF', error);
        return;
      }
      if (extracted.length === 0) {
        Alert.alert('Nenhuma ficha encontrada', 'Não conseguimos identificar exercícios nesse PDF. Tente montar a ficha manualmente.');
        return;
      }
      setPdfDrafts(extracted.map((d) => ({
        ...d,
        exercises: d.exercises.map((e) => ({ ...e, id: e.id || newExerciseId() })),
      })));
    } catch {
      Alert.alert('Erro', 'Não foi possível processar o arquivo. Tente novamente.');
    } finally {
      setImporting(false);
    }
  };

  const handleRemoveDraft = (index: number) => {
    if (!pdfDrafts) return;
    setPdfDrafts(pdfDrafts.filter((_, i) => i !== index));
  };

  const handleConfirmDrafts = async () => {
    if (!pdfDrafts || pdfDrafts.length === 0) return;
    const newPlans: WorkoutPlan[] = pdfDrafts.map((draft, i) => ({
      id: `pdf_${Date.now()}_${i}`,
      ...draft,
    }));
    await savePlans([...plans, ...newPlans]);
    setPdfDrafts(null);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Treino</Text>
          <Text style={styles.subtitle}>
            {plans.length === 0 ? 'Nenhuma ficha cadastrada' : `${doneCount} de ${plans.length} fichas hoje`}
          </Text>
        </View>
        <TouchableOpacity style={styles.pdfBtn} onPress={handleUploadPdf} disabled={importing}>
          {importing ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Text style={styles.pdfBtnText}>📄 PDF</Text>
          )}
        </TouchableOpacity>
      </View>

      <FlatList
        data={plans}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => (
          <WorkoutCard
            plan={item}
            checkin={checkinFor(item.id, todayCheckins)}
            onCheckIn={(status) => checkIn(item.id, status)}
            onEdit={() => openEdit(item)}
            onDelete={() => handleDelete(item)}
            onViewVideo={setViewingVideoId}
          />
        )}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          !isLoading ? (
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>🏋️</Text>
              <Text style={styles.emptyText}>Nenhuma ficha de treino ainda</Text>
              <Text style={styles.emptySubtext}>Toque em + para montar manualmente, ou envie o PDF da sua ficha no botão acima.</Text>
            </View>
          ) : null
        }
      />

      <TouchableOpacity style={styles.fab} onPress={openAdd} activeOpacity={0.85}>
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>

      <WorkoutFormModal
        visible={formVisible}
        initial={editingDraftIndex !== null && pdfDrafts ? pdfDrafts[editingDraftIndex] : editingPlan}
        onClose={() => { setFormVisible(false); setEditingPlan(null); setEditingDraftIndex(null); }}
        onSave={handleFormSave}
      />

      <WorkoutReviewModal
        visible={!!pdfDrafts}
        drafts={pdfDrafts || []}
        onClose={() => setPdfDrafts(null)}
        onEditDraft={openEditDraft}
        onRemoveDraft={handleRemoveDraft}
        onConfirm={handleConfirmDrafts}
      />

      <ExerciseVideoModal videoId={viewingVideoId} onClose={() => setViewingVideoId(null)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xs, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: colors.text, fontSize: fontSize.xxl, fontWeight: '700' },
  subtitle: { color: colors.textSecondary, fontSize: fontSize.sm },
  list: { padding: spacing.md, paddingBottom: 100 },

  pdfBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.full, backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.border, minWidth: 40, minHeight: 32, justifyContent: 'center' },
  pdfBtnText: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },

  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, borderLeftWidth: 3 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: spacing.xs },
  cardActions: { flexDirection: 'row', gap: spacing.md },
  cardActionIcon: { fontSize: 16 },
  cardName: { color: colors.text, fontSize: fontSize.lg, fontWeight: '600', marginBottom: 2 },
  cardDayLabel: { color: colors.primary, fontSize: fontSize.xs, fontWeight: '600' },

  exerciseLine: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  exerciseLineName: { color: colors.textSecondary, fontSize: fontSize.sm },
  exerciseLineDetail: { color: colors.textMuted, fontSize: fontSize.xs },
  playBtn: { width: 26, height: 26, borderRadius: radius.full, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginLeft: spacing.sm },
  playBtnText: { color: '#000', fontSize: 11, fontWeight: '700' },

  checkinRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  checkinBtn: { flex: 1, backgroundColor: colors.primary, borderRadius: radius.sm, paddingVertical: spacing.sm, alignItems: 'center' },
  checkinBtnText: { color: '#000', fontWeight: '700', fontSize: fontSize.sm },
  skipBtn: { flex: 1, backgroundColor: colors.surfaceElevated, borderRadius: radius.sm, paddingVertical: spacing.sm, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  skipBtnText: { color: colors.textSecondary, fontWeight: '600', fontSize: fontSize.sm },

  statusBadge: { marginTop: spacing.sm, alignSelf: 'flex-start', paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.full, backgroundColor: colors.surfaceElevated },
  statusText: { color: colors.textSecondary, fontSize: fontSize.xs, fontWeight: '600' },

  empty: { alignItems: 'center', paddingTop: spacing.xxl },
  emptyIcon: { fontSize: 48, marginBottom: spacing.md },
  emptyText: { color: colors.text, fontSize: fontSize.lg, fontWeight: '600' },
  emptySubtext: { color: colors.textSecondary, fontSize: fontSize.sm, textAlign: 'center', marginTop: spacing.xs, paddingHorizontal: spacing.xl },

  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOpacity: 0.5,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  fabText: { color: '#000', fontSize: 28, fontWeight: '300', lineHeight: 32 },

  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  modalSheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: spacing.lg, paddingBottom: 40 },
  formSheet: { maxHeight: '88%' },
  modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: spacing.md },
  modalTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700', marginBottom: spacing.md },
  modalLabel: { color: colors.textSecondary, fontSize: fontSize.xs, fontWeight: '600', textTransform: 'uppercase', marginBottom: spacing.xs, marginTop: spacing.sm },
  modalInput: { backgroundColor: colors.surfaceElevated, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.text, fontSize: fontSize.md, borderWidth: 1, borderColor: colors.border },
  modalActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  cancelBtn: { flex: 1, paddingVertical: spacing.sm, alignItems: 'center', borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border },
  cancelBtnText: { color: colors.textSecondary, fontWeight: '600' },
  saveBtn: { flex: 1, paddingVertical: spacing.sm, alignItems: 'center', borderRadius: radius.sm, backgroundColor: colors.primary },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnText: { color: '#000', fontWeight: '700' },

  reviewSheet: { maxHeight: '85%' },
  reviewSubtitle: { color: colors.textSecondary, fontSize: fontSize.sm, marginBottom: spacing.md },
  reviewList: { maxHeight: 400 },
  reviewCard: { backgroundColor: colors.surfaceElevated, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, borderLeftWidth: 3, borderLeftColor: colors.primary },

  exerciseEditorCard: { backgroundColor: colors.surfaceElevated, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border },
  exerciseRowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  exerciseNameInput: { flex: 1 },
  exerciseFieldsRow: { flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.xs },
  exerciseSmallInput: { flex: 1 },
  addExerciseBtn: { alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.primary, borderStyle: 'dashed', marginTop: spacing.xs, marginBottom: spacing.md },
  addExerciseBtnText: { color: colors.primary, fontWeight: '600', fontSize: fontSize.sm },

  videoAttachRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  videoAttachBtn: { paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  videoAttachBtnText: { color: colors.textSecondary, fontSize: fontSize.xs, fontWeight: '600' },
  videoAttachedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  videoAttachedText: { color: colors.primary, fontSize: fontSize.xs, fontWeight: '600' },
  videoRemoveText: { color: colors.textMuted, fontSize: fontSize.xs, textDecorationLine: 'underline' },

  videoModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
  videoModalClose: { position: 'absolute', top: 50, right: 24, width: 36, height: 36, borderRadius: radius.full, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center', zIndex: 1 },
  videoModalCloseText: { color: '#fff', fontSize: fontSize.md, fontWeight: '700' },
  videoPlayer: { width: '100%', aspectRatio: 16 / 9 },
});
