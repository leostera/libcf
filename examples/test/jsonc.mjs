import { parse, printParseErrorCode } from 'jsonc-parser';

export function parseFixtureConfig(text) {
  const errors = [];
  const config = parse(text, errors, { allowTrailingComma: true });
  if (errors.length) {
    const first = errors[0];
    throw new SyntaxError(`Invalid JSONC at offset ${first.offset}: ${printParseErrorCode(first.error)}`);
  }
  if (config === null || typeof config !== 'object' || Array.isArray(config))
    throw new TypeError('Worker fixture configuration must be an object');
  return config;
}
