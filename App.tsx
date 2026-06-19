import '@/i18n';
import React, { useEffect } from 'react';
import { View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  useFonts,
  InstrumentSerif_400Regular,
  InstrumentSerif_400Regular_Italic,
} from '@expo-google-fonts/instrument-serif';
import { RootNavigator } from '@/navigation';
import { Logo } from '@/components/Logo';
import { useTheme } from '@/theme';
import { useThemeStore } from '@/stores/themeStore';
import { useLanguageStore } from '@/stores/languageStore';

function SplashGate() {
  const t = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.background }}>
      <Logo size={88} />
    </View>
  );
}

function ThemedStatusBar() {
  // Sigue al tema efectivo (incluido el override manual del usuario) para que
  // los iconos de batería/hora contrasten siempre con el fondo.
  const t = useTheme();
  return <StatusBar style={t.dark ? 'light' : 'dark'} />;
}

export default function App() {
  // La tipografía serif (Instrument Serif) define la voz editorial de los
  // títulos. Mostramos la marca mientras carga para evitar un salto de fuente.
  const [fontsLoaded] = useFonts({
    InstrumentSerif_400Regular,
    InstrumentSerif_400Regular_Italic,
  });

  // Rehidrata la preferencia de tema (claro/oscuro/sistema) desde SQLite.
  const hydrateTheme = useThemeStore((s) => s.hydrate);
  const themeHydrated = useThemeStore((s) => s.hydrated);
  useEffect(() => {
    void hydrateTheme();
  }, [hydrateTheme]);

  // Rehidrata la preferencia de idioma desde SQLite.
  const hydrateLanguage = useLanguageStore((s) => s.hydrate);
  const languageHydrated = useLanguageStore((s) => s.hydrated);
  useEffect(() => {
    void hydrateLanguage();
  }, [hydrateLanguage]);

  const ready = fontsLoaded && themeHydrated && languageHydrated;

  return (
    <SafeAreaProvider>
      <ThemedStatusBar />
      {ready ? <RootNavigator /> : <SplashGate />}
    </SafeAreaProvider>
  );
}
