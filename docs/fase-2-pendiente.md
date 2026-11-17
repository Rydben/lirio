# Fase 2: estado

## Hecho (2026-11-17, Lirio 0.2.0)
- Asistente de bienvenida para amigos: datos → bots → IA → instalación → YouTube → listo. **Claude es opcional**: el
  modo automático y la IA local (Ollama) van primero; Claude aparece como "Opcional".
- Instalación de bots probada de punta a punta en un "PC nuevo" simulado (catálogo firmado, Python embeddable oficial,
  pip, llave del Lirio del amigo, `config-inicial`, `setup`, arrancar y parar). Los dos bots se empaquetan limpios.
- Llaves solo en el PC del creador (DPAPI): publicador del catálogo y actualizaciones. `scripts/publicar.py` prepara
  instalador firmado, catálogo y `latest.json`; sube solo con `--subir` + escribir PUBLICAR.
- Aprobaciones: Lirio comprueba antes de firmar que su llave es la fijada en el bot (aviso claro si no).
- Estado real de los bots: "Caído" solo si de verdad; "Atascado" si sigue abierto sin latido; "Parado" si el PC se
  reinició.
- Ajustes de cada bot desde Lirio (formulario generado con el esquema del bot; nunca permisos ni secretos).
- Huella de voz desde Lirio (editor); conectar Twitch con código en el navegador (moderador).
- Estadísticas y consejos del editor: último directo, YouTube (gráfico por día), consejos con el avatar, comentarios.
- Diario local (90 días) con notas propias, y "Enviar idea" con resumen de uso opcional (solo cifras; se ve y se
  eligen las partes antes de enviarlo).
- "Arrancar mis bots al encender el PC" (inicio de Windows del usuario, sin administrador).
- Código de Lirio revisado con el detector (99 archivos limpios) y guardado en git local.

## Falta
1. **GitHub**: iniciar sesión en `gh` (lo hace el usuario con un código), crear el repositorio público `lirio`, subir el
   código y publicar la v0.2.0 con su PUBLICAR.
2. **Prueba en otra cuenta de Windows** (elegida por el usuario): crear una cuenta local nueva, instalar Lirio desde el
   instalador publicado y los bots grandes.
3. **Moderador**: huella de voz sin consola (`voz-texto`, `voz-dispositivos`, `enroll --json`), ajustes por esquema y
   decidir el `client_id` de Twitch para los amigos; luego, la UI de responder en el chat y de comandos de voz.
4. Claude del amigo: la primera vez hay que abrir Claude Code para iniciar sesión (opcional: no hace falta Claude).
