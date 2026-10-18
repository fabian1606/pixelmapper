# WP-TAURI — Desktop autarky

Implements ADR 0004 **D18** (bundled OFL library), **D19** (bundled firmware) and **D20** (AI gated on endpoint reachability). Platform differences follow ADR 0003: host code imports from `#platform`, extensions use `getPlatform()`.

## D18 — Bundled OFL fixture library

| | Web | Desktop (Tauri) |
|---|---|---|
| Source | Nitro routes `/api/fixtures`, `/api/fixtures/:mf/:fix` (server assets) | Static files `/ofl/index.json`, `/ofl/fixtures/<mf>/<fix>.json` |
| Implementation | `app/platform/web/fixture-library.ts` (`$fetch`) | `app/platform/tauri/fixture-library.ts` (`fetch` + client-side query) |

- **Contract:** `FixtureLibrary` in `app/platform/fixture-library.ts` (`listManufacturers()`, `queryFixtures(query)`, `getFixture(mf, fix)`). Each `#platform` entry exports `getFixtureLibrary()`. Callers use `useFixtureLibrary()` (`app/composables/use-fixture-library.ts`), which keeps one instance per app so the index is fetched once. Callers: `FixtureLibraryBrowser.vue`, `AddFixtureDialog.vue`.
- **Shared logic:** `app/utils/ofl/library-query.ts` (`buildFixtureSummary`, `queryFixtures`, `sortByName`). The Nitro route and the bundled source both use it, so the response shapes and paging rules are identical:
  - With `search` or `category`, results come from all manufacturers and are paginated (`limit` defaults to 50, max 1000).
  - With only `manufacturer`, the route returns that manufacturer's fixtures unpaginated.
  - Manufacturer counts include OFL redirect files.
- **Build step:** `scripts/tauri/ofl-bundle.ts` (`buildOflBundle(src, out)`, also a CLI) reads `ofl-data/fixtures`. It writes `.tauri-public/ofl/index.json` (~270 KB raw, ~32 KB gzip) and copies every valid definition (608 fixtures, ~7.4 MB). Redirect files are skipped.
  - When `TAURI_ENV_PLATFORM` is set, `nuxt.config.ts` runs the build step as an inline module and adds `.tauri-public` as a Nitro `publicAssets` dir. It runs on every Tauri build and dev start and takes about 1 s.
  - Web builds neither run the step nor ship the files. `.tauri-public` is gitignored.

## D19 — Bundled firmware

- **Platform API 1.3** (additive; `API_VERSION` 1.3.0) adds two optional capabilities to `Platform`. Absent means `null`, so older hosts stay compatible.
  - `http: HttpApi | null`: `getBytes(url)`, native HTTP without CORS.
  - `resources: ResourcesApi | null`: `read(path)`, which returns `Uint8Array`, or `null` if the file was not bundled.
  - Web: both `null`. Tauri: `app/platform/tauri/native-files.ts` calls the commands in `src-tauri/src/net.rs`:
    - `http_get_bytes`: reqwest with rustls. Only `https://` on `github.com`, `api.github.com` and `objects.githubusercontent.com`; redirects are followed. 10 s connect timeout, 120 s total timeout (errors start with `timeout:`), so a stalled network (captive portal, LAN without gateway) rejects and the flash falls back to the bundled firmware instead of hanging with `isFlashing` stuck.
    - `resource_read`: reads `<resource_dir>/resources/<path>`. Only plain relative paths are allowed. A missing file returns `Err("not_bundled")`, which the frontend maps to `null`. The command is `async` and reads via `spawn_blocking`, so reading the firmware does not block the UI thread.
- **Build step:** `scripts/tauri/firmware-bundle.ts` is part of the Tauri `beforeBuildCommand`. It writes `src-tauri/resources/firmware/firmware.bin` and `firmware-meta.json` (`{ version, source }`), taking the first source that exists:
  1. `PM_FIRMWARE_BIN` (+ `PM_FIRMWARE_VERSION`)
  2. the release asset `v<package.json version>/firmware.bin` (published by `.github/workflows/build-firmware.yml` for the `waveshare_p4_poe` env when `bun run release` pushes the tag)
  3. the local `pio/.pio/build/waveshare_p4_poe/firmware.bin` (version `dev`)

  Without a binary, the step prints a warning and exits 0. `PM_FIRMWARE_REQUIRED=1` makes it fail instead. Both output files are gitignored; `README.txt` keeps the `bundle.resources` glob non-empty. `tauri.conf.json` reads the app version from `../package.json`, so the app and firmware versions match.
