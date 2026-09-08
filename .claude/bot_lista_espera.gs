/**
 * Bot de lista de espera para WhatsApp Cloud API.
 * Solo RESPONDE mensajes entrantes — nunca inicia conversaciones,
 * por lo que cae siempre dentro de la ventana de servicio gratuita de Meta.
 *
 * FLUJO:
 * 1. Pasajero escanea QR -> WhatsApp abre con mensaje prellenado -> lo manda.
 * 2. Bot responde con instrucciones (qué datos mandar, separados por coma).
 * 3. Pasajero manda un mensaje con los datos.
 * 4. Bot parsea. Si falta algo o algo no es válido, repregunta puntualmente
 *    solo por lo que falta (no reinicia todo el flujo).
 * 5. Completo -> marca "activo" en el Sheet y confirma.
 *
 * SETUP:
 * 1. Crear una hoja llamada exactamente como SHEET_NAME con esta fila de encabezados:
 *    telefono | nombre | vuelo | cantidad_personas | motivo | estado | timestamp
 * 2. En Configuración del proyecto > Propiedades del script, agregar:
 *    WHATSAPP_TOKEN, PHONE_NUMBER_ID, VERIFY_TOKEN
 * 3. Implementar como Web App (Ejecutar como: Yo / Acceso: Cualquier usuario)
 * 4. Pegar la URL de la Web App como webhook en Meta for Developers > WhatsApp > Configuration
 */

const SHEET_NAME = 'Lista de espera';

// Orden en el que se piden los campos. Agregar/sacar un campo = agregar/sacar
// una línea acá + su etiqueta + su columna correspondiente en el Sheet.
const FIELDS = ['nombre', 'vuelo', 'cantidad_personas', 'motivo'];

const FIELD_LABELS = {
  nombre: 'nombre completo',
  vuelo: 'número de vuelo',
  cantidad_personas: 'cantidad de personas',
  motivo: 'motivo de la espera'
};

// Formato IATA típico: código de aerolínea (2-3 letras/números) + número de vuelo (1-4 dígitos,
// opcionalmente con una letra de sufijo). Ej.: AA1234, LA800, IB6844A. No valida que el vuelo exista.
const VUELO_REGEX = /^[A-Za-z0-9]{2,3}[\s-]?\d{1,4}[A-Za-z]?$/;

const MSG_INSTRUCCIONES = 'Hola, bienvenido a la lista de espera. Respondé en un solo mensaje con estos datos separados por coma, en este orden: nombre completo, número de vuelo, cantidad de personas, motivo.\n\nEjemplo: Juan Pérez, AA1234, 3, sala llena';
const MSG_YA_ANOTADO = 'Ya estás anotado. Escribí "estado" cuando quieras saber cuánto te falta.';
const MSG_CONFIRMACION = 'Listo, quedaste anotado en la lista de espera. Escribí "estado" en cualquier momento para saber tu posición.';

// --- Punto de entrada: verificación del webhook (Meta la llama una sola vez al configurar) ---
function doGet(e) {
  const verifyToken = PropertiesService.getScriptProperties().getProperty('VERIFY_TOKEN');
  if (e.parameter['hub.mode'] === 'subscribe' && e.parameter['hub.verify_token'] === verifyToken) {
    return ContentService.createTextOutput(e.parameter['hub.challenge']);
  }
  return ContentService.createTextOutput('Forbidden');
}

// --- Punto de entrada: mensajes entrantes de WhatsApp ---
//
// Sin lock global a propósito: pasajeros distintos escriben en filas distintas
// del Sheet y no hace falta serializarlos entre sí. Lo único que se evita acá
// es procesar el mismo mensaje dos veces si Meta reintenta la entrega del webhook.
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const value = body.entry && body.entry[0].changes[0].value;
    const message = value && value.messages && value.messages[0];

    if (!message || message.type !== 'text') {
      return ContentService.createTextOutput('IGNORED');
    }

    const cache = CacheService.getScriptCache();
    const cacheKey = 'msg_' + message.id;
    if (cache.get(cacheKey)) {
      return ContentService.createTextOutput('DUPLICATE'); // reintento de Meta, ya procesado
    }
    cache.put(cacheKey, '1', 60);

    const phone = message.from;
    const text = message.text.body.trim();
    handleMessage(phone, text);
  } catch (err) {
    console.error('Error procesando webhook: ' + err);
  }
  return ContentService.createTextOutput('EVENT_RECEIVED');
}

