/**
 * Budget instrumentation (ADR D7, §6.7).
 *
 * Browser WebAssembly has no fuel metering, so the toolchain rewrites the
 * compiled module: every function entry and every loop iteration calls the
 * imported `pm.budget()`. The host counts these calls per `pm_render` and
 * traps beyond a limit, turning infinite loops into catchable errors.
 *
 * Implemented as a Binaryen pass over the compiled binary (simpler and more
 * robust than an AssemblyScript AST transform): read → walk expressions →
 * wrap loop bodies / function bodies → validate → emit.
 */
import binaryen from 'binaryen';

/** Runtime helper namespaces of binaryen.js missing from its typings. */
const B = binaryen as unknown as typeof binaryen & {
  Loop: { getBody(expr: number): number; setBody(expr: number, body: number): void };
  Function: { getBody(fn: number): number; setBody(fn: number, body: number): void };
};

/** Internal name of the injected import. */
const BUDGET = '~pm_budget';

/** Fields of `getExpressionInfo` that hold child expressions. */
const CHILD_FIELDS = [
  'condition', 'ifTrue', 'ifFalse', 'body', 'value', 'ptr', 'left', 'right', 'delta',
  'expected', 'replacement', 'timeout', 'notifyCount', 'vec', 'a', 'b', 'c', 'shift',
  'dest', 'source', 'size', 'tuple', 'ref', 'target',
] as const;
/** Fields holding arrays of child expressions. */
const CHILD_ARRAY_FIELDS = ['children', 'operands', 'catchBodies', 'values'] as const;

/** Expression ids without child expressions. */
const LEAF_IDS = new Set<number>([
  binaryen.NopId, binaryen.UnreachableId, binaryen.ConstId, binaryen.LocalGetId,
  binaryen.GlobalGetId, binaryen.MemorySizeId, binaryen.AtomicFenceId, binaryen.DataDropId,
  binaryen.RefNullId, binaryen.RefFuncId,
].filter((v): v is number => typeof v === 'number'));

/** Collects every Loop expression below `root` (iterative DFS). */
function findLoops(root: number): number[] {
  const loops: number[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const expr = stack.pop()!;
    if (!expr) continue;
    const id = binaryen.getExpressionId(expr);
    // Leaves: no children, and numeric info fields are literals/indices.
    // (binaryen.js' getExpressionInfo also throws for Unreachable.)
    if (LEAF_IDS.has(id)) continue;
    const info = binaryen.getExpressionInfo(expr) as unknown as (Record<string, unknown> & { id: number }) | undefined;
    if (!info) continue;
    if (id === binaryen.LoopId) loops.push(expr);
    for (const f of CHILD_FIELDS) {
      const v = info[f];
      // Call.target is a function name (string); only numbers are expressions.
      if (typeof v === 'number' && v !== 0) stack.push(v);
    }
    if (info.id === binaryen.MemoryInitId && typeof info.offset === 'number') stack.push(info.offset);
    for (const f of CHILD_ARRAY_FIELDS) {
      const arr = info[f];
      if (Array.isArray(arr)) for (const c of arr) if (typeof c === 'number' && c !== 0) stack.push(c);
    }
  }
  return loops;
}

/** Wraps `expr` as `block { call budget; expr }` keeping its type. */
function withBudget(mod: binaryen.Module, expr: number): number {
  const type = binaryen.getExpressionType(expr);
  return mod.block(null, [mod.call(BUDGET, [], binaryen.none), expr], type);
}

/** Result of `instrument`. */
export interface InstrumentResult {
  wasm: Uint8Array;
  /** Number of instrumented functions and loops. */
  functions: number;
  loops: number;
}

/** Injects `pm.budget()` at function entries and loop back-edges. */
export function instrument(wasm: Uint8Array): InstrumentResult {
  const mod = binaryen.readBinary(wasm);
  try {
    // AssemblyScript emits bulk-memory, sign-ext etc.; allow what the input uses.
    mod.setFeatures(binaryen.Features.All);
    mod.addFunctionImport(BUDGET, 'pm', 'budget', binaryen.none, binaryen.none);
    let functions = 0;
    let loops = 0;
    const count = mod.getNumFunctions();
    for (let i = 0; i < count; i++) {
      const fn = mod.getFunctionByIndex(i);
      const info = binaryen.getFunctionInfo(fn);
      if (info.module || !info.body || info.name === BUDGET) continue; // imports
      for (const loop of findLoops(info.body)) {
        B.Loop.setBody(loop, withBudget(mod, B.Loop.getBody(loop)));
        loops++;
      }
      B.Function.setBody(fn, withBudget(mod, B.Function.getBody(fn)));
      functions++;
    }
    if (!mod.validate()) throw new Error('instrumented module failed validation');
    return { wasm: mod.emitBinary(), functions, loops };
  }
  finally {
    mod.dispose();
  }
}
