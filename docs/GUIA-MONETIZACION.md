# Guía de monetización — VeganTrack en Google Play con RevenueCat

Objetivo: vender el plan **Pro** (4,99 €/mes · 29,99 €/año con 3 días de prueba)
dentro de la app, usando **Google Play Billing** a través de **RevenueCat**, con
el estado Pro sincronizado en Supabase.

> Reglas del juego: en la Play Store, las suscripciones digitales SOLO pueden
> cobrarse con Play Billing (no Stripe). RevenueCat es la capa que lo hace
> sencillo y multiplataforma. No cobras a nadie hasta que la app esté publicada.

---

## Visión general del flujo

```
Usuario pulsa "Hazte Pro"
   → RevenueCat SDK abre la compra nativa de Google Play
   → Google cobra y valida el recibo
   → RevenueCat → webhook → Supabase (profiles.subscription_tier = 'pro')
   → La app y la cuota de IA ya ven al usuario como Pro
```

---

## FASE 1 · Google Play Console

1. **Crear cuenta de desarrollador**
   - Entra en https://play.google.com/console y regístrate.
   - Paga la cuota única de **25 $**.
   - Google te pedirá **verificar tu identidad** (DNI/pasaporte). Puede tardar
     de unas horas a 2-3 días. No puedes publicar hasta que esté verificada.

2. **Configurar el perfil de pagos (Merchant)**
   - En Play Console → *Configuración de pagos*. Necesitas añadir tus datos
     fiscales y una **cuenta bancaria** para recibir los cobros. Sin esto no
     puedes vender suscripciones.

3. **Crear la app**
   - Botón *Crear app*.
   - Nombre: **VeganTrack** · Idioma: Español · Tipo: App · Gratis (con
     compras integradas).

4. **Completar las tareas de “Contenido de la app”** (menú *Política*)
   - Política de privacidad (URL) — necesitas una página con tu política.
   - Cuestionario de clasificación de contenido.
   - Público objetivo y “Data safety” (qué datos recoges).
   - Declaración de anuncios (no tienes → “No”).
   Estas tareas son obligatorias para que Google revise/publique la app.

5. **Subir una primera versión a *Testing interno***
   - Menú *Pruebas → Pruebas internas → Crear versión*.
   - Aquí subirás un archivo **`.aab`** (no `.apk`). Yo cambio el build para
     generar el `.aab` firmado cuando lleguemos a este punto.
   - Añade tu propio email como **tester** para poder probar las compras.

---

## FASE 2 · Crear la suscripción (en Play Console)

Menú *Monetizar → Productos → Suscripciones → Crear suscripción*.

1. **ID del producto** (no se puede cambiar luego): `vegantrack_pro`
2. **Base plans (planes base)** dentro de esa suscripción:
   - Plan **mensual**: ID `monthly` · periodo *1 mes* · precio **4,99 €** ·
     renovación automática.
   - Plan **anual**: ID `annual` · periodo *1 año* · precio **29,99 €** ·
     renovación automática.
3. **Oferta de prueba gratis** (en el plan anual):
   - Añade una *offer* de tipo **prueba gratuita** de **3 días**.
4. **Activa** los dos planes base.

> Apunta los IDs exactos que uses: los necesito para conectar RevenueCat.

---

## FASE 3 · RevenueCat

1. **Crear cuenta y proyecto**
   - https://www.revenuecat.com (gratis hasta 2.500 $/mes de ingresos).
   - Crea un *Project* llamado VeganTrack.
   - Añade una app de tipo **Google Play Store**, paquete `com.vegantrack.app`.

2. **Credenciales de Google (la parte más liosa)** — detalle abajo en el Anexo.
   RevenueCat necesita una *service account* de Google con permiso para
   validar las compras. Sin esto no funcionan los pagos.

3. **Crear el Entitlement**
   - En *Entitlements → New*. ID: **`pro`**. Es el “permiso” que da el acceso
     Pro.

