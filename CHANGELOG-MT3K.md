# Cambios de la MT3K Edition

Lo que este fork agrega o cambia respecto a [toonymak1993/orbit](https://github.com/toonymak1993/orbit). Las versiones siguen a las del original con el sufijo `-mt3k.N`.

## 0.1.4-mt3k.5

Base: ORBIT 0.1.4 con los cambios de 0.1.4-mt3k.4.

### Xbox Mode desde el instalador

- **Registro al terminar.** El instalador trae `resources\xbox-mode` con el manifiesto, la capacidad y el script de registro. Al terminar pregunta si registrar ORBIT MT3K como app de inicio de Xbox Mode. Si el modo desarrollador está apagado, abre esa página de Configuración y espera a que lo actives.
- **Siempre al día.** Si ORBIT MT3K ya estaba registrado, cada instalación o actualización lo vuelve a registrar en silencio con la versión nueva.
- **Desinstalar.** Quita el registro que creó el instalador y su carpeta `%LOCALAPPDATA%\ORBIT-MT3K-XboxMode`.
- **Script.** `Register-OrbitMt3kXboxMode.ps1` funciona desde la instalación o desde el repositorio, valida todo antes de tocar un registro existente, usa la versión de la build y escribe un log con `-LogPath`.

### Arreglos

- **"Iniciar con Windows".** Electron no encuentra la entrada de inicio cuando la ruta de ORBIT tiene espacios, y al leerla descarta el argumento `--orbit-background`. ORBIT daba el error *Windows could not change ORBIT startup* aunque la entrada sí se guardaba. Ahora la busca con la ruta entre comillas y compara los argumentos que Electron sí devuelve.
- **ORBIT Plus.** La pestaña de Plus ya no aparece en Configuración ni en la configuración inicial, porque en esta edición todo viene incluido.

## 0.1.4-mt3k.4

Base: ORBIT 0.1.4 con los cambios de 0.1.4-mt3k.3.

### ORBIT Plus incluido

- **Edición comunitaria.** El instalador de la MT3K Edition trae `orbit-plus.mt3k.json` con `communityEdition` activo. Las seis funciones de Plus quedan disponibles en local y para siempre: sonidos y música propios, cloud gaming con GeForce NOW, movimiento del fondo, temas y layout Cuadro, selector de próximo juego y guías de logros. En ese modo ORBIT no contacta Patreon, Gumroad ni el servidor oficial.
- **Panel de Plus.** Muestra "Incluido" y un enlace al sitio oficial de ORBIT en lugar de las opciones de compra.

### Actualizaciones dentro de la app

- **Pantalla de actualización.** Cuando aparece una release nueva del fork, ORBIT muestra una pantalla con *Update now* y *Later*, el progreso de la descarga y las novedades.
- **Verificación.** Cada descarga se comprueba contra el tamaño y el SHA-256 que GitHub publica para el archivo. Las builds del fork no llevan firma de código.
- **Instalación.** En una instalación normal se abre el instalador descargado. En Xbox Mode, un ayudante espera a que ORBIT se cierre, cambia la carpeta de la app guardando la anterior hasta confirmar el cambio y vuelve a abrir ORBIT.
- **Versiones.** Las releases se etiquetan `vX.Y.Z-mt3k.N`; GitHub Actions estampa esa versión en la build y publica también `ORBIT-MT3K-App-<versión>-x64.zip` para Xbox Mode.

## 0.1.4-mt3k.3

Base: ORBIT 0.1.4 con los cambios de 0.1.4-mt3k.2.

### Corrección

- **Nombres con coma al usar "Search metadata".** El editor guarda las listas separando por comas, así que un desarrollador como "ARC SYSTEM WORKS CO., LTD" se partía en dos entradas al guardar. Ahora las comas internas de cada nombre que llega de Steam se convierten en espacios antes de rellenar el campo.

## 0.1.4-mt3k.2

Base: ORBIT 0.1.4 con los cambios de 0.1.4-mt3k.1.

### Metadatos

- **Botón "Search metadata" en el editor de metadatos.** Busca el juego por título en la tienda de Steam, muestra los resultados con su miniatura para distinguir el juego base de sus DLC, y al elegir uno rellena título, resumen, descripción, géneros, características, desarrollador, editor, fecha, edad, idiomas, plataformas, requisitos y enlaces. Solo rellena el borrador: nada se guarda hasta pulsar *Save & sync game*. Pensado para juegos custom que no vienen de ninguna tienda.
- **Arte de Steam para juegos nuevos.** Steam guarda la portada, el fondo y la cabecera de los juegos recientes en carpetas con hash, y ORBIT solo probaba las rutas clásicas, así que la búsqueda de arte sin API key encontraba una sola imagen. Ahora consulta la API pública de tienda de Steam, prueba primero las rutas con hash y mantiene las clásicas como respaldo.

## 0.1.4-mt3k.1

Base: ORBIT 0.1.4 (commit `03ccdc3`).

### Home

- **Soporte ultrawide y super-ultrawide (21:9 y 32:9).** En 2560×1080, 3440×1440 y 5120×1440 (también con escalado de Windows al 125–150 %) la fila de juegos del Home quedaba cortada por debajo del borde de la pantalla. Ahora el hero tiene un presupuesto de alto y cada tarjeta se limita por el espacio vertical que queda, así que la fila siempre se ve completa y muestra más juegos a la vez (8 a 12 en un 32:9). Cubre los tamaños de tarjeta standard, large y compact. 16:9 y 16:10 no cambian. Enviado al proyecto original como [PR #13](https://github.com/toonymak1993/orbit/pull/13).

### Steam

Integrados desde pull requests abiertos en el proyecto original, con sus commits y autoría originales (nerdytyphanie):

- **Discos desconectados sin avisos falsos** ([upstream #11](https://github.com/toonymak1993/orbit/pull/11)). Si una biblioteca de Steam está en un disco que no está conectado, ORBIT ya no muestra el aviso de sincronización parcial. Los juegos de ese disco conservan su registro en caché y las bibliotecas conectadas sincronizan normal.
- **Detección al conectar o quitar el disco** ([upstream #12](https://github.com/toonymak1993/orbit/pull/12)). ORBIT comprueba cada segundo las ubicaciones de biblioteca configuradas y, cuando un disco aparece o desaparece, reescanea los manifiestos locales sin volver a sincronizar la cuenta. Los juegos del disco quitado pasan a no disponibles sin perder ruta, metadatos ni historial, y vuelven cuando su manifiesto y carpeta se leen de nuevo. También arranca la vigilancia en el inicio rápido desde caché.

Probado en el ROG Xbox Ally: un disco ausente se detecta en menos de 1 ms y las rutas de red (`\\servidor\...`) quedan fuera del sondeo.

### Verificación

- El chequeo en vivo `verify-settings-navigation.cjs --orbit-home` captura y valida además 3413×960, 2560×1080, 3440×1440 y 5120×1440.

### Xbox Mode

- `scripts/windows/Register-OrbitMt3kXboxMode.ps1` registra el ORBIT MT3K instalado como home app de Xbox Mode con el modo desarrollador de Windows, bajo la identidad "ORBIT MT3K". Probado en el ROG Xbox Ally.

### Empaquetado

- `electron-builder.mt3k.yml`: instalador NSIS x64 sin firma de código, con manifiesto propio (`resources/release-manifest.mt3k.json`) que desactiva la auto-actualización para no pisarse con la release oficial firmada.
- GitHub Actions: build en cada push a `mt3k`, release automática al etiquetar `vX.Y.Z-mt3k.N`, y sincronización diaria con el upstream vía PR `main → mt3k`.
