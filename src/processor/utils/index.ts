import { rm } from 'node:fs/promises';

export const removeTempFileOrFolder = async (path: string) => {
  await rm(path, { recursive: true, force: true });
};
