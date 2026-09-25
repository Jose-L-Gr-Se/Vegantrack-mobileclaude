/**
 * Auditoría del loop "siguiente comida" — `MealSavedToast`.
 *
 * Sustituye al toast local que tenía `SearchScreen` (que se ponía justo
 * antes de navegar fuera de esa pestaña y por eso nunca llegaba a verse, ver
 * `SearchScreen.mealSavedToast.test.tsx`): vive en `useUiStore`, montado una
 * única vez en la raíz, así que sobrevive al cambio de pestaña.
 */
import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { MealSavedToast, MEAL_SAVED_TOAST_DURATION_MS } from '@/components/MealSavedToast';
import { useUiStore } from '@/stores/uiStore';

jest.mock('expo-sqlite', () => ({}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

let renderer: TestRenderer.ReactTestRenderer | null = null;

function renderToast() {
  act(() => {
    renderer = TestRenderer.create(<MealSavedToast />);
  });
  return renderer!;
}

function setMessage(message: string | null) {
  act(() => useUiStore.setState({ mealSavedToast: message }));
}

beforeEach(() => {
  jest.useFakeTimers();
  setMessage(null);
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = null;
  jest.useRealTimers();
});

describe('MealSavedToast', () => {
  it('no renderiza nada sin mensaje', () => {
    const r = renderToast();
    expect(r.root.findAllByType(Text)).toHaveLength(0);
  });

  it('con mensaje, lo muestra', () => {
    setMessage('Lentejas añadido a Comida');
    const r = renderToast();

    expect(r.root.findAllByType(Text).some((t) => t.props.children === 'Lentejas añadido a Comida')).toBe(
      true
    );
  });

  it('se autodescarta solo pasado MEAL_SAVED_TOAST_DURATION_MS', () => {
    setMessage('Tofu añadido a Cena');
    renderToast();

    act(() => {
      jest.advanceTimersByTime(MEAL_SAVED_TOAST_DURATION_MS);
    });

    expect(useUiStore.getState().mealSavedToast).toBeNull();
  });

  it('no se descarta antes de tiempo', () => {
    setMessage('Tofu añadido a Cena');
    renderToast();

    act(() => {
      jest.advanceTimersByTime(MEAL_SAVED_TOAST_DURATION_MS - 500);
    });

    expect(useUiStore.getState().mealSavedToast).toBe('Tofu añadido a Cena');
  });

  it('tocarlo lo descarta antes de tiempo', () => {
    setMessage('Garbanzos añadido a Desayuno');
    const r = renderToast();

    const [pressable] = r.root.findAll(
      (n) => typeof n.type === 'function' && (n.type as { name?: string }).name === 'Pressable'
    );
    act(() => pressable.props.onPress());

    expect(useUiStore.getState().mealSavedToast).toBeNull();
  });

  it('un mensaje nuevo mientras el anterior sigue visible reinicia el temporizador de autodescarte', () => {
    setMessage('Primero');
    renderToast();

    act(() => {
      jest.advanceTimersByTime(MEAL_SAVED_TOAST_DURATION_MS - 500);
    });
    setMessage('Segundo'); // sustituye el mensaje antes de que el primero se autodescartara

    act(() => {
      jest.advanceTimersByTime(600); // el temporizador del primer mensaje ya habría expirado aquí
    });
    expect(useUiStore.getState().mealSavedToast).toBe('Segundo'); // el segundo mensaje sigue vivo

    act(() => {
      jest.advanceTimersByTime(MEAL_SAVED_TOAST_DURATION_MS);
    });
    expect(useUiStore.getState().mealSavedToast).toBeNull();
  });
});
