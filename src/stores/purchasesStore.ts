/**
 * Estado de RevenueCat: CustomerInfo (entitlements) y Offerings (productos
 * de Play Store en Android / App Store en iOS).
 * Se inicializa cuando el usuario hace login y se destruye al cerrar sesión.
 */
import { Platform } from 'react-native';
import { create } from 'zustand';
import Purchases, { LOG_LEVEL } from 'react-native-purchases';
import type { CustomerInfo, PurchasesOfferings } from 'react-native-purchases';

export const ENTITLEMENT_PRO = 'pro';

/** Clave pública de RevenueCat de la plataforma actual (goog_… / appl_…). */
function revenueCatApiKey(): string | undefined {
  if (Platform.OS === 'android') return process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY;
  if (Platform.OS === 'ios') return process.env.EXPO_PUBLIC_REVENUECAT_APPLE_KEY;
  return undefined;
}

// true tras Purchases.configure(); evita llamar al SDK sin configurar.
let configured = false;

interface PurchasesState {
  customerInfo: CustomerInfo | null;
  offerings: PurchasesOfferings | null;
  offeringsLoading: boolean;
  /** Configura RC con el userId de Supabase y empieza a escuchar cambios. */
  init: (userId: string) => void;
  /** Cierra sesión en RC y limpia el estado. */
  reset: () => Promise<void>;
  /** Carga el catálogo de productos (precios reales de la tienda). */
  loadOfferings: () => Promise<void>;
}

export const usePurchasesStore = create<PurchasesState>((set) => ({
  customerInfo: null,
  offerings: null,
  offeringsLoading: false,

  init: (userId: string) => {
    const apiKey = revenueCatApiKey();
    if (!apiKey) return;

    if (__DEV__) Purchases.setLogLevel(LOG_LEVEL.DEBUG);
    Purchases.configure({ apiKey, appUserID: userId });
    configured = true;

    // Carga inicial de customerInfo
    void Purchases.getCustomerInfo()
      .then((info) => set({ customerInfo: info }))
      .catch(() => {});

    // Escucha renovaciones y cambios en tiempo real
    Purchases.addCustomerInfoUpdateListener((info) => set({ customerInfo: info }));
  },

  reset: async () => {
    if (!configured) return;
    try {
      await Purchases.logOut();
    } catch {}
    set({ customerInfo: null, offerings: null });
  },

  loadOfferings: async () => {
    if (!configured) return;
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
