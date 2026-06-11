# VeganTrack Mobile 🌱

App Android nativa (React Native + Expo) de **VeganTrack**, con paridad de
features con la [PWA](https://github.com/Jose-L-Gr-Se/vegantrack) y mejoras
arquitectónicas pensadas para móvil: persistencia offline-first con SQLite,
notificaciones locales, deep linking y escáner de códigos de barras con la
cámara nativa.

Ambas apps comparten el **mismo backend Supabase**: puedes usar la PWA y la app
móvil con la misma cuenta y los mismos datos.

## Features

| Feature | Estado | Notas |
| --- | --- | --- |
| Auth (email + password) | ✅ | Sesión en Android Keystore (expo-secure-store) |
| Onboarding (BMR/TDEE Mifflin-St Jeor) | ✅ | Fórmulas idénticas a la PWA |
| Diario por comidas + racha | ✅ | **Offline-first** (espejo SQLite + cola de sync) |
| Búsqueda OpenFoodFacts + filtro vegano | ✅ | Caché de barcodes en SQLite (TTL 7 días) |
| Escáner de código de barras | ✅ | Cámara nativa (expo-camera) |
| Frescos BEDCA (base local) | ✅ | Misma lista que la PWA |
| Alternativas veganas | ✅ | Mismo scoring de similitud nutricional |
| Alimentos personalizados | ✅ | |
| Recetas (crear, ingredientes, loguear) | ✅ | Límite free: 3 |
| VeganScore + desglose | ✅ | Misma puntuación 0-100 que la PWA |
| Micros vs RDA + overrides USDA | ✅ | Hierro ajustado por sexo (8♂/18♀) |
| Progreso de peso (media móvil 7d) | ✅ | Offline-first |
| Suplementos + tomas diarias | ✅ | Límite free: 3 |
| Recordatorio diario | ✅ | **Notificaciones locales** (sin servidor push) |
| Export CSV | ✅ | Hoja de compartir nativa |
| Pro (Stripe) | ✅ | Checkout vía web (mismas APIs Vercel) |
| Deep linking | ✅ | `vegantrack://diary` y `https://vegantrack.app/*` |
| Dark mode | ✅ | Automático según el sistema |

## Arquitectura

```
src/
├── types/          Modelo de datos (espejo de la PWA / esquema Supabase)
├── theme/          Paleta portada de tailwind.config.js (light + dark)
├── utils/          Lógica de negocio pura y testeable:
│   ├── nutrition.ts    BMR/TDEE, objetivos, agregación diaria, RDAs
│   ├── veganScore.ts   Puntuación 0-100 (portada 1:1)
│   └── foodEntry.ts    Escalado de raciones con redondeos de la PWA
├── lib/            Integraciones: Supabase, OpenFoodFacts, overrides, BEDCA
├── db/             SQLite (expo-sqlite): espejo offline + caché OFF + kv
├── stores/         Zustand: auth, diary, weight, recipes, supplements, custom
├── screens/        Una pantalla por feature (5 tabs + Scanner + Recipes)
├── navigation/     React Navigation (tabs + deep linking)
└── notifications/  Recordatorio diario con notificaciones locales
```

### Decisiones clave

- **Offline-first (SQLite + cola de sync)**: el diario y el peso se escriben
  primero en SQLite (`synced=0`), se suben a Supabase y se marcan. Si no hay
  red, `flushPending()` reintenta al volver a abrir la app. Las lecturas
  sirven el espejo local al instante y refrescan desde remoto en segundo plano.
- **Seguridad**: los tokens de sesión viven en el Keystore de Android
  (expo-secure-store, troceado en chunks por el límite de 2 KB).
- **Performance**: tabs lazy, caché de productos OFF en SQLite (TTL 7 días,
  como la PWA pero local), listas remotas cacheadas en `kv` para arranque
  instantáneo sin red, búsqueda con debounce de 400 ms.
- **Paridad**: las fórmulas (Mifflin-St Jeor, VeganScore, redondeos por
  nutriente, conversión de unidades de OFF) están portadas literalmente y
  cubiertas por tests para que un mismo día dé el mismo resultado en PWA y móvil.

## Setup

Requisitos: Node 22+, npm, y para builds nativas JDK 17+ y Android SDK.

```bash
git clone https://github.com/Jose-L-Gr-Se/vegantrack-mobileclaude.git
cd vegantrack-mobileclaude
npm install

# Configura el backend (mismo proyecto Supabase que la PWA)
cp .env.example .env
#   EXPO_PUBLIC_SUPABASE_URL=...
#   EXPO_PUBLIC_SUPABASE_ANON_KEY=...
```

### Desarrollo

```bash
npm start            # Metro + QR para development build
npm run android      # abre en emulador/dispositivo Android
```

> La app usa módulos nativos (SQLite, cámara, notificaciones), así que en vez
> de Expo Go necesitas un [development build](https://docs.expo.dev/develop/development-builds/introduction/):
> `npx expo run:android`.

### Tests y typecheck

```bash
npm test             # jest (lógica de negocio: nutrición, score, OFF, raciones)
npm run typecheck    # tsc --noEmit
```

### Build de producción (APK / AAB)

```bash
npm run prebuild:android   # genera el proyecto nativo android/
npm run build:apk          # android/app/build/outputs/apk/release/
npm run build:aab          # bundle para Play Store
```

Para publicar en Play Store configura un keystore propio en
`android/app/build.gradle` (`signingConfigs.release`).

## CI/CD

`.github/workflows/ci.yml`:

1. **test** — typecheck + jest en cada push/PR.
2. **build-android** — en `main` (o manualmente con *workflow_dispatch*)
   genera el proyecto nativo con `expo prebuild` y construye el APK release,
   que queda como artifact descargable.

Secrets necesarios en el repo: `EXPO_PUBLIC_SUPABASE_URL` y
`EXPO_PUBLIC_SUPABASE_ANON_KEY`.

## Backend

No hay esquema nuevo: la app usa las tablas existentes del proyecto Supabase de
la PWA (`profiles`, `food_log`, `custom_foods`, `recipes`,
`recipe_ingredients`, `weight_logs`, `supplements`, `supplement_logs`,
`nutrient_overrides`) y la RPC `update_streak`. La tabla `food_cache` remota no
se usa: el caché de OpenFoodFacts es local (SQLite).
