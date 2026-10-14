import assert from 'node:assert/strict';
import ts from 'typescript';

// These are reviewed semantic roles, not inferred runtime types/data flow.
export const contracts = [
  {file:'queue',roles:{queue:'CF.Queue'},values:{messages:'Array<{body:string;contentType:"text"}>',payload:'string | Uint8Array',method:'number',delaySeconds:'number'},sites:2,cleanup:{}},
  {file:'analytics-sql',roles:{binding:'CF.AnalyticsSQLBinding'},values:{request:'CF.AnalyticsSQLQuery'},sites:1,cleanup:{release:1}},
  {file:'ai-gateway',roles:{binding:'CF.Ai',gateway:'CF.AiGateway'},values:{key:'string',provider:'string | undefined'},sites:2,cleanup:{release:1}},
  {file:'sites',roles:{binding:'CF.KVNamespace'},values:{physical:'string'},sites:1,cleanup:{release:1,cancelStream:1}},
  {file:'outbound-get',roles:{binding:'CF.Fetcher'},values:{request:'CF.Request'},sites:1,cleanup:{release:1,cancelStream:1}},
];

export function extractReflectionContract(text, contract) {
  const source = ts.createSourceFile(`${contract.file}.mjs`,text,ts.ScriptTarget.ESNext,true,ts.ScriptKind.JS);
  assert.equal(source.parseDiagnostics.length,0);
  const printer = ts.createPrinter();
  const print = node => printer.printNode(ts.EmitHint.Expression,node,source);
  const selectors = new Map(), cleanupOrigins = new Map();
  const cleanupDefinitions = {release:'value[Symbol.dispose]',cancelStream:'ReadableStream.prototype.cancel'};
  function walk(node, visitor) {
    visitor(node);
    ts.forEachChild(node,child=>walk(child,visitor));
  }
  walk(source,node=> {
    if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || !node.initializer) return;
    const name = node.name.text, value = node.initializer;
    if (Object.hasOwn(contract.cleanup,name)) {
      assert(!cleanupOrigins.has(name),'duplicate cleanup declaration');
      assert.equal(print(value),cleanupDefinitions[name],'cleanup origin changed: review its contract');
      cleanupOrigins.set(name,0);
    }
    if (!ts.isPropertyAccessExpression(value) || !ts.isIdentifier(value.expression) ||
        !Object.hasOwn(contract.roles,value.expression.text)) return;
    assert(!selectors.has(name),'ambiguous method selector');
    selectors.set(name,{receiver:value.expression.text,method:value.name.text,uses:0});
  });
  const calls = [];
  function emit(selector, args) {
    if (ts.isConditionalExpression(args)) {
      return `if (${print(args.condition)}) { ${emit(selector,args.whenTrue)} } else { ${emit(selector,args.whenFalse)} }`;
    }
    assert(ts.isArrayLiteralExpression(args),'dynamic argument list needs a contract');
    assert(!args.elements.some(ts.isSpreadElement),'spread argument needs a contract');
    return `${selector.receiver}[${JSON.stringify(selector.method)}](${args.elements.map(print).join(', ')});`;
  }
  walk(source,node=> {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression) ||
        !ts.isIdentifier(node.expression.expression) || node.expression.expression.text !== 'Reflect' ||
        node.expression.name.text !== 'apply') return;
    assert.equal(node.arguments.length,3);
    const [target,receiver,args] = node.arguments;
    assert(ts.isIdentifier(target),'dynamic reflective target needs a contract');
    const selector = selectors.get(target.text);
    if (!selector) {
      assert(cleanupOrigins.has(target.text),`unclassified Reflect.apply target: ${target.text}`);
      cleanupOrigins.set(target.text,cleanupOrigins.get(target.text)+1);
      return;
    }
    assert(ts.isIdentifier(receiver) && receiver.text === selector.receiver,'method/receiver mismatch');
    selector.uses++;
    calls.push(emit(selector,args));
  });
  assert.equal(calls.length,contract.sites,'provider site count changed');
  for (const selector of selectors.values()) assert.equal(selector.uses,1,'selector must be used exactly once');
  assert.deepEqual(Object.fromEntries(cleanupOrigins),contract.cleanup,'cleanup site count changed');
  const declarations = Object.entries({...contract.roles,...contract.values})
    .map(([name,type])=>`declare const ${name}: ${type};`).join('\n');
  return {
    calls,
    text:`import type * as CF from '@cloudflare/workers-types';\n${declarations}\n${calls.join('\n')}`,
  };
}
