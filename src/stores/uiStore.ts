/**
 * Estado de UI efímero (no se persiste). Señales transitorias entre pantallas,
 * como "el usuario acaba de terminar el onboarding" para disparar la bienvenida.
 */
import { create } from 'zustand';

interface UiState {
  // true justo tras completar el onboarding; lo consume la pantalla de
  // bienvenida (PostOnboardingWelcome) y se limpia al cerrarla.
  justOnboarded: boolean;
  setJustOnboarded: (value: boolean) => void;
  // true cuando `diaryStore.addEntry` acaba de confirmar la primera comida
  // de un usuario y corresponde ofrecerle activar el recordatorio diario
  // (auditoría de activación) — lo consume `FirstEntryReminderOffer`,
  // montado igual que `PostOnboardingWelcome`. `diaryStore` lo marca porque
  // es el único punto común a cualquier método de guardar una comida
  // (búsqueda, foto-IA, recetas...); esta señal es efímera y no decide por
  // sí sola si procede mostrarse — esa decisión (primera vez, oferta no
  // mostrada antes, recordatorio aún no activo) ya se tomó antes de marcarla.
  reminderOfferPending: boolean;
  setReminderOfferPending: (value: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  justOnboarded: false,
  setJustOnboarded: (value) => set({ justOnboarded: value }),
  reminderOfferPending: false,
  setReminderOfferPending: (value) => set({ reminderOfferPending: value }),
}));
