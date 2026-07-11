## 2026-07-10 - Deferred execution locks, cache transactionality, and API payload normalization

**Learning:** Promise rejections during sequential cache pagination, such as rate-limit failures, can leave mutable progress fields such as `scannedIndex` incremented prematurely, causing later requests to skip catalogue entries.
**Action:** Reordered progress updates so remote watched-status validation completes successfully before the corresponding scan and accepted-item state is committed.

**Learning:** Duplicated IMDb validation and normalisation logic across modules can create inconsistent cache keys and missed matches.
**Action:** Extracted IMDb validation and normalisation into the shared `src/lib/imdb.ts` module, removing raw-ID fallback behaviour and standardising internal keys.
