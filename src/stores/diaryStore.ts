/**
 * Diario nutricional, offline-first.
 *
 * Lecturas: espejo SQLite primero (instantáneo), refresco remoto en segundo
 * plano. Escrituras: SQLite con synced=0 → intento remoto → marca synced.
 * `flushPending()` reintenta creaciones/borrados pendientes (al arrancar o
 * recuperar conectividad).
 */
import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import {
  mirrorList,
  mirrorMarkDeleted,
  mirrorMarkSynced,
  mirrorPending,
  mirrorRemove,
  mirrorReplaceDay,
  mirrorUpsert,
} from '@/db/database';
import { loadOverrides, type NutrientOverride } from '@/lib/nutrientOverrides';
import { summarizeEntries, MICRO_RDA, ironRdaForSex, resolveMicroDisplay, type MicroConfidence } from '@/utils/nutrition';
import { normalizeSupplementDose } from '@/utils/supplementUnits';
import { addDays, todayISO } from '@/utils/dates';
import { isTransientSyncError, type SyncOpError } from '@/utils/syncError';
import { reportError } from '@/lib/errorReporting';
import { uuidv4 } from '@/utils/uuid';
import type { NewFoodLogEntry } from '@/utils/foodEntry';
import type { FoodLogEntry, NutrientSummary, RecentFood, Sex } from '@/types';

export interface WeekDay {
  date: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export type MicroKey = keyof NutrientSummary['micros'];

/**
 * Un día de la serie de tendencias de micros: valor total (comida +
 * suplementos) y % de la RDA. `value`/`pct` no cambian de significado
 * (consumidores existentes siguen funcionando sin tocarlos); `hasEntries` y
 * `confidence` son campos aditivos de la Fase 2 del P0 de micronutrientes
 * (docs/NUTRICION-MICRONUTRIENTES.md) para que un día sin ningún registro de
 * comida para ese nutriente (`hasEntries=false`) se pueda distinguir de un
 * día con un 0 confirmado — antes ambos eran indistinguibles en la serie.
 */
export interface MicroTrendPoint {
  date: string;
  micros: Record<MicroKey, { value: number; pct: number; hasEntries: boolean; confidence: MicroConfidence }>;
}

interface DiaryState {
  entries: FoodLogEntry[];
  selectedDate: string;
  loading: boolean;
  recentFoods: RecentFood[];
  overrides: NutrientOverride[] | null;

