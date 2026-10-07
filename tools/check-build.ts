/**
 * Checks the built extension in dist/ before it is packaged for the Web Store.
 *
 * Everything here is a mistake that would either stop the extension from loading
 * or get it rejected during review, and none of them are visible in the source:
 * a manifest that points at a file the build never wrote, a content script that
 * came out as a module (a classic content script cannot parse `import`), an icon
 * that is not the size the manifest claims, or a banned construct under the MV3
 * content security policy.
 */

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { asObject, asStrings, exists, listFiles, readJsonObject, type JsonObject } from './files.ts'

const rootDirectory = join(dirname(fileURLToPath(import.meta.url)), '..')
const outputDirectory = join(rootDirectory, 'dist')

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** MV3 forbids remotely hosted code, and these are the shapes it takes. */
const bannedScriptPatterns: readonly { readonly pattern: RegExp; readonly description: string }[] = [
	{ pattern: /\beval\s*\(/, description: 'eval()' },
	{ pattern: /\bnew\s+Function\s*\(/, description: 'new Function()' },
	{ pattern: /\bimport\s*\(\s*["'`]https?:/, description: 'a dynamic import of a remote URL' },
]

/** A content script is a classic script, so module syntax would be a parse error. */
const moduleSyntaxPattern = /^\s*(?:import\s|export\s)/m

/**
 * Files the build must write even though the manifest never names them.
 *
 * `referencedFiles` above only proves that what the manifest points at exists, so
 * a page opened with `chrome.tabs.create` — the inspector — could vanish from the
 * build without a single check noticing.
 */
const unmanifestedFiles: readonly string[] = ['inspect/inspect.html', 'inspect/inspect.js']

/** Every problem found, so one run reports all of them instead of only the first. */
const problems: string[] = []

function check(condition: boolean, message: string): void {
	if (!condition) problems.push(message)
}

/** Every file path the manifest points at. */
function referencedFiles(manifest: JsonObject): string[] {
	const paths = new Set<string>()
	const add = (values: readonly string[]): void => {
		for (const value of values) paths.add(value)
	}

	const background = asObject(manifest.background)
	if (background !== null) add(asStrings(background.service_worker))

	const action = asObject(manifest.action)
	if (action !== null) {
		add(asStrings(action.default_popup))
		add(Object.values(asObject(action.default_icon) ?? {}).filter(isString))
	}

	add(Object.values(asObject(manifest.icons) ?? {}).filter(isString))

	if (Array.isArray(manifest.content_scripts)) {
		for (const entry of manifest.content_scripts) {
			const script = asObject(entry)
			if (script === null) continue
			add(asStrings(script.js))
			add(asStrings(script.css))
		}
	}

	if (Array.isArray(manifest.web_accessible_resources)) {
		for (const entry of manifest.web_accessible_resources) {
			// Globs are not literal paths, so only the plain ones are checked here.
			add(asStrings(entry).filter((path) => !path.includes('*')))

			const resource = asObject(entry)
			if (resource !== null) add(asStrings(resource.resources).filter((path) => !path.includes('*')))
		}
	}

	return [...paths]
}

function isString(value: unknown): value is string {
	return typeof value === 'string'
}

/** Every icon the manifest declares, as the path it points at and the size it claims. */
function declaredIcons(manifest: JsonObject): { readonly path: string; readonly size: number }[] {
	const action = asObject(manifest.action)
	const groups = [manifest.icons, action?.default_icon]

	return groups.flatMap((group) =>
		Object.entries(asObject(group) ?? {}).flatMap(([size, path]) =>
			typeof path === 'string' ? [{ path, size: Number(size) }] : [],
		),
	)
}

/**
 * A PNG is an eight byte signature followed by the IHDR chunk, whose first two
 * fields are the width and the height. Reading them catches an icon that was
 * replaced with the wrong size, which Chrome would otherwise accept silently.
 */
async function checkIcon(path: string, size: number): Promise<void> {
	const file = join(outputDirectory, path)

	// A missing file is already reported as an unreferenced manifest entry.
	if (!(await exists(file))) return

	const png = await readFile(file)
	check(png.subarray(0, 8).equals(pngSignature), `${path} is not a PNG file`)
	if (!png.subarray(0, 8).equals(pngSignature)) return

	const width = png.readUInt32BE(16)
	const height = png.readUInt32BE(20)
	check(
		width === size && height === size,
		`${path} is ${String(width)}x${String(height)} but the manifest declares it as ${String(size)}x${String(size)}`,
	)
}

function checkScriptIsLocal(path: string, source: string): void {
	for (const { pattern, description } of bannedScriptPatterns) {
		check(!pattern.test(source), `${path} contains ${description}, which the extension CSP forbids`)
	}
}

async function main(): Promise<void> {
	if (!(await exists(outputDirectory))) {
		throw new Error('dist/ does not exist. Run `npm run build` first.')
	}

	const manifest = await readJsonObject(join(outputDirectory, 'manifest.json'))
	const packageJson = await readJsonObject(join(rootDirectory, 'package.json'))

	check(
		manifest.version === packageJson.version,
		`manifest version ${String(manifest.version)} does not match package.json ${String(packageJson.version)}`,
	)

	for (const path of referencedFiles(manifest)) {
		check(
			await exists(join(outputDirectory, path)),
			`manifest.json points at ${path}, which the build did not write`,
		)
	}

	for (const path of unmanifestedFiles) {
		check(await exists(join(outputDirectory, path)), `the build did not write ${path}`)
	}

	for (const icon of declaredIcons(manifest)) {
		await checkIcon(icon.path, icon.size)
	}

	const files = await listFiles(outputDirectory)

	for (const file of files) {
		const path = file.slice(outputDirectory.length + 1)

		if (path.endsWith('.js')) {
			const source = await readFile(file, 'utf8')
			checkScriptIsLocal(path, source)
			check(source.trim().length > 0, `${path} is empty`)

			if (path.startsWith('content/')) {
				check(
					!moduleSyntaxPattern.test(source),
					`${path} uses ES module syntax, but a content script is loaded as a classic script and would fail to parse`,
				)
			}
		}

		if (path.endsWith('.html')) {
			const html = await readFile(file, 'utf8')
			check(
				!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html),
				`${path} has an inline <script>, which the extension CSP forbids`,
			)
			check(
				!/<script[^>]+src=["'](?:https?:)?\/\//i.test(html),
				`${path} loads a script from another origin, which the extension CSP forbids`,
			)
		}
	}

	if (problems.length > 0) {
		console.error(`The built extension has ${String(problems.length)} problem(s):`)
		for (const problem of problems) console.error(`  - ${problem}`)
		process.exitCode = 1
		return
	}

	console.log(`Checked ${String(files.length)} files in dist/: the extension is ready to package.`)
}

await main()
