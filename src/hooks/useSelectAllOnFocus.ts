/**
 * "Seleccionar todo al enfocar" para un TextInput controlado, SIN
 * `selectTextOnFocus`.
 *
 * Por qué no `selectTextOnFocus` (Android, RN 0.85 — `ReactEditText.kt`):
 * además de `setSelectAllOnFocus(true)` (selección nativa al ganar el foco),
 * guarda un flag que en `onLayout` vuelve a hacer `selectAll()` en la
 * PRIMERA pasada de layout que ocurra con el campo enfocado, y sólo entonces
 * se consume. Si esa pasada llega después del primer dígito (un re-render
 * que mueve el layout al cambiar el valor), el dígito ya escrito queda
 * seleccionado y la siguiente tecla lo sustituye: "100" → escribir 1, 5, 0
 * → "50".
 *
 * Aquí la selección inicial es una `selection` controlada que se aplica una
 * vez al enfocar y se suelta en cuanto el usuario escribe o mueve el cursor:
 * nunca se vuelve a imponer, ningún layout puede reseleccionar y no hace
 * falta ningún temporizador.
 */
import { useCallback, useState } from 'react';
import type { NativeSyntheticEvent, TextInputSelectionChangeEventData } from 'react-native';

export interface TextSelection {
  start: number;
  end: number;
}

export function useSelectAllOnFocus(value: string, onChangeText: (text: string) => void) {
  const [selection, setSelection] = useState<TextSelection | undefined>(undefined);

  const onFocus = useCallback(() => {
    setSelection({ start: 0, end: value.length });
  }, [value]);

  const handleChangeText = useCallback(
    (text: string) => {
      // Soltar la selección en el mismo render que el nuevo valor: nunca una
      // selección controlada fuera de rango (p. ej. {0,3} sobre "1").
      setSelection(undefined);
      onChangeText(text);
    },
    [onChangeText]
  );

  const onSelectionChange = useCallback((e: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
    const next = e.nativeEvent.selection;
    // El eco de nuestra propia selección no la suelta; cualquier otra (el
    // usuario coloca el cursor o selecciona otra parte) sí.
    setSelection((current) =>
      current && (next.start !== current.start || next.end !== current.end) ? undefined : current
    );
  }, []);

  const onBlur = useCallback(() => setSelection(undefined), []);

  return { selection, onFocus, onBlur, onSelectionChange, onChangeText: handleChangeText };
}
