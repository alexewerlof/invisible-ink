/**
 * Packages the built extension into release/<package name>-<version>.zip.
 *
 * Chrome's "pack extension" and the Web Store both want a plain zip of the
 * unpacked extension. The format is small enough to write directly: a header and
 * deflated data per file, a central directory, and an end record. Writing it here
 * keeps the toolchain at one build dependency plus a test runner, and the
 * timestamps are fixed so that rebuilding the same sources produces the same
 * archive.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32, deflateRawSync } from 'node:zlib'

import { listFiles, readJsonObject } from './files.ts'

const rootDirectory = join(dirname(fileURLToPath(import.meta.url)), '..')
const outputDirectory = join(rootDirectory, 'dist')
const releaseDirectory = join(rootDirectory, 'release')

const localHeaderSize = 30
const centralHeaderSize = 46
const endOfCentralDirectorySize = 22

/** The UTF-8 name flag. Every name here is ASCII, but the flag is honest anyway. */
const utf8NameFlag = 0x0800
const deflateMethod = 8
const versionNeeded = 20

/** 1980-01-01, the earliest date the zip format can express. */
const dosDate = (1 << 5) | 1
const dosTime = 0

/** A regular file, read/write for its owner, in the Unix mode field. */
const fileMode = (0o100644 << 16) >>> 0

interface ZipEntry {
	readonly name: string
	readonly data: Buffer
}

interface CompressedEntry {
	readonly name: string
	readonly uncompressed: Buffer
	readonly compressed: Buffer
	readonly checksum: number
	/** Where this entry's local header starts in the finished archive. */
	readonly offset: number
}

function createLocalRecord(item: CompressedEntry): Buffer {
	const name = Buffer.from(item.name, 'utf8')
	const header = Buffer.alloc(localHeaderSize)

	header.writeUInt32LE(0x04034b50, 0)
	header.writeUInt16LE(versionNeeded, 4)
	header.writeUInt16LE(utf8NameFlag, 6)
	header.writeUInt16LE(deflateMethod, 8)
	header.writeUInt16LE(dosTime, 10)
	header.writeUInt16LE(dosDate, 12)
	header.writeUInt32LE(item.checksum, 14)
	header.writeUInt32LE(item.compressed.length, 18)
	header.writeUInt32LE(item.uncompressed.length, 22)
	header.writeUInt16LE(name.length, 26)
	header.writeUInt16LE(0, 28) // extra field length

	return Buffer.concat([header, name, item.compressed])
}

function createCentralHeader(item: CompressedEntry): Buffer {
	const name = Buffer.from(item.name, 'utf8')
	const header = Buffer.alloc(centralHeaderSize)

	header.writeUInt32LE(0x02014b50, 0)
	header.writeUInt16LE(versionNeeded, 4) // version made by
	header.writeUInt16LE(versionNeeded, 6) // version needed to extract
	header.writeUInt16LE(utf8NameFlag, 8)
	header.writeUInt16LE(deflateMethod, 10)
	header.writeUInt16LE(dosTime, 12)
	header.writeUInt16LE(dosDate, 14)
	header.writeUInt32LE(item.checksum, 16)
	header.writeUInt32LE(item.compressed.length, 20)
	header.writeUInt32LE(item.uncompressed.length, 24)
	header.writeUInt16LE(name.length, 28)
	header.writeUInt16LE(0, 30) // extra field length
	header.writeUInt16LE(0, 32) // comment length
	header.writeUInt16LE(0, 34) // disk number
	header.writeUInt16LE(0, 36) // internal attributes
	header.writeUInt32LE(fileMode, 38)
	header.writeUInt32LE(item.offset, 42)

	return Buffer.concat([header, name])
}

function createEndOfCentralDirectory(count: number, directorySize: number, directoryOffset: number): Buffer {
	const record = Buffer.alloc(endOfCentralDirectorySize)

	record.writeUInt32LE(0x06054b50, 0)
	record.writeUInt16LE(0, 4) // this disk
	record.writeUInt16LE(0, 6) // disk the directory starts on
	record.writeUInt16LE(count, 8)
	record.writeUInt16LE(count, 10)
	record.writeUInt32LE(directorySize, 12)
	record.writeUInt32LE(directoryOffset, 16)
	record.writeUInt16LE(0, 20) // comment length

	return record
}

function createArchive(entries: readonly ZipEntry[]): Buffer {
	const compressed: CompressedEntry[] = []
	let offset = 0

	for (const entry of entries) {
		const data = deflateRawSync(entry.data, { level: 9 })

		compressed.push({
			name: entry.name,
			uncompressed: entry.data,
			compressed: data,
			checksum: crc32(entry.data),
			offset,
		})

		offset += localHeaderSize + Buffer.byteLength(entry.name) + data.length
	}

	const directory = Buffer.concat(compressed.map(createCentralHeader))

	return Buffer.concat([
		...compressed.map(createLocalRecord),
		directory,
		createEndOfCentralDirectory(compressed.length, directory.length, offset),
	])
}

/** Zip names always use forward slashes, whatever the platform path separator is. */
function toArchivePath(path: string): string {
	return path.split(sep).join('/')
}

async function main(): Promise<void> {
	const manifest = await readJsonObject(join(outputDirectory, 'manifest.json'))
	const version = manifest.version
	if (typeof version !== 'string') throw new Error('dist/manifest.json has no "version" string.')

	// The archive is named after the package, so `npm run deploy-check` and the
	// store upload agree on the file name without a second literal to keep in step.
	const packageJson = await readJsonObject(join(rootDirectory, 'package.json'))
	const packageName = packageJson.name
	if (typeof packageName !== 'string') throw new Error('package.json has no "name" string.')

	const files = await listFiles(outputDirectory)
	const entries: ZipEntry[] = []

	for (const file of files) {
		entries.push({ name: toArchivePath(relative(outputDirectory, file)), data: await readFile(file) })
	}

	const archive = createArchive(entries)
	const archivePath = join(releaseDirectory, `${packageName}-${version}.zip`)

	await mkdir(releaseDirectory, { recursive: true })
	await writeFile(archivePath, archive)

	console.log(
		`Packaged ${String(entries.length)} files as ${toArchivePath(relative(rootDirectory, archivePath))} (${String(archive.length)} bytes)`,
	)
}

await main()
