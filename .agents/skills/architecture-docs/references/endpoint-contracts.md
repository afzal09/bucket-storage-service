# Endpoint contract companion

Use this reference when an architecture task includes HTTP routes. Produce a
local, complete endpoint reference alongside the architecture guide. Preserve
accurate existing content and examples rather than replacing them with a checklist.

## Establish the wire contract

Read controller route decorators, method-level statuses and manual status
selection, path pipes, query/body DTOs including inherited validators and nested
DTOs, response interceptors, response DTOs, mapper output and error catalogue.
Read selected service code to resolve filter defaults or response differences;
stop at other-service calls in architecture traces. Use signatures/DTOs for
boundary types; if an exact delegated response value is unverified, document its
known type and say which detail remains unverified.

Prefer actual runtime output over stale comments, and identify mismatches rather
than inventing a consistent behavior. Keep implementation explanations in the
architecture guide. A consumer-visible prerequisite or replay/status distinction
belongs in the contract, but SQL mechanics, locks and DDL do not.

## Document-wide conventions

Define the application/controller base path and common path parameter types.
Make authentication requirements discoverable without including real tokens.
Explain notation: optional property versus nullable property, UUID strings,
calendar dates versus timestamps, numeric money versus decimal strings.

Define the real success envelope and list/array shapes, including total counts,
offset/limit defaults and maximums. Do not assume all routes share an envelope or
pagination shape; verify interceptors and handler return values. Distinguish
success body `status` fields from HTTP status codes and business-state fields.

Add a compact index of every endpoint, linking to its detailed section. Distinct
query modes of one route need explicit variants even though they are one endpoint.

## Required detail for every endpoint

For each method/path, include:

1. **Purpose and HTTP success statuses:** include 201/200 new/replay distinctions,
   archive no-op outcomes, or any other actual variants.
2. **Path parameters:** name, type, ID meaning and relationship to IDs returned in
   earlier responses. Do not conflate invoice IDs, payment IDs and allocation IDs.
3. **Query:** every field, type, requiredness, enum values, defaults, limits, array
   encoding, boolean encoding, dates, sorting and supported/ignored filters by mode.
   Explicitly say no query when absent.
4. **Body:** every top-level and nested field, including inherited optional fields,
   required-by-action conditions, validators and clear/omit semantics. Explicitly
   say no body when absent. Do not invent request-only fields from response DTOs.
5. **Response:** full envelope and entity shape, with nested fields, nullability,
   omission conditions and empty-result behavior. Show the shape in that endpoint's
   section; named reusable types may link to complete definitions in the same file.
   A bare DTO name or prose such as “returns a bill” is insufficient.
6. **Examples:** valid synthetic JSON for body-bearing requests and representative
   responses; request URLs for filter modes. Use full reusable response examples
   where repeating a large object for each endpoint would obscure differences.
   Never use `...`, union strings or schema placeholders inside JSON examples.
7. **Errors and visible prerequisites:** relevant catalogue errors with exact code,
   HTTP status and public message, plus shared validation/not-found errors when
   established. Indicate when the list is not exhaustive; do not invent downstream
   error guarantees.

## Shared shapes must be complete

Use either explicit field tables or self-contained TypeScript-style JSON shape
definitions. For example:

```typescript
type UUID = string;
type Timestamp = string;
type Envelope<T> = {
  status: true;
  message: 'Successful';
  entity: T;
};
type Sync = {
  status:
    'NOT_READY' | 'READY_TO_SYNC' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  documentId: string | null;
  failReason: string | null;
  lastSyncedAt: Timestamp | null;
};
```

This is a notation example, not a universal envelope or state vocabulary: copy
only values verified in the feature. If validating definitions with TypeScript,
put the combined snippets in a temporary module (e.g. prepend `export {};`) to
avoid collisions with global browser types such as Document.

Cover list summaries versus detail-only arrays, nested contacts/banks/documents,
masked values, payment/FX amounts, derived state, and all field/enum fallbacks
that affect the wire representation. Nullable fields emitted by a mapper remain
nullable even when Swagger claims otherwise. Keep interface/DTO declarations
separate from representative populated JSON values.

For mutation inputs, state whether absent means unchanged, empty list means
clear, blank strings normalize to null or are ignored, and null is actually
accepted/meaningful. Do not infer PATCH semantics merely from the HTTP verb.

For sync-style APIs, separately list the mark routes, outcome route, target type
values, per-target ID interpretation, request limits, prerequisites and return
counts. Do not silently substitute a mark-route ID for a result-item ID.

## Verify the companion

- Reconcile endpoint headings with the controller's method/path inventory; a
  correct count alone cannot detect one missing route and one duplicate.
- Check every query/body/response field against DTO inheritance and runtime
  projection. Validate all examples as JSON and keep amounts/dates consistent
  enough to represent the described state.
- Make named shape references and internal anchors resolvable. Verify request
  and response examples use public enum values, not internal aliases.
- Use only synthetic identity/payment data. Show masked identifiers as masked;
  never paste production bank details, personal records or signed URLs.
- Keep remote-document workflow instructions separate from this local reference.
  Do not edit a connected document, publish, or message anyone without explicit
  authorization for that external action.
