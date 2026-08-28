/**
 * Bot de lista de espera — sala VIP / FastPass
 * Ver CLAUDE.md para contexto de negocio y decisiones de arquitectura.
 */

const SHEET_NAME = 'Lista de espera';
const CAMPOS = ['nombre', 'vuelo', 'cantidad_personas', 'motivo'];
const DEDUPE_CACHE_SECONDS = 60;

const PREGUNTAS = {
  nombre: 'tu nombre',
  vuelo: 'tu número de vuelo',
  cantidad_personas: 'cuántas personas son en total (incluyéndote)',
  motivo: 'el motivo de tu visita'
};

const MENSAJE_INSTRUCCIONES =
  '¡Hola! Para anotarte en la lista de espera necesito estos datos, ' +
  'todos juntos en un solo mensaje separados por coma:\n' +
  'nombre, número de vuelo, cantidad de personas (el total del grupo), motivo\n\n' +
  'Ejemplo: Juan Perez, AR1234, 3, viaje de egresados\n\n' +
  'En cualquier momento podés escribir "estado" para saber tu posición en la cola.';

/**
 * Verificación del webhook de Meta (GET, una sola vez al configurar).
 */
function doGet(e) {
  const props = PropertiesService.getScriptProperties();
  const verifyToken = props.getProperty('VERIFY_TOKEN');

  const mode = e.parameter['hub.mode'];
  const token = e.parameter['hub.verify_token'];
  const challenge = e.parameter['hub.challenge'];

  if (mode === 'subscribe' && token === verifyToken) {
    return ContentService.createTextOutput(challenge);
  }
  return ContentService.createTextOutput('forbidden').setMimeType(ContentService.MimeType.TEXT);
}

/**
 * Punto de entrada de cada mensaje de WhatsApp.
 */
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const entry = body.entry && body.entry[0];
    const change = entry && entry.changes && entry.changes[0];
    const value = change && change.value;
    const message = value && value.messages && value.messages[0];

    if (!message || message.type !== 'text') {
      return ContentService.createTextOutput('ok');
    }

    // Meta puede reintentar el webhook; se deduplica por message.id.
    const cache = CacheService.getScriptCache();
    const cacheKey = 'msg_' + message.id;
    if (cache.get(cacheKey)) {
      return ContentService.createTextOutput('ok');
    }
    cache.put(cacheKey, '1', DEDUPE_CACHE_SECONDS);

    const phone = message.from;
    const text = message.text.body;

    handleMessage(phone, text);
  } catch (err) {
    console.error('Error en doPost: ' + err);
  }
  return ContentService.createTextOutput('ok');
}

/**
 * El cerebro del bot.
 */
function handleMessage(phone, text) {
  const sheet = getSheet();
  const rowIndex = findRowByPhone(sheet, phone);
  const textTrimmed = text.trim();

  if (rowIndex === -1) {
    createRow(sheet, phone);
    sendWhatsApp(phone, MENSAJE_INSTRUCCIONES);
    return;
  }

  const row = getRowData(sheet, rowIndex);

  if (textTrimmed.toLowerCase() === 'estado') {
    if (row.estado === 'activo') {
      const posicion = calcularPosicion(sheet, phone);
      sendWhatsApp(phone, 'Estás en la posición ' + posicion + ' de la lista de espera.');
    } else {
      sendWhatsApp(phone, 'Todavía no completaste tus datos. ' + MENSAJE_INSTRUCCIONES);
    }
    return;
  }

  if (row.estado === 'activo') {
    sendWhatsApp(phone, 'Ya estás anotado en la lista de espera. Escribí "estado" para saber tu posición.');
    return;
  }

  const camposFaltantes = CAMPOS.filter(function (campo) {
    return !row[campo];
  });

  let datos = parseWithGemini(textTrimmed, camposFaltantes);
  if (!datos) {
    datos = parseWithComas(textTrimmed, camposFaltantes);
  }

  if (datos.cantidad_personas !== undefined && !/^\d+$/.test(String(datos.cantidad_personas).trim())) {
    delete datos.cantidad_personas;
  }

  camposFaltantes.forEach(function (campo) {
    if (datos[campo] !== undefined && datos[campo] !== null && String(datos[campo]).trim() !== '') {
      row[campo] = String(datos[campo]).trim();
    }
  });

  const siguenFaltando = CAMPOS.filter(function (campo) {
    return !row[campo];
  });

  if (siguenFaltando.length === 0) {
    row.estado = 'activo';
    row.timestamp = new Date();
    saveRowData(sheet, rowIndex, row);
    const posicion = calcularPosicion(sheet, phone);
    sendWhatsApp(
      phone,
      '¡Listo! Quedaste anotado en la lista de espera. Tu posición es ' + posicion + '. ' +
        'Te vamos a avisar cuando te toque. Escribí "estado" en cualquier momento para consultar tu posición.'
    );
  } else {
    saveRowData(sheet, rowIndex, row);
    const faltantesTexto = siguenFaltando.map(function (campo) {
      return PREGUNTAS[campo];
    }).join(', ');
    sendWhatsApp(phone, 'Me falta que me digas: ' + faltantesTexto + '.');
  }
}

