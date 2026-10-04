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
