import type { DigestSendMode } from '../types';

export const INGEST_TIMEOUT_MS = 15000;
export const ADAPTER_TIMEOUT_MS = 5000;
export const CLEANUP_DELAY_MS = 4000;

const KB = 1024;
const MB = 1024 * KB;

/**
 * Fallback single-file size limit (bytes) used for hostnames that have no
 * per-site override. Users can adjust this from the popup.
 */
export const DEFAULT_FILE_SIZE_LIMIT = 20 * MB;

/** Lower bound enforced by the popup input (bytes). */
export const MIN_FILE_SIZE_LIMIT = 1 * KB;

/** Upper bound enforced by the popup input (bytes). */
export const MAX_FILE_SIZE_LIMIT = 4096 * MB;

/**
 * Default digest delivery strategy.
 *
 * `real-file` preserves the historical behaviour: a `.md` `File` is pushed
 * through the host site's real upload pipeline. Users who hit upload failures
 * (sites that reject programmatic attachments) switch to `pseudo-file`.
 */
export const DEFAULT_DIGEST_SEND_MODE: DigestSendMode = 'real-file';

/**
 * Above this payload size the popup surface explains that pseudo-file mode
 * avoids the site's attachment pipeline entirely. Informational only — it
 * never overrides an explicit user choice.
 */
export const PSEUDO_MODE_ADVISE_BYTES = 2 * MB;

/** Maximum enabled files for a direct full digest. */
export const FULL_INGEST_MAX_FILES = 50;

/** Maximum files for an automatic subpath digest. */
export const SUBPATH_INGEST_MAX_FILES = 80;

/** Estimated token ceiling for a direct full digest. */
export const FULL_INGEST_MAX_TOKENS = 60_000;

/** Coarse byte-to-token ratio used before raw content is downloaded. */
export const BYTES_PER_TOKEN = 3.8;

/** Hard cap for a single raw file body. */
export const RAW_FILE_SIZE_CAP_BYTES = 60 * KB;

/** Concurrent raw content requests. */
export const RAW_FETCH_CONCURRENCY = 6;

/** Maximum files listed in the skeleton file index. */
export const SKELETON_INDEX_LIMIT = 200;

/** Maximum entrypoint excerpts included in a skeleton digest. */
export const SKELETON_ENTRY_LIMIT = 5;

/** Maximum configuration files included in a skeleton digest. */
export const SKELETON_CONFIG_LIMIT = 8;

/** Characters kept from each entrypoint excerpt. */
export const SKELETON_ENTRY_EXCERPT_CHARS = 4000;

/** How long a ready status pill stays visible before fading out. */
export const STATUS_PILL_FADE_MS = 3000;

/** Long-running ingest heartbeat that refreshes the guard watchdog. */
export const INGEST_HEARTBEAT_MS = 5000;
