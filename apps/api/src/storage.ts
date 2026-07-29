import { mkdir } from 'node:fs/promises';

import { getStoragePaths, type StoragePaths } from '@mediadeck/config';

export async function ensureStorageLayout(
  dataDirectory: string,
): Promise<StoragePaths> {
  const paths = getStoragePaths(dataDirectory);

  await Promise.all(
    [
      paths.root,
      paths.addons,
      paths.addonInbox,
      paths.addonRejected,
      paths.database,
      paths.profiles,
      paths.backups,
      paths.runtime,
      paths.guests,
      paths.locks,
    ].map(async (path) => mkdir(path, { recursive: true })),
  );

  return paths;
}
