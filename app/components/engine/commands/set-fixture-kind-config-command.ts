import type { Json } from '@pixelmapper/extension-api';
import type { Fixture } from '~/utils/engine/core/fixture';
import { cloneJson, rebuildKindFixture } from '~/utils/kinds/kind-host';
import { type SerializableCommand, registerCommand } from './serializable-command';

/**
 * Replaces the config of a kind fixture and rebuilds it (ADR §5.8,
 * `setFixtureKindConfig`). Channels keep their programmed values where offset
 * and type match; the compiled cache is refreshed by the rebuild.
 */
export class SetFixtureKindConfigCommand implements SerializableCommand {
  readonly commandType = 'SetFixtureKindConfig';
  readonly description: string;
  private readonly before: Json;
  private readonly after: Json;

  constructor(
    private readonly fixtures: Fixture[],
    private readonly fixtureId: string | number,
    before: Json,
    after: Json,
    description = 'Edit Fixture',
  ) {
    this.before = cloneJson(before);
    this.after = cloneJson(after);
    this.description = description;
  }

  execute() { this.apply(this.after); }
  undo() { this.apply(this.before); }

  toPayload() {
    return { fixtureId: this.fixtureId, before: this.before, after: this.after, description: this.description };
  }

  /** Writes a config and rebuilds the fixture. */
  private apply(config: Json) {
    const f = this.fixtures.find(x => x.id === this.fixtureId);
    if (!f?.kind) return;
    f.kind.config = cloneJson(config);
    rebuildKindFixture(f);
  }
}

registerCommand('SetFixtureKindConfig', (payload, ctx) =>
  new SetFixtureKindConfigCommand(ctx.flatFixtures, payload.fixtureId, payload.before, payload.after, payload.description));