/**
 * Llama a la API de Gemini pidiendo un JSON con los campos faltantes.
 * Devuelve null ante cualquier falla para que handleMessage use el respaldo.
 */
function parseWithGemini(text, camposFaltantes) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) {
    return null;
  }

  const prompt =
    'Extraé los siguientes campos de este mensaje de un pasajero de aeropuerto: ' +
    camposFaltantes.join(', ') + '.\n' +
    'Mensaje: "' + text + '"\n' +
    'Respondé ÚNICAMENTE con un JSON plano con esas claves. ' +
    'Si un campo no está presente en el mensaje, omitilo del JSON. ' +
    'cantidad_personas debe ser solo el número (sin texto). No agregues explicaciones.';

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent?key=' + apiKey;

  const payload = {
    contents: [{ parts: [{ text: prompt }] }]
  };

  try {
    const response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    if (response.getResponseCode() !== 200) {
      return null;
    }

    const json = JSON.parse(response.getContentText());
    const rawText = json.candidates[0].content.parts[0].text;
    const cleaned = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
    const datos = JSON.parse(cleaned);

    return (datos && typeof datos === 'object') ? datos : null;
  } catch (err) {
    console.error('Error en parseWithGemini: ' + err);
    return null;
  }
}

/**
 * Respaldo: asigna los campos faltantes por posición, separados por coma.
 */
function parseWithComas(text, camposFaltantes) {
  const partes = text.split(',').map(function (p) { return p.trim(); }).filter(function (p) { return p !== ''; });
  const datos = {};
  camposFaltantes.forEach(function (campo, i) {
    if (partes[i] !== undefined) {
      datos[campo] = partes[i];
    }
  });
  return datos;
}

/**
 * Posición en la cola según orden de llegada entre los que están activo.
 */
function calcularPosicion(sheet, phone) {
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idxTelefono = headers.indexOf('telefono');
  const idxEstado = headers.indexOf('estado');
  const idxTimestamp = headers.indexOf('timestamp');

  const activos = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][idxEstado] === 'activo') {
      activos.push({ telefono: String(data[i][idxTelefono]), timestamp: data[i][idxTimestamp] });
    }
  }

  activos.sort(function (a, b) {
    return new Date(a.timestamp) - new Date(b.timestamp);
  });

  for (let i = 0; i < activos.length; i++) {
    if (activos[i].telefono === String(phone)) {
      return i + 1;
    }
  }
  return -1;
}

/**
 * Envía un mensaje de texto vía Graph API de Meta.
 */
function sendWhatsApp(to, bodyText) {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('WHATSAPP_TOKEN');
  const phoneNumberId = props.getProperty('PHONE_NUMBER_ID');

  const url = 'https://graph.facebook.com/v19.0/' + phoneNumberId + '/messages';
  const payload = {
    messaging_product: 'whatsapp',
    to: to,
    type: 'text',
    text: { body: bodyText }
  };

  UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
}

// --- Helpers de acceso al Sheet ---

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(['telefono', 'nombre', 'vuelo', 'cantidad_personas', 'motivo', 'estado', 'timestamp']);
  }
  return sheet;
}

function findRowByPhone(sheet, phone) {
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(phone)) {
      return i + 1; // fila 1-indexed para el Sheet
    }
  }
  return -1;
}

function createRow(sheet, phone) {
  sheet.appendRow([phone, '', '', '', '', 'pendiente', new Date()]);
}

function getRowData(sheet, rowIndex) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const values = sheet.getRange(rowIndex, 1, 1, sheet.getLastColumn()).getValues()[0];
  const row = {};
  headers.forEach(function (header, i) {
    row[header] = values[i];
  });
  return row;
}

function saveRowData(sheet, rowIndex, row) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const values = headers.map(function (header) {
    return row[header] !== undefined ? row[header] : '';
  });
  sheet.getRange(rowIndex, 1, 1, headers.length).setValues([values]);
}
