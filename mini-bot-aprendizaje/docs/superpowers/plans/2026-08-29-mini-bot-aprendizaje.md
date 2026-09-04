# Mini-bot de aprendizaje Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dos scripts de Node.js que le muestran a Nico, corriendo en su propia terminal, cómo un programa se conecta con un LLM (Gemini) — primero en modo chat libre, después replicando la extracción estructurada de datos que hace el bot real.

**Architecture:** Cada script es un archivo único y autocontenido que llama directo al endpoint REST de Gemini con `fetch` nativo de Node — sin frameworks, sin capas. `dotenv` carga la API key desde `.env`. No hay servidor, no hay webhook: todo corre y se prueba a mano por terminal.

**Tech Stack:** Node.js (18+, por el `fetch` nativo), `dotenv`, API de Gemini (`generativelanguage.googleapis.com`).

**Spec:** `mini-bot-aprendizaje/docs/superpowers/specs/2026-08-29-mini-bot-aprendizaje-design.md`

## Global Constraints

- Sin frameworks ni dependencias más allá de `dotenv` (la spec pide "conexión más simple posible").
- Sin tests automatizados — verificación 100% manual, corriendo los scripts y leyendo la salida (la spec lo dice explícitamente).
- La API key nunca se commitea — vive solo en `.env`, que está en `.gitignore`.
- Mismo nombre de modelo (`gemini-flash-lite-latest`) y mismo prompt de extracción que usa `bot_lista_espera.gs`, para que el paralelismo con el bot real sea directo.

---

### Task 1: Scaffolding del proyecto

**Files:**
- Create: `mini-bot-aprendizaje/package.json`
- Create: `mini-bot-aprendizaje/.gitignore`
- Create: `mini-bot-aprendizaje/.env.example`

**Interfaces:**
- Produces: dependencia `dotenv` instalada en `node_modules/`, disponible para los Tasks 3 y 4 vía `require('dotenv').config()`.

- [ ] **Step 1: Crear `package.json`**

```json
{
  "name": "mini-bot-aprendizaje",
  "version": "1.0.0",
  "private": true,
  "description": "Mini proyecto para aprender como un bot se conecta con un LLM (Gemini).",
  "main": "01-chat-simple.js",
  "scripts": {
    "chat": "node 01-chat-simple.js",
    "extraer": "node 02-extraer-datos.js"
  },
  "dependencies": {
    "dotenv": "^16.4.5"
  }
}
```

- [ ] **Step 2: Crear `.gitignore`**

```
node_modules/
.env
```

- [ ] **Step 3: Crear `.env.example`**

```
GEMINI_API_KEY=tu_api_key_aca
```

- [ ] **Step 4: Instalar dependencias**

Run: `cd mini-bot-aprendizaje && npm install`
Expected: se crea `node_modules/` y `package-lock.json`, sin errores.

- [ ] **Step 5: Verificar versión de Node**

Run: `node --version`
Expected: `v18.x` o superior (por el `fetch` nativo). Si es menor, avisar a Nico antes de seguir — hay que actualizar Node.

---

### Task 2: Conseguir la API key de Gemini y crear `.env`

Esto no es código — es una acción manual de Nico. El engineer que ejecute
este task debe guiarlo, no hacerlo por él (la key es un secreto personal).

**Files:**
- Create: `mini-bot-aprendizaje/.env` (Nico la crea/edita, no se commitea)

**Interfaces:**
- Produces: variable de entorno `GEMINI_API_KEY`, consumida en Tasks 3 y 4.

- [ ] **Step 1: Indicarle a Nico los pasos para obtener la key**

1. Ir a https://aistudio.google.com
2. Iniciar sesión con su cuenta de Google
3. Buscar "Get API key" / "Obtener clave de API" (usualmente arriba a la izquierda)
4. Crear una key nueva (o usar una existente)
5. Copiarla

- [ ] **Step 2: Nico crea `.env` copiando `.env.example`**

Nico edita el archivo (no el engineer, para que la key no quede expuesta en
ningún log de esta sesión) y pega su key real:

```
GEMINI_API_KEY=AIza...su_key_real
```

- [ ] **Step 3: Confirmar que el archivo existe y no está vacío**

Run: `cat mini-bot-aprendizaje/.env` (o abrirlo en el editor)
Expected: una línea `GEMINI_API_KEY=` seguida de una key real, no el placeholder.

---

