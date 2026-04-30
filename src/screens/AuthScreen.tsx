import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { API_BASE, saveToken, saveStoredUser } from '../services/storage';
import { colors, spacing, radius, fontSize } from '../constants/theme';

interface Props {
  onAuth: (user: { id: string; name: string; email: string }, token: string) => void;
}

export default function AuthScreen({ onAuth }: Props) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    setError('');
    if (!email.trim() || !password.trim()) { setError('Preencha e-mail e senha.'); return; }
    if (mode === 'register' && !name.trim()) { setError('Digite seu nome.'); return; }

    setLoading(true);
    try {
      const endpoint = mode === 'register' ? '/auth/register' : '/auth/login';
      const body = mode === 'register'
        ? { name: name.trim(), email: email.trim(), password }
        : { email: email.trim(), password };

      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (!res.ok) { setError(data.error || 'Algo deu errado.'); return; }

      await saveToken(data.token);
      await saveStoredUser(data.user);
      onAuth(data.user, data.token);
    } catch {
      setError('Não foi possível conectar ao servidor.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {/* Logo */}
          <View style={styles.logoArea}>
            <View style={styles.logoCircle}>
              <Text style={styles.logoText}>AF</Text>
            </View>
            <Text style={styles.appName}>AmigoFit</Text>
            <Text style={styles.tagline}>Seu parceiro de treino inteligente</Text>
          </View>

          {/* Card */}
          <View style={styles.card}>
            {/* Toggle */}
            <View style={styles.toggle}>
              <TouchableOpacity
                style={[styles.toggleBtn, mode === 'login' && styles.toggleBtnActive]}
                onPress={() => { setMode('login'); setError(''); }}
              >
                <Text style={[styles.toggleText, mode === 'login' && styles.toggleTextActive]}>
                  Entrar
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.toggleBtn, mode === 'register' && styles.toggleBtnActive]}
                onPress={() => { setMode('register'); setError(''); }}
              >
                <Text style={[styles.toggleText, mode === 'register' && styles.toggleTextActive]}>
                  Criar conta
                </Text>
              </TouchableOpacity>
            </View>

            {/* Fields */}
            {mode === 'register' && (
              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Nome</Text>
                <TextInput
                  style={styles.input}
                  value={name}
                  onChangeText={setName}
                  placeholder="Como posso te chamar?"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="words"
                />
              </View>
            )}

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>E-mail</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="seu@email.com"
                placeholderTextColor={colors.textMuted}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Senha</Text>
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                placeholder={mode === 'register' ? 'Mínimo 6 caracteres' : '••••••••'}
                placeholderTextColor={colors.textMuted}
                secureTextEntry
              />
            </View>

            {/* Error */}
            {!!error && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            {/* Submit */}
            <TouchableOpacity
              style={[styles.btn, loading && styles.btnDisabled]}
              onPress={handleSubmit}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color="#000" />
                : <Text style={styles.btnText}>
                    {mode === 'login' ? 'Entrar' : 'Criar minha conta'}
                  </Text>
              }
            </TouchableOpacity>

            {/* Switch mode */}
            <TouchableOpacity
              onPress={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}
              style={styles.switchMode}
            >
              <Text style={styles.switchModeText}>
                {mode === 'login'
                  ? 'Não tem conta? Crie uma agora'
                  : 'Já tem conta? Entre aqui'}
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: colors.background },
  scroll:      { flexGrow: 1, justifyContent: 'center', padding: spacing.lg },
  logoArea:    { alignItems: 'center', marginBottom: spacing.xl },
  logoCircle:  {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.md,
    shadowColor: colors.primary, shadowOpacity: 0.4,
    shadowRadius: 20, shadowOffset: { width: 0, height: 8 },
  },
  logoText:    { color: '#000', fontSize: 28, fontWeight: '900' },
  appName:     { color: colors.text, fontSize: fontSize.xxxl, fontWeight: '800' },
  tagline:     { color: colors.textSecondary, fontSize: fontSize.sm, marginTop: 4 },
  card:        { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.lg },
  toggle:      {
    flexDirection: 'row', backgroundColor: colors.surfaceElevated,
    borderRadius: radius.lg, padding: 4, marginBottom: spacing.lg,
  },
  toggleBtn:       { flex: 1, paddingVertical: spacing.sm, alignItems: 'center', borderRadius: radius.md },
  toggleBtnActive: { backgroundColor: colors.primary },
  toggleText:      { color: colors.textSecondary, fontWeight: '600', fontSize: fontSize.md },
  toggleTextActive: { color: '#000' },
  fieldGroup:  { marginBottom: spacing.md },
  label:       { color: colors.textSecondary, fontSize: fontSize.sm, marginBottom: spacing.xs },
  input:       {
    backgroundColor: colors.surfaceElevated, borderRadius: radius.md,
    padding: spacing.md, color: colors.text, fontSize: fontSize.md,
    borderWidth: 1, borderColor: colors.border,
  },
  errorBox:    {
    backgroundColor: 'rgba(255,68,68,0.1)', borderRadius: radius.md,
    padding: spacing.sm, marginBottom: spacing.md,
    borderWidth: 1, borderColor: colors.error,
  },
  errorText:   { color: colors.error, fontSize: fontSize.sm },
  btn:         {
    backgroundColor: colors.primary, borderRadius: radius.md,
    padding: spacing.md, alignItems: 'center', marginTop: spacing.sm,
  },
  btnDisabled: { opacity: 0.6 },
  btnText:     { color: '#000', fontSize: fontSize.md, fontWeight: '700' },
  switchMode:  { alignItems: 'center', marginTop: spacing.lg },
  switchModeText: { color: colors.textSecondary, fontSize: fontSize.sm },
});
