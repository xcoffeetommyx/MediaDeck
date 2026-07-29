import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';

import { addonIdSchema, addonVersionSchema } from '@mediadeck/contracts';
import { z } from 'zod';

import { IncompatibleAddonError, InvalidAddonError } from './domain-errors.js';

const endOfCentralDirectorySignature = 0x06054b50;
const centralDirectorySignature = 0x02014b50;
const localFileSignature = 0x04034b50;
const maximumManifestBytes = 1024 * 1024;
const maximumEntries = 4096;

type ZipEntry = {
  compressedSize: number;
  compressionMethod: number;
  flags: number;
  localHeaderOffset: number;
  name: string;
  uncompressedSize: number;
};

const geckoSettingsSchema = z
  .object({
    id: addonIdSchema.optional(),
    strict_max_version: z.string().min(1).max(64).optional(),
    strict_min_version: z.string().min(1).max(64).optional(),
  })
  .passthrough();

const manifestSchema = z
  .object({
    applications: z
      .object({
        gecko: geckoSettingsSchema.optional(),
      })
      .passthrough()
      .optional(),
    browser_specific_settings: z
      .object({
        gecko: geckoSettingsSchema.optional(),
      })
      .passthrough()
      .optional(),
    host_permissions: z.array(z.string().min(1).max(255)).max(256).optional(),
    manifest_version: z.union([z.literal(2), z.literal(3)]),
    name: z.string().min(1).max(128),
    permissions: z.array(z.string().min(1).max(255)).max(256).optional(),
    theme: z.unknown().optional(),
    version: addonVersionSchema,
  })
  .passthrough();

export type InspectedXpi = {
  id: string;
  maxFirefoxVersion: string | null;
  minFirefoxVersion: string | null;
  name: string;
  permissions: string[];
  sha256: string;
  version: string;
};

function findEndOfCentralDirectory(packageBytes: Buffer): number {
  const minimum = Math.max(0, packageBytes.length - 65_557);
  for (let offset = packageBytes.length - 22; offset >= minimum; offset -= 1) {
    if (packageBytes.readUInt32LE(offset) === endOfCentralDirectorySignature) {
      return offset;
    }
  }
  throw new InvalidAddonError('The XPI does not contain a valid ZIP directory');
}

function safeEntryName(name: string): void {
  if (
    !name ||
    name.includes('\0') ||
    name.includes('\\') ||
    name.startsWith('/') ||
    name.split('/').includes('..')
  ) {
    throw new InvalidAddonError('The XPI contains an unsafe file path');
  }
}

function readEntries(packageBytes: Buffer): ZipEntry[] {
  if (packageBytes.length < 22) {
    throw new InvalidAddonError('The XPI is too small to be a valid package');
  }
  const directoryEnd = findEndOfCentralDirectory(packageBytes);
  const disk = packageBytes.readUInt16LE(directoryEnd + 4);
  const directoryDisk = packageBytes.readUInt16LE(directoryEnd + 6);
  const entriesOnDisk = packageBytes.readUInt16LE(directoryEnd + 8);
  const entryCount = packageBytes.readUInt16LE(directoryEnd + 10);
  const directorySize = packageBytes.readUInt32LE(directoryEnd + 12);
  const directoryOffset = packageBytes.readUInt32LE(directoryEnd + 16);

  if (
    disk !== 0 ||
    directoryDisk !== 0 ||
    entriesOnDisk !== entryCount ||
    entryCount === 0 ||
    entryCount > maximumEntries ||
    directoryOffset + directorySize > directoryEnd
  ) {
    throw new InvalidAddonError('The XPI uses an unsupported ZIP layout');
  }

  const entries: ZipEntry[] = [];
  let offset = directoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (
      offset + 46 > packageBytes.length ||
      packageBytes.readUInt32LE(offset) !== centralDirectorySignature
    ) {
      throw new InvalidAddonError('The XPI central directory is malformed');
    }
    const flags = packageBytes.readUInt16LE(offset + 8);
    const compressionMethod = packageBytes.readUInt16LE(offset + 10);
    const compressedSize = packageBytes.readUInt32LE(offset + 20);
    const uncompressedSize = packageBytes.readUInt32LE(offset + 24);
    const nameLength = packageBytes.readUInt16LE(offset + 28);
    const extraLength = packageBytes.readUInt16LE(offset + 30);
    const commentLength = packageBytes.readUInt16LE(offset + 32);
    const localHeaderOffset = packageBytes.readUInt32LE(offset + 42);
    const nextOffset = offset + 46 + nameLength + extraLength + commentLength;
    if (
      nextOffset > packageBytes.length ||
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localHeaderOffset === 0xffffffff
    ) {
      throw new InvalidAddonError('The XPI contains an unsupported ZIP entry');
    }
    const name = packageBytes
      .subarray(offset + 46, offset + 46 + nameLength)
      .toString('utf8');
    safeEntryName(name);
    entries.push({
      compressedSize,
      compressionMethod,
      flags,
      localHeaderOffset,
      name,
      uncompressedSize,
    });
    offset = nextOffset;
  }
  return entries;
}

