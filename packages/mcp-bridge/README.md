# pixelmapper-mcp

Use Pixelmapper from **Claude Code** or **Claude Desktop**. `pixelmapper-mcp` is a small Bun CLI that MCP clients launch as a **stdio MCP server**. The open Pixelmapper app (browser tab or Tauri window) connects to it over `ws://127.0.0.1:7778` and runs the tools. The CLI forwards calls and does nothing else.

```
Claude Code / Desktop ──stdio MCP──► pixelmapper-mcp ◄──ws://127.0.0.1:7778── Pixelmapper app
```

Protocol contract: [`architecture/mcp-bridge-protocol.md`](../../architecture/mcp-bridge-protocol.md).

## Requirements

- [Bun](https://bun.sh) ≥ 1.2
- Dependencies installed in the repo root: `bun install`

## Register with Claude Code

```bash
claude mcp add pixelmapper -- bun run /ABSOLUTE/PATH/TO/pixelmapper/packages/mcp-bridge/src/cli.ts
```

## Register with Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "pixelmapper": {
      "command": "bun",
      "args": ["run", "/ABSOLUTE/PATH/TO/pixelmapper/packages/mcp-bridge/src/cli.ts"]
    }
  }
}
```

If Claude Desktop cannot find `bun`, use its absolute path (`which bun`, for example `/Users/you/.bun/bin/bun`).

Claude Code and Claude Desktop can run at the same time. The first process owns port 7778. The second one relays through it, and it takes over the port if the first one exits.

## Pair the app

1. Print the pairing token. It is created on first use in `~/.pixelmapper/mcp-token` with mode `0600`:
   ```bash
   bun run mcp token        # from the repo root
   ```
2. In Pixelmapper, open **Settings → External agents**, turn it on and paste the token.
3. In Claude, call the `pixelmapper_status` tool or simply ask it to inspect the project.

Only one Pixelmapper window is connected at a time. The most recently enabled window wins.

## Run manually

```bash
bun run mcp              # stdio MCP server (stdout = JSON-RPC, logs on stderr)
bun run mcp token        # print pairing token
bun run mcp help
```

## Configuration (environment)

| Variable | Default | Purpose |
|---|---|---|
| `PIXELMAPPER_MCP_PORT` | `7778` | WebSocket port (loopback only) |
| `PIXELMAPPER_MCP_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000,tauri://localhost,http://tauri.localhost` | Allowed app origins (comma-separated; `*` disables the check) |
| `PIXELMAPPER_MCP_TOKEN_FILE` | `~/.pixelmapper/mcp-token` | Pairing token file |
| `PIXELMAPPER_MCP_TOOL_CACHE` | `~/.pixelmapper/mcp-tools.json` | Last-known tool list (served while the app is closed) |
| `PIXELMAPPER_MCP_CALL_TIMEOUT_MS` | `60000` | Per-call timeout |
| `PIXELMAPPER_SKILLS_DIR` | `<repo>/docs/ai/skills` | Root scanned for MCP prompts (`**/prompts/*.md`) |

To set them for Claude Code, use `claude mcp add -e NAME=value …`. For Claude Desktop, use an `"env": { … }` object next to `"args"`.

## Prompts

Every `docs/ai/skills/**/prompts/*.md` file becomes an MCP prompt:

```markdown
---
name: create-effect
description: Build a new modifier effect from a description
arguments:
  - name: idea
    description: What the effect should look like
    required: true
---
Build this effect in the open Pixelmapper project: {{idea}}
```

Files are re-read on every request, so edits show up without restarting the CLI.

## Development

```bash
bun run test packages/mcp-bridge                          # Vitest (node environment)
bunx tsc --noEmit -p packages/mcp-bridge/tsconfig.json    # typecheck
```

Source layout (`src/`):

| File | Role |
|---|---|
| `cli.ts` | Entry point and subcommands |
| `protocol.ts` | Wire types, versions, close codes, validation |
| `hub.ts` | WebSocket server: auth, single active app, call routing, relay connections |
| `relay-client.ts` | Secondary instance connected to the hub |
| `coordinator.ts` | Hub-or-relay election and takeover |
| `mcp-server.ts` | MCP `tools/*` and `prompts/*` handlers |
| `tool-catalog.ts` | Live, last-known and fallback tool lists, plus the `pixelmapper_status` tool |
| `prompts.ts` | Prompt loading and rendering |
| `token.ts`, `config.ts`, `log.ts` | Token file, environment config, stderr logging |
