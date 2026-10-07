import { describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick, shallowRef, type Ref } from 'vue';
import { mount } from '@vue/test-utils';
import type { FixtureView, ProjectInfo, ScopeRef, SelectionInfo } from '@pixelmapper/extension-api';
import { provideScope } from './provide-scope';
import { useScope, useScopeSnapshot } from './use-scope';

/** Minimal fixture view for tests. */
function fixture(id: string, name = id): FixtureView {
  return {
    id, name, startAddress: 1, universe: 1, localAddress: 1,
    position: { x: 0, y: 0 }, size: { x: 1, y: 1 }, rotation: 0, positionZ: 0,
    manufacturer: '', fixtureType: '', channels: [], beams: [],
  };
}

/** Component that provides one scope and renders its default slot. */
function provider(provideFn: () => void) {
  return defineComponent({
    setup(_, { slots }) {
      provideFn();
      return () => h('div', slots.default?.());
    },
  });
}

describe('scope system', () => {
  it('inherits scopes across three levels', () => {
    let seenProject: ScopeRef<'project'> | undefined;
    let seenSelection: ScopeRef<'selection'> | undefined;
    let seenFixture: ScopeRef<'fixture'> | undefined;

    const L1 = provider(() => provideScope('project', shallowRef<ProjectInfo>({ id: 'p', name: 'P', bpm: 120, requires: [] })));
    const L2 = provider(() => provideScope('selection', shallowRef<SelectionInfo>({ fixtureIds: [1], nodeIds: [1] })));
    const L3 = provider(() => provideScope('fixture', shallowRef(fixture('f1'))));
    const Leaf = defineComponent({
      setup() {
        seenProject = useScope('project');
        seenSelection = useScope('selection');
        seenFixture = useScope('fixture');
        return () => null;
      },
    });

    mount(() => h(L1, () => h(L2, () => h(L3, () => h(Leaf)))));
    expect(seenProject!.value?.name).toBe('P');
    expect(seenSelection!.value?.fixtureIds).toEqual([1]);
    expect(seenFixture!.value?.id).toBe('f1');
  });

  it('nested providers shadow outer ones only for that scope', () => {
    let inner: ScopeRef<'fixture'> | undefined;
    let innerProject: ScopeRef<'project'> | undefined;
    let outer: ScopeRef<'fixture'> | undefined;

    const Outer = provider(() => {
      provideScope('fixture', shallowRef(fixture('outer')));
      provideScope('project', shallowRef<ProjectInfo>({ id: 'p', name: 'P', bpm: 120, requires: [] }));
    });
    const Inner = provider(() => provideScope('fixture', shallowRef(fixture('inner'))));
    const ReadInner = defineComponent({
      setup() {
        inner = useScope('fixture');
        innerProject = useScope('project');
        return () => null;
      },
    });
    const ReadOuter = defineComponent({
      setup() {
        outer = useScope('fixture');
        return () => null;
      },
    });

    mount(() => h(Outer, () => [h(Inner, () => h(ReadInner)), h(ReadOuter)]));
    expect(inner!.value?.id).toBe('inner');
    expect(innerProject!.value?.id).toBe('p');
    expect(outer!.value?.id).toBe('outer');
  });

  it('returns undefined for scopes nobody provides', () => {
    let seen: ScopeRef<'modifier'> | undefined;
    mount(defineComponent({
      setup() {
        seen = useScope('modifier');
        return () => null;
      },
    }));
    expect(seen!.value).toBeUndefined();
  });

  it('views are readonly: mutation attempts throw in dev', () => {
    let seen: ScopeRef<'fixture'> | undefined;
    const P = provider(() => provideScope('fixture', shallowRef(fixture('f1'))));
    const Leaf = defineComponent({
      setup() {
        seen = useScope('fixture');
        return () => null;
      },
    });
    mount(() => h(P, () => h(Leaf)));

    const view = seen!.value as unknown as FixtureView;
    expect(() => { view.name = 'hacked'; }).toThrow(TypeError);
    expect(() => { view.position.x = 5; }).toThrow(TypeError);
    expect(() => { view.channels.push({} as never); }).toThrow(TypeError);
  });

  it('views update reactively and snapshots unwrap them', async () => {
    const source: Ref<FixtureView> = shallowRef(fixture('f1', 'One'));
    let snapshot: ReturnType<typeof useScopeSnapshot> | undefined;
    const P = provider(() => provideScope('fixture', source));
    const Leaf = defineComponent({
      setup() {
        snapshot = useScopeSnapshot();
        return () => null;
      },
    });
    mount(() => h(P, () => h(Leaf)));

    expect(snapshot!.value.fixture?.name).toBe('One');
    source.value = fixture('f1', 'Two');
    await nextTick();
    expect(snapshot!.value.fixture?.name).toBe('Two');
    expect(snapshot!.value.project).toBeUndefined();
  });
});
