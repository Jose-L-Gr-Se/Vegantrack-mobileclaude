/** Componentes UI base, equivalentes a las clases .card/.btn/.input de la PWA. */
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { brand, radii, spacing, surface, useTheme } from '@/theme';

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: t.card,
          borderColor: t.cardBorder,
          borderWidth: 1,
          borderRadius: radii.xl,
          padding: spacing.lg,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function SectionHeader({ title, right }: { title: string; right?: React.ReactNode }) {
  const t = useTheme();
  return (
    <View style={styles.sectionHeader}>
      <Text style={{ fontSize: 16, fontWeight: '700', color: t.text }}>{title}</Text>
      {right}
    </View>
  );
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const bg =
    variant === 'primary' ? t.primary : variant === 'danger' ? '#ef4444' : t.card;
  const fg = variant === 'secondary' ? t.text : '#ffffff';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        {
          backgroundColor: bg,
          borderRadius: radii.pill,
          paddingVertical: 14,
          paddingHorizontal: spacing.xl,
          alignItems: 'center',
          opacity: disabled || loading ? 0.5 : pressed ? 0.85 : 1,
          borderWidth: variant === 'secondary' ? 1 : 0,
          borderColor: t.cardBorder,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={{ color: fg, fontWeight: '700', fontSize: 15 }}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Input(props: TextInputProps & { label?: string }) {
  const t = useTheme();
  const { label, style, ...rest } = props;
  return (
    <View style={{ gap: 6 }}>
      {label ? <Text style={{ color: t.textSecondary, fontSize: 13, fontWeight: '600' }}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={t.textMuted}
        style={[
          {
            backgroundColor: t.inputBg,
            borderColor: t.inputBorder,
            borderWidth: 1,
            borderRadius: radii.lg,
            paddingHorizontal: spacing.lg,
            paddingVertical: 12,
            fontSize: 15,
            color: t.text,
          },
          style,
        ]}
        {...rest}
      />
    </View>
  );
}

/** Anillo de progreso SVG (equivalente al ProgressRing de la PWA). */
export function ProgressRing({
  progress,
  size = 120,
  strokeWidth = 10,
  color = brand[600],
  children,
}: {
  progress: number; // 0..1
  size?: number;
  strokeWidth?: number;
  color?: string;
  children?: React.ReactNode;
}) {
  const t = useTheme();
  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  const clamped = Math.min(1, Math.max(0, progress));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={t.separator} strokeWidth={strokeWidth} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${circumference}`}
          strokeDashoffset={circumference * (1 - clamped)}
        />
      </Svg>
      {children}
    </View>
  );
}

/** Barra de macro con etiqueta y consumo/objetivo. */
export function MacroBar({
  label,
  value,
  target,
  color,
  unit = 'g',
}: {
  label: string;
  value: number;
  target: number;
  color: string;
  unit?: string;
}) {
  const t = useTheme();
  const pct = target > 0 ? Math.min(1, value / target) : 0;
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ color: t.textSecondary, fontSize: 12, fontWeight: '600' }}>{label}</Text>
        <Text style={{ color: t.textMuted, fontSize: 12 }}>
          {Math.round(value)}/{Math.round(target)} {unit}
        </Text>
      </View>
      <View style={{ height: 8, borderRadius: 4, backgroundColor: t.separator, overflow: 'hidden' }}>
        <View style={{ width: `${pct * 100}%`, height: 8, backgroundColor: color, borderRadius: 4 }} />
      </View>
    </View>
  );
}

export function EmptyState({ emoji, text }: { emoji: string; text: string }) {
  const t = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: spacing.xxl, gap: spacing.sm }}>
      <Text style={{ fontSize: 40 }}>{emoji}</Text>
      <Text style={{ color: t.textMuted, textAlign: 'center', fontSize: 14 }}>{text}</Text>
    </View>
  );
}

export function Pill({ text, color = brand[600], bg }: { text: string; color?: string; bg?: string }) {
  return (
    <View
      style={{
        backgroundColor: bg ?? `${color}22`,
        borderRadius: radii.pill,
        paddingHorizontal: 10,
        paddingVertical: 3,
        alignSelf: 'flex-start',
      }}
    >
      <Text style={{ color, fontSize: 11, fontWeight: '700' }}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
});

export { brand, surface };