  setDate: (date: string) => void;
  fetchEntries: (userId: string, date: string) => Promise<void>;
  addEntry: (entry: NewFoodLogEntry) => Promise<{ error: string | null }>;
  deleteEntry: (id: string) => Promise<{ error: string | null }>;
  getDaySummary: () => NutrientSummary;
  fetchRecentFoods: (userId: string) => Promise<void>;
  getWeekData: (userId: string) => Promise<WeekDay[]>;
  getMicroTrends: (userId: string, days: number, sex: Sex | null | undefined) => Promise<MicroTrendPoint[]>;
  copyDayEntries: (userId: string, fromDate: string, toDate: string) => Promise<{ count: number; error: string | null }>;
  copyMealEntries: (userId: string, fromDate: string, toDate: string, mealType: string) => Promise<{ count: number; error: string | null }>;
  loadOverrides: () => Promise<void>;
  flushPending: (userId: string) => Promise<void>;
}

function entryToRow(e: FoodLogEntry | NewFoodLogEntry) {
  return { id: e.id, user_id: e.user_id, date: e.date, meal_type: e.meal_type, payload: e };
}

// Upsert por PK `id` (no insert): el mismo id puede llegar aquí tanto para
// un alta nueva (id nunca visto) como para una edición que reutiliza el id
// de la entry original (auditoría del Diario, Bug A — ver
// ProductDetailSheet.commit()). PostgREST resuelve el conflicto por la
// clave primaria por defecto sin necesitar `onConflict` explícito: si el id
// no existe, inserta; si ya existe, actualiza — exactamente lo que hacía
// antes la tolerancia a `23505` para un reintento del MISMO contenido, pero
// ahora también correcto cuando el contenido cambia de verdad (una edición).
async function upsertRemote(entry: NewFoodLogEntry): Promise<{ ok: boolean; error: SyncOpError | null }> {
  const { error } = await supabase.from('food_log').upsert(entry);
  if (error) return { ok: false, error };
  return { ok: true, error: null };
}

// Guard de concurrencia de `flushPending` (Fase 1 del P1 de sync, ver
// auditoría): dos disparos casi simultáneos (p. ej. `AppState` pasando a
// activo justo cuando también llega un evento de auth) no deben ejecutar dos
// pasadas a la vez sobre el mismo lote de pendientes. Module-level a
// propósito (no en el store de Zustand): es un lock de ejecución, no estado
// de UI, y así no dispara ningún render al cambiar. Una única variable para
// toda la app es correcta aquí porque sólo hay un usuario autenticado a la
// vez; si se llama con un userId distinto mientras hay un flush en curso,
// ese segundo flush no se pierde de verdad — simplemente se retoma en el
// próximo disparo (arranque, foco, o el próximo evento de auth), igual que
// ya ocurre hoy con cualquier pendiente no sincronizado.
let flushInFlight = false;

// ── Coordinación food_log: fetchEntries vs flushPending (P1 sync, auditoría
// final) ─────────────────────────────────────────────────────────────────
//
// Hallazgo: mirrorReplaceDay() (llamada por fetchEntries) hace
// `DELETE ... WHERE synced=1` usando los datos de un SELECT remoto que
// puede quedar obsoleto. Si flushPending() sincroniza una fila (la marca
// synced=1) justo entre ese SELECT y el DELETE, la fila desaparece del
// espejo local aunque ya está a salvo en el servidor — no hay pérdida real
// en Supabase, pero sí una desaparición temporal e injustificada de la UI.
// Ni el guard de tombstones de mirrorUpsert (protege sólo
// deleted=1 AND synced=0, un caso distinto: un borrado pendiente, no una
// fila viva en transición synced=0→1) ni flushInFlight (sólo protege
// flushPending contra SÍ MISMO) evitan esto, porque fetchEntries ni
// siquiera participa en ese mutex.
//
// Mecanismo: un mutex adicional y ortogonal, implementado como cola de
// promesas encadenadas (sin threshold de tiempo, sin nueva tabla/columna,
// sin dependencia nueva) que serializa dos secciones críticas sobre
// food_log: (a) el tramo SELECT remoto + mirrorReplaceDay de fetchEntries,
// y (b) el bucle completo de flushPending. Mientras una corre, la otra
// espera su turno — nunca se salta ni se cancela. Así, cuando
// mirrorReplaceDay ejecuta su DELETE, o no hay ningún flush concurrente
// tocando el espejo, o el flush ya terminó del todo y el propio SELECT
// (disparado DESPUÉS de esperar turno) ya habrá visto esa fila como
// remota. A nivel de tabla completa, no por fecha: más simple, y el coste
// de serializar un fetchEntries de un día con un flushPending que toca
// otro día es despreciable (flushPending suele ser rápido o no-op).
//
// No se aplica a weight_logs: weightStore.fetchLogs() no usa
// mirrorReplaceDay (hace mirrorUpsert fila a fila sin ningún DELETE
// masivo), así que no está expuesto a esta carrera — confirmado en la
// auditoría.
let foodLogLock: Promise<unknown> = Promise.resolve();

function withFoodLogLock<T>(fn: () => Promise<T>): Promise<T> {
  const turn = foodLogLock.then(fn);
  // Encadena el siguiente turno tras éste, éxito o error — así un fallo en
  // una pasada nunca deja la cola bloqueada para las siguientes.
  foodLogLock = turn.then(
    () => undefined,
    () => undefined
  );
  return turn;
}

export const useDiaryStore = create<DiaryState>((set, get) => ({
  entries: [],
  selectedDate: todayISO(),
  loading: false,
  recentFoods: [],
  overrides: null,

  setDate: (date) => set({ selectedDate: date }),

  fetchEntries: async (userId, date) => {
    set({ loading: true });

    // 1. Local primero: render inmediato (también sin red)
    try {
      const local = await mirrorList<FoodLogEntry>('food_log', userId, date);
      set({ entries: local.map((r) => r.payload), loading: false });
    } catch {
      // espejo no disponible: seguimos con remoto
    }

    // 2. Remoto: fuente de verdad. SELECT + mirrorReplaceDay como una única
    //    sección crítica frente a flushPending (ver withFoodLogLock arriba)
    //    — cierra la carrera de la auditoría final sin tocar
    //    mirrorReplaceDay ni el guard de tombstones (P0 ya cerrado).
    const merged = await withFoodLogLock(async () => {
      const { data, error } = await supabase
        .from('food_log')
        .select('*')
        .eq('user_id', userId)
        .eq('date', date)
        .order('created_at', { ascending: true });

      if (!error && data) {
        const remote = data as FoodLogEntry[];
        await mirrorReplaceDay(
          'food_log',
          userId,
          date,
          remote.map((e) => ({ id: e.id, meal_type: e.meal_type, payload: e }))
        );
        return true;
      }
      return false;
    });

    if (merged) {
      // Mezclar pendientes locales del día que aún no están en remoto
      const local = await mirrorList<FoodLogEntry>('food_log', userId, date);
      if (get().selectedDate === date) {
        set({ entries: local.map((r) => r.payload), loading: false });
      }
    } else {
      set({ loading: false });
    }
  },

  addEntry: async (entry) => {
    const now = new Date().toISOString();
    const full: FoodLogEntry = { ...entry, created_at: now, updated_at: now };

    // Escritura local inmediata
    await mirrorUpsert('food_log', entryToRow(full), false);
    if (get().selectedDate === entry.date) {
      set({ entries: [...get().entries, full] });
    }

    // Intento remoto + marca de sincronizado como una única sección crítica
    // frente a fetchEntries (ver withFoodLogLock arriba, auditoría del
    // Diario Bug B) — cierra la misma carrera que ya protegía flushPending:
    // sin esto, una entry que confirma justo cuando un fetchEntries
    // concurrente ya capturó una instantánea sin ella podría desaparecer
    // del espejo local al converger (mirrorReplaceDay borraría una fila
    // synced=1 que su SELECT obsoleto no incluía).
    const { ok, error } = await withFoodLogLock(async () => {
      const result = await upsertRemote(entry);
      if (result.ok) await mirrorMarkSynced('food_log', entry.id);
      return result;
    });

    if (ok) {
      // Racha en segundo plano (la PWA usa la RPC update_streak)
      void supabase.rpc('update_streak', { p_user_id: entry.user_id }).then(
        () => undefined,
        () => undefined
      );
      return { error: null };
    }
    if (error && !isTransientSyncError(error)) {
      // Error real del servidor (no de red, auditoría del Diario Bug C): la
      // entry queda pendiente en local — nunca se pierde, flushPending
      // seguirá reintentándola — pero el llamador (ProductDetailSheet)
      // debe saberlo para no dar por bueno un guardado que no ocurrió.
      return { error: error.message || 'No se pudo guardar el cambio en el servidor.' };
    }
    // Sin red: no es error, la entry queda pendiente de sincronizar.
    return { error: null };
  },

  deleteEntry: async (id) => {
    set({ entries: get().entries.filter((e) => e.id !== id) });
    await mirrorMarkDeleted('food_log', id);

    // Igual que en addEntry: el borrado remoto + mirrorRemove como una
    // única sección crítica frente a fetchEntries (Bug B). Sin esto, un
    // delete que confirma justo cuando un fetchEntries concurrente ya
    // capturó una instantánea CON esta fila podría resucitarla: al borrarse
    // localmente (mirrorRemove) ya no queda tombstone que el guard de
    // mirrorUpsert pueda proteger, y el mirrorReplaceDay de ese fetchEntries
    // la reinsertaría como si nunca se hubiera borrado.
    const { error } = await withFoodLogLock(async () => {
      const { error } = await supabase.from('food_log').delete().eq('id', id);
      if (!error) await mirrorRemove('food_log', id);
      return { error };
    });

    if (!error) return { error: null };
    if (!isTransientSyncError(error)) {
      // Error real (Bug C): la tombstone queda pendiente en local —
      // flushPending la reintentará — pero el llamador debe saberlo.
      return { error: error.message || 'No se pudo eliminar en el servidor.' };
    }
    // Sin red: no es error, la tombstone queda pendiente de sincronizar.
    return { error: null };
  },

  getDaySummary: () => summarizeEntries(get().entries, get().overrides ?? []),

  fetchRecentFoods: async (userId) => {
    // Últimos 200 logs → únicos por recencia (el primero de cada key es el más reciente)
    const { data, error } = await supabase
      .from('food_log')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error || !data) return;

    const byName = new Map<string, { entry: FoodLogEntry; count: number }>();
    for (const e of data as FoodLogEntry[]) {
      const key = `${e.food_name}|${e.brand ?? ''}`;
      const existing = byName.get(key);
      if (existing) existing.count += 1;
      else byName.set(key, { entry: e, count: 1 });
    }

    // Keep insertion order (= recency) instead of sorting by count
    const recents: RecentFood[] = [...byName.values()]
      .slice(0, 15)
      .map(({ entry: e, count }) => {
        const ratio = e.serving_size_g > 0 ? 100 / e.serving_size_g : 0;
        const per100 = (v: number | null) => (v === null ? null : Math.round(v * ratio * 100) / 100);
        return {
          food_name: e.food_name,
          barcode: e.barcode,
          brand: e.brand,
          image_url: e.image_url,
          calories_per_100g: Math.round(e.calories * ratio),
          protein_per_100g: per100(e.protein_g) ?? 0,
          carbs_per_100g: per100(e.carbs_g) ?? 0,
          fat_per_100g: per100(e.fat_g) ?? 0,
          fiber_per_100g: per100(e.fiber_g) ?? 0,
          sugar_per_100g: per100(e.sugar_g) ?? 0,
          saturated_fat_per_100g: per100(e.saturated_fat_g) ?? 0,
          sodium_per_100g: per100(e.sodium_mg) ?? 0,
          vitamin_b12_mcg_per_100g: per100(e.vitamin_b12_mcg),
          iron_mg_per_100g: per100(e.iron_mg),
          zinc_mg_per_100g: per100(e.zinc_mg),
          calcium_mg_per_100g: per100(e.calcium_mg),
          omega3_g_per_100g: per100(e.omega3_g),
          vitamin_d_mcg_per_100g: per100(e.vitamin_d_mcg),
          vitamin_b12_known: e.vitamin_b12_known,
          iron_known: e.iron_known,
          zinc_known: e.zinc_known,
          calcium_known: e.calcium_known,
          omega3_known: e.omega3_known,
          vitamin_d_known: e.vitamin_d_known,
          is_vegan: e.is_vegan,
          last_serving_g: e.serving_size_g,
          use_count: count,
        };
      });

    set({ recentFoods: recents });
  },

  getWeekData: async (userId) => {
    const end = get().selectedDate;
    const start = addDays(end, -6);
    const { data, error } = await supabase
      .from('food_log')
      .select('date, calories, protein_g, carbs_g, fat_g')
      .eq('user_id', userId)
      .gte('date', start)
      .lte('date', end);

    const days: WeekDay[] = [];
    for (let i = 0; i < 7; i++) {
      days.push({ date: addDays(start, i), calories: 0, protein: 0, carbs: 0, fat: 0 });
    }
    if (!error && data) {
      for (const row of data as { date: string; calories: number; protein_g: number; carbs_g: number; fat_g: number }[]) {
        const day = days.find((d) => d.date === row.date);
        if (day) {
          day.calories += row.calories || 0;
          day.protein += row.protein_g || 0;
          day.carbs += row.carbs_g || 0;
          day.fat += row.fat_g || 0;
        }
      }
    }
    return days;
  },

  getMicroTrends: async (userId, days, sex) => {
    const end = todayISO();
    const start = addDays(end, -(days - 1));

    // Comida del periodo (filas completas: necesitamos micros + flags known + source)
    const { data: foodRows } = await supabase
      .from('food_log')
      .select('*')
      .eq('user_id', userId)
      .gte('date', start)
      .lte('date', end);

    // Mapa de suplementos (activos e inactivos, para registros históricos)
    const { data: suppRows } = await supabase
      .from('supplements')
      .select('id, nutrient_key, dose_amount, dose_unit')
      .eq('user_id', userId);
    const suppMap = new Map<string, { key: string | null; amount: number; unit: string }>();
    for (const s of (suppRows ?? []) as { id: string; nutrient_key: string | null; dose_amount: number; dose_unit: string }[]) {
      suppMap.set(s.id, { key: s.nutrient_key, amount: s.dose_amount, unit: s.dose_unit });
    }

    // Tomas de suplementos del periodo
    const { data: logRows } = await supabase
      .from('supplement_logs')
      .select('supplement_id, date')
      .eq('user_id', userId)
      .gte('date', start)
      .lte('date', end);

    // Agrupar comida por fecha
    const foodByDate = new Map<string, FoodLogEntry[]>();
    for (const e of (foodRows ?? []) as FoodLogEntry[]) {
      const list = foodByDate.get(e.date) ?? [];
      list.push(e);
      foodByDate.set(e.date, list);
    }

    // Aportes de suplementos por fecha y nutriente. Misma puerta que
    // supplementStore.getTodayContributions(): sólo se suman dosis
    // normalizadas con status 'success' — needs_review/unsupported quedan
    // excluidas, nunca se asume que dose_amount ya está en la unidad
    // canónica (ver src/utils/supplementUnits.ts).
    const suppByDate = new Map<string, Record<string, number>>();
    for (const log of (logRows ?? []) as { supplement_id: string; date: string }[]) {
      const m = suppMap.get(log.supplement_id);
      if (!m || !m.key) continue;
      const normalized = normalizeSupplementDose({ amount: m.amount, unit: m.unit, nutrientKey: m.key });
      if (normalized.status !== 'success') continue;
      const day = suppByDate.get(log.date) ?? {};
      day[m.key] = (day[m.key] ?? 0) + normalized.canonicalAmount;
      suppByDate.set(log.date, day);
    }

    const overrides = get().overrides ?? [];
    const microKeys = Object.keys(MICRO_RDA) as MicroKey[];

    const points: MicroTrendPoint[] = [];
    for (let i = 0; i < days; i++) {
      const date = addDays(start, i);
      const summary = summarizeEntries(foodByDate.get(date) ?? [], overrides);
      const suppContrib = suppByDate.get(date) ?? {};

      const micros = {} as MicroTrendPoint['micros'];
      for (const key of microKeys) {
        const rda = key === 'iron_mg' ? ironRdaForSex(sex) : MICRO_RDA[key].rda;
        const agg = summary.micros[key];
        const fromSupp = suppContrib[key] ?? 0;
        // Misma cadena que el dashboard y VeganScore: resolveMicroDisplay es
        // la única fuente de esta decisión (docs/NUTRICION-MICRONUTRIENTES.md).
        const display = resolveMicroDisplay(agg, fromSupp, rda);
        micros[key] = {
          value: display.known,
          pct: display.pct,
          hasEntries: display.hasEntries,
          confidence: display.confidence,
        };
      }
      points.push({ date, micros });
    }
    return points;
  },

  copyDayEntries: async (userId, fromDate, toDate) => {
    return copyEntries(userId, fromDate, toDate, null, get(), set, get().addEntry);
  },

  copyMealEntries: async (userId, fromDate, toDate, mealType) => {
    return copyEntries(userId, fromDate, toDate, mealType, get(), set, get().addEntry);
  },

  loadOverrides: async () => {
    const data = await loadOverrides();
    set({ overrides: data });
  },

  flushPending: async (userId) => {
    // Sólo una pasada efectiva a la vez (ver `flushInFlight` arriba). Un
    // segundo disparo mientras hay uno en curso no hace nada — no es un
    // error, sólo redundante: el lote pendiente que traería sería el mismo
    // (o un subconjunto) del que ya está procesando la pasada en curso.
    if (flushInFlight) return;
    flushInFlight = true;
    try {
      await withFoodLogLock(async () => {
        const pending = await mirrorPending<FoodLogEntry>('food_log', userId);
        for (const row of pending) {
          if (row.deleted) {
            const { error } = await supabase.from('food_log').delete().eq('id', row.id);
            if (!error) {
              await mirrorRemove('food_log', row.id);
            } else if (!isTransientSyncError(error)) {
              // Sin red no se reporta (es el caso esperado, no un bug); un
              // error con código de servidor sí lo es — nunca cambia si se
              // reintenta: la tombstone sigue synced=0 en ambos casos.
              reportError(error, { tag: 'sync_flush_food_log', extra: { op: 'delete', code: error.code || 'unknown' } });
            }
          } else {
            const { created_at, updated_at, ...insertable } = row.payload;
            const { ok, error } = await upsertRemote(insertable as NewFoodLogEntry);
            if (ok) {
              await mirrorMarkSynced('food_log', row.id);
            } else if (error && !isTransientSyncError(error)) {
              reportError(error, { tag: 'sync_flush_food_log', extra: { op: 'upsert', code: error.code || 'unknown' } });
            }
          }
        }
      });
    } catch (err) {
      // Red de seguridad: una excepción inesperada (SQLite/JSON corrupto/
      // cualquier fallo local — no un {error} de Supabase, que ya se
      // clasifica arriba) nunca debe quedar como promesa no capturada. No
      // se marca nada como sincronizado ni se pierde la fila que estuviera
      // procesándose: sigue synced=0 tal cual estaba, se reintentará en el
      // siguiente flushPending — mismo comportamiento que un fallo de red,
      // sólo que éste sí se reporta (nunca sabríamos de él si no).
      reportError(err, { tag: 'sync_flush_food_log', extra: { op: 'unexpected' } });
    } finally {
      flushInFlight = false;
    }
  },
}));

