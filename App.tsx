import React, { useCallback, useEffect } from 'react';
import { View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  useFonts,
  InstrumentSerif_400Regular,
  InstrumentSerif_400Regular_Italic,
} from '@expo-google-fonts/instrument-serif';
import { RootNavigator } from '@/navigation';
import { useTheme } from '@/theme';
import { useThemeStore } from '@/stores/themeStore';

// Keep the native splash visible until the app is ready to render.
SplashScreen.preventAutoHideAsync();

function ThemedStatusBar() {
  const t = useTheme();
  return <StatusBar style={t.dark ? 'light' : 'dark'} />;
}

export default function App() {
  const [fontsLoaded] = useFonts({
    InstrumentSerif_400Regular,
    InstrumentSerif_400Regular_Italic,
  });

  const hydrateTheme = useThemeStore((s) => s.hydrate);
  const themeHydrated = useThemeStore((s) => s.hydrated);
  useEffect(() => {
    void hydrateTheme();
  }, [hydrateTheme]);

  const ready = fontsLoaded && themeHydrated;

  // Hide the native splash as soon as fonts + theme are ready.
  const onLayoutRootView = useCallback(async () => {
    if (ready) {
      await SplashScreen.hideAsync();
    }
  }, [ready]);

  if (!ready) return null;

  return (
    <SafeAreaProvider onLayout={onLayoutRootView}>
      <ThemedStatusBar />
      <RootNavigator />
    </SafeAreaProvider>
  );
}
