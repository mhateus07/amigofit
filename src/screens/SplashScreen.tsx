import React, { useEffect, useRef } from 'react';
import { View, Text, Animated, StyleSheet, ImageBackground } from 'react-native';
import { colors, fontSize } from '../constants/theme';

interface Props {
  onComplete: () => void;
}

const LOGO_SIZE = 100;

export default function SplashScreen({ onComplete }: Props) {
  const logoScale    = useRef(new Animated.Value(0.2)).current;
  const logoOpacity  = useRef(new Animated.Value(0)).current;
  const ring1Scale   = useRef(new Animated.Value(1)).current;
  const ring1Opacity = useRef(new Animated.Value(0.6)).current;
  const ring2Scale   = useRef(new Animated.Value(1)).current;
  const ring2Opacity = useRef(new Animated.Value(0.3)).current;
  const textOpacity  = useRef(new Animated.Value(0)).current;
  const screenOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const startPulse = () => {
      Animated.loop(
        Animated.sequence([
          Animated.parallel([
            Animated.timing(ring1Scale,   { toValue: 2.0, duration: 1100, useNativeDriver: true }),
            Animated.timing(ring1Opacity, { toValue: 0,   duration: 1100, useNativeDriver: true }),
          ]),
          Animated.parallel([
            Animated.timing(ring1Scale,   { toValue: 1,   duration: 0, useNativeDriver: true }),
            Animated.timing(ring1Opacity, { toValue: 0.6, duration: 0, useNativeDriver: true }),
          ]),
        ])
      ).start();

      Animated.loop(
        Animated.sequence([
          Animated.delay(550),
          Animated.parallel([
            Animated.timing(ring2Scale,   { toValue: 2.0, duration: 1100, useNativeDriver: true }),
            Animated.timing(ring2Opacity, { toValue: 0,   duration: 1100, useNativeDriver: true }),
          ]),
          Animated.parallel([
            Animated.timing(ring2Scale,   { toValue: 1,   duration: 0, useNativeDriver: true }),
            Animated.timing(ring2Opacity, { toValue: 0.3, duration: 0, useNativeDriver: true }),
          ]),
        ])
      ).start();
    };

    Animated.parallel([
      Animated.spring(logoScale,   { toValue: 1, tension: 55, friction: 7, useNativeDriver: true }),
      Animated.timing(logoOpacity, { toValue: 1, duration: 450, useNativeDriver: true }),
    ]).start(() => {
      startPulse();
      Animated.timing(textOpacity, { toValue: 1, duration: 500, delay: 150, useNativeDriver: true }).start();
    });

    const exitTimer = setTimeout(() => {
      Animated.timing(screenOpacity, { toValue: 0, duration: 450, useNativeDriver: true }).start();
      // Não depende do callback da animação — ele pode não disparar no Android com New Architecture
      setTimeout(onComplete, 460);
    }, 2600);

    return () => clearTimeout(exitTimer);
  }, []);

  return (
    <Animated.View style={[styles.screen, { opacity: screenOpacity }]}>
      <ImageBackground
        source={require('../../assets/splash-bg.png')}
        style={styles.bg}
        resizeMode="cover"
      >
        <View style={styles.overlay} />

        <View style={styles.logoWrapper}>
          <Animated.View style={[styles.ring, { transform: [{ scale: ring1Scale }], opacity: ring1Opacity }]} />
          <Animated.View style={[styles.ring, { transform: [{ scale: ring2Scale }], opacity: ring2Opacity }]} />
          <Animated.View style={[styles.logo, { transform: [{ scale: logoScale }], opacity: logoOpacity }]}>
            <Text style={styles.logoText}>AF</Text>
          </Animated.View>
        </View>

        <Animated.View style={[styles.textBlock, { opacity: textOpacity }]}>
          <Text style={styles.title}>AmigoFit</Text>
          <Text style={styles.tagline}>Seu parceiro de treino com IA</Text>
        </Animated.View>
      </ImageBackground>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  bg: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 40,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  logoWrapper: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    width: LOGO_SIZE,
    height: LOGO_SIZE,
    borderRadius: LOGO_SIZE / 2,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  logo: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
    borderRadius: LOGO_SIZE / 2,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOpacity: 0.9,
    shadowRadius: 40,
    shadowOffset: { width: 0, height: 0 },
    elevation: 20,
  },
  logoText:  { color: '#000', fontSize: 38, fontWeight: '900', letterSpacing: -1 },
  textBlock: { alignItems: 'center', gap: 6 },
  title:     { color: colors.text, fontSize: 32, fontWeight: '800', letterSpacing: 0.5 },
  tagline:   { color: 'rgba(255,255,255,0.7)', fontSize: 15 },
});
