import React from 'react';
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

function SplashGate() {
  const t = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.background }}>
      <Logo size={88} />
    </View>
  );
}

export default function App() {
  // La tipografía serif (Instrument Serif) define la voz editorial de los
  // títulos. Mostramos la marca mientras carga para evitar un salto de fuente.
  const [fontsLoaded] = useFonts({
    InstrumentSerif_400Regular,
    InstrumentSerif_400Regular_Italic,
  });

  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      {fontsLoaded ? <RootNavigator /> : <SplashGate />}
    </SafeAreaProvider>
  );
}