4. **Importar los productos**
   - En *Products*, añade los IDs de Play: `vegantrack_pro:monthly` y
     `vegantrack_pro:annual` (RevenueCat los detecta de Play).
   - Asócialos al entitlement `pro`.

5. **Crear el Offering**
   - En *Offerings*, crea uno por defecto (`default`) con dos **packages**:
     - Mensual → producto mensual.
     - Anual → producto anual.

6. **Coger la API key pública**
   - *Project settings → API keys* → copia la **Public app-specific key**
     de Android (empieza por `goog_...`). Me la pasas.

7. **Webhook hacia Supabase**
   - *Project settings → Integrations → Webhooks → Add*.
   - URL: `https://hsxqwhsyqtdaenjxlhzo.supabase.co/functions/v1/revenuecat-webhook`
   - Authorization header: el mismo valor que pongas en Supabase (Fase 4).

---

## FASE 4 · Conectar el webhook (Supabase)

1. En **Supabase → Edge Functions → Manage secrets** crea:
   - `REVENUECAT_WEBHOOK_AUTH` = *(una contraseña larga aleatoria que inventes)*
2. Pon ESE MISMO valor en el campo *Authorization header* del webhook de
   RevenueCat (Fase 3, punto 7).

El webhook (`revenuecat-webhook`) ya está desplegado y esperando esos eventos.

---

## ANEXO · Credenciales de Google para RevenueCat (paso a paso)

Esto conecta RevenueCat con tu cuenta de Google para que pueda verificar las
compras. Es lo más confuso, hazlo con calma.

1. **Vincular un proyecto de Google Cloud**
   - Play Console → *Configuración → Acceso a la API* (API access).
   - Vincula (o crea) un **proyecto de Google Cloud**.

2. **Activar la API**
   - En https://console.cloud.google.com (mismo proyecto) → *APIs y servicios
     → Biblioteca* → busca **“Google Play Android Developer API”** → *Habilitar*.

3. **Crear la cuenta de servicio**
   - Google Cloud → *IAM y administración → Cuentas de servicio → Crear*.
   - Nombre: `revenuecat`. Créala (sin roles especiales en este paso).
   - Entra en la cuenta creada → pestaña *Claves → Agregar clave → Crear
     clave nueva → JSON*. Se descarga un archivo `.json`. **Guárdalo.**

4. **Dar permisos a esa cuenta en Play Console**
   - Play Console → *Usuarios y permisos → Invitar nuevo usuario*.
   - Pega el email de la cuenta de servicio (algo como
     `revenuecat@...iam.gserviceaccount.com`).
   - Dale permisos de: **ver datos financieros**, **gestionar pedidos y
     suscripciones** y **ver información de la app**.

5. **Subir el JSON a RevenueCat**
   - RevenueCat → tu app de Android → *Service Account credentials JSON* →
     sube el archivo `.json`.

6. **Esperar la propagación**
   - Google tarda hasta **24-36 h** en activar los permisos. RevenueCat
     mostrará un aviso hasta que la conexión funcione. Es normal.

---

## Qué me tienes que pasar para que yo termine

- [ ] **Public SDK Key (Android)** de RevenueCat (`goog_...`)
- [ ] **Entitlement ID** (si es `pro`, perfecto)
- [ ] **IDs de productos / offering** (`vegantrack_pro:monthly`, `:annual`, offering `default`)

## Qué haré yo entonces (un solo pase)

- Integrar `react-native-purchases` (RevenueCat) en la app
- Reescribir el paywall para comprar por Play Billing
- `Purchases.logIn(userId)` para enlazar con Supabase
- Gating final + precios + prueba de 3 días
- Cambiar el build a `.aab` firmado para la store

## Orden recomendado

1. Fase 1 (cuenta + verificación de identidad) — es lo que más tarda, empieza ya.
2. Anexo (credenciales Google) — tiene 24-36 h de espera, lánzalo pronto.
3. Fase 2 (productos) y Fase 3-4 (RevenueCat + webhook).
4. Me pasas los 3 datos → termino la integración.
