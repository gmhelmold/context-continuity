# WP-00 - P13 synthetic component admission guard matrix

**Status: component-only evidence. P13 remains partial. No stock-host COMPLETE/PASS claim.**

## Executed locally

Source tree later recorded as commit `a29f252`. The component starts real gateway HTTP plus a synthetic loopback upstream recorder. It uses fresh private temporary directories. No OpenCode binary, live inference, credentials, personal HOME/XDG, or user data participate.

```sh
python3 scripts/check-spec.py
python3 scripts/check-reference-model.py
python3 scripts/test-spec-check.py
python3 scripts/check-canonical.py
python3 scripts/check-storage-contracts.py
node --test --test-name-pattern='^P13 synthetic component admission guard matrix$' tests/conformance/opencode/test-components.mjs
node --test tests/conformance/opencode/test-admission-mutations.mjs
```

Results: five static commands passed; isolated P13 component test passed `1/1`; mutation control passed. Each of four defects failed its named assertion: local-secret check -> `P13_ASSERT_rejected:wrong-local`; capture-activity check -> `P13_ASSERT_rejected:revoked-during-read`; model/messages profile check -> `P13_ASSERT_rejected:wrong-model`; 1 MiB body limit -> `P13_ASSERT_rejected:oversized-body`.

## Component scope

Matrix exercises existing gateway guards only: wrong method, path, origin, host; wrong/absent local secret; absent/revoked capture; oversized raw body; malformed UTF-8/JSON; wrong model; non-array messages; changed retry body. The oversize input is valid JSON with trailing whitespace, so it isolates raw 1 MiB admission from later synthetic primary-budget handling.

Each rejected request begins with fresh valid correlation when that guard needs one. It proves non-2xx, zero incremental upstream forwards, and no new `aux-start`, `attempt-permit`, or `tool-effect` trace event. Trace and checkpoint fixture artifacts contain neither local secret nor capture-token values. This component has no stock-host export artifact.

Mutation runs copy only required gateway/test/canonical files into new private temporary directories. Control and every mutant report a normal process exit path: no import failure, timeout, or signal is accepted as mutation evidence.

## Limits

This does not alter gateway behavior, listener/profile, public host config, cancellation/retry barriers, or synthetic probe limit. SPEC-04 initial product limit remains 32 MiB; this verifies existing 1 MiB synthetic probe admission only. No host API decision, stock-host run, product conformance result, or aggregate runtime PASS follows from this component evidence.