function handleMessage(phone, text) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_NAME);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const estadoCol = headers.indexOf('estado');
  const tsCol = headers.indexOf('timestamp');

  let rowIndex = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(phone)) { rowIndex = i; break; }
  }

  // Comando "estado": nunca se trata como dato, aunque el pasajero todavía
  // no haya completado su registro (si no, "estado" se guardaría como nombre).
  if (text.toLowerCase() === 'estado' && rowIndex > -1) {
    if (data[rowIndex][estadoCol] === 'activo') {
      const posicion = calcularPosicion(sheet, phone);
      sendWhatsApp(phone, 'Estás en la posición ' + posicion + ' de la lista. Te avisamos apenas te toque.');
    } else {
      const faltantes = FIELDS.filter((f, i) => !data[rowIndex][i + 1]);
      sendWhatsApp(phone, 'Todavía no estás anotado. Me falta: ' + faltantes.map(f => FIELD_LABELS[f]).join(', ') + '.');
    }
    return;
  }

  // Primer contacto: crear la fila y mandar las instrucciones
  if (rowIndex === -1) {
    const newRow = new Array(headers.length).fill('');
    newRow[0] = phone;
    sheet.appendRow(newRow);
    sendWhatsApp(phone, MSG_INSTRUCCIONES);
    return;
  }

  const row = data[rowIndex];

  if (row[estadoCol] === 'activo') {
    sendWhatsApp(phone, MSG_YA_ANOTADO);
    return;
  }

  const faltantes = FIELDS.filter((f, i) => !row[i + 1]);

  // Intento 1: Gemini entiende el mensaje sin exigir formato ni orden.
  // Intento 2 (respaldo): si Gemini falla -- cuota agotada, error de red,
  // JSON inválido -- se cae al parseo posicional por comas. Así una ráfaga
  // que pise el RPM gratuito de Gemini no deja a nadie sin respuesta.
  let asignaciones = parseWithGemini(text, faltantes) || {};
  Object.keys(asignaciones).forEach(k => { if (!asignaciones[k]) delete asignaciones[k]; });

  if (Object.keys(asignaciones).length === 0) {
    const partes = text.split(',').map(p => p.trim()).filter(p => p.length > 0);
    if (partes.length === 0) {
      sendWhatsApp(phone, 'No te entendí. Todavía me falta: ' + faltantes.map(f => FIELD_LABELS[f]).join(', ') + '.');
      return;
    }
    for (let i = 0; i < Math.min(partes.length, faltantes.length); i++) {
      asignaciones[faltantes[i]] = partes[i];
    }
  }

  // Validación liviana: cantidad_personas tiene que ser un número
  if (asignaciones.cantidad_personas && isNaN(parseInt(asignaciones.cantidad_personas, 10))) {
    delete asignaciones.cantidad_personas;
  }

  // Validación liviana: vuelo tiene que tener forma de código IATA (no valida que exista)
  if (asignaciones.vuelo && !VUELO_REGEX.test(asignaciones.vuelo.trim())) {
    delete asignaciones.vuelo;
  }

  Object.keys(asignaciones).forEach(campo => {
    const col = FIELDS.indexOf(campo) + 2; // +2: columna 1 es teléfono
    sheet.getRange(rowIndex + 1, col).setValue(asignaciones[campo]);
  });

  const rowActualizada = sheet.getRange(rowIndex + 1, 1, 1, headers.length).getValues()[0];
  const faltantesAhora = FIELDS.filter((f, i) => !rowActualizada[i + 1]);

  if (faltantesAhora.length === 0) {
    sheet.getRange(rowIndex + 1, estadoCol + 1).setValue('activo');
    sheet.getRange(rowIndex + 1, tsCol + 1).setValue(new Date());
    sendWhatsApp(phone, MSG_CONFIRMACION);
  } else {
    sendWhatsApp(phone, 'Todavía me falta: ' + faltantesAhora.map(f => FIELD_LABELS[f]).join(', ') + '. Mandalo separado por coma si es más de uno.');
  }
}

