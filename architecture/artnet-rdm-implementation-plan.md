# Implementation Plan — Art-Net 4 & RDM (Pixelmapper Node, XBAR500 tubes)

Goal: Pixelmapper talks Art-Net 4 to the **Pixelmapper Node** (CH32V307, 4 ports), discovers the RDM devices on its ports (XBAR500 tubes), shows them with their addresses, adds them to the canvas on request, keeps their patch in sync via RDM, and updates tube firmware over the network.

This plan is the order of work. The specs are binding:

- **Art-Net 4** (Artistic Licence) and **ANSI E1.20 RDM** / E1.37-1/-2 — implemented **exactly**. If something does not work with a device, it must be the device's deviation, not ours.
- **Protocol contract** "Pixelmapper Node – Protokollvertrag für Pixelmapper" (hardware repo, 2026-10-24) — which parts we use, how the node behaves, what Pixelmapper must do. Section numbers below (§n) refer to it.
- **Tube firmware** `ledTubeXBAR500/firmware/tube_fw/README.md`, `include/rdm_boot.h`, reference implementation `flash_rdm.py`.

Decisions behind this plan were made in a design interview on 2026-10-24; they are summarized in [Decisions](#decisions).

## How to work through this plan

- Two codebases: **hardware monorepo** `pixelmapper-hardware` (crate `pixelmapper-net`, CLI `pmnet`, `protocol/`) and **this repo** (core API + extension `connector-artnet`). Milestones M1–M3 and M4 are independent and may run in parallel.
- Build everything, then integration-test against the real node and tubes and fix what breaks. No node simulator. Codecs are still unit-tested against `protocol/vectors/*.json` (contract §8).
- Tick a task when its *Done when* holds. Commit per task, e.g. `feat(artnet): M5.2 node suggestions`.
- Follow `AGENTS.md` (Bun, TS only, comments on all code, kebab-case files, Rust section-header comments). After each milestone update `architecture/connectors.md` and `architecture.md`.
- Core changes (M4) must not mention Art-Net or RDM (ADR 0001 D17: core never depends on a connector).

Legend: **Files** = main files to create (+) / change (~) / delete (−). **Done when** = acceptance criteria.

---

## Decisions

| # | Topic | Decision |
|---|---|---|
| D1 | Scope | Standard Art-Net 4 RDM (ArtTod*, ArtRdm). Default target is the Pixelmapper Node; other spec-compliant nodes work as a side effect. |
| D2 | Protocol implementation | All Art-Net/RDM code lives in the Rust crate **`pixelmapper-net`**. **`pmnet serve`** is the bridge and replaces `tools/artnet-bridge`. Pixelmapper never builds packets itself (§8). |
| D3 | Bridge ↔ app | WebSocket on `127.0.0.1:7777` only, `Origin` allow-list (Pixelmapper domains + localhost), version handshake. Contract: [artnet-bridge-ws-protocol.md](artnet-bridge-ws-protocol.md) (draft, moves to `protocol/`). Web: Chrome/Firefox; Safari unsupported for Art-Net. Desktop app embeds `pmnet` later. |
| D4 | OpCodes v1 | ArtPoll/ArtPollReply (send + receive, Flags bit 1), ArtDmx (unicast to subscribers, sequence), ArtSync, ArtTodRequest/ArtTodData/ArtTodControl, ArtRdm, ArtAddress, ArtIpProg/Reply, ArtInput, ArtDiagData (receive, log only). Later: ArtFirmwareMaster, node RDM firmware PIDs, `BOOT_CATCH`. Others are ignored as the spec requires. |
| D5 | State model | Last-writer-wins (§1, §7): state is taken from replies/announcements only (unsolicited ArtPollReply, ArtTodData, queued messages, periodic re-read of tubes every 30–60 s), never from what we sent. |
| D6 | Connectors | **One connector per node.** Discovery runs by default; found nodes are suggested ("Connect"); manual add by IP. Node identity = RDM UID (`DefaultRespUID`), fallback MAC; replies merged by IP + `BindIndex`. |
| D7 | Universes | Pixelmapper translates: per node output port, choose the Pixelmapper universe (default = the port's Port-Address; Port-Address 0 → U1). *Changed in WP3 from “port-address + 1”: the node's factory Port-Addresses are 1–4 and Art-Net 4 deprecates Port-Address 0, so U1–U4 meet ports 1–4 without writing anything.* Nothing is written to the node unless the user explicitly does so. |
| D8 | Node configuration | Fully configurable from the node's connector card: Ports, Network, Device, Advanced (generated from `PARAMETER_DESCRIPTION`). Network changes and changing a port's direction while data flows need confirmation. |
| D9 | Discovery list | Lives in the node's connector card. Devices are added only via **Add** / **Add all** (one undo step). |
| D10 | Fixture matching | Cascade: (1) custom fixture or OFL with matching RDM manufacturer + model ID, mode by `rdmPersonalityIndex`; (2) generated from `SLOT_INFO`/`SLOT_DESCRIPTION`; (3) generic, N dimmer channels of the footprint. |
| D11 | XBAR500 definition | Imported once as a **custom fixture** (new import in the custom fixture editor, with RDM fields). Custom fixtures move to the user account later — not in this plan; access them through one accessor. |
| D12 | Address on add | The fixture takes the tube's **current** address and mode. Overlap with occupied channels is flagged; **Assign free address** fixes one, **Auto-address** re-addresses all linked tubes gap-free (one undo step). |
| D13 | Link | After adding, the tube is a normal fixture; the link is the RDM UID in fixture extension data. Changing address or mode in the normal UI writes RDM SET automatically. |
| D14 | Universe change | Changing the universe of a linked fixture warns ("bound to a physical node port"). "Change anyway" **unlinks** (UID kept, no RDM writes). Setting the universe back re-links. |
| D15 | Status badge | In the fixture list, only for fixtures with an RDM link: **Connected**, **Mismatch** (device reports other address/mode → click: *Write to device* / *Take from device*), **Offline**, **Unlinked**. Tooltip: UID, firmware, last seen. |
| D16 | Placement | Same as the add-fixture dialog today: centre, diagonal cascade, one command, new fixtures selected. Shared code, not a copy. |
| D17 | Tube firmware | Via RDM over Art-Net per §9.1 (PIDs 0x8000, 0x8010–0x8013, 16-byte trailer at 0x17F0). Check trailer + manufacturer + model before sending; downgrade only with confirmation. One update per port at a time, ports in parallel. Per tube (inspector) or batch per node ("Update tubes…"). |
| D18 | Settings placement | Node → its connector card. Unlinked tube → row in the discovery list. Linked tube → "RDM" section in the fixture inspector (UID, version, identify, label, generated PIDs, update). Address/mode stay the normal fixture fields. |

---

## M1 — `pixelmapper-net`: codecs and CLI (hardware repo)

- [ ] **M1.1 Crate skeleton.** + `crates/pixelmapper-net` (edition 2024, tokio), + `crates/pmnet` (binary). `protocol/pids.toml` → generated Rust constants (build script), shared with the C firmware.
  *Done when:* `cargo test` runs; constants for 0x8000/0x8010–0x8013 come from `pids.toml`.
- [ ] **M1.2 Art-Net codecs.** Encode/decode for all D4 opcodes, exactly per spec: header, ProtVer 14, little-endian OpCode, ArtPollReply incl. `BindIndex`, `DefaultRespUID`, Status1/2/3, GoodInput/GoodOutput, port-addresses; ArtTodData multi-packet (`UidTotal`, `BlockCount`); ArtRdm **without** 0xCC start code.
  *Done when:* round-trip tests against `protocol/vectors/*.json` for every opcode; malformed/short packets are rejected, never panic.
- [ ] **M1.3 RDM codecs.** E1.20 message framing + checksum; response types ACK, ACK_TIMER, ACK_OVERFLOW, NACK (reasons); DEVICE_INFO, SUPPORTED_PARAMETERS, PARAMETER_DESCRIPTION, labels, SOFTWARE_VERSION_LABEL, DMX_START_ADDRESS, DMX_PERSONALITY(+_DESCRIPTION), SLOT_INFO, SLOT_DESCRIPTION, DEFAULT_SLOT_VALUE, IDENTIFY_DEVICE, QUEUED_MESSAGE, STATUS_MESSAGES. Generic PID value codec driven by PARAMETER_DESCRIPTION (data type, PDL, min/max/default, unit, prefix).
  *Done when:* vector tests; a parameter described by PARAMETER_DESCRIPTION can be read/written without PID-specific code.
- [ ] **M1.4 Network engine.** UDP 6454 (`SO_REUSEADDR`/`SO_REUSEPORT`), interface enumeration, broadcast to each interface's subnet **and** 2.255.255.255 when an interface is in 2.0.0.0/8 (§2). ArtPoll every 2.5–3 s with Flags bit 1. Node table keyed by UID (fallback MAC), merged by IP + `BindIndex`, IP changes followed. Own ArtPollReply when polled.
- [ ] **M1.5 RDM transactions.** Per-port queue (max 1–4 in flight), 500 ms timeout, 2 retries (§6.2), ACK_TIMER wait, ACK_OVERFLOW reassembly, queued-message fetch when the message count of a node response is > 0.
- [ ] **M1.6 CLI.** `pmnet poll`, `pmnet tod <node> <port>`, `pmnet rdm get|set <node> <port> <uid> <pid> [data]`, `pmnet address …` (ArtAddress), `pmnet ipprog …`.
  *Done when:* the CLI lists the Pixelmapper Node and the tubes on its ports and reads their DEVICE_INFO.

## M2 — Tube firmware update in Rust (hardware repo)

- [ ] **M2.1 Image reader.** Intel HEX → image; validate 16-byte trailer (magic 0x4D50, format 1, manufacturer, model, FW_VERSION_ID, length, CRC16 over app + 0x17F0..0x17FB).
- [ ] **M2.2 Update procedure §9.1.** Check trailer → DEVICE_INFO manufacturer/model → SET 0x8000 "BOOT" → poll BOOT_INFO until the bootloader answers, re-check manufacturer/model → write pages (skip all-0xFF pages; **trailer page first with empty trailer, real trailer last**; resend on NACK BUFFER_FULL) → APP_CRC in 256-B chunks, rewrite differing chunks once → FINISH → after ~3 s verify DEVICE_INFO / SOFTWARE_VERSION_LABEL. Progress events; cancel leaves the tube in the bootloader (recoverable).
- [ ] **M2.3 CLI.** `pmnet flash <node> <port> <uid> <file.hex> [--allow-downgrade]`.
  *Done when:* a real tube is updated through the node; `flash_rdm.py` and `pmnet flash` produce byte-identical RDM traffic for the same image (compare logs).

## M3 — `pmnet serve` and the WebSocket contract (hardware repo)

- [ ] **M3.1 Contract.** Finalize [artnet-bridge-ws-protocol.md](artnet-bridge-ws-protocol.md) and move it to `protocol/bridge-ws.md`; keep a pointer here.
- [ ] **M3.2 Server.** `pmnet serve [--port 7777]`: binds `127.0.0.1` only, checks `Origin`, sends `hello` (bridge version, protocol version, interfaces). Implements every command/event of the contract. DMX frames are binary messages.
- [ ] **M3.3 Release.** CI builds `pmnet` for macOS (arm64/x64), Windows, Linux; GitHub Releases.
- [ ] **M3.4 Dev integration (this repo).** ~ `package.json` `dev` starts `pmnet serve` if found on `PATH` instead of `tools/artnet-bridge`; − `tools/artnet-bridge` once M5 works.

## M4 — Core API extensions (this repo, no Art-Net code)

- [x] **M4.1 Shared add path.** Extract `handleAddOflFixtures` (`app/components/engine/composables/use-workspace-operations.ts`) into a core function used by the add dialog **and** a new API command `commands.addFixtures(items)`; each item: source (`ofl` key | custom fixture key | kind), `modeIndex`, absolute `startAddress`, optional name. Same placement (centre + cascade), one `AddFixturesCommand`, new fixtures selected. Returns the new fixture ids.
  **Files:** ~ `use-workspace-operations.ts`, ~ `packages/extension-api/src/commands.ts`, ~ `app/utils/extensions/core-command-factory.ts`.
  *Done when:* dialog behaves as before; Vitest: API add of 3 fixtures = one undo step, ids returned.
- [x] **M4.2 Free address search.** Extract `autoAssignFreeAddress` (`AddFixtureDialog.vue`) into a pure helper `findFreeAddressSpan(fixtures, footprint, count, { ignore? })` in `app/utils/engine/`; expose read-only via the API. Dialog uses it.
- [x] **M4.3 Patch commands.** API `commands.setStartAddress({ fixtureId, startAddress })` wrapping `UpdateDmxCommand`. New `SetFixtureModeCommand` (fixture does not store its mode today): store source key + `modeIndex` on fixtures created from OFL/custom definitions, rebuild channels by swapping the fixture like `UpdateFixtureTypesCommand`, keep id, position, name, extension data. Add a **Mode** select to the fixture inspector for fixtures with a known source.
  *Done when:* changing mode in the inspector is undoable and keeps the fixture's links and position.
- [x] **M4.4 Batch command.** API `commands.batch(commands, description)` → one history entry (needed for Add all, Auto-address).
- [x] **M4.5 Change guard.** API hook `onBeforeFixtureChange((change) => allow | confirm(message) | deny)` evaluated by core commands that change address/universe/mode from the UI; `confirm` shows a core dialog. Used by D14.
- [x] **M4.6 Fixture change observation.** API to subscribe to patch changes of given fixtures (address, mode) including undo/redo and collaborator changes, so the connector can push RDM SETs (D13).
- [x] **M4.7 Custom fixture import + RDM fields.** Custom fixture editor: import an OFL JSON file (e.g. `ledTubeXBAR500/fixture/xbar500-custom.json`), fields for RDM manufacturer ID, model ID, and `rdmPersonalityIndex` per mode. One accessor `getCustomFixtures()` (no direct `localStorage` reads elsewhere) — prepares the later move to account storage.
- [x] **M4.8 Fixture lookup by RDM ID.** API `findFixtureDefinitionByRdm(manufacturerId, modelId)` over custom fixtures then OFL (`rdmId` in manufacturers, `rdm.modelId` in fixtures); returns key + mode mapping by personality index.
- [x] **M4.9 Docs.** `architecture/extensions.md` + `guides/authoring-extensions.md`: new commands, guard, observation, lookup.

*Status 2026-10-24 (API 1.3.0):* `commands.addFixtures` is **async** (OFL definitions load on demand) and returns an `AddFixturesCommand` with `fixtureIds`; extension data for the new fixtures goes into the same undo step via `commands.batch([add, ...setExtensionData])`. `setFixtureMode` is async for the same reason. *Deviations:* `SetFixtureModeCommand` swaps the mode-dependent state (channels, beams, source, definition) **in place** instead of swapping the fixture instance, so other commands' references and the selection stay valid; the add dialog keeps appending new fixtures after the highest used address as before (its address fields only suggest); `findFreeAddressSpan` additionally takes `universe` (span inside one universe, `null` if none). Extras: `listFixtures()`, `FixtureView.source`, `FixturePatchChange.initiator`, core `requestConfirm()` dialog. Custom fixtures store the RDM manufacturer ID in `pixelmapper.rdmManufacturerId`.

Slots already exist and need no core change: `scene/fixture:badges` (fixture row, D15), `properties:after` (inspector section, D18).

## M5 — Plugin: nodes and DMX (this repo, `extensions/connector-artnet`)

- [x] **M5.1 Bridge client.** + `bridge/` (`ArtNetBackend` interface, `WsBridgeBackend`, `NodeDirectory`, contract types): one shared WebSocket to `pmnet serve` per app (not per connector), reconnect, version check ("Bridge update needed"), typed commands/events per contract. No packet code.
- [x] **M5.2 Node suggestions.** Discovery runs whenever the extension is active *(changed in WP3: only while the Connectors page shows the suggestions or at least one `artnet-node` connector exists — avoids the browser's local-network prompt for users who never use Art-Net)*. Connectors page → Outputs: "Art-Net node found: *<short name> · <IP>* — Connect / Dismiss". Nodes already connected are not suggested. Manual add by IP. If the bridge is unreachable: hint with download link and `pmnet serve` command (Safari: unsupported notice).
  **Files:** + `components/NodeSuggestions.vue`, slot on the connectors page (~ `app/pages/project/[id]/connections.vue`, generic slot id, no Art-Net in core).
- [x] **M5.3 Node connector.** + `node/node-connector.ts` (new type `artnet-node`): config = node UID (fallback MAC); outputs = node output ports; IP followed from replies; status from bridge state + node presence. *Deviation (WP2 decision):* the old `artnet` connector stays unchanged as “ArtNet (manual target)” for existing setups instead of losing its target IP / broadcast settings.
- [x] **M5.4 DMX out.** Frames for mapped universes to the bridge; bridge sends unicast ArtDmx with port-address + sequence, ArtSync after each full frame set.
- [x] **M5.5 Port mapping UI (D7).** Per port: Pixelmapper universe (default = Port-Address since WP3, D7), node's port-address shown read-only, button "Write port address to node" (ArtAddress).
  *Done when:* Pixelmapper lights tubes through the node on all 4 ports.
  *Status 2026-10-24:* app side done and tested against a fake bridge (Vitest event replay); the hardware *Done when* is pending `pmnet serve` (M3) and the node. The contract was aligned with `pixelmapper-hardware/protocol/contract.md` (one port per BindIndex, `todControl`, ArtSync broadcast, Physical per connection).

## M6 — Plugin: discovery, add, patch, status (**v1**)

- [ ] **M6.1 Device list per node.** From ArtTodData per port; for each UID read DEVICE_INFO, labels, SOFTWARE_VERSION_LABEL, personality descriptions. Row: address · label · model · personality · firmware · state (new / linked / conflict). Actions: Identify (auto-off when leaving), Add, Assign free address. "Add all", "Auto-address", "Rediscover" (ArtTodControl `AtcFlush`).
  **Files:** + `components/DeviceDiscoveryList.vue`, + `device-store.ts` (extension-owned state per node).
- [ ] **M6.2 Matching cascade (D10).** + `fixture-matching.ts`: lookup (M4.8) → generated definition from SLOT_INFO/SLOT_DESCRIPTION/DEFAULT_SLOT_VALUE (stored as custom fixture so it can be edited) → generic dimmer fixture.
- [ ] **M6.3 Add / Add all (D9, D12, D16).** `commands.addFixtures` with the device's current address and personality → mode; UID + node UID + port written as fixture extension data; all in one batch.
- [ ] **M6.4 Conflicts and addressing.** Overlap check against all project fixtures (unlinked fixtures count as occupied). Assign free address = `findFreeAddressSpan` → RDM SET DMX_START_ADDRESS → fixture follows on ACK. Auto-address = all linked tubes of the node, ordered by canvas position, gap-free, one batch.
- [ ] **M6.5 Sync (D5, D13).** Observe linked fixtures (M4.6): address/mode change → RDM SET (DMX_START_ADDRESS / DMX_PERSONALITY); state from the device's answer. Device-side differences (re-read every 30–60 s and on TOD change) → Mismatch, never auto-overwrite.
- [ ] **M6.6 Universe guard (D14).** Register `onBeforeFixtureChange`: universe change of a linked fixture → confirm; on "change anyway" set link state `unlinked`; when the universe matches the port again, re-link.
- [ ] **M6.7 Status badge (D15).** + `components/RdmStatusBadge.vue` in `scene/fixture:badges`; Mismatch click → popover with *Write to device* / *Take from device*.
  *Done when (v1):* tubes on the node appear in the card with their addresses; Add all puts them on the canvas with correct mode and address; changing address/mode in Pixelmapper changes the tube; changing it on the node display shows Mismatch; unplugging shows Offline.

## M7 — Plugin: RDM pages, node configuration, firmware

- [ ] **M7.1 Generic RDM parameter form.** + `components/RdmParameterForm.vue`: renders any parameter from SUPPORTED_PARAMETERS + PARAMETER_DESCRIPTION with `pm.*` inputs. Hard-coded only what `pids.toml` defines.
- [ ] **M7.2 Inspector section (D18).** `properties:after` for linked fixtures: UID, firmware, identify, DEVICE_LABEL, generated parameters, "Update firmware…".
- [ ] **M7.3 Node configuration (D8).** Connector card sections Ports (direction via ArtAddress/ArtInput, merge HTP/LTP, RDM on/off, output style, failsafe), Network (DHCP/static, IP, mask, gateway via ArtIpProg — apply with confirmation), Device (names, identify/locate, firmware version), Advanced (node PIDs via M7.1). Confirmation for network apply and for direction change while data flows. Follow node IP/UID after ArtIpProg.
- [ ] **M7.4 Firmware update UI (D17).** Per tube from the inspector; batch per node: pick `.hex` → list of matching tubes with version old → new → run, progress per tube, one per port, ports parallel. Mismatching manufacturer/model is not offered; downgrade asks.
- [ ] **M7.5 Docs.** `architecture/connectors.md` (Art-Net 4 connector, bridge, RDM, firmware), `architecture.md` documentation map.

## Later (not in this plan)

Node firmware update (ArtFirmwareMaster / RDM FW_* PIDs, waits on `protocol/image-format.md`), `BOOT_CATCH` rescue (waits on `pids.toml`), `ArtRdmSub`, custom fixtures stored in the user account, desktop app with embedded `pmnet`, USB DMX (OpenDMX) in the web app, better placement of added fixtures (both add paths).

## Dependency overview

```
M1 ──► M2 ──► M3 ──┐
                   ├──► M5 ──► M6 (v1) ──► M7
M4 ────────────────┘
```

## Known risks

- **Node not finished:** integration happens late; budget time for fixing after M6.
- **Port 6454 on the host** may be taken by other Art-Net software; `pmnet` uses `SO_REUSEADDR`/`SO_REUSEPORT` and reports bind errors to the UI.
- **Chrome Local Network Access** prompt on first connection from the hosted app; document it in the bridge hint.
- **Prototype manufacturer ID 0x7FF0:** another hobby device with the same IDs could be mistaken for a tube; the firmware check (manufacturer + model + trailer) prevents wrong flashing.
