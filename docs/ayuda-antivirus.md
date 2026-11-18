# Lirio se cierra solo o no abre: el antivirus

Lirio es gratis y no paga la firma de Microsoft (Authenticode). Algunos antivirus, sobre todo **Norton**, desconfían
de los programas nuevos sin firma y los ponen en cuarentena o los cierran. Puede pasarle a `lirio.exe` o al Python
privado de cada bot (`python.exe`, `pythonw.exe`).

Lirio te avisa si le faltan archivos a un bot, o si la última vez se cerró de golpe. Tienes los mismos pasos en
**Configuración → Ayuda con el antivirus**, con botones para copiar las carpetas. Si Lirio no llega ni a abrir,
sigue esta guía.

## Las carpetas de Lirio
- Programa: `%LOCALAPPDATA%\Lirio`
- Datos y bots: `%LOCALAPPDATA%\LirioDatos`

(Puedes pegar esas rutas tal cual en el Explorador de archivos o en el antivirus.)

## Norton 360 / Norton AntiVirus Plus
1. Abre Norton → **Seguridad** → **Historial**. En «Mostrar», elige **Cuarentena**.
2. Si aparece `lirio.exe`, `python.exe` o `pythonw.exe`: selecciónalo → **Opciones** → **Restaurar y excluir este archivo**.
3. Norton → **Configuración** → **Antivirus** → pestaña **Análisis y riesgos**.
4. En **Exclusiones / Bajo riesgo**, «Elementos que se excluirán de los análisis» → **Configurar** → **Agregar carpetas**:
   añade las dos carpetas de arriba con «Incluir subcarpetas».
5. Lo mismo en «Elementos que se excluirán de la detección de Auto-Protect, SONAR y Download Intelligence».
   Pulsa **Aplicar**.
6. Abre Lirio. Si un bot sigue diciendo que le faltan archivos, instálalo otra vez desde el asistente: continúa
   donde se quedó.

## Otros antivirus
Avast, AVG, McAfee, Bitdefender… funcionan parecido: «Cuarentena» para restaurar y «Exclusiones» o «Excepciones»
para añadir las dos carpetas. Excluir solo estas carpetas no desactiva el antivirus para nada más.
