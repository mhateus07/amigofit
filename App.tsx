import React, { useState, useEffect, useCallback, Component, ReactNode } from 'react';
import { StatusBar } from 'expo-status-bar';
import * as ExpoSplashScreen from 'expo-splash-screen';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { Text, View, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import {
  useFonts,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';

ExpoSplashScreen.preventAutoHideAsync();

import HojeScreen from './src/screens/HojeScreen';
import ChatScreen from './src/screens/ChatScreen';
import DiaryScreen from './src/screens/DiaryScreen';
import DietaScreen from './src/screens/DietaScreen';
import TreinoScreen from './src/screens/TreinoScreen';
import InsightsScreen from './src/screens/InsightsScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import AuthScreen from './src/screens/AuthScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';
import SplashScreen from './src/screens/SplashScreen';
import WelcomeScreen from './src/screens/WelcomeScreen';
import { UserProfile } from './src/types';
import { storage, getToken, getStoredUser, startSession, endSession, migrateLocalAiKeys, AuthUser } from './src/services/storage';
import { onUnauthorized, errorMessage, isStaleSession } from './src/services/api';
import { cancelWorkoutReminder } from './src/services/reminders';
import { isOfflineError, readCache, writeCache } from './src/services/offline';
import { colors, fontSize, fontFamily } from './src/constants/theme';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null };
  static getDerivedStateFromError(e: Error) { return { error: e.message }; }
  render() {
    if (this.state.error) {
      return (
        <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center', padding: 24 }}>
          <Text style={{ color: colors.error, fontSize: 16, fontWeight: 'bold', marginBottom: 8 }}>Erro:</Text>
          <Text style={{ color: colors.text, fontSize: 13 }}>{this.state.error}</Text>
        </View>
      );
    }
    return this.props.children;
  }
}

const Tab = createBottomTabNavigator();
const Stack = createStackNavigator();

function TabIcon({ icon, focused }: { icon: string; focused: boolean }) {
  return <Text style={{ fontSize: focused ? 22 : 20, opacity: focused ? 1 : 0.5 }}>{icon}</Text>;
}

interface MainTabsProps {
  profile: UserProfile;
  authUser: { id: string; name: string; email: string };
  setProfile: (p: UserProfile) => void;
  onLogout: () => void;
}

// Perfil saiu da barra de abas (máx. 6 abas com a nova "Hoje") e abre pelo
// ⚙️ da tela Hoje, empilhado sobre as abas.
function MainStack({ profile, authUser, setProfile, onLogout }: MainTabsProps) {
  return (
    <Stack.Navigator>
      <Stack.Screen name="Main" options={{ headerShown: false }}>
        {() => <MainTabs profile={profile} />}
      </Stack.Screen>
      <Stack.Screen
        name="Perfil"
        options={{
          title: '',
          headerBackTitle: 'Voltar',
          headerTitleStyle: { fontFamily: fontFamily.semiBold },
          headerTintColor: colors.primary,
        }}
      >
        {() => (
          <ProfileScreen
            profile={profile}
            authUser={authUser}
            onProfileUpdate={setProfile}
            onLogout={onLogout}
          />
        )}
      </Stack.Screen>
    </Stack.Navigator>
  );
}

function MainTabs({ profile }: { profile: UserProfile }) {
  const insets = useSafeAreaInsets();

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          height: 58 + insets.bottom,
          paddingBottom: insets.bottom + 6,
          paddingTop: 8,
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { fontSize: fontSize.xs, fontFamily: fontFamily.semiBold },
      }}
    >
      <Tab.Screen
        name="Hoje"
        options={{ tabBarIcon: ({ focused }) => <TabIcon icon="☀️" focused={focused} /> }}
      >
        {({ navigation }) => <HojeScreen profile={profile} onOpenProfile={() => navigation.navigate('Perfil')} />}
      </Tab.Screen>
      <Tab.Screen
        name="Chat"
        options={{ tabBarIcon: ({ focused }) => <TabIcon icon="💬" focused={focused} /> }}
      >
        {() => <ChatScreen profile={profile} />}
      </Tab.Screen>
      <Tab.Screen
        name="Diário"
        options={{ tabBarIcon: ({ focused }) => <TabIcon icon="📝" focused={focused} /> }}
        component={DiaryScreen}
      />
      <Tab.Screen
        name="Dieta"
        options={{ tabBarIcon: ({ focused }) => <TabIcon icon="🍽️" focused={focused} /> }}
        component={DietaScreen}
      />
      <Tab.Screen
        name="Treino"
        options={{ tabBarIcon: ({ focused }) => <TabIcon icon="🏋️" focused={focused} /> }}
        component={TreinoScreen}
      />
      <Tab.Screen
        name="Insights"
        options={{ tabBarIcon: ({ focused }) => <TabIcon icon="📈" focused={focused} /> }}
        component={InsightsScreen}
      />
    </Tab.Navigator>
  );
}

