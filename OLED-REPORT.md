# OLED care — entrega

Commit `0fda606` en `feat/oled-care` (base `6721433`). El árbol queda limpio salvo este archivo, que no va en el commit.

## bridge-whoami

```json
{"schema_version":1,"agent_family":"cursor","confidence":"medium","model":null,"host":"mac-arquitect.local","pid":88570,"ppid":83174,"cwd":"/Users/mondo/Developer/Win/Orbit-MT3K-oled","session_id":"91f01b12-8fbe-41ba-836c-ec84e5d7a010","pane_id":"%1","tmux_session":"mt3k-claude-orbit-mt3k-cys","signals":[{"kind":"ancestor","value":"cursor","distance":1},{"kind":"tmux_pane","value":"%1","distance":0},{"kind":"tmux_session","value":"mt3k-claude-orbit-mt3k-cys","distance":0}],"conflicts":[{"kind":"env_vs_ancestor","env_family":"claude","ancestor_family":"cursor"}],"hints":[{"kind":"env_session","name":"CLAUDE_CODE_SESSION_ID","family":"claude"}],"reason":"ascendencia con entorno contradictorio"}
```

Rol de esta sesión: ejecutor (`agent_family` cursor). No se re-delegó.

## Archivos

Nuevos:

- `src/shared/oledCarePolicy.ts`
- `src/renderer/src/components/OledCare.tsx`
- `src/renderer/src/views/Settings/OledCareSection.tsx`
- `scripts/verify-oled-care.ts`

Editados:

- `src/shared/ipc.ts`
- `src/main/settingsStore.ts`
- `src/main/ipcHandlers.ts` (validación de `settings.set`)
- `src/renderer/src/state/preferencesStore.ts`
- `src/renderer/src/App.tsx` (monta la capa solo si el ajuste está encendido)
- `src/renderer/src/views/Settings/SettingsView.tsx` (el tema queda el último de Experiencia)
- `src/renderer/src/i18n/en.ts`, `es.ts`, `ru.ts`
- `src/renderer/src/i18n/translations.ts` (alemán de la UI)
- `src/renderer/src/hooks/useGamepadNavigation.ts`
- `scripts/verify-settings-navigation.cjs`
- `package.json` (solo el script `verify:oled-care`)
- `CHANGELOG.md` (`## 0.1.4-mt3k.17`)
- `README.md` (una fila)

Fuera de la lista del brief, a propósito:

- El alemán de la interfaz no está en `src/main/translations.ts`. `rg attract.title src/main/translations.ts` no devolvió nada; la cadena vive en `src/renderer/src/i18n/translations.ts`. Sin esa edición, `verify:languages` no cuadra las claves y Ajustes en alemán no tendría el texto.
- El sondeo del mando solo llamaba `attract.touch()` si la vitrina estaba encendida. Sin tocar `useGamepadNavigation.ts`, un mando no reiniciaba el reloj ni se tragaba la primera entrada con la vitrina apagada. La decisión está en `oledCareControllerPlan`; el hook solo la llama.

## Ajustes

| Clave | Default | Validación en `settings.set` |
|---|---|---|
| `oledCareEnabled` | `false` | boolean |
| `oledCareIdleMinutes` | `3` | solo `1`, `2`, `3`, `5`, `10` |
| `oledCareMode` | `black` | solo `black` o `dim` |

Al leer, un valor guardado inválido vuelve a 3 minutos y a `black`. Apagado, la capa no se monta y el tema solo muestra el interruptor.

## Precedencia

- El reloj es el de la última entrada del launcher (`lastInputAt`, el mismo de la vitrina), no el de los minutos de la vitrina.
- Cubre si el ajuste está encendido, la fase de lanzamiento es `idle`, la ventana está visible, con foco y no minimizada (`document.hidden`), y el idle llega al umbral.
- No exige estar en Home ni en Biblioteca, ni que haya juegos. El onboarding también puede cubrirse.
- Si la vitrina y el cuidado OLED coinciden, la superficie visible es la capa OLED (`oledCareVisibleSurface` devuelve `oled`). La capa va en `z-[260]`, por encima de la vitrina (`z-[120]`) y del tráiler (`z-[200]`).
- `black`: fondo `#000`, opacidad 1. `dim`: el mismo negro con opacidad 0.85.
- Sin texto, reloj ni transición. `prefers-reduced-motion` no cambia eso: `transition` es `none`.
- La primera entrada (tecla, puntero o mando) se traga. La tecla que despertó sigue tragada 500 ms, igual que la vitrina. Al soltar el mando, el frame de suelta tampoco navega.

## Verificación

