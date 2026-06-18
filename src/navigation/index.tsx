/**
 * Navegación raíz: Auth → Onboarding → 5 tabs (mismas que la PWA).
 * Deep linking: vegantrack://diary, vegantrack://search?barcode=…, y
 * https://vegantrack.app/* (App Links verificados en app.json).
 */
import React, { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { DarkTheme, DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as Linking from 'expo-linking';
import { Ionicons } from '@expo/vector-icons';
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
import { MicroTrendsScreen } from '@/screens/MicroTrendsScreen';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import type { MainTabParamList, RootStackParamList } from '@/navigation/types';
import type { LinkingOptions } from '@react-navigation/native';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<MainTabParamList>();

/** Wraps a screen component with an ErrorBoundary so a crash is isolated. */
function withErrorBoundary(
  WrappedComponent: React.ComponentType,
  screenName: string
): React.ComponentType {
  const Wrapped = () => (
    <ErrorBoundary screenName={screenName}>
      <WrappedComponent />
    </ErrorBoundary>
  );
  Wrapped.displayName = `ErrorBoundary(${screenName})`;
  return Wrapped;
}

const TAB_CONFIG: {
  name: keyof MainTabParamList;
  label: string;
  icon: string;
  iconActive: string;
  component: React.ComponentType;
}[] = [
  { name: 'Diary', label: 'Diario', icon: 'book-outline', iconActive: 'book', component: withErrorBoundary(DiaryScreen, 'Diario') },
  { name: 'Search', label: 'Buscar', icon: 'search-outline', iconActive: 'search', component: withErrorBoundary(SearchScreen, 'Buscar') },
  { name: 'Dashboard', label: 'Resumen', icon: 'bar-chart-outline', iconActive: 'bar-chart', component: withErrorBoundary(DashboardScreen, 'Resumen') },
  { name: 'Progress', label: 'Progreso', icon: 'trending-up-outline', iconActive: 'trending-up', component: withErrorBoundary(ProgressScreen, 'Progreso') },
  { name: 'Profile', label: 'Perfil', icon: 'person-outline', iconActive: 'person', component: withErrorBoundary(ProfileScreen, 'Perfil') },
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
      {TAB_CONFIG.map((item) => (
        <Tabs.Screen
          key={item.name}
          name={item.name}
          component={item.component}
          options={{
            tabBarLabel: item.label,
            tabBarIcon: ({ focused, color }) => (
              <Ionicons
                name={(focused ? item.iconActive : item.icon) as any}
                size={22}
                color={color}
              />
            ),
          }}
        />
      ))}
    </Tabs.Navigator>
  );
}

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
            <Stack.Screen name="MicroTrends" component={MicroTrendsScreen} options={{ presentation: 'modal' }} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
