/**
 * Bienvenida cálida tras completar el onboarding. Aparece una sola vez (la
 * dispara `justOnboarded` en uiStore), celebra el alta, resume los objetivos
 * recién calculados y ofrece los planes Pro en el momento de mayor intención.
 */
import React, { useState } from 'react';
import { Modal, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/ui';
import { Logo } from '@/components/Logo';
import { ProModal } from '@/components/ProModal';
import { brand, fonts, radii, spacing, useTheme } from '@/theme';
import { useAuthStore } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';
import { usePro } from '@/hooks/usePro';
import { formatNumber } from '@/utils/nutrition';

const NEXT_STEPS = [
  { icon: '🍽️', text: 'Registra tu primera comida o foto de un plato' },
  { icon: '📊', text: 'Sigue tus macros y micros en tiempo real' },
  { icon: '📷', text: 'Escanea códigos de barras al instante' },
];

export function PostOnboardingWelcome() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const justOnboarded = useUiStore((s) => s.justOnboarded);
  const setJustOnboarded = useUiStore((s) => s.setJustOnboarded);
  const profile = useAuthStore((s) => s.profile);
  const { isPro } = usePro();
  const [showPlans, setShowPlans] = useState(false);

  if (!justOnboarded) return null;

  const close = () => {
    setShowPlans(false);
    setJustOnboarded(false);
  };

  // Al pulsar "ver planes" cerramos la bienvenida y mostramos solo el ProModal
  // (evita anidar dos Modals, que en Android da problemas).
  if (showPlans) {
    return <ProModal isPro={isPro} onClose={close} />;
  }

  const firstName = (profile?.display_name ?? '').trim().split(' ')[0];
  const heroBg = t.dark ? brand[800] : brand[600];

  return (
    <Modal visible transparent={false} animationType="fade" onRequestClose={close}>
      <View style={{ flex: 1, backgroundColor: t.background }}>
        {/* ── Hero ──────────────────────────────────────────── */}
        <View
          style={{
            backgroundColor: heroBg,
            paddingTop: insets.top + spacing.xxl,
            paddingBottom: spacing.xxl,
            paddingHorizontal: spacing.xl,
            alignItems: 'center',
            overflow: 'hidden',
          }}
        >
          <View
            style={{
              position: 'absolute', top: -50, right: -50,
              width: 200, height: 200, borderRadius: 100,
              backgroundColor: 'rgba(255,255,255,0.08)',
            }}
          />
          <View
            style={{
              position: 'absolute', bottom: -30, left: -30,
              width: 140, height: 140, borderRadius: 70,
              backgroundColor: 'rgba(255,255,255,0.06)',
            }}
          />

          <Logo size={64} color="#f3efe3" dotColor="#2f5d41" />
          <Text
            style={{
              fontFamily: fonts.display, fontSize: 34, fontWeight: '400', color: '#fff',
              letterSpacing: -0.5, marginTop: spacing.md, textAlign: 'center',
            }}
          >
            {firstName ? `¡Todo listo, ${firstName}!` : '¡Todo listo!'}
          </Text>
          <Text
            style={{
              color: 'rgba(255,255,255,0.8)', fontSize: 15,
              marginTop: spacing.xs, textAlign: 'center', lineHeight: 21,
            }}
          >
            Tu plan personalizado está preparado. Bienvenido a una nutrición vegana con cabeza.
          </Text>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            padding: spacing.xl,
            paddingBottom: insets.bottom + spacing.xl,
            gap: spacing.lg,
          }}
          showsVerticalScrollIndicator={false}
        >
          {/* Objetivo calórico destacado */}
          {profile?.calorie_target ? (
            <View
              style={{
                borderRadius: radii.xl,
                borderWidth: 1.5,
                borderColor: t.primary,
                backgroundColor: t.primarySoft,
                padding: spacing.lg,
                alignItems: 'center',
                gap: 2,
              }}
            >
              <Text style={{ color: t.primary, fontWeight: '800', fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase' }}>
                Tu objetivo diario
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
                <Text style={{ fontSize: 44, fontWeight: '800', color: t.text }}>
                  {formatNumber(profile.calorie_target)}
                </Text>
                <Text style={{ color: t.textMuted, fontSize: 15, fontWeight: '700' }}>kcal</Text>
              </View>
              {profile.protein_target_g ? (
                <Text style={{ color: t.textSecondary, fontSize: 13 }}>
                  {profile.protein_target_g}g proteína · {profile.carbs_target_g}g carbos · {profile.fat_target_g}g grasa
                </Text>
              ) : null}
            </View>
          ) : null}

          {/* Próximos pasos */}
          <View style={{ gap: spacing.md }}>
            <Text style={{ fontWeight: '800', fontSize: 14, color: t.text }}>
              Ya puedes empezar a:
            </Text>
            {NEXT_STEPS.map((s) => (
              <View key={s.text} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                <Text style={{ fontSize: 22 }}>{s.icon}</Text>
                <Text style={{ flex: 1, color: t.textSecondary, fontSize: 14, lineHeight: 20 }}>{s.text}</Text>
              </View>
            ))}
          </View>

          {/* Invitación a Pro (solo si aún no lo es) */}
          {!isPro ? (
            <View
              style={{
                borderRadius: radii.lg,
                borderWidth: 1,
                borderColor: t.cardBorder,
                backgroundColor: t.card,
                padding: spacing.lg,
                gap: spacing.sm,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <Text style={{ fontSize: 20 }}>👑</Text>
                <Text style={{ fontWeight: '800', fontSize: 15, color: t.text }}>
                  Desbloquea todo con Pro
                </Text>
              </View>
              <Text style={{ color: t.textSecondary, fontSize: 13, lineHeight: 19 }}>
                Análisis de platos con IA sin límite, historial completo y tendencias de micros. Cancela cuando quieras.
              </Text>
            </View>
          ) : null}
        </ScrollView>

        {/* Botones fijos abajo */}
        <View
          style={{
            paddingHorizontal: spacing.xl,
            paddingBottom: insets.bottom + spacing.md,
            paddingTop: spacing.sm,
            gap: spacing.sm,
            borderTopWidth: 1,
            borderTopColor: t.separator,
            backgroundColor: t.background,
          }}
        >
          {!isPro ? (
            <Button title="Ver planes Pro 👑" onPress={() => setShowPlans(true)} />
          ) : null}
          <TouchableOpacity onPress={close} activeOpacity={0.7} style={{ alignItems: 'center', paddingVertical: spacing.md }}>
            <Text style={{ color: isPro ? t.primary : t.textMuted, fontSize: 15, fontWeight: '700' }}>
              {isPro ? 'Entrar a mi diario' : 'Quizá más tarde'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
