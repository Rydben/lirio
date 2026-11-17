# Lirio

El launcher de escritorio de tus bots: como Steam o Battle.net, pero cada "juego" es un bot.
Fase 1: launcher base en el PC del creador. Coste extra: **cero** (sin APIs ni servicios de pago).

## Abrir Lirio

Doble clic en el acceso directo **Lirio** del escritorio
(apunta a `%LOCALAPPDATA%\Programs\Lirio\lirio.exe`). No hace falta PowerShell para nada.
Para poner ahí una versión nueva compilada: `scripts/instalar-local.sh` (no cierra un Lirio abierto: espera a que lo cierres).

## Qué hace

- **Inicio** (como la maqueta `assets/avatar/referencia_pagina_inicio.webp`): bienvenida con el avatar, tus bots con su
  estado real, actividad reciente, lo que está pendiente de ti, estado del asistente y accesos rápidos.
- **Bots como módulos**: se descubren por su `aniuzka.json`
  (especificación en `twitch-autoeditor/docs/aniuzka-module-spec.md`). La lista está en `%APPDATA%\Lirio\config.json`.
  Lirio **solo lee** `state/` y usa la CLI de cada bot con `--json`; nunca toca su código.
- **Bot de vídeo**: cola de subida, editados listos para subir, subida con **barra de % en tiempo real**, VODs en
  espera (liberar), fallos (reintentar), aprobaciones, estadísticas, autorizar YouTube, diagnóstico.
- **Parar y arrancar**: "Parar" pide una parada ordenada; "STOP" es el interruptor de emergencia (crea el archivo
  `STOP`). Parar no pide nada; **reanudar** tras un STOP pide mantener pulsado 2 s. "Arrancar" lanza la tarea
  programada del bot (`TwitchAutoEditorWatch`, `TwitchModeratorWatch`).
- **Avatar**: la cara de la pantalla es vectorial y cambia según el estado (feliz, trabajando, aviso, error…).
  La cara normal lleva el logo de Lirio en lugar del "db".

## Aprobaciones (The Wall)

Aprobado por el usuario el 2026-11-16 (variante sin PIN): ver [docs/propuesta-aprobaciones.md](docs/propuesta-aprobaciones.md).
Para aprobar, rechazar, liberar o reintentar hay que **mantener pulsado el botón 2 segundos**. Lirio firma esa
decisión concreta con su llave Ed25519 (cifrada con DPAPI en `%LOCALAPPDATA%\Lirio\aprobador.key`) y se la pasa al
bot con `aprobar-firmado <archivo>`. El bot la verifica con la llave pública fijada en su `wall_rules.json`
(`aprobadores_humanos`) usando `core/human_approval.py`, copia de [contrib/human_approval.py](contrib/human_approval.py).
Un clic simple (o uno automático por accesibilidad) no aprueba nada. `approve` en la terminal sigue siendo el plan B.

## Estructura

```
src/                 interfaz (React + TypeScript)
  components/        Avatar, Face (8 expresiones), LirioLogo, HoldButton (gesto de 2 s), Approvals, ui
  pages/             Home, BotPage (bot de vídeo y resto), SettingsPage
  lib/               api (puente con Rust; datos de demostración fuera de la app), mood, store
src-tauri/src/       núcleo (Rust)
  modules.rs         descubrir módulos y leer su estado (PID caído -> "crashed")
  cli.rs             lista blanca de comandos de la CLI, sin ventana; códigos de salida -> mensajes
  approver.rs        llave, gesto humano y firma de aprobaciones
  upload.rs          progreso de subida (status.upload o líneas «Subiendo X: NN%» del log)
  winutil.rs         DPAPI, PID vivo, procesos sin ventana
contrib/             verificador Python que copian los bots (+ tests, incluida una firma hecha en Rust)
scripts/             capturas de verificación (captura.py, capturas.sh)
assets/              logo (lirio-logo.svg) e ilustraciones del avatar
```

## Desarrollo

Requisitos (gratis): Node.js, Rust (rustup) y las Build Tools de Visual Studio (C++).

```bash
npm install
npm test                         # interfaz (vitest)
cd src-tauri && cargo test       # núcleo (Rust), incluye una prueba de punta a punta con un bot en Python
python -m pytest contrib scripts # verificador de los bots y empaquetador
npx tauri dev                    # abrir en modo desarrollo
npx tauri build --no-bundle      # lirio.exe final
```

Variables útiles para pruebas: `LIRIO_CONFIG` (otra configuración, p. ej. con un bot de mentira) y
`LIRIO_PAGINA=bot/twitch-autoeditor/cola` (abrir en una página). `lirio.exe --llave-publica` imprime la llave pública.

## Fase 2: Lirio para tus amigos

Plan y decisiones: [docs/plan-fase-2.md](docs/plan-fase-2.md).

- **Asistente de bienvenida** (si Lirio no tiene bots configurados): nombre y canal → bots del catálogo → IA
  (su cuenta de Claude, Ollama o modo automático) → instalación con progreso → su YouTube (guía de Google Cloud) → listo.
- **Catálogo firmado**: `catalogo.json` + `catalogo.json.sig` (Ed25519, llave de publicador en `src-tauri/publicador.pub`).
  Cada paquete se comprueba con su SHA-256 antes de usarlo.
- **Instalación de un bot** (`src-tauri/src/installer.rs`): paquete → Python 3.12 embeddable de python.org (huella
  fijada, comprobada con el SPDX oficial) → pip (huella de PyPI) → `requirements.txt` (+ GPU si hay NVIDIA) → modelos
  (huella del manifiesto) → llave de aprobaciones del Lirio de ESE PC en `wall_rules.json` → `config-inicial` con las
  respuestas → `setup`. Todo en `%LOCALAPPDATA%\Lirio\bots\<id>`, sin registro de Windows ni permisos de administrador.
- **Nada tuyo sale**: `scripts/empaquetar.py` usa la lista blanca de cada bot (`paquete.incluir`), nunca baja a
  `secrets/`, `state/`, `logs/`… y para si encuentra un secreto, un correo, una ruta personal o algo de tu lista privada
  `%APPDATA%\Lirio\privado\no-publicar.txt` (que no se publica nunca).
- **Actualizaciones firmadas** (actualizador de Tauri + GitHub Releases) y **Enviar idea** (abre un formulario de GitHub
  ya relleno) en Configuración.
- **Publicar**: `python scripts/publicar.py --repo usuario/lirio` lo prepara todo en `dist-publicacion/` sin subir nada;
  `--subir` lo publica tras escribir PUBLICAR en tu consola. Las llaves están cifradas en `%USERPROFILE%\.lirio-publicador\`
  (`lirio-publicar nueva-llave | firmar | guardar-secreto | leer-secreto`).

Variables para pruebas: `LIRIO_DATOS` (otra carpeta de datos = un PC nuevo) y `LIRIO_CATALOGO` (catálogo local).

## Aniuzka (fase 3)

Aniuzka es privada y **no** forma parte de Lirio ni de su instalador: será un módulo aparte que solo existirá en el
PC del creador, con su propio `aniuzka.json`, y Lirio la mostrará como un módulo más si está en la configuración.
