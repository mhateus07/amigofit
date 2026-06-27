import React, { useState, useEffect, Component, ReactNode } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import ChatScreen from './src/screens/ChatScreen';
import DiaryScreen from './src/screens/DiaryScreen';
import InsightsScreen from './src/screens/InsightsScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import AuthScreen from './src/screens/AuthScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';
import SplashScreen from './src/screens/SplashScreen';
import WelcomeScreen from './src/screens/WelcomeScreen';
import { UserProfile } from './src/types';
import { storage, getToken, getStoredUser, clearToken } from './src/services/storage';
import { colors, fontSize } from './src/constants/theme';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null };
  static getDerivedStateFromError(e: Error) { return { error: e.message }; }
  render() {
    if (this.state.error) {
      return (
        <View style={{ flex: 1, backgroundColor: '#0F0F0F', justifyContent: 'center', padding: 24 }}>
          <Text style={{ color: '#FF4444', fontSize: 16, fontWeight: 'bold', marginBottom: 8 }}>Erro:</Text>
          <Text style={{ color: '#FFF', fontSize: 13 }}>{this.state.error}</Text>
        </View>
      );
    }
    return this.props.children;
  }
}

const Tab = createBottomTabNavigator();

function TabIcon({ icon, focused }: { icon: string; focused: boolean }) {
  return <Text style={{ fontSize: focused ? 22 : 20, opacity: focused ? 1 : 0.5 }}>{icon}</Text>;
}

export default function App() {
  const [splashDone, setSplashDone] = useState(false);
  const [authReady, setAuthReady]   = useState(false);
  const [authUser, setAuthUser]     = useState<{ id: string; name: string; email: string } | null>(null);
  const [profile, setProfile]       = useState<UserProfile | null>(null);
  const [authMode, setAuthMode]     = useState<'login' | 'register'>('login');
  const [showAuth, setShowAuth]     = useState(false);

  useEffect(() => {
    const fallback = setTimeout(() => setAuthReady(true), 6000);
    (async () => {
      try {
        const [token, user] = await Promise.all([getToken(), getStoredUser()]);
        if (token && user) {
          setAuthUser(user);
          const p = await storage.getProfile();
          setProfile(p);
        }
      } catch (e) {
        console.warn('Auth init error:', e);
      } finally {
        clearTimeout(fallback);
        setAuthReady(true);
      }
    })();
  }, []);

  const handleAuth = async (user: { id: string; name: string; email: string }, _token: string) => {
    setAuthUser(user);
    const p = await storage.getProfile();
    setProfile(p);
  };

  const handleOnboardingComplete = (p: UserProfile, _key: string) => {
    setProfile(p);
  };

  const handleLogout = async () => {
    await clearToken();
    setAuthUser(null);
    setProfile(null);
    setShowAuth(false);
  };

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
              <StatusBar style="light" />
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
            <StatusBar style="light" />
            <WelcomeScreen
              onLogin={() => { setAuthMode('login'); setShowAuth(true); }}
              onRegister={() => { setAuthMode('register'); setShowAuth(true); }}
            />
          </SafeAreaProvider>
        </GestureHandlerRootView>
      </ErrorBoundary>
    );
  }

  if (!profile || !profile.onboardingComplete) {
    return (
      <ErrorBoundary>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <SafeAreaProvider>
            <StatusBar style="light" />
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
            <StatusBar style="light" />
            <Tab.Navigator
              screenOptions={{
                headerShown: false,
                tabBarStyle: {
                  backgroundColor: colors.surface,
                  borderTopColor: colors.border,
                  height: 70,
                  paddingBottom: 12,
                },
                tabBarActiveTintColor: colors.primary,
                tabBarInactiveTintColor: colors.textMuted,
                tabBarLabelStyle: { fontSize: fontSize.xs, fontWeight: '600' },
              }}
            >
              <Tab.Screen
                name="Chat"
                options={{ tabBarIcon: ({ focused }) => <TabIcon icon="💬" focused={focused} /> }}
              >
                {() => <ChatScreen profile={profile} />}
              </Tab.Screen>
              <Tab.Screen
                name="Diário"
                options={{ tabBarIcon: ({ focused }) => <TabIcon icon="📋" focused={focused} /> }}
                component={DiaryScreen}
              />
              <Tab.Screen
                name="Insights"
                options={{ tabBarIcon: ({ focused }) => <TabIcon icon="📊" focused={focused} /> }}
                component={InsightsScreen}
              />
              <Tab.Screen
                name="Perfil"
                options={{ tabBarIcon: ({ focused }) => <TabIcon icon="👤" focused={focused} /> }}
              >
                {() => (
                  <ProfileScreen
                    profile={profile}
                    authUser={authUser}
                    onProfileUpdate={setProfile}
                    onLogout={handleLogout}
                  />
                )}
              </Tab.Screen>
            </Tab.Navigator>
          </NavigationContainer>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
