# D1 prepared statements from C++

```sh
npm ci
npm run test:d1
npm run build:d1
node scripts/dev-example.mjs d1
```

The C++ handler uses `cf::D1Database`, `prepare().bind().run()`, `all()`, `first()`, `batch()`, and `exec()` through the shared Wasm bridge. `POST /setup` creates a local table; `PUT/GET/DELETE /records/:id` stores binary values. `POST /constraint-probe` deliberately violates NOT NULL to demonstrate error handling.

Bound parameters are `cf::SqlValue`: null, finite double, signed integer, string, or bytes. Parameters cross a tagged binary protocol separately from SQL text. Integers outside JavaScript's exact range are rejected before dispatch. Results are named typed cells; evolving platform metadata is retained as JSON. Read large SQL integers using an explicit SQL cast to TEXT; unsafe numeric results are rejected.

Eight local integration cases cover CRUD/binary/empty values, SQL-looking data, concurrent statements, constraint rejection, and invalid routes. Native tests check parameter precision, row decoding and malformed wire data. A separate isolated live probe verified setup/exec, binary CRUD, first/null/missing, batch commit/rollback and constraint errors; see [evidence and cleanup](../../docs/live-verification.md). The checked-in database ID remains local-only. `first()` distinguishes a missing row from a row containing SQL NULL. Batches execute through D1's transactional API; local tests verify ordered results and rollback of earlier writes after a later constraint failure. The bridge limits batches to 100 statements and 1 MiB encoded input. Sessions, raw, streaming results and arbitrary large result sets remain unimplemented. Request/parameter payloads are bounded to 1 MiB and result payloads to 4 MiB; these are library limits, not D1 limits.

Sources: [prepared statements](https://developers.cloudflare.com/d1/worker-api/prepared-statements/), [D1 database API](https://developers.cloudflare.com/d1/worker-api/d1-database/).
