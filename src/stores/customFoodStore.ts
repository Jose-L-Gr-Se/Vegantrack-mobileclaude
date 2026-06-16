/** Alimentos personalizados del usuario. Lecturas con caché kv para offline. */
import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import { kvGet, kvSet } from '@/db/database';
import { uuidv4 } from '@/utils/uuid';
import type { CustomFood, FoodPer100g } from '@/types';

interface CustomFoodState {
  customFoods: CustomFood[];
  loading: boolean;
  fetchCustomFoods: (userId: string) => Promise<void>;
  searchCustomFoods: (query: string) => CustomFood[];
  createCustomFood: (userId: string, food: Omit<CustomFood, 'id' | 'user_id' | 'created_at' | 'updated_at'>) => Promise<{ error: string | null }>;
  updateCustomFood: (id: string, patch: Partial<Omit<CustomFood, 'id' | 'user_id' | 'created_at' | 'updated_at'>>) => Promise<{ error: string | null }>;
  deleteCustomFood: (id: string) => Promise<{ error: string | null }>;
}

const normalize = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export const useCustomFoodStore = create<CustomFoodState>((set, get) => ({
  customFoods: [],
  loading: false,

  fetchCustomFoods: async (userId) => {
    set({ loading: true });
    const cached = await kvGet<CustomFood[]>(`custom_foods:${userId}`);
    if (cached) set({ customFoods: cached });

    const { data, error } = await supabase
      .from('custom_foods')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (!error && data) {
      set({ customFoods: data as CustomFood[] });
      void kvSet(`custom_foods:${userId}`, data);
    }
    set({ loading: false });
  },

  searchCustomFoods: (query) => {
    const q = normalize(query.trim());
    if (q.length < 2) return [];
    return get().customFoods.filter(
      (f) => normalize(f.name).includes(q) || (f.brand && normalize(f.brand).includes(q))
    );
  },

  createCustomFood: async (userId, food) => {
    const now = new Date().toISOString();
    const full: CustomFood = { ...food, id: uuidv4(), user_id: userId, created_at: now, updated_at: now };
    const { created_at, updated_at, ...insertable } = full;
    const { error } = await supabase.from('custom_foods').insert(insertable);
    if (error) return { error: error.message };
    const next = [full, ...get().customFoods];
    set({ customFoods: next });
    void kvSet(`custom_foods:${userId}`, next);
    return { error: null };
  },

  updateCustomFood: async (id, patch) => {
    const { error } = await supabase.from('custom_foods').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) return { error: error.message };
    const next = get().customFoods.map((f) => (f.id === id ? { ...f, ...patch, updated_at: new Date().toISOString() } : f));
    set({ customFoods: next });
    return { error: null };
  },

  deleteCustomFood: async (id) => {
    const prev = get().customFoods;
    set({ customFoods: prev.filter((f) => f.id !== id) });
    const { error } = await supabase.from('custom_foods').delete().eq('id', id);
    if (error) {
      set({ customFoods: prev });
      return { error: error.message };
    }
    return { error: null };
  },
}));

/** Adapta un CustomFood al formato común por-100g para loguearlo. */
export function customFoodToPer100g(f: CustomFood): FoodPer100g {
  return {
    food_name: f.name,
    brand: f.brand,
    barcode: null,
    image_url: f.image_url,
    is_vegan: f.is_vegan,
    source: 'custom',
    source_ref: f.id,
    calories: f.calories_per_100g,
    protein_g: f.protein_per_100g,
    carbs_g: f.carbs_per_100g,
    fat_g: f.fat_per_100g,
    fiber_g: f.fiber_per_100g,
    sugar_g: f.sugar_per_100g,
    saturated_fat_g: f.saturated_fat_per_100g,
    sodium_mg: f.sodium_mg_per_100g,
    vitamin_b12_mcg: f.vitamin_b12_mcg_per_100g,
    iron_mg: f.iron_mg_per_100g,
    zinc_mg: f.zinc_mg_per_100g,
    calcium_mg: f.calcium_mg_per_100g,
    omega3_g: f.omega3_g_per_100g,
    vitamin_d_mcg: f.vitamin_d_mcg_per_100g,
    vitamin_b12_known: f.vitamin_b12_mcg_per_100g !== null,
    iron_known: f.iron_mg_per_100g !== null,
    zinc_known: f.zinc_mg_per_100g !== null,
    calcium_known: f.calcium_mg_per_100g !== null,
    omega3_known: f.omega3_g_per_100g !== null,
    vitamin_d_known: f.vitamin_d_mcg_per_100g !== null,
  };
}
