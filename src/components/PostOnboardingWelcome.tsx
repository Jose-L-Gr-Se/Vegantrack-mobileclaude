/**
 * Pantalla de activación tras completar el onboarding (Bloque 1 del Product
 * Audit v2 — "onboarding_completed → first_food_logged"). Aparece una sola
 * vez (la dispara `justOnboarded` en uiStore, igual que antes) y sustituye lo
 * que antes era una pantalla de bienvenida con lista de próximos pasos y
 * upsell de Pro: ahora es un paso funcional que lleva directo a registrar la
 * primera comida, con las dos vías ya existentes en la app (IA / búsqueda) —
 * no se duplica ninguna lógica de captura o de añadido de alimentos, sólo se
 * navega a las pantallas que ya la implementan (Diary/Search), indicándoles
 * con un parámetro de navegación que abran directamente esa acción.
 *
 * Deliberadamente NO toca pricing/Free-Pro en esta ronda: se retira el
 * bloque de "Desbloquea todo con Pro" que había aquí antes — mostrarlo justo
 * en este paso es exactamente el tono de "pantalla de marketing" que este
 * paso debe evitar.
 */
import React from 'react';
import { Modal, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/ui';
import { Logo } from '@/components/Logo';
import { brand, fonts, radii, spacing, useTheme } from '@/theme';
import { useAuthStore } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';
import { formatNumber } from '@/utils/nutrition';
import type { RootStackParamList } from '@/navigation/types';

export function PostOnboardingWelcome() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const justOnboarded = useUiStore((s) => s.justOnboarded);
  const setJustOnboarded = useUiStore((s) => s.setJustOnboarded);
  const profile = useAuthStore((s) => s.profile);

  if (!justOnboarded) return null;

  const close = () => setJustOnboarded(false);

  // Cada CTA navega primero (deja la pestaña/parámetro ya listo debajo de
  // este modal) y luego cierra — al desmontarse el modal, la app aparece ya
  // en el sitio correcto en vez de en la pestaña por defecto.
  const goAnalyzeWithAi = () => {
    navigation.navigate('Main', { screen: 'Diary', params: { startAction: 'photo' } });
    close();
  };
  const goSearchFood = () => {
    navigation.navigate('Main', { screen: 'Search', params: { fromActivation: true } });
    close();
  };
  const skipToDashboard = () => {
    navigation.navigate('Main', { screen: 'Dashboard' });
    close();
  };

  const firstName = (profile?.display_name ?? '').trim().split(' ')[0];
  const heroBg = t.dark ? brand[800] : brand[600];

  return (
    <Modal visible transparent={false} animationType="fade" onRequestClose={skipToDashboard}>
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
            Registra tu primera comida y verás al momento tus calorías, tus
            macros y tus nutrientes clave de dieta vegana (B12, hierro, zinc y más).
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
          {/* Objetivo calórico destacado — eco directo de lo que el usuario
              acaba de calcular en el onboarding, no marketing. */}
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
        </ScrollView>

        {/* CTAs principales — llevan directo a las dos vías ya existentes
            para registrar una comida, sin pantallas nuevas. */}
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
          <Button title="📷 Analizar con IA" onPress={goAnalyzeWithAi} />
          <Button title="🔍 Buscar alimento" onPress={goSearchFood} variant="secondary" />
          <TouchableOpacity onPress={skipToDashboard} activeOpacity={0.7} style={{ alignItems: 'center', paddingVertical: spacing.md }}>
            <Text style={{ color: t.textMuted, fontSize: 15, fontWeight: '700' }}>
              Ahora no, ir al resumen
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
