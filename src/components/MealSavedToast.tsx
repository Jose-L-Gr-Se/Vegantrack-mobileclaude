/**
 * Confirmación de "comida guardada" (auditoría del loop "siguiente comida").
 *
 * Antes esta confirmación existía sólo como estado local de `SearchScreen`
 * ("X añadido a Y"), fijado justo antes de navegar de vuelta al Diario — la
 * pestaña de Buscar quedaba oculta al instante, así que el mensaje nunca
 * llegaba a verse. Al vivir en `useUiStore` (montado una única vez en la
 * raíz, igual que `FirstEntryReminderOffer`/`PostOnboardingWelcome`)
 * sobrevive al cambio de pestaña.
 *
 * Deliberadamente ligero: nunca bloquea la pantalla (no es un `BottomSheet`
 * ni un `Alert`), se autodescarta sola, y se puede descartar antes tocándolo.
 */
import React, { useEffect } from 'react';
import { Pressable, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { radii, semantic, spacing, useTheme } from '@/theme';
import { useUiStore } from '@/stores/uiStore';

export const MEAL_SAVED_TOAST_DURATION_MS = 2500;

export function MealSavedToast() {
  const t = useTheme();
  const message = useUiStore((s) => s.mealSavedToast);
  const clear = useUiStore((s) => s.clearMealSavedToast);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(clear, MEAL_SAVED_TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [message, clear]);

  if (!message) return null;

  return (
    <Pressable
      onPress={clear}
      style={{
        position: 'absolute',
        left: spacing.lg,
        right: spacing.lg,
        bottom: spacing.xxl,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        backgroundColor: t.card,
        borderRadius: radii.lg,
        borderWidth: 1,
        borderColor: t.cardBorder,
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.lg,
        shadowColor: '#000',
        shadowOpacity: 0.15,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 4 },
        elevation: 4,
      }}
    >
      <Ionicons name={'checkmark-circle' as never} size={20} color={semantic.success} />
      <Text style={{ flex: 1, color: t.text, fontSize: 14, fontWeight: '600' }} numberOfLines={2}>
        {message}
      </Text>
    </Pressable>
  );
}
