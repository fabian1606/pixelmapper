import { CustomFixtureFormSchema } from "../app/utils/engine/custom-fixture-types.ts";
import { toGeminiJsonSchema } from "./src/utils/gemini-schema.ts";

const schema = toGeminiJsonSchema(CustomFixtureFormSchema);
console.log(JSON.stringify(schema.properties.dmxConnector, null, 2));
