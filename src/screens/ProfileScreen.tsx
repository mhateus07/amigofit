import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { UserProfile, AIProvider } from '../types';
import { storage, getProvider, saveProvider } from '../services/storage';
import { reprocessHistory } from '../services/reprocess';
import { colors, spacing, radius, fontSize } from '../constants/theme';

const PROVIDER_INFO: Record<AIProvider, { label: string; icon: string; prefix: string; hint: string; model: string }> = {
  anthropic: { label: 'Anthropic', icon: '🟣', prefix: 'sk-ant-', hint: 'console.anthropic.com', model: 'Claude Sonnet' },
  openai:    { label: 'OpenAI',    icon: '🟢', prefix: 'sk-',     hint: 'platform.openai.com',  model: 'GPT-4o' },
  groq:      { label: 'Groq',      icon: '⚡',  prefix: 'gsk_',    hint: 'console.groq.com',     model: 'Llama 3.3 70B' },
  gemini:    { label: 'Gemini',    icon: '🔵', prefix: 'AIza',    hint: 'aistudio.google.com',  model: 'Gemini 1.5 Flash' },
};

const PROVIDERS = Object.keys(PROVIDER_INFO) as AIProvider[];

interface Props {
  profile: UserProfile | null;
  authUser: { id: string; name: string; email: string } | null;
  onProfileUpdate: (profile: UserProfile) => void;
  onLogout: () => void;
}

const GOALS = [
  { value: 'hypertrophy', label: 'Hipertrofia' },
  { value: 'weight_loss', label: 'Emagrecimento' },
  { value: 'conditioning', label: 'Condicionamento' },
  { value: 'health', label: 'Saúde geral' },
] as const;

const LEVELS = [
  { value: 'beginner', label: 'Iniciante' },
  { value: 'intermediate', label: 'Intermediário' },
  { value: 'advanced', label: 'Avançado' },
] as const;

function SectionHeader({ title }: { title: string }) {
  return <Text style={styles.sectionTitle}>{title}</Text>;
}

