// BMW M3 aggregate payloads are intentionally stored outside the function bundle.
// The API loads their verified routing index and bounded product shards through
// server/ecs-reviewed-shard-catalog.js. Keep these exports as compatibility
// stubs for the reviewed-catalogue merge and its existing offline tests.
export const BMW_M3_AGGREGATE_QUARANTINED_ECS_IDENTITIES = Object.freeze([]);
export const BMW_M3_AGGREGATE_PRODUCTS = Object.freeze([]);
