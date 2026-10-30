/**
 * Guide provider of the app agent host (plan M3): serves authoring guides
 * through the `describe` tool (`guide:<topic>`), so agents without repo
 * access (Claude Desktop) learn to write plugins.
 *
 * Sources are bundled lazily as raw text (`?raw`): the files are only
 * loaded when an agent asks for a topic.
 */
import type { GuideProvider, GuideSummary } from '@pixelmapper/agent-kit';

// ── Sources ─────────────────────────────────────

/** Lazy loader of one raw text file. */
type RawLoader = () => Promise<string>;

/** Fixed guides (architecture docs and the SDK typings). */
const FIXED = import.meta.glob<string>([
  '../../../architecture/guides/authoring-content-plugins.md',
  '../../../architecture/guides/modifier-design-principles.md',
  '../../../docs/ai/plugin-sdk.d.ts',
], { query: '?raw', import: 'default' });

/** Skill files (`docs/ai/skills/<skill>/<file>.md`); may be empty. */
const SKILLS = import.meta.glob<string>('../../../docs/ai/skills/**/*.md', { query: '?raw', import: 'default' });

/** Topic id, title and file suffix of the fixed guides. */
const FIXED_TOPICS: Array<{ id: string; title: string; file: string }> = [
  { id: 'guide:plugin-authoring', title: 'Authoring content plugins (modifiers): manifest, params, render, plugins.build', file: 'architecture/guides/authoring-content-plugins.md' },
  { id: 'guide:modifier-design', title: 'Modifier design principles (what a good modifier must be)', file: 'architecture/guides/modifier-design-principles.md' },
  { id: 'guide:plugin-sdk', title: 'Plugin SDK type definitions (plugin-sdk.d.ts)', file: 'docs/ai/plugin-sdk.d.ts' },
];

// ── Helpers ─────────────────────────────────────

/** Finds the loader whose glob key ends with `file`. */
function loaderFor(globs: Record<string, RawLoader>, file: string): RawLoader | undefined {
  const key = Object.keys(globs).find(k => k.endsWith(`/${file}`));
  return key ? globs[key] : undefined;
}

/** `guide:<skill>/<file>` id of a skill glob key (`…/docs/ai/skills/a/b.md` → `guide:a/b`). */
function skillTopicId(key: string): string {
  const rel = key.split('/docs/ai/skills/')[1] ?? key;
  return `guide:${rel.replace(/\.md$/, '')}`;
}

// ── Provider ────────────────────────────────────

/**
 * Creates the guide provider. `fixed` / `skills` are injectable for tests;
 * the defaults are the bundled globs.
 */
export function createGuideProvider(
  fixed: Record<string, RawLoader> = FIXED,
  skills: Record<string, RawLoader> = SKILLS,
): GuideProvider {
  const topics = new Map<string, { title: string; load: RawLoader }>();
  for (const t of FIXED_TOPICS) {
    const load = loaderFor(fixed, t.file);
    if (load) topics.set(t.id, { title: t.title, load });
  }
  for (const [key, load] of Object.entries(skills)) {
    const id = skillTopicId(key);
    topics.set(id, { title: `Skill ${id.slice('guide:'.length)}`, load });
  }

  return {
    list: (): GuideSummary[] => [...topics].map(([id, t]) => ({ id, title: t.title })),
    async get(id) {
      // Skill topics are also accepted with their file suffix (`guide:a/b.md`).
      const topic = topics.get(id) ?? topics.get(id.replace(/\.md$/, ''));
      if (!topic) return null;
      try {
        return await topic.load();
      }
      catch (err) {
        console.warn(`[agents] loading guide ${id} failed:`, err);
        return null;
      }
    },
  };
}
