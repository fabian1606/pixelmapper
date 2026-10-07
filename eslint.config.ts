/**
 * ESLint flat config.
 *
 * Currently scoped to extensions (ADR §10): an extension may import only
 * `@pixelmapper/extension-api`, `vue`, `pinia` and its own files. Core
 * internals (`~/stores`, `~/utils`, `~/components`, …) and third-party
 * packages are rejected. Relative imports leaving the extension folder are
 * caught by `scripts/check-extensions.ts` (needs the file location).
 */
import tseslint from 'typescript-eslint';
import vueParser from 'vue-eslint-parser';

/** Message shown for forbidden imports. */
const MESSAGE
  = 'Extensions may only import @pixelmapper/extension-api, vue, pinia and their own files (ADR 0001 §5.1).';

export default tseslint.config(
  {
    files: ['extensions/**/*.{ts,vue}'],
    ignores: ['**/node_modules/**', '**/dist/**'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser,
        ecmaVersion: 'latest',
        sourceType: 'module',
        extraFileExtensions: ['.vue'],
      },
    },
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            // Any bare specifier or alias other than the allow-list. Relative
            // imports are allowed here; scripts/check-extensions.ts verifies
            // they stay inside the extension folder.
            regex: '^(?!(?:@pixelmapper/extension-api|vue|pinia)$)(?!\\.{1,2}/)',
            message: MESSAGE,
          },
        ],
      }],
    },
  },
);
