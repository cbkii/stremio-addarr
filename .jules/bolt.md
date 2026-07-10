## 2025-06-29 - Batch performance improvements for Arr/Stremio hot paths
**Learning:** Stremio often issues bursts of identical catalog and status requests. Standard TTL caches prevent repeated remote API calls *after* the cache is populated, but they do not protect against the initial stampede.
**Action:** Implemented `AsyncTtlCache` wrapping standard caching that also maps in-flight Promises by key. Concurrent incoming requests await the same pending Promise, significantly reducing duplicate outbound calls to Sonarr/Radarr when many users load the same tile/catalog view simultaneously.

**Learning:** `.sort()` callbacks inside array processing loops (like catalogue merging) often repeatedly call expensive operations (e.g. string allocations, `.toLowerCase()`) and allocate keys during sorting comparisons, degrading performance.
**Action:** Refactored sorting to perform a single pass that precomputes mapping keys `downloading: { item: CatalogItem, key: ... }` which eliminates redundant O(N log N) string transformations.

**Learning:** In highly trafficked routes like `getMovieStatus()` and `findSeriesByImdbId()`, repeatedly calling `.find()` on the entire dataset leads to severe performance regressions because it triggers an O(N) traversal on every request for each item.
**Action:** Caching an array is not enough; additionally populate a mapped `Map<string, Record>` index by `imdbId` which guarantees O(1) lookups on status lookups. Ensure `invalidateCache()` invalidates the array and the Map index together to avoid drift.

**Learning:** Having separate caching layers for arrays and their mapped indexes (`moviesCache` vs `moviesByImdbIdCache`) leads to eventual synchronization drift.
**Action:** Combine them into a single `Snapshot` object (`{ movies, byImdbId }`) and cache that object under a single key. This guarantees atomic invalidation.
## 2026-07-10 - Resilient pagination parsing and Atomic Caching for Arr services
**Learning:** Malformed pagination limits (`NaN`, `Infinity`) passed via user request payload can cause non-progressing infinite loops during sequential chunking.
**Action:** Use `typeof limit === 'number' && Number.isFinite(limit)` along with `Math.min/max` and `Math.floor()` constraints to ensure pagination variables are securely truncated finite integers. Add fallback invariants (e.g. `progress.scannedIndex <= startScannedIndex`) to break stalled loops.

**Learning:** Relying solely on persisted timestamps (like `lastSyncAt`) for sync intervals can leave in-memory caches empty upon process restart, leading to false negatives until the interval elapses.
**Action:** Introduced a transient boolean flag (`snapshotReady`) that must be `true` alongside a valid TTL before allowing the cache freshness shortcut to return successfully.

**Learning:** A standard cache implementation (`TtlCache`) storing `boolean` variables that maps to a local native Set is redundant, consumes excess memory, and creates unneeded invalidation boundaries.
**Action:** Replaced boolean lookup caches with direct `Set.has()` lookups combined with Atomic swap assignments during cache hydration to ensure concurrent connections never read partial sync states.
## 2026-07-10 - Deferred execution locks, cache transactionality, and API payload normalization
**Learning:** Promise rejections during sequential cache pagination (e.g. hitting rate-limits) can leave mutable cache tracker structures (like ) corrupted and incremented prematurely, causing downstream handlers to permanently skip entities.
**Action:** Re-ordered operations making progress caches transactional: await the remote validation payload first, verify its success, and only then commit the updated indices to the referenced cache object.

**Learning:** Duplicate API validation checks and normalization fallbacks (e.g. IMDb formatting) scattered across modules creates inconsistent internal ID states leading to split cache failures and missed matching dependencies.
**Action:** Extracted static validation and normalization patterns into a shared standalone  module reducing boilerplate and standardizing cache keys dynamically without hardcoded fallback overrides.

## 2026-07-10 - Deferred execution locks, cache transactionality, and API payload normalization
**Learning:** Promise rejections during sequential cache pagination (e.g. hitting rate-limits) can leave mutable cache tracker structures (like `scannedIndex`) corrupted and incremented prematurely, causing downstream handlers to permanently skip entities.
**Action:** Re-ordered operations making progress caches transactional: await the remote validation payload first, verify its success, and only then commit the updated indices to the referenced cache object.

**Learning:** Duplicate API validation checks and normalization fallbacks (e.g. IMDb formatting) scattered across modules creates inconsistent internal ID states leading to split cache failures and missed matching dependencies.
**Action:** Extracted static validation and normalization patterns into a shared standalone `lib` module reducing boilerplate and standardizing cache keys dynamically without hardcoded fallback overrides.
