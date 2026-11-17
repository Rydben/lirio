# Plan de la fase 2: Lirio para tus amigos

Objetivo: que un amigo descargue **un instalador**, lo abra y, con un asistente, tenga Lirio y los bots funcionando
con **su** canal, **su** YouTube y **su** IA. En el instalador no va nada tuyo: ni `secrets/`, ni tokens, ni
huellas de voz, ni tu `config.yaml`, ni Aniuzka.

## 1. Paquete limpio de cada bot

- Una herramienta (`scripts/empaquetar.py`) copia **solo el código** de cada bot a un paquete. Usa una lista de lo
  que SÍ se incluye (nunca "todo menos…"), y un test falla si aparece `secrets/`, `state/`, `logs/`, `output/`,
  `downloads/`, un `.json` de huella de voz, un token o tu nombre de canal.
- Cada bot tiene un `config.example.yaml` sin datos tuyos. El asistente de Lirio crea el `config.yaml` del amigo
  con sus respuestas (su canal, su carpeta de OBS…).
- Tus bots en producción **no se tocan**: el paquete es una copia.

## 2. Instalador de Lirio y asistente de bienvenida

- Instalador de Windows (NSIS, gratis, sin certificado: saldrá el aviso de SmartScreen, aceptado).
- Al abrir Lirio por primera vez, un asistente paso a paso:
  1. Tu nombre y tu canal de Twitch.
  2. Qué bots quieres instalar, cuánto ocupan y cuánto tardan.
  3. Lirio prepara un Python privado para los bots (de python.org, oficial y gratis) y sus librerías.
  4. Tu IA (punto 3) y tu YouTube (punto 4).
  5. Prueba final con el diagnóstico de cada bot.

## 3. La IA del amigo (sin compartir tu suscripción, nunca)

| opción | qué necesita | cómo queda |
|---|---|---|
| Su propia cuenta de Claude | tener Claude (Pro o gratis) e iniciar sesión una vez | la mejor calidad |
| IA local con Ollama | instalar Ollama (gratis) y un modelo (unos 5 GB) | gratis y privada; peor que Claude, sobre todo eligiendo momentos graciosos |
| Modo automático | nada | sin IA: reglas (volumen, chat…); funciona, pero más simple |

Lirio comprueba cada opción con un botón "Probar". Hay que enseñar a los bots a usar Ollama: **lo hacen sus
sesiones** (editor y moderador), igual que en la fase 1.

## 4. YouTube del amigo: asistente guiado de Google Cloud

Cada amigo crea **su** proyecto gratuito de Google Cloud. Lirio le guía paso a paso, abriendo cada página de Google
con un botón:
1. Crear el proyecto.
2. Activar YouTube Data API v3 (y, si quiere, YouTube Analytics).
3. Pantalla de consentimiento en modo "Pruebas", con su propio correo como usuario de prueba.
4. Crear credenciales "App de escritorio" y descargar el archivo JSON.
5. "Elegir archivo": Lirio lo copia a `secrets/` del bot, sin enseñarlo nunca.
6. "Autorizar YouTube" (el botón que ya existe).

Lirio nunca ve ni guarda su contraseña de Google.

## 5. Actualizaciones firmadas y "Enviar idea"

- Tú pides un cambio, se prepara la versión y **solo con tu aprobación** se publica en GitHub Releases (gratis).
- Las actualizaciones van firmadas con una llave que solo está en tu PC. Lirio de los amigos rechaza cualquier
  actualización que no esté firmada con ella.
- "Enviar idea": el amigo escribe su idea y Lirio abre un formulario de GitHub (Issues) ya relleno; la envía él
  desde su navegador. Sin servidores ni coste.

## Pasos hacia fuera que necesitan tu permiso (uno a uno, en su momento)

- Instalar la herramienta `gh` de GitHub (opcional; GitHub Desktop también vale).
- Crear el repositorio en GitHub.
- Publicar cada versión (pasa por The Wall: publicar requiere tu aprobación).
