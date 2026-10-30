// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { reactive } from 'vue';
import { deepClone, deepEqual, isEntityId, isPlainObject } from './values';

/** Unit tests of the value helpers used by the 3-way merge. */

describe('deepEqual', () => {
  // [a, b, expected]
  const cases: Array<[unknown, unknown, boolean]> = [
    [1, 1, true],
    [1, 2, false],
    ['a', 'a', true],
    [null, null, true],
    [null, undefined, false],
    [Number.NaN, Number.NaN, true],
    [[1, 2], [1, 2], true],
    [[1, 2], [2, 1], false],
    [[1], [1, 1], false],
    [{ a: 1, b: { c: [1] } }, { b: { c: [1] }, a: 1 }, true],
    [{ a: 1 }, { a: 1, b: undefined }, true],
    [{ a: 1 }, { a: 1, b: null }, false],
    [{ a: [] }, { a: {} }, false],
    [[], {}, false],
    [1, '1', false],
  ];
  it.each(cases)('deepEqual(%j, %j) = %s', (a, b, expected) => {
    expect(deepEqual(a, b)).toBe(expected);
    expect(deepEqual(b, a)).toBe(expected);
  });
});

describe('deepClone', () => {
  it('clones nested data without aliasing', () => {
    const src = { a: { b: [1, { c: 2 }] } };
    const copy = deepClone(src);
    expect(copy).toEqual(src);
    expect(copy.a).not.toBe(src.a);
    expect(copy.a.b).not.toBe(src.a.b);
    expect(copy.a.b[1]).not.toBe(src.a.b[1]);
  });

  it('drops undefined entries', () => {
    expect(Object.keys(deepClone({ a: 1, b: undefined }))).toEqual(['a']);
  });

  it('works on Vue reactive proxies', () => {
    const src = reactive({ list: [{ id: 'x', v: 1 }] });
    const copy = deepClone(src);
    expect(copy).toEqual({ list: [{ id: 'x', v: 1 }] });
    copy.list[0]!.v = 2;
    expect(src.list[0]!.v).toBe(1);
  });
});

describe('guards', () => {
  it('detects plain objects', () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject(Object.create(null))).toBe(true);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(new Date())).toBe(false);
    expect(isPlainObject(null)).toBe(false);
  });

  it('accepts string and number ids only', () => {
    expect(isEntityId('a')).toBe(true);
    expect(isEntityId(0)).toBe(true);
    expect(isEntityId('')).toBe(false);
    expect(isEntityId(Number.NaN)).toBe(false);
    expect(isEntityId(null)).toBe(false);
    expect(isEntityId({})).toBe(false);
  });
});
