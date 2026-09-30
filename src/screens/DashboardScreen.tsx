/** Resumen: VeganScore con desglose, macros del día, micros vs RDA y gráfico 7 días. */
import React, { useCallback, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Polyline } from 'react-native-svg';
import { Button, Card, MacroBar, Pill, ProgressRing, SectionHeader } from '@/components/ui';
import { VeganNutritionScoreTrend, type VeganNutritionTrendPoint } from '@/components/VeganNutritionScoreTrend';
import { radii, semantic, spacing, useTheme } from '@/theme';
import { useAuthStore } from '@/stores/authStore';
import { useDiaryStore, type MicroKey, type MicroTrendPoint, type WeekDay } from '@/stores/diaryStore';
import { useSupplementStore } from '@/stores/supplementStore';
import { usePro } from '@/hooks/usePro';
import { computeVeganScore } from '@/utils/veganScore';
import { ironRdaForSex, MICRO_RDA, resolveMicroDisplay, type MicroDisplay } from '@/utils/nutrition';
import { microRecommendationText } from '@/utils/microRecommendations';
import { buildNutritionInsight, describeInsightPriority } from '@/utils/nutritionInsight';
import { describeAttentionBanner } from '@/utils/supplementDoseCopy';
import { todayISO } from '@/utils/dates';
import { effectiveStreak } from '@/utils/streak';
import { mealTypeForHour } from '@/utils/foodEntry';
import { deriveDayState, describeNextStep } from '@/utils/todayProgress';
import { track } from '@/lib/analytics';
import { hasLoggedFood } from '@/lib/foodLoggingHistory';
import type { RootStackParamList } from '@/navigation/types';

/** Días que pide `getMicroTrends` para la ventana del sistema de patrones
 *  nutricionales (auditoría del sistema de patrones): 7 días terminados hoy
 *  — hoy se calcula en vivo más abajo, no desde el histórico, así que sólo
 *  se guardan los 6 días ANTERIORES (`.slice(0, -1)` descarta el punto de
 *  hoy que también devuelve `getMicroTrends`). */