/**
 * Copia comidas de un día (o de una comida concreta) a otro día — Diseño 1
 * de la auditoría del Diario (Bugs D y E). Cada copia se procesa como una
 * alta normal, reutilizando `addEntry()` tal cual: local primero,
 * `synced=0` si el intento remoto no confirma, coordinado con
 * `fetchEntries`/`flushPending` vía `withFoodLogLock` (ya integrado en
 * `addEntry`, sin tocarlo). Cero infraestructura de sync nueva aquí: sólo
 * generamos el id de cada copia, UNA vez, antes de cualquier intento de red
 * — igual que cualquier alta manual.
 *
 * Idempotencia sin idempotency-key: un reintento AUTOMÁTICO (flushPending)
 * nunca vuelve a pasar por esta función — opera directamente sobre las
 * filas ya persistidas en SQLite con su id ya fijado, y el upsert por PK
 * que ya usa `addEntry` las hace convergentes sin duplicar. Una segunda
 * pulsación DELIBERADA del usuario sí vuelve a ejecutar esta función desde
 * cero y genera un lote de ids nuevo — comportamiento correcto, no un bug
 * (ver auditoría).
 *
 * Secuencial a propósito (no Promise.all): mantiene el orden predecible y,
 * sobre todo, si una copia falla de forma no-transitoria a mitad del lote,
 * las anteriores ya quedaron creadas y las siguientes se siguen intentando
 * — nunca se aborta el resto en silencio.
 */
