/** Escáner de códigos de barras con la cámara nativa (expo-camera). */
import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button } from '@/components/ui';
import { spacing, useTheme } from '@/theme';
import type { RootStackParamList } from '@/navigation/types';

export function ScannerScreen() {
  const t = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const scannedRef = useRef(false);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      void requestPermission();
    }
  }, [permission, requestPermission]);

  const onBarcode = ({ data }: { data: string }) => {
    if (scannedRef.current || !data) return;
    scannedRef.current = true;
    setScanned(true);
    navigation.navigate('Main', { screen: 'Search', params: { barcode: data } });
  };

  if (!permission?.granted) {
    return (
      <View style={{ flex: 1, backgroundColor: t.background, justifyContent: 'center', padding: spacing.xl, gap: spacing.lg }}>
        <Text style={{ color: t.text, textAlign: 'center', fontSize: 16 }}>
          VeganTrack necesita acceso a la cámara para escanear códigos de barras.
        </Text>
        <Button title="Conceder permiso" onPress={() => void requestPermission()} />
        <Button title="Volver" variant="secondary" onPress={() => navigation.goBack()} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView
        style={{ flex: 1 }}
        facing="back"
        barcodeScannerSettings={{
          barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128'],
        }}
        onBarcodeScanned={scanned ? undefined : onBarcode}
      />
      <View style={{ position: 'absolute', bottom: 40, left: 0, right: 0, paddingHorizontal: spacing.xl }}>
        <Button title="Cancelar" variant="secondary" onPress={() => navigation.goBack()} />
      </View>
    </View>
  );
}
