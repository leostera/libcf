import { parseBoundedJson } from './json.mjs';
export function parsePipelineBatch(bytes) {
  const records = parseBoundedJson(bytes);
  if (!Array.isArray(records) || records.length < 1 || records.length > 1000 ||
      records.some(record => record === null || typeof record !== 'object' || Array.isArray(record)))
    throw new TypeError('expected 1..1000 JSON object records');
  return records;
}
export async function performPipeline(binding, bytes) {
  const records = parsePipelineBatch(bytes);
  await binding.send(records);
  return { status: 0, bytes: new Uint8Array() };
}
