// Small deterministic PRNG helpers for mock mode. Every random draw is keyed by a string (hub | date | hour | ...),
// never by call order, so the same key always gives the same value no matter what ran before.

/** cyrb53-style 53-bit string hash. */
export function hashString(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** mulberry32: a fast 32-bit PRNG. Returns a generator of floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A generator seeded by a key, for when one key needs several draws. */
export function rngFor(key: string): () => number {
  return mulberry32(hashString(key) % 4294967296);
}

/** Uniform [0, 1) for a key. */
export function uniform(key: string): number {
  return rngFor(key)();
}

/** Uniform in [-1, 1) for a key. */
export function symmetric(key: string): number {
  return uniform(key) * 2 - 1;
}

/** Standard normal for a key (Box-Muller), clamped to ±3 so a single draw can't produce an absurd value. */
export function gaussian(key: string): number {
  const next = rngFor(key);
  const u1 = Math.max(next(), 1e-12);
  const u2 = next();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(-3, Math.min(3, z));
}
