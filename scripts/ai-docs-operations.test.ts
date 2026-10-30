/**
 * Operation catalog for `docs/ai/index.json` (plan A1.9 / A10.2).
 *
 * The core operations live in app code that relies on Nuxt path aliases
 * (`~/…`, `~~/…`) and Vite features (`import.meta.glob`, `?raw`), so the
 * Bun script `generate-ai-docs.ts` cannot import them directly. Vitest
 * mirrors those aliases, so this test builds the registry headlessly
 * (`registerCoreOperations(createOperationRegistry())`, nothing executed)
 * and either:
 *
 * - writes `docs/ai/.operations.collected.json` for the generator
 *   (`PM_COLLECT_OPERATIONS=1`, set by `bun run docs:ai`), or
 * - checks that the committed `docs/ai/index.json` lists exactly the current
 *   catalog, so a new or renamed operation fails CI until `bun run docs:ai`
 *   is rerun.
 */
// @vitest-environment node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createOperationRegistry, registerCoreOperations } from '~/utils/operations';

const OUT = fileURLToPath(new URL('../docs/ai', import.meta.url));

/** Catalog entry as emitted into `index.json` (sorted by id). */
interface CatalogEntry { id: string; kind: string; namespace: string; summary: string }

/** The core operation catalog, deterministic (registry `list()` sorts by id). */
function operationCatalog(): CatalogEntry[] {
  return registerCoreOperations(createOperationRegistry())
    .list()
    .map(({ id, kind, namespace, summary }) => ({ id, kind, namespace, summary }));
}

describe('docs/ai operation catalog', () => {
  it('matches docs/ai/index.json (run `bun run docs:ai` after changing operations)', () => {
    const catalog = operationCatalog();
    expect(catalog.length).toBeGreaterThan(0);

    if (process.env.PM_COLLECT_OPERATIONS === '1') {
      mkdirSync(OUT, { recursive: true });
      writeFileSync(join(OUT, '.operations.collected.json'), JSON.stringify(catalog, null, 2));
      return;
    }

    const indexFile = join(OUT, 'index.json');
    if (!existsSync(indexFile)) return;
    const index = JSON.parse(readFileSync(indexFile, 'utf8')) as { operations?: CatalogEntry[] };
    expect(index.operations).toEqual(catalog);
  });
});
