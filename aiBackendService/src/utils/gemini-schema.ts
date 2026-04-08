import { z } from "zod";

type JsonSchemaObject = Record<string, unknown>;

// Keys that Gemini's function declaration API does not support
const GEMINI_UNSUPPORTED_KEYS = [
  "$schema", "$defs", "$ref",
  "additionalProperties", "propertyNames",
  "unevaluatedProperties", "unevaluatedItems",
  "if", "then", "else",
  "not",
] as const;

/**
 * Recursively strips all Gemini-incompatible patterns from a JSON Schema tree:
 *  - `const: value` → `enum: [value]` (skip empty strings)
 *  - empty strings in `enum` arrays
 *  - flattens single-element `anyOf`/`oneOf` into the parent
 *  - removes unsupported keys: $schema, $defs, $ref, additionalProperties,
 *    propertyNames, unevaluatedProperties, if/then/else, not
 */
function deepCleanForGemini(js: JsonSchemaObject): JsonSchemaObject {
  // Remove all unsupported keys
  for (const key of GEMINI_UNSUPPORTED_KEYS) {
    delete js[key];
  }

  // `const: value` → `enum: [value]`
  if ("const" in js) {
    const value = js.const;
    delete js.const;
    if (value !== "") {
      js.enum = [value];
    }
  }

  // Filter empty strings from enums
  if (Array.isArray(js.enum)) {
    const filtered = (js.enum as unknown[]).filter((v) => v !== "");
    if (filtered.length > 0) {
      js.enum = filtered;
    } else {
      delete js.enum;
    }
  }

  // Recurse into anyOf / oneOf and flatten single-element arrays
  for (const key of ["anyOf", "oneOf"] as const) {
    if (!Array.isArray(js[key])) continue;
    const arr = (js[key] as JsonSchemaObject[]).map(deepCleanForGemini);
    // Remove sub-schemas that became empty (e.g. {const: ""} → {})
    const cleaned = arr.filter((s) => Object.keys(s).length > 0);
    if (cleaned.length === 0) {
      delete js[key];
    } else if (cleaned.length === 1) {
      delete js[key];
      Object.assign(js, cleaned[0]);
    } else {
      js[key] = cleaned;
    }
  }

  // Recurse into `properties`
  if (js.properties && typeof js.properties === "object") {
    for (const [prop, val] of Object.entries(js.properties as Record<string, unknown>)) {
      if (val && typeof val === "object") {
        (js.properties as Record<string, unknown>)[prop] = deepCleanForGemini(val as JsonSchemaObject);
      }
    }
  }

  // Convert `prefixItems` (JSON Schema draft 2020-12 tuples) → `items`
  // Gemini does not support prefixItems; collapse tuple schemas to a union of all item types.
  if (Array.isArray(js.prefixItems)) {
    const cleaned = (js.prefixItems as JsonSchemaObject[]).map(deepCleanForGemini);
    delete js.prefixItems;
    if (cleaned.length === 1) {
      js.items = cleaned[0];
    } else if (cleaned.length > 1) {
      js.items = { oneOf: cleaned };
    }
  }

  // Recurse into `items` (array schemas)
  if (js.items && typeof js.items === "object" && !Array.isArray(js.items)) {
    js.items = deepCleanForGemini(js.items as JsonSchemaObject);
  }

  return js;
}

/**
 * Converts any Zod schema to a Gemini-compatible JSON Schema object.
 *
 * Uses Zod v4's `z.toJSONSchema()` then deep-cleans the result to remove
 * all patterns that Gemini's function calling API rejects (`const`, empty
 * enum strings, `$ref`, `additionalProperties`, etc.).
 */
export function toGeminiJsonSchema(zodSchema: z.ZodTypeAny): JsonSchemaObject {
  const raw = z.toJSONSchema(zodSchema, {
    reused: "inline",
    unrepresentable: "any",
  }) as JsonSchemaObject;

  const cleaned = deepCleanForGemini(raw);

  // Zod v4 attaches a non-configurable `~standard` property to the output.
  // LangChain's `isSerializableSchema` detects this and re-converts via its
  // own `toJsonSchema()`, which reintroduces `const`. Return a plain copy
  // so the object is treated as a plain JSON Schema.
  return JSON.parse(JSON.stringify(cleaned));
}
