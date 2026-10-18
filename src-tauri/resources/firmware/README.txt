Bundled ESP32 firmware of the desktop app (ADR 0004 D19).

`bun run scripts/tauri/firmware-bundle.ts` (part of the Tauri
beforeBuildCommand) writes `firmware.bin` and `firmware-meta.json` here:
the release asset of the tag `v<package.json version>`, or a local
PlatformIO build as a fallback. Both files are gitignored; this README
keeps the resource glob in tauri.conf.json non-empty.
