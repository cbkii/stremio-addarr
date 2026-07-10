## 2025-06-29 - Batch performance improvements for Arr/Stremio hot paths
**Learning:** Stremio often issues bursts of identical catalog and status requests. Standard TTL caches prevent repeated remote API calls *after* the cache is populated, but they do not protect against the initial stampede.
**Action:** Implemented `AsyncTtlCache` wrapping standard caching that also maps in-flight Promises by key. Concurrent incoming requests await the same pending Promise, significantly reducing duplicate outbound calls to Sonarr/Radarr when many users load the same tile/catalog view simultaneously.

**Learning:** `.sort()` callbacks inside array processing loops (like catalogue merging) often repeatedly call expensive operations (e.g. string allocations, `.toLowerCase()`) and allocate keys during sorting comparisons, degrading performance.
**Action:** Refactored sorting to perform a single pass that precomputes mapping keys `downloading: { item: CatalogItem, key: ... }` which eliminates redundant O(N log N) string transformations.

**Learning:** In highly trafficked routes like `getMovieStatus()` and `findSeriesByImdbId()`, repeatedly calling `.find()` on the entire dataset leads to severe performance regressions because it triggers an O(N) traversal on every request for each item.
**Action:** Caching an array is not enough; additionally populate a mapped `Map<string, Record>` index by `imdbId` which guarantees O(1) lookups on status lookups. Ensure `invalidateCache()` invalidates the array and the Map index together to avoid drift.

**Learning:** Having separate caching layers for arrays and their mapped indexes (`moviesCache` vs `moviesByImdbIdCache`) leads to eventual synchronization drift.
**Action:** Combine them into a single `Snapshot` object (`{ movies, byImdbId }`) and cache that object under a single key. This guarantees atomic invalidation.
## 2024-07-10\n\n- Performance Optimization Conventions: Avoid N+1 sequential awaits in loops by extracting processing into batch-oriented APIs (e.g., look up items in chunks). For cache rebuilds, always populate new memory structures and use atomic swaps rather than clearing live state sets to avoid exposing partial/empty states to concurrent requests.
