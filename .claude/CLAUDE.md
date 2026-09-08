# Bot de lista de espera — sala VIP / FastPass

---

## 🟢 EMPEZÁ POR ACÁ (resumen para no perderse)

**En una frase:** un bot de WhatsApp que anota gente en una cola de espera y la
muestra en un Google Sheet, para que la recepción de la sala no lo haga a mano.

**Las 3 piezas del sistema:**

1. **WhatsApp (Meta)** — recibe el mensaje del pasajero y avisa al bot.
2. **Google Apps Script** (`bot_lista_espera.gs`) — el cerebro: lee el mensaje,
   entiende los datos, decide qué contestar.
3. **Google Sheet** — la "base de datos": una fila por pasajero en la cola.

**Estado hoy:** el código está escrito pero _nunca se probó de verdad_. Lo que
falta NO es programar, es **configurar cuentas y conectar cosas**.

### Paso a paso para ponerlo a andar

| #   | Paso                                                                                                                  | Dónde                       |
| --- | --------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| 1   | Crear la hoja `Lista de espera` con los encabezados (ver abajo)                                                       | Google Sheets               |
| 2   | Pegar el código `bot_lista_espera.gs` en un proyecto de Apps Script ligado a esa hoja                                 | script.google.com           |
| 3   | Crear una app de tipo _Business_ y agregarle el producto _WhatsApp_                                                   | developers.facebook.com     |
| 4   | Verificar el negocio (puede tardar días)                                                                              | Meta Business               |
| 5   | Copiar el `Phone Number ID` y generar un _token permanente_                                                           | Meta for Developers         |
| 6   | Publicar el `.gs` como **Web App** (Ejecutar como: Yo · Acceso: Cualquiera)                                           | Apps Script → Implementar   |
| 7   | Pegar esa URL como _webhook_ en Meta y suscribirse al campo `messages`                                                | Meta for Developers         |
| 8   | Cargar en _Propiedades del script_: `WHATSAPP_TOKEN`, `PHONE_NUMBER_ID`, `VERIFY_TOKEN` (y opcional `GEMINI_API_KEY`) | Apps Script → Configuración |
| 9   | Probar con tu propio número (Meta permite hasta 5 sin verificación completa)                                          | WhatsApp                    |

**Encabezados exactos de la hoja (fila 1):**
`telefono | nombre | vuelo | cantidad_personas | motivo | estado | timestamp`

**Glosario rápido:**

- _Webhook_ = una URL a la que Meta le avisa "llegó un mensaje".
- _Web App (Apps Script)_ = publicar tu código como una URL pública que responde a esos avisos.
- _Script Properties_ = variables secretas (tokens) que el código lee sin que estén escritas en el código.
- _Token permanente_ = clave de acceso a la API de WhatsApp que no vence a las 24h.

> El resto del documento es el _por qué_ de cada decisión y los riesgos. Léelo
> cuando algo no funcione o antes de tocar el código — no hace falta de entrada.

---

## Qué es esto

Bot de WhatsApp para gestionar la lista de espera cuando la sala está llena.
El pasajero escanea un QR, escribe al bot, y el bot recopila sus datos y lo
suma a una cola visible en Google Sheets — sin que el staff tenga que
anotarlo a mano ni contestar "¿cuánto me falta?" uno por uno.

## Contexto de negocio (para no perder de vista el porqué de las decisiones)

- Volumen: 200-300 personas por turno de 8 horas.
- Pico: 18-23h, donde se concentra la mayor parte del movimiento.
- Concurrencia real máxima: 5-10 personas anotándose casi al mismo tiempo
  (tope físico dado por 2 recepcionistas trabajando en simultáneo).
- Los grupos se anotan con **una sola conversación**: una persona pone la
  cantidad total en el campo `cantidad_personas`, no se anota cada
  integrante por separado.
- El bot **nunca inicia conversaciones**, solo responde. Esto es intencional:
  mantiene todo el intercambio dentro de la ventana de servicio gratuita de
  WhatsApp Cloud API (mensajes iniciados por el cliente, sin costo).

## Decisiones de arquitectura ya tomadas (y por qué)

| Decisión                                                                   | Alternativa descartada                                   | Por qué                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Apps Script recibe el webhook de Meta directamente                         | n8n self-hosted como receptor                            | El n8n de Nico corre en `nicomg.duckdns.org`, probablemente una red casera con IP dinámica. Apps Script corre en infraestructura de Google — no depende del router de casa en la hora pico.                                         |
| Google Sheets como base de datos                                           | Base de datos real                                       | El volumen (300/turno) está muy por debajo de cualquier límite práctico de Sheets. No se justifica la complejidad extra todavía.                                                                                                    |
| Sin lock global (`LockService`) en `doPost`                                | Lock global serializando todos los mensajes              | Pasajeros distintos escriben en filas distintas — serializar a todos por un lock global crea una cola artificial. Se reemplazó por deduplicación puntual por ID de mensaje (evita procesar dos veces si Meta reintenta el webhook). |
| Gemini como parser principal, con parser por comas como respaldo           | Solo Gemini / solo comas                                 | Si Gemini falla (cuota agotada, red, JSON inválido) el mensaje no se pierde: cae al parseo posicional por comas. Nunca depende 100% de un servicio externo de pago, de ahí el respaldo.                                             |
| Un solo mensaje del pasajero con todos los datos, no pregunta-por-pregunta | Flujo paso a paso (una pregunta, una respuesta, repetir) | Menos idas y vueltas. El costo es que el parseo es más difícil (де ahí Gemini + respaldo).                                                                                                                                          |

