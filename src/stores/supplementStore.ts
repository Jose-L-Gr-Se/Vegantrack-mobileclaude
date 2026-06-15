/**
 * Suplementos y registro diario de tomas. Lecturas con caché kv (offline);
 * el toggle es optimista como en la PWA.
 */
import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import { kvGet, kvSet } from '@/db/database';
import { uuidv4 } from '@/utils/uuid';
import { todayISO } from '@/utils/dates';
import type { Supplement, SupplementNutrientKey } from '@/types';

export interface SupplementPreset {
  name: string;
  nutrient_key: SupplementNutrientKey | null;
  dose_amount: number;
  dose_unit: string;
  emoji: string;
}

/** Presets habituales en dietas veganas (mismos que la PWA, ampliados). */
export const SUPPLEMENT_PRESETS: SupplementPreset[] = [
  { name: 'Vitamina B12', nutrient_key: 'vitamin_b12_mcg', dose_amount: 25, dose_unit: 'mcg', emoji: '💊' },
  { name: 'Vitamina D3 vegana', nutrient_key: 'vitamin_d_mcg', dose_amount: 25, dose_unit: 'mcg', emoji: '☀️' },
  { name: 'Omega-3 (DHA+EPA de algas)', nutrient_key: 'omega3_g', dose_amount: 0.5, dose_unit: 'g', emoji: '🌊' },
  { name: 'Yodo', nutrient_key: 'iodine_mcg', dose_amount: 150, dose_unit: 'mcg', emoji: '🧂' },
  { name: 'Hierro', nutrient_key: 'iron_mg', dose_amount: 14, dose_unit: 'mg', emoji: '🩸' },
  { name: 'Zinc', nutrient_key: 'zinc_mg', dose_amount: 10, dose_unit: 'mg', emoji: '⚡' },
  { name: 'Calcio', nutrient_key: 'calcium_mg', dose_amount: 500, dose_unit: 'mg', emoji: '🦴' },
  { name: 'Magnesio', nutrient_key: null, dose_amount: 300, dose_unit: 'mg', emoji: '🌙' },
  { name: 'Selenio', nutrient_key: null, dose_amount: 55, dose_unit: 'mcg', emoji: '🛡️' },
  { name: 'Creatina', nutrient_key: null, dose_amount: 5, dose_unit: 'g', emoji: '💪' },
  { name: 'Multivitamínico', nutrient_key: null, dose_amount: 1, dose_unit: 'cápsula', emoji: '🌈' },
  { name: 'Probiótico', nutrient_key: null, dose_amount: 1, dose_unit: 'cápsula', emoji: '🦠' },
];

interface SupplementState {
  supplements: Supplement[];
  takenToday: Record<string, string>; // supplement_id -> log id
  loading: boolean;
  fetchSupplements: (userId: string) => Promise<void>;
  fetchTodayLogs: (userId: string) => Promise<void>;
  createSupplement: (userId: string, s: Omit<Supplement, 'id' | 'user_id' | 'created_at' | 'frequency' | 'is_active' | 'sort_order'>) => Promise<{ error: string | null }>;
  updateSupplement: (id: string, patch: Partial<Pick<Supplement, 'name' | 'dose_amount' | 'dose_unit' | 'nutrient_key' | 'emoji'>>) => Promise<{ error: string | null }>;
  deleteSupplement: (id: string) => Promise<{ error: string | null }>;
  toggleTaken: (userId: string, supplementId: string) => Promise<void>;
  getTodayContributions: () => Partial<Record<string, number>>;
}

export const useSupplementStore = create<SupplementState>((set, get) => ({
  supplements: [],
  takenToday: {},
  loading: false,

  fetchSupplements: async (userId) => {
    set({ loading: true });
    const cached = await kvGet<Supplement[]>(`supplements:${userId}`);
    if (cached) set({ supplements: cached });

    const { data, error } = await supabase
      .from('supplements')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (!error && data) {
      set({ supplements: data as Supplement[] });
      void kvSet(`supplements:${userId}`, data);
    }
    set({ loading: false });
  },

  fetchTodayLogs: async (userId) => {
    const { data, error } = await supabase
      .from('supplement_logs')
      .select('id, supplement_id')
      .eq('user_id', userId)
      .eq('date', todayISO());
    if (!error && data) {
      const map: Record<string, string> = {};
      for (const row of data as { id: string; supplement_id: string }[]) {
        map[row.supplement_id] = row.id;
      }
      set({ takenToday: map });
    }
  },

  createSupplement: async (userId, s) => {
    const supplement: Supplement = {
      ...s,
      id: uuidv4(),
      user_id: userId,
      frequency: 'daily',
      is_active: true,
      sort_order: get().supplements.length,
      created_at: new Date().toISOString(),
    };
    const { created_at, ...insertable } = supplement;
    const { error } = await supabase.from('supplements').insert(insertable);
    if (error) return { error: error.message };
    set({ supplements: [...get().supplements, supplement] });
    return { error: null };
  },

  updateSupplement: async (id, patch) => {
    const prev = get().supplements;
    // Optimista: refleja el cambio al instante
    set({
      supplements: prev.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    });
    const { error } = await supabase.from('supplements').update(patch).eq('id', id);
    if (error) {
      set({ supplements: prev });
      return { error: error.message };
    }
    return { error: null };
  },

  deleteSupplement: async (id) => {
    const prev = get().supplements;
    set({ supplements: prev.filter((s) => s.id !== id) });
    const { error } = await supabase.from('supplements').update({ is_active: false }).eq('id', id);
    if (error) {
      set({ supplements: prev });
      return { error: error.message };
    }
    return { error: null };
  },

  toggleTaken: async (userId, supplementId) => {
    const taken = get().takenToday;
    const existingLogId = taken[supplementId];

    if (existingLogId) {
      // Optimista: desmarcar
      const { [supplementId]: _, ...rest } = taken;
      set({ takenToday: rest });
      const { error } = await supabase.from('supplement_logs').delete().eq('id', existingLogId);
      if (error) set({ takenToday: taken });
    } else {
      const logId = uuidv4();
      set({ takenToday: { ...taken, [supplementId]: logId } });
      const { error } = await supabase.from('supplement_logs').insert({
        id: logId,
        user_id: userId,
        supplement_id: supplementId,
        date: todayISO(),
        taken_at: new Date().toISOString(),
      });
      if (error) set({ takenToday: taken });
    }
  },

  /** Suma de nutrientes aportados por suplementos tomados hoy (para VeganScore). */
  getTodayContributions: () => {
    const { supplements, takenToday } = get();
    const contributions: Partial<Record<string, number>> = {};
    for (const s of supplements) {
      if (!s.nutrient_key || !takenToday[s.id]) continue;
      contributions[s.nutrient_key] = (contributions[s.nutrient_key] ?? 0) + s.dose_amount;
    }
    return contributions;
  },
}));
