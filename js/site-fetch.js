// The one baked-file reader of the public site (Part 4 item 7): GitHub Pages caches every file ten minutes and some browsers
// (older iPhone Safari) ignore the fetch cache mode, so each read revalidates AND carries the publish's own stamp in its
// address: a publish changes the address, so no cache can answer with older data. A leaf module: imports nothing, so the build copies it as is.
export const FRESH_FETCH = Object.freeze({ cache: "no-cache" });

/** How long the meta read may take before baked files fall back to the per-load address (a timer, not AbortSignal.timeout, which older iPhone Safari lacks). */
export const META_TIMEOUT_MS = 4000;

const BAKED_DIR = "baked";
const LOADED_AT = Date.now();
let metaTimeoutMs = META_TIMEOUT_MS;
let readPromise = null;

/** The address a baked read uses: `baked/` addresses get `v=<stamp>` appended; any other address is unchanged. */
export function versionedUrl(url, stamp) {
  if (!String(url).startsWith(`${BAKED_DIR}/`)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}v=${encodeURIComponent(stamp)}`;
}

/** The page load's one read of baked/meta.json at a unique address, as {meta, stamp}: meta is null when the read failed or timed out;
 *  stamp is its publishedAt, else `load-<ms>` with one warning naming why. */
function readPublish() {
  if (!readPromise) {
    readPromise = (async () => {
      const fallback = `load-${LOADED_AT}`;
      const timedOut = Symbol("timed out");
      let timer;
      const read = (async () => (await fetch(`baked/meta.json?t=${Date.now()}`, FRESH_FETCH)).json())();
      const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(timedOut), metaTimeoutMs); });
      let meta;
      try {
        meta = await Promise.race([read, timeout]);
      } catch (e) {
        console.warn("site: baked/meta.json could not be read, so baked files are read with a per-load address", e);
        return { meta: null, stamp: fallback };
      } finally {
        clearTimeout(timer);
      }
      if (meta === timedOut) {
        console.warn(`site: baked/meta.json did not answer within ${metaTimeoutMs} ms, so baked files are read with a per-load address`);
        return { meta: null, stamp: fallback };
      }
      const usable = meta && typeof meta === "object" && !Array.isArray(meta) ? meta : null;
      if (typeof usable?.publishedAt === "string" && usable.publishedAt) return { meta: usable, stamp: usable.publishedAt };
      console.warn("site: baked/meta.json has no publishedAt, so baked files are read with a per-load address");
      return { meta: usable, stamp: fallback };
    })();
  }
  return readPromise;
}

/** The stamp of the last publish (baked/meta.json publishedAt), from the page load's one meta read; a failed read gives `load-<ms>`. */
export async function publishStamp() {
  return (await readPublish()).stamp;
}

/** The published baked/meta.json object from the same single read as publishStamp, or null when it could not be read. */
export async function publishMeta() {
  return (await readPublish()).meta;
}

/** Test only: forget the remembered meta read; `timeoutMs` shortens the meta read's time limit for the next read. */
export function resetPublishStampForTest({ timeoutMs = META_TIMEOUT_MS } = {}) {
  readPromise = null;
  metaTimeoutMs = timeoutMs;
}

export async function getJson(url) {
  const address = url.startsWith(`${BAKED_DIR}/`) ? versionedUrl(url, await publishStamp()) : url;
  const res = await fetch(address, FRESH_FETCH);
  let data;
  try {
    data = await res.json();
  } catch (e) {
    throw new Error(`${url} did not return JSON (status ${res.status})`);
  }
  return data;
}
