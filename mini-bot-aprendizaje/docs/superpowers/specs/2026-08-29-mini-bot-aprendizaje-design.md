# Mini-bot de aprendizaje — diseño

## Propósito

Proyecto chico y descartable (en el sentido de "no va a producción") para que
Nico entienda, con código propio y corriendo en su terminal, cómo un bot se
conecta con un modelo de lenguaje (LLM). Es el paso previo a retomar el
proyecto real, [[Bot lista de espera]] (`Agente-WPP/.claude/bot_lista_espera.gs`),
del que replica el patrón central sin ninguna de sus dependencias externas
(WhatsApp, Google Sheets, Apps Script).

No es código para mantener ni escalar. Es material de estudio.

## Alcance

Dos scripts de Node.js, independientes entre sí, corridos a mano por terminal.

### Parte 1 — `01-chat-simple.js`

Loop de lectura por terminal (`readline`) → envío del texto a la API de
Gemini → impresión de la respuesta → vuelve a preguntar. Sin estructura,
sin JSON, sin lógica de negocio. Objetivo: ver la conexión más simple
posible entre "lo que escribo" y "lo que responde la IA".

### Parte 2 — `02-extraer-datos.js`

Mismo mecanismo de conexión, aplicado a la tarea real que cumple
`parseWithGemini()` en el bot de producción: recibe un texto libre
(ej. `"Juan Pérez, AA1234, somos 3, sala llena"`), le pide a Gemini que
devuelva un JSON con `nombre`, `vuelo`, `cantidad_personas`, `motivo`, y lo
imprime. Objetivo: ver que la IA no solo charla — puede devolver datos con
una forma específica que el código después consume.

## Fuera de alcance (a propósito)

- Nada de WhatsApp, webhooks, ni Google Sheets/Apps Script.
- Nada de manejo de errores robusto ni reintentos — eso ya existe en el bot
  real y no es el objetivo de este ejercicio.
- Nada de tests automatizados.
- No se despliega a ningún lado. Corre local, en la compu de Nico.

## Arquitectura / flujo de datos

```
Terminal (input de Nico)
      │
      ▼
Script Node.js  ──llamada HTTP──▶  API de Gemini
      │                                  │
      ◀──────────respuesta───────────────┘
      │
      ▼
Terminal (output)
```

Mismo flujo en las dos partes; en la Parte 2 la respuesta de Gemini viene
en formato JSON en vez de texto libre.

## Archivos del proyecto

```
mini-bot-aprendizaje/
  ├── .env                 → GEMINI_API_KEY (no se commitea)
  ├── .gitignore            → ignora .env y node_modules
  ├── package.json
  ├── 01-chat-simple.js
  ├── 02-extraer-datos.js
  └── README.md             → qué es cada archivo, cómo correrlo, y el paralelismo
                               explícito con bot_lista_espera.gs
```

## Testing

Manual: correr `node 01-chat-simple.js` y `node 02-extraer-datos.js` en la
terminal y observar el comportamiento con distintos textos de entrada. No
hay suite automatizada — el objetivo es entender, no cubrir casos.

## Criterio de éxito

Nico puede explicar, sin mirar el código, la diferencia entre "el bot" y
"el LLM", y señalar en `bot_lista_espera.gs` dónde ocurre el mismo patrón
que vio funcionando acá.

## Después

Una vez corridos y entendidos los dos scripts: `git init`, primer commit,
y push a un repo nuevo en GitHub (público o privado, a decidir por Nico).
Luego se retoma el proyecto real desde donde había quedado (Paso 1 del
setup en `Agente-WPP/.claude/CLAUDE.md`).
