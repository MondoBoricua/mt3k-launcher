# Cambios de la MT3K Edition

Lo que este fork agrega o cambia respecto a [toonymak1993/orbit](https://github.com/toonymak1993/orbit). Las versiones siguen a las del original con el sufijo `-mt3k.N`.

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
