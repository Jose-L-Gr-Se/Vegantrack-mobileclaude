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
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { reportError } from '@/lib/errorReporting';

// Keep the native splash visible until the app is ready to render.
SplashScreen.preventAutoHideAsync();

function ThemedStatusBar() {
  const t = useTheme();
  return <StatusBar style={t.dark ? 'light' : 'dark'} />;
}

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    InstrumentSerif_400Regular,
    InstrumentSerif_400Regular_Italic,
  });

  useEffect(() => {
    // Antes este error se ignoraba en silencio y, si la carga de fuentes
    // fallaba, `ready` nunca pasaba a true: la app se quedaba en el splash
    // para siempre, sin timeout ni salida. Reportamos y seguimos — la
    // tipografía Instrument Serif es decorativa, no bloqueante: React
    // Native cae a la fuente del sistema si falta.
    if (fontError) reportError(fontError, { tag: 'font_load' });
  }, [fontError]);

  const hydrateTheme = useThemeStore((s) => s.hydrate);
  const themeHydrated = useThemeStore((s) => s.hydrated);
  useEffect(() => {
    void hydrateTheme();
  }, [hydrateTheme]);

  const ready = (fontsLoaded || !!fontError) && themeHydrated;

  // Hide the native splash as soon as fonts + theme are ready.
  const onLayoutRootView = useCallback(async () => {
    if (ready) {
      await SplashScreen.hideAsync();
    }
  }, [ready]);

  if (!ready) return null;

  return (
    <ErrorBoundary>
      <SafeAreaProvider onLayout={onLayoutRootView}>
        <ThemedStatusBar />
        <RootNavigator />
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
