import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { format, isToday, isYesterday, startOfDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ExtractedData } from '../types';
import { storage } from '../services/storage';
import { colors, spacing, radius, fontSize } from '../constants/theme';

const { width } = Dimensions.get('window');

const CATEGORY_CONFIG: Record<ExtractedData['category'], { icon: string; color: string; label: string; bg: string }> = {
  sleep:       { icon: '🌙', color: '#9C7FE8', label: 'Sono',        bg: 'rgba(156,127,232,0.12)' },
  nutrition:   { icon: '🥗', color: '#FF7B7B', label: 'Alimentação', bg: 'rgba(255,123,123,0.12)' },
  performance: { icon: '🏋️', color: '#00C853', label: 'Performance', bg: 'rgba(0,200,83,0.12)'    },
  mood:        { icon: '😊', color: '#FFB300', label: 'Humor',       bg: 'rgba(255,179,0,0.12)'   },
  health:      { icon: '❤️', color: '#FF4081', label: 'Saúde',       bg: 'rgba(255,64,129,0.12)'  },
  workout:     { icon: '🔥', color: '#FF7043', label: 'Treino',      bg: 'rgba(255,112,67,0.12)'  },
};

const FILTERS = ['Todos', 'Sono', 'Alimentação', 'Performance', 'Humor', 'Saúde', 'Treino'];
const FILTER_MAP: Record<string, ExtractedData['category']> = {
  Sono: 'sleep', Alimentação: 'nutrition', Performance: 'performance',
  Humor: 'mood', Saúde: 'health', Treino: 'workout',
};

function dateLabel(ts: number) {
  if (isToday(ts)) return 'Hoje';
  if (isYesterday(ts)) return 'Ontem';
  return format(ts, "d 'de' MMMM", { locale: ptBR });
}

function groupByDate(data: ExtractedData[]) {
  const groups: Record<string, ExtractedData[]> = {};
  data.forEach((item) => {
    const key = startOfDay(item.timestamp).getTime().toString();
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  });
  return Object.entries(groups)
    .sort(([a], [b]) => Number(b) - Number(a))
    .map(([key, items]) => ({ key, label: dateLabel(Number(key)), items }));
}

function CategoryBadge({ category }: { category: ExtractedData['category'] }) {
  const cfg = CATEGORY_CONFIG[category];
  return (
    <View style={[styles.badge, { backgroundColor: cfg.bg }]}>
      <Text style={styles.badgeIcon}>{cfg.icon}</Text>
      <Text style={[styles.badgeLabel, { color: cfg.color }]}>{cfg.label}</Text>
    </View>
  );
}

function DataCard({ item }: { item: ExtractedData }) {
  const cfg = CATEGORY_CONFIG[item.category];
  return (
    <View style={[styles.card, { borderLeftColor: cfg.color }]}>
      <View style={styles.cardTop}>
        <CategoryBadge category={item.category} />
        <Text style={styles.cardTime}>{format(item.timestamp, 'HH:mm')}</Text>
      </View>
      <Text style={styles.cardValue}>{item.label}: <Text style={[styles.cardValueBold, { color: cfg.color }]}>{item.value}</Text></Text>
      <Text style={styles.cardRaw}>"{item.rawText}"</Text>
    </View>
  );
}

function DaySummary({ items }: { items: ExtractedData[] }) {
  const cats = [...new Set(items.map((i) => i.category))];
  return (
    <View style={styles.daySummary}>
      {cats.map((c) => (
        <Text key={c} style={styles.daySummaryIcon}>{CATEGORY_CONFIG[c].icon}</Text>
      ))}
      <Text style={styles.daySummaryCount}>{items.length} registro{items.length !== 1 ? 's' : ''}</Text>
    </View>
  );
}

function StatsBar({ data }: { data: ExtractedData[] }) {
  const total = data.length;
  if (total === 0) return null;

  const cats = Object.entries(CATEGORY_CONFIG).map(([key, cfg]) => {
    const count = data.filter((d) => d.category === key).length;
    return { key, cfg, count, pct: total > 0 ? count / total : 0 };
  }).filter((c) => c.count > 0).sort((a, b) => b.count - a.count);

  return (
    <View style={styles.statsBar}>
      <Text style={styles.statsTitle}>Distribuição dos registros</Text>
      {cats.map(({ key, cfg, count, pct }) => (
        <View key={key} style={styles.statRow}>
          <Text style={styles.statIcon}>{cfg.icon}</Text>
          <Text style={styles.statLabel}>{cfg.label}</Text>
          <View style={styles.barTrack}>
            <View style={[styles.barFill, { width: `${pct * 100}%`, backgroundColor: cfg.color }]} />
          </View>
          <Text style={[styles.statCount, { color: cfg.color }]}>{count}</Text>
        </View>
      ))}
    </View>
  );
}

