# D1 prepared statements

```sh
bazel build //:d1
bazel test //:d1_local_test
```

`cf::D1Database` supports `prepare().bind().run()`, `all()`, `first()`, `batch()`, and `exec()`. `POST /setup` creates the example table; `PUT/GET/DELETE /records/:id` stores binary values. `/constraint-probe` demonstrates failure handling.

`cf::SqlValue` supports null, finite double, signed integer, string, and bytes. Integers must fit JavaScript's exact range; cast larger SQL integers to TEXT. `first()` distinguishes missing rows from SQL NULL. Batches use the provider's transaction API and are limited to 100 statements. Input is capped at 1 MiB and results at 4 MiB. Sessions, raw queries, and streaming results are not exposed. Database IDs in the fixture are local-only.

See [example setup](../README.md) and [request lifetime](../../docs/request-lifetime.md) before adapting this fixture.
