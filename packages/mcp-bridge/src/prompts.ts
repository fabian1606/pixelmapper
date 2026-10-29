// ── MCP prompts from docs/ai/skills ─────────────────────
//
// Every `<skillsDir>/**/prompts/*.md` file becomes an MCP prompt. Optional
// YAML frontmatter:
//
//   ---
//   name: create-effect
//   description: Build a new modifier effect from a description
//   arguments:
//     - name: idea
//       description: What the effect should look like
//       required: true
//   ---
//   Body text with {{idea}} placeholders.
//
// The directory may not exist (yet); that simply yields no prompts.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { parse as parseYaml } from 'yaml';

import { logWarn } from './log';

/** One prompt argument (MCP `PromptArgument`). */
export interface PromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

/** A prompt loaded from disk. */
export interface PromptTemplate {
  name: string;
  description?: string;
  arguments: PromptArgument[];
  /** Template body with `{{argument}}` placeholders. */
  body: string;
  /** Source file (diagnostics). */
  file: string;
}

/** Frontmatter delimiter at the start of a file. */
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Recursively collects `*.md` files located directly inside a `prompts` directory. */
function findPromptFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) findPromptFiles(path, out);
    else if (entry.isFile() && extname(entry.name) === '.md' && basename(dir) === 'prompts') out.push(path);
  }
  return out;
}

/** Parses one prompt file; returns `null` (and warns) when it is malformed. */
export function parsePromptFile(file: string, text: string): PromptTemplate | null {
  let meta: Record<string, unknown> = {};
  let body = text;
  const match = FRONTMATTER_RE.exec(text);
  if (match) {
    try {
      meta = (parseYaml(match[1]!) as Record<string, unknown> | null) ?? {};
    } catch (error) {
      logWarn(`prompt ${file}: invalid frontmatter`, error);
      return null;
    }
    body = text.slice(match[0].length);
  }
  const args = Array.isArray(meta.arguments) ? meta.arguments : [];
  return {
    name: typeof meta.name === 'string' && meta.name ? meta.name : basename(file, '.md'),
    description: typeof meta.description === 'string' ? meta.description : undefined,
    arguments: args
      .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object' && typeof a.name === 'string')
      .map((a) => ({
        name: a.name as string,
        description: typeof a.description === 'string' ? a.description : undefined,
        required: a.required === true,
      })),
    body: body.trim(),
    file,
  };
}

/**
 * Loads all prompts under `skillsDir`. Re-read on every request so edits to
 * the skill docs show up without restarting the CLI. Duplicate names keep
 * the first file (sorted by path) and warn.
 */
export function loadPrompts(skillsDir: string): PromptTemplate[] {
  if (!existsSync(skillsDir) || !statSync(skillsDir).isDirectory()) return [];
  const prompts = new Map<string, PromptTemplate>();
  for (const file of findPromptFiles(skillsDir).sort()) {
    try {
      const prompt = parsePromptFile(file, readFileSync(file, 'utf8'));
      if (!prompt) continue;
      if (prompts.has(prompt.name)) {
        logWarn(`prompt "${prompt.name}" in ${file} duplicates ${prompts.get(prompt.name)!.file}; skipped`);
        continue;
      }
      prompts.set(prompt.name, prompt);
    } catch (error) {
      logWarn(`cannot read prompt ${file}`, error);
    }
  }
  return [...prompts.values()];
}

/**
 * Substitutes `{{name}}` placeholders. Throws when a required argument is
 * missing; unknown placeholders of optional arguments become empty strings.
 */
export function renderPrompt(prompt: PromptTemplate, args: Record<string, string> = {}): string {
  for (const arg of prompt.arguments) {
    if (arg.required && !args[arg.name]) throw new Error(`Missing required argument "${arg.name}"`);
  }
  const known = new Set(prompt.arguments.map((a) => a.name));
  return prompt.body.replace(/\{\{\s*([\w-]+)\s*\}\}/g, (placeholder, name: string) => {
    if (name in args) return args[name]!;
    return known.has(name) ? '' : placeholder;
  });
}
