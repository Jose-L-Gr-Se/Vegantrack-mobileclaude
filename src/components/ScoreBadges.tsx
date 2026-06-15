/**
 * Insignias informativas de Nutri-Score, Eco-Score y NOVA, basadas en datos
 * abiertos de OpenFoodFacts. Su misión es informativa, no normativa: ayudan
 * a quien busca una alimentación más consciente sin caer en alarmismo. No
 * sustituyen al juicio del usuario.
 *
 *  · Nutri-Score (A-E)  → calidad nutricional global del producto.
 *  · Eco-Score (A-E)    → impacto medioambiental estimado (ciclo de vida).
 *  · NOVA (1-4)         → grado de procesamiento (1 mínimo, 4 ultraprocesado).
 */
import React from 'react';
import { Text, View } from 'react-native';
import { useTheme } from '@/theme';

type Grade = 'a' | 'b' | 'c' | 'd' | 'e';

const GRADE_COLORS: Record<Grade, string> = {
  a: '#1e7d49', // verde oscuro
  b: '#7cb238', // verde claro
  c: '#e8a72c', // ámbar
  d: '#e07a2c', // naranja
  e: '#c0473e', // rojo
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
  /** Valor activo: una letra A-E o un número 1-4. */
  value: Grade | 1 | 2 | 3 | 4;
  /** Escala completa para situar al activo. */
  scale: (Grade | 1 | 2 | 3 | 4)[];
  /** Sub-leyenda corta (p. ej. la descripción NOVA). */
  caption?: string;
}

/** Renderiza una pildora con la escala completa y resalta el valor activo. */
function ScaleBadge({ label, value, scale, caption }: ScaleBadgeProps) {
  const t = useTheme();
  return (
    <View style={{ gap: 4, flex: 1, minWidth: 0 }}>
      <Text
        style={{
          fontSize: 10,
          fontWeight: '700',
          letterSpacing: 0.6,
          color: t.textMuted,
          textTransform: 'uppercase',
        }}
        numberOfLines={1}
      >
        {label}
      </Text>
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
    </View>
  );
}

export function NutriScoreBadge({ grade }: { grade: Grade }) {
  return <ScaleBadge label="Nutri-Score" value={grade} scale={['a', 'b', 'c', 'd', 'e']} />;
}

export function EcoScoreBadge({ grade }: { grade: Grade }) {
  return <ScaleBadge label="Eco-Score" value={grade} scale={['a', 'b', 'c', 'd', 'e']} caption="impacto ambiental" />;
}

export function NovaBadge({ group }: { group: 1 | 2 | 3 | 4 }) {
  return (
    <ScaleBadge
      label="NOVA · procesamiento"
      value={group}
      scale={[1, 2, 3, 4]}
      caption={NOVA_DESCRIPTIONS[group]}
    />
  );
}