function extractEntry(packageBytes: Buffer, entry: ZipEntry): Buffer {
  if (
    (entry.flags & 1) !== 0 ||
    entry.uncompressedSize > maximumManifestBytes ||
    ![0, 8].includes(entry.compressionMethod)
  ) {
    throw new InvalidAddonError('The XPI manifest uses unsupported ZIP features');
  }
  const offset = entry.localHeaderOffset;
  if (
    offset + 30 > packageBytes.length ||
    packageBytes.readUInt32LE(offset) !== localFileSignature
  ) {
    throw new InvalidAddonError('The XPI manifest header is malformed');
  }
  const nameLength = packageBytes.readUInt16LE(offset + 26);
  const extraLength = packageBytes.readUInt16LE(offset + 28);
  const dataOffset = offset + 30 + nameLength + extraLength;
  const dataEnd = dataOffset + entry.compressedSize;
  if (dataEnd > packageBytes.length) {
    throw new InvalidAddonError('The XPI manifest data is truncated');
  }
  const compressed = packageBytes.subarray(dataOffset, dataEnd);
  const output =
    entry.compressionMethod === 0
      ? Buffer.from(compressed)
      : inflateRawSync(compressed, {
          maxOutputLength: maximumManifestBytes,
        });
  if (output.length !== entry.uncompressedSize) {
    throw new InvalidAddonError('The XPI manifest size is inconsistent');
  }
  return output;
}

function firefoxMajor(version: string | undefined): number | undefined {
  if (!version || version === '*') return undefined;
  const match = /^(\d+)/.exec(version);
  return match?.[1] ? Number(match[1]) : undefined;
}

export function inspectXpi(
  packageBytes: Buffer,
  configuredFirefoxMajor: number,
): InspectedXpi {
  const entries = readEntries(packageBytes);
  const manifestEntries = entries.filter(
    (entry) => entry.name.toLowerCase() === 'manifest.json',
  );
  if (manifestEntries.length !== 1) {
    throw new InvalidAddonError('The XPI must contain one root manifest.json');
  }
  const signed = entries.some((entry) => {
    const name = entry.name.toLowerCase();
    return /^meta-inf\/[^/]+\.rsa$/.test(name) || name === 'meta-inf/cose.sig';
  });
  if (!signed) {
    throw new InvalidAddonError('The XPI is not signed for release Firefox');
  }

  let manifestValue: unknown;
  try {
    manifestValue = JSON.parse(
      extractEntry(packageBytes, manifestEntries[0]!).toString('utf8'),
    );
  } catch (error) {
    if (error instanceof InvalidAddonError) throw error;
    throw new InvalidAddonError('The XPI manifest is not valid JSON');
  }
  const parsed = manifestSchema.safeParse(manifestValue);
  if (!parsed.success) {
    throw new InvalidAddonError('The XPI manifest is not a supported WebExtension');
  }
  if (parsed.data.theme !== undefined) {
    throw new InvalidAddonError('Firefox themes are not supported in this release');
  }
  const gecko =
    parsed.data.browser_specific_settings?.gecko ?? parsed.data.applications?.gecko;
  if (!gecko?.id) {
    throw new InvalidAddonError('The XPI manifest must declare a Firefox extension ID');
  }
  const minimumMajor = firefoxMajor(gecko.strict_min_version);
  const maximumMajor = firefoxMajor(gecko.strict_max_version);
  if (minimumMajor && minimumMajor > configuredFirefoxMajor) {
    throw new IncompatibleAddonError(
      `This add-on requires Firefox ${minimumMajor} or newer`,
    );
  }
  if (maximumMajor && maximumMajor < configuredFirefoxMajor) {
    throw new IncompatibleAddonError(
      `This add-on supports Firefox ${maximumMajor} or older`,
    );
  }

  return {
    id: gecko.id,
    maxFirefoxVersion: gecko.strict_max_version ?? null,
    minFirefoxVersion: gecko.strict_min_version ?? null,
    name: parsed.data.name.startsWith('__MSG_') ? gecko.id : parsed.data.name,
    permissions: [
      ...new Set([
        ...(parsed.data.permissions ?? []),
        ...(parsed.data.host_permissions ?? []),
      ]),
    ].sort(),
    sha256: createHash('sha256').update(packageBytes).digest('hex'),
    version: parsed.data.version,
  };
}
