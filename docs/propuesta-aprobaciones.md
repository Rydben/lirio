# Aprobar desde Lirio con un gesto humano (cambio en The Wall)

Estado: **APROBADA por el usuario el 2026-11-16, variante "sin PIN"** (mantener pulsado el botón 2 segundos).
Se descartó la variante con Windows Hello (PIN o huella) por comodidad; se puede activar más adelante.

## El problema

Hasta ahora, `approve`, `deny`, `liberar` y `reintentar` solo funcionan desde una terminal (PowerShell) abierta
por el usuario, para garantizar que aprueba una persona y no una IA. Lirio quita la terminal, pero no puede abrir
una puerta para que una IA se apruebe a sí misma.

## Cómo funciona

1. **Lirio tiene una llave de firma propia (Ed25519).** La crea la primera vez que se abre y guarda la parte
   secreta en `%LOCALAPPDATA%\Lirio\aprobador.key`, cifrada con DPAPI de Windows (solo tu usuario de Windows
   puede descifrarla).
2. **Cada aprobación = mantener pulsado el botón 2 segundos dentro de Lirio.** Solo entonces el proceso de Lirio
   firma esa aprobación concreta: qué bot, qué operación (aprobar, rechazar, liberar o reintentar), qué
   solicitud, qué acción, qué archivo y hasta cuándo vale (10 minutos), con un número de un solo uso.
   La firma no se puede pedir desde fuera: no hay ningún comando, puerto ni API que la genere. Solo la
   interfaz de Lirio, tras el gesto completo, llama a la función que firma.
3. **El bot comprueba la firma antes de hacer nada.** La llave pública de Lirio (no es secreta) se guarda en
   `wall_rules.json` de cada bot, que es de solo lectura y vigilado (regla 6). El nuevo comando
   `aprobar-firmado <archivo>` rechaza la aprobación si la firma no cuadra, si es de otro bot o de otra
   solicitud, si ha caducado o si ya se usó.

## Qué cambia en los bots

| dónde | cambio |
|---|---|
| `wall_rules.json` (los dos bots, mismo contenido) | sección nueva `aprobadores_humanos` con la llave pública de Lirio |
| CLI de los dos bots | comando nuevo `aprobar-firmado <archivo>` (código de salida 7 si la firma no vale) |
| `core/human_approval.py` | verificador Ed25519 sin dependencias (copia de `contrib/human_approval.py` de Lirio) |
| `approve` / `liberar` en terminal | **siguen igual**, como plan B |

Al cambiar `wall_rules.json`, los bots que estén en marcha lo detectan como cambio y bloquean lo externo hasta
reiniciarse: se reinician sus tareas programadas justo después.

## Lo que NO cambia

- Las 6 reglas de The Wall son las mismas; solo cambia cómo demuestras que eres tú.
- Lo que hoy necesita aprobación la sigue necesitando.
- Parar un bot (STOP) no pide gesto largo: parar siempre es seguro. Quitar el STOP para reanudar sí lo pide.

## Limitación honesta (elegida a sabiendas)

Sin PIN, la barrera es más débil que con Windows Hello: un programa que corra con tu usuario de Windows y que
**intente a propósito** robar la llave podría descifrarla con DPAPI y firmar. Ninguna IA de tus bots tiene esa
capacidad (Claude se ejecuta sin herramientas), pero un agente con acceso a la terminal sí podría. Si algún día
quieres cerrarla, la variante con Windows Hello guarda la llave en el chip TPM y pide PIN o huella en cada firma.
