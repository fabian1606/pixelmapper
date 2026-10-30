# AI reference (generated)

Context files for humans and AI agents writing extensions or content plugins (ADR 0001 D25). Regenerate with `bun run docs:ai`.

| File | Contents |
|---|---|
| `extension-api.d.ts` | Bundled declarations of `@pixelmapper/extension-api` (manifest, scopes, slots, `pm.*` contracts, kinds, connectors, controllers, commands, live values) |
| `plugin-sdk.d.ts` | Bundled declarations of the AssemblyScript `@pixelmapper/plugin-sdk` (`Modifier`, `Frame`, `Sample`, `Out`, `Params`, math/color/wave helpers) |
| `index.json` | Machine-readable index: contribution kinds, every `pm.*` input with its props, every scope with its fields, slot ids observed at runtime (with available scopes) plus documented patterns, param types (wire slots, default input), signatures, core commands, the agent operation catalog (`operations[]`: id, kind, namespace, summary; collected by `scripts/ai-docs-operations.test.ts`) |

Pair them with the guides: [authoring-extensions.md](../../architecture/guides/authoring-extensions.md), [authoring-content-plugins.md](../../architecture/guides/authoring-content-plugins.md). The `/dev/slots` page lists slot ids rendered in a running dev session.

**Skills** (hand-written, not generated): `skills/<skill>/` holds step-by-step AI workflows. [`skills/effect-authoring/`](skills/effect-authoring/SKILL.md) teaches building spatial lighting effects with their controls; Claude Code loads it as the `pixelmapper-effects` skill (`.claude/skills/pixelmapper-effects` symlink), the MCP bridge serves its `prompts/*.md` as MCP prompts and its Markdown files as `describe` topics `guide:effect-authoring/<file>`.
