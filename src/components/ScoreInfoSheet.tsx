/**
 * ScoreInfoSheet — explica Nutri-Score / Eco-Score / NOVA con un lenguaje
 * llano y sin alarmismo.
 *
 * Filosofía: el icono "ⓘ" del badge invita a tocar; quien ya sabe lo
 * ignora; quien no, descubre. Tres bloques cortos: qué mide, cómo se lee
 * la escala y qué tener en mente. Nada de juicios morales sobre comidas.
 */
import React from 'react';
import { Text, View } from 'react-native';
import { BottomSheet } from '@/components/BottomSheet';
import { spacing, useTheme } from '@/theme';

export type ScoreKind = 'nutri' | 'eco' | 'nova';

interface ScoreExplain {
  title: string;
  intro: string;
  scale: { label: string; text: string }[];
  tip: string;
}

const EXPLAIN: Record<ScoreKind, ScoreExplain> = {
  nutri: {
    title: 'Nutri-Score',
    intro:
      'Resume la calidad nutricional global del producto con una letra de la A a la E. Tiene en cuenta calorías, azúcares, grasas saturadas y sal en negativo; fibra, proteína, fruta y verdura en positivo.',
    scale: [
      { label: 'A', text: 'mejor perfil nutricional' },
      { label: 'B', text: 'bueno' },
      { label: 'C', text: 'medio' },
      { label: 'D', text: 'mejorable' },
      { label: 'E', text: 'peor perfil dentro de su categoría' },
    ],
    tip: 'Compara productos de la misma familia (p. ej. yogures con yogures). Que algo sea E no lo convierte en "malo": ayuda a elegir mejor entre varias opciones.',
  },
  eco: {
    title: 'Eco-Score',
    intro:
      'Estima el impacto ambiental del producto a lo largo de su ciclo de vida: cómo se cultivan los ingredientes, transporte, envase y origen. Cuanto más cerca de A, menor huella estimada.',
    scale: [
      { label: 'A', text: 'huella ambiental muy baja' },
      { label: 'B', text: 'baja' },
      { label: 'C', text: 'media' },
      { label: 'D', text: 'alta' },
      { label: 'E', text: 'muy alta' },
    ],
    tip: 'Una alimentación basada en plantas suele puntuar mejor en eco que las opciones de origen animal. Es una orientación, no una sentencia.',
  },
  nova: {
    title: 'NOVA · nivel de procesamiento',
    intro:
      'Clasifica los alimentos por cuánto se han procesado industrialmente, no por sus calorías. Un grupo NOVA alto no significa "tóxico", solo que el producto ha pasado por más transformaciones y aditivos.',
    scale: [
      { label: '1', text: 'sin procesar (fruta, legumbre seca…)' },
      { label: '2', text: 'mínimamente procesado (aceite, sal…)' },
      { label: '3', text: 'procesado (conservas, pan…)' },
      { label: '4', text: 'ultraprocesado (con aditivos y formulaciones)' },
    ],
    tip: 'Una dieta consciente suele tirar hacia 1 y 2 como base, sin demonizar puntuales del 3 y 4 que te encajen en el día.',
  },
};

export function ScoreInfoSheet({
  kind,
  visible,
  onClose,
}: {
  kind: ScoreKind | null;
  visible: boolean;
  onClose: () => void;
}) {
  const t = useTheme();
  if (!kind) {
    return <BottomSheet visible={visible} onClose={onClose}>{null}</BottomSheet>;
  }
  const e = EXPLAIN[kind];

  return (
    <BottomSheet visible={visible} onClose={onClose} maxHeightFraction={0.7}>
      <View style={{ gap: spacing.md, paddingTop: spacing.sm }}>
        <Text style={{ fontSize: 26, fontWeight: '700', color: t.text }}>
          {e.title}
        </Text>
        <Text style={{ color: t.textSecondary, fontSize: 14, lineHeight: 20 }}>{e.intro}</Text>

        <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
          <Text
            style={{
              fontSize: 11,
              fontWeight: '700',
              letterSpacing: 0.8,
              textTransform: 'uppercase',
              color: t.textMuted,
            }}
          >
            La escala, fácil
          </Text>
          {e.scale.map((row) => (
            <View key={row.label} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }}>
              <View
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  backgroundColor: t.primarySoft,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ color: t.primary, fontWeight: '800', fontSize: 13 }}>{row.label}</Text>
              </View>
              <Text style={{ flex: 1, color: t.text, fontSize: 13, lineHeight: 18, paddingTop: 4 }}>
                {row.text}
              </Text>
            </View>
          ))}
        </View>

        <View
          style={{
            backgroundColor: t.primarySoft,
            borderRadius: 16,
            padding: spacing.md,
            marginTop: spacing.sm,
            gap: 4,
          }}
        >
          <Text
            style={{
              fontSize: 11,
              fontWeight: '700',
              letterSpacing: 0.8,
              textTransform: 'uppercase',
              color: t.primary,
            }}
          >
            Para tener en cuenta
          </Text>
          <Text style={{ color: t.text, fontSize: 13, lineHeight: 18 }}>{e.tip}</Text>
        </View>
      </View>
    </BottomSheet>
  );
}
