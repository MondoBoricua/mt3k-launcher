# Cambios de MT3K Launcher

MT3K Launcher empezó como la MT3K Edition, un fork de ORBIT 0.1.4 de Luis Garcia. Las versiones mantienen el formato `X.Y.Z-mt3k.N` para que las actualizaciones dentro de la app sigan funcionando.

## 0.1.4-mt3k.13

Base: ORBIT 0.1.4 con los cambios de 0.1.4-mt3k.12.

### Arreglos

- **Actualización dentro de la app en Xbox Mode.** Al pulsar *Update now*, el launcher descargaba y verificaba bien, pero el ayudante que cambia la carpeta de la app moría en cuanto la app se cerraba, sin llegar a escribir su log, y la app quedaba sin abrir hasta que caducaba la marca de instalación. Medido en una ROG Ally: cuando Xbox Mode arranca el launcher, su proceso vive dentro de un *job* de Windows y sus hijos directos se van con él. Ahora el ayudante se crea por WMI, fuera de ese job, y la app espera a tener su ID de proceso antes de cerrarse. Las versiones anteriores necesitan el instalador para llegar a esta.

## 0.1.4-mt3k.12

Base: ORBIT 0.1.4 con los cambios de 0.1.4-mt3k.11.

### Arreglos

- **HowLongToBeat con nombres de tienda.** Los títulos con ® o ™, como "LEGO® Batman™: Legacy of the Dark Knight" o "Call of Duty®: Modern Warfare® III", no devolvían estimado porque HowLongToBeat no encuentra el nombre con esos símbolos. Ahora se limpian antes de buscar (también las comillas tipográficas de "Tom Clancy’s"), y si no hay resultado se reintenta sin la etiqueta de plataforma ni el sufijo de edición ("- Edición Estándar (Windows)", "(PC)", "Ultimate Edition"). Comprobado contra los 187 títulos con símbolos de una biblioteca real: de 91 con estimado se pasa a 161. Los que quedan son títulos traducidos por la tienda ("La Orden caída", "Los Sims") y paquetes de contenido, que HowLongToBeat no tiene.
- **"Sin estimado" dura menos.** HowLongToBeat devuelve una lista vacía cuando se le hacen muchas consultas seguidas, igual que cuando no conoce el juego. Esa respuesta se guardaba una semana; ahora un día, y los guardados con el nombre viejo se vuelven a consultar solos.

## 0.1.4-mt3k.11

Base: ORBIT 0.1.4 con los cambios de 0.1.4-mt3k.10.

### Log de diagnóstico

- **Registro de errores.** El proceso principal escribe un log en `%APPDATA%\ORBIT\logs\mt3k-launcher.log` (rota a los 2 MB, guarda un archivo anterior): versión, Windows, GPU y funciones activas al arrancar, más avisos, errores, excepciones no capturadas y caídas del renderer o de la GPU. Los tokens y claves se tachan antes de escribirse.
- **Abrir carpeta de logs** en Configuración → Sistema → Acerca de, con la ruta a la vista. Si el launcher se cae, ese archivo es lo que hay que mandar.

## 0.1.4-mt3k.10

Base: ORBIT 0.1.4 con los cambios de 0.1.4-mt3k.9.

Cinco funciones nuevas. Todas vienen **apagadas** y se activan en Configuración, para que el launcher siga siendo simple por defecto.

### Perfiles de lanzamiento (Configuración → Hardware)

- **Resolución y tasa de refresco por juego**, con un perfil para **portátil** (solo la pantalla integrada) y otro para **dock** (hay una pantalla externa). Se aplica justo antes de abrir el juego y se restaura al cerrarlo, al parar el seguimiento, al cerrar el launcher o al apagar la función.
- **Confirmación con vuelta atrás.** Al cambiar el modo aparece un diálogo controlable con el mando; si no confirmas en 15 segundos, o pulsas B, se restaura la pantalla y se cancela el lanzamiento.
- **Recuperación.** Un diario en la carpeta de datos restaura la pantalla en el próximo arranque si el launcher se cerró a la fuerza. Si el monitor cambió o no está, no se aplica nada y se avisa.
- Se edita desde el editor de metadatos del juego, pestaña *Overview*. HDR queda marcado como no disponible por ahora; los ajustes de AMD (AFMF, RSR) y el tope de FPS quedan para más adelante.

### Menú de pausa de RetroArch (Configuración → Experiencia)

- Con un juego de RetroArch corriendo, el atajo del mando que trae el launcher al frente abre un menú: **Reanudar, Guardar estado, Cargar estado, Captura, Avance rápido y Salir del juego**. Habla con RetroArch por su interfaz de comandos en red local.
- Al activarlo, el launcher asegura `network_cmd_enable` y `network_cmd_port` en el `retroarch.cfg` que RetroArch usa de verdad, sin tocar el resto del archivo. Los emuladores independientes no tienen menú.

### Restaurar partidas y carpeta de copias

- **Restaurar copia** desde la ficha del juego local: lista las copias con fecha y tamaño, pide confirmación, hace una copia de seguridad del estado actual antes de tocar nada, y si algo falla vuelve a ese estado. Se niega si el juego está corriendo.
- **Carpeta de copias** en Configuración → Sistema: apunta las copias a una carpeta sincronizada por Google Drive, OneDrive o Dropbox y tus partidas quedan en la nube. Las copias anteriores se quedan donde estaban.

### Modo vitrina y capturas (Configuración → Experiencia)

