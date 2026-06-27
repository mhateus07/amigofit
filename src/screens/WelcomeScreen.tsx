import React, { useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Dimensions, Animated, Image, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, radius, fontSize } from '../constants/theme';

const { width, height } = Dimensions.get('window');

// Hero menor em telas compactas (S24 tem ~780dp de altura vs ~956pt do iPhone 17 Pro Max)
const HERO_HEIGHT = height < 850 ? 220 : 300;

interface Props {
  onLogin: () => void;
  onRegister: () => void;
}

const FEATURES = [
  {
    icon: '💬',
    color: '#00C853',
    bg: 'rgba(0,200,83,0.1)',
    title: 'Chat com IA',
    desc: 'Converse sobre treino, sono e nutrição a qualquer hora',
  },
  {
    icon: '📋',
    color: '#9C7FE8',
    bg: 'rgba(156,127,232,0.1)',
    title: 'Diário Inteligente',
    desc: 'Dados extraídos automaticamente das suas mensagens',
  },
  {
    icon: '📊',
    color: '#FFB300',
    bg: 'rgba(255,179,0,0.1)',
    title: 'Insights Visuais',
    desc: 'Acompanhe sua evolução com gráficos e análises',
  },
];

export default function WelcomeScreen({ onLogin, onRegister }: Props) {
  const heroScale   = useRef(new Animated.Value(0.85)).current;
  const heroOpacity = useRef(new Animated.Value(0)).current;
  const bodyOpacity = useRef(new Animated.Value(0)).current;
  const bodyY       = useRef(new Animated.Value(24)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(heroScale,   { toValue: 1, tension: 50, friction: 8, useNativeDriver: true }),
      Animated.timing(heroOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
    ]).start();
    Animated.parallel([
      Animated.timing(bodyOpacity, { toValue: 1, duration: 600, delay: 250, useNativeDriver: true }),
      Animated.timing(bodyY,       { toValue: 0, duration: 600, delay: 250, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        {/* ── Hero ── */}
        <Animated.View
          style={[styles.hero, { transform: [{ scale: heroScale }], opacity: heroOpacity }]}
          pointerEvents="none"
        >
          <Image
            source={require('../../assets/mascot.png')}
            style={styles.mascot}
            resizeMode="contain"
          />
        </Animated.View>

        {/* ── Body ── */}
        <Animated.View style={[styles.body, { opacity: bodyOpacity, transform: [{ translateY: bodyY }] }]}>
          <Text style={styles.brand}>AmigoFit</Text>
          <Text style={styles.headline}>Seu personal trainer{'\n'}com inteligência artificial</Text>

          <View style={styles.featureList}>
            {FEATURES.map((f) => (
              <View key={f.title} style={styles.featureRow}>
                <View style={[styles.featureIconBox, { backgroundColor: f.bg }]}>
                  <Text style={styles.featureIconText}>{f.icon}</Text>
                </View>
                <View style={styles.featureTextBlock}>
                  <Text style={[styles.featureTitle, { color: f.color }]}>{f.title}</Text>
                  <Text style={styles.featureDesc}>{f.desc}</Text>
                </View>
              </View>
            ))}
          </View>

          <TouchableOpacity style={styles.primaryBtn} onPress={onRegister} activeOpacity={0.85}>
            <Text style={styles.primaryBtnText}>Começar agora — é grátis 💪</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.secondaryBtn} onPress={onLogin} activeOpacity={0.7}>
            <Text style={styles.secondaryBtnText}>Já tenho uma conta  →</Text>
          </TouchableOpacity>
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll:    { flexGrow: 1 },

  hero: {
    height: HERO_HEIGHT,
    width,
    overflow: 'hidden',
    backgroundColor: colors.background,
  },
  mascot: {
    width: width * 1.1,
    height: HERO_HEIGHT * 1.1,
  },

  body: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  brand: {
    color: colors.primary,
    fontSize: fontSize.sm,
    fontWeight: '800',
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  headline: {
    color: colors.text,
    fontSize: fontSize.xxl,
    fontWeight: '800',
    lineHeight: 32,
    marginBottom: spacing.lg,
  },

  featureList: { gap: spacing.sm, marginBottom: spacing.lg },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  featureIconBox: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureIconText:  { fontSize: 22 },
  featureTextBlock: { flex: 1, gap: 2 },
  featureTitle:     { fontSize: fontSize.md, fontWeight: '700' },
  featureDesc:      { color: colors.textSecondary, fontSize: fontSize.sm, lineHeight: 18 },

  primaryBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingVertical: spacing.md + 2,
    alignItems: 'center',
    shadowColor: colors.primary,
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
    marginBottom: spacing.xs,
  },
  primaryBtnText:   { color: '#000', fontSize: fontSize.md, fontWeight: '800' },
  secondaryBtn:     { alignItems: 'center', paddingVertical: spacing.md },
  secondaryBtnText: { color: colors.textSecondary, fontSize: fontSize.md },
});
