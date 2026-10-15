# Flagship boolean evaluation

```sh
bazel build //:flagship
bazel test //:flagship_local_test
```

`cf::Flagship::boolean_details(key, fallback, options)` returns a boolean plus optional variant, reason, and error fields. `POST /evaluate` takes an optional targeting key; the fixture selects a fixed flag and explicit true fallback. Evaluated false is not failure; an ERROR reason may accompany a fallback. Transport/projection failures remain errors.

Keys are 1–128 UTF-8 bytes, targeting keys 1–256 when present, with no C0/C1 controls. Timeout is 1–60000 ms. Optional fields are bounded; unknown reason/code strings are preserved. Empty and absent differ.

Local tests use the native evaluator for static/equality/fallback behavior and mocks for boundary failures. They do not establish arbitrary targeting or production propagation. Seeding/admin routes are local-only. The production app ID is a placeholder; authenticate real evaluation endpoints. No flag administration API is exposed.

See [example setup](../README.md) and [request lifetime](../../docs/request-lifetime.md).
