import type { ControllerDefinition } from './types';

interface ModuleExport {
  default: ControllerDefinition;
}

// Eagerly load every controller's index.ts. Each module exports a default
// ControllerDefinition with `svg: ''` — we patch the field below from the
// parallel raw SVG glob keyed by folder name.
const meta = import.meta.glob<ModuleExport>(
  '~controllers/*/index.ts',
  { eager: true },
);

const svgs = import.meta.glob<string>(
  '~controllers/*/layout.svg',
  { query: '?raw', import: 'default', eager: true },
);

function folderFromPath(path: string): string | null {
  // Vite glob keys look like "/Users/.../controllers/akai-apc-mini-mk2/index.ts"
  // or relative-resolved "../../../controllers/akai-apc-mini-mk2/index.ts".
  const m = path.match(/controllers\/([^/]+)\/[^/]+$/);
  return m ? m[1] : null;
}

function buildCatalog(): Record<string, ControllerDefinition> {
  const svgByFolder = new Map<string, string>();
  for (const [path, raw] of Object.entries(svgs)) {
    const folder = folderFromPath(path);
    if (folder) svgByFolder.set(folder, raw);
  }

  const out: Record<string, ControllerDefinition> = {};
  for (const [path, mod] of Object.entries(meta)) {
    const folder = folderFromPath(path);
    if (!folder) continue;
    const def = mod.default;
    if (!def) continue;
    if (def.key !== folder) {
      console.warn(
        `[controllers] folder "${folder}" exports key "${def.key}" — should match folder name`,
      );
    }
    const svg = svgByFolder.get(folder) ?? '';
    out[def.key] = { ...def, svg };
  }
  return out;
}

export const CONTROLLER_CATALOG: Record<string, ControllerDefinition> = buildCatalog();

export function getControllerDefinition(key: string): ControllerDefinition | null {
  return CONTROLLER_CATALOG[key] ?? null;
}

export function listControllerDefinitions(): ControllerDefinition[] {
  return Object.values(CONTROLLER_CATALOG);
}
