import React, { useState } from 'react';
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
import { UserProfile } from '../types';
import { storage } from '../services/storage';
import { reprocessHistory } from '../services/reprocess';
import { colors, spacing, radius, fontSize } from '../constants/theme';



interface Props {
  profile: UserProfile | null;
  authUser: { id: string; name: string; email: string } | null;
  onProfileUpdate: (profile: UserProfile) => void;
  onApiKeySet: (key: string) => Promise<void>;
  hasApiKey: boolean;
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

export default function ProfileScreen({ profile, authUser, onProfileUpdate, onApiKeySet, hasApiKey, onLogout }: Props) {
  const [name, setName] = useState(profile?.name ?? '');
  const [goal, setGoal] = useState<UserProfile['goal']>(profile?.goal ?? 'health');
  const [level, setLevel] = useState<UserProfile['level']>(profile?.level ?? 'beginner');
  const [apiKey, setApiKey] = useState('');
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);
  const [reprocessProgress, setReprocessProgress] = useState('');

  const handleReprocess = async () => {
    const key = await storage.getApiKey();
    if (!key) {
      Alert.alert('Chave não configurada', 'Configure a chave da API Anthropic primeiro.');
      return;
    }
    setReprocessing(true);
    setReprocessProgress('Iniciando...');
    try {
      const result = await reprocessHistory(key, (current, total) => {
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
      onboardingComplete: true,
    };
    await storage.saveProfile(updated);
    onProfileUpdate(updated);
    Alert.alert('Salvo!', 'Perfil atualizado com sucesso.');
  };

  const saveApiKey = async () => {
    if (!apiKey.trim() || !apiKey.startsWith('sk-ant-')) {
      Alert.alert('Chave inválida', 'A chave deve começar com "sk-ant-". Verifique em console.anthropic.com');
      return;
    }
    await onApiKeySet(apiKey.trim());
    setApiKey('');
    setShowKeyInput(false);
    Alert.alert('Chave salva!', 'A IA já está pronta para conversar.');
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Perfil</Text>

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

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Configuração da IA</Text>
          <Text style={styles.sectionDesc}>
            Para ativar o AmigoFit, você precisa de uma chave da API Anthropic.{'\n'}
            Acesse: console.anthropic.com → API Keys
          </Text>
          {hasApiKey && !showKeyInput ? (
            <>
              <View style={styles.apiKeyActive}>
                <Text style={styles.apiKeyActiveIcon}>✓</Text>
                <Text style={styles.apiKeyActiveText}>IA configurada e ativa</Text>
              </View>
              <TouchableOpacity onPress={() => setShowKeyInput(true)} style={styles.changeKeyBtn}>
                <Text style={styles.changeKeyText}>Alterar chave</Text>
              </TouchableOpacity>
            </>
          ) : (
            <View style={styles.apiKeyRow}>
              <TextInput
                style={styles.apiInput}
                value={apiKey}
                onChangeText={setApiKey}
                placeholder="sk-ant-..."
                placeholderTextColor={colors.textMuted}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity style={styles.saveKeyBtn} onPress={saveApiKey}>
                <Text style={styles.saveKeyBtnText}>Salvar</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Seus dados</Text>

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

          <TouchableOpacity style={styles.saveBtn} onPress={saveProfile}>
            <Text style={styles.saveBtnText}>Salvar Perfil</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Histórico de conversas</Text>
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
  apiKeyRow: { flexDirection: 'row', gap: spacing.sm },
  apiInput: {
    flex: 1,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.md,
    padding: spacing.sm,
    color: colors.text,
    fontSize: fontSize.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  saveKeyBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
  },
  saveKeyBtnText: { color: '#000', fontWeight: '700' },
  apiKeyActive: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: 'rgba(0,200,83,0.1)',
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  apiKeyActiveIcon: { color: colors.primary, fontSize: fontSize.lg, fontWeight: '700' },
  apiKeyActiveText: { color: colors.primary, fontWeight: '600' },
  changeKeyBtn: { marginTop: spacing.sm },
  changeKeyText: { color: colors.textSecondary, fontSize: fontSize.sm, textDecorationLine: 'underline' },
  label: { color: colors.textSecondary, fontSize: fontSize.sm, marginTop: spacing.md, marginBottom: spacing.xs },
  input: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.md,
    padding: spacing.md,
    color: colors.text,
    fontSize: fontSize.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  optionBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  optionBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  optionText: { color: colors.textSecondary, fontSize: fontSize.sm },
  optionTextActive: { color: '#000', fontWeight: '700' },
  saveBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  saveBtnText: { color: '#000', fontSize: fontSize.md, fontWeight: '700' },
  reprocessBtn: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.primary,
  },
  reprocessBtnDisabled: { borderColor: colors.border, opacity: 0.6 },
  reprocessBtnText: { color: colors.primary, fontSize: fontSize.md, fontWeight: '600' },
  reprocessRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  userRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
  userAvatar: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  userAvatarText: { color: '#000', fontSize: fontSize.lg, fontWeight: '700' },
  userInfo: { flex: 1 },
  userName: { color: colors.text, fontSize: fontSize.md, fontWeight: '700' },
  userEmail: { color: colors.textSecondary, fontSize: fontSize.sm, marginTop: 2 },
  logoutBtn: {
    borderRadius: radius.md,
    padding: spacing.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.error,
  },
  logoutBtnText: { color: colors.error, fontSize: fontSize.sm, fontWeight: '600' },
});
