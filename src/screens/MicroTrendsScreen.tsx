/**
 * Tendencias de micros (Pro): evolución diaria de B12, hierro, zinc, calcio,
 * vitamina D y omega-3 como % de la RDA, sumando comida y suplementos. Permite
 * elegir periodo (7/30/90 días) y micro a graficar, y muestra la media del
 * periodo por nutriente.
 */
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Line, Polyline, Circle } from 'react-native-svg';
import { Card, EmptyState } from '@/components/ui';
import { ProModal } from '@/components/ProModal';
import { semantic, spacing, useTheme } from '@/theme';
import { useAuthStore } from '@/stores/authStore';
import { useDiaryStore, type MicroKey, type MicroTrendPoint } from '@/stores/diaryStore';
import { usePro } from '@/hooks/usePro';
import { formatDateHuman } from '@/utils/dates';

const PERIODS = [
  { label: '7D', days: 7 },
  { label: '30D', days: 30 },
  { label: '90D', days: 90 },
];

const MICROS: { key: MicroKey; label: string; short: string; unit: string }[] = [
  { key: 'vitamin_b12_mcg', label: 'Vitamina B12', short: 'B12', unit: 'mcg' },
  { key: 'iron_mg', label: 'Hierro', short: 'Hierro', unit: 'mg' },
  { key: 'zinc_mg', label: 'Zinc', short: 'Zinc', unit: 'mg' },
  { key: 'calcium_mg', label: 'Calcio', short: 'Calcio', unit: 'mg' },
  { key: 'vitamin_d_mcg', label: 'Vitamina D', short: 'Vit D', unit: 'mcg' },
  { key: 'omega3_g', label: 'Omega-3', short: 'Ω-3', unit: 'g' },
];

function coverageColor(pct: number): string {
  if (pct >= 0.9) return semantic.success;
  if (pct >= 0.5) return semantic.warning;
  return semantic.danger;
}