async function copyEntries(
  userId: string,
  fromDate: string,
  toDate: string,
  mealType: string | null,
  state: DiaryState,
  set: (partial: Partial<DiaryState>) => void,
  addEntry: DiaryState['addEntry']
): Promise<{ count: number; error: string | null }> {
  let query = supabase.from('food_log').select('*').eq('user_id', userId).eq('date', fromDate);
  if (mealType) query = query.eq('meal_type', mealType);
  const { data, error } = await query;
  if (error) {
    // Nunca el mensaje crudo de Postgrest/fetch (auditoría del Diario) — el
    // SELECT de origen sigue siendo remoto-primero en esta ronda (fuera de
    // alcance hacerlo offline-first), así que un fallo aquí no crea nada.
    return {
      count: 0,
      error: isTransientSyncError(error)
        ? 'Sin conexión. Comprueba tu conexión e inténtalo de nuevo.'
        : 'No se han podido leer las comidas a copiar.',
    };
  }
  const source = (data ?? []) as FoodLogEntry[];
  if (source.length === 0) return { count: 0, error: null };

  let count = 0;
  let hadNonTransientError = false;

  for (const sourceEntry of source) {
    const { id: _sourceId, date: _sourceDate, created_at, updated_at, ...rest } = sourceEntry;
    const copy: NewFoodLogEntry = { ...rest, id: uuidv4(), date: toDate };
    try {
      const { error: entryError } = await addEntry(copy);
      // addEntry() escribe SIEMPRE en local antes de cualquier intento
      // remoto — la copia queda registrada aunque su sincronización remota
      // falle o quede pendiente. `count` refleja exactamente eso: cuántas
      // quedaron registradas, no cuántas confirmaron ya en el servidor.
      count += 1;
      if (entryError) hadNonTransientError = true;
    } catch (err) {
      // No debería ocurrir en circunstancias normales (addEntry no lanza
      // hoy salvo un fallo local excepcional de SQLite) — pero si ocurriera,
      // no debe abortar el resto del lote: se reporta y se sigue con la
      // siguiente copia, conservando las que ya se crearon.
      hadNonTransientError = true;
      reportError(err, { tag: 'copy_entries', extra: { op: 'addEntry' } });
    }
  }

  if (state.selectedDate === toDate) {
    const local = await mirrorList<FoodLogEntry>('food_log', userId, toDate);
    set({ entries: local.map((r) => r.payload) });
  }

  return {
    count,
    error: hadNonTransientError
      ? 'Algunas comidas no se han podido sincronizar del todo; se reintentará automáticamente cuando haya conexión.'
      : null,
  };
}
