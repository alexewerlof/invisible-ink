/**
 * Filesystem and JSON helpers shared by the tools in this directory.
 *
 * The tools read files this repository generates rather than files it compiles, so
 * values arrive as `unknown` and every field has to be narrowed before it can be
 * used. Keeping that in one place means each tool is only its own logic.
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

/** A parsed JSON object, whose fields are still `unknown`. */
export type JsonObject = Record<string, unknown>

/** Is there something at this path? */
export async function exists(path: string): Promise<boolean> {
	try {
		await stat(path)
		return true
	} catch {
		return false
	}
}

/**
 * Every file under a directory, sorted.
 *
 * The order is part of the contract: the packaging tool writes these paths into an
 * archive, and a stable order keeps a rebuilt archive identical to the last one.
 */
export async function listFiles(directory: string): Promise<string[]> {
	const entries = await readdir(directory, { withFileTypes: true })

	const nested = await Promise.all(
		entries.map((entry) => {
			const path = join(directory, entry.name)
			return entry.isDirectory() ? listFiles(path) : Promise.resolve([path])
		}),
	)

	return nested.flat().sort()
}

/** Read a JSON file, failing with the file name rather than a bare parse error. */
export async function readJsonObject(path: string): Promise<JsonObject> {
	const text = await readFile(path, 'utf8')

	let parsed: unknown
	try {
		parsed = JSON.parse(text)
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error)
		throw new Error(`${path} is not valid JSON: ${reason}`, { cause: error })
	}

	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		throw new Error(`${path} does not contain a JSON object.`)
	}

	return parsed as JsonObject
}

/** Narrow a value to a JSON object, or `null` when it is anything else. */
export function asObject(value: unknown): JsonObject | null {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
	return value as JsonObject
}

/** Every string in an array value, ignoring anything that is not one. */
export function asStrings(value: unknown): string[] {
	if (!Array.isArray(value)) return []
	return value.filter((item): item is string => typeof item === 'string')
}
