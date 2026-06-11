/** Progreso de peso: registro rápido, gráfico con media móvil 7d y estadísticas. */
import React, { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import Svg, { Polyline } from 'react-native-svg';
import { Button, Card, EmptyState, Input, SectionHeader } from '@/components/ui';
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
  const toY = (w: number) => 110 - ((w - minW) / range) * 100;
  const toX = (i: number) => (i / Math.max(chart.length - 1, 1)) * 300;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.background }}
      contentContainerStyle={{ padding: spacing.lg, paddingTop: insets.top + spacing.md, gap: spacing.lg, paddingBottom: spacing.xxl }}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={{ fontSize: 22, fontWeight: '800', color: t.text }}>Progreso</Text>

      <Card style={{ gap: spacing.md }}>
        <SectionHeader title="⚖️ Peso de hoy" />
        <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <Input value={input} onChangeText={setInput} keyboardType="numeric" placeholder="65.4" />
          </View>
          <Button title="Guardar" onPress={save} loading={saving} />
        </View>
      </Card>

      {stats && (
        <Card style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          {[
            { label: 'Actual', value: `${stats.current} kg` },
            { label: 'Inicio', value: `${stats.start} kg` },
            { label: 'Mín', value: `${stats.min} kg` },
            { label: 'Máx', value: `${stats.max} kg` },
            { label: 'Cambio', value: `${stats.change > 0 ? '+' : ''}${stats.change} kg` },
          ].map(({ label, value }) => (
            <View key={label} style={{ alignItems: 'center' }}>
              <Text style={{ color: t.textMuted, fontSize: 11 }}>{label}</Text>
              <Text style={{ color: t.text, fontWeight: '700', fontSize: 13 }}>{value}</Text>
            </View>
          ))}
        </Card>
      )}

      <Card style={{ gap: spacing.md }}>
        <SectionHeader
          title="Evolución"
          right={
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              {PERIODS.map((p) => (
                <Pressable key={p.label} onPress={() => setPeriod(p.days)}>
                  <Text
                    style={{
                      color: period === p.days ? t.primary : t.textMuted,
                      fontWeight: '700',
                      fontSize: 13,
                    }}
                  >
                    {p.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          }
        />
        {chart.length < 2 ? (
          <EmptyState emoji="📈" text="Registra tu peso al menos dos días para ver el gráfico." />
        ) : (
          <View style={{ height: 130 }}>
            <Svg width="100%" height="130" viewBox="0 0 300 120" preserveAspectRatio="none">
              <Polyline
                points={chart.map((p, i) => `${toX(i)},${toY(p.weight)}`).join(' ')}
                fill="none"
                stroke={brand[300]}
                strokeWidth={2}
              />
              <Polyline
                points={chart
                  .filter((p) => p.avg7 !== null)
                  .map((p) => `${toX(chart.indexOf(p))},${toY(p.avg7!)}`)
                  .join(' ')}
                fill="none"
                stroke={semantic.success}
                strokeWidth={3}
              />
            </Svg>
            <Text style={{ color: t.textMuted, fontSize: 11 }}>
              Línea clara: diario · línea verde: media 7 días
            </Text>
          </View>
        )}
      </Card>

      {weight.logs.length > 0 && (
        <Card style={{ gap: 4 }}>
          <SectionHeader title="Registros" />
          {[...weight.logs].reverse().slice(0, 14).map((log) => (
            <Pressable
              key={log.id}
              onLongPress={() =>
                Alert.alert('Eliminar', `¿Eliminar el registro del ${log.date}?`, [
                  { text: 'Cancelar', style: 'cancel' },
                  { text: 'Eliminar', style: 'destructive', onPress: () => void weight.deleteLog(log.id) },
                ])
              }
              style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 }}
            >
              <Text style={{ color: t.textSecondary }}>{log.date}</Text>
              <Text style={{ color: t.text, fontWeight: '700' }}>{log.weight_kg} kg</Text>
            </Pressable>
          ))}
        </Card>
      )}
    </ScrollView>
  );
}
