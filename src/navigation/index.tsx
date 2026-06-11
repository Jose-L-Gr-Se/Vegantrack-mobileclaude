/**
 * Navegación raíz: Auth → Onboarding → 5 tabs (mismas que la PWA).
 * Deep linking: vegantrack://diary, vegantrack://search?barcode=…, y
 * https://vegantrack.app/* (App Links verificados en app.json).
 */
import React, { useEffect } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { DarkTheme, DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as Linking from 'expo-linking';
import { useTheme } from '@/theme';
import { useAuthStore } from '@/stores/authStore';
import { useDiaryStore } from '@/stores/diaryStore';
import { useWeightStore } from '@/stores/weightStore';
import { AuthScreen } from '@/screens/AuthScreen';
import { OnboardingScreen } from '@/screens/OnboardingScreen';
import { DiaryScreen } from '@/screens/DiaryScreen';
import { SearchScreen } from '@/screens/SearchScreen';
import { DashboardScreen } from '@/screens/DashboardScreen';
import { ProgressScreen } from '@/screens/ProgressScreen';
import { ProfileScreen } from '@/screens/ProfileScreen';
import { ScannerScreen } from '@/screens/ScannerScreen';
import { RecipesScreen } from '@/screens/RecipesScreen';
import type { MainTabParamList, RootStackParamList } from '@/navigation/types';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<MainTabParamList>();

const TAB_CONFIG: { name: keyof MainTabParamList; label: string; icon: string; component: React.ComponentType }[] = [
  { name: 'Diary', label: 'Diario', icon: '📖', component: DiaryScreen },
  { name: 'Search', label: 'Buscar', icon: '🔍', component: SearchScreen },
  { name: 'Dashboard', label: 'Resumen', icon: '📊', component: DashboardScreen },
  { name: 'Progress', label: 'Progreso', icon: '📈', component: ProgressScreen },
  { name: 'Profile', label: 'Perfil', icon: '👤', component: ProfileScreen },
];

function MainTabs() {
  const t = useTheme();
  return (
    <Tabs.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.primary,
        tabBarInactiveTintColor: t.textMuted,
        tabBarStyle: { backgroundColor: t.card, borderTopColor: t.cardBorder },
        // Las pantallas se montan al visitarlas (lazy) — menos trabajo al arrancar
        lazy: true,
      }}
    >
      {TAB_CONFIG.map(({ name, label, icon, component }) => (
        <Tabs.Screen
          key={name}
          name={name}
          component={component}
          options={{
            tabBarLabel: label,
            tabBarIcon: ({ focused }) => (
              <Text style={{ fontSize: 18, opacity: focused ? 1 : 0.5 }}>{icon}</Text>
            ),
          }}
        />
      ))}
    </Tabs.Navigator>
  );
}

import type { LinkingOptions } from '@react-navigation/native';

const linking: LinkingOptions<RootStackParamList> = {
  prefixes: [Linking.createURL('/'), 'https://vegantrack.app'],
  config: {
    screens: {
      Main: {
        screens: {
          Diary: 'diary',
          Search: 'search',
          Dashboard: 'dashboard',
          Progress: 'progress',
          Profile: 'profile',
        },
      },
      Recipes: 'recipes',
    },
  },
};

export function RootNavigator() {
  const t = useTheme();
  const { user, profile, initialized, initialize } = useAuthStore();

  useEffect(() => {
    void initialize();
  }, [initialize]);

  // Reintenta sincronizar escrituras offline pendientes al entrar con sesión
  useEffect(() => {
    if (user) {
      void useDiaryStore.getState().flushPending(user.id);
      void useWeightStore.getState().flushPending(user.id);
    }
  }, [user]);

  if (!initialized) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.background }}>
        <ActivityIndicator size="large" color={t.primary} />
      </View>
    );
  }

  const navTheme = t.dark
    ? { ...DarkTheme, colors: { ...DarkTheme.colors, background: t.background, primary: t.primary } }
    : { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: t.background, primary: t.primary } };

  const needsOnboarding = user && profile && !profile.calorie_target;

  return (
    <NavigationContainer theme={navTheme} linking={linking}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!user ? (
          <Stack.Screen name="Auth" component={AuthScreen} />
        ) : needsOnboarding ? (
          <Stack.Screen name="Onboarding" component={OnboardingScreen} />
        ) : (
          <>
            <Stack.Screen name="Main" component={MainTabs} />
            <Stack.Screen name="Scanner" component={ScannerScreen} options={{ presentation: 'fullScreenModal' }} />
            <Stack.Screen name="Recipes" component={RecipesScreen} options={{ presentation: 'modal' }} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
