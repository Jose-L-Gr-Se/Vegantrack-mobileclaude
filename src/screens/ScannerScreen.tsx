/** Escáner de códigos de barras con la cámara nativa (expo-camera). */
import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui';
import { radii, spacing, useTheme } from '@/theme';
import type { RootStackParamList } from '@/navigation/types';

const CORNER_SIZE = 24;
const CORNER_THICKNESS = 3;

export function ScannerScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  // Recibe el mealType del + de la comida para no perder el contexto al volver.
  const route = useRoute<RouteProp<RootStackParamList, 'Scanner'>>();
  const mealType = route.params?.mealType;
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
    navigation.navigate('Main', { screen: 'Search', params: { barcode: data, mealType } });
  };

  if (!permission?.granted) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: theme.background,
          justifyContent: 'center',
          padding: spacing.xl,
          gap: spacing.lg,
        }}
      >
        <Text style={{ fontWeight: '700', color: theme.text, textAlign: 'center', fontSize: 22 }}>
          {t('scanner.title')}
        </Text>
        <Text style={{ color: theme.textSecondary, textAlign: 'center', fontSize: 15 }}>
          {t('scanner.permissionMsg')}
        </Text>
        <Button title={t('scanner.grantPermission')} onPress={() => void requestPermission()} />
        <Button title={t('common.back')} variant="secondary" onPress={() => navigation.goBack()} />
      </View>
    );
  }

  const cornerColor = theme.primary;

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

      {/* Viewfinder overlay */}
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* Semi-transparent surround */}
        <View style={{ alignItems: 'center', gap: spacing.xl }}>
          {/* Viewfinder frame with corner brackets */}
          <View style={{ position: 'relative', width: 240, height: 160 }}>
            {/* Top-left corner */}
            <View
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: CORNER_SIZE,
                height: CORNER_SIZE,
                borderTopWidth: CORNER_THICKNESS,
                borderLeftWidth: CORNER_THICKNESS,
                borderTopColor: cornerColor,
                borderLeftColor: cornerColor,
                borderTopLeftRadius: 4,
              }}
            />
            {/* Top-right corner */}
            <View
              style={{
                position: 'absolute',
                top: 0,
                right: 0,
                width: CORNER_SIZE,
                height: CORNER_SIZE,
                borderTopWidth: CORNER_THICKNESS,
                borderRightWidth: CORNER_THICKNESS,
                borderTopColor: cornerColor,
                borderRightColor: cornerColor,
                borderTopRightRadius: 4,
              }}
            />
            {/* Bottom-left corner */}
            <View
              style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                width: CORNER_SIZE,
                height: CORNER_SIZE,
                borderBottomWidth: CORNER_THICKNESS,
                borderLeftWidth: CORNER_THICKNESS,
                borderBottomColor: cornerColor,
                borderLeftColor: cornerColor,
                borderBottomLeftRadius: 4,
              }}
            />
            {/* Bottom-right corner */}
            <View
              style={{
                position: 'absolute',
                bottom: 0,
                right: 0,
                width: CORNER_SIZE,
                height: CORNER_SIZE,
                borderBottomWidth: CORNER_THICKNESS,
                borderRightWidth: CORNER_THICKNESS,
                borderBottomColor: cornerColor,
                borderRightColor: cornerColor,
                borderBottomRightRadius: 4,
              }}
            />
          </View>

          {/* Instruction text */}
          <Text
            style={{
              color: '#ffffff',
              fontSize: 14,
              textAlign: 'center',
              fontWeight: '600',
              textShadowColor: 'rgba(0,0,0,0.8)',
              textShadowOffset: { width: 0, height: 1 },
              textShadowRadius: 4,
            }}
          >
            {t('scanner.instruction')}
          </Text>
        </View>
      </View>

      {/* Cancel button at bottom */}
      <View
        style={{
          position: 'absolute',
          bottom: 48,
          left: spacing.xl,
          right: spacing.xl,
        }}
      >
        <Button
          title={t('common.cancel')}
          variant="secondary"
          onPress={() => navigation.goBack()}
          style={{ flexDirection: 'row' }}
        />
      </View>
    </View>
  );
}
