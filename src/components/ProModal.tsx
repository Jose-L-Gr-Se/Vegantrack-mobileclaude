/**
 * Modal de planes Pro con Google Play Billing vía RevenueCat.
 * Los precios se leen del catálogo de Play Store; si no hay red se muestran
 * los valores de fallback hardcodeados.
 */
import React, { useEffect, useState } from 'react';
import { Alert, ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import Purchases, { PACKAGE_TYPE, PURCHASES_ERROR_CODE } from 'react-native-purchases';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/ui';
import { BottomSheet } from '@/components/BottomSheet';
import { radii, semantic, spacing, useTheme } from '@/theme';
import { useAuthStore } from '@/stores/authStore';
import { usePurchasesStore, ENTITLEMENT_PRO } from '@/stores/purchasesStore';

// ── Definición de planes ─────────────────────────────────────────────────────

interface Plan {
  id: 'free' | 'monthly' | 'annual';
  name: string;
  fallbackPrice: string;
  cadence: string;
  desc: string;
  features: string[];
  badge?: string;
  featured?: boolean;
  packageType: typeof PACKAGE_TYPE[keyof typeof PACKAGE_TYPE] | null;
}

const PLANS: Plan[] = [
  {
    id: 'free',
    name: 'Free',
    fallbackPrice: '0€',
    cadence: 'para siempre',
    desc: 'Lo esencial para registrar y seguir tu día.',
    features: [
      '1 análisis de plato con IA a la semana',
      'Registro ilimitado de comidas',
      'Macros + 6 micros clave',
      '14 días de historial',
      'Escáner de código de barras',
      '3 recetas y 3 suplementos',
    ],
    packageType: null,
  },
  {
    id: 'monthly',
    name: 'Pro',
    fallbackPrice: '4,99€',
    cadence: 'al mes',
    desc: 'Sin límites y con estadísticas profundas.',
    features: [
      'Análisis de platos con IA sin límite',
      'Historial ilimitado',
      'Tendencias de micros (30 / 90 días)',
      'Recetas y suplementos ilimitados',
      'Exportar el diario a CSV',
      'Soporte prioritario',
    ],
    badge: 'Popular',
    featured: true,
    packageType: PACKAGE_TYPE.MONTHLY,
  },
  {
    id: 'annual',
    name: 'Pro anual',
    fallbackPrice: '47,99€',
    cadence: 'al año',
    desc: 'El mismo Pro pagando un año. Ahorra un 20%.',
    features: [
      'Todo lo de Pro mensual',
      '20% de descuento (más de 2 meses gratis)',
      'Acceso anticipado a novedades',
    ],
    badge: 'Ahorra 20%',
    packageType: PACKAGE_TYPE.ANNUAL,
  },
];

// ── PlanCard ─────────────────────────────────────────────────────────────────

function PlanCard({
  plan,
  isCurrent,
  price,
  onPurchase,
  purchasing,
}: {
  plan: Plan;
  isCurrent: boolean;
  price: string;
  onPurchase?: () => void;
  purchasing: boolean;
}) {
  const t = useTheme();

  return (
    <View
      style={{
        borderWidth: plan.featured ? 1.5 : 1,
        borderColor: plan.featured ? t.primary : t.cardBorder,
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
        <Text style={{ fontSize: 38, fontWeight: '800', color: t.text }}>{price}</Text>
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
      ) : onPurchase ? (
        <Button title={`Elegir ${plan.name}`} onPress={onPurchase} loading={purchasing} />
      ) : null}
    </View>
  );
}

// ── ProModal ─────────────────────────────────────────────────────────────────

export function ProModal({ isPro, onClose }: { isPro: boolean; onClose: () => void }) {
  const t = useTheme();
  const { offerings, offeringsLoading, loadOfferings, customerInfo } = usePurchasesStore();
  const { updateProfile } = useAuthStore();
  const [purchasing, setPurchasing] = useState(false);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);

  useEffect(() => {
    void loadOfferings();
  }, [loadOfferings]);

  // ID del producto activo en RevenueCat (para detectar mensual vs anual)
  const activeProductId = customerInfo?.entitlements.active[ENTITLEMENT_PRO]?.productIdentifier;

  const getPriceForPlan = (plan: Plan): string => {
    if (!plan.packageType || !offerings?.current) return plan.fallbackPrice;
    const pkg = offerings.current.availablePackages.find(
      (p) => p.packageType === plan.packageType
    );
    return pkg?.product.priceString ?? plan.fallbackPrice;
  };

  const handlePurchase = async (plan: Plan) => {
    if (!plan.packageType) return;

    if (!offerings?.current) {
      Alert.alert(
        'Sin conexión',
        'No se puede conectar con la tienda. Comprueba tu conexión e inténtalo de nuevo.'
      );
      return;
    }

    const pkg = offerings.current.availablePackages.find(
      (p) => p.packageType === plan.packageType
    );
    if (!pkg) {
      Alert.alert('Producto no disponible', 'Este plan no está disponible en este momento.');
      return;
    }

    setPurchasing(true);
    setPurchaseError(null);
    try {
      const { customerInfo: info } = await Purchases.purchasePackage(pkg);
      const nowPro = info.entitlements.active[ENTITLEMENT_PRO] !== undefined;
      if (nowPro) {
        const expiresAt = info.entitlements.active[ENTITLEMENT_PRO]?.expirationDate ?? null;
        await updateProfile({ subscription_tier: 'pro', subscription_expires_at: expiresAt });
        onClose();
      }
    } catch (e: any) {
      if (e.code !== PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) {
        setPurchaseError(e.userMessage ?? e.message ?? 'Error al procesar la compra.');
      }
    } finally {
      setPurchasing(false);
    }
  };

  const handleRestore = async () => {
    setPurchasing(true);
    setPurchaseError(null);
    try {
      const info = await Purchases.restorePurchases();
      const nowPro = info.entitlements.active[ENTITLEMENT_PRO] !== undefined;
      if (nowPro) {
        const expiresAt = info.entitlements.active[ENTITLEMENT_PRO]?.expirationDate ?? null;
        await updateProfile({ subscription_tier: 'pro', subscription_expires_at: expiresAt });
        Alert.alert('Compras restauradas', 'Tu suscripción Pro ha sido restaurada correctamente.');
        onClose();
      } else {
        Alert.alert('Sin compras anteriores', 'No se encontraron suscripciones activas para restaurar.');
      }
    } catch (e: any) {
      Alert.alert('Error', e.userMessage ?? e.message ?? 'No se pudieron restaurar las compras.');
    } finally {
      setPurchasing(false);
    }
  };

  const isCurrent = (plan: Plan): boolean => {
    if (!isPro) return plan.id === 'free';
    if (plan.id === 'free') return false;
    if (!activeProductId) return true; // Pro pero sin info de producto → marcar ambos no
    // Si tenemos el product ID, marcamos solo el plan correspondiente
    if (plan.id === 'monthly') return !activeProductId.toLowerCase().includes('annual');
    if (plan.id === 'annual') return activeProductId.toLowerCase().includes('annual');
    return false;
  };

  return (
    <BottomSheet visible onClose={onClose}>
      <View style={{ gap: spacing.md, paddingTop: spacing.sm }}>
        {/* Header */}
        <View style={{ alignItems: 'center', gap: 4, marginBottom: spacing.sm }}>
          <Text style={{ fontSize: 30 }}>👑</Text>
          <Text style={{ fontSize: 28, fontWeight: '700', color: t.text }}>Hazte Pro</Text>
          <Text style={{ color: t.textSecondary, fontSize: 14, textAlign: 'center' }}>
            Análisis de platos con IA sin límite, historial completo y tendencias de micros. Cancela cuando quieras.
          </Text>
        </View>

        {/* Loading de precios */}
        {offeringsLoading && (
          <View style={{ alignItems: 'center', paddingVertical: spacing.sm }}>
            <ActivityIndicator color={t.primary} />
          </View>
        )}

        {/* Plan cards */}
        {PLANS.map((plan) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            isCurrent={isCurrent(plan)}
            price={getPriceForPlan(plan)}
            onPurchase={plan.packageType ? () => void handlePurchase(plan) : undefined}
            purchasing={purchasing}
          />
        ))}

        {/* Error de compra */}
        {purchaseError ? (
          <Text style={{ color: '#ef4444', fontSize: 13, textAlign: 'center' }}>
            {purchaseError}
          </Text>
        ) : null}

        {/* Restaurar compras */}
        {!isPro && (
          <TouchableOpacity onPress={() => void handleRestore()} disabled={purchasing}>
            <Text style={{ color: t.textMuted, fontSize: 13, textAlign: 'center', textDecorationLine: 'underline' }}>
              Restaurar compras anteriores
            </Text>
          </TouchableOpacity>
        )}

        {/* Nota legal Google Play */}
        <Text style={{ color: t.textMuted, fontSize: 11, textAlign: 'center', lineHeight: 16 }}>
          La suscripción se gestiona a través de Google Play. Puedes cancelarla en cualquier momento desde los ajustes de tu cuenta de Google Play.
        </Text>
      </View>
    </BottomSheet>
  );
}
