/** Resumen: VeganScore con desglose, macros del día, micros vs RDA y gráfico 7 días. */
import React, { useCallback, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import Svg, { Polyline } from 'react-native-svg';
import { Card, MacroBar, ProgressRing, SectionHeader } from '@/components/ui';
import { semantic, spacing, useTheme } from '@/theme';
import { useAuthStore } from '@/stores/authStore';
import { useDiaryStore, type WeekDay } from '@/stores/diaryStore';
import { useSupplementStore } from '@/stores/supplementStore';
import { computeVeganScore, getScoreColor, getScoreLabel } from '@/utils/veganScore';
import { ironRdaForSex, MICRO_RDA } from '@/utils/nutrition';

export function DashboardScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { user, profile } = useAuthStore();
  const diary = useDiaryStore();
  const supplementStore = useSupplementStore();
  const [weekData, setWeekData] = useState<WeekDay[]>([]);

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      void diary.fetchEntries(user.id, diary.selectedDate);
      void diary.getWeekData(user.id).then(setWeekData);
      void supplementStore.fetchSupplements(user.id);
      void supplementStore.fetchTodayLogs(user.id);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.id, diary.selectedDate])
  );

  const summary = diary.getDaySummary();
  const score = computeVeganScore({
    summary,
    calorieTarget: profile?.calorie_target ?? 0,
    proteinTarget: profile?.protein_target_g ?? 0,
    streakCount: profile?.streak_count ?? 0,
    suppContributions: supplementStore.getTodayContributions(),
    sex: profile?.sex ?? null,
  });
  const scoreColor = getScoreColor(score.total);

  const breakdownRows = [
    { label: 'Calorías', part: score.calories },
    { label: 'Proteína', part: score.protein },
    { label: 'Micros clave', part: score.micros },
    { label: 'Fibra', part: score.fiber },
    { label: 'Racha', part: score.streak },
  ];

  const suppContrib = supplementStore.getTodayContributions();
  const maxCal = Math.max(...weekData.map((d) => d.calories), profile?.calorie_target ?? 0, 1);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.background }}
      contentContainerStyle={{ padding: spacing.lg, paddingTop: insets.top + spacing.md, gap: spacing.lg, paddingBottom: spacing.xxl }}
    >
      <Text style={{ fontSize: 22, fontWeight: '800', color: t.text }}>Resumen</Text>

      {/* VeganScore */}
      <Card style={{ alignItems: 'center', gap: spacing.lg }}>
        <ProgressRing progress={score.total / 100} size={140} strokeWidth={12} color={scoreColor}>
          <Text style={{ fontSize: 36, fontWeight: '800', color: t.text }}>{score.total}</Text>
          <Text style={{ fontSize: 11, color: t.textMuted }}>VeganScore</Text>
        </ProgressRing>
        <Text style={{ fontWeight: '700', color: scoreColor }}>{getScoreLabel(score.total)}</Text>

        <View style={{ alignSelf: 'stretch', gap: spacing.sm }}>
          {breakdownRows.map(({ label, part }) => (
            <View key={label} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ color: t.textSecondary, fontSize: 13 }}>{label}</Text>
              <Text style={{ color: t.text, fontSize: 13, fontWeight: '600' }}>
                {part.score}/{part.max} · {part.label}
              </Text>
            </View>
          ))}
        </View>
      </Card>

      {/* Macros */}
      <Card style={{ gap: spacing.md }}>
        <SectionHeader title="Macros de hoy" />
        <MacroBar label="Calorías" value={summary.calories} target={profile?.calorie_target ?? 0} color={semantic.success} unit="kcal" />
        <MacroBar label="Proteína" value={summary.protein_g} target={profile?.protein_target_g ?? 0} color={semantic.protein} />
        <MacroBar label="Carbohidratos" value={summary.carbs_g} target={profile?.carbs_target_g ?? 0} color={semantic.carbs} />
        <MacroBar label="Grasas" value={summary.fat_g} target={profile?.fat_target_g ?? 0} color={semantic.fat} />
        <MacroBar label="Fibra" value={summary.fiber_g} target={30} color={semantic.orange} />
      </Card>

      {/* Micros vs RDA */}
      <Card style={{ gap: spacing.md }}>
        <SectionHeader title="Micronutrientes (RDA)" />
        {(Object.keys(MICRO_RDA) as (keyof typeof MICRO_RDA)[]).map((key) => {
          const info = MICRO_RDA[key];
          const rda = key === 'iron_mg' ? ironRdaForSex(profile?.sex) : info.rda;
          const m = summary.micros[key];
          const fromFood = m.coverage >= 0.5 ? m.value : 0;
          const fromSupp = (suppContrib[key] as number | undefined) ?? 0;
          const total = fromFood + fromSupp;
          const pct = rda > 0 ? Math.min(1, total / rda) : 0;
          return (
            <View key={key} style={{ gap: 4 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: t.textSecondary, fontSize: 13, fontWeight: '600' }}>
                  {info.label}
                  {fromSupp > 0 ? ' 💊' : ''}
                </Text>
                <Text style={{ color: t.textMuted, fontSize: 12 }}>
                  {Math.round(total * 100) / 100}/{rda} {info.unit}
                  {m.totalEntries > 0 && m.coverage < 0.5 ? ' · datos incompletos' : ''}
                </Text>
              </View>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: t.separator, overflow: 'hidden' }}>
                <View
                  style={{
                    width: `${pct * 100}%`,
                    height: 6,
                    backgroundColor: pct >= 0.9 ? semantic.success : pct >= 0.5 ? semantic.warning : semantic.danger,
                  }}
                />
              </View>
            </View>
          );
        })}
        <Text style={{ color: t.textMuted, fontSize: 11 }}>
          El hierro vegetal (no hemo) se absorbe peor: considera acompañarlo de vitamina C.
        </Text>
      </Card>

      {/* Calorías últimos 7 días */}
      <Card style={{ gap: spacing.md }}>
        <SectionHeader title="Últimos 7 días" />
        <View style={{ height: 120 }}>
          <Svg width="100%" height="120" viewBox="0 0 300 120" preserveAspectRatio="none">
            <Polyline
              points={weekData
                .map((d, i) => `${(i / Math.max(weekData.length - 1, 1)) * 300},${120 - (d.calories / maxCal) * 110}`)
                .join(' ')}
              fill="none"
              stroke={semantic.success}
              strokeWidth={3}
            />
            {profile?.calorie_target ? (
              <Polyline
                points={`0,${120 - (profile.calorie_target / maxCal) * 110} 300,${120 - (profile.calorie_target / maxCal) * 110}`}
                fill="none"
                stroke={t.textMuted}
                strokeWidth={1}
                strokeDasharray="6 4"
              />
            ) : null}
          </Svg>
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          {weekData.map((d) => (
            <Text key={d.date} style={{ color: t.textMuted, fontSize: 10 }}>
              {d.date.slice(8)}
            </Text>
          ))}
        </View>
      </Card>
    </ScrollView>
  );
}
