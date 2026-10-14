import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { contracts, extractReflectionContract } from './reflection.mjs';
import { MiniflareWorkerConfigSchema, ParsedMiniflareKnownBindingSchema } from 'miniflare';

const require = createRequire(import.meta.url);
const typesPackage = require.resolve('@cloudflare/workers-types/package.json');
const typesMetadata = JSON.parse(readFileSync(typesPackage,'utf8'));
// This package's module imports resolve to its exported index.ts declarations;
// index.d.ts is the separate ambient/global entry, not the imported module.
const declarations = join(dirname(typesPackage),'index.ts');

test('reflective extraction rejects unknown targets and mismatched receivers', () => {
  for (const contract of contracts) {
    const text = readFileSync(`lib/${contract.file}.mjs`,'utf8');
    assert.throws(()=>extractReflectionContract(`${text}\nReflect.apply(unknown, binding, []);`,contract),/unclassified Reflect.apply/);
    const mismatch = text.replace('Reflect.apply(invoke, binding,','Reflect.apply(invoke, wrong,');
    // Gateway's getUrl uses gateway, not binding, as its receiver.
    const changed = mismatch === text ? text.replace('Reflect.apply(invoke, gateway,','Reflect.apply(invoke, wrong,') : mismatch;
    assert.notEqual(changed,text);
    assert.throws(()=>extractReflectionContract(changed,contract),/method\/receiver mismatch/);
  }
});

