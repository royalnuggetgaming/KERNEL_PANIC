/**
 * Hashing: crc32 and fnv1a over UTF-8 bytes, streaming fnv1a mixers for numbers (stateHash),
 * and a key-order-independent JSON stringify. No TextEncoder (pure layers have no DOM/node libs).
 */

const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** Calls fn(byte) for every UTF-8 byte of s (lone surrogates encode as U+FFFD). */
function forEachUtf8Byte(s: string, fn: (b: number) => void): void {
  for (let i = 0; i < s.length; i++) {
    let cp = s.charCodeAt(i);
    if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < s.length) {
      const lo = s.charCodeAt(i + 1);
      if (lo >= 0xdc00 && lo <= 0xdfff) {
        cp = 0x10000 + ((cp - 0xd800) << 10) + (lo - 0xdc00);
        i++;
      } else cp = 0xfffd;
    } else if (cp >= 0xd800 && cp <= 0xdfff) cp = 0xfffd;
    if (cp < 0x80) fn(cp);
    else if (cp < 0x800) {
      fn(0xc0 | (cp >> 6));
      fn(0x80 | (cp & 63));
    } else if (cp < 0x10000) {
      fn(0xe0 | (cp >> 12));
      fn(0x80 | ((cp >> 6) & 63));
      fn(0x80 | (cp & 63));
    } else {
      fn(0xf0 | (cp >> 18));
      fn(0x80 | ((cp >> 12) & 63));
      fn(0x80 | ((cp >> 6) & 63));
      fn(0x80 | (cp & 63));
    }
  }
}

/** IEEE crc32 of the UTF-8 encoding of s, as an unsigned 32-bit integer. */
export function crc32(s: string): number {
  let c = 0xffffffff;
  forEachUtf8Byte(s, (b) => {
    c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  });
  return (c ^ 0xffffffff) >>> 0;
}

export const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** 32-bit FNV-1a of the UTF-8 encoding of s (unsigned). */
export function fnv1a(s: string): number {
  let h = FNV_OFFSET;
  forEachUtf8Byte(s, (b) => {
    h = Math.imul(h ^ b, FNV_PRIME);
  });
  return h >>> 0;
}

/** Mixes the 4 bytes of a 32-bit integer into h (little-endian). */
export function fnv1aMixU32(h: number, n: number): number {
  let x = h;
  x = Math.imul(x ^ (n & 0xff), FNV_PRIME);
  x = Math.imul(x ^ ((n >>> 8) & 0xff), FNV_PRIME);
  x = Math.imul(x ^ ((n >>> 16) & 0xff), FNV_PRIME);
  x = Math.imul(x ^ ((n >>> 24) & 0xff), FNV_PRIME);
  return x >>> 0;
}

const F64 = new Float64Array(1);
const F64_WORDS = new Uint32Array(F64.buffer);

/** Mixes the exact bits of a float64 into h (allocation-free). -0 and 0 hash differently. */
export function fnv1aMixF64(h: number, x: number): number {
  F64[0] = x;
  return fnv1aMixU32(fnv1aMixU32(h, F64_WORDS[0]!), F64_WORDS[1]!);
}

/**
 * JSON.stringify with object keys sorted recursively; undefined-valued keys are omitted and non-finite
 * numbers become null, exactly like JSON.stringify.
 */
export function stableStringify(value: unknown): string {
  return stringifyInner(value) ?? 'null';
}

function stringifyInner(v: unknown): string | undefined {
  if (v === null) return 'null';
  switch (typeof v) {
    case 'number':
      return Number.isFinite(v) ? JSON.stringify(v) : 'null';
    case 'string':
    case 'boolean':
      return JSON.stringify(v);
    case 'undefined':
    case 'function':
    case 'symbol':
      return undefined;
    case 'bigint':
      throw new TypeError('stableStringify: bigint is not serialisable');
    case 'object': {
      if (Array.isArray(v)) {
        const parts: string[] = [];
        for (const item of v as readonly unknown[]) parts.push(stringifyInner(item) ?? 'null');
        return `[${parts.join(',')}]`;
      }
      const obj = v as Record<string, unknown>;
      const keys = Object.keys(obj).sort();
      const parts: string[] = [];
      for (const k of keys) {
        const s = stringifyInner(obj[k]);
        if (s !== undefined) parts.push(`${JSON.stringify(k)}:${s}`);
      }
      return `{${parts.join(',')}}`;
    }
  }
  return undefined;
}
