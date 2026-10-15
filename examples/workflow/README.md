# Workflow client

```sh
bazel build //:workflow
bazel test //:workflow_local_test
```

`cf::Workflow(context.bindings, "FLOW")` supports `create(id, params_json)`, `state(id)`, `send_event_json(id, type, payload_json)`, and `erase(id)`. This is a client; the reference Workflow and durable steps are JavaScript, not C++ replay/step execution.

IDs/event types are 1–100 ASCII letters/digits/underscores/hyphens and cannot start with a hyphen. Creation params must be a JSON object; event payloads may be any JSON value. Limits are 1 MiB, depth 32, and 65,536 nodes. Creation/event acknowledgment does not mean completion. Deleting an instance is not rollback, and immediate state lookup is not a reliable absence oracle.

Try `POST /create/<id>`, `GET /state/<id>`, `POST /event/<id>` (type continue), and `DELETE /delete/<id>`. Add authorization before exposing instance management. Generated IDs, retention, batches, pause/resume/restart/terminate, output/error retrieval, and C++ steps are not exposed. Calls are not automatically retried.

See [example setup](../README.md) and [request lifetime](../../docs/request-lifetime.md) before adapting this fixture.