### Task 3: `01-chat-simple.js` — chat libre por terminal

**Files:**
- Create: `mini-bot-aprendizaje/01-chat-simple.js`

**Interfaces:**
- Consumes: `process.env.GEMINI_API_KEY` (de Task 2), paquete `dotenv` (de Task 1).
- Produces: nada que otro task consuma — es una hoja terminal del proyecto.

- [ ] **Step 1: Escribir el script completo**

```javascript
require('dotenv').config();
const readline = require('readline');

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = 'gemini-flash-lite-latest'; // verificar nombre vigente en aistudio.google.com
const URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;

if (!API_KEY) {
  console.error('Falta GEMINI_API_KEY en el archivo .env');
  process.exit(1);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

async function preguntar(texto) {
  const payload = { contents: [{ parts: [{ text: texto }] }] };

  const response = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Gemini respondió ${response.status}: ${errorBody}`);
  }

  const data = await response.json();
  return data.candidates[0].content.parts[0].text;
}

function loop() {
  rl.question('Vos: ', async (texto) => {
    if (texto.toLowerCase() === 'salir') {
      rl.close();
      return;
    }
    try {
      const respuesta = await preguntar(texto);
      console.log('Gemini: ' + respuesta);
    } catch (err) {
      console.error('Error: ' + err.message);
    }
    loop();
  });
}

console.log('Chat simple con Gemini. Escribi "salir" para terminar.');
loop();
```

- [ ] **Step 2: Correrlo y probar manualmente**

Run: `node 01-chat-simple.js` (parado en `mini-bot-aprendizaje/`)
Escribir algo simple, ej. `Hola, quién sos?`, y después `salir`.
Expected: aparece `Gemini: ...` con una respuesta coherente, y el programa
termina limpio al escribir `salir`. Si tira `Gemini respondió 400` o `403`,
la key está mal cargada — volver al Task 2.

- [ ] **Step 3: Commit**

```bash
git add 01-chat-simple.js
git commit -m "feat: chat simple con Gemini por terminal"
```

(Este commit asume que Task 6 ya corrió `git init` — si se ejecuta este
task antes, el `git add`/`commit` se pospone hasta después del Task 6.)

---

### Task 4: `02-extraer-datos.js` — mini versión del bot real

**Files:**
- Create: `mini-bot-aprendizaje/02-extraer-datos.js`

**Interfaces:**
- Consumes: `process.env.GEMINI_API_KEY` (de Task 2), paquete `dotenv` (de Task 1).
- Produces: nada que otro task consuma.

- [ ] **Step 1: Escribir el script completo**

```javascript
require('dotenv').config();

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = 'gemini-flash-lite-latest'; // verificar nombre vigente en aistudio.google.com
const URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;

if (!API_KEY) {
  console.error('Falta GEMINI_API_KEY en el archivo .env');
  process.exit(1);
}

// Mismos campos que pide bot_lista_espera.gs en parseWithGemini()
const CAMPOS = ['nombre', 'vuelo', 'cantidad_personas', 'motivo'];

async function extraerDatos(textoLibre) {
  const prompt = 'Del siguiente mensaje de un pasajero de aeropuerto, extraé SOLO estos campos si están ' +
    'presentes: ' + CAMPOS.join(', ') + '. Respondé ÚNICAMENTE un JSON con esas claves exactas, ' +
    'sin texto adicional. Si un campo no está en el mensaje, poné null.\n\nMensaje: "' + textoLibre + '"';

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json' }
  };

  const response = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Gemini respondió ${response.status}: ${errorBody}`);
  }

  const data = await response.json();
  const textoRespuesta = data.candidates[0].content.parts[0].text;
  return JSON.parse(textoRespuesta);
}

const ejemplos = [
  'Juan Pérez, AA1234, somos 3, sala llena',
  'me llamo Rosa Gómez y esperamos porque no entrábamos, vuelo LA800, somos 2 personas',
  'Carlos Ruiz vuelo IB6844'
];

(async () => {
  for (const texto of ejemplos) {
    console.log('\nTexto: ' + texto);
    try {
      const datos = await extraerDatos(texto);
      console.log('JSON extraído:', datos);
    } catch (err) {
      console.error('Error: ' + err.message);
    }
  }
})();
```

- [ ] **Step 2: Correrlo y verificar la salida**

