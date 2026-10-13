#include "cf/worker_loader.hpp"
#include "cf/worker.hpp"

namespace cf {
Task handle(Request request, WorkerContext context) {
  const auto path = request.path();
  if (path == "/network-sentinel") co_return Response::text("reachable");
  std::string source;
  if (path == "/echo" || path == "/missing") {
    source = R"JS(export default {async fetch(request, env) {
      return new Response('child:' + await request.text(), {status:201,
        headers:{'x-child-env-count':String(Object.keys(env).length),'x-child-method':request.method}});
    }})JS";
  } else if (path == "/other") {
    source = "export default {fetch(){return new Response('different-code')}}";
  } else if (path == "/blocked-fetch") {
    source = R"JS(export default {async fetch(request) {
      try { await fetch(new URL('/network-sentinel',request.url)); return new Response('network-allowed'); }
      catch(error) { return new Response('blocked:' + error.message); }
    }})JS";
  } else if (path == "/blocked-connect") {
    source = R"JS(import {connect} from 'cloudflare:sockets';
      export default {async fetch(request) {
        try { const socket=connect({hostname:new URL(request.url).hostname,port:443});
          await socket.opened; await socket.close(); return new Response('network-allowed'); }
        catch(error) { return new Response('blocked:' + error.message); }
      }})JS";
  } else if (path == "/invalid-source") {
    source = "this is not valid JavaScript";
  } else if (path == "/oversized-source") {
    source.assign(65537, ' ');
  } else if (path == "/oversized-response") {
    source = "export default {fetch(){return new Response('x'.repeat(1048577))}}";
  } else {
    co_return Response::text("not found", 404);
  }
  WorkerLoader loader(context.bindings, path == "/missing" ? "MISSING" : "LOADER");
  auto result = co_await loader.fetch(std::move(source), std::move(request));
  if (!result) co_return Response::text("child execution failed", 502);
  co_return std::move(result.value());
}
}  // namespace cf