- **Connector:** `extensions/connector-esp/firmware-source.ts`:
  - `readBundledFirmware(platform)` returns the bundled copy.
  - `fetchLatestRelease(platform)` returns the latest GitHub release. It downloads through `platform.http` on desktop and through `/api/firmware-proxy` on the web. The release check is aborted after `RELEASE_CHECK_TIMEOUT_MS` (5 s, `timeoutSignal` falls back to a timer where `AbortSignal.timeout` is missing).
  - `pickFirmware` chooses the newer of the two, and the bundled copy on ties.
  - `EspSerialConnector` exposes `latestFirmware`. The bundled copy is offered as soon as it is read; the release check only upgrades it when it returns a newer version. If the GitHub download fails during a flash, it falls back to the bundled copy.
  - Offline on desktop, the bundled firmware is offered. `SerialSettings.vue` shows "(latest vX, bundled)", or "(no firmware available offline)".

## D20 — AI reachability

- `aiBackendService` serves `GET /health`, which returns `{ ok: true }`. It is registered after CORS and before body parsing.
- `app/utils/sync/ai-reachability-probe.ts` holds the pure probe. It requests `GET <aiBackendUrl>/health` with a 3 s timeout and caches the result for 45 s; concurrent calls share one request.
- `app/composables/use-ai-reachability.ts` keeps one shared instance:
  - `useAiReachability()` returns `aiReachable` (`null` until probed), `aiChecking`, `aiBaseUrl` and `probeAi()`.
  - `reportAiFailure(err)` re-probes only on network errors. `reportAiSuccess()` keeps the cache fresh.
  - `AI_UNREACHABLE_HINT = 'AI backend not reachable'`.
  - The composable re-probes on `onReconnect` (`app/utils/sync/connectivity.ts`).
- An unreachable AI endpoint does not mark the app offline.
- Gated: `useAiFixtureEnrichment.enrichFromManual` and the "Verify with AI" / "AI PDF Import" actions in `CustomFixtureEditorDialog.vue`. These are the only users of `aiBackendUrl`. The "Create from PDF" card in `AddFixtureDialog.vue` stays enabled; the dialog it opens shows the hint and blocks the upload.

## Quit guard (flush before close / quit)

Local-only projects persist only through the working snapshot (written 1 s after the last change, at least every 5 s). `beforeunload` starts the IndexedDB writes, but Tauri does not wait for them, so edits of the last second could be lost on close or ⌘Q.

- **Rust** (`src-tauri/src/lifecycle.rs`): `WindowEvent::CloseRequested` on the main window and `RunEvent::ExitRequested` (⌘Q, menu Quit) are prevented once. The backend then emits `app-before-quit` with the payload `"close"` or `"exit"`. The command `app_quit_ready(mode)` approves and performs it: `exit(0)`, or `destroy()` of the window. Two safety nets keep the app quittable:
  - Without an answer, a 5 s fallback thread performs the close or exit anyway.
  - A second close or quit while one is pending goes through at once.
- **Platform:** `AppShell.onBeforeQuit(handler)`. On Tauri (`app/platform/tauri/app-shell.ts`) the handlers run in parallel, bounded by `QUIT_FLUSH_TIMEOUT_MS` (3 s), and then `app_quit_ready` is invoked. On the web it is a no-op.
- **Flush:** `app/plugins/before-quit.client.ts` registers `flushOpenSession()` (`app/utils/sync/unload-handlers.ts`). It writes the outbox rows (`flushOutboxWrites`), then the open session's working snapshot. `installUnloadHandlers` registers that writer and unregisters it on dispose. `flushOpenSession()` never rejects.

## Nitro routes in the SPA build

The Tauri SPA build has no Nitro server. Remaining `/api/` references are web-only:
- `app/platform/web/fixture-library.ts` (`/api/fixtures`, not imported in Tauri builds)
- `extensions/connector-esp/firmware-source.ts` (`/api/firmware-proxy`, used only when `platform.http` is `null`)

No other `$fetch`/`useFetch` or relative fetches remain. Online-only by nature (not Nitro): Supabase (auth, edge functions, realtime), the GitHub release check, and the AI backend.

## Tests

- `app/utils/ofl/library-query.test.ts`
- `app/platform/tauri/fixture-library.test.ts`
- `app/platform/tauri/native-files.test.ts`
- `extensions/connector-esp/firmware-source.test.ts` (incl. stalled release check)
- `extensions/connector-esp/serial-connector.test.ts` (bundled offered immediately, upgraded later)
- `app/utils/sync/ai-reachability-probe.test.ts`
- `app/platform/tauri/app-shell.test.ts` (quit handlers, timeout, `app_quit_ready`)
- `app/utils/sync/unload-handlers.test.ts` (`flushOpenSession`)
- Rust: `net::tests` (URL allowlist, path escapes, stalled server times out), `lifecycle::tests` (intercept → force → allow)
