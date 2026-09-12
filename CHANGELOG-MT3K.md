# Cambios de la MT3K Edition

Lo que este fork agrega o cambia respecto a [toonymak1993/orbit](https://github.com/toonymak1993/orbit). Las versiones siguen a las del original con el sufijo `-mt3k.N`.

## 0.1.4-mt3k.1

Base: ORBIT 0.1.4 (commit `03ccdc3`).

### Home

- **Soporte ultrawide y super-ultrawide (21:9 y 32:9).** En 2560×1080, 3440×1440 y 5120×1440 (también con escalado de Windows al 125–150 %) la fila de juegos del Home quedaba cortada por debajo del borde de la pantalla. Ahora el hero tiene un presupuesto de alto y cada tarjeta se limita por el espacio vertical que queda, así que la fila siempre se ve completa y muestra más juegos a la vez (8 a 12 en un 32:9). Cubre los tamaños de tarjeta standard, large y compact. 16:9 y 16:10 no cambian. Enviado al proyecto original como [PR #13](https://github.com/toonymak1993/orbit/pull/13).

### Verificación

- El chequeo en vivo `verify-settings-navigation.cjs --orbit-home` captura y valida además 3413×960, 2560×1080, 3440×1440 y 5120×1440.

### Empaquetado

- `electron-builder.mt3k.yml`: instalador NSIS x64 sin firma de código, con manifiesto propio (`resources/release-manifest.mt3k.json`) que desactiva la auto-actualización para no pisarse con la release oficial firmada.
- GitHub Actions: build en cada push a `mt3k`, release automática al etiquetar `vX.Y.Z-mt3k.N`, y sincronización diaria con el upstream vía PR `main → mt3k`.
