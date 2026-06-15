/**
 * Insignias informativas de Nutri-Score, Eco-Score y NOVA, basadas en datos
 * abiertos de OpenFoodFacts. Educan sin alarmar: cada badge es pulsable y
 * abre un ScoreInfoSheet con la explicación al toque, marcado con un "ⓘ"
 * pequeño para que quien no conoce el indicador descubra que hay más.
 *
 *  · Nutri-Score (A-E)  → calidad nutricional global del producto.
 *  · Eco-Score (A-E)    → impacto medioambiental estimado (ciclo de vida).
 *  · NOVA (1-4)         → grado de procesamiento (1 mínimo, 4 ultraprocesado).
 */
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme';
import type { ScoreKind } from '@/components/ScoreInfoSheet';

type Grade = 'a' | 'b' | 'c' | 'd' | 'e';

const GRADE_COLORS: Record<Grade, string> = {
  a: '#1e7d49',
  b: '#7cb238',
  c: '#e8a72c',
  d: '#e07a2c',
  e: '#c0473e',
};

const NOVA_COLORS: Record<1 | 2 | 3 | 4, string> = {
  1: '#1e7d49',
  2: '#7cb238',
  3: '#e8a72c',
  4: '#c0473e',
};

const NOVA_DESCRIPTIONS: Record<1 | 2 | 3 | 4, string> = {
  1: 'sin procesar',
  2: 'mínimamente procesado',
  3: 'procesado',
  4: 'ultraprocesado',
};

interface ScaleBadgeProps {
  label: string;
  value: Grade | 1 | 2 | 3 | 4;
  scale: (Grade | 1 | 2 | 3 | 4)[];
  caption?: string;
  onInfo?: () => void;
}

function ScaleBadge({ label, value, scale, caption, onInfo }: ScaleBadgeProps) {
  const t = useTheme();
  const Wrap: any = onInfo ? Pressable : View;
  return (
    <Wrap
      onPress={onInfo}
      style={{ gap: 4, flex: 1, minWidth: 0 }}
      hitSlop={6}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Text
          style={{
            fontSize: 10,
            fontWeight: '700',
            letterSpacing: 0.6,
            color: t.textMuted,
            textTransform: 'uppercase',
            flexShrink: 1,
          }}
          numberOfLines={1}
        >
          {label}
        </Text>
        {onInfo ? (
          <Ionicons
            name={'information-circle-outline' as never}
            size={12}
            color={t.textMuted}
          />
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', gap: 2 }}>
        {scale.map((step) => {
          const active = step === value;
          const color = typeof step === 'number'
            ? NOVA_COLORS[step as 1 | 2 | 3 | 4]
            : GRADE_COLORS[step as Grade];
          return (
            <View
              key={String(step)}
              style={{
                flex: 1,
                height: active ? 24 : 16,
                borderRadius: 4,
                backgroundColor: active ? color : `${color}33`,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {active ? (
                <Text style={{ color: '#fff', fontWeight: '800', fontSize: 11 }}>
                  {typeof step === 'string' ? step.toUpperCase() : step}
                </Text>
              ) : null}
            </View>
          );
        })}
      </View>
      {caption ? (
        <Text style={{ fontSize: 10, color: t.textMuted }} numberOfLines={1}>
          {caption}
        </Text>
      ) : null}
    </Wrap>
  );
}

export function NutriScoreBadge({ grade, onInfo }: { grade: Grade; onInfo?: (k: ScoreKind) => void }) {
  return <ScaleBadge label="Nutri-Score" value={grade} scale={['a', 'b', 'c', 'd', 'e']} onInfo={onInfo ? () => onInfo('nutri') : undefined} />;
}

export function EcoScoreBadge({ grade, onInfo }: { grade: Grade; onInfo?: (k: ScoreKind) => void }) {
  return (
    <ScaleBadge
      label="Eco-Score"
      value={grade}
      scale={['a', 'b', 'c', 'd', 'e']}
      caption="impacto ambiental"
      onInfo={onInfo ? () => onInfo('eco') : undefined}
    />
  );
}

export function NovaBadge({ group, onInfo }: { group: 1 | 2 | 3 | 4; onInfo?: (k: ScoreKind) => void }) {
  return (
    <ScaleBadge
      label="NOVA · procesamiento"
      value={group}
      scale={[1, 2, 3, 4]}
      caption={NOVA_DESCRIPTIONS[group]}
      onInfo={onInfo ? () => onInfo('nova') : undefined}
    />
  );
}
