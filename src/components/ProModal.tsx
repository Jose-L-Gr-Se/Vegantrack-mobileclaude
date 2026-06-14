/**
 * Modal de planes Pro. Presenta Free / Pro mensual / Pro anual con su lista de
 * ventajas y abre el checkout (Stripe) en la web — las mismas APIs de Vercel
 * que la PWA, para no duplicar la pasarela de pago en móvil.
 */
import React from 'react';
import { Linking, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/ui';
import { fonts, radii, semantic, spacing, useTheme } from '@/theme';
import { WEB_BASE_URL } from '@/lib/supabase';

interface Plan {
  id: 'free' | 'monthly' | 'annual';
  name: string;
  price: string;
  cadence: string;
  desc: string;
  features: string[];
  badge?: string;
  featured?: boolean;
  /** Parámetro de plan para el checkout; null = plan gratuito. */
  checkout: 'monthly' | 'annual' | null;
}

const PLANS: Plan[] = [
  {
    id: 'free',
    name: 'Free',
    price: '0€',
    cadence: 'para siempre',
    desc: 'Lo esencial para registrar y seguir tu día.',
    features: [
      'Registro ilimitado de comidas',
      'Macros + 6 micros clave',
      '14 días de historial',
      'Escáner de código de barras',
      '3 recetas y 3 suplementos',
    ],
    checkout: null,
  },
  {
    id: 'monthly',
    name: 'Pro',
    price: '4,99€',
    cadence: 'al mes',
    desc: 'Sin límites y con estadísticas profundas.',
    features: [
      'Todo lo de Free',
      'Historial ilimitado',
      'Tendencias de micros (30 / 90 días)',
      'Recetas y suplementos ilimitados',
      'Exportar el diario a CSV',
      'Soporte prioritario',
    ],
    badge: 'Popular',
    featured: true,
    checkout: 'monthly',
  },
  {
    id: 'annual',
    name: 'Pro anual',
    price: '39€',
    cadence: 'al año',
    desc: 'El mismo Pro pagando un año. Ahorra un 35%.',
    features: [
      'Todo lo de Pro',
      '35% de descuento (2 meses gratis)',
      'Acceso anticipado a novedades',
    ],
    badge: 'Ahorra 35%',
    checkout: 'annual',
  },
];

function PlanCard({ plan, isCurrent }: { plan: Plan; isCurrent: boolean }) {
  const t = useTheme();
  const border = plan.featured ? t.primary : t.cardBorder;

  const onChoose = () => {
    if (!plan.checkout) return;
    void Linking.openURL(`${WEB_BASE_URL}/?upgrade=pro&plan=${plan.checkout}`);
  };

  return (
    <View
      style={{
        borderWidth: plan.featured ? 1.5 : 1,
        borderColor: border,
        borderRadius: radii.lg,
        padding: spacing.lg,
        backgroundColor: plan.featured ? t.primarySoft : t.card,
        gap: spacing.md,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ fontSize: 12, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: t.textMuted }}>
          {plan.name}
        </Text>
        {plan.badge ? (
          <View style={{ backgroundColor: t.primary, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 3 }}>
            <Text style={{ color: semantic.cream, fontSize: 10, fontWeight: '800', letterSpacing: 0.5 }}>
              {plan.badge.toUpperCase()}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
        <Text style={{ fontFamily: fonts.display, fontSize: 38, fontWeight: '400', color: t.text }}>
          {plan.price}
        </Text>
        <Text style={{ color: t.textMuted, fontSize: 14 }}>{plan.cadence}</Text>
      </View>

      <Text style={{ color: t.textSecondary, fontSize: 13 }}>{plan.desc}</Text>

      <View style={{ gap: spacing.sm, marginTop: 2 }}>
        {plan.features.map((f) => (
          <View key={f} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }}>
            <Ionicons name={'checkmark-circle' as never} size={16} color={t.primary} style={{ marginTop: 1 }} />
            <Text style={{ flex: 1, color: t.text, fontSize: 13 }}>{f}</Text>
          </View>
        ))}
      </View>

      {isCurrent ? (
        <View style={{ alignItems: 'center', paddingVertical: 12, borderRadius: radii.pill, backgroundColor: t.separator }}>
          <Text style={{ color: t.textMuted, fontWeight: '700', fontSize: 14 }}>Tu plan actual</Text>
        </View>
      ) : plan.checkout ? (
        <Button title={`Elegir ${plan.name}`} onPress={onChoose} />
      ) : null}
    </View>
  );
}

export function ProModal({ isPro, onClose }: { isPro: boolean; onClose: () => void }) {
  const t = useTheme();

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }} onPress={onClose}>
        <Pressable onPress={() => undefined}>
          <View
            style={{
              backgroundColor: t.background,
              borderTopLeftRadius: radii.xl,
              borderTopRightRadius: radii.xl,
              maxHeight: '92%',
              paddingBottom: spacing.xxl,
            }}
          >
            {/* Drag handle */}
            <View style={{ alignItems: 'center', paddingTop: spacing.md, paddingBottom: spacing.sm }}>
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: t.separator }} />
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ padding: spacing.lg, paddingTop: spacing.sm, gap: spacing.md }}
            >
              <View style={{ alignItems: 'center', gap: 4, marginBottom: spacing.sm }}>
                <Text style={{ fontSize: 30 }}>👑</Text>
                <Text style={{ fontFamily: fonts.display, fontSize: 28, fontWeight: '400', color: t.text }}>
                  Hazte Pro
                </Text>
                <Text style={{ color: t.textSecondary, fontSize: 14, textAlign: 'center' }}>
                  Sin límites, con tendencias de micros y exportación. Cancela cuando quieras.
                </Text>
              </View>

              {PLANS.map((plan) => (
                <PlanCard key={plan.id} plan={plan} isCurrent={isPro ? plan.id !== 'free' : plan.id === 'free'} />
              ))}

              <Text style={{ color: t.textMuted, fontSize: 11, textAlign: 'center', marginTop: spacing.xs }}>
                El pago se gestiona de forma segura en la web (Stripe). Tu cuenta es la misma en la app y en la PWA.
              </Text>
            </ScrollView>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
