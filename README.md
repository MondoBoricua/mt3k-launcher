<p align="center">
  <img src="docs/images/mt3k-ultrawide-5120x1440.jpg" alt="ORBIT MT3K Edition en un monitor 5120×1440" width="100%" />
</p>

<h1 align="center">ORBIT · MT3K Edition</h1>

<p align="center">
  Fork comunitario de <a href="https://github.com/toonymak1993/orbit">ORBIT</a>, el launcher de juegos <em>controller-first</em> para Windows creado por Luis Garcia (<a href="https://github.com/toonymak1993">toonymak1993</a>).
</p>

<p align="center">
  <a href="https://github.com/MondoBoricua/orbit/releases/latest"><img alt="Descargar la última build" src="https://img.shields.io/github/v/release/MondoBoricua/orbit?label=descargar&style=for-the-badge&logo=windows11&logoColor=white&color=22d3ee" /></a>
  <a href="https://github.com/MondoBoricua/orbit/actions/workflows/build-windows.yml"><img alt="Build" src="https://img.shields.io/github/actions/workflow/status/MondoBoricua/orbit/build-windows.yml?branch=mt3k&style=for-the-badge&label=build" /></a>
  <a href="https://github.com/toonymak1993/orbit"><img alt="Upstream" src="https://img.shields.io/badge/upstream-toonymak1993%2Forbit-111827?style=for-the-badge&logo=github" /></a>
  <a href="LICENSE"><img alt="GPL-3.0" src="https://img.shields.io/badge/licencia-GPL--3.0-111827?style=for-the-badge" /></a>
</p>

## Qué es esto

ORBIT junta tu biblioteca de PC (Steam, Epic, GOG, Xbox, EA, Ubisoft, retro, juegos locales) en una pantalla de inicio estilo consola, pensada para mando, handhelds y TV. Este repositorio es la **MT3K Edition**: el fork donde Josue "Mondo" Diaz prueba ORBIT en su hardware, le agrega mejoras y documenta el proceso para el canal MT3K. Lo que tiene sentido para todo el mundo se envía de vuelta al proyecto original como pull request.

No es un producto aparte ni compite con ORBIT. Es ORBIT con parches, compilado sin firma, para gente que quiere probar cambios antes de que lleguen a la release oficial o que necesita algo que el original todavía no tiene.

## Qué cambia respecto al original