const INSIGHT_HISTORY_DAYS = 7;

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
  // Nutrition Insight: los hasta 6 días ANTERIORES a hoy (hoy se calcula en
  // vivo más abajo, igual que el resto de la pantalla) — sólo para saber si
  // un micro bajo hoy también lo estuvo en lo registrado esos días, y así
  // poder distinguir "hoy" de "patrón" sin inventar nada.
  const [microHistory, setMicroHistory] = useState<MicroTrendPoint[]>([]);
  // Señal de producto "ha registrado alguna vez" (`foodLoggingHistory`).
  // `null` mientras se lee: ver `isFirstUse` más abajo.
  const [loggedBeforeHere, setLoggedBeforeHere] = useState<boolean | null>(null);

  // La pantalla decide internamente qué rango puede ver cada usuario (7 días
  // para Free, 7/30/90 para Pro) — este punto de entrada ya no bloquea.
  const openMicroTrends = (initialMicro?: MicroKey) => {
    navigation.navigate('MicroTrends', initialMicro ? { initialMicro } : undefined);
  };

  // Nutrition Insight accionable: lleva a la pestaña de Buscar ya existente,
  // contextualizada con el micro de la prioridad — nunca una búsqueda nueva
  // ni una lista de alimentos filtrada, el usuario decide qué buscar y añadir.
  const openFoodSearch = (nutrient: MicroKey) => {
    navigation.navigate('Main', { screen: 'Search', params: { nutrient } });
  };

  // `dashboard_viewed`: una vez por VISITA real al Resumen (cada foco), nunca
  // por render. Este efecto — declarado antes que el de carga, así que se
  // ejecuta primero en cada foco — sólo marca la visita como pendiente de
  // contar; el de carga la cuenta cuando `fetchEntries` termina (ver
  // `reportView`). Si el efecto de carga se repite estando ya enfocado (sus
  // dependencias de perfil cambian), la visita ya está contada y no se
  // duplica.
  const viewPendingRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      viewPendingRef.current = true;
    }, [])
  );

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      const today = todayISO();
      // El estado se calcula al terminar la carga de hoy (éxito o fallo de
      // red: `fetchEntries` ya ha volcado antes el espejo local), leyendo los
      // stores en ese momento — no el render en curso, que aún puede traer
      // las entradas de otra fecha del Diario.
      const reportView = () => {
        if (!viewPendingRef.current) return;
        viewPendingRef.current = false;
        try {
          const diaryNow = useDiaryStore.getState();
          if (diaryNow.selectedDate !== today) return;
          const state = deriveDayState({
            entries: diaryNow.entries,
            today,
            calories: diaryNow.getDaySummary().calories,
            calorieTarget: useAuthStore.getState().profile?.calorie_target ?? 0,
          });
          void track('dashboard_viewed', { state });
        } catch {
          // Analítica best-effort: nunca rompe la pantalla.
        }
      };
      // Auditoría del VeganScore: el Dashboard no tiene selector de fecha
      // propio — todo lo que muestra ("Macros de hoy", el VeganScore, el
      // gráfico semanal) asume "hoy" sin más. Pero `entries`/
      // `getDaySummary()`/`getWeekData()` leen `selectedDate`, un estado
      // COMPARTIDO con el Diario: si el usuario había navegado el Diario a
      // un día pasado y abría el Dashboard sin volver antes a hoy, estas
      // tarjetas mostraban en silencio los datos de ESE día pasado bajo el
      // rótulo "hoy" — sin ningún indicador de que no lo era, y en
      // contradicción directa con el histórico de VeganScore nutricional de
      // más abajo (`getVeganNutritionScoreTrend`), que sí ancla siempre su
      // último punto en `todayISO()` real. Forzar aquí la fecha selecciona
      // a hoy es lo único coherente con lo que el propio Dashboard afirma
      // mostrar — no cambia la fórmula del VeganScore ni ningún criterio
      // nutricional, sólo qué día se le pasa.
      diary.setDate(today);
      void diary.fetchEntries(user.id, today).then(reportView, reportView);
      void hasLoggedFood(user.id).then(setLoggedBeforeHere);
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
      // Primer Nutrition Insight: reutiliza exactamente el mismo
      // `getMicroTrends()` ya usado por "Tendencias de micros" — ninguna
      // consulta ni agregación nueva. El último punto (hoy) se descarta: el
      // insight usa el `today` calculado en vivo más abajo, igual que el
      // resto del Dashboard; sólo se guardan los días ANTERIORES.
      void diary
        .getMicroTrends(user.id, INSIGHT_HISTORY_DAYS, profile?.sex ?? null)
        .then((points) => setMicroHistory(points.slice(0, -1)));
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.id, profile?.calorie_target, profile?.protein_target_g, profile?.sex])
  );

  const summary = diary.getDaySummary();
  const score = computeVeganScore({
    summary,
    calorieTarget: profile?.calorie_target ?? 0,
    proteinTarget: profile?.protein_target_g ?? 0,
    streakCount: effectiveStreak(profile?.streak_count, profile?.last_log_date, todayISO()),
    suppContributions: supplementStore.getTodayContributions(),
    sex: profile?.sex ?? null,
  });
  // Resumen como "día en curso": este VegeScore es SIEMPRE el de hoy (el
  // foco fuerza `todayISO()`), un día que todavía está ocurriendo — un
  // desayuno de 400 kcal daba ≈3/100 en rojo con "Mejorable 🌱", un veredicto
  // sobre un día sin terminar. La fórmula no cambia; sólo su presentación:
  // número visible, aro en color neutro (ni `getScoreColor` ni `getScoreLabel`,
  // tampoco `t.primary`, que es el mismo verde que el tramo "Excelente") e
  // insignia "Hasta ahora". Los días pasados sólo aparecen en la tendencia
  // de abajo, que conserva su comportamiento para ellos; su punto de hoy se
  // marca como "en curso" (`inProgressDate`), sin color ni media.
  const today = todayISO();
  const calTarget = profile?.calorie_target ?? 0;
  const dayState = deriveDayState({ entries: diary.entries, today, calories: summary.calories, calorieTarget: calTarget });
  // Primer uso = ninguna señal existente dice que haya registrado alguna vez:
  // - `last_log_date` (servidor, cacheado en local): `update_streak` lo deja
  //   nulo si no queda ninguna fila en `food_log` — también si el usuario
  //   BORRÓ todo su historial, así que por sí solo no basta.
  // - la señal de producto local `has_logged_food` (`foodLoggingHistory`),
  //   que sí sobrevive a ese borrado (en este dispositivo). Nunca la marca
  //   de analítica `first_food_logged_tracked`, que depende de que un
  //   insert de analítica tenga éxito.
  // Ante la duda — perfil sin cargar o marca aún sin leer — nunca se asume
  // primer uso: el texto de "usuario que vuelve" es cierto para cualquiera,
  // el de "primera vez" no.
  const isFirstUse = profile != null && profile.last_log_date == null && loggedBeforeHere === false;
  const nextMealType = mealTypeForHour(new Date().getHours());
  const nextStep = describeNextStep({
    state: dayState,
    isFirstUse,
    mealType: nextMealType,
    calories: summary.calories,
    calorieTarget: calTarget,
    proteinG: summary.protein_g,
    proteinTarget: profile?.protein_target_g ?? 0,
  });

  // Único siguiente paso: la misma navegación a Buscar que el "＋" de cada
  // comida del Diario, con la franja actual — sin `fromActivation`, así que
  // tras guardar se vuelve al destino de siempre.
  const onNextStep = () => {
    void track('next_step_tapped', { state: dayState, meal_type: nextMealType });
    navigation.navigate('Main', { screen: 'Search', params: { mealType: nextMealType } });
  };

  const breakdownRows = [
    { label: 'Calorías', part: score.calories },
    { label: 'Proteína', part: score.protein },
    { label: 'Micros clave', part: score.micros },
    { label: 'Fibra', part: score.fiber },
    { label: 'Racha', part: score.streak },
  ];

  const suppContrib = supplementStore.getTodayContributions();

  // Un único `MicroDisplay` por nutriente, calculado UNA vez — lo consume
  // tanto la tarjeta "Micronutrientes (RDA)" de abajo como el Nutrition
  // Insight, para que nunca puedan mostrar cifras distintas del mismo día.
  const todayMicroDisplays = Object.fromEntries(
    (Object.keys(MICRO_RDA) as MicroKey[]).map((key) => {
      const rda = key === 'iron_mg' ? ironRdaForSex(profile?.sex) : MICRO_RDA[key].rda;
      const fromSupp = (suppContrib[key] as number | undefined) ?? 0;
      return [key, resolveMicroDisplay(summary.micros[key], fromSupp, rda)];
    })
  ) as Record<MicroKey, MicroDisplay>;

  // Primer Nutrition Insight (PRODUCT.md §8/§9): hasta 3 prioridades de hoy,
  // sólo cuando el dato es suficientemente fiable — `buildNutritionInsight`
  // reutiliza exactamente la misma regla que ya decide la recomendación bajo
  // cada barra de micro, así que sin comida registrada hoy (o con datos
  // insuficientes en los 6) esta lista sale vacía de forma natural, sin
  // ninguna comprobación aparte.
  const insightPriorities = buildNutritionInsight(todayMicroDisplays, microHistory);

  const maxCal = Math.max(...weekData.map((d) => d.calories), profile?.calorie_target ?? 0, 1);

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
        {/* Estado del día: hoy siempre está en curso — nunca "completo" */}
        <Text style={{ color: t.textSecondary, fontSize: 13, fontWeight: '600', textAlign: 'center' }}>
          {dayState === 'empty' ? 'Hoy · aún sin registros' : 'Hoy · en curso'}
        </Text>
        {/* Calorie ring centrado */}
        <View style={{ alignItems: 'center', marginTop: -spacing.sm }}>
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

      {/* Siguiente paso: la única acción primaria de la pantalla. Siempre
          presente en el Resumen de hoy, construida sólo con datos locales. */}
      <Card style={{ gap: spacing.md }}>
        <SectionHeader title={nextStep.title} />
        <Text style={{ color: t.textSecondary, fontSize: 13, lineHeight: 18, marginTop: -spacing.sm }}>
          {nextStep.context}
        </Text>
        <Button title={nextStep.cta} onPress={onNextStep} />
      </Card>

      {/* VegeScore de hoy — "Hasta ahora", sin veredicto (ver `dayState`) */}
      {dayState === 'empty' ? (
        <Card style={{ gap: spacing.xs }}>
          <Text style={{ fontWeight: '800', fontSize: 16, color: t.text }}>VegeScore de hoy</Text>
          <Text style={{ color: t.textSecondary, fontSize: 12 }}>
            Tu VegeScore aparecerá cuando registres tu primera comida.
          </Text>
          <Text style={{ color: t.textMuted, fontSize: 11 }}>
            Resume de 0 a 100 tus calorías, proteína, micros clave, fibra y racha.
          </Text>
        </Card>
      ) : (
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}>
          <ProgressRing progress={score.total / 100} size={80} strokeWidth={8} color={t.textSecondary}>
            <Text style={{ fontSize: 24, fontWeight: '800', color: t.text }}>{score.total}</Text>
          </ProgressRing>
          <View style={{ flex: 1, gap: spacing.sm }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontWeight: '800', fontSize: 16, color: t.text }}>VegeScore de hoy</Text>
              <Pill text="Hasta ahora" color={t.textSecondary} />
            </View>
            {/* Sólo puntos/máximo por fila: las etiquetas de cada parte
                ("Lejos", "Muy bajo"…) no se muestran, igual que antes. */}
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
            <Text style={{ color: t.textMuted, fontSize: 11 }}>
              Cambia a medida que registras. No es una valoración de tu día completo.
            </Text>
          </View>
        </Card>
      )}

      {/* Primer Nutrition Insight — "¿qué debería vigilar hoy?" (PRODUCT.md
          §8/§9, Pilar C). Sólo aparece con datos suficientes: si hoy no hay
          comida registrada, o los 6 micros están bien o con dato insuficiente,
          `insightPriorities` sale vacío y la tarjeta no se pinta — nunca un
          "todo bien" ni una alarma sin base real. */}
      {insightPriorities.length > 0 ? (
        <Card style={{ gap: spacing.md }}>
          <SectionHeader title="Qué vigilar hoy" />
          <Text style={{ color: t.textMuted, fontSize: 11, marginTop: -spacing.sm }}>
            Observaciones sobre lo que has registrado, no sobre toda tu alimentación. No es un diagnóstico.
          </Text>
          {insightPriorities.map((p) => (
            <Pressable
              key={p.key}
              onPress={() => openMicroTrends(p.key)}
              style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }}
            >
              <Ionicons
                name={(p.urgency === 'pattern' ? 'trending-down' : 'alert-circle-outline') as never}
                size={18}
                color={semantic.warning}
                style={{ marginTop: 2 }}
              />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: t.text, fontWeight: '700', fontSize: 14 }}>
                  {p.label}{' '}
                  <Text style={{ color: t.textMuted, fontWeight: '600', fontSize: 12 }}>
                    · {describeInsightPriority(p)}
                  </Text>
                </Text>
                <Text style={{ color: t.textSecondary, fontSize: 12 }}>{p.reason}</Text>
                {/* Acción concreta (Nutrition Insight accionable): lleva a la
                    búsqueda de alimentos ya existente, nunca una recomendación
                    de cantidad — el usuario decide qué y cuánto registrar.
                    Mismo patrón Pressable+Pill que "Alternativas 🌱" en
                    SearchScreen, para no introducir un nuevo tipo de botón. */}
                <Pressable onPress={() => openFoodSearch(p.key)} hitSlop={6} style={{ marginTop: 2 }}>
                  <Pill text="Ver alimentos" color={t.primary} />
                </Pressable>
              </View>
              <Ionicons name={'chevron-forward' as never} size={16} color={t.textMuted} style={{ marginTop: 2 }} />
            </Pressable>
          ))}
        </Card>
      ) : null}

      {/* Histórico de VeganScore nutricional — sin racha, ver componente */}
      <VeganNutritionScoreTrend points={nutritionTrend} inProgressDate={today} />

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
          // Mismo MicroDisplay que usa el Nutrition Insight de arriba — una
          // única fuente, nunca dos cálculos que puedan divergir.
          const display = todayMicroDisplays[key];
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
      <Pressable onPress={() => openMicroTrends()}>
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
