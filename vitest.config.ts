/**
 * Vitest is configured separately from the build: the unit tests cover the pure
 * scanning helpers and never load the extension bundle, so this file stays free
 * of any build settings.
 */

import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		include: ['test/**/*.test.ts'],
		environment: 'node',
	},
})
