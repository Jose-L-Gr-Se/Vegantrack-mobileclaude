import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheet } from './BottomSheet';
import { Button } from './ui';
import { radii, spacing, useTheme } from '@/theme';
import type { MealPhotoError } from '@/hooks/useMealPhoto';

export type MealSheetMode = 'picker' | 'error';

interface MealPhotoSheetProps {
  mode: MealSheetMode | null;
  error?: MealPhotoError | null;
  onCamera: () => void;
  onGallery: () => void;
  onRetry: () => void;
  onClose: () => void;
}

function SourceOption({
  icon,
  label,
  subtitle,
  onPress,
  isLast = false,
}: {
  icon: string;
  label: string;
  subtitle: string;
  onPress: () => void;
  isLast?: boolean;
}) {
  const t = useTheme();
  return (
    <>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
          paddingVertical: spacing.lg,
          paddingHorizontal: spacing.md,
          backgroundColor: pressed ? (t.dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)') : 'transparent',
        })}
      >
        <View
          style={{
            width: 52,
            height: 52,
            borderRadius: 26,
            backgroundColor: t.dark ? 'rgba(47,93,65,0.25)' : 'rgba(47,93,65,0.1)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name={icon as any} size={26} color={t.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: t.text }}>{label}</Text>
          <Text style={{ fontSize: 13, color: t.textMuted, marginTop: 2 }}>{subtitle}</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={t.textMuted} />
      </Pressable>
      {!isLast && (
        <View style={{ height: 1, backgroundColor: t.separator, marginLeft: spacing.md + 52 + spacing.md }} />
      )}
    </>
  );
}

export function MealPhotoSheet({ mode, error, onCamera, onGallery, onRetry, onClose }: MealPhotoSheetProps) {
  const t = useTheme();

  return (
    <BottomSheet visible={mode !== null} onClose={onClose} maxHeightFraction={0.6}>
      {mode === 'picker' && (
        <View style={{ paddingBottom: spacing.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs }}>
            <View
              style={{
                width: 32,
                height: 32,
                borderRadius: 16,
                backgroundColor: t.dark ? 'rgba(47,93,65,0.3)' : 'rgba(47,93,65,0.12)',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="sparkles" size={17} color={t.primary} />
            </View>
            <Text style={{ fontSize: 18, fontWeight: '800', color: t.text }}>
              Analizar plato con IA
            </Text>
          </View>
          <Text style={{ fontSize: 13, color: t.textMuted, marginBottom: spacing.lg }}>
            Foto → nombre del plato, calorías y macros en segundos
          </Text>

          <View
            style={{
              borderRadius: radii.xl,
              borderWidth: 1,
              borderColor: t.cardBorder,
              overflow: 'hidden',
              backgroundColor: t.card,
            }}
          >
            <SourceOption
              icon="camera"
              label="Hacer foto"
              subtitle="Fotografía tu plato ahora mismo"
              onPress={onCamera}
            />
            <SourceOption
              icon="images"
              label="Elegir de galería"
              subtitle="Selecciona una foto ya tomada"
              onPress={onGallery}
              isLast
            />
          </View>

          <Pressable
            onPress={onClose}
            hitSlop={8}
            style={{ alignItems: 'center', paddingVertical: spacing.xl }}
          >
            <Text style={{ fontSize: 15, color: t.textMuted, fontWeight: '600' }}>Cancelar</Text>
          </Pressable>
        </View>
      )}

      {mode === 'error' && (
        <View style={{ paddingBottom: spacing.md, alignItems: 'center', gap: spacing.md }}>
          <View
            style={{
              width: 76,
              height: 76,
              borderRadius: 38,
              backgroundColor: 'rgba(239,68,68,0.1)',
              alignItems: 'center',
              justifyContent: 'center',
              marginTop: spacing.sm,
            }}
          >
            <Ionicons name="alert-circle" size={40} color="#ef4444" />
          </View>

          <Text style={{ fontSize: 18, fontWeight: '800', color: t.text, textAlign: 'center' }}>
            {error?.title ?? 'No se pudo analizar'}
          </Text>
          <Text
            style={{
              fontSize: 14,
              color: t.textMuted,
              textAlign: 'center',
              lineHeight: 21,
              paddingHorizontal: spacing.md,
            }}
          >
            {error?.body ?? 'Algo salió mal. Prueba con otra foto o con mejor iluminación.'}
          </Text>

          <View style={{ width: '100%', gap: spacing.sm, marginTop: spacing.sm }}>
            <Button title="Intentar de nuevo" onPress={onRetry} />
            <Button title="Cancelar" variant="secondary" onPress={onClose} />
          </View>
        </View>
      )}
    </BottomSheet>
  );
}
