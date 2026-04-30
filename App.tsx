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
import { UserProfile } from './src/types';
import { storage } from './src/services/storage';
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
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [apiKey, setApiKey] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([storage.getProfile(), storage.getApiKey()]).then(([p, k]) => {
      setProfile(p);
      setApiKey(k);
    });
  }, []);

  const handleApiKeySet = async (key: string) => {
    await storage.saveApiKey(key);
    setApiKey(key);
  };

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
                {() => <ChatScreen profile={profile} apiKey={apiKey} />}
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
                    onProfileUpdate={setProfile}
                    onApiKeySet={handleApiKeySet}
                    hasApiKey={!!apiKey}
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
