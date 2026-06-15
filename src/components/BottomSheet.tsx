/**
 * BottomSheet — modal deslizable de la app.
 *
 * Soluciona tres problemas de los Modal nativos:
 *   1. El teclado no tapa el contenido (`KeyboardAvoidingView` envolviendo
 *      todo, con `statusBarTranslucent` en Android para que el offset sea
 *      correcto).
 *   2. Se puede cerrar deslizando la barra superior hacia abajo
 *      (PanResponder sobre el handle: si el gesto baja > 80px o suelta
 *      con velocidad positiva, anima al cierre).
 *   3. El botón de "atrás" del SO también cierra (onRequestClose).
 *
 * Los hijos se renderizan dentro del ScrollView interno; con
 * `keyboardShouldPersistTaps="handled"` los toques en otros campos
 * mantienen el comportamiento esperado mientras hay teclado abierto.
 */
import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleProp,
  View,
  ViewStyle,
} from 'react-native';
import { radii, spacing, useTheme } from '@/theme';

interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Altura máxima como fracción de la pantalla. */
  maxHeightFraction?: number;
  contentStyle?: StyleProp<ViewStyle>;
}

export function BottomSheet({
  visible,
  onClose,
  children,
  maxHeightFraction = 0.92,
  contentStyle,
}: BottomSheetProps) {
  const t = useTheme();
  const translateY = useRef(new Animated.Value(0)).current;

  // Resetea la posición al abrir.
  useEffect(() => {
    if (visible) translateY.setValue(0);
  }, [visible, translateY]);

  // Gestor de deslizamiento sobre el handle: arrastra hacia abajo para cerrar.
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => g.dy > 6,
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) translateY.setValue(g.dy);
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 80 || g.vy > 0.8) {
          Animated.timing(translateY, {
            toValue: 800,
            duration: 180,
            easing: Easing.in(Easing.cubic),
            useNativeDriver: true,
          }).start(() => onClose());
        } else {
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
            tension: 80,
            friction: 8,
          }).start();
        }
      },
    })
  ).current;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/* Fondo semitransparente — toque fuera cierra */}
      <Pressable
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' }}
        onPress={onClose}
      />
      {/* Hoja anclada al fondo, encima del Pressable */}
      <KeyboardAvoidingView
        style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        pointerEvents="box-none"
      >
        <Animated.View
          style={[
            {
              backgroundColor: t.card,
              borderTopLeftRadius: radii.xl,
              borderTopRightRadius: radii.xl,
              borderWidth: 1,
              borderColor: t.cardBorder,
              borderBottomWidth: 0,
              maxHeight: `${maxHeightFraction * 100}%` as `${number}%`,
              transform: [{ translateY }],
            },
            contentStyle,
          ]}
        >
          {/* Handle: zona ampliada para gestos */}
          <View {...panResponder.panHandlers}>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              style={{ alignItems: 'center', paddingTop: spacing.md, paddingBottom: spacing.sm }}
            >
              <View style={{ width: 44, height: 5, borderRadius: 3, backgroundColor: t.separator }} />
            </Pressable>
          </View>

          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl }}
          >
            {children}
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
