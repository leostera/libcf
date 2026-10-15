# libcf working rules

- Use the `cf` CLI (`/opt/homebrew/bin/cf` in the current environment), not Wrangler, for Cloudflare operations. Discover commands with anonymous `cf cli search` queries.
- All online test endpoints must be under `*.libcf.leostera.dev`. Do not use `workers.dev`, preview URLs, or another domain as a fallback. Disable `workersDev` and `previewUrls` in live configurations.
- Keep default tests local. Live tests are opt-in, use isolated libcf resource names, and require cleanup evidence. Never touch unrelated resources or commit credentials.
- Preserve distinctions between implemented, locally tested, and live verified. A successful upload or deploy dry-run is not a successful live runtime test.
- Public C++ API: namespace `cf`, headers `<cf/...>`. Project branding remains libcf.
- Use Bazel 9.3.0 with Bzlmod for builds, tests, CI and packaging. Do not add a CMake compatibility build.
- Follow `CONTRIBUTING.md`. Keep documentation focused on users and contributors, not internal task tracking or historical verification reports.
