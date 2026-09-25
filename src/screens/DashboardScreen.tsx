/** Resumen: VeganScore con desglose, macros del día, micros vs RDA y gráfico 7 días. */
import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Polyline } from 'react-native-svg';
import { Card, MacroBar, ProgressRing, SectionHeader } from '@/components/ui';
import { VeganNutritionScoreTrend, type VeganNutritionTrendPoint } from '@/components/VeganNutritionScoreTrend';
import { radii, semantic, spacing, useTheme } from '@/theme';
import { useAuthStore } from '@/stores/authStore';
import { useDiaryStore, type WeekDay } from '@/stores/diaryStore';
import { useSupplementStore } from '@/stores/supplementStore';
import { usePro } from '@/hooks/usePro';
import { computeVeganScore, getScoreColor, getScoreLabel } from '@/utils/veganScore';
import { ironRdaForSex, MICRO_RDA, resolveMicroDisplay } from '@/utils/nutrition';
import { microRecommendationText } from '@/utils/microRecommendations';
import { describeAttentionBanner } from '@/utils/supplementDoseCopy';
import type { RootStackParamList } from '@/navigation/types';

export function DashboardScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { user, profile } = useAuthStore();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { isPro } = usePro();
  const diary = useDiaryStore();
  const supplementStore = useSupplementStore();
  const [weekData, setWeekData] = useState<WeekDay[]>([]);
  // Histórico de VeganScore nutricional (auditoría de histórico de
  // VeganScore) — 7 días fijos en esta ronda, igual para Free y Pro (Free ya
  // ve 7 días en Tendencias; ampliar esto a 30/90 para Pro queda para una
  // ronda futura, no es parte de este bloque).
  const [nutritionTrend, setNutritionTrend] = useState<VeganNutritionTrendPoint[]>([]);

  // La pantalla decide internamente qué rango puede ver cada usuario (7 días
  // para Free, 7/30/90 para Pro) — este punto de entrada ya no bloquea.
  const openMicroTrends = () => {
    navigation.navigate('MicroTrends');
  };

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      void diary.fetchEntries(user.id, diary.selectedDate);
      void diary.getWeekData(user.id).then(setWeekData);
      void supplementStore.fetchSupplements(user.id);
      void supplementStore.fetchTodayLogs(user.id);
      // Mismos objetivos/sexo ACTUALES del perfil que usa el VeganScore de
      // hoy — `profiles` no guarda su valor histórico (ver
      // `computeVeganNutritionScore`), así que cualquier día pasado se
      // puntúa con los objetivos de hoy. El propio bloque lo explica en su
      // pie de texto; no se oculta.
      void diary
        .getVeganNutritionScoreTrend(
          user.id,
          7,
          profile?.calorie_target ?? 0,
          profile?.protein_target_g ?? 0,
          profile?.sex ?? null
        )
        .then((points) => setNutritionTrend(points.map((p) => ({ date: p.date, score: p.score?.total ?? null }))));
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.id, diary.selectedDate, profile?.calorie_target, profile?.protein_target_g, profile?.sex])
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

  const calTarget = profile?.calorie_target ?? 0;
  const calProgress = calTarget > 0 ? Math.min(1, summary.calories / calTarget) : 0;
  const remaining = calTarget > 0 ? Math.max(0, calTarget - Math.round(summary.calories)) : null;

  // Fases 5 y 6 del P0 de unidades de suplementos: suplementos tomados HOY
  // cuya dosis quedó needs_review o unsupported (ambos ya excluidos de
  // suppContrib más arriba). Sólo hoy — a diferencia de las listas de
  // Diario/Perfil, que muestran todos los configurados aunque no se hayan
  // tomado. Nunca se muestra por micronutriente, ni entra en VeganScore ni
  // en Tendencias.
  const attentionToday = supplementStore
    .getTodayContributionDetails()
    .filter((d) => d.dose.status === 'needs_review' || d.dose.status === 'unsupported');
  const needsReviewCountToday = attentionToday.filter((d) => d.dose.status === 'needs_review').length;
  const unsupportedCountToday = attentionToday.filter((d) => d.dose.status === 'unsupported').length;
  const attentionBanner = describeAttentionBanner(needsReviewCountToday, unsupportedCountToday);

  const openSupplementReview = () => {
    if (attentionToday.length === 1) {
      navigation.navigate('Main', { screen: 'Profile', params: { openSupplementId: attentionToday[0].supplementId } });
    } else {
      navigation.navigate('Main', { screen: 'Profile', params: { openSupplements: true } });
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.background }}
      contentContainerStyle={{ padding: spacing.lg, paddingTop: insets.top + spacing.md, gap: spacing.lg, paddingBottom: spacing.xxl }}
    >
      <Text style={{ fontSize: 26, fontWeight: '700', color: t.text }}>Resumen</Text>

      {/* Hero: Calorías ring + macros compactos */}
      <Card style={{ gap: spacing.lg }}>
        {/* Calorie ring centrado */}
        <View style={{ alignItems: 'center' }}>
          <ProgressRing progress={calProgress} size={140} strokeWidth={12} color={semantic.success}>
            <Text style={{ fontSize: 34, fontWeight: '800', color: t.text }}>{Math.round(summary.calories)}</Text>
            <Text style={{ fontSize: 11, color: t.textMuted }}>kcal</Text>
          </ProgressRing>
          {calTarget > 0 ? (
            <Text style={{ color: t.textSecondary, fontSize: 13, marginTop: spacing.sm }}>
              {remaining !== null ? `${remaining} kcal restantes` : `Objetivo: ${calTarget} kcal`} · Objetivo: {calTarget}
            </Text>
          ) : null}
        </View>

        {/* 3 macro stats en fila */}
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          {[
            { label: 'Proteína', value: summary.protein_g, target: profile?.protein_target_g ?? 0, color: semantic.protein },
            { label: 'Carbs', value: summary.carbs_g, target: profile?.carbs_target_g ?? 0, color: semantic.carbs },
            { label: 'Grasas', value: summary.fat_g, target: profile?.fat_target_g ?? 0, color: semantic.fat },
          ].map(({ label, value, target, color }) => {
            const pct = target > 0 ? Math.min(1, value / target) : 0;
            return (
              <View
                key={label}
                style={{
                  flex: 1,
                  backgroundColor: t.background,
                  borderRadius: spacing.md,
                  padding: spacing.sm,
                  gap: 6,
                  borderWidth: 1,
                  borderColor: t.cardBorder,
                }}
              >
                <Text style={{ color: t.textSecondary, fontSize: 11, fontWeight: '600' }}>{label}</Text>
                <Text style={{ color: t.text, fontSize: 16, fontWeight: '800' }}>
                  {Math.round(value)}
                  <Text style={{ fontSize: 11, color: t.textMuted }}>g</Text>
                </Text>
                <View style={{ height: 4, borderRadius: 2, backgroundColor: t.separator, overflow: 'hidden' }}>
                  <View style={{ width: `${pct * 100}%`, height: 4, backgroundColor: color, borderRadius: 2 }} />
                </View>
                {target > 0 ? (
                  <Text style={{ color: t.textMuted, fontSize: 10 }}>{Math.round(target)}g obj.</Text>
                ) : null}
              </View>
            );
          })}
        </View>
      </Card>

      {/* VeganScore horizontal */}
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}>
        <ProgressRing progress={score.total / 100} size={80} strokeWidth={8} color={scoreColor}>
          <Text style={{ fontSize: 24, fontWeight: '800', color: t.text }}>{score.total}</Text>
        </ProgressRing>
        <View style={{ flex: 1, gap: spacing.sm }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontWeight: '800', fontSize: 16, color: t.text }}>VeganScore</Text>
            <Text style={{ fontWeight: '700', color: scoreColor, fontSize: 14 }}>{getScoreLabel(score.total)}</Text>
          </View>
          {breakdownRows.map(({ label, part }) => (
            <View key={label} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ color: t.textSecondary, fontSize: 12 }}>{label}</Text>
              <Text style={{ color: t.text, fontSize: 12, fontWeight: '600' }}>
                {part.score}/{part.max}
              </Text>
            </View>
          ))}
          {/* Auditoría de feedback nutricional: "Micros clave" (arriba) sólo
              cuenta B12, hierro y vitamina D — los otros 3 que se ven en la
              tarjeta "Micronutrientes (RDA)" más abajo (zinc, calcio,
              omega-3) no puntúan aquí. Sin esta aclaración, ambas tarjetas
              parecen hablar de lo mismo y pueden contradecirse: alguien con
              zinc/calcio/omega-3 impecables pero B12/hierro/vitamina D bajos
              vería un "Micros clave" bajo pese a la tarjeta de abajo en
              verde, y viceversa. */}
          <Text style={{ color: t.textMuted, fontSize: 10 }}>
            Micros clave: vitamina B12, hierro y vitamina D. El resto se detalla en Micronutrientes (RDA), más abajo.
          </Text>
        </View>
      </Card>

      {/* Histórico de VeganScore nutricional — sin racha, ver componente */}
      <VeganNutritionScoreTrend points={nutritionTrend} />

      {/* Macros detallados */}
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
          const agg = summary.micros[key];
          const fromSupp = (suppContrib[key] as number | undefined) ?? 0;
          const display = resolveMicroDisplay(agg, fromSupp, rda);
          // pct siempre viene del conocido real (comida + suplemento): la
          // barra refleja progreso real hacia la RDA, nunca se recorta por
          // baja cobertura. El color de la barra depende SÓLO de pct — la
          // confianza es una señal aparte, en el texto de abajo.
          const pct = rda > 0 ? Math.min(1, display.pct) : 0;

          // Nota de confianza, separada del progreso. `confidence` ya
          // distingue día sin registros ('none') de registrado-pero-sin-dato
          // (coverageByGrams=0 con hasEntries=true, que cae en 'low').
          let note = '';
          if (display.confidence === 'none') {
            note = display.supplement > 0 ? ' · solo suplemento' : ' · sin datos suficientes';
          } else if (display.confidence === 'low') {
            note = ' · datos incompletos';
          } else if (display.confidence === 'medium') {
            note = ` · cobertura de datos: ${Math.round(display.coverageByGrams * 100)}%`;
          }

          // Dashboard accionable: recomendación alimentaria genérica sólo
          // cuando está baja (pct < 0.9) Y el dato del día es suficientemente
          // fiable (confidence >= MIN_SCORE_CONFIDENCE) — misma regla que ya
          // usa VeganScore, sin reimplementar el umbral aquí.
          const recommendation = microRecommendationText(key, display);

          return (
            <View key={key} style={{ gap: 4 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: t.textSecondary, fontSize: 13, fontWeight: '600' }}>
                  {info.label}
                  {display.supplement > 0 ? ' 💊' : ''}
                </Text>
                <Text style={{ color: t.textMuted, fontSize: 12 }}>
                  {Math.round(display.known * 100) / 100}/{rda} {info.unit}
                  {note}
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
              {recommendation ? (
                <Text style={{ color: t.textMuted, fontSize: 11 }}>{recommendation}</Text>
              ) : null}
            </View>
          );
        })}
        <Text style={{ color: t.textMuted, fontSize: 11 }}>
          El hierro vegetal (no hemo) se absorbe peor: considera acompañarlo de vitamina C.
        </Text>
      </Card>

      {/* Suplementos que necesitan atención — needs_review y unsupported (Fases 5 y 6) */}
      {attentionBanner ? (
        <Pressable onPress={openSupplementReview}>
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: radii.md,
                backgroundColor: t.background,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name={'alert-circle-outline' as never} size={20} color={semantic.warning} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '700', fontSize: 14, color: t.text }}>{attentionBanner}</Text>
            </View>
            <Ionicons name={'chevron-forward' as never} size={18} color={t.textMuted} />
          </Card>
        </Pressable>
      ) : null}

      {/* Tendencias de micros — 7 días gratis, 30/90 días con Pro */}
      <Pressable onPress={openMicroTrends}>
        <Card
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.md,
            backgroundColor: t.primarySoft,
            borderColor: t.primary,
          }}
        >
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: radii.md,
              backgroundColor: t.card,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name={'trending-up' as never} size={20} color={t.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: '700', fontSize: 15, color: t.text }}>Tendencias de micros</Text>
            <Text style={{ color: t.textSecondary, fontSize: 12, marginTop: 2 }}>
              {isPro
                ? 'Evolución de B12, hierro y omega-3 · 7, 30 y 90 días'
                : '7 días gratis · Pro desbloquea 30 y 90 días'}
            </Text>
          </View>
          <Ionicons name={'chevron-forward' as never} size={18} color={t.textMuted} />
        </Card>
      </Pressable>

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