export function MicroTrendsScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { user, profile } = useAuthStore();
  const { isPro } = usePro();
  const getMicroTrends = useDiaryStore((s) => s.getMicroTrends);

  const [days, setDays] = useState(30);
  const [micro, setMicro] = useState<MicroKey>('vitamin_b12_mcg');
  const [data, setData] = useState<MicroTrendPoint[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPro, setShowPro] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!user || !isPro) {
        setLoading(false);
        return;
      }
      setLoading(true);
      void getMicroTrends(user.id, days, profile?.sex).then((points) => {
        setData(points);
        setLoading(false);
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.id, days, isPro, profile?.sex])
  );

  const header = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        paddingHorizontal: spacing.lg,
        paddingTop: insets.top + spacing.sm,
        paddingBottom: spacing.sm,
      }}
    >
      <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
        <Ionicons name={'arrow-back' as never} size={24} color={t.text} />
      </Pressable>
      <Text style={{ fontSize: 26, fontWeight: '700', color: t.text }}>
        Tendencias de micros
      </Text>
    </View>
  );

  if (!isPro) {
    return (
      <View style={{ flex: 1, backgroundColor: t.background }}>
        {header}
        <View style={{ flex: 1, justifyContent: 'center', padding: spacing.xl, gap: spacing.lg }}>
          <EmptyState emoji="👑" text="Las tendencias de micros forman parte de Pro. Desbloquéalas para ver tu evolución de B12, hierro y omega-3 semana a semana." />
          <Pressable
            onPress={() => setShowPro(true)}
            style={{ backgroundColor: t.primary, borderRadius: 999, paddingVertical: 14, alignItems: 'center' }}
          >
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>Ver planes Pro</Text>
          </Pressable>
        </View>
        {showPro && <ProModal isPro={isPro} onClose={() => setShowPro(false)} />}
      </View>
    );
  }

  // Serie del micro seleccionado
  const series = (data ?? []).map((p) => p.micros[micro].pct);
  const hasData = series.some((v) => v > 0);
  const avgPct =
    series.length > 0 ? series.reduce((s, v) => s + v, 0) / series.length : 0;
  const capY = Math.max(1.2, ...series, 0.1);

  const W = 300;
  const H = 130;
  const toX = (i: number) => (i / Math.max(series.length - 1, 1)) * W;
  const toY = (pct: number) => H - (Math.min(pct, capY) / capY) * (H - 6);
  const refY = toY(1); // línea de 100 % RDA

  const selected = MICROS.find((m) => m.key === micro)!;

  return (
    <View style={{ flex: 1, backgroundColor: t.background }}>
      {header}
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingTop: spacing.sm, gap: spacing.lg, paddingBottom: spacing.xxl }}
      >
        {/* Selector de periodo */}
        <View style={{ flexDirection: 'row', gap: spacing.xs, backgroundColor: t.separator, borderRadius: 999, padding: 3 }}>
          {PERIODS.map((p) => (
            <Pressable
              key={p.label}
              onPress={() => setDays(p.days)}
              style={{
                flex: 1,
                paddingVertical: 7,
                borderRadius: 999,
                alignItems: 'center',
                backgroundColor: days === p.days ? t.card : 'transparent',
              }}
            >
              <Text style={{ fontWeight: '700', fontSize: 13, color: days === p.days ? t.primary : t.textMuted }}>
                {p.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {loading ? (
          <View style={{ paddingVertical: spacing.xxl, alignItems: 'center' }}>
            <ActivityIndicator color={t.primary} size="large" />
          </View>
        ) : (
          <>
            {/* Chart del micro seleccionado */}
            <Card style={{ gap: spacing.md }}>
              {/* Chips de micro */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs }}>
                {MICROS.map((m) => {
                  const on = m.key === micro;
                  return (
                    <Pressable
                      key={m.key}
                      onPress={() => setMicro(m.key)}
                      style={{
                        paddingHorizontal: spacing.md,
                        paddingVertical: 6,
                        borderRadius: 999,
                        borderWidth: 1.5,
                        borderColor: on ? t.primary : t.cardBorder,
                        backgroundColor: on ? t.primarySoft : 'transparent',
                      }}
                    >
                      <Text style={{ fontSize: 12, fontWeight: '700', color: on ? t.primary : t.textSecondary }}>
                        {m.short}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>

              <View>
                <Text style={{ fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: t.textMuted }}>
                  {selected.label} · media del periodo
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
                  <Text style={{ fontSize: 40, fontWeight: '800', color: coverageColor(avgPct) }}>
                    {Math.round(avgPct * 100)}%
                  </Text>
                  <Text style={{ color: t.textMuted, fontSize: 13 }}>de la RDA</Text>
                </View>
              </View>

              {hasData ? (
                <>
                  <View style={{ height: H }}>
                    <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
                      {/* Línea de referencia 100 % RDA */}
                      <Line x1={0} y1={refY} x2={W} y2={refY} stroke={t.textMuted} strokeWidth={1} strokeDasharray="6 4" opacity={0.5} />
                      <Polyline
                        points={series.map((v, i) => `${toX(i)},${toY(v)}`).join(' ')}
                        fill="none"
                        stroke={t.primary}
                        strokeWidth={2.5}
                      />
                      {series.length > 0 ? (
                        <Circle cx={toX(series.length - 1)} cy={toY(series[series.length - 1])} r={3.5} fill={t.primary} />
                      ) : null}
                    </Svg>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color: t.textMuted, fontSize: 10 }}>{formatDateHuman((data ?? [])[0]?.date ?? '')}</Text>
                    <Text style={{ color: t.textMuted, fontSize: 10 }}>línea punteada: 100% RDA</Text>
                    <Text style={{ color: t.textMuted, fontSize: 10 }}>Hoy</Text>
                  </View>
                </>
              ) : (
                <EmptyState emoji="📈" text="Aún no hay suficientes datos de este nutriente en el periodo. Registra comidas y suplementos para ver la evolución." />
              )}
            </Card>

            {/* Medias por micro */}
            <Card style={{ gap: spacing.md }}>
              <Text style={{ fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: t.textMuted }}>
                Media por nutriente · {days} días
              </Text>
              {MICROS.map((m) => {
                const vals = (data ?? []).map((p) => p.micros[m.key].pct);
                const avg = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
                const pctClamped = Math.min(1, avg);
                return (
                  <Pressable key={m.key} onPress={() => setMicro(m.key)} style={{ gap: 6 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ color: m.key === micro ? t.primary : t.textSecondary, fontSize: 13, fontWeight: '600' }}>
                        {m.label}
                      </Text>
                      <Text style={{ color: t.textMuted, fontSize: 12 }}>{Math.round(avg * 100)}%</Text>
                    </View>
                    <View style={{ height: 6, borderRadius: 3, backgroundColor: t.separator, overflow: 'hidden' }}>
                      <View style={{ width: `${pctClamped * 100}%`, height: 6, backgroundColor: coverageColor(avg) }} />
                    </View>
                  </Pressable>
                );
              })}
              <Text style={{ color: t.textMuted, fontSize: 11 }}>
                Incluye comida (con datos) y suplementos registrados. El hierro usa la RDA según tu sexo.
              </Text>
            </Card>
          </>
        )}
      </ScrollView>
    </View>
  );
}
