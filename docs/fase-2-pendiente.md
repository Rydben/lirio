# Fase 2: estado

## Hecho (2026-11-17, Lirio 0.2.0)
- Asistente de bienvenida para amigos: datos → bots → IA (Claude propio, Ollama, automático) → instalación → YouTube → listo.
- Instalación de bots probada de punta a punta en un "PC nuevo" simulado (carpeta de datos aparte): catálogo firmado,
  paquete con huella, Python embeddable oficial (huella comprobada con el SPDX de python.org), pip, llave del Lirio del
  amigo en `wall_rules.json`, `config-inicial` con sus respuestas, `setup`, arrancar y parar.
- Empaquetador con lista blanca y detector de datos personales; paquete real del editor limpio (59 archivos, 0,6 MB).
- Llaves (todas solo en el PC del creador, cifradas con DPAPI en `%USERPROFILE%\.lirio-publicador\`): publicador del
  catálogo y actualizaciones de Lirio.
- Instalador NSIS firmado + `latest.json` generados con `scripts/publicar.py` (sin subir nada).
- Configuración: buscar actualizaciones, "Enviar idea" (formulario de GitHub ya relleno) y guía de YouTube.
- Datos de Lirio movidos a `%LOCALAPPDATA%\LirioDatos` (el instalador usa `%LOCALAPPDATA%\Lirio`), conservando tu llave.

## Falta
1. **GitHub** (con tu permiso): crear el repositorio público, instalar `gh` e iniciar sesión (lo haces tú), subir el
   código de Lirio y publicar la primera versión con `python scripts/publicar.py --repo <usuario>/lirio --subir`.
2. ~~Moderador en el catálogo~~: hecho. Los dos bots se empaquetan limpios (editor 59 archivos con el de miniaturas
   dentro; moderador 38 archivos y 5 modelos que se descargan en el PC del amigo).
3. **Prueba real con los bots grandes**: instalar el editor (≈3 GB de librerías) y el moderador en un PC limpio
   (o en una cuenta de Windows nueva) antes de dárselo a tus amigos.
4. **Moderador para amigos**: botones en Lirio para `connect` (cuenta del bot de Twitch, con código en el navegador) y
   `enroll` (huella de voz), que el moderador ya ofrece sin terminal.
5. **Claude Code del amigo**: hoy Lirio le lleva a la página de descarga y prueba si responde; iniciar sesión la
   primera vez sigue necesitando abrir Claude Code una vez.
6. Ajustes de cada bot desde Lirio (sin editar `config.yaml`).
