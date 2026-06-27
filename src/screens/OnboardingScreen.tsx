import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { UserProfile, AIProvider } from '../types';
import { storage, saveProvider } from '../services/storage';
import { colors, spacing, radius, fontSize } from '../constants/theme';

const PROVIDERS: { value: AIProvider; label: string; icon: string; prefix: string; hint: string }[] = [
  { value: 'anthropic', label: 'Anthropic', icon: '🟣', prefix: 'sk-ant-', hint: 'console.anthropic.com' },
  { value: 'openai',    label: 'OpenAI',    icon: '🟢', prefix: 'sk-',     hint: 'platform.openai.com' },
  { value: 'groq',      label: 'Groq',      icon: '⚡',  prefix: 'gsk_',    hint: 'console.groq.com' },
  { value: 'gemini',    label: 'Gemini',    icon: '🔵', prefix: 'AIza',    hint: 'aistudio.google.com' },
];

interface Props {
  authUser: { id: string; name: string; email: string };
  onComplete: (profile: UserProfile, apiKey: string) => void;
}

const GOALS: { value: UserProfile['goal']; label: string; icon: string; desc: string }[] = [
  { value: 'hypertrophy',  label: 'Hipertrofia',      icon: '💪', desc: 'Ganhar massa muscular' },
  { value: 'weight_loss',  label: 'Emagrecer',         icon: '🔥', desc: 'Perder gordura' },
  { value: 'conditioning', label: 'Condicionamento',   icon: '🏃', desc: 'Melhorar o cardio' },
  { value: 'health',       label: 'Saúde geral',       icon: '❤️', desc: 'Bem-estar e qualidade de vida' },
];

const LEVELS: { value: UserProfile['level']; label: string; desc: string }[] = [
  { value: 'beginner',     label: 'Iniciante',     desc: 'Menos de 1 ano' },
  { value: 'intermediate', label: 'Intermediário', desc: '1 a 3 anos' },
  { value: 'advanced',     label: 'Avançado',      desc: 'Mais de 3 anos' },
];

