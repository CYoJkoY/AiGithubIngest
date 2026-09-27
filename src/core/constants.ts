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
