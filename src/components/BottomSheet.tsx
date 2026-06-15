/**
 * BottomSheet — hoja deslizable de la app.
 *
 * Diseño definitivo tras varias iteraciones para que en Android funcione
 * todo lo que se espera de un sheet premium:
 *
 *  1. **El teclado nunca tapa el contenido.** En vez de pelearnos con
 *     `KeyboardAvoidingView` dentro de un Modal (poco fiable en Android),
 *     escuchamos eventos nativos (`Keyboard.addListener`) y alzamos la
 *     hoja con `bottom: kbHeight`. El input siempre queda por encima.
 *
 *  2. **Respeta el safe area.** El padding interior incluye
 *     `insets.bottom` para que el botón de acción nunca caiga bajo la
 *     barra del sistema.
 *
 *  3. **Cierre rápido y natural:**
 *     · tap fuera del sheet (overlay oscuro),
 *     · tap en el handle,
 *     · deslizar el handle hacia abajo > 80 px o con velocidad,
 *     · botón "atrás" del SO (vía `onRequestClose`).
 *
 *  4. **Altura razonable.** `maxHeight` por defecto al 88 % de la
 *     pantalla; el ScrollView interno gestiona el desbordamiento.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  Keyboard,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleProp,
  View,
  ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { radii, spacing, useTheme } from '@/theme';

interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Slot pegado al fondo de la hoja (ideal para el CTA: siempre visible). */
  footer?: React.ReactNode;
  /** Altura máxima como fracción de la pantalla. */
  maxHeightFraction?: number;
  contentStyle?: StyleProp<ViewStyle>;
}

export function BottomSheet({
  visible,
  onClose,
  children,
  footer,
  maxHeightFraction = 0.88,
  contentStyle,
}: BottomSheetProps) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const screenH = Dimensions.get('window').height;
  const maxHeight = Math.round(screenH * maxHeightFraction);
  const translateY = useRef(new Animated.Value(0)).current;

  // Escucha al teclado para subir la hoja exactamente lo necesario.
  const [kbHeight, setKbHeight] = useState(0);
  useEffect(() => {
    const showName = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideName = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const sub1 = Keyboard.addListener(showName, (e) => {
      setKbHeight(e.endCoordinates?.height ?? 0);
    });
    const sub2 = Keyboard.addListener(hideName, () => setKbHeight(0));
    return () => {
      sub1.remove();
      sub2.remove();
    };
  }, []);

  // Reset al abrir.
  useEffect(() => {
    if (visible) translateY.setValue(0);
  }, [visible, translateY]);

  // Gestor de arrastre en el handle.
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
          }).start(() => {
            Keyboard.dismiss();
            onClose();
          });
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

  const close = () => {
    Keyboard.dismiss();
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={close}
      statusBarTranslucent
    >
      <View style={{ flex: 1 }}>
        {/* Overlay — tap fuera cierra */}
        <Pressable
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)' }}
          onPress={close}
        />

        {/* Hoja, anclada al fondo y alzándose con el teclado */}
        <Animated.View
          style={[
            {
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: kbHeight, // sube exactamente lo que ocupa el teclado
              maxHeight,
              backgroundColor: t.card,
              borderTopLeftRadius: radii.xl,
              borderTopRightRadius: radii.xl,
              borderWidth: 1,
              borderColor: t.cardBorder,
              borderBottomWidth: 0,
              transform: [{ translateY }],
            },
            contentStyle,
          ]}
        >
          {/* Handle: tap o arrastre hacia abajo */}
          <View {...panResponder.panHandlers}>
            <Pressable
              onPress={close}
              hitSlop={14}
              style={{ alignItems: 'center', paddingTop: spacing.md, paddingBottom: spacing.sm }}
            >
              <View style={{ width: 44, height: 5, borderRadius: 3, backgroundColor: t.separator }} />
            </Pressable>
          </View>

          <ScrollView
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            showsVerticalScrollIndicator={false}
            // Si hay footer, el scroll no necesita reservar safe area: ya lo
            // hace el footer. Si no, dejamos hueco para el sistema.
            contentContainerStyle={{
              paddingHorizontal: spacing.lg,
              paddingBottom: footer
                ? spacing.md
                : kbHeight > 0
                ? spacing.lg
                : insets.bottom + spacing.lg,
            }}
          >
            {children}
          </ScrollView>

          {footer ? (
            <View
              style={{
                paddingHorizontal: spacing.lg,
                paddingTop: spacing.md,
                paddingBottom: (kbHeight > 0 ? spacing.md : insets.bottom + spacing.md),
                borderTopWidth: 1,
                borderTopColor: t.separator,
                backgroundColor: t.card,
              }}
            >
              {footer}
            </View>
          ) : null}
        </Animated.View>
      </View>
    </Modal>
  );
}
