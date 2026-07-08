import React, { useState } from 'react';
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Meal, MealCheckin } from '../types';
import { useMealPlan } from '../hooks/useMealPlan';
import { colors, spacing, radius, fontSize } from '../constants/theme';

function checkinFor(mealId: string, checkins: MealCheckin[]) {
  return checkins.find((c) => c.mealId === mealId) || null;
}

function MealCard({
  meal,
  checkin,
  onCheckIn,
  onEdit,
  onDelete,
}: {
  meal: Meal;
  checkin: MealCheckin | null;
  onCheckIn: (status: 'done' | 'skipped') => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const borderColor = checkin?.status === 'done' ? colors.success : checkin?.status === 'skipped' ? colors.textMuted : colors.primary;

  return (
    <View style={[styles.card, { borderLeftColor: borderColor }]}>
      <View style={styles.cardTop}>
        <Text style={styles.cardTime}>{meal.time}</Text>
        <View style={styles.cardActions}>
          <TouchableOpacity onPress={onEdit}><Text style={styles.cardActionIcon}>✏️</Text></TouchableOpacity>
          <TouchableOpacity onPress={onDelete}><Text style={styles.cardActionIcon}>🗑️</Text></TouchableOpacity>
        </View>
      </View>
      <Text style={styles.cardName}>{meal.name}</Text>
      {meal.items.length > 0 && (
        <Text style={styles.cardItems}>{meal.items.join(', ')}</Text>
      )}
      {!!meal.description && <Text style={styles.cardDescription}>{meal.description}</Text>}

      {checkin ? (
        <View style={styles.statusBadge}>
          <Text style={styles.statusText}>
            {checkin.status === 'done' ? '✅ Comi' : '⏭️ Pulei'}
          </Text>
        </View>
      ) : (
        <View style={styles.checkinRow}>
          <TouchableOpacity style={styles.checkinBtn} onPress={() => onCheckIn('done')}>
            <Text style={styles.checkinBtnText}>Comi ✅</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.skipBtn} onPress={() => onCheckIn('skipped')}>
            <Text style={styles.skipBtnText}>Pular</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

function MealFormModal({
  visible,
  initial,
  onClose,
  onSave,
}: {
  visible: boolean;
  initial: Meal | null;
  onClose: () => void;
  onSave: (meal: { name: string; time: string; description?: string; items: string[] }) => void;
}) {
  const [name, setName] = useState(initial?.name || '');
  const [time, setTime] = useState(initial?.time || '');
  const [items, setItems] = useState(initial?.items.join(', ') || '');
  const [description, setDescription] = useState(initial?.description || '');

  React.useEffect(() => {
    if (visible) {
      setName(initial?.name || '');
      setTime(initial?.time || '');
      setItems(initial?.items.join(', ') || '');
      setDescription(initial?.description || '');
    }
  }, [visible, initial]);

  const handleSave = () => {
    if (!name.trim() || !/^\d{1,2}:\d{2}$/.test(time.trim())) {
      Alert.alert('Campos obrigatórios', 'Preencha o nome da refeição e o horário no formato HH:mm (ex: 12:30).');
      return;
    }
    onSave({
      name: name.trim(),
      time: time.trim(),
      description: description.trim() || undefined,
      items: items.split(',').map((i) => i.trim()).filter(Boolean),
    });
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHandle} />
          <Text style={styles.modalTitle}>{initial ? 'Editar refeição' : 'Nova refeição'}</Text>

          <Text style={styles.modalLabel}>Nome</Text>
          <TextInput
            style={styles.modalInput}
            value={name}
            onChangeText={setName}
            placeholder="Ex: Almoço"
            placeholderTextColor={colors.textMuted}
          />

          <Text style={styles.modalLabel}>Horário (HH:mm)</Text>
          <TextInput
            style={styles.modalInput}
            value={time}
            onChangeText={setTime}
            placeholder="Ex: 12:30"
            placeholderTextColor={colors.textMuted}
            keyboardType="numbers-and-punctuation"
          />

          <Text style={styles.modalLabel}>Itens (separados por vírgula)</Text>
          <TextInput
            style={styles.modalInput}
            value={items}
            onChangeText={setItems}
            placeholder="Ex: 200g frango grelhado, 150g arroz"
            placeholderTextColor={colors.textMuted}
          />

          <Text style={styles.modalLabel}>Observações (opcional)</Text>
          <TextInput
            style={styles.modalInput}
            value={description}
            onChangeText={setDescription}
            placeholder="Ex: Evitar frituras"
            placeholderTextColor={colors.textMuted}
          />

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

export default function DietaScreen() {
  const { meals, todayCheckins, isLoading, savePlan, checkIn, refresh } = useMealPlan();
  const [refreshing, setRefreshing] = useState(false);
  const [formVisible, setFormVisible] = useState(false);
  const [editingMeal, setEditingMeal] = useState<Meal | null>(null);

  const onRefresh = async () => { setRefreshing(true); await refresh(); setRefreshing(false); };

  const sorted = [...meals].sort((a, b) => a.time.localeCompare(b.time));
  const doneCount = todayCheckins.filter((c) => c.status === 'done').length;

  const openAdd = () => { setEditingMeal(null); setFormVisible(true); };
  const openEdit = (meal: Meal) => { setEditingMeal(meal); setFormVisible(true); };

  const handleFormSave = async (data: { name: string; time: string; description?: string; items: string[] }) => {
    if (editingMeal) {
      await savePlan(meals.map((m) => (m.id === editingMeal.id ? { ...m, ...data } : m)));
    } else {
      const newMeal: Meal = { id: `local_${Date.now()}`, source: 'manual', ...data };
      await savePlan([...meals, newMeal]);
    }
    setFormVisible(false);
    setEditingMeal(null);
  };

  const handleDelete = (meal: Meal) => {
    Alert.alert('Excluir refeição', `Remover "${meal.name}" do plano?`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Excluir', style: 'destructive', onPress: () => savePlan(meals.filter((m) => m.id !== meal.id)) },
    ]);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Dieta</Text>
          <Text style={styles.subtitle}>
            {meals.length === 0 ? 'Nenhum plano cadastrado' : `${doneCount} de ${meals.length} refeições hoje`}
          </Text>
        </View>
      </View>

      <FlatList
        data={sorted}
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => (
          <MealCard
            meal={item}
            checkin={checkinFor(item.id, todayCheckins)}
            onCheckIn={(status) => checkIn(item.id, status)}
            onEdit={() => openEdit(item)}
            onDelete={() => handleDelete(item)}
          />
        )}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          !isLoading ? (
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>🍽️</Text>
              <Text style={styles.emptyText}>Nenhum plano alimentar ainda</Text>
              <Text style={styles.emptySubtext}>Toque em + para montar suas refeições do dia manualmente.</Text>
            </View>
          ) : null
        }
      />

      <TouchableOpacity style={styles.fab} onPress={openAdd} activeOpacity={0.85}>
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>

      <MealFormModal
        visible={formVisible}
        initial={editingMeal}
        onClose={() => { setFormVisible(false); setEditingMeal(null); }}
        onSave={handleFormSave}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xs, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  title: { color: colors.text, fontSize: fontSize.xxl, fontWeight: '700' },
  subtitle: { color: colors.textSecondary, fontSize: fontSize.sm },
  list: { padding: spacing.md, paddingBottom: 100 },

  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, borderLeftWidth: 3 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs },
  cardTime: { color: colors.primary, fontSize: fontSize.md, fontWeight: '700' },
  cardActions: { flexDirection: 'row', gap: spacing.md },
  cardActionIcon: { fontSize: 16 },
  cardName: { color: colors.text, fontSize: fontSize.lg, fontWeight: '600', marginBottom: 2 },
  cardItems: { color: colors.textSecondary, fontSize: fontSize.sm, marginBottom: 2 },
  cardDescription: { color: colors.textMuted, fontSize: fontSize.xs, fontStyle: 'italic', marginBottom: spacing.sm },

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
  modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: spacing.md },
  modalTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700', marginBottom: spacing.md },
  modalLabel: { color: colors.textSecondary, fontSize: fontSize.xs, fontWeight: '600', textTransform: 'uppercase', marginBottom: spacing.xs, marginTop: spacing.sm },
  modalInput: { backgroundColor: colors.surfaceElevated, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.text, fontSize: fontSize.md, borderWidth: 1, borderColor: colors.border },
  modalActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  cancelBtn: { flex: 1, paddingVertical: spacing.sm, alignItems: 'center', borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border },
  cancelBtnText: { color: colors.textSecondary, fontWeight: '600' },
  saveBtn: { flex: 1, paddingVertical: spacing.sm, alignItems: 'center', borderRadius: radius.sm, backgroundColor: colors.primary },
  saveBtnText: { color: '#000', fontWeight: '700' },
});
