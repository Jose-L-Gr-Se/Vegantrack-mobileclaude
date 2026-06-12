/** Progreso de peso: registro rápido, gráfico con media móvil 7d y estadísticas. */
import React, { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import Svg, { Line, Polyline, Text as SvgText } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, EmptyState } from '@/components/ui';
import { brand, semantic, spacing, useTheme } from '@/theme';
import { useAuthStore } from '@/stores/authStore';
import { useWeightStore } from '@/stores/weightStore';
import { todayISO } from '@/utils/dates';

const PERIODS = [
  { label: '7D', days: 7 },
  { label: '1M', days: 30 },
  { label: '3M', days: 90 },
  { label: '6M', days: 180 },
];

const DAY_ABBR = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MONTH_ABBR = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function formatDateNice(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const dayName = DAY_ABBR[d.getDay()];
  const month = MONTH_ABBR[d.getMonth()];
  return `${dayName} ${d.getDate()} ${month}`;
}

export function ProgressScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const weight = useWeightStore();
  const [input, setInput] = useState('');
  const [period, setPeriod] = useState(30);
  const [saving, setSaving] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (user) void weight.fetchLogs(user.id);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.id])
  );

  const save = async () => {
    const kg = parseFloat(input.replace(',', '.'));
    if (!Number.isFinite(kg) || kg <= 0 || kg >= 500) {
      Alert.alert('Peso inválido', 'Introduce un peso válido en kg.');
      return;
    }
    if (!user) return;
    setSaving(true);
    await weight.addLog(user.id, todayISO(), Math.round(kg * 10) / 10);
    setSaving(false);
    setInput('');
  };

  const chart = weight.getChartData(period);
  const stats = weight.getStats();

  const weights = chart.map((p) => p.weight);
  const minW = weights.length ? Math.min(...weights) - 0.5 : 0;
  const maxW = weights.length ? Math.max(...weights) + 0.5 : 1;
  const range = Math.max(maxW - minW, 0.1);

  const CHART_W = 300;
  const CHART_H = 110;
  const toY = (w: number) => CHART_H - ((w - minW) / range) * (CHART_H - 10);
  const toX = (i: number) => (i / Math.max(chart.length - 1, 1)) * CHART_W;

  // Dashed grid lines at 25%, 50%, 75%
  const gridYs = [0.25, 0.5, 0.75].map((pct) => pct * CHART_H);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.background }}
      contentContainerStyle={{
        paddingHorizontal: spacing.lg,
        paddingTop: insets.top + spacing.md,
        gap: spacing.lg,
        paddingBottom: spacing.xxl,
      }}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={{ fontSize: 26, fontWeight: '800', color: t.text }}>Progreso</Text>

      {/* Weight input hero */}
      <Card style={{ gap: spacing.md }}>
        <View style={{ alignItems: 'center', gap: spacing.sm }}>
          <Text style={{ fontSize: 32 }}>⚖️</Text>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs }}>
            <TextInput
              value={input}
              onChangeText={setInput}
              keyboardType="numeric"
              placeholder="0.0"
              placeholderTextColor={t.textMuted}
              style={{
                fontSize: 48,
                fontWeight: '800',
                color: t.text,
                textAlign: 'center',
                minWidth: 120,
              }}
            />
            <Text style={{ fontSize: 20, fontWeight: '600', color: t.textMuted }}>kg</Text>
          </View>
          {stats?.current ? (
            <Text style={{ fontSize: 13, color: t.textMuted }}>
              Último registrado: {stats.current} kg
            </Text>
          ) : null}
        </View>
        <Button title="Guardar →" onPress={save} loading={saving} />
      </Card>

      {/* Stats grid */}
      {stats && (
        <View>
          <Text
            style={{
              fontSize: 11,
              fontWeight: '700',
              letterSpacing: 0.8,
              color: t.textMuted,
              textTransform: 'uppercase',
              marginBottom: spacing.sm,
            }}
          >
            Estadísticas
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {[
              { label: 'ACTUAL', value: `${stats.current} kg` },
              { label: 'INICIO', value: `${stats.start} kg` },
              { label: 'MÍNIMO', value: `${stats.min} kg` },
              { label: 'MÁXIMO', value: `${stats.max} kg` },
            ].map(({ label, value }) => (
              <View
                key={label}
                style={{
                  flex: 1,
                  minWidth: '47%',
                  backgroundColor: t.card,
                  borderRadius: 20,
                  borderWidth: 1,
                  borderColor: t.cardBorder,
                  padding: spacing.md,
                  gap: 3,
                }}
              >
                <Text
                  style={{
                    fontSize: 10,
                    fontWeight: '700',
                    letterSpacing: 0.8,
                    color: t.textMuted,
                    textTransform: 'uppercase',
                  }}
                >
                  {label}
                </Text>
                <Text style={{ fontSize: 18, fontWeight: '800', color: t.text }}>{value}</Text>
              </View>
            ))}
          </View>
          {/* Change chip */}
          <View
            style={{
              marginTop: spacing.sm,
              borderRadius: 20,
              padding: spacing.md,
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.sm,
              backgroundColor: stats.change <= 0 ? '#f0fdf4' : t.card,
              borderWidth: 1,
              borderColor: stats.change <= 0 ? semantic.success : t.cardBorder,
            }}
          >
            <Ionicons
              name={(stats.change <= 0 ? 'trending-down' : 'trending-up') as any}
              size={18}
              color={stats.change <= 0 ? semantic.success : t.textMuted}
            />
            <View>
              <Text
                style={{
                  fontSize: 10,
                  fontWeight: '700',
                  letterSpacing: 0.8,
                  color: t.textMuted,
                  textTransform: 'uppercase',
                }}
              >
                Cambio total
              </Text>
              <Text
                style={{
                  fontSize: 18,
                  fontWeight: '800',
                  color: stats.change <= 0 ? semantic.success : t.textMuted,
                }}
              >
                {stats.change > 0 ? '+' : ''}
                {stats.change} kg
              </Text>
            </View>
          </View>
        </View>
      )}

      {/* Chart */}
      <View>
        {/* Period selector */}
        <View
          style={{
            flexDirection: 'row',
            gap: spacing.xs,
            backgroundColor: t.separator,
            borderRadius: 999,
            padding: 3,
            marginBottom: spacing.md,
          }}
        >
          {PERIODS.map((p) => (
            <Pressable
              key={p.label}
              onPress={() => setPeriod(p.days)}
              style={{
                flex: 1,
                paddingVertical: 6,
                borderRadius: 999,
                alignItems: 'center',
                backgroundColor: period === p.days ? t.card : 'transparent',
              }}
            >
              <Text
                style={{
                  fontWeight: '700',
                  fontSize: 13,
                  color: period === p.days ? t.primary : t.textMuted,
                }}
              >
                {p.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <Card style={{ gap: spacing.md }}>
          {chart.length < 2 ? (
            <EmptyState
              emoji="📈"
              text="Registra tu peso al menos dos días para ver el gráfico."
            />
          ) : (
            <>
              <View style={{ height: 140 }}>
                <Svg
                  width="100%"
                  height="140"
                  viewBox={`0 0 ${CHART_W} ${CHART_H + 10}`}
                  preserveAspectRatio="none"
                >
                  {/* Horizontal dashed grid lines */}
                  {gridYs.map((y) => (
                    <Line
                      key={y}
                      x1="0"
                      y1={y}
                      x2={CHART_W}
                      y2={y}
                      stroke={t.separator}
                      strokeWidth="1"
                      strokeDasharray="4 4"
                    />
                  ))}

                  {/* Daily weight line */}
                  <Polyline
                    points={chart.map((p, i) => `${toX(i)},${toY(p.weight)}`).join(' ')}
                    fill="none"
                    stroke={brand[300]}
                    strokeWidth={2}
                  />
                  {/* 7-day avg line */}
                  <Polyline
                    points={chart
                      .filter((p) => p.avg7 !== null)
                      .map((p) => `${toX(chart.indexOf(p))},${toY(p.avg7!)}`)
                      .join(' ')}
                    fill="none"
                    stroke={semantic.success}
                    strokeWidth={3}
                  />

                  {/* Y-axis labels */}
                  <SvgText
                    x={CHART_W - 2}
                    y={toY(maxW) + 10}
                    fontSize="9"
                    fill={t.textMuted}
                    textAnchor="end"
                  >
                    {maxW.toFixed(1)}
                  </SvgText>
                  <SvgText
                    x={CHART_W - 2}
                    y={toY(minW) - 3}
                    fontSize="9"
                    fill={t.textMuted}
                    textAnchor="end"
                  >
                    {minW.toFixed(1)}
                  </SvgText>
                </Svg>
              </View>

              {/* Legend */}
              <View style={{ flexDirection: 'row', gap: spacing.lg, justifyContent: 'center' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                  <View
                    style={{ width: 12, height: 3, borderRadius: 2, backgroundColor: brand[300] }}
                  />
                  <Text style={{ color: t.textMuted, fontSize: 11 }}>Diario</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                  <View
                    style={{ width: 12, height: 3, borderRadius: 2, backgroundColor: semantic.success }}
                  />
                  <Text style={{ color: t.textMuted, fontSize: 11 }}>Media 7d</Text>
                </View>
              </View>
            </>
          )}
        </Card>
      </View>

      {/* Records list */}
      {weight.logs.length > 0 && (
        <View>
          <Text
            style={{
              fontSize: 11,
              fontWeight: '700',
              letterSpacing: 0.8,
              color: t.textMuted,
              textTransform: 'uppercase',
              marginBottom: spacing.sm,
            }}
          >
            Registros
          </Text>
          <Card style={{ gap: 0, padding: 0, paddingHorizontal: spacing.lg }}>
            {[...weight.logs]
              .reverse()
              .slice(0, 14)
              .map((log, idx, arr) => {
                const prev = arr[idx + 1];
                const diff = prev ? log.weight_kg - prev.weight_kg : null;
                return (
                  <Pressable
                    key={log.id}
                    onLongPress={() =>
                      Alert.alert(
                        'Eliminar',
                        `¿Eliminar el registro del ${log.date}?`,
                        [
                          { text: 'Cancelar', style: 'cancel' },
                          {
                            text: 'Eliminar',
                            style: 'destructive',
                            onPress: () => void weight.deleteLog(log.id),
                          },
                        ]
                      )
                    }
                    style={{
                      height: 52,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: spacing.md,
                      borderBottomWidth: idx < arr.length - 1 ? 1 : 0,
                      borderBottomColor: t.separator,
                    }}
                  >
                    <Text style={{ flex: 1, color: t.textSecondary, fontSize: 14 }}>
                      {formatDateNice(log.date)}
                    </Text>
                    <Text style={{ color: t.text, fontWeight: '800', fontSize: 15 }}>
                      {log.weight_kg} kg
                    </Text>
                    {diff !== null ? (
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 2,
                          minWidth: 46,
                          justifyContent: 'flex-end',
                        }}
                      >
                        <Ionicons
                          name={(diff > 0 ? 'arrow-up' : 'arrow-down') as any}
                          size={12}
                          color={diff > 0 ? t.textMuted : semantic.success}
                        />
                        <Text
                          style={{
                            fontSize: 12,
                            fontWeight: '700',
                            color: diff > 0 ? t.textMuted : semantic.success,
                          }}
                        >
                          {Math.abs(diff).toFixed(1)}
                        </Text>
                      </View>
                    ) : (
                      <View style={{ minWidth: 46 }} />
                    )}
                  </Pressable>
                );
              })}
          </Card>
        </View>
      )}
    </ScrollView>
  );
}
