/** Stable, roughly time-sortable identifiers: `<prefix>_<time36><random>`. */
export function newId(prefix: string): string {
  const time = Date.now().toString(36);
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(36).padStart(2, '0'))
    .join('')
    .slice(0, 8);
  return `${prefix}_${time}${rand}`;
}


/**
 * FNV-1a-style 64-bit hex digest. Used ONLY for demo fingerprints and the demo audit
 * hash chain. It is not a cryptographic hash and provides no real tamper protection;
 * production must use a proper algorithm (e.g. SHA-256) server-side.
 */
export function demoHash(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ input.length;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}
