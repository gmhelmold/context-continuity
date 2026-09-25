# WP-00 - P13 synthetic component admission guard matrix

**Status: component-only scope. P13 remains partial. No stock-host COMPLETE/PASS claim.**

## Commands

P13 commands are defined in [the probe README](../../tests/conformance/opencode/README.md). This note records scope and limits, not an execution result.

## Evidence boundary

Executable P13 evidence must be attached to PR and CI records for tested head. Later commits never inherit results. Without a record attached to current head, execution is unproven.

## Component scope

Matrix exercises existing gateway guards only: wrong method, path, origin, host; wrong/absent local secret; absent/revoked capture; oversized raw body; malformed UTF-8/JSON; wrong model; non-array messages; changed retry body. The oversize input is valid JSON with trailing whitespace, so it isolates raw 1 MiB admission from later synthetic primary-budget handling.

Each rejected request begins with fresh valid correlation when that guard needs one. P13 assertions require non-2xx, zero incremental upstream forwards, rejection trace delta limited to `request-rejected`/`capture-retention`, unchanged checkpoint bytes, and paired normal/native fresh primaries matching no-rejection control behavior for view and epoch. Trace and checkpoint fixture artifacts are checked for local-secret and capture-token values. This component has no stock-host export artifact.

Mutation harness uses only required gateway/test/canonical files in new private temporary directories. Its control and mutant assertions reject import failure, timeout, and signal as evidence.

## Limits

This does not alter gateway behavior, listener/profile, public host config, cancellation/retry barriers, or synthetic probe limit. SPEC-04 initial product limit remains 32 MiB; this verifies existing 1 MiB synthetic probe admission only. No host API decision, stock-host run, product conformance result, or aggregate runtime PASS follows from this component evidence.