| afirmación | comando | salida |
|---|---|---|
| Identidad del bridge | `bridge-whoami --json` | `agent_family` `cursor`, cwd `.../Orbit-MT3K-oled`, exit 0 |
| Rama y base | `git rev-parse --abbrev-ref HEAD; git rev-parse HEAD` | `feat/oled-care`, luego `6721433e7843d251f71f05dceda51b27f189847f` antes del commit |
| Dependencias | `pnpm install` | `Done in 6.4s`, exit 0 |
| Tipos | `pnpm run typecheck` | exit 0, sin errores de `tsc` |
| i18n en cuatro idiomas | `pnpm run verify:languages` | `Languages: 2209 UI entries and 60 native entries per language; key/placeholder parity, encoding, defaults, fallback, interpolation and regional formatting passed.` |
| Política OLED | `pnpm run verify:oled-care` | `OLED care policy checks passed` |
| La vitrina no se rompió | `pnpm run verify:attract-captures` | `Attract/captures policy and filesystem checks passed` |
| Build | `pnpm run build` | `electron-vite build`, exit 0 |
| Ajustes: 11 temas en Experiencia, 30 en total, interruptor solo apagado y minutos+modo encendido | `pnpm run verify:settings` | `Settings: all 30 topics, exclusive expansion, saving, draft retention, hidden focus, keyboard/controller/category/back navigation, and 720p/1080p layout passed.` |
| El alemán de UI no está en el proceso principal | `rg attract.title src/main/translations.ts` | sin coincidencias (el diccionario renderer sí tiene `attract.title` y ahora `oledCare.*`) |
| Commit | `git log -1 --format='%H %an %s'` | `0fda6065805908559f52ecd42e6f89d5a74f0f06 MT3K feat: cover an idle launcher window to protect OLED panels` |

Esas salidas las corrí en este worktree. No sustituyen el `bridge-verify` del coordinador.

## Qué NO verifiqué

- Un mando de verdad en Windows, ni el eje ni los botones contra una ventana del launcher.
- La ventana de Xbox Mode.
- Que los píxeles de un panel OLED (5120×1440 u otro) se apaguen de verdad con `#000`.
- La capa montada en la app: `verify:settings` abre Ajustes, no `App.tsx`, así que no vi la cubierta negra ni el atenuado en una ventana.
- Que minimizar la ventana ponga `document.hidden`. El código usa el mismo foco/visibilidad que la vitrina, más `document.hidden`. Eso es una hipótesis hasta medirlo en Electron con la ventana minimizada.

## Fix round 1

Ejecutor de esta ronda: `bridge-whoami` dio `agent_family` `cursor` (cwd este worktree). No se re-delegó. `graphify query "shouldCoverWithOledCare OledCare oledCareCoverActive dialogOpen"` devolvió `No matching nodes found` (el grafo no tiene los símbolos de este branch); la orientación siguió con `rg` en `src/`.

Veredicto: los dos HIGH, el slideshow bajo la capa, el trago hacia un modal, la fase inicial y el import del componente **proceden y quedaron corregidos**. Dos notas de la revisión **no proceden** (abajo).

### Hallazgos

1. **HIGH — diálogo abierto (procede).** `shouldCoverWithOledCare` no miraba `dialogOpen`. Ahora sale en false si `dialogOpen` es true, igual que `shouldStartAttractMode`. El selector es el mismo de la vitrina (`OLED_CARE_DIALOG_SELECTOR`) más la ficha de juego abierta (`oledCareDialogIsOpen`). `shouldResetOledCareIdle` hace `touch()` cada 500 ms mientras hay diálogo, aunque la vitrina no esté montada. Prueba: `dialogOpen: true` no cubre, y el reset con diálogo da true.

2. **HIGH — reloj con la vitrina apagada (procede, mismo arreglo que el 1).** El `touch()` del diálogo vive en `OledCare`, no en `AttractMode`. Con el ajuste de vitrina apagado, `AttractMode` no se monta (`MainShell.tsx` solo lo monta si `attractModeEnabled`); el intervalo de la capa igual reinicia el reloj.

3. **MEDIUM — slideshow bajo la capa (procede).** `attractPlanUnderOledCover` devuelve `{ active: false, advanceSlide: false }` mientras `oledCover` es true. `AttractMode` no cambia de carátula en ese caso. Al publicar la capa, el store pone `active: false` en el mismo `setState`. Cuando la capa se va, el plan vuelve a las reglas de la vitrina (arranca si el idle ya da; no salta de carátula si el tiempo en pantalla no se cumplió). Pruebas de los cuatro casos en `verify:oled-care`.

4. **MEDIUM — un `pointermove` impide la capa y la vitrina (NO PROCEDE).** Verificado: la lista de eventos de `OledCare.tsx` sigue incluyendo `pointermove` y llama `touch()`. El brief original exige que cualquier movimiento de puntero termine la cubierta, el mismo patrón que la vitrina. Quitar el jitter de escritorio cambiaría ese contrato. No se tocó.

