import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { format, subDays, isAfter } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ExtractedData } from '../types';
import { storage } from '../services/storage';
import { colors, spacing, radius, fontSize } from '../constants/theme';

interface Insight { icon: string; title: string; description: string; color: string; severity: 'positive' | 'warning' | 'neutral' }

function extractHours(value: string): number | null {
  const m = value.match(/(\d+([.,]\d+)?)/);
  return m ? parseFloat(m[1].replace(',', '.')) : null;
}

function generateInsights(data: ExtractedData[]): Insight[] {
  const insights: Insight[] = [];
  const last30 = data.filter((d) => isAfter(d.timestamp, subDays(Date.now(), 30)));

  if (data.length < 3) {
    return [{ icon: '💬', title: 'Continue conversando!', description: 'Com mais dados, vou identificar padrões e te dar insights personalizados. Quanto mais você compartilhar, mais preciso fico.', color: colors.primary, severity: 'neutral' }];
  }

  const sleep = last30.filter((d) => d.category === 'sleep');
  if (sleep.length >= 2) {
    const hours = sleep.map((d) => extractHours(d.value)).filter(Boolean) as number[];
    if (hours.length >= 2) {
      const avg = hours.reduce((a, b) => a + b, 0) / hours.length;
      const min = Math.min(...hours);
      const max = Math.max(...hours);
      insights.push({
        icon: '🌙',
        title: `Sono médio: ${avg.toFixed(1)}h`,
        description: avg < 6
          ? `Você está dormindo muito pouco (entre ${min}h e ${max}h). Sono insuficiente prejudica diretamente a recuperação muscular e o rendimento.`
          : avg < 7.5
          ? `Você dorme entre ${min}h e ${max}h. Está na faixa aceitável, mas tentar atingir 7-8h pode melhorar sua performance.`
          : `Ótimo! Você mantém entre ${min}h e ${max}h de sono. Continue assim — isso é fundamental para a recuperação.`,
        color: avg < 6 ? colors.error : avg < 7.5 ? colors.warning : '#9C7FE8',
        severity: avg < 6 ? 'warning' : avg < 7.5 ? 'neutral' : 'positive',
      });
    }
  }

  const health = last30.filter((d) => d.category === 'health');
  if (health.length >= 2) {
    insights.push({
      icon: '🔍',
      title: `${health.length} ocorrência${health.length > 1 ? 's' : ''} de mal-estar (30d)`,
      description: `Registrei sintomas como: ${[...new Set(health.map((h) => h.label).slice(0, 3))].join(', ')}. Continue reportando para identificarmos o que está causando.`,
      color: colors.error,
      severity: 'warning',
    });
  }

  const nutrition = last30.filter((d) => d.category === 'nutrition');
  if (nutrition.length >= 3) {
    const lateNight = nutrition.filter((d) => {
      const h = new Date(d.timestamp).getHours();
      return h >= 21 || h <= 2;
    });
    if (lateNight.length >= 2) {
      insights.push({
        icon: '🌮',
        title: `${lateNight.length}x refeições tarde da noite`,
        description: 'Comer depois das 21h dificulta a digestão durante o sono e pode afetar a qualidade da recuperação.',
        color: colors.warning,
        severity: 'warning',
      });
    }
  }

  const performance = last30.filter((d) => d.category === 'performance');
  if (performance.length >= 2) {
    const positive = performance.filter((d) => /aumentei|bati|consegui|melhor|record/i.test(d.value + d.label));
    const negative = performance.filter((d) => /não consegui|nao consegui|cansad|fraco|ruim|mal/i.test(d.value + d.label));
    if (positive.length > negative.length) {
      insights.push({ icon: '📈', title: 'Performance em alta!', description: `Você tem mais registros positivos (${positive.length}) do que negativos (${negative.length}) nos últimos 30 dias. Ótimo momento!`, color: colors.primary, severity: 'positive' });
    } else if (negative.length > 0) {
      insights.push({ icon: '📉', title: `${negative.length} sessão(ões) abaixo do esperado`, description: 'Identificamos algumas sessões difíceis. Verifique padrões de sono e alimentação nos dias anteriores.', color: colors.warning, severity: 'warning' });
    }
  }

  const workout = last30.filter((d) => d.category === 'workout');
  if (workout.length >= 4) {
    insights.push({ icon: '🏋️', title: `${workout.length} treinos registrados (30d)`, description: `Média de ${(workout.length / 4.3).toFixed(1)} treinos por semana. ${workout.length >= 12 ? 'Consistência excelente!' : workout.length >= 8 ? 'Bom ritmo!' : 'Tente aumentar a frequência.'}`, color: workout.length >= 12 ? colors.primary : colors.warning, severity: workout.length >= 8 ? 'positive' : 'neutral' });
  }

  return insights;
}

