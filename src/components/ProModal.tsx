/**
 * Modal de planes Pro. Presenta Free / Pro mensual / Pro anual con su lista de
 * ventajas y abre el checkout (Stripe) en la web — las mismas APIs de Vercel
 * que la PWA, para no duplicar la pasarela de pago en móvil.
 */
import React from 'react';
import { Linking, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui';
import { BottomSheet } from '@/components/BottomSheet';
import { radii, semantic, spacing, useTheme } from '@/theme';
import { WEB_BASE_URL } from '@/lib/supabase';
import { track } from '@/lib/analytics';

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

function PlanCard({ plan, isCurrent }: { plan: Plan; isCurrent: boolean }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const border = plan.featured ? theme.primary : theme.cardBorder;

  const onChoose = () => {
    if (!plan.checkout) return;
    track('checkout_opened', { plan: plan.checkout });
    void Linking.openURL(`${WEB_BASE_URL}/?upgrade=pro&plan=${plan.checkout}`);
  };

  return (
    <View
      style={{
        borderWidth: plan.featured ? 1.5 : 1,
        borderColor: border,
        borderRadius: radii.lg,
        padding: spacing.lg,
        backgroundColor: plan.featured ? theme.primarySoft : theme.card,
        gap: spacing.md,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ fontSize: 12, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: theme.textMuted }}>
          {plan.name}
        </Text>
        {plan.badge ? (
          <View style={{ backgroundColor: theme.primary, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 3 }}>
            <Text style={{ color: semantic.cream, fontSize: 10, fontWeight: '800', letterSpacing: 0.5 }}>
              {plan.badge.toUpperCase()}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
        <Text style={{ fontSize: 38, fontWeight: '800', color: theme.text }}>
          {plan.price}
        </Text>
        <Text style={{ color: theme.textMuted, fontSize: 14 }}>{plan.cadence}</Text>
      </View>

      <Text style={{ color: theme.textSecondary, fontSize: 13 }}>{plan.desc}</Text>

      <View style={{ gap: spacing.sm, marginTop: 2 }}>
        {plan.features.map((f) => (
          <View key={f} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }}>
            <Ionicons name={'checkmark-circle' as never} size={16} color={theme.primary} style={{ marginTop: 1 }} />
            <Text style={{ flex: 1, color: theme.text, fontSize: 13 }}>{f}</Text>
          </View>
        ))}
      </View>

      {isCurrent ? (
        <View style={{ alignItems: 'center', paddingVertical: 12, borderRadius: radii.pill, backgroundColor: theme.separator }}>
          <Text style={{ color: theme.textMuted, fontWeight: '700', fontSize: 14 }}>{t('pro.currentPlan')}</Text>
        </View>
      ) : plan.checkout ? (
        <Button title={t('pro.choosePlan', { name: plan.name })} onPress={onChoose} />
      ) : null}
    </View>
  );
}

export function ProModal({ isPro, onClose }: { isPro: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const theme = useTheme();

  const plans: Plan[] = [
    {
      id: 'free',
      name: t('pro.free.name'),
      price: t('pro.free.price'),
      cadence: t('pro.free.cadence'),
      desc: t('pro.free.desc'),
      features: [t('pro.free.f0'), t('pro.free.f1'), t('pro.free.f2'), t('pro.free.f3'), t('pro.free.f4'), t('pro.free.f5')],
      checkout: null,
    },
    {
      id: 'monthly',
      name: t('pro.monthly.name'),
      price: t('pro.monthly.price'),
      cadence: t('pro.monthly.cadence'),
      desc: t('pro.monthly.desc'),
      features: [t('pro.monthly.f0'), t('pro.monthly.f1'), t('pro.monthly.f2'), t('pro.monthly.f3'), t('pro.monthly.f4'), t('pro.monthly.f5')],
      badge: t('pro.monthly.badge'),
      featured: true,
      checkout: 'monthly',
    },
    {
      id: 'annual',
      name: t('pro.annual.name'),
      price: t('pro.annual.price'),
      cadence: t('pro.annual.cadence'),
      desc: t('pro.annual.desc'),
      features: [t('pro.annual.f0'), t('pro.annual.f1'), t('pro.annual.f2')],
      badge: t('pro.annual.badge'),
      checkout: 'annual',
    },
  ];

  return (
    <BottomSheet visible onClose={onClose}>
      <View style={{ gap: spacing.md, paddingTop: spacing.sm }}>
        <View style={{ alignItems: 'center', gap: 4, marginBottom: spacing.sm }}>
          <Text style={{ fontSize: 30 }}>👑</Text>
          <Text style={{ fontSize: 28, fontWeight: '700', color: theme.text }}>
            {t('pro.title')}
          </Text>
          <Text style={{ color: theme.textSecondary, fontSize: 14, textAlign: 'center' }}>
            {t('pro.subtitle')}
          </Text>
        </View>

        {plans.map((plan) => (
          <PlanCard key={plan.id} plan={plan} isCurrent={isPro ? plan.id !== 'free' : plan.id === 'free'} />
        ))}

        <Text style={{ color: theme.textMuted, fontSize: 11, textAlign: 'center', marginTop: spacing.xs }}>
          {t('pro.footer')}
        </Text>
      </View>
    </BottomSheet>
  );
}