5. **MEDIUM — trago de teclado/puntero vs mando (procede).** El plan del mando (`oledCareControllerPlan`, varios frames hasta soltar) no se cambió; las pruebas de botón sostenido/suelto siguen. Teclado y puntero comparten `OLED_CARE_WAKE_SUPPRESS_MS` (500), armada en `touch()` cuando la capa estaba puesta, venga el despertar del teclado, del puntero o del mando. `shouldSwallowOledCareSurfaceInput` no traga si `dialogOpen` es true, ni aunque el evento caiga en `[data-oled-care]`. Un puntero que no cae en la capa no se traga, salvo dentro de esa ventana corta y sin modal. La capa además registra `pointerdown`/`click`/`wheel`/`touchstart` en su propio nodo: un modal con z más alto no dispara esos listeners.

6. **LOW — fase `idle` antes del IPC (procede, con el centinela).** `MainShell` sigue en `useState({ phase: 'idle' })` (`MainShell.tsx:110`). Compartir ese estado no cierra la carrera: también arranca en `idle`, y levantarlo cambiaría música y overlays. La capa arranca en `OLED_CARE_LAUNCH_PHASE_PENDING` y solo pasa a la fase real cuando `getLaunchStatus` u `onLaunchStatus` trae un `phase` no vacío (el mismo IPC que MainShell). `pending` no cubre. Si la lectura falla, se queda en `pending` (la capa no entra) hasta un evento posterior.

7. **LOW — la capa tapa un toast (NO PROCEDE en el z-index).** El brief pide una capa de toda la ventana. Un toast no es un diálogo; esconderlo en idle es la cubierta. Los diálogos ya no conviven con la capa (hallazgo 1), así que no hace falta bajar el `z-[260]` por debajo de `z-[10000]`. La parte de tragar el clic del modal sí se arregló (hallazgo 5).

8. **LOW — el hook importa el componente (procede).** `oledCover` e `inputSuppressUntil` están en `attractModeStore`. `useGamepadNavigation.ts` lee `attract.oledCover`. `rg components/OledCare` en ese hook no devolvió líneas; el script de política también lo afirma.

### Verificación de esta ronda

| afirmación | comando | salida |
|---|---|---|
| Identidad | `bridge-whoami --json` | `agent_family` `cursor`, `cwd` `.../Orbit-MT3K-oled`, exit 0 |
| Rama | `git rev-parse --abbrev-ref HEAD; git log -1 --oneline` | `feat/oled-care`, `0fda606 feat: cover an idle launcher window to protect OLED panels` |
| El grafo no indexa OLED en este branch | `graphify query "shouldCoverWithOledCare OledCare oledCareCoverActive dialogOpen"` | `No matching nodes found` |
| Política, diálogos, pausa de vitrina, ventana única, centinela, hook sin importar el componente | `pnpm run verify:oled-care` | `OLED care policy checks passed`, exit 0 |
| Tipos | `pnpm run typecheck` | exit 0, sin texto de error de `tsc` |
| i18n | `pnpm run verify:languages` | `Languages: 2209 UI entries and 60 native entries per language; key/placeholder parity, encoding, defaults, fallback, interpolation and regional formatting passed.` |
| Vitrina | `pnpm run verify:attract-captures` | exit 0, `Attract/captures policy and filesystem checks passed`. También imprimió el skip de `escape.png` (`UnsafeCaptureError`); no toqué capturas |
| Teclado de mando | `pnpm run verify:gamepad-keyboard` | `ORBIT gamepad keyboard editing checks passed`, exit 0 |
| Build | `pnpm run build` | `electron-vite build`, exit 0 |
| Ajustes (el harness carga `useGamepadNavigation`) | `pnpm run verify:settings` | `Settings: all 30 topics, exclusive expansion, saving, draft retention, hidden focus, keyboard/controller/category/back navigation, and 720p/1080p layout passed.` |
| El hook ya no importa la capa | `rg components/OledCare src/renderer/src/hooks/useGamepadNavigation.ts` | sin coincidencias (el patrón está en el archivo que `rg` sí leyó) |
| MainShell sigue arrancando la fase en idle | `rg useState<GameLaunchStatus> src/renderer/src/components/MainShell.tsx` | línea 110: `{ phase: 'idle' }` |

### Qué NO verifiqué (ronda 1)

- La cubierta en una ventana Electron de verdad: ni el PIN, ni confirmar perfil, ni el negro/dim encima de la vitrina. `verify:settings` monta Ajustes y el hook del mando, no `OledCare`.
- El orden real de los listeners de captura si la vitrina y la capa están las dos montadas (es hipótesis que el trago aguanta en los dos órdenes, porque el plan es puro y `touch()` apaga `oledCover` al despertar).
- Un mando físico, Windows, Xbox Mode, y que `#000` apague píxeles de un OLED.
- `pnpm install`: no lo corrí en esta ronda; `node_modules` ya estaba y los gates de arriba usaron ese árbol.
