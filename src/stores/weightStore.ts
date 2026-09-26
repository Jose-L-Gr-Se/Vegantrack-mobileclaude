/**
 * Registro de peso, offline-first (espejo SQLite + cola de pendientes),
 * con gráfico de media móvil de 7 días y estadísticas como la PWA.
 */
import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import {
  mirrorList,
  mirrorMarkDeleted,
  mirrorMarkSynced,
  mirrorPending,
  mirrorRemove,
  mirrorUpsert,
} from '@/db/database';
import { uuidv4 } from '@/utils/uuid';
import { useAuthStore } from '@/stores/authStore';
import { isTransientSyncError } from '@/utils/syncError';
import { reportError } from '@/lib/errorReporting';
import type { WeightLog } from '@/types';

export interface WeightChartPoint {
  date: string;
  weight: number;
  avg7: number | null;
}

interface WeightState {
  logs: WeightLog[]; // ordenados por fecha ascendente
  loading: boolean;
  fetchLogs: (userId: string) => Promise<void>;
  addLog: (userId: string, date: string, weightKg: number, note?: string | null) => Promise<{ error: string | null }>;
  deleteLog: (id: string) => Promise<{ error: string | null }>;
  getChartData: (days: number) => WeightChartPoint[];
  getStats: () => { current: number; start: number; min: number; max: number; change: number } | null;
  flushPending: (userId: string) => Promise<void>;
  /** Auditoría del ciclo de vida de la cuenta — ver el mismo `reset()` en
   * `diaryStore.ts`. El peso es el dato más sensible de los que quedaban sin
   * limpiar: sin esto, el peso de OTRO usuario podía verse brevemente al
   * cambiar de cuenta sin reiniciar la app. */
  reset: () => void;
}

const sortByDate = (logs: WeightLog[]) => [...logs].sort((a, b) => a.date.localeCompare(b.date));

// Mismo guard que diaryStore.ts — ver el comentario allí. Variable propia
// (no compartida) porque protege una pasada sobre `weight_logs`, una tabla
// independiente de `food_log`.
let flushInFlight = false;

