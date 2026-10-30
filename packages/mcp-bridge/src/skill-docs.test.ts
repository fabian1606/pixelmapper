// @vitest-environment node
/**
 * The effect-authoring skill (plan M5) as shipped in `docs/ai/skills/`:
 * its MCP prompts load and render, SKILL.md carries the Claude Code
 * frontmatter, the Claude Code skill link points at it, and the examples
 * are the golden-tested built-in plugins (symlinks, never copies that drift).
 */
import { lstatSync, readFileSync, readlinkSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import { defaultSkillsDir } from './config';
import { loadPrompts, renderPrompt } from './prompts';

const ROOT = resolve(import.meta.dirname, '../../..');
const SKILL = join(ROOT, 'docs/ai/skills/effect-authoring');

describe('effect-authoring skill', () => {
  it('ships the create-effect and add-controls prompts', () => {
    const prompts = loadPrompts(defaultSkillsDir());
    const byName = new Map(prompts.map(p => [p.name, p]));
    const create = byName.get('create-effect');
    const controls = byName.get('add-controls');
    expect(create?.arguments.find(a => a.name === 'description')?.required).toBe(true);
    expect(controls?.arguments.map(a => a.name)).toEqual(['modifierId', 'wishes']);
    const text = renderPrompt(create!, { description: 'a wave from the four corners' });
    expect(text).toContain('a wave from the four corners');
    expect(text).toContain('guide:effect-authoring/SKILL');
    expect(text).not.toMatch(/\{\{/);
    expect(renderPrompt(controls!, {})).toContain('guide:effect-authoring/ui-rules');
  });

  it('SKILL.md has the Claude Code frontmatter and links its reference files', () => {
    const text = readFileSync(join(SKILL, 'SKILL.md'), 'utf8');
    const meta = parseYaml(/^---\n([\s\S]*?)\n---/.exec(text)![1]!) as { name: string; description: string };
    expect(meta.name).toBe('pixelmapper-effects');
    expect(meta.description.length).toBeGreaterThan(50);
    for (const file of ['patterns.md', 'ui-rules.md', 'verification.md', 'examples/README.md']) {
      expect(text).toContain(`(${file})`);
      expect(() => readFileSync(join(SKILL, file))).not.toThrow();
    }
  });

  it('the Claude Code skill is a symlink to the single source', () => {
    const link = join(ROOT, '.claude/skills/pixelmapper-effects');
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readlinkSync(link)).toBe('../../docs/ai/skills/effect-authoring');
    expect(realpathSync(link)).toBe(realpathSync(SKILL));
  });

  it.each(['corner-wave', 'mirror-runner'])('example %s is the built-in plugin', (name) => {
    for (const file of ['manifest.json', 'modifier.ts']) {
      const example = join(SKILL, 'examples', name, file);
      expect(lstatSync(example).isSymbolicLink()).toBe(true);
      expect(realpathSync(example)).toBe(realpathSync(join(ROOT, 'plugins', name, file)));
    }
  });
});
