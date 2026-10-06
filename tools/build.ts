/**
 * Builds the extension into dist/ with Vite.
 *
 * Vite is driven through its JavaScript API rather than a vite.config.ts because
 * the three entry points need three different output formats and a single Vite
 * build can only emit one: the popup is an HTML page with an ES module, the
 * service worker is one ES module, and the content script has to be a classic
 * script, because a content script cannot use `import` and there is no bootstrap
 * left to load a module on its behalf.
 *
 * Bundle names are deliberately unhashed and the manifest is copied rather than
 * rewritten, so the manifest that ships is exactly the file reviewed in
 * extension/.
 */

import { cp, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, type BuildOptions, type InlineConfig } from 'vite'

const rootDirectory = join(dirname(fileURLToPath(import.meta.url)), '..')
const extensionDirectory = join(rootDirectory, 'extension')
const outputDirectory = join(rootDirectory, 'dist')

/** Where each entry point lives, and which module format it has to be built as. */
const entryPoints: readonly { readonly entry: string; readonly format: 'es' | 'iife' }[] = [
	// The popup is an HTML entry, so Vite bundles its module and stylesheet and
	// rewrites the tags in the emitted copy.
	{ entry: 'popup/popup.html', format: 'es' },
	// The manifest declares this worker as a module.
	{ entry: 'background/service-worker.ts', format: 'es' },
	// A classic script cannot contain `import`, so this one is bundled as an IIFE.
	{ entry: 'content/hidden-character-detector.ts', format: 'iife' },
]

/** Kept in step with `minimum_chrome_version` in the manifest. */
const buildTarget = 'chrome119'

const watching = process.argv.includes('--watch')

const buildOptions: BuildOptions = {
	outDir: outputDirectory,
	// The builds share one output directory, so main() does the clean.
	emptyOutDir: false,
	target: buildTarget,
	sourcemap: false,
	// The shipped code stays readable: the extension is small enough that a
	// reviewer can read exactly what Chrome will run.
	minify: false,
	reportCompressedSize: false,
}

if (watching) buildOptions.watch = {}

/**
 * Turn one entry point into a single file at the same path inside dist/, which is
 * what lets the manifest be copied instead of rewritten.
 */
function entryConfig(entry: string, format: 'es' | 'iife'): InlineConfig {
	return {
		configFile: false,
		root: extensionDirectory,
		publicDir: false,
		logLevel: 'warn',
		// Absolute URLs are unambiguous for an extension page, whose origin root is
		// the extension itself. Relative ones would depend on how deep Vite happens
		// to think the emitted HTML sits.
		base: '/',
		build: {
			...buildOptions,
			rollupOptions: {
				input: { [entry.replace(/\.[^.]+$/, '')]: join(extensionDirectory, entry) },
				output: {
					format,
					entryFileNames: '[name].js',
					chunkFileNames: '[name].js',
					assetFileNames: 'assets/[name][extname]',
				},
			},
		},
	}
}

/**
 * The files Vite has no reason to touch: the manifest, the stylesheet the manifest
 * injects, and the icons. They are copied byte for byte.
 *
 * Watch mode copies them once, so restart the build after editing them.
 */
async function copyStaticFiles(): Promise<void> {
	await cp(join(extensionDirectory, 'manifest.json'), join(outputDirectory, 'manifest.json'))
	await cp(
		join(extensionDirectory, 'content/hidden-character-marks.css'),
		join(outputDirectory, 'content/hidden-character-marks.css'),
	)
	await cp(join(extensionDirectory, 'icons'), join(outputDirectory, 'icons'), { recursive: true })
}

async function main(): Promise<void> {
	await rm(outputDirectory, { recursive: true, force: true })

	for (const { entry, format } of entryPoints) {
		await build(entryConfig(entry, format))
	}

	await copyStaticFiles()

	if (!watching) console.log(`Built the extension into ${outputDirectory}`)
}

await main()