export const useWeightStore = create<WeightState>((set, get) => ({
  logs: [],
  loading: false,

  fetchLogs: async (userId) => {
    set({ loading: true });
    try {
      const local = await mirrorList<WeightLog>('weight_logs', userId);
      set({ logs: sortByDate(local.map((r) => r.payload)), loading: false });
    } catch {
      // sin espejo: esperamos al remoto
    }

    const yearAgo = new Date();
    yearAgo.setFullYear(yearAgo.getFullYear() - 1);
    const { data, error } = await supabase
      .from('weight_logs')
      .select('*')
      .eq('user_id', userId)
      .gte('date', yearAgo.toISOString().split('T')[0])
      .order('date', { ascending: true });

    if (!error && data) {
      const remote = data as WeightLog[];
      for (const log of remote) {
        await mirrorUpsert('weight_logs', { id: log.id, user_id: userId, date: log.date, payload: log }, true);
      }
      const local = await mirrorList<WeightLog>('weight_logs', userId);
      set({ logs: sortByDate(local.map((r) => r.payload)), loading: false });
    } else {
      set({ loading: false });
    }
  },

  addLog: async (userId, date, weightKg, note = null) => {
    // Upsert por fecha: si ya hay log ese día, lo sustituye (como la PWA)
    const existing = get().logs.find((l) => l.date === date);
    const log: WeightLog = {
      id: existing?.id ?? uuidv4(),
      user_id: userId,
      date,
      weight_kg: weightKg,
      note,
      created_at: new Date().toISOString(),
    };

    await mirrorUpsert('weight_logs', { id: log.id, user_id: userId, date, payload: log }, false);
    set({ logs: sortByDate([...get().logs.filter((l) => l.date !== date), log]) });

    const { error } = await supabase
      .from('weight_logs')
      .upsert(
        { id: log.id, user_id: userId, date, weight_kg: weightKg, note },
        { onConflict: 'user_id,date' }
      );
    if (!error) await mirrorMarkSynced('weight_logs', log.id);

    // Sincroniza el peso actual en el perfil (igual que la PWA)
    void useAuthStore.getState().updateProfile({ weight_kg: weightKg });
    return { error: null };
  },

  deleteLog: async (id) => {
    const remaining = get().logs.filter((l) => l.id !== id); // ya en orden ascendente (sortByDate)
    set({ logs: remaining });
    await mirrorMarkDeleted('weight_logs', id);
    const { error } = await supabase.from('weight_logs').delete().eq('id', id);
    if (!error) await mirrorRemove('weight_logs', id);

    // Auditoría de peso: `addLog()` mantiene `profiles.weight_kg` sincronizado
    // con el ÚLTIMO peso registrado (comentario "igual que la PWA" de arriba),
    // pero `deleteLog()` no lo tocaba en absoluto — borrar el registro más
    // reciente (p. ej. un error de tecleo) dejaba el perfil con un peso que
    // ya no tiene ningún registro que lo respalde. Esa cifra huérfana no es
    // sólo cosmética: `EditProfileModal` la precarga como valor por defecto
    // y `calculateTargets()` la usa para el BMR/TDEE si el usuario guarda
    // cualquier otro cambio de perfil sin tocar el peso a mano — recalculando
    // objetivos con un peso que el usuario acaba de borrar. Si queda al
    // menos un registro, se resincroniza con el más reciente; si no queda
    // ninguno, se deja tal cual (el peso del perfil puede haberse fijado por
    // otra vía, p. ej. onboarding, sin pasar nunca por esta pantalla).
    if (remaining.length > 0) {
      const latest = remaining[remaining.length - 1];
      void useAuthStore.getState().updateProfile({ weight_kg: latest.weight_kg });
    }
    return { error: null };
  },

  getChartData: (days) => {
    const logs = get().logs;
    if (logs.length === 0) return [];
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffISO = cutoff.toISOString().split('T')[0];
    const visible = logs.filter((l) => l.date >= cutoffISO);

    return visible.map((log) => {
      // Media móvil sobre los 7 días naturales previos (mínimo 2 puntos)
      const from = new Date(`${log.date}T12:00:00`);
      from.setDate(from.getDate() - 6);
      const fromISO = from.toISOString().split('T')[0];
      const window = logs.filter((l) => l.date >= fromISO && l.date <= log.date);
      const avg7 =
        window.length >= 2
          ? Math.round((window.reduce((s, l) => s + l.weight_kg, 0) / window.length) * 10) / 10
          : null;
      return { date: log.date, weight: log.weight_kg, avg7 };
    });
  },

  getStats: () => {
    const logs = get().logs;
    if (logs.length === 0) return null;
    const weights = logs.map((l) => l.weight_kg);
    const current = weights[weights.length - 1];
    const start = weights[0];
    return {
      current,
      start,
      min: Math.min(...weights),
      max: Math.max(...weights),
      change: Math.round((current - start) * 10) / 10,
    };
  },

  flushPending: async (userId) => {
    if (flushInFlight) return;
    flushInFlight = true;
    try {
      const pending = await mirrorPending<WeightLog>('weight_logs', userId);
      for (const row of pending) {
        if (row.deleted) {
          const { error } = await supabase.from('weight_logs').delete().eq('id', row.id);
          if (!error) {
            await mirrorRemove('weight_logs', row.id);
          } else if (!isTransientSyncError(error)) {
            reportError(error, { tag: 'sync_flush_weight_logs', extra: { op: 'delete', code: error.code || 'unknown' } });
          }
        } else {
          const p = row.payload;
          const { error } = await supabase
            .from('weight_logs')
            .upsert(
              { id: p.id, user_id: p.user_id, date: p.date, weight_kg: p.weight_kg, note: p.note },
              { onConflict: 'user_id,date' }
            );
          if (!error) {
            await mirrorMarkSynced('weight_logs', row.id);
          } else if (!isTransientSyncError(error)) {
            reportError(error, { tag: 'sync_flush_weight_logs', extra: { op: 'upsert', code: error.code || 'unknown' } });
          }
        }
      }
    } catch (err) {
      // Misma red de seguridad que diaryStore.ts: una excepción inesperada
      // (local, no un {error} de Supabase) nunca debe quedar sin reportar
      // ni marcar nada como sincronizado a medias. weight_logs no necesita
      // el mutex adicional de food_log (fetchLogs no usa un DELETE masivo
      // equivalente a mirrorReplaceDay — confirmado en la auditoría), sólo
      // esta red de seguridad.
      reportError(err, { tag: 'sync_flush_weight_logs', extra: { op: 'unexpected' } });
    } finally {
      flushInFlight = false;
    }
  },

  reset: () => set({ logs: [], loading: false }),
}));
