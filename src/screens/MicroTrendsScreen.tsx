/**
 * Tendencias de micros: evolución diaria de B12, hierro, zinc, calcio,
 * vitamina D y omega-3 como % de la RDA, sumando comida y suplementos. Permite
 * elegir periodo (7/30/90 días) y micro a graficar, y muestra la media del
 * periodo por nutriente.
 *
 * Contrato Free/Pro (auditoría de experiencia de retorno 3/7/14 días): Free
 * puede ver el rango de 7 días — es la única ventana de progreso de
 * nutrición a lo largo del tiempo que existía en el producto y que antes
 * estaba completamente cerrada, incluso para 7 días. 30 y 90 días siguen
 * siendo Pro. El selector de periodo está siempre visible y funcional,
 * también sin Pro, para poder volver a 7D sin salir de la pantalla.
 */
import React, { useCallback, useEffect, useState } from 'react';
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
import { track } from '@/lib/analytics';

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

  // Quien no es Pro aterriza directamente en el rango que sí puede ver (7D),
  // en vez de en uno (30D, el valor por defecto de siempre) que le
  // bloquearía al instante nada más entrar.
  const [days, setDays] = useState(isPro ? 30 : 7);
  const [micro, setMicro] = useState<MicroKey>('vitamin_b12_mcg');
  const [data, setData] = useState<MicroTrendPoint[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPro, setShowPro] = useState(false);

  // Free: 7 días. 30 y 90 siguen siendo Pro.
  const allowed = isPro || days === 7;

  // Sólo mide un intento REAL de acceder a contenido Pro (30/90 días) — con
  // 7 días ya abierto a Free, entrar y quedarse en 7D no es un intento de
  // acceder a Pro, así que no debe contar como paywall_viewed. Cubre tanto
  // quien llega directo a 30/90 (deep link, o el valor con el que un Pro que
  // acaba de expirar podría haberse quedado) como quien cambia de rango
  // dentro de la propia pantalla.
  useEffect(() => {
    if (!allowed) track('paywall_viewed', { source: 'trends' });
  }, [allowed]);

  useFocusEffect(
    useCallback(() => {
      if (!user || !allowed) {
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

  // Serie del micro seleccionado. El trazado sigue mostrando todos los días
  // (una serie con huecos exige un gráfico más complejo, fuera de alcance de
  // esta fase), pero la MEDIA excluye los días sin ningún registro relevante
  // (`hasEntries=false` y sin aporte de suplemento): un día sin datos no debe
  // contarse como un 0 confirmado (docs/NUTRICION-MICRONUTRIENTES.md).
  const seriesPoints = (data ?? []).map((p) => p.micros[micro]);
  const series = seriesPoints.map((m) => m.pct);
  const knownPoints = seriesPoints.filter((m) => m.hasEntries || m.value > 0);
  const hasData = knownPoints.length > 0;
  const avgPct =
    knownPoints.length > 0 ? knownPoints.reduce((s, m) => s + m.pct, 0) / knownPoints.length : 0;
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

        {!allowed ? (
          <View style={{ padding: spacing.lg, gap: spacing.lg }}>
            <EmptyState emoji="👑" text="El histórico de 30 y 90 días forma parte de Pro. Ya puedes ver los últimos 7 días gratis — desbloquea Pro para ver más." />
            <Pressable
              onPress={() => setShowPro(true)}
              style={{ backgroundColor: t.primary, borderRadius: 999, paddingVertical: 14, alignItems: 'center' }}
            >
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>Ver planes Pro</Text>
            </Pressable>
          </View>
        ) : loading ? (
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
                  {hasData ? (
                    <>
                      <Text style={{ fontSize: 40, fontWeight: '800', color: coverageColor(avgPct) }}>
                        {Math.round(avgPct * 100)}%
                      </Text>
                      <Text style={{ color: t.textMuted, fontSize: 13 }}>de la RDA</Text>
                    </>
                  ) : (
                    <Text style={{ fontSize: 20, fontWeight: '700', color: t.textMuted }}>
                      Sin datos en este periodo
                    </Text>
                  )}
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
                const points = (data ?? []).map((p) => p.micros[m.key]);
                const known = points.filter((v) => v.hasEntries || v.value > 0);
                const hasAvg = known.length > 0;
                const avg = hasAvg ? known.reduce((s, v) => s + v.pct, 0) / known.length : 0;
                const pctClamped = Math.min(1, avg);
                return (
                  <Pressable key={m.key} onPress={() => setMicro(m.key)} style={{ gap: 6 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ color: m.key === micro ? t.primary : t.textSecondary, fontSize: 13, fontWeight: '600' }}>
                        {m.label}
                      </Text>
                      <Text style={{ color: t.textMuted, fontSize: 12 }}>
                        {hasAvg ? `${Math.round(avg * 100)}%` : 'Sin datos'}
                      </Text>
                    </View>
                    <View style={{ height: 6, borderRadius: 3, backgroundColor: t.separator, overflow: 'hidden' }}>
                      <View
                        style={{
                          width: `${pctClamped * 100}%`,
                          height: 6,
                          backgroundColor: hasAvg ? coverageColor(avg) : t.separator,
                        }}
                      />
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
      {showPro && <ProModal isPro={isPro} onClose={() => setShowPro(false)} />}
    </View>
  );
}
