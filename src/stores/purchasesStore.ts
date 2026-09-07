/**
 * Estado de RevenueCat: CustomerInfo (entitlements) y Offerings (productos de Play).
 * Se inicializa cuando el usuario hace login y se destruye al cerrar sesión.
 */
import { Platform } from 'react-native';
import { create } from 'zustand';
import Purchases, { LOG_LEVEL } from 'react-native-purchases';
import type { CustomerInfo, PurchasesOfferings } from 'react-native-purchases';
import { ENTITLEMENT_PRO } from '@/utils/proEntitlement';
import { track } from '@/lib/analytics';

// Fuente única: la constante vive junto a la regla de decisión pura, para que
// el id del entitlement no pueda divergir entre el SDK y `usePro`.
export { ENTITLEMENT_PRO };

interface PurchasesState {
  customerInfo: CustomerInfo | null;
  offerings: PurchasesOfferings | null;
  offeringsLoading: boolean;
  /** Configura RC con el userId de Supabase y empieza a escuchar cambios. */
  init: (userId: string) => void;
  /** Cierra sesión en RC y limpia el estado. */
  reset: () => Promise<void>;
  /** Carga el catálogo de productos (precios reales de Play Store). */
  loadOfferings: () => Promise<void>;
}

// Guarda para qué `userId` ya se ha llamado `Purchases.configure()` +
// `addCustomerInfoUpdateListener()` en este proceso. Auditoría del paywall
// (hallazgo B.4): `init()` se llama desde varios puntos de `authStore.ts`
// (arranque, `signIn`, `signUp`, y cada reintento de `AuthRecoveryScreen`
// vuelve a pasar por `initialize()`) — sin este guard, cada llamada repetida
// para el mismo usuario registraba OTRO listener de RevenueCat, nunca
// liberado. Ahora que el propio listener también mide `subscription_expired`,
// el duplicado dejaría de ser sólo un desperdicio de memoria: falsearía la
// analítica (un evento real contado varias veces).
let initializedUserId: string | null = null;

export const usePurchasesStore = create<PurchasesState>((set, get) => ({
  customerInfo: null,
  offerings: null,
  offeringsLoading: false,

  init: (userId: string) => {
    if (Platform.OS !== 'android') return;
    if (initializedUserId === userId) return;
    const apiKey = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY;
    if (!apiKey) return;
    initializedUserId = userId;

    if (__DEV__) Purchases.setLogLevel(LOG_LEVEL.DEBUG);
    Purchases.configure({ apiKey, appUserID: userId });

    // Carga inicial de customerInfo
    void Purchases.getCustomerInfo()
      .then((info) => set({ customerInfo: info }))
      .catch(() => {});

    // Escucha renovaciones y cambios en tiempo real. También es el único
    // sitio donde se puede detectar una expiración sin depender de que el
    // usuario esté mirando la app en ese momento (renovación fallida,
    // cancelación que llega a su fin de periodo...). Sólo se mide la
    // transición activo→inactivo: una compra nueva (inactivo→activo) ya se
    // mide explícitamente en `ProModal`, y este mismo listener se dispara
    // también justo después de una compra — medirla aquí otra vez la
    // duplicaría.
    Purchases.addCustomerInfoUpdateListener((info) => {
      const wasActive = get().customerInfo?.entitlements.active[ENTITLEMENT_PRO] !== undefined;
      const isActive = info.entitlements.active[ENTITLEMENT_PRO] !== undefined;
      if (wasActive && !isActive) track('subscription_expired');
      set({ customerInfo: info });
    });
  },

  reset: async () => {
    if (Platform.OS !== 'android') return;
    try {
      await Purchases.logOut();
    } catch {}
    initializedUserId = null;
    set({ customerInfo: null, offerings: null });
  },

  loadOfferings: async () => {
    if (Platform.OS !== 'android') return;
    set({ offeringsLoading: true });
    try {
      const offerings = await Purchases.getOfferings();
      set({ offerings });
    } catch {
      // Falla silenciosamente — la UI mostrará precios de fallback
    } finally {
      set({ offeringsLoading: false });
    }
  },
}));