Run: `node 02-extraer-datos.js`
Expected: por cada uno de los 3 textos de ejemplo, se imprime un objeto
JSON con `nombre`, `vuelo`, `cantidad_personas`, `motivo` — con `null` en
los campos que ese texto no menciona (ej. el tercer ejemplo no dice
cantidad ni motivo).

- [ ] **Step 3: Commit**

```bash
git add 02-extraer-datos.js
git commit -m "feat: mini extraccion de datos estructurados con Gemini"
```

---

### Task 5: `README.md` — explicar el proyecto

**Files:**
- Create: `mini-bot-aprendizaje/README.md`

**Interfaces:**
- Consumes: nada (es documentación).
- Produces: nada.

- [ ] **Step 1: Escribir el README**

```markdown
# Mini-bot de aprendizaje

Proyecto chico para entender cómo un bot se conecta con un LLM (Gemini),
antes de retomar el bot real de la sala VIP.

## Qué hay acá

- `01-chat-simple.js` — chat libre por terminal. Escribís algo, Gemini
  responde, repite. La conexión más simple posible entre código y LLM.
- `02-extraer-datos.js` — el mismo mecanismo, pero pidiéndole a Gemini
  que devuelva datos estructurados (JSON) en vez de texto libre. Es una
  mini versión de `parseWithGemini()` en el bot real
  (`Agente-WPP/.claude/bot_lista_espera.gs`).

## Cómo correrlo

1. `npm install`
2. Copiar `.env.example` a `.env` y pegar tu API key de Gemini
   (se consigue en https://aistudio.google.com)
3. `npm run chat` → para el chat libre
4. `npm run extraer` → para la extracción de datos

## Paralelismo con el bot real

| Acá | En `bot_lista_espera.gs` |
|---|---|
| `preguntar()` en `01-chat-simple.js` | `parseWithGemini()` sin estructura |
| `extraerDatos()` en `02-extraer-datos.js` | `parseWithGemini()` tal cual |
| `.env` + `dotenv` | Script Properties de Apps Script |
| `fetch` nativo | `UrlFetchApp.fetch()` de Apps Script |

La diferencia es el entorno (Node vs. Apps Script) y que acá no hay
WhatsApp, Sheets, ni respaldo por comas — solo la conexión con el LLM.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: explicar el mini-bot y su paralelismo con el bot real"
```

---

### Task 6: `git init` y push a GitHub

**Files:**
- Ninguno nuevo — opera sobre el repo git de `mini-bot-aprendizaje/`.

**Interfaces:**
- Consumes: todos los archivos de los Tasks 1-5.
- Produces: repo en GitHub con el historial de commits de este plan.

- [ ] **Step 1: Inicializar git (si no se hizo ya al principio)**

Run (parado en `mini-bot-aprendizaje/`): `git init`

- [ ] **Step 2: Verificar que `.env` no está trackeado**

Run: `git status`
Expected: `.env` NO aparece en la lista de archivos a commitear (gracias
al `.gitignore` del Task 1). Si aparece, parar y arreglar antes de seguir.

- [ ] **Step 3: Preguntarle a Nico: repo público o privado, y nombre**

No asumir — confirmar antes de crear nada en GitHub.

- [ ] **Step 4: Crear el repo remoto y pushear**

Con GitHub CLI (`gh`) ya autenticado:

```bash
gh repo create <nombre-elegido> --source=. --remote=origin --public
# o --private, según lo que haya elegido Nico
git branch -M main
git push -u origin main
```

Si `gh` no está autenticado en esta máquina, crear el repo manualmente en
github.com y usar `git remote add origin <url>` en su lugar.

- [ ] **Step 5: Confirmar en GitHub**

Abrir la URL del repo (la imprime `gh repo create`) y verificar que los
5 commits de los Tasks 1-5 están ahí, y que `.env` no está.

---

## Self-Review

- **Cobertura de la spec:** Parte 1 → Task 3. Parte 2 → Task 4. Estructura
  de archivos → Tasks 1, 3, 4, 5. Testing manual → Step 2 de cada task de
  código. Git init + push → Task 6. Todo cubierto.
- **Placeholders:** ninguno — cada step tiene código o comandos reales.
- **Consistencia:** `MODEL`, `URL`, y el patrón `require('dotenv').config()`
  son idénticos en Tasks 3 y 4. `CAMPOS` en Task 4 coincide con los campos
  reales de `FIELDS` en `bot_lista_espera.gs`.