## Estado actual del código

Archivo: `bot_lista_espera.gs` (Google Apps Script)

- `doGet(e)` — verificación del webhook de Meta (se llama una sola vez al configurar).
- `doPost(e)` — punto de entrada de cada mensaje de WhatsApp. Deduplica por
  `message.id` usando `CacheService` (60s), delega en `handleMessage`.
- `handleMessage(phone, text)` — el cerebro del bot:
  - Si el pasajero escribe "estado" y ya está anotado → responde su posición en la cola.
  - Si es la primera vez que escribe → crea la fila en el Sheet y manda las instrucciones.
  - Si ya está anotado (`estado === 'activo'`) → le avisa que ya está en la lista.
  - Si no → intenta parsear los campos que faltan con Gemini; si Gemini no
    devuelve nada útil, cae al parseo por comas; valida que
    `cantidad_personas` sea numérico; guarda lo que pudo asignar; si
    completó todo, marca `activo` y confirma; si no, repregunta puntualmente
    solo lo que falta.
- `parseWithGemini(text, camposFaltantes)` — llama a la API de Gemini
  (`generativelanguage.googleapis.com`) pidiendo un JSON con los campos
  faltantes. Devuelve `null` ante cualquier falla (sin API key configurada,
  HTTP != 200, JSON inválido) para que `handleMessage` use el respaldo.
- `calcularPosicion(sheet, phone)` — posición en la cola según orden de
  llegada entre los que están `activo`.
- `sendWhatsApp(to, bodyText)` — envía un mensaje de texto vía Graph API de Meta.

### Estructura del Sheet (hoja `Lista de espera`)

```
telefono | nombre | vuelo | cantidad_personas | motivo | estado | timestamp
```

### Script Properties necesarias

- `WHATSAPP_TOKEN` — token del sistema (permanente, no el temporal de 24h).
- `PHONE_NUMBER_ID` — de la app de WhatsApp en Meta for Developers.
- `VERIFY_TOKEN` — inventado por vos, tiene que coincidir con lo que pongas en Meta.
- `GEMINI_API_KEY` — opcional. Sin ella, el bot funciona igual con el parser por comas.

## Setup pendiente (no es código, es configuración externa)

1. Crear app de tipo Business en developers.facebook.com, agregar el producto WhatsApp.
2. Verificar el negocio (documentación de registro/domicilio; puede tardar de horas a 2 semanas).
3. Obtener `Phone Number ID` y generar un `system user token` permanente.
4. Publicar el `.gs` como Web App (Ejecutar como: Yo / Acceso: Cualquier usuario).
5. Configurar esa URL como webhook en Meta, suscribirse al campo `messages`.
6. Cargar las Script Properties.
7. Probar con el número de prueba que da Meta (hasta 5 números autorizados sin verificación completa).

## Supuestos sin confirmar / riesgos conocidos

- **El nombre de modelo de Gemini (`gemini-flash-lite-latest`) no está confirmado contra la documentación vigente** — hay que chequearlo en aistudio.google.com antes de producción, estos nombres cambian seguido.
- **Los límites exactos del free tier de Gemini (RPM/RPD) variaron entre fuentes consultadas** (10-15 RPM, 250-1500 RPD según modelo) — confirmar en el proyecto real de AI Studio.
- **La asignación de campos es posicional, no semántica.** Si el pasajero manda los datos en un orden distinto al pedido cuando el respaldo por comas entra en juego (Gemini falló), se puede guardar mal. Gemini mitiga esto en el camino feliz, pero el respaldo no.
- **Validación de formato de `vuelo` es liviana (regex de forma IATA)** — rechaza texto que claramente no es un código de vuelo, pero no valida que el vuelo exista realmente ni contra una lista de aerolíneas.
- **Nunca se probó con concurrencia real.** Todo el análisis de carga es cálculo contra cuotas documentadas de Google, no una prueba con tráfico real.
- **Tema legal pendiente sin resolver:** se está capturando y almacenando información de pasajeros (nombre, vuelo) fuera del sistema oficial de control de acceso. Ley 25.326 (Protección de Datos Personales, Argentina) puede aplicar. No se consultó a un abogado — pendiente antes de escalar esto más allá de una sala.
- **Multi-sala no está resuelto.** El diseño asume un solo número de WhatsApp / una sola cola. Si Star Alliance y FastPass comparten número, hace falta agregar una columna `sala` y una forma de distinguir origen (ej. texto prellenado distinto por QR).

## Plan de testing (antes de ir a producción en hora pico)

1. Probar el camino feliz en horario tranquilo (mañana).
2. Prueba de ráfaga deliberada: juntar 5-10 personas y que manden el primer mensaje todas juntas a una señal, para forzar ejecuciones concurrentes reales — un test secuencial de a una persona nunca genera este escenario.
3. Primer día en hora pico real: revisar el log de ejecuciones de Apps Script al final del turno, prestar atención a errores 429 de Gemini (señal de que se está usando el respaldo por comas más de lo esperado).
4. Mantener el proceso manual de los recepcionistas como red durante la primera exposición a tráfico alto — no asumir que el bot lo reemplaza desde el día uno.

## Backlog / no empezado todavía

- Dashboard interno para el staff (métricas: tiempo promedio de espera, pico por franja horaria, no-shows).
- Página de estado propia para autoconsulta sin pasar por WhatsApp (alternativa/complemento al comando "estado").
- Decisión sobre si Star Alliance y FastPass comparten número de WhatsApp o tienen uno cada una.
