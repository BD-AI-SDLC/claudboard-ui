# Migration: <change-name>   (vNEXT ← vPREV)

## Compatibility class
<!-- Derived from the delta headers in specs/. One of:
     - "N/A — additive only"  (the change contains only ADDED requirements)
     - "MAJOR — breaking"     (list the triggering REMOVED / RENAMED / breaking MODIFIED deltas) -->

## Applies to
<!-- Check every public surface this migration touches -->
- [ ] Public API consumers
- [ ] Persisted data (DB schema)
- [ ] Config files
- [ ] CLI / wire format

## Forward steps
<!-- Ordered, AI-executable, idempotent steps to move a consumer from vPREV to vNEXT.
     For an additive change, state "N/A — additive only". -->
1.

## Dry-run / validation
<!-- Assertions (not prose) that confirm the migration succeeded. -->

## Rollback
<!-- Ordered steps to return a consumer to vPREV. -->
1.

## Deprecation window
<!-- What keeps working during the transition (aliases/shims) and for how long. -->
