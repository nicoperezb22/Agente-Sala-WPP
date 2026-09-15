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

