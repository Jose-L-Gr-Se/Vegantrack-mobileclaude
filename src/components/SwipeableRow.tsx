/**
 * SwipeableRow — fila con eliminación en **dos pasos** como seguro.
 *
 * UX intencionada (más segura que iOS por defecto):
 *
 *   1. Estado **cerrado**. Tocar abre el editor (`onPress`).
 *   2. Desliza hacia la izquierda → la fila se queda **abierta** y muestra
 *      el botón rojo "Eliminar". No borra en este paso, da igual la
 *      velocidad: requiere confirmar.
 *   3. Estado **abierto** → o bien
 *        · tocas el botón rojo (confirmar), o
 *        · vuelves a deslizar a la izquierda (confirmar con gesto), o
 *        · deslizas a la derecha / tocas la fila para cerrarla sin borrar.
 *
 * Construida con PanResponder + Animated nativo, sin dependencias extra.
 */
import React, { useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { radii, semantic, useTheme } from '@/theme';

const SNAP_OPEN = -110;          // posición abierta
const OPEN_THRESHOLD = -45;      // si al soltar superas esto, ABRE
const REOPEN_DELETE_EXTRA = -30; // estando ABIERTO, deslizar 30 px más confirma
const ROW_RADIUS = radii.md;

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
  // Posición lógica: closed o open. Cuando está abierta y el usuario
  // arrastra MÁS allá del SNAP_OPEN, lo interpretamos como "confirmar".
  const [openState, setOpenState] = useState<'closed' | 'open'>('closed');
  const lastValue = useRef(0);

  translateX.addListener(({ value }) => {
    lastValue.current = value;
  });

  const close = () => {
    setOpenState('closed');
    Animated.spring(translateX, {
      toValue: 0,
      useNativeDriver: true,
      tension: 90,
      friction: 9,
    }).start();
  };

  const open = () => {
    setOpenState('open');
    Animated.spring(translateX, {
      toValue: SNAP_OPEN,
      useNativeDriver: true,
      tension: 90,
      friction: 9,
    }).start();
  };

  const commit = () => {
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
        // El delta se aplica encima de la posición previa: si está abierta,
        // dragear más a la izquierda extiende; a la derecha cierra.
        const base = openState === 'open' ? SNAP_OPEN : 0;
        const next = Math.min(0, base + g.dx);
        translateX.setValue(Math.max(next, -180));
      },
      onPanResponderRelease: (_, g) => {
        const cur = lastValue.current;
        if (openState === 'closed') {
          // Cerrado → solo decidimos si lo abrimos. NUNCA borramos en
          // un solo gesto, da igual la velocidad: este es el seguro.
          if (cur <= OPEN_THRESHOLD) open();
          else close();
        } else {
          // Ya está abierto. Si han seguido tirando a la izquierda más
          // allá del extra (~30 px), confirmamos. Si han ido claramente
          // a la derecha, cerramos. En medio, se queda abierto esperando.
          if (cur <= SNAP_OPEN + REOPEN_DELETE_EXTRA) {
            commit();
          } else if (cur > SNAP_OPEN + 40) {
            close();
          } else {
            open();
          }
        }
      },
    })
  ).current;

  return (
    <View style={{ position: 'relative', overflow: 'hidden', borderRadius: ROW_RADIUS }}>
      {/* Fondo rojo: solo presente para mostrar el botón cuando está abierto */}
      <Pressable
        onPress={commit}
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          bottom: 0,
          width: 110,
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
            // Si está abierta, primer toque sobre la fila cierra (no borra).
            // Si está cerrada, toque abre el editor.
            if (openState === 'open') close();
            else onPress?.();
          }}
        >
          {children}
        </Pressable>
      </Animated.View>
    </View>
  );
}