| Cambio | Desde | Estado en el upstream |
|---|---|---|
| **Soporte ultrawide y super-ultrawide en el Home** (2560×1080, 3440×1440, 5120×1440, también con escalado 125–150 %). La fila de juegos ya no se corta y muestra 8 a 12 juegos a la vez. | 0.1.4-mt3k.1 | [PR #13](https://github.com/toonymak1993/orbit/pull/13) abierto |
| **Bibliotecas de Steam en discos externos**: sin avisos falsos cuando el disco no está, y reescaneo automático al conectarlo o quitarlo. Aportado por nerdytyphanie. | 0.1.4-mt3k.1 | PRs [#11](https://github.com/toonymak1993/orbit/pull/11) y [#12](https://github.com/toonymak1993/orbit/pull/12) abiertos |
| Build NSIS sin firma desde GitHub Actions, con release automática al etiquetar | 0.1.4-mt3k.1 | Solo en el fork |
| Sincronización diaria con el upstream vía pull request `main → mt3k` | 0.1.4-mt3k.1 | Solo en el fork |

El detalle por versión está en [CHANGELOG-MT3K.md](CHANGELOG-MT3K.md).

## Descargar e instalar

1. Baja `ORBIT-MT3K-Setup-<versión>-x64.exe` de la [última release](https://github.com/MondoBoricua/orbit/releases/latest).
2. Comprueba el hash contra `SHA256SUMS.txt` de la misma release:
   ```powershell
   Get-FileHash .\ORBIT-MT3K-Setup-0.1.4-x64.exe -Algorithm SHA256
   ```
3. Ejecuta el instalador. **No está firmado con certificado**, así que SmartScreen avisará una vez: *Más información → Ejecutar de todas formas*.

Requisitos: Windows 11 x64. Mando recomendado, teclado y ratón soportados.

### Diferencias con el instalador oficial

- **Sin Xbox Mode.** El paquete AppX que Windows acepta como "Gaming Home" tiene que ir firmado, y la clave es del autor original. Para Xbox Mode usa la [release oficial](https://github.com/toonymak1993/orbit/releases/latest).
- **Sin auto-actualización.** Esta build no busca actualizaciones, para no reemplazarse sola por la release oficial firmada. Las novedades del fork salen como releases nuevas aquí.
- **Sin Discord Social SDK.** El binario de Discord es propietario y no está en el repositorio; la presencia de Discord queda desactivada. Todo lo demás (Steam, Epic, Xbox, GOG, EA, Ubisoft, retro, amigos de Steam/Epic) funciona igual.
- Se instala en `%LOCALAPPDATA%\Programs\ORBIT` con su propio perfil, aparte del paquete Xbox Mode oficial.

ORBIT Plus (la membresía opcional del proyecto original) es del autor original. Este fork no la modifica, no la incluye ni la redistribuye.

## Cómo está organizado el repositorio

| Rama | Para qué | Quién la toca |
|---|---|---|
| `main` | Espejo exacto de `toonymak1993/orbit` `main`. | Solo el workflow de sincronización. No hagas commits aquí. |
| `mt3k` | La edición: `main` + los cambios del fork. De aquí salen las builds y las releases. | Desarrollo diario. |
| `feat/*` | Cambios listos para enviar al upstream, cortados desde `main` para que el PR salga limpio. | Uno por PR. |

Cada día el workflow [`sync-upstream`](.github/workflows/sync-upstream.yml) compara `main` con el upstream. Si hay commits nuevos, actualiza `main` y abre (o refresca) un pull request `main → mt3k` con la lista de commits. Al mezclarlo, la edición queda al día. Si hay conflicto, se resuelve en una rama cortada desde `mt3k`.

Para proponer algo al proyecto original: rama `feat/lo-que-sea` desde `main`, PR contra `toonymak1993/orbit`, y el mismo cambio se mezcla en `mt3k` para que salga en la próxima build del fork.

## Compilar

Necesitas Node.js 22 o más nuevo y Windows para el instalador (el renderer y los chequeos corren también en macOS y Linux).

```bash
npm ci
npm run typecheck
npm run build
# Correr sin empaquetar:
npx electron .
# Instalador NSIS sin firma:
npx electron-builder --win nsis --x64 --config electron-builder.mt3k.yml --publish never
```

El instalador queda en `release/`. En GitHub Actions, cada push a `mt3k` deja el `.exe` como artefacto del workflow [`build-windows`](.github/workflows/build-windows.yml); una etiqueta con el formato `v0.1.4-mt3k.1` publica una release con el instalador, `latest.yml` y `SHA256SUMS.txt`.

### Verificar el Home en distintos tamaños

El proyecto trae un harness que monta el Home real con datos de prueba en una ventana Electron offscreen y saca capturas:

```bash
npm run build
npx electron scripts/verify-settings-navigation.cjs --orbit-home
```

Las capturas quedan en `.codex-qa/settings-navigation/`. El modo `--orbit-home` valida 1280×720, 1920×1080 y los tamaños ultrawide (3413×960, 2560×1080, 3440×1440, 5120×1440) para los tres tamaños de tarjeta.

## Ideas en cola

Cosas que se van a probar en el canal antes de decidir si se envían al upstream:

- Layouts XMODE, CoreSense y Rolling en 32:9.
- Ajustes para el ROG Xbox Ally con eGPU (perfil de resolución al conectar y desconectar el dock).
- Más pruebas con mandos de terceros.

Si tienes una idea o un bug en tu hardware, abre un [issue](https://github.com/MondoBoricua/orbit/issues) con tu resolución, escalado de Windows y layout del Home.

## Licencia y créditos

ORBIT es software libre bajo la [GNU GPL v3](LICENSE), con la [excepción para el Discord Social SDK](LICENSE_EXCEPTION.md) del autor original. Este fork conserva la misma licencia: puedes usarlo, estudiarlo, modificarlo y redistribuirlo bajo los mismos términos, y el código fuente de cada build está en este repositorio.

- ORBIT: © Luis Garcia, [toonymak1993/orbit](https://github.com/toonymak1993/orbit). [Sitio oficial](https://www.getorbitlauncher.com/).
- Cambios de la MT3K Edition: © Josue Diaz.
- Avisos de terceros: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

---

**English.** This is the MT3K Edition of [ORBIT](https://github.com/toonymak1993/orbit), a controller-first game launcher for Windows by Luis Garcia. The fork adds ultrawide / 32:9 support for the Home screen (sent upstream as [PR #13](https://github.com/toonymak1993/orbit/pull/13)), unsigned NSIS builds from GitHub Actions and a daily upstream sync. Same GPL-3.0 license as upstream; no Xbox Mode, no auto-update, no Discord SDK in these builds. See [CHANGELOG-MT3K.md](CHANGELOG-MT3K.md).
