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
import { useTranslation } from 'react-i18next';
import { BottomSheet } from '@/components/BottomSheet';
import { spacing, useTheme } from '@/theme';

export type ScoreKind = 'nutri' | 'eco' | 'nova';

interface ScoreExplain {
  title: string;
  intro: string;
  scale: { label: string; text: string }[];
  tip: string;
}

export function ScoreInfoSheet({
  kind,
  visible,
  onClose,
}: {
  kind: ScoreKind | null;
  visible: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();

  if (!kind) {
    return <BottomSheet visible={visible} onClose={onClose}>{null}</BottomSheet>;
  }

  const explains: Record<ScoreKind, ScoreExplain> = {
    nutri: {
      title: t('scoreInfo.nutri.title'),
      intro: t('scoreInfo.nutri.intro'),
      scale: [
        { label: 'A', text: t('scoreInfo.nutri.a') },
        { label: 'B', text: t('scoreInfo.nutri.b') },
        { label: 'C', text: t('scoreInfo.nutri.c') },
        { label: 'D', text: t('scoreInfo.nutri.d') },
        { label: 'E', text: t('scoreInfo.nutri.e') },
      ],
      tip: t('scoreInfo.nutri.tip'),
    },
    eco: {
      title: t('scoreInfo.eco.title'),
      intro: t('scoreInfo.eco.intro'),
      scale: [
        { label: 'A', text: t('scoreInfo.eco.a') },
        { label: 'B', text: t('scoreInfo.eco.b') },
        { label: 'C', text: t('scoreInfo.eco.c') },
        { label: 'D', text: t('scoreInfo.eco.d') },
        { label: 'E', text: t('scoreInfo.eco.e') },
      ],
      tip: t('scoreInfo.eco.tip'),
    },
    nova: {
      title: t('scoreInfo.nova.title'),
      intro: t('scoreInfo.nova.intro'),
      scale: [
        { label: '1', text: t('scoreInfo.nova.1' as any) },
        { label: '2', text: t('scoreInfo.nova.2' as any) },
        { label: '3', text: t('scoreInfo.nova.3' as any) },
        { label: '4', text: t('scoreInfo.nova.4' as any) },
      ],
      tip: t('scoreInfo.nova.tip'),
    },
  };

  const e = explains[kind];

  return (
    <BottomSheet visible={visible} onClose={onClose} maxHeightFraction={0.7}>
      <View style={{ gap: spacing.md, paddingTop: spacing.sm }}>
        <Text style={{ fontSize: 26, fontWeight: '700', color: theme.text }}>
          {e.title}
        </Text>
        <Text style={{ color: theme.textSecondary, fontSize: 14, lineHeight: 20 }}>{e.intro}</Text>

        <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
          <Text
            style={{
              fontSize: 11,
              fontWeight: '700',
              letterSpacing: 0.8,
              textTransform: 'uppercase',
              color: theme.textMuted,
            }}
          >
            {t('scoreInfo.scaleHeader')}
          </Text>
          {e.scale.map((row) => (
            <View key={row.label} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }}>
              <View
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  backgroundColor: theme.primarySoft,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ color: theme.primary, fontWeight: '800', fontSize: 13 }}>{row.label}</Text>
              </View>
              <Text style={{ flex: 1, color: theme.text, fontSize: 13, lineHeight: 18, paddingTop: 4 }}>
                {row.text}
              </Text>
            </View>
          ))}
        </View>

        <View
          style={{
            backgroundColor: theme.primarySoft,
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
              color: theme.primary,
            }}
          >
            {t('scoreInfo.tipHeader')}
          </Text>
          <Text style={{ color: theme.text, fontSize: 13, lineHeight: 18 }}>{e.tip}</Text>
        </View>
      </View>
    </BottomSheet>
  );
}