test('pinned published call shapes and native configuration schema', () => {
  assert.equal(typesMetadata.version,'5.20261006.1'); assert.equal(ts.version,'6.0.3');
  const miniflarePackage = require.resolve('miniflare/package.json');
  const miniflareVersion = JSON.parse(readFileSync(miniflarePackage,'utf8')).version;
  const workerdVersion = JSON.parse(readFileSync(createRequire(miniflarePackage).resolve('workerd/package.json'),'utf8')).version;
  assert.equal(miniflareVersion,'5.20261006.1-alpha'); assert.equal(workerdVersion,'1.20261006.1');
  const options = {
    strict:true,noEmit:true,skipLibCheck:false,types:[],
    target:ts.ScriptTarget.ESNext,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,
    lib:['lib.esnext.d.ts'],
  };
  // Explicit semantic receiver annotations, with argument expressions extracted
  // from the real adapter. Refactors/unknown sites fail rather than being skipped.
  const roles = {builder:'ImageTransformer',transformed:'ImageTransformer',result:'ImageTransformationResult'};
  const adapter = ts.createSourceFile('image-rotate.mjs',readFileSync('lib/image-rotate.mjs','utf8'),ts.ScriptTarget.ESNext,true,ts.ScriptKind.JS);
  assert.equal(adapter.parseDiagnostics.length,0);
  const printer = ts.createPrinter(), calls = [];
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'invoke') {
      const [receiver,method,args] = node.arguments;
      assert.equal(node.arguments.length,3);
      assert(ts.isIdentifier(receiver) && Object.hasOwn(roles,receiver.text),'unclassified adapter receiver');
      assert(ts.isStringLiteral(method) && ts.isArrayLiteralExpression(args),'dynamic adapter call needs a contract');
      calls.push(`${receiver.text}[${JSON.stringify(method.text)}](${args.elements.map(arg=>printer.printNode(ts.EmitHint.Expression,arg,adapter)).join(', ')});`);
    }
    ts.forEachChild(node,visit);
  }
  visit(adapter); assert.equal(calls.length,3,'all expected invoke sites must participate');
  const virtual = resolve('tests/platform-contracts/generated-adapter.ts');
  const generated = `import type { ImageTransformer, ImageTransformationResult } from '@cloudflare/workers-types';\n` +
    Object.entries(roles).map(([name,type])=>`declare const ${name}: ${type};`).join('\n') + '\n' + calls.join('\n');
  const reflected = contracts.map(contract=>({file:contract.file,
    ...extractReflectionContract(readFileSync(`lib/${contract.file}.mjs`,'utf8'),contract)}));
  const reflectionSources = new Map(reflected.map(item=>[resolve(`tests/platform-contracts/generated-${item.file}.ts`),item.text]));
  function compile(text, extraSources = reflectionSources) {
    const sources = new Map(extraSources); sources.set(virtual,text);
    const host = ts.createCompilerHost(options), getSourceFile = host.getSourceFile.bind(host);
    host.getSourceFile = (file,languageVersion,...rest) => sources.has(file)
      ? ts.createSourceFile(file,sources.get(file),languageVersion,true,ts.ScriptKind.TS)
      : getSourceFile(file,languageVersion,...rest);
    return ts.createProgram([resolve('tests/platform-contracts/fixture.ts'),...sources.keys()],options,host);
  }
  const program = compile(generated);
  for (const [path,text] of reflectionSources) assert.equal(program.getSourceFile(path)?.text,text);
  assert.equal(program.getSourceFile(virtual)?.text,generated,'generated calls must participate');
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length,0,ts.formatDiagnosticsWithColorAndContext(diagnostics,{
    getCurrentDirectory:()=>process.cwd(),getCanonicalFileName:path=>path,getNewLine:()=> '\n',
  }));
  const invalidRotation = generated.replace('rotate: 90','rotate: "90"');
  assert.notEqual(invalidRotation,generated,'mutation must affect an extracted call');
  assert(ts.getPreEmitDiagnostics(compile(invalidRotation)).some(diagnostic=>
    diagnostic.file?.fileName === virtual && diagnostic.code === 2322),
  'the generated actual-argument contract must reject a string rotation');
  const invalidSql = new Map(reflectionSources), sqlPath = resolve('tests/platform-contracts/generated-analytics-sql.ts');
  invalidSql.set(sqlPath,invalidSql.get(sqlPath).replace('["query"]','["missingQuery"]'));
  assert.notEqual(invalidSql.get(sqlPath),reflectionSources.get(sqlPath));
  assert(ts.getPreEmitDiagnostics(compile(generated,invalidSql)).some(diagnostic=>
    diagnostic.file?.fileName === sqlPath && [2339,7053].includes(diagnostic.code)),
  'a changed actual method selector must fail declaration checking');
  const source = program.getSourceFile(declarations) ?? program.getSourceFiles().find(file=>file.fileName.endsWith('/workers-types/index.ts'));
  assert(source,'published declarations must actually participate in checking');
  assert.equal(source.text,readFileSync(declarations,'utf8'),'checker must use the pinned package entry');
  const checker = program.getTypeChecker();
  const exports = checker.getExportsOfModule(checker.getSymbolAtLocation(source));
  const surfaces = {};
  for (const name of ['ImagesBinding','ImageTransformer','ImageTransformationResult','HostedImagesBinding','ImageHandle']) {
    const symbol = exports.find(item=>item.name===name); assert(symbol,`missing ${name}`);
    const type = checker.getDeclaredTypeOfSymbol(symbol);
    surfaces[name] = checker.getPropertiesOfType(type).map(member=>member.name).sort();
    assert(surfaces[name].length,`${name} must not resolve to an empty/any surface`);
  }
  assert(surfaces.ImagesBinding.includes('input')); assert(surfaces.ImageTransformer.includes('output'));
  assert(surfaces.ImageTransformationResult.includes('image'));
  const bindingKinds = ParsedMiniflareKnownBindingSchema.options.flatMap(option=>[...option.shape.type.values]).sort();
  assert(bindingKinds.includes('images'));
  const config = {name:'static-images-contract',compatibilityDate:'2026-10-13',env:{IMAGES:{type:'images'}}};
  const parsed = MiniflareWorkerConfigSchema.safeParse(config);
  assert(parsed.success,JSON.stringify(parsed.error?.issues));
  assert(!MiniflareWorkerConfigSchema.safeParse({...config,env:{IMAGES:{type:'not-a-real-binding'}}}).success);
  const bindingConfigs = [
    {type:'ai'}, {type:'analytics'}, {type:'kv',id:'libcf-static-contract'},
    {type:'mtls-certificate',id:'libcf-static-contract'},
    {type:'vpc-service',id:'libcf-static-contract'},
    {type:'vpc-network',networkId:'libcf-static-contract'},
  ];
  for (const binding of bindingConfigs) {
    const result = MiniflareWorkerConfigSchema.safeParse({...config,env:{TEST:binding}});
    assert(result.success,`${binding.type}: ${JSON.stringify(result.error?.issues)}`);
  }
  const automaticKv = MiniflareWorkerConfigSchema.safeParse({...config,env:{TEST:{type:'kv'}}});
  assert(automaticKv.success);
  assert.equal(automaticKv.data.env.TEST.id,`TEST-${config.name}`,'local config synthesizes a KV identity');
  assert(!ParsedMiniflareKnownBindingSchema.safeParse({type:'kv'}).success,
    'normalized binding schema still requires the synthesized identity');
  for (const type of ['mtls-certificate','vpc-service','vpc-network']) {
    assert(!MiniflareWorkerConfigSchema.safeParse({...config,env:{TEST:{type}}}).success,
      `${type} must require its identifier shape`);
  }
  console.log(JSON.stringify({declarationsVersion:typesMetadata.version,compiler:ts.version,miniflareVersion,workerdVersion,
    checkedBindingConfigs:bindingConfigs,
    declarationSha256:createHash('sha256').update(readFileSync(declarations)).digest('hex'),
    generatedCalls:calls,reflectedCalls:reflected.map(({file,calls})=>({file,calls})),surfaces,bindingKinds,scope:'static declaration/schema compatibility only; not runtime, entitlement or full adapter coverage'}));
});
