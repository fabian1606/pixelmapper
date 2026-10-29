/**
 * Actors (ADR 0002 D9, D13).
 *
 * Every change and every event is attributed to the actor that caused it:
 * the local user, an agent run, a remote collaborator or an extension.
 */
import { z } from 'zod';

// ── Type ────────────────────────────────────────

/** Who caused a change: `user`, `agent:<id>`, `collaborator:<id>` or `extension:<id>`. */
export type Actor = 'user' | `agent:${string}` | `collaborator:${string}` | `extension:${string}`;

/** Actor kinds (the part before the first `:`). */
export type ActorKind = 'user' | 'agent' | 'collaborator' | 'extension';

/** Pattern of a valid actor string. */
const ACTOR_PATTERN = /^(user|(agent|collaborator|extension):.+)$/;

/** Zod schema of an actor string. */
export const ActorSchema = z
  .string()
  .regex(ACTOR_PATTERN, 'actor must be "user", "agent:<id>", "collaborator:<id>" or "extension:<id>"')
  .describe('Who caused a change: "user", "agent:<id>", "collaborator:<id>" or "extension:<id>".') as unknown as z.ZodType<Actor>;

// ── Helpers ─────────────────────────────────────

/** True when `value` is a valid actor string. */
export function isActor(value: unknown): value is Actor {
  return typeof value === 'string' && ACTOR_PATTERN.test(value);
}

/** Kind of an actor (`agent:mcp:claude` → `agent`). */
export function actorKind(actor: Actor): ActorKind {
  const i = actor.indexOf(':');
  return (i < 0 ? actor : actor.slice(0, i)) as ActorKind;
}

/** Builds an agent actor (`agentActor('mcp:claude')` → `agent:mcp:claude`). */
export function agentActor(id: string): Actor {
  return `agent:${id}`;
}