function Counter({
  label, value, onChange, unit, min = 1, max = 99,
}: {
  label: string; value: number; onChange: (v: number) => void; unit: string; min?: number; max?: number;
}) {
  return (
    <View style={styles.counterRow}>
      <Text style={styles.counterLabel}>{label}</Text>
      <View style={styles.counterControls}>
        <TouchableOpacity style={styles.counterBtn} onPress={() => onChange(Math.max(min, value - 1))}>
          <Text style={styles.counterBtnText}>−</Text>
        </TouchableOpacity>
        <Text style={styles.counterValue}>{value}<Text style={styles.counterUnit}> {unit}</Text></Text>
        <TouchableOpacity style={styles.counterBtn} onPress={() => onChange(Math.min(max, value + 1))}>
          <Text style={styles.counterBtnText}>+</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function ProfileScreen({ profile, authUser, onProfileUpdate, onLogout }: Props) {
  const [name, setName] = useState(profile?.name ?? '');
  const [goal, setGoal] = useState<UserProfile['goal']>(profile?.goal ?? 'health');
  const [level, setLevel] = useState<UserProfile['level']>(profile?.level ?? 'beginner');
  const [age, setAge] = useState(profile?.age?.toString() ?? '');
  const [weight, setWeight] = useState(profile?.weight?.toString() ?? '');
  const [height, setHeight] = useState(profile?.height?.toString() ?? '');
  const [weeklyWorkoutGoal, setWeeklyWorkoutGoal] = useState(profile?.weeklyWorkoutGoal ?? 3);
  const [sleepGoal, setSleepGoal] = useState(profile?.sleepGoal ?? 8);

  // Provider & keys
  const [provider, setProvider] = useState<AIProvider>('anthropic');
  const [providerKeys, setProviderKeys] = useState<Record<AIProvider, string>>({
    anthropic: '', openai: '', gemini: '', groq: '',
  });
  const [editingKey, setEditingKey] = useState('');
  const [showKeyInput, setShowKeyInput] = useState(false);

  const [reprocessing, setReprocessing] = useState(false);
  const [reprocessProgress, setReprocessProgress] = useState('');

  useEffect(() => {
    (async () => {
      const p = await getProvider();
      setProvider(p);
      const [k1, k2, k3, k4] = await Promise.all([
        storage.getApiKey('anthropic'),
        storage.getApiKey('openai'),
        storage.getApiKey('gemini'),
        storage.getApiKey('groq'),
      ]);
      setProviderKeys({ anthropic: k1 ?? '', openai: k2 ?? '', gemini: k3 ?? '', groq: k4 ?? '' });
    })();
  }, []);

  const handleProviderChange = async (p: AIProvider) => {
    setProvider(p);
    await saveProvider(p);
    setShowKeyInput(false);
    setEditingKey('');
  };

  const saveProviderKey = async () => {
    const key = editingKey.trim();
    const info = PROVIDER_INFO[provider];
    if (!key || !key.startsWith(info.prefix)) {
      Alert.alert('Chave inválida', `A chave deve começar com "${info.prefix}". Acesse ${info.hint}`);
      return;
    }
    await Promise.all([storage.saveApiKey(key, provider), saveProvider(provider)]);
    setProviderKeys(prev => ({ ...prev, [provider]: key }));
    setEditingKey('');
    setShowKeyInput(false);
    Alert.alert('Chave salva!', `${info.label} configurado com ${info.model}.`);
  };

  const handleReprocess = async () => {
    const hasKey = await storage.hasAnyApiKey();
    if (!hasKey) {
      Alert.alert('Chave não configurada', 'Configure a chave de um provedor de IA primeiro.');
      return;
    }
    setReprocessing(true);
    setReprocessProgress('Iniciando...');
    try {
      const result = await reprocessHistory((current, total) => {
        setReprocessProgress(`Processando ${current}/${total} mensagens...`);
      });
      if (result.error) {
        Alert.alert('Servidor offline', result.error);
      } else if (result.processed === 0) {
        Alert.alert('Tudo atualizado', 'Todas as mensagens já foram processadas.');
      } else {
        Alert.alert('Concluído!', `${result.processed} mensagem(s) analisada(s).\n${result.dataPoints} dado(s) salvo(s) no Diário e Insights.`);
      }
    } catch {
      Alert.alert('Erro', 'Não foi possível reprocessar o histórico.');
    } finally {
      setReprocessing(false);
      setReprocessProgress('');
    }
  };

  const handleLogout = () => {
    Alert.alert('Sair', 'Tem certeza que deseja sair da sua conta?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Sair', style: 'destructive', onPress: onLogout },
    ]);
  };

  const saveProfile = async () => {
    if (!name.trim()) {
      Alert.alert('Nome obrigatório', 'Por favor, insira seu nome.');
      return;
    }
    const updated: UserProfile = {
      name: name.trim(),
      goal,
      level,
      age: age ? parseInt(age, 10) : undefined,
      weight: weight ? parseFloat(weight) : undefined,
      height: height ? parseInt(height, 10) : undefined,
      weeklyWorkoutGoal,
      sleepGoal,
      notificationEnabled: false,
      notificationTime: '07:00',
      onboardingComplete: true,
    };
    await storage.saveProfile(updated);
    onProfileUpdate(updated);
    Alert.alert('Salvo!', 'Perfil atualizado com sucesso.');
  };

  const activeProviderKey = providerKeys[provider];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Perfil</Text>

        {/* Conta */}
        {authUser && (
          <View style={styles.section}>
            <View style={styles.userRow}>
              <View style={styles.userAvatar}>
                <Text style={styles.userAvatarText}>{authUser.name.charAt(0).toUpperCase()}</Text>
              </View>
              <View style={styles.userInfo}>
                <Text style={styles.userName}>{authUser.name}</Text>
                <Text style={styles.userEmail}>{authUser.email}</Text>
              </View>
            </View>
            <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
              <Text style={styles.logoutBtnText}>Sair da conta</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Configuração da IA */}
        <View style={styles.section}>
          <SectionHeader title="Configuração da IA" />
          <Text style={styles.sectionDesc}>Escolha o provedor e configure sua chave de API.</Text>

          {/* Provider selector */}
          <View style={styles.providerGrid}>
            {PROVIDERS.map((p) => {
              const info = PROVIDER_INFO[p];
              const hasKey = !!providerKeys[p];
              const isActive = provider === p;
              return (
                <TouchableOpacity
                  key={p}
                  style={[styles.providerCard, isActive && styles.providerCardActive]}
                  onPress={() => handleProviderChange(p)}
                  activeOpacity={0.75}
                >
                  <Text style={styles.providerIcon}>{info.icon}</Text>
                  <Text style={[styles.providerLabel, isActive && styles.providerLabelActive]}>
                    {info.label}
                  </Text>
                  {hasKey && <Text style={styles.providerCheck}>✓</Text>}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Key for selected provider */}
          {activeProviderKey && !showKeyInput ? (
            <>
              <View style={styles.apiKeyActive}>
                <Text style={styles.apiKeyActiveIcon}>✓</Text>
                <View>
                  <Text style={styles.apiKeyActiveText}>{PROVIDER_INFO[provider].label} configurado</Text>
                  <Text style={styles.apiKeyActiveModel}>{PROVIDER_INFO[provider].model}</Text>
                </View>
              </View>
              <TouchableOpacity onPress={() => setShowKeyInput(true)} style={styles.changeKeyBtn}>
                <Text style={styles.changeKeyText}>Alterar chave</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.label}>
                Chave da API — {PROVIDER_INFO[provider].label}
              </Text>
              <Text style={styles.providerHint}>Acesse: {PROVIDER_INFO[provider].hint}</Text>
              <View style={styles.apiKeyRow}>
                <TextInput
                  style={styles.apiInput}
                  value={editingKey}
                  onChangeText={setEditingKey}
                  placeholder={`${PROVIDER_INFO[provider].prefix}...`}
                  placeholderTextColor={colors.textMuted}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TouchableOpacity style={styles.saveKeyBtn} onPress={saveProviderKey}>
                  <Text style={styles.saveKeyBtnText}>Salvar</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>

        {/* Dados pessoais */}
        <View style={styles.section}>
          <SectionHeader title="Seus dados" />
          <Text style={styles.label}>Nome</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Como devo te chamar?"
            placeholderTextColor={colors.textMuted}
          />

          <Text style={styles.label}>Objetivo</Text>
          <View style={styles.optionRow}>
            {GOALS.map((g) => (
              <TouchableOpacity
                key={g.value}
                style={[styles.optionBtn, goal === g.value && styles.optionBtnActive]}
                onPress={() => setGoal(g.value)}
              >
                <Text style={[styles.optionText, goal === g.value && styles.optionTextActive]}>
                  {g.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Nível</Text>
          <View style={styles.optionRow}>
            {LEVELS.map((l) => (
              <TouchableOpacity
                key={l.value}
                style={[styles.optionBtn, level === l.value && styles.optionBtnActive]}
                onPress={() => setLevel(l.value)}
              >
                <Text style={[styles.optionText, level === l.value && styles.optionTextActive]}>
                  {l.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Medidas corporais */}
        <View style={styles.section}>
          <SectionHeader title="Medidas corporais" />
          <Text style={styles.sectionDesc}>Usadas pela IA para personalizar as recomendações.</Text>
          <View style={styles.measuresRow}>
            <View style={styles.measureField}>
              <Text style={styles.label}>Idade</Text>
              <TextInput style={styles.inputSmall} value={age} onChangeText={setAge}
                placeholder="—" placeholderTextColor={colors.textMuted} keyboardType="number-pad" maxLength={3} />
              <Text style={styles.measureUnit}>anos</Text>
            </View>
            <View style={styles.measureField}>
              <Text style={styles.label}>Peso</Text>
              <TextInput style={styles.inputSmall} value={weight} onChangeText={setWeight}
                placeholder="—" placeholderTextColor={colors.textMuted} keyboardType="decimal-pad" maxLength={5} />
              <Text style={styles.measureUnit}>kg</Text>
            </View>
            <View style={styles.measureField}>
              <Text style={styles.label}>Altura</Text>
              <TextInput style={styles.inputSmall} value={height} onChangeText={setHeight}
                placeholder="—" placeholderTextColor={colors.textMuted} keyboardType="number-pad" maxLength={3} />
              <Text style={styles.measureUnit}>cm</Text>
            </View>
          </View>
        </View>

        {/* Metas fitness */}
        <View style={styles.section}>
          <SectionHeader title="Metas fitness" />
          <Text style={styles.sectionDesc}>Aparece como barra de progresso na tela de Insights.</Text>
          <Counter label="Treinos por semana" value={weeklyWorkoutGoal} onChange={setWeeklyWorkoutGoal} unit="treinos" min={1} max={14} />
          <Counter label="Meta de sono" value={sleepGoal} onChange={setSleepGoal} unit="h/noite" min={4} max={12} />
        </View>

        {/* Notificações */}
        <View style={styles.section}>
          <SectionHeader title="Lembrete de treino" />
          <Text style={styles.sectionDesc}>
            Lembretes diários estarão disponíveis na versão completa do app.
          </Text>
          <View style={styles.comingSoonBadge}>
            <Text style={styles.comingSoonText}>Em breve</Text>
          </View>
        </View>

        {/* Botão salvar */}
        <TouchableOpacity style={styles.saveBtn} onPress={saveProfile}>
          <Text style={styles.saveBtnText}>Salvar perfil</Text>
        </TouchableOpacity>

        {/* Reprocessar histórico */}
        <View style={styles.section}>
          <SectionHeader title="Histórico de conversas" />
          <Text style={styles.sectionDesc}>
            Processa todas as mensagens antigas e extrai dados relevantes para o Diário e Insights.
          </Text>
          <TouchableOpacity
            style={[styles.reprocessBtn, reprocessing && styles.reprocessBtnDisabled]}
            onPress={handleReprocess}
            disabled={reprocessing}
          >
            {reprocessing ? (
              <View style={styles.reprocessRow}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={styles.reprocessBtnText}>{reprocessProgress}</Text>
              </View>
            ) : (
              <Text style={styles.reprocessBtnText}>Processar histórico agora</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.md, paddingBottom: spacing.xxl },
  title: { color: colors.text, fontSize: fontSize.xxl, fontWeight: '700', marginBottom: spacing.lg },
  section: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  sectionTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700', marginBottom: spacing.xs },
  sectionDesc: { color: colors.textSecondary, fontSize: fontSize.sm, lineHeight: 20, marginBottom: spacing.md },

  // Provider selector
  providerGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  providerCard: {
    flex: 1, minWidth: '45%', alignItems: 'center', paddingVertical: spacing.md,
    backgroundColor: colors.surfaceElevated, borderRadius: radius.md,
    borderWidth: 1.5, borderColor: colors.border, gap: 4,
  },
  providerCardActive: { borderColor: colors.primary, backgroundColor: 'rgba(0,200,83,0.06)' },
  providerIcon: { fontSize: 20 },
  providerLabel: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: '600' },
  providerLabelActive: { color: colors.primary },
  providerCheck: { color: colors.primary, fontSize: 10, fontWeight: '700' },
  providerHint: { color: colors.textMuted, fontSize: fontSize.xs, marginBottom: spacing.sm },

  // API key
  apiKeyRow: { flexDirection: 'row', gap: spacing.sm },
  apiInput: {
    flex: 1, backgroundColor: colors.surfaceElevated, borderRadius: radius.md,
    padding: spacing.sm, color: colors.text, fontSize: fontSize.sm,
    borderWidth: 1, borderColor: colors.border,
  },
  saveKeyBtn: {
    backgroundColor: colors.primary, borderRadius: radius.md,
    paddingHorizontal: spacing.md, justifyContent: 'center',
  },
  saveKeyBtnText: { color: '#000', fontWeight: '700' },
  apiKeyActive: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: 'rgba(0,200,83,0.1)', borderRadius: radius.md, padding: spacing.sm,
  },
  apiKeyActiveIcon: { color: colors.primary, fontSize: fontSize.lg, fontWeight: '700' },
  apiKeyActiveText: { color: colors.primary, fontWeight: '600' },
  apiKeyActiveModel: { color: 'rgba(0,200,83,0.7)', fontSize: fontSize.xs },
  changeKeyBtn: { marginTop: spacing.sm },
  changeKeyText: { color: colors.textSecondary, fontSize: fontSize.sm, textDecorationLine: 'underline' },

  label: { color: colors.textSecondary, fontSize: fontSize.sm, marginTop: spacing.md, marginBottom: spacing.xs },
  input: {
    backgroundColor: colors.surfaceElevated, borderRadius: radius.md,
    padding: spacing.md, color: colors.text, fontSize: fontSize.md,
    borderWidth: 1, borderColor: colors.border,
  },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  optionBtn: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.full, backgroundColor: colors.surfaceElevated,
    borderWidth: 1, borderColor: colors.border,
  },
  optionBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  optionText: { color: colors.textSecondary, fontSize: fontSize.sm },
  optionTextActive: { color: '#000', fontWeight: '700' },

  // Medidas
  measuresRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xs },
  measureField: { flex: 1, alignItems: 'center' },
  inputSmall: {
    backgroundColor: colors.surfaceElevated, borderRadius: radius.md,
    padding: spacing.sm, color: colors.text, fontSize: fontSize.lg,
    borderWidth: 1, borderColor: colors.border,
    textAlign: 'center', width: '100%', fontWeight: '700',
  },
  measureUnit: { color: colors.textMuted, fontSize: fontSize.xs, marginTop: 4 },

  // Counter
  counterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  counterLabel: { color: colors.text, fontSize: fontSize.md, flex: 1 },
  counterControls: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  counterBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  counterBtnText: { color: colors.text, fontSize: fontSize.lg, fontWeight: '600', lineHeight: 22 },
  counterValue: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700', minWidth: 60, textAlign: 'center' },
  counterUnit: { color: colors.textSecondary, fontSize: fontSize.xs, fontWeight: '400' },

  // Notificações (em breve)
  comingSoonBadge: {
    alignSelf: 'flex-start', backgroundColor: colors.surfaceElevated,
    borderRadius: radius.full, paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs, borderWidth: 1, borderColor: colors.border,
  },
  comingSoonText: { color: colors.textMuted, fontSize: fontSize.sm, fontWeight: '600' },

  // Save
  saveBtn: {
    backgroundColor: colors.primary, borderRadius: radius.md,
    padding: spacing.md, alignItems: 'center', marginBottom: spacing.md,
  },
  saveBtnText: { color: '#000', fontSize: fontSize.md, fontWeight: '700' },

  reprocessBtn: {
    backgroundColor: colors.surfaceElevated, borderRadius: radius.md,
    padding: spacing.md, alignItems: 'center',
    borderWidth: 1, borderColor: colors.primary,
  },
  reprocessBtnDisabled: { borderColor: colors.border, opacity: 0.6 },
  reprocessBtnText: { color: colors.primary, fontSize: fontSize.md, fontWeight: '600' },
  reprocessRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  userRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
  userAvatar: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
  },
  userAvatarText: { color: '#000', fontSize: fontSize.lg, fontWeight: '700' },
  userInfo: { flex: 1 },
  userName: { color: colors.text, fontSize: fontSize.md, fontWeight: '700' },
  userEmail: { color: colors.textSecondary, fontSize: fontSize.sm, marginTop: 2 },
  logoutBtn: {
    borderRadius: radius.md, padding: spacing.sm, alignItems: 'center',
    borderWidth: 1, borderColor: colors.error,
  },
  logoutBtnText: { color: colors.error, fontSize: fontSize.sm, fontWeight: '600' },
});