- **Modo vitrina.** Tras 2, 5, 10 o 15 minutos sin tocar nada en Inicio o Biblioteca, el launcher muestra el arte de tus juegos a pantalla completa. Cualquier botón lo cierra y vuelve exactamente a donde estabas. Nunca arranca con un juego abierto ni con un diálogo en pantalla.
- **Capturas.** Lee las fotos y clips que Game Bar guarda en `Videos\Capturas`, las agrupa por juego y las muestra en la ficha del juego y en un panel de la Biblioteca. Solo se pueden abrir archivos de esa carpeta.

### Modo invitado (Configuración → Sistema)

- Un **PIN de 4 a 6 dígitos** que se escribe con el mando. Con el modo activo solo se ven los juegos de una colección que elijas; desaparecen la tienda, los amigos y las aplicaciones; Configuración pide el PIN; y no se puede desinstalar, ocultar ni editar juegos. Cinco intentos fallidos bloquean el PIN un minuto. El PIN se guarda como hash, nunca en claro. Es una restricción del launcher, no un control parental de Windows.

### Revisión de seguridad

- Las cinco funciones pasaron por una revisión cruzada independiente antes de salir. Se cerraron los escapes del modo invitado por menús y por IPC, el restaurador de partidas rechaza enlaces simbólicos y bloquea el lanzamiento del juego mientras restaura, el `retroarch.cfg` se escribe de forma atómica con copia de seguridad y se deshace al apagar la función, y los perfiles de lanzamiento ya no bloquean otros juegos cuando falta el monitor.


Base: ORBIT 0.1.4 con los cambios de 0.1.4-mt3k.8.

### Arreglos

- **Actualizaciones dentro de la app.** *Update now* fallaba siempre con "The installer could not be started or the previous update did not complete", tanto en escritorio como en Xbox Mode. Al preparar la actualización, el modo en segundo plano no creaba la marca de suspensión con el ID de esa actualización, y el servicio abortaba justo antes de lanzar el instalador o el ayudante. Ahora la crea, y la borra si la actualización falla. Hay una prueba nueva, `npm run verify:update-suspension`.
- **Cómo pasar a esta versión.** Las versiones hasta 0.1.4-mt3k.8 tienen el fallo, así que para llegar a 0.1.4-mt3k.9 hay que usar el instalador una vez. Desde aquí, las actualizaciones dentro de la app deberían funcionar.

## 0.1.4-mt3k.8

Base: ORBIT 0.1.4 con los cambios de 0.1.4-mt3k.7.

- **Avatar con la mascota.** El avatar por defecto, arriba a la izquierda y en el selector de avatares, muestra la mascota de MT3K en lugar del cuadro con la letra "O" de ORBIT. La opción se llama "MT3K". Si elegiste otro avatar, tu foto de Steam o una imagen propia, no cambia nada.

## 0.1.4-mt3k.7

Base: ORBIT 0.1.4 con los cambios de 0.1.4-mt3k.6.

### Discord

- **Integración activada.** Amigos, presencia, mensajes directos y servidores de Discord funcionan dentro del launcher. Usa la aplicación de Discord propia de MT3K Launcher en lugar de la de ORBIT.
- **Social SDK 1.10.19337.** El SDK es un componente cerrado de Discord y no está en el repositorio. GitHub Actions lo trae de un almacenamiento privado al compilar, verifica su hash y su contrato, y lo empaqueta dentro de la app. Las 76 funciones que usa el launcher se comprobaron contra esta versión.
- **Primera vez.** Cada usuario inicia sesión con su propia cuenta de Discord desde la sección de amigos.

### Ícono

- **Mascota de MT3K.** El ícono del launcher, el instalador, los accesos directos y los logos de Xbox Mode usan ahora la mascota de MT3K con capucha y control, sobre fondo azul marino y acentos rojos. Reemplaza el ícono provisional de 0.1.4-mt3k.6.

## 0.1.4-mt3k.6

Base: ORBIT 0.1.4 con los cambios de 0.1.4-mt3k.5.

### Nuevo nombre: MT3K Launcher

- **Por qué.** El repositorio público de ORBIT desapareció de GitHub en septiembre de 2026, así que el proyecto sigue por su cuenta. Conserva la licencia GPL-3.0 y el crédito a Luis Garcia, que también aparece en *Configuración → Acerca de*.
- **Qué cambia.** El nombre en la app, la ventana, la bandeja, el instalador, los accesos directos y Xbox Mode. Hay ícono y logos nuevos, y el repositorio pasa a `MondoBoricua/mt3k-launcher`. Los archivos de la release se llaman `MT3K-Launcher-Setup` y `MT3K-Launcher-App`, y las funciones premium aparecen como "Plus".
- **Qué se conserva.** La carpeta de datos `%APPDATA%\ORBIT`, la biblioteca y los ajustes, la carpeta de emuladores y ROMs en `Documentos\ORBIT`, el ejecutable `ORBIT.exe`, la identidad del instalador y el paquete de Xbox Mode. Actualizar desde la MT3K Edition no borra nada.
- **Compatibilidad.** Cada release publica también copias con los nombres `ORBIT-MT3K-*`, para que las versiones anteriores encuentren la actualización. El nombre que muestra Xbox Mode cambia la próxima vez que se registra, por ejemplo al instalar con el instalador.
- **Sin sincronización con ORBIT.** Se quitó el workflow diario que copiaba el repositorio original.

### Arreglos

- **Xbox Mode detectado.** La app reconoce su propio paquete como app de inicio de Xbox Mode y oculta "Iniciar con Windows" cuando arranca desde ahí.

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