export default function App() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });
  const [splashDone, setSplashDone] = useState(false);
  const [authReady, setAuthReady]   = useState(false);
  const [authUser, setAuthUser]     = useState<AuthUser | null>(null);
  const [profile, setProfile]       = useState<UserProfile | null>(null);
  // "sem perfil ainda" (primeiro acesso → onboarding) é diferente de "não
  // consegui carregar" (rede fora, servidor fora → tela de erro com retry).
  const [profileState, setProfileState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [profileError, setProfileError] = useState<string | null>(null);
  const [authMode, setAuthMode]     = useState<'login' | 'register'>('login');
  const [showAuth, setShowAuth]     = useState(false);

  useEffect(() => {
    if (fontsLoaded) {
      ExpoSplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  const loadProfile = useCallback(async () => {
    setProfileState('loading');
    setProfileError(null);
    try {
      const p = await storage.getProfile();
      setProfile(p);
      setProfileState('ready');
      // Chaves de IA que versões antigas guardavam só no aparelho.
      migrateLocalAiKeys().catch((e) => console.warn('Migração de chaves de IA:', e));
    } catch (e) {
      if (isStaleSession(e)) return;
      // Sem internet ao abrir o app: entra com a última cópia do perfil salva
      // no aparelho — Hoje, Dieta e Treino funcionam com os dados em cache.
      const cached = isOfflineError(e) ? await readCache<UserProfile>('profile') : null;
      if (cached) {
        setProfile(cached);
        setProfileState('ready');
        return;
      }
      setProfileError(errorMessage(e));
      setProfileState('error');
    }
  }, []);

  // Mantém a cópia local do perfil atualizada (usada para abrir offline).
  useEffect(() => {
    if (authUser && profile) writeCache('profile', profile);
  }, [authUser, profile]);

  const handleLogout = useCallback(async () => {
    await endSession();
    await cancelWorkoutReminder().catch(() => {});
    setAuthUser(null);
    setProfile(null);
    setProfileState('loading');
    setShowAuth(false);
  }, []);

  // Token expirado ou revogado (ex.: "sair de todos os aparelhos").
  useEffect(() => {
    onUnauthorized(() => {
      handleLogout();
      Alert.alert('Sessão encerrada', 'Entre novamente para continuar.');
    });
    return () => onUnauthorized(null);
  }, [handleLogout]);

  useEffect(() => {
    (async () => {
      try {
        const [token, user] = await Promise.all([getToken(), getStoredUser()]);
        if (token && user) {
          await startSession(user);
          setAuthUser(user);
          loadProfile();
        }
      } catch (e) {
        console.warn('Auth init error:', e);
      } finally {
        setAuthReady(true);
      }
    })();
  }, [loadProfile]);

  const handleAuth = async (user: AuthUser, token: string) => {
    await startSession(user, token);
    setAuthUser(user);
    await loadProfile();
  };

  const handleOnboardingComplete = (p: UserProfile) => {
    setProfile(p);
  };

  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: '#0B0B0C' }} />;
  }

  // Splash always shows first
  if (!splashDone) {
    return (
      <ErrorBoundary>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <SafeAreaProvider>
            <StatusBar style="light" />
            <SplashScreen onComplete={() => setSplashDone(true)} />
          </SafeAreaProvider>
        </GestureHandlerRootView>
      </ErrorBoundary>
    );
  }

  // Auth check still in progress after splash (rare, splash is 2.6s)
  if (!authReady) {
    return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  }

  if (!authUser) {
    if (showAuth) {
      return (
        <ErrorBoundary>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <SafeAreaProvider>
              <StatusBar style="dark" />
              <AuthScreen onAuth={handleAuth} initialMode={authMode} />
            </SafeAreaProvider>
          </GestureHandlerRootView>
        </ErrorBoundary>
      );
    }
    return (
      <ErrorBoundary>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <SafeAreaProvider>
            <StatusBar style="dark" />
            <WelcomeScreen
              onLogin={() => { setAuthMode('login'); setShowAuth(true); }}
              onRegister={() => { setAuthMode('register'); setShowAuth(true); }}
            />
          </SafeAreaProvider>
        </GestureHandlerRootView>
      </ErrorBoundary>
    );
  }

  if (profileState !== 'ready') {
    return (
      <ErrorBoundary>
        <SafeAreaProvider>
          <StatusBar style="dark" />
          <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 12 }}>
            {profileState === 'loading' ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <>
                <Text style={{ color: colors.text, fontSize: fontSize.lg, fontFamily: fontFamily.semiBold, textAlign: 'center' }}>
                  Não foi possível carregar sua conta
                </Text>
                <Text style={{ color: colors.textSecondary, fontSize: fontSize.sm, fontFamily: fontFamily.regular, textAlign: 'center' }}>
                  {profileError}
                </Text>
                <TouchableOpacity
                  onPress={loadProfile}
                  accessibilityRole="button"
                  style={{ backgroundColor: colors.primary, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12, minHeight: 44 }}
                >
                  <Text style={{ color: '#fff', fontFamily: fontFamily.semiBold }}>Tentar de novo</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={handleLogout} accessibilityRole="button" style={{ padding: 12, minHeight: 44 }}>
                  <Text style={{ color: colors.textSecondary, fontFamily: fontFamily.medium }}>Sair da conta</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </SafeAreaProvider>
      </ErrorBoundary>
    );
  }

  if (!profile || !profile.onboardingComplete) {
    return (
      <ErrorBoundary>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <SafeAreaProvider>
            <StatusBar style="dark" />
            <OnboardingScreen authUser={authUser} onComplete={handleOnboardingComplete} />
          </SafeAreaProvider>
        </GestureHandlerRootView>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <NavigationContainer>
            <StatusBar style="dark" />
            <MainStack
              profile={profile!}
              authUser={authUser!}
              setProfile={setProfile}
              onLogout={handleLogout}
            />
          </NavigationContainer>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
