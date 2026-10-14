import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

// Runtime preparation is deliberately outside Bazel's disposable output tree.
// Never replace an existing directory: it may contain active ownership records.
export async function createLiveOutput(family, workspace = process.env.BUILD_WORKSPACE_DIRECTORY ?? process.cwd()) {
  if (typeof family !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(family)) {
    throw new Error('Invalid live output family');
  }
  const root = resolve(workspace, 'build', `live-${family}`);
  await mkdir(dirname(root), { recursive: true });
  await mkdir(root);
  return root;
}
