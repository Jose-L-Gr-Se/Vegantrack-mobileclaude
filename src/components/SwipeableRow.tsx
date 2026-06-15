/**
 * SwipeableRow — fila deslizable a la izquierda para revelar un botón
 * de eliminar. Inspirado en el patrón nativo iOS / Material.
 *
 * UX:
 *  1. Desliza la fila hacia la izquierda.
 *  2. Aparece un fondo rojo con icono + "Eliminar". El gesto se queda
 *     "abierto" si superas el umbral (60 px), si no vuelve al sitio.
 *  3. Tocar el botón rojo o soltar más allá de 140 px elimina.
 *  4. Tocar fuera (o deslizar a la derecha) lo cierra.
 *
 * Construido con PanResponder + Animated nativo, sin dependencias extra.
 */
import React, { useRef } from 'react';
import { Animated, PanResponder, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { radii, semantic, spacing, useTheme } from '@/theme';

const SNAP_OPEN = -100; // posición abierta (botón visible)
const SNAP_THRESHOLD = -60; // a partir de aquí abre al soltar
const COMMIT_THRESHOLD = -140; // si supera esto, elimina directo

export function SwipeableRow({
  children,
  onDelete,
  onPress,
}: {
  children: React.ReactNode;
  onDelete: () => void;
  onPress?: () => void;
}) {
  const t = useTheme();
  const translateX = useRef(new Animated.Value(0)).current;
  const lastValue = useRef(0);

  // Mantenemos el último valor para que un segundo arrastre arranque
  // desde donde se quedó (estado "abierto" → arrastrar más cierra o
  // confirma).
  translateX.addListener(({ value }) => {
    lastValue.current = value;
  });

  const close = () =>
    Animated.spring(translateX, {
      toValue: 0,
      useNativeDriver: true,
      tension: 90,
      friction: 9,
    }).start();

  const open = () =>
    Animated.spring(translateX, {
      toValue: SNAP_OPEN,
      useNativeDriver: true,
      tension: 90,
      friction: 9,
    }).start();

  const commitDelete = () => {
    Animated.timing(translateX, {
      toValue: -500,
      duration: 200,
      useNativeDriver: true,
    }).start(() => onDelete());
  };

  const panResponder = useRef(
    PanResponder.create({
      // Solo capturamos cuando el movimiento es claramente horizontal —
      // así el ScrollView vertical sigue funcionando.
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 10 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderMove: (_, g) => {
        const next = Math.min(0, lastValue.current + g.dx);
        translateX.setValue(Math.max(next, -160));
      },
      onPanResponderRelease: (_, g) => {
        const final = lastValue.current;
        if (final < COMMIT_THRESHOLD || g.vx < -1.2) {
          commitDelete();
        } else if (final < SNAP_THRESHOLD) {
          open();
        } else {
          close();
        }
      },
    })
  ).current;

  return (
    <View style={{ position: 'relative', overflow: 'hidden', borderRadius: radii.md }}>
      {/* Fondo rojo con botón de eliminar */}
      <Pressable
        onPress={commitDelete}
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          bottom: 0,
          width: 100,
          backgroundColor: semantic.danger,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: 6,
        }}
      >
        <Ionicons name={'trash-outline' as never} size={18} color="#fff" />
        <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Eliminar</Text>
      </Pressable>

      {/* Fila deslizable encima */}
      <Animated.View
        {...panResponder.panHandlers}
        style={{
          backgroundColor: t.card,
          transform: [{ translateX }],
        }}
      >
        <Pressable
          onPress={() => {
            // Si está abierta, primer toque cierra; si está cerrada, abre el editor.
            if (lastValue.current < -10) close();
            else onPress?.();
          }}
        >
          {children}
        </Pressable>
      </Animated.View>
    </View>
  );
}
