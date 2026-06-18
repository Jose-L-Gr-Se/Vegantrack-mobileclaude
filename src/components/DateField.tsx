/**
 * Campo de fecha segmentado (DD / MM / AAAA), sin dependencias nativas.
 * Emite la fecha como ISO `AAAA-MM-DD` cuando es válida, o '' si está incompleta.
 */
import React, { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { radii, spacing, useTheme } from '@/theme';

function isValidIso(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return false;
  const [y, m, day] = iso.split('-').map(Number);
  return d.getUTCFullYear() === y && d.getUTCMonth() + 1 === m && d.getUTCDate() === day;
}

export function DateField({
  label,
  value,
  onChange,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const t = useTheme();
  const parts = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split('-') : ['', '', ''];
  const [year, setYear] = useState(parts[0]);
  const [month, setMonth] = useState(parts[1]);
  const [day, setDay] = useState(parts[2]);

  const emit = (dd: string, mm: string, yy: string) => {
    if (dd && mm && yy.length === 4) {
      const iso = `${yy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
      onChange(isValidIso(iso) ? iso : '');
    } else {
      onChange('');
    }
  };

  const box = (
    kind: 'DD' | 'MM' | 'AAAA',
    val: string,
    setVal: (s: string) => void,
    max: number,
    flex: number
  ) => (
    <TextInput
      value={val}
      onChangeText={(raw) => {
        const clean = raw.replace(/\D/g, '').slice(0, max);
        setVal(clean);
        if (kind === 'DD') emit(clean, month, year);
        else if (kind === 'MM') emit(day, clean, year);
        else emit(day, month, clean);
      }}
      keyboardType="number-pad"
      placeholder={kind}
      placeholderTextColor={t.textMuted}
      style={{
        flex,
        textAlign: 'center',
        backgroundColor: t.inputBg,
        borderColor: t.inputBorder,
        borderWidth: 1,
        borderRadius: radii.lg,
        paddingVertical: 12,
        fontSize: 16,
        fontWeight: '700',
        color: t.text,
      }}
    />
  );

  return (
    <View style={{ gap: 6 }}>
      {label ? (
        <Text style={{ color: t.textSecondary, fontSize: 13, fontWeight: '600' }}>{label}</Text>
      ) : null}
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        {box('DD', day, setDay, 2, 1)}
        {box('MM', month, setMonth, 2, 1)}
        {box('AAAA', year, setYear, 4, 1.6)}
      </View>
    </View>
  );
}
