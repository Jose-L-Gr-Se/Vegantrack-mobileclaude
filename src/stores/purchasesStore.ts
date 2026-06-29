/**
 * Estado de RevenueCat: CustomerInfo (entitlements) y Offerings (productos de Play).
 * Se inicializa cuando el usuario hace login y se destruye al cerrar sesión.
 */
import { Platform } from 'react-native';
import { create } from 'zustand';
import Purchases, { LOG_LEVEL } from 'react-native-purchases';
import type { CustomerInfo, PurchasesOfferings } from 'react-native-purchases';

export const ENTITLEMENT_PRO = 'pro';

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

export const usePurchasesStore = create<PurchasesState>((set) => ({
  customerInfo: null,
  offerings: null,
  offeringsLoading: false,

  init: (userId: string) => {
    if (Platform.OS !== 'android') return;
    const apiKey = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY;
    if (!apiKey) return;

    if (__DEV__) Purchases.setLogLevel(LOG_LEVEL.DEBUG);
    Purchases.configure({ apiKey, appUserID: userId });

    // Carga inicial de customerInfo
    void Purchases.getCustomerInfo()
      .then((info) => set({ customerInfo: info }))
      .catch(() => {});

    // Escucha renovaciones y cambios en tiempo real
    Purchases.addCustomerInfoUpdateListener((info) => set({ customerInfo: info }));
  },

  reset: async () => {
    if (Platform.OS !== 'android') return;
    try {
      await Purchases.logOut();
    } catch {}
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
