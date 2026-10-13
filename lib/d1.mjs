import { parseParameters, parseBatch, encodeBatch, encodeResult } from './sql.mjs';

export async function performD1(method, database, sql, body) {
  if (method === 20) {
    const statements = parseBatch(body).map(({ sql, parameters }) => {
      const statement = database.prepare(sql);
      return parameters.length ? statement.bind(...parameters) : statement;
    });
    return { status: 0, bytes: encodeBatch(await database.batch(statements)) };
  }
  let result;
  if (method === 18) {
    result = await database.exec(sql);
  } else {
    const parameters = parseParameters(body);
    let statement = database.prepare(sql);
    if (parameters.length) statement = statement.bind(...parameters);
    if (method === 16) result = await statement.run();
    else if (method === 17) result = await statement.all();
    else if (method === 19) {
      const row = await statement.first();
      result = { meta: {}, results: row === null ? [] : [row] };
    } else throw new TypeError('invalid D1 operation');
  }
  return { status: 0, bytes: encodeResult(result) };
}