function StatCard({ icon, value, label, color }: { icon: string; value: number; label: string; color: string }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statIcon}>{icon}</Text>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function InsightCard({ insight }: { insight: Insight }) {
  const borderColor = insight.severity === 'positive' ? colors.primary : insight.severity === 'warning' ? colors.warning : colors.border;
  return (
    <View style={[styles.insightCard, { borderLeftColor: borderColor }]}>
      <Text style={styles.insightIcon}>{insight.icon}</Text>
      <View style={{ flex: 1 }}>
        <Text style={[styles.insightTitle, { color: insight.color }]}>{insight.title}</Text>
        <Text style={styles.insightDesc}>{insight.description}</Text>
      </View>
    </View>
  );
}

function WeeklyChart({ data }: { data: ExtractedData[] }) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = subDays(Date.now(), 6 - i);
    const start = new Date(d); start.setHours(0, 0, 0, 0);
    const end = new Date(d); end.setHours(23, 59, 59, 999);
    const count = data.filter((item) => item.timestamp >= start.getTime() && item.timestamp <= end.getTime()).length;
    return { label: format(d, 'EEE', { locale: ptBR }), count };
  });
  const maxCount = Math.max(...days.map((d) => d.count), 1);

  return (
    <View style={styles.weeklyCard}>
      <Text style={styles.weeklyTitle}>Registros nos últimos 7 dias</Text>
      <View style={styles.weeklyBars}>
        {days.map((d, i) => (
          <View key={i} style={styles.weeklyBarCol}>
            <Text style={styles.weeklyBarCount}>{d.count > 0 ? d.count : ''}</Text>
            <View style={styles.weeklyBarTrack}>
              <View style={[styles.weeklyBarFill, { height: `${(d.count / maxCount) * 100}%`, backgroundColor: d.count > 0 ? colors.primary : colors.border }]} />
            </View>
            <Text style={styles.weeklyBarLabel}>{d.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function CategoryRing({ data }: { data: ExtractedData[] }) {
  const categories = [
    { key: 'sleep', icon: '🌙', label: 'Sono', color: '#9C7FE8' },
    { key: 'nutrition', icon: '🥗', label: 'Alimentação', color: '#FF7B7B' },
    { key: 'performance', icon: '🏋️', label: 'Performance', color: '#00C853' },
    { key: 'mood', icon: '😊', label: 'Humor', color: '#FFB300' },
    { key: 'health', icon: '❤️', label: 'Saúde', color: '#FF4081' },
    { key: 'workout', icon: '🔥', label: 'Treino', color: '#FF7043' },
  ];
  const total = data.length;

  return (
    <View style={styles.ringCard}>
      <Text style={styles.weeklyTitle}>Por categoria</Text>
      <View style={styles.ringGrid}>
        {categories.map((c) => {
          const count = data.filter((d) => d.category === c.key).length;
          const pct = total > 0 ? Math.round((count / total) * 100) : 0;
          return (
            <View key={c.key} style={styles.ringItem}>
              <View style={[styles.ringCircle, { borderColor: count > 0 ? c.color : colors.border }]}>
                <Text style={styles.ringIcon}>{c.icon}</Text>
                <Text style={[styles.ringPct, { color: count > 0 ? c.color : colors.textMuted }]}>{pct}%</Text>
              </View>
              <Text style={styles.ringLabel}>{c.label}</Text>
              <Text style={[styles.ringCount, { color: count > 0 ? c.color : colors.textMuted }]}>{count}x</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

export default function InsightsScreen() {
  const [data, setData] = useState<ExtractedData[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => { const d = await storage.getExtractedData(); setData(d); };
  useEffect(() => { load(); }, []);
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const insights = generateInsights(data);
  const last30 = data.filter((d) => isAfter(d.timestamp, subDays(Date.now(), 30)));

  const statsItems = [
    { icon: '📊', value: data.length, label: 'Total', color: colors.text },
    { icon: '🌙', value: data.filter((d) => d.category === 'sleep').length, label: 'Sono', color: '#9C7FE8' },
    { icon: '🥗', value: data.filter((d) => d.category === 'nutrition').length, label: 'Refeições', color: '#FF7B7B' },
    { icon: '🔥', value: data.filter((d) => d.category === 'workout').length, label: 'Treinos', color: '#FF7043' },
  ];

  type ListItem =
    | { type: 'stats' }
    | { type: 'weekly' }
    | { type: 'categories' }
    | { type: 'sectionTitle'; title: string }
    | { type: 'insight'; insight: Insight };

  const listData: ListItem[] = [
    { type: 'stats' },
    { type: 'weekly' },
    { type: 'categories' },
    { type: 'sectionTitle', title: `${insights.length} insight${insights.length !== 1 ? 's' : ''} identificado${insights.length !== 1 ? 's' : ''}` },
    ...insights.map((insight) => ({ type: 'insight' as const, insight })),
  ];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Insights</Text>
        <Text style={styles.subtitle}>Últimos 30 dias · {last30.length} registros</Text>
      </View>
      <FlatList
        data={listData}
        keyExtractor={(item, i) => item.type + i}
        renderItem={({ item }) => {
          if (item.type === 'stats') return (
            <View style={styles.statsRow}>
              {statsItems.map((s) => <StatCard key={s.label} {...s} />)}
            </View>
          );
          if (item.type === 'weekly') return <WeeklyChart data={data} />;
          if (item.type === 'categories') return <CategoryRing data={data} />;
          if (item.type === 'sectionTitle') return <Text style={styles.sectionTitle}>{item.title}</Text>;
          if (item.type === 'insight') return <InsightCard insight={item.insight} />;
          return null;
        }}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: colors.background },
  header:       { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xs },
  title:        { color: colors.text, fontSize: fontSize.xxl, fontWeight: '700' },
  subtitle:     { color: colors.textSecondary, fontSize: fontSize.sm },
  list:         { padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.sm },
  statsRow:     { flexDirection: 'row', gap: spacing.sm },
  statCard:     { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, alignItems: 'center' },
  statIcon:     { fontSize: 20, marginBottom: 4 },
  statValue:    { fontSize: fontSize.xl, fontWeight: '800' },
  statLabel:    { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
  weeklyCard:   { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md },
  weeklyTitle:  { color: colors.textSecondary, fontSize: fontSize.xs, fontWeight: '600', textTransform: 'uppercase', marginBottom: spacing.md },
  weeklyBars:   { flexDirection: 'row', gap: spacing.xs, height: 80, alignItems: 'flex-end' },
  weeklyBarCol: { flex: 1, alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end' },
  weeklyBarCount: { color: colors.textMuted, fontSize: 10 },
  weeklyBarTrack: { width: '100%', height: 60, justifyContent: 'flex-end', backgroundColor: colors.border, borderRadius: radius.sm, overflow: 'hidden' },
  weeklyBarFill:  { width: '100%', borderRadius: radius.sm },
  weeklyBarLabel: { color: colors.textSecondary, fontSize: 10, textTransform: 'capitalize' },
  ringCard:     { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md },
  ringGrid:     { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.xs },
  ringItem:     { width: '28%', alignItems: 'center', gap: 4 },
  ringCircle:   { width: 56, height: 56, borderRadius: radius.full, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  ringIcon:     { fontSize: 18 },
  ringPct:      { fontSize: 9, fontWeight: '700' },
  ringLabel:    { color: colors.textSecondary, fontSize: 10, textAlign: 'center' },
  ringCount:    { fontSize: fontSize.sm, fontWeight: '700' },
  sectionTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '700', marginTop: spacing.sm },
  insightCard:  { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, gap: spacing.md, borderLeftWidth: 3 },
  insightIcon:  { fontSize: 28, marginTop: 2 },
  insightTitle: { fontSize: fontSize.md, fontWeight: '700', marginBottom: spacing.xs },
  insightDesc:  { color: colors.textSecondary, fontSize: fontSize.sm, lineHeight: 20 },
});
