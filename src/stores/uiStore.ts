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
}

export const useUiStore = create<UiState>((set) => ({
  justOnboarded: false,
  setJustOnboarded: (value) => set({ justOnboarded: value }),
}));
