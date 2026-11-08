# Famlin end-to-end smoke tests

Playwright tests that drive a running Famlin instance through its golden paths
in Chromium. CI runs them against the freshly built Docker image (`docker` job
in `.github/workflows/ci.yml`).

How to run them locally: see
[End-to-end smoke tests](../docs/developers/quick-start.md#end-to-end-smoke-tests).
The suite needs a fresh database, because its first test runs the one-time
admin setup.