export default function OnboardingScreen({ authUser, onComplete }: Props) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState(authUser.name.split(' ')[0]);
  const [goal, setGoal] = useState<UserProfile['goal']>('hypertrophy');
  const [level, setLevel] = useState<UserProfile['level']>('beginner');
  const [selectedProvider, setSelectedProvider] = useState<AIProvider>('anthropic');
  const [apiKey, setApiKey] = useState('');
  const [keyError, setKeyError] = useState('');
  const [saving, setSaving] = useState(false);

  const providerInfo = PROVIDERS.find(p => p.value === selectedProvider)!;

  const saveAndComplete = async (key: string) => {
    setSaving(true);
    const profile: UserProfile = {
      name: name.trim() || authUser.name,
      goal,
      level,
      onboardingComplete: true,
    };
    const ops: Promise<void>[] = [storage.saveProfile(profile)];
    if (key) {
      ops.push(storage.saveApiKey(key, selectedProvider));
      ops.push(saveProvider(selectedProvider));
    }
    await Promise.all(ops);
    onComplete(profile, key);
  };

  const handleFinish = async () => {
    setKeyError('');
    if (!apiKey.trim()) {
      setKeyError('Cole sua chave para continuar, ou toque em "Configurar depois".');
      return;
    }
    if (!apiKey.trim().startsWith(providerInfo.prefix)) {
      setKeyError(`Chave inválida para ${providerInfo.label}. Deve começar com "${providerInfo.prefix}". Acesse ${providerInfo.hint}`);
      return;
    }
    await saveAndComplete(apiKey.trim());
  };

  const handleSkip = async () => {
    await saveAndComplete('');
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Top bar: back + progress */}
      <View style={styles.topBar}>
        {step > 0 ? (
          <TouchableOpacity style={styles.backBtn} onPress={() => setStep(step - 1)}>
            <Text style={styles.backBtnText}>← Voltar</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.backBtn} />
        )}
        <View style={styles.progress}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={[styles.dot, step >= i && styles.dotActive]} />
          ))}
        </View>
        <View style={styles.backBtn} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── Step 0: Nome ── */}
          {step === 0 && (
            <View>
              <Text style={styles.emoji}>👋</Text>
              <Text style={styles.stepTitle}>Olá, {authUser.name.split(' ')[0]}!</Text>
              <Text style={styles.stepDesc}>
                Vou te conhecer melhor para dar respostas mais personalizadas sobre treino e saúde.
              </Text>

              <Text style={styles.label}>Como devo te chamar?</Text>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder="Seu nome"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="words"
                returnKeyType="done"
              />

              <TouchableOpacity style={styles.primaryBtn} onPress={() => setStep(1)}>
                <Text style={styles.primaryBtnText}>Continuar →</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ── Step 1: Objetivo + Nível ── */}
          {step === 1 && (
            <View>
              <Text style={styles.emoji}>🎯</Text>
              <Text style={styles.stepTitle}>Sobre você</Text>
              <Text style={styles.stepDesc}>
                Isso me ajuda a personalizar dicas e adaptar sugestões ao seu perfil.
              </Text>

              <Text style={styles.label}>Qual é o seu objetivo?</Text>
              {GOALS.map((g) => (
                <TouchableOpacity
                  key={g.value}
                  style={[styles.goalCard, goal === g.value && styles.goalCardActive]}
                  onPress={() => setGoal(g.value)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.goalIcon}>{g.icon}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.goalLabel, goal === g.value && styles.goalLabelActive]}>
                      {g.label}
                    </Text>
                    <Text style={styles.goalDesc}>{g.desc}</Text>
                  </View>
                  {goal === g.value && <Text style={styles.checkmark}>✓</Text>}
                </TouchableOpacity>
              ))}

              <Text style={[styles.label, { marginTop: spacing.lg }]}>Nível de experiência</Text>
              <View style={styles.levelRow}>
                {LEVELS.map((l) => (
                  <TouchableOpacity
                    key={l.value}
                    style={[styles.levelBtn, level === l.value && styles.levelBtnActive]}
                    onPress={() => setLevel(l.value)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.levelLabel, level === l.value && styles.levelLabelActive]}>
                      {l.label}
                    </Text>
                    <Text style={[styles.levelDesc, level === l.value && styles.levelDescActive]}>
                      {l.desc}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TouchableOpacity style={styles.primaryBtn} onPress={() => setStep(2)}>
                <Text style={styles.primaryBtnText}>Continuar →</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ── Step 2: API Key ── */}
          {step === 2 && (
            <View>
              <Text style={styles.emoji}>🤖</Text>
              <Text style={styles.stepTitle}>Ativar a IA</Text>
              <Text style={styles.stepDesc}>
                Escolha seu provedor de IA e adicione a chave. É gratuito criar conta — você só paga pelo uso.
              </Text>

              {/* Provider selector */}
              <Text style={styles.label}>Provedor de IA</Text>
              <View style={styles.providerRow}>
                {PROVIDERS.map((p) => (
                  <TouchableOpacity
                    key={p.value}
                    style={[styles.providerBtn, selectedProvider === p.value && styles.providerBtnActive]}
                    onPress={() => { setSelectedProvider(p.value); setApiKey(''); setKeyError(''); }}
                    activeOpacity={0.75}
                  >
                    <Text style={styles.providerBtnIcon}>{p.icon}</Text>
                    <Text style={[styles.providerBtnLabel, selectedProvider === p.value && styles.providerBtnLabelActive]}>
                      {p.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={styles.instructionBox}>
                <Text style={styles.instructionTitle}>Como obter sua chave ({providerInfo.label}):</Text>
                <Text style={styles.instructionStep}>1. Acesse {providerInfo.hint}</Text>
                <Text style={styles.instructionStep}>2. Crie uma conta (gratuita)</Text>
                <Text style={styles.instructionStep}>3. Crie uma API Key e cole abaixo</Text>
              </View>

              <Text style={styles.label}>Chave da API ({providerInfo.label})</Text>
              <TextInput
                style={[styles.input, !!keyError && styles.inputError]}
                value={apiKey}
                onChangeText={(t) => { setApiKey(t); setKeyError(''); }}
                placeholder={`${providerInfo.prefix}...`}
                placeholderTextColor={colors.textMuted}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
              />
              {!!keyError && <Text style={styles.errorText}>{keyError}</Text>}

              <TouchableOpacity
                style={[styles.primaryBtn, saving && styles.primaryBtnDisabled]}
                onPress={handleFinish}
                disabled={saving}
              >
                <Text style={styles.primaryBtnText}>{saving ? 'Salvando...' : 'Começar! 💪'}</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.skipBtn} onPress={handleSkip} disabled={saving}>
                <Text style={styles.skipBtnText}>Configurar depois (nas configurações)</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: colors.background },
  topBar:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  progress:     { flexDirection: 'row', gap: spacing.xs },
  dot:          { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border },
  dotActive:    { width: 28, backgroundColor: colors.primary },
  scroll:       { flexGrow: 1, padding: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xxl },
  emoji:        { fontSize: 52, marginBottom: spacing.md },
  stepTitle:    { color: colors.text, fontSize: fontSize.xxxl, fontWeight: '800', marginBottom: spacing.sm },
  stepDesc:     { color: colors.textSecondary, fontSize: fontSize.md, lineHeight: 24, marginBottom: spacing.xl },
  label:        { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: '600', marginBottom: spacing.sm },
  input:        {
    backgroundColor: colors.surface, borderRadius: radius.md,
    padding: spacing.md, color: colors.text, fontSize: fontSize.md,
    borderWidth: 1.5, borderColor: colors.border, marginBottom: spacing.sm,
  },
  inputError:   { borderColor: colors.error },
  errorText:    { color: colors.error, fontSize: fontSize.sm, marginBottom: spacing.md },
  goalCard:     {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surface, borderRadius: radius.lg,
    padding: spacing.md, marginBottom: spacing.sm,
    borderWidth: 1.5, borderColor: colors.border,
  },
  goalCardActive:  { borderColor: colors.primary, backgroundColor: 'rgba(0,200,83,0.06)' },
  goalIcon:        { fontSize: 28 },
  goalLabel:       { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
  goalLabelActive: { color: colors.primary },
  goalDesc:        { color: colors.textMuted, fontSize: fontSize.sm, marginTop: 2 },
  checkmark:       { color: colors.primary, fontSize: fontSize.lg, fontWeight: '700' },
  levelRow:        { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  levelBtn:        {
    flex: 1, alignItems: 'center', paddingVertical: spacing.md, paddingHorizontal: spacing.sm,
    backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: 1.5, borderColor: colors.border,
  },
  levelBtnActive:  { borderColor: colors.primary, backgroundColor: 'rgba(0,200,83,0.06)' },
  levelLabel:      { color: colors.text, fontSize: fontSize.sm, fontWeight: '700' },
  levelLabelActive: { color: colors.primary },
  levelDesc:       { color: colors.textMuted, fontSize: 10, marginTop: 3, textAlign: 'center' },
  levelDescActive: { color: 'rgba(0,200,83,0.7)' },
  instructionBox:  {
    backgroundColor: colors.surface, borderRadius: radius.md,
    padding: spacing.md, marginBottom: spacing.lg,
    borderLeftWidth: 3, borderLeftColor: colors.primary,
  },
  instructionTitle: { color: colors.text, fontSize: fontSize.sm, fontWeight: '700', marginBottom: spacing.sm },
  instructionStep:  { color: colors.textSecondary, fontSize: fontSize.sm, lineHeight: 22 },
  primaryBtn:      {
    backgroundColor: colors.primary, borderRadius: radius.md,
    padding: spacing.md, alignItems: 'center', marginTop: spacing.lg,
  },
  primaryBtnDisabled: { opacity: 0.6 },
  primaryBtnText:  { color: '#000', fontSize: fontSize.md, fontWeight: '700' },
  skipBtn:         { alignItems: 'center', paddingVertical: spacing.lg },
  skipBtnText:     { color: colors.textMuted, fontSize: fontSize.sm },
  backBtn:         { minWidth: 70, padding: spacing.xs },
  backBtnText:     { color: colors.textSecondary, fontSize: fontSize.sm },

  // Provider selector (onboarding step 2)
  providerRow:     { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  providerBtn:     {
    flex: 1, minWidth: '45%', alignItems: 'center', paddingVertical: spacing.sm,
    backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: 1.5, borderColor: colors.border, gap: 2,
  },
  providerBtnActive: { borderColor: colors.primary, backgroundColor: 'rgba(0,200,83,0.06)' },
  providerBtnIcon:  { fontSize: 18 },
  providerBtnLabel: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: '600' },
  providerBtnLabelActive: { color: colors.primary },
});
