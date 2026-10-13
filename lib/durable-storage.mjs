import { parseParameters, parseBatch, encodeResult, encodeBatch } from './sql.mjs';

function execute(storage, sql, parameters) {
  const cursor = storage.sql.exec(sql, ...parameters);
  // The encoder consumes this cursor synchronously and enforces the result
  // limit while iterating, rather than materializing an unbounded toArray().
  return { results: cursor, meta: () => ({ rowsRead: cursor.rowsRead, rowsWritten: cursor.rowsWritten }) };
}

export async function performDurableStorage(method, storage, sql, body) {
  if (method === 80) {
    const parameters = parseParameters(body);
    return { status: 0, bytes: encodeResult(execute(storage, sql, parameters)) };
  }
  if (method === 81) {
    const commands = parseBatch(body);
    function* results() {
      // Each cursor is fully encoded before the next SQL statement executes.
      for (const command of commands) yield execute(storage, command.sql, command.parameters);
    }
    const bytes = storage.transactionSync(() => encodeBatch(results()));
    return { status: 0, bytes };
  }
  if (method === 82) {
    if (!/^\d+$/.test(sql) || !Number.isSafeInteger(Number(sql))) throw new TypeError('invalid alarm time');
    await storage.setAlarm(Number(sql));
    return { status: 0, bytes: new Uint8Array() };
  }
  throw new TypeError('unknown Durable Object storage operation');
}
