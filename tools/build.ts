/**
 * Builds the extension into dist/ with Vite.
 *
 * Vite is driven through its JavaScript API rather than a vite.config.ts because
 * the entry points need different output formats and a single Vite build can only
 * emit one: the popup and the inspector are HTML pages with an ES module, the
 * service worker is one ES module, and the content script has to be a classic
 * script, because a content script cannot use `import` and there is no bootstrap
 * left to load a module on its behalf.
 *
 * Bundle names are deliberately unhashed and the manifest is copied rather than
 * rewritten, so the manifest that ships is exactly the file reviewed in
 * extension/.
 *
 * `dist/` is emptied in place and never deleted. Chrome running as a Flatpak app
 * is handed the directory through the document portal, which records the
 * directory itself rather than a path it can look up again: a build that
 * replaces `dist/` leaves the loaded extension pointing at a directory that no
 * longer exists, and Reload fails with "File path cannot be resolved. Could not
 * load manifest." Vite's `emptyOutDir` removes the entries inside the directory
 * and keeps the directory, which is what the first entry point asks for.
 */

import { cp, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, type BuildOptions, type InlineConfig } from 'vite'

import { exists } from './files.ts'

const rootDirectory = join(dirname(fileURLToPath(import.meta.url)), '..')
const extensionDirectory = join(rootDirectory, 'extension')
const outputDirectory = join(rootDirectory, 'dist')

/** Where each entry point lives, and which module format it has to be built as. */
const entryPoints: readonly { readonly entry: string; readonly format: 'es' | 'iife' }[] = [
	// The popup is an HTML entry, so Vite bundles its module and stylesheet and
	// rewrites the tags in the emitted copy.
	{ entry: 'popup/popup.html', format: 'es' },
	// The inspector is the second HTML entry, opened in its own tab.
	{ entry: 'inspect/inspect.html', format: 'es' },
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
 *
 * `emptyOutDir` is per entry because the four builds share one output directory:
 * Vite empties the directory as it enters a build, so only the first entry asks
 * for it and the other three would otherwise erase what it just wrote.
 */
function entryConfig(entry: string, format: 'es' | 'iife', emptyOutDir: boolean): InlineConfig {
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
			emptyOutDir,
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

/**
 * A directory's identity, as the filesystem sees it. A path is only a name:
 * deleting a directory and creating another one at the same path produces a
 * different identity, and that is what the Flatpak document portal will not
 * follow.
 */
async function directoryIdentity(path: string): Promise<string | null> {
	if (!(await exists(path))) return null

	// `dev` and `ino` are numbers; the identity is only ever compared as text.
	const stats = await stat(path)
	return [stats.dev, stats.ino].join(':')
}

/**
 * Fail loudly if the build replaced the output directory instead of emptying it.
 *
 * Emptying is what keeps a loaded extension reloadable: Chrome is given `dist/`
 * once, keeps a handle on that directory, and never re-resolves the path. A build
 * that deleted or recreated `dist/` would make every Reload report "File path
 * cannot be resolved" until the folder is picked again by hand.
 */
async function assertOutputDirectorySurvived(before: string | null): Promise<void> {
	const after = await directoryIdentity(outputDirectory)
	if (before === null || after === before) return

	throw new Error(
		`The build replaced ${outputDirectory} instead of emptying it. Chrome loses access ` +
			'to a directory that is deleted or recreated, so Reload would fail with "File path ' +
			'cannot be resolved". Delete the files inside dist/ and keep the directory itself.',
	)
}

async function main(): Promise<void> {
	const directoryBefore = await directoryIdentity(outputDirectory)

	// The first entry point empties the shared output directory; see entryConfig.
	for (const [index, { entry, format }] of entryPoints.entries()) {
		await build(entryConfig(entry, format, index === 0))
	}

	await copyStaticFiles()
	await assertOutputDirectorySurvived(directoryBefore)

	if (!watching) console.log(`Built the extension into ${outputDirectory}`)
}

await main()
