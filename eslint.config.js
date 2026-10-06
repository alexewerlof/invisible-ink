// @ts-check

/**
 * One flat config for the whole repository.
 *
 * `strictTypeChecked` and `stylisticTypeChecked` are the opinionated supersets of
 * typescript-eslint's recommended rules; they are enabled as-is and the source is
 * written to satisfy them, so there are no per-rule overrides below. The only
 * extra config is `eslint-config-prettier`, which switches off the rules that
 * would otherwise fight Prettier over formatting.
 */

import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import { defineConfig, globalIgnores } from 'eslint/config'
import tseslint from 'typescript-eslint'

export default defineConfig(
	// Build output and the release archive are generated, so they are not linted.
	globalIgnores(['dist/', 'release/', 'coverage/']),

	{
		files: ['**/*.ts'],
		extends: [
			js.configs.recommended,
			tseslint.configs.strictTypeChecked,
			tseslint.configs.stylisticTypeChecked,
			prettier,
		],
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},

	{
		// This file and any other plain JavaScript, linted without type information.
		files: ['**/*.js'],
		extends: [js.configs.recommended, prettier],
	},
)