// Intenta extraer los campos faltantes del texto libre del pasajero usando Gemini.
// Devuelve null (no undefined) ante cualquier falla, para que handleMessage
// sepa que tiene que usar el respaldo por comas.
function parseWithGemini(text, camposFaltantes) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) return null; // Gemini no configurado todavía -> respaldo directo

  // Verificá el nombre de modelo vigente en aistudio.google.com -- cambia seguido.
  // Usar el modelo "Flash-Lite" del momento: es el que tiene mayor RPM gratuito.
  const model = 'gemini-flash-lite-latest';
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + apiKey;

  const prompt = 'Del siguiente mensaje de un pasajero de aeropuerto, extraé SOLO estos campos si están ' +
    'presentes: ' + camposFaltantes.join(', ') + '. Respondé ÚNICAMENTE un JSON con esas claves exactas, ' +
    'sin texto adicional. Si un campo no está en el mensaje, poné null.\n\nMensaje: "' + text + '"';

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json' }
  };

  try {
    const response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    if (response.getResponseCode() !== 200) {
      console.error('Gemini devolvió ' + response.getResponseCode() + ': ' + response.getContentText());
      return null; // cuota agotada, error del modelo, etc. -> respaldo
    }

    const data = JSON.parse(response.getContentText());
    const textoRespuesta = data.candidates[0].content.parts[0].text;
    return JSON.parse(textoRespuesta);
  } catch (err) {
    console.error('Error llamando a Gemini: ' + err);
    return null;
  }
}

// Posición en la cola = orden de llegada entre los que están en estado "activo"
function calcularPosicion(sheet, phone) {
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const estadoCol = headers.indexOf('estado');
  const tsCol = headers.indexOf('timestamp');

  const activos = data.slice(1)
    .filter(r => r[estadoCol] === 'activo')
    .sort((a, b) => new Date(a[tsCol]) - new Date(b[tsCol]));

  const idx = activos.findIndex(r => String(r[0]) === String(phone));
  return idx === -1 ? '—' : idx + 1;
}

function sendWhatsApp(to, bodyText) {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('WHATSAPP_TOKEN');
  const phoneNumberId = props.getProperty('PHONE_NUMBER_ID');
  const url = 'https://graph.facebook.com/v20.0/' + phoneNumberId + '/messages';

  const payload = {
    messaging_product: 'whatsapp',
    to: to,
    type: 'text',
    text: { body: bodyText }
  };

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  // muteHttpExceptions evita que un 4xx/5xx tire excepción (y por lo tanto
  // evita que se vea como error en el log de ejecuciones), así que hay que
  // loguear la respuesta a mano para poder diagnosticar envíos fallidos.
  const code = response.getResponseCode();
  console.error('sendWhatsApp a ' + to + ' devolvió ' + code + ': ' + response.getContentText());
  logToSheet(to, code, response.getContentText());
}

// Debug temporal: además de console.error, deja un registro en una hoja
// "Logs" del mismo spreadsheet. Sirve para diagnosticar sin depender del
// panel de Ejecuciones de Apps Script (que a veces no abre en el navegador).
// Sacar esto una vez que el envío esté confirmado funcionando en producción.
function logToSheet(to, code, body) {
  const ss = SpreadsheetApp.getActive();
  let logSheet = ss.getSheetByName('Logs');
  if (!logSheet) {
    logSheet = ss.insertSheet('Logs');
    logSheet.appendRow(['timestamp', 'telefono', 'codigo', 'respuesta']);
  }
  logSheet.appendRow([new Date(), to, code, body]);
}
