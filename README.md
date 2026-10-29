# Nuxt Minimal Starter

Look at the [Nuxt documentation](https://nuxt.com/docs/getting-started/introduction) to learn more.

## Setup

Make sure to install dependencies:

```bash
# npm
npm install

# pnpm
pnpm install

# yarn
yarn install

# bun
bun install
```

## Development Server

Start the development server on `http://localhost:3000`:

```bash
# npm
npm run dev

# pnpm
pnpm dev

# yarn
yarn dev

# bun
bun run dev
```

## Production

Build the application for production:

```bash
# npm
npm run build

# pnpm
pnpm build

# yarn
yarn build

# bun
bun run build
```

Locally preview production build:

```bash
# npm
npm run preview

# pnpm
pnpm preview

# yarn
yarn preview

# bun
bun run preview
```

Check out the [deployment documentation](https://nuxt.com/docs/getting-started/deployment) for more information.

## Use Pixelmapper from Claude Code / Claude Desktop

Claude drives the **running** app through the MCP server `pixelmapper-mcp` (`packages/mcp-bridge`). The app connects to it over `ws://127.0.0.1:7778`, and the tools run inside the app: every change is one undo step labelled `AI: …`.

1. **Register the server.**
   - Claude Code, inside this repo: `cp .mcp.json.example .mcp.json`, or from anywhere:
     ```bash
     claude mcp add pixelmapper -- bun run /ABSOLUTE/PATH/TO/pixelmapper/packages/mcp-bridge/src/cli.ts
     ```
   - Claude Desktop: see [packages/mcp-bridge/README.md](packages/mcp-bridge/README.md#register-with-claude-desktop).
2. **Get the pairing token:** `bun run mcp token` (created once in `~/.pixelmapper/mcp-token`).
3. **Start the app:**
   - Web: `bun run dev` and open `http://localhost:3000`.
   - Desktop: `bun run dev:tauri`.
4. **Pair:** open **Settings** (gear icon in the header) → **External agents**, turn it on and paste the token. The status should say *Connected*.
5. **Ask Claude**, for example: *"Inspect the project and add a slow rainbow wave on the left group."*

Claude works in this order: `inspect` the project, then `operations` / `describe`, then `apply` with `dryRun` and `expect`, then `observe` the output. `describe` with `guide:plugin-authoring` teaches it to write new content plugins.

Only one app window is connected at a time; the most recently enabled one wins.
