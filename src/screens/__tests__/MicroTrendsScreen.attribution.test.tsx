/**
 * Atribución comida vs. suplemento en `MicroTrendsScreen` — la tarjeta del
 * micro seleccionado muestra "Origen del aporte" con el reparto SÓLO cuando
 * es calculable de forma honesta, y en otro caso las cifras conocidas sin
 * porcentaje. La lógica en sí vive en `microAttribution.test.ts` (pura); aquí
 * sólo se comprueba que la pantalla la conecta: qué se ve y qué no.
 *
 * Mismo arnés que `MicroTrendsScreen.freeAccess.test.tsx` (Free en 7D, que
 * está permitido, así que no interviene ningún paywall).
 */
import React from 'react';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import TestRenderer, { act } from 'react-test-renderer';
import { MicroTrendsScreen } from '@/screens/MicroTrendsScreen';
import { useAuthStore } from '@/stores/authStore';
import { useDiaryStore } from '@/stores/diaryStore';
import { usePro } from '@/hooks/usePro';

jest.mock('expo-sqlite', () => ({}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-svg', () => ({ __esModule: true, default: () => null, Line: () => null, Polyline: () => null, Circle: () => null }));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: () => void | (() => void)) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ReactActual = require('react');
    ReactActual.useEffect(() => cb(), []);
  },
  useNavigation: () => ({ goBack: jest.fn() }),
  useRoute: () => ({ params: undefined }),
}));
jest.mock('@/stores/authStore', () => ({ useAuthStore: jest.fn() }));
jest.mock('@/stores/diaryStore', () => ({ useDiaryStore: jest.fn() }));
jest.mock('@/hooks/usePro', () => ({ usePro: jest.fn() }));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));
jest.mock('@/components/ProModal', () => ({ ProModal: () => null }));

const SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

type MicroEntry = {
  value: number;
  pct: number;
  hasEntries: boolean;
  confidence: string;
  knownFood: number;
  supplement: number;
  coverageByGrams: number;
  supplementUnresolved: boolean;
};

const NO_DATA: MicroEntry = {
  value: 0, pct: 0, hasEntries: false, confidence: 'none',
  knownFood: 0, supplement: 0, coverageByGrams: 0, supplementUnresolved: false,
};

/** Un único día con los 6 micros sin datos salvo los overrides puntuales. */
function points(overrides: Record<string, Partial<MicroEntry>>) {
  const keys = ['vitamin_b12_mcg', 'iron_mg', 'zinc_mg', 'calcium_mg', 'vitamin_d_mcg', 'omega3_g'];
  return [
    {
      date: '2026-09-25',
      micros: Object.fromEntries(keys.map((k) => [k, { ...NO_DATA, ...(overrides[k] ?? {}) }])),
    },
  ];
}

async function renderWith(data: ReturnType<typeof points>) {
  (useAuthStore as unknown as jest.Mock).mockReturnValue({ user: { id: 'user-1' }, profile: { sex: 'female' } });
  (useDiaryStore as unknown as jest.Mock).mockImplementation((selector: (s: unknown) => unknown) =>
    selector({ getMicroTrends: jest.fn().mockResolvedValue(data) })
  );
  (usePro as unknown as jest.Mock).mockReturnValue({ isPro: false });

  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>
        <MicroTrendsScreen />
      </SafeAreaProvider>
    );
  });
  return renderer;
}

function pressText(renderer: TestRenderer.ReactTestRenderer, label: string) {
  let node = renderer.root.findAllByType(Text).find((n) => n.props.children === label)!;
  while (node.parent && typeof node.props.onPress !== 'function') node = node.parent;
  act(() => node.props.onPress());
}

const B12_MIXED: Partial<MicroEntry> = {
  value: 4.95, pct: 4.95 / 2.4, hasEntries: true, confidence: 'high',
  knownFood: 4.05, supplement: 0.9, coverageByGrams: 1,
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('MicroTrendsScreen — origen del aporte (comida vs. suplemento)', () => {
  it('mezcla con dato completo: muestra el reparto y el aporte conocido', async () => {
    const renderer = await renderWith(points({ vitamin_b12_mcg: B12_MIXED }));
    const text = JSON.stringify(renderer.toJSON());

    expect(text).toContain('Origen del aporte');
    expect(text).toContain('82 % alimentos · 18 % suplementos');
    expect(text).toContain('Aporte conocido: 4,95 mcg');
  });

  it('comida con datos parciales: NO muestra porcentajes; muestra lo conocido y explica por qué', async () => {
    const renderer = await renderWith(points({ vitamin_b12_mcg: { ...B12_MIXED, coverageByGrams: 0.5 } }));
    const text = JSON.stringify(renderer.toJSON());

    expect(text).toContain('Aporte conocido: 4,05 mcg de alimentos · 0,9 mcg de suplementos');
    expect(text).toContain('No calculamos porcentajes');
    expect(text).not.toContain('% alimentos');
  });

  it('suplemento con dosis por revisar: no presenta "sin suplemento" como 100 % alimentos', async () => {
    const renderer = await renderWith(
      points({
        vitamin_b12_mcg: {
          value: 4, pct: 4 / 2.4, hasEntries: true, confidence: 'high',
          knownFood: 4, supplement: 0, coverageByGrams: 1, supplementUnresolved: true,
        },
      })
    );
    const text = JSON.stringify(renderer.toJSON());

    expect(text).not.toContain('Todo el aporte registrado procede de alimentos');
    expect(text).toContain('hay suplementos con dosis por revisar');
  });

  it('sin ningún dato del micro seleccionado: no aparece el bloque de origen', async () => {
    const renderer = await renderWith(points({}));
    expect(JSON.stringify(renderer.toJSON())).not.toContain('Origen del aporte');
  });

  it('al elegir otro micro, la atribución es la de ESE micro (no la del anterior)', async () => {
    const renderer = await renderWith(
      points({
        vitamin_b12_mcg: B12_MIXED,
        iron_mg: {
          value: 6, pct: 0.75, hasEntries: true, confidence: 'high',
          knownFood: 6, supplement: 0, coverageByGrams: 1,
        },
      })
    );
    expect(JSON.stringify(renderer.toJSON())).toContain('82 % alimentos · 18 % suplementos');

    pressText(renderer, 'Hierro');

    const text = JSON.stringify(renderer.toJSON());
    expect(text).toContain('Todo el aporte registrado procede de alimentos');
    expect(text).not.toContain('82 % alimentos · 18 % suplementos');
  });
});
