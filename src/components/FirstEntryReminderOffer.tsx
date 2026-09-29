/**
 * Oferta única de activar el recordatorio diario, justo tras la primera
 * comida registrada por un usuario (auditoría de activación — "ofrecer el
 * recordatorio en un momento natural de activación").
 *
 * `diaryStore.addEntry` es el único punto que decide CUÁNDO corresponde
 * mostrarla (primera comida real, oferta no mostrada antes, recordatorio
 * aún no activo) y marca `useUiStore().reminderOfferPending` — este
 * componente sólo lee esa señal y actúa, exactamente igual que
 * `PostOnboardingWelcome` con `justOnboarded`. No crea ningún sistema de
 * notificaciones nuevo: "Activar recordatorio" reutiliza literalmente
 * `scheduleDailyReminder`, la misma función y el mismo estado que ya usa el
 * interruptor de Perfil, incluida la comprobación de permisos del sistema
 * (si Android los deniega, se avisa con el mismo texto que ya usa Perfil).
 */
import React, { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { Button } from '@/components/ui';
import { BottomSheet } from '@/components/BottomSheet';
import { spacing, useTheme } from '@/theme';
import { useAuthStore } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';
import { DEFAULT_REMINDER_HOUR, scheduleDailyReminder } from '@/notifications/reminders';

export function FirstEntryReminderOffer() {
  const t = useTheme();
  const pending = useUiStore((s) => s.reminderOfferPending);
  const setPending = useUiStore((s) => s.setReminderOfferPending);
  const user = useAuthStore((s) => s.user);
  const [activating, setActivating] = useState(false);

  if (!pending) return null;

  // "Ahora no" cierra sin ninguna consecuencia: la oferta ya quedó marcada
  // como mostrada en el momento en que `diaryStore` decidió ofrecerla, así
  // que no hay nada más que deshacer ni que repetir.
  const dismiss = () => setPending(false);

  const activate = async () => {
    if (!user) {
      dismiss();
      return;
    }
    setActivating(true);
    const ok = await scheduleDailyReminder(user.id, DEFAULT_REMINDER_HOUR);
    setActivating(false);
    dismiss();
    if (!ok) {
      // Mismo texto que el interruptor de Perfil ante un permiso denegado —
      // no se inventa una segunda redacción para el mismo caso.
      Alert.alert(
        'Permiso denegado',
        'Activa las notificaciones de VegeTrack en Ajustes de Android.'
      );
    }
  };

  return (
    <BottomSheet visible onClose={dismiss}>
      <View style={{ gap: spacing.md, paddingTop: spacing.sm, alignItems: 'center' }}>
        <Text style={{ fontSize: 30 }}>🔔</Text>
        <Text style={{ fontSize: 20, fontWeight: '700', color: t.text, textAlign: 'center' }}>
          ¡Primera comida registrada!
        </Text>
        <Text style={{ color: t.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 20 }}>
          ¿Quieres que te avisemos cada día para que no se te olvide registrar tus comidas?
        </Text>
        <View style={{ width: '100%', gap: spacing.sm, marginTop: spacing.sm }}>
          <Button title="Activar recordatorio" onPress={() => void activate()} loading={activating} />
          <Pressable
            onPress={dismiss}
            disabled={activating}
            style={{ alignItems: 'center', paddingVertical: spacing.sm }}
          >
            <Text style={{ color: t.textMuted, fontWeight: '700', fontSize: 15 }}>Ahora no</Text>
          </Pressable>
        </View>
      </View>
    </BottomSheet>
  );
}
