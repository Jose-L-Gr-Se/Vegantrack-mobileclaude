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
import { summarizeEntries, MICRO_RDA, ironRdaForSex } from '@/utils/nutrition';
import { addDays, todayISO } from '@/utils/dates';
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

/** Un día de la serie de tendencias de micros: valor total (comida + suplementos) y % de la RDA. */
export interface MicroTrendPoint {
  date: string;
  micros: Record<MicroKey, { value: number; pct: number }>;
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

async function insertRemote(entry: NewFoodLogEntry): Promise<boolean> {
  const { error } = await supabase.from('food_log').insert(entry);
  // 23505 = clave duplicada: ya se sincronizó en un intento anterior
  if (error && error.code !== '23505') return false;
  return true;
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

    // 2. Remoto: fuente de verdad; al llegar, refresca espejo y estado
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

    // Intento remoto
    const ok = await insertRemote(entry);
    if (ok) {
      await mirrorMarkSynced('food_log', entry.id);
      // Racha en segundo plano (la PWA usa la RPC update_streak)
      void supabase.rpc('update_streak', { p_user_id: entry.user_id }).then(
        () => undefined,
        () => undefined
      );
    }
    // Sin red no es error: la entry queda pendiente de sincronizar
    return { error: null };
  },

  deleteEntry: async (id) => {
    set({ entries: get().entries.filter((e) => e.id !== id) });
    await mirrorMarkDeleted('food_log', id);

    const { error } = await supabase.from('food_log').delete().eq('id', id);
    if (!error) await mirrorRemove('food_log', id);
    return { error: null };
  },

  getDaySummary: () => summarizeEntries(get().entries, get().overrides ?? []),

  fetchRecentFoods: async (userId) => {
    // Agregamos los últimos 200 logs en cliente → top 20 por frecuencia
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

    const recents: RecentFood[] = [...byName.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 20)
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
      .select('id, nutrient_key, dose_amount')
      .eq('user_id', userId);
    const suppMap = new Map<string, { key: string | null; dose: number }>();
    for (const s of (suppRows ?? []) as { id: string; nutrient_key: string | null; dose_amount: number }[]) {
      suppMap.set(s.id, { key: s.nutrient_key, dose: s.dose_amount });
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

    // Aportes de suplementos por fecha y nutriente
    const suppByDate = new Map<string, Record<string, number>>();
    for (const log of (logRows ?? []) as { supplement_id: string; date: string }[]) {
      const m = suppMap.get(log.supplement_id);
      if (!m || !m.key) continue;
      const day = suppByDate.get(log.date) ?? {};
      day[m.key] = (day[m.key] ?? 0) + m.dose;
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
        // Misma semántica que el dashboard: la comida solo cuenta con cobertura ≥ 50 %
        const fromFood = agg.coverage >= 0.5 ? agg.value : 0;
        const fromSupp = suppContrib[key] ?? 0;
        const total = fromFood + fromSupp;
        micros[key] = { value: total, pct: rda > 0 ? total / rda : 0 };
      }
      points.push({ date, micros });
    }
    return points;
  },

  copyDayEntries: async (userId, fromDate, toDate) => {
    return copyEntries(userId, fromDate, toDate, null, get(), set);
  },

  copyMealEntries: async (userId, fromDate, toDate, mealType) => {
    return copyEntries(userId, fromDate, toDate, mealType, get(), set);
  },

  loadOverrides: async () => {
    const data = await loadOverrides();
    set({ overrides: data });
  },

  flushPending: async (userId) => {
    const pending = await mirrorPending<FoodLogEntry>('food_log', userId);
    for (const row of pending) {
      if (row.deleted) {
        const { error } = await supabase.from('food_log').delete().eq('id', row.id);
        if (!error) await mirrorRemove('food_log', row.id);
      } else {
        const { created_at, updated_at, ...insertable } = row.payload;
        if (await insertRemote(insertable as NewFoodLogEntry)) {
          await mirrorMarkSynced('food_log', row.id);
        }
      }
    }
  },
}));

async function copyEntries(
  userId: string,
  fromDate: string,
  toDate: string,
  mealType: string | null,
  state: DiaryState,
  set: (partial: Partial<DiaryState>) => void
): Promise<{ count: number; error: string | null }> {
  let query = supabase.from('food_log').select('*').eq('user_id', userId).eq('date', fromDate);
  if (mealType) query = query.eq('meal_type', mealType);
  const { data, error } = await query;
  if (error) return { count: 0, error: error.message };
  const source = (data ?? []) as FoodLogEntry[];
  if (source.length === 0) return { count: 0, error: null };

  const { uuidv4 } = await import('@/utils/uuid');
  const now = new Date().toISOString();
  const copies = source.map((e) => {
    const { created_at, updated_at, ...rest } = e;
    return { ...rest, id: uuidv4(), date: toDate };
  });

  const { error: insErr } = await supabase.from('food_log').insert(copies);
  if (insErr) return { count: 0, error: insErr.message };

  for (const c of copies) {
    await mirrorUpsert('food_log', entryToRow({ ...c, created_at: now } as FoodLogEntry), true);
  }
  if (state.selectedDate === toDate) {
    const local = await mirrorList<FoodLogEntry>('food_log', userId, toDate);
    set({ entries: local.map((r) => r.payload) });
  }
  return { count: copies.length, error: null };
}
