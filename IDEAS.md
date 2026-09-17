# Ideas (borrador personal — no versionado)

Notas sueltas para revisar y, si sirven, mover al Backlog de `.claude/CLAUDE.md`.

- Si el vuelo que manda el pasajero no matchea contra una mini base de datos
  (o una API de vuelos) por parecido de texto o por horario, en vez de
  rechazarlo directo ofrecer un menú de opciones (botones/lista de WhatsApp)
  con los vuelos candidatos para que elija el que corresponde, en vez de
  repreguntarle a las ciegas.

- Evitar que un click accidental en la casilla de "llamado" mande el mensaje
  a la persona equivocada. Ojo: pedir que se "borre el mensaje" después de
  enviado probablemente no se pueda -- la Cloud API de WhatsApp no parece
  tener un endpoint para revocar un mensaje ya mandado (eso es una función
  del cliente, no de la API; sin confirmar contra la doc vigente). La
  alternativa real es un margen de ~15 segundos entre tildar la casilla y
  que el mensaje realmente salga -- si en ese lapso se destilda, no se
  manda nada. Agrega complejidad (pasa de mandar directo a depender de un
  trigger de tiempo corto).

- Total de pasajeros por vuelo. Conectar el bot a una API de vuelos (para
  esto y para la otra idea de sugerir vuelo por parecido/horario) -- son la
  misma dependencia nueva, conviene resolverlas juntas cuando se elija la
  fuente de datos de vuelos.

- Mandar un mensaje para "activar" el bot. Sin especificar todavía qué
  significa exactamente -- ¿un comando admin que resetea/limpia algo? ¿algo
  para "despertar" el script y evitar el arranque en frío de la primera
  ejecución? Aclarar el caso de uso antes de diseñarlo.

- Formas de hacer más rápido el bot en general (más allá de lo ya hecho:
  unificar las 2 llamadas a Gemini en 1). Pensar: latencia de arranque en
  frío de Apps Script, cuántas veces se lee/escribe el Sheet por mensaje,
  si se puede cachear algo entre ejecuciones.

- Otra casilla de verificación, "ingreso" (ya existe esa columna en el Sheet,
  hoy sin usar por el código). Cuando se tilda "ingreso" para una fila:
  dejar de mandarle cualquier otro mensaje automático (llamado, caducidad),
  y en vez de eso mandarle un mensaje de agradecimiento con el QR para
  dejar su opinión sobre la sala. Funciona como un "cierre" del flujo de
  esa persona, parecido a cómo "llamado" dispara su propio mensaje.