export default function DiaryScreen() {
  const [allData, setAllData] = useState<ExtractedData[]>([]);
  const [filter, setFilter] = useState('Todos');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const data = await storage.getExtractedData();
    setAllData(data.sort((a, b) => b.timestamp - a.timestamp));
  }, []);

  useEffect(() => { load(); }, []);

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const filtered = filter === 'Todos' ? allData : allData.filter((d) => d.category === FILTER_MAP[filter]);
  const groups = groupByDate(filtered);

  type ListItem =
    | { type: 'stats' }
    | { type: 'filters' }
    | { type: 'dayHeader'; label: string }
    | { type: 'card'; item: ExtractedData }
    | { type: 'empty' };

  const listData: ListItem[] = [
    { type: 'stats' },
    { type: 'filters' },
    ...(groups.length === 0
      ? [{ type: 'empty' } as ListItem]
      : groups.flatMap((g) => [
          { type: 'dayHeader', label: g.label } as ListItem,
          ...g.items.map((item) => ({ type: 'card', item } as ListItem)),
        ])),
  ];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Diário</Text>
        <Text style={styles.subtitle}>{allData.length} registros totais</Text>
      </View>

      <FlatList
        data={listData}
        keyExtractor={(item, i) => {
          if (item.type === 'card') return item.item.timestamp + i;
          return item.type + i;
        }}
        renderItem={({ item }) => {
          if (item.type === 'stats') return <StatsBar data={allData} />;
          if (item.type === 'filters') return (
            <FlatList
              horizontal
              data={FILTERS}
              keyExtractor={(f) => f}
              renderItem={({ item: f }) => (
                <TouchableOpacity
                  style={[styles.filterBtn, filter === f && styles.filterBtnActive]}
                  onPress={() => setFilter(f)}
                >
                  <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>{f}</Text>
                </TouchableOpacity>
              )}
              contentContainerStyle={styles.filterRow}
              showsHorizontalScrollIndicator={false}
            />
          );
          if (item.type === 'dayHeader') {
            const group = groups.find((g) => g.label === item.label);
            return (
              <View style={styles.dayHeader}>
                <Text style={styles.dayLabel}>{item.label}</Text>
                {group && <DaySummary items={group.items} />}
              </View>
            );
          }
          if (item.type === 'card') return <DataCard item={item.item} />;
          return (
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>📋</Text>
              <Text style={styles.emptyText}>Nenhum registro ainda</Text>
              <Text style={styles.emptySubtext}>Converse com o AmigoFit e os dados vão aparecer aqui automaticamente!</Text>
            </View>
          );
        }}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: colors.background },
  header:      { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xs },
  title:       { color: colors.text, fontSize: fontSize.xxl, fontWeight: '700' },
  subtitle:    { color: colors.textSecondary, fontSize: fontSize.sm },
  list:        { padding: spacing.md, paddingBottom: spacing.xxl },
  statsBar:    { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md },
  statsTitle:  { color: colors.textSecondary, fontSize: fontSize.xs, fontWeight: '600', textTransform: 'uppercase', marginBottom: spacing.sm },
  statRow:     { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm, gap: spacing.sm },
  statIcon:    { fontSize: 14, width: 20 },
  statLabel:   { color: colors.textSecondary, fontSize: fontSize.sm, width: 90 },
  barTrack:    { flex: 1, height: 6, backgroundColor: colors.border, borderRadius: radius.full, overflow: 'hidden' },
  barFill:     { height: '100%', borderRadius: radius.full },
  statCount:   { fontSize: fontSize.sm, fontWeight: '700', width: 24, textAlign: 'right' },
  filterRow:   { paddingBottom: spacing.md, gap: spacing.sm },
  filterBtn:   { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.full, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  filterBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterText:  { color: colors.textSecondary, fontSize: fontSize.sm },
  filterTextActive: { color: '#000', fontWeight: '600' },
  dayHeader:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.md, marginBottom: spacing.sm },
  dayLabel:    { color: colors.text, fontSize: fontSize.md, fontWeight: '700' },
  daySummary:  { flexDirection: 'row', alignItems: 'center', gap: 4 },
  daySummaryIcon: { fontSize: 14 },
  daySummaryCount: { color: colors.textMuted, fontSize: fontSize.xs, marginLeft: 4 },
  card:        { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, borderLeftWidth: 3 },
  cardTop:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  badge:       { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.full },
  badgeIcon:   { fontSize: 12 },
  badgeLabel:  { fontSize: fontSize.xs, fontWeight: '700' },
  cardTime:    { color: colors.textMuted, fontSize: fontSize.xs },
  cardValue:   { color: colors.textSecondary, fontSize: fontSize.sm, marginBottom: 4 },
  cardValueBold: { fontWeight: '700' },
  cardRaw:     { color: colors.textMuted, fontSize: fontSize.xs, fontStyle: 'italic' },
  empty:       { alignItems: 'center', paddingTop: spacing.xxl },
  emptyIcon:   { fontSize: 48, marginBottom: spacing.md },
  emptyText:   { color: colors.text, fontSize: fontSize.lg, fontWeight: '600' },
  emptySubtext: { color: colors.textSecondary, fontSize: fontSize.sm, textAlign: 'center', marginTop: spacing.xs, paddingHorizontal: spacing.xl },
});
