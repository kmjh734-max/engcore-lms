import { randomBytes } from "crypto";

/**
 * Edge 읽어주기 창구의 Sec-MS-GEC v2 확인값 (2026-11 창구가 v1 을 막음).
 * 파이썬 edge-tts 7.3.1 drm.py 의 generate_sec_ms_gec_v2 를 그대로 옮겼다.
 * 결과 꼴: "<16자리 16진>-<64자리 16진>"
 * 32비트 곱셈이 JS 숫자 정밀도를 넘으므로 모두 BigInt 로 계산한다.
 */

const TRUSTED_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const WIN_EPOCH = 11_644_473_600;
const M = BigInt(0xffffffff);

const H = (xs: number[]) => xs.map((x) => BigInt(x));

const SHA_INITIAL = H([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
const SHA_STATE = H([0xfd9fbea2, 0x91243ce7, 0xbe499094, 0xcd2e1e0a, 0x6c006f49, 0x04bd35ab, 0xfeb0a7e4, 0x03effbd2]);
const SHA_SCHEDULE = H([
  0xeb24bf9e, 0x1558691f, 0xa0c09ee2, 0x0cfa32ba, 0xa622ee8c, 0xd1dd9491, 0xc0dd25a0, 0xf9e70ab6, 0xf0c31573,
  0x7058ce4e, 0x7188e606, 0x00e5ab33, 0xd258b060, 0x72766564,
]);
const K = H([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
]);
const SHA_ADJ = BigInt(0xc9dc06a7);
const K_BLOCK = [...K.slice(0, 14), SHA_ADJ, ...K.slice(15)];
const SIGMA0_ADJ = BigInt(0x059c0b80);
const SIGMA1_ADJ = BigInt(0x000b92c0);

const CS64_COEF: Array<[bigint, bigint]> = (
  [
    [0xe82e91b1, 0xb32700d0],
    [0x44de24c6, 0x88dff51d],
    [0x3beb65bc, 0x29514038],
    [0xc89c5933, 0xb328cbdf],
    [0x8d1ec211, 0xd405b4d5],
    [0x314ef5d5, 0x26e55f3c],
    [0xe92491b1, 0x607801c6],
    [0xf0a5b9d5, 0x82b2c1fb],
    [0x06064cf3, 0xfa51a3da],
    [0xda79fa60, 0x207cc464],
    [0xbed20560, 0x3c3c74f3],
    [0x89f9c9f8, 0xd2d14b61],
    [0x35fa38c6, 0xbb04a2c1],
    [0xcb49e3c6, 0xc5626167],
  ] as Array<[number, number]>
).map(([a, b]) => [BigInt(a), BigInt(b)]);
const CS64_FACTOR = BigInt(0x82893933);
const CS64_ADJ0 = BigInt(0xf2f90b1a);
const CS64_ADJ1 = BigInt(0x0b1a0000);

const rol16 = (v: bigint) => {
  v &= M;
  return ((v << BigInt(16)) | (v >> BigInt(16))) & M;
};
const rotr = (v: bigint, n: bigint) => ((v >> n) | (v << (BigInt(32) - n))) & M;
const sigma0 = (v: bigint) => ((v >> BigInt(7)) ^ (v << BigInt(25)) ^ (v >> BigInt(18)) ^ (v << BigInt(14)) ^ (v >> BigInt(3))) & M;
const sigma1 = (v: bigint) => ((v >> BigInt(17)) ^ (v << BigInt(15)) ^ (v >> BigInt(19)) ^ (v << BigInt(13)) ^ (v >> BigInt(10))) & M;

function beInt(bytes: Buffer): bigint {
  let v = BigInt(0);
  for (const b of bytes) v = (v << BigInt(8)) | BigInt(b);
  return v;
}

function expand(words: bigint[], first = 16) {
  for (let i = first; i < 64; i++) {
    words.push((sigma1(words[i - 2]) + words[i - 7] + sigma0(words[i - 15]) + words[i - 16]) & M);
  }
}

function rounds(state: bigint[], words: bigint[], first = 0): bigint[] {
  let [a, b, c, d, e, f, g, h] = state;
  const k = first === 14 ? K_BLOCK : K;
  for (let i = first; i < 64; i++) {
    const s1 = rotr(e, BigInt(6)) ^ rotr(e, BigInt(11)) ^ rotr(e, BigInt(25));
    const ch = g ^ (e & (f ^ g));
    const t1 = (h + s1 + ch + k[i] + words[i]) & M;
    const s0 = rotr(a, BigInt(2)) ^ rotr(a, BigInt(13)) ^ rotr(a, BigInt(22));
    const maj = (a & b) | (c & (a | b));
    const t2 = (s0 + maj) & M;
    h = g;
    g = f;
    f = e;
    e = (d + t1) & M;
    d = c;
    c = b;
    b = a;
    a = (t1 + t2) & M;
  }
  return [a, b, c, d, e, f, g, h];
}

function shaInit(data: Buffer): bigint[] {
  const w: bigint[] = [...Array(14).fill(BigInt(0)), beInt(data.subarray(0, 3)), beInt(data.subarray(3, 7))];
  for (let i = 16; i < 30; i++) {
    let v = SHA_SCHEDULE[i - 16];
    if (i - 2 >= 14) v += i === 16 ? sigma1(w[i - 2]) ^ SIGMA1_ADJ : sigma1(w[i - 2]);
    if (i - 7 >= 14) v += w[i - 7];
    if (i - 15 >= 14) v += i === 29 ? sigma0(w[i - 15]) ^ SIGMA0_ADJ : sigma0(w[i - 15]);
    w.push(v & M);
  }
  w.push((sigma1(w[28]) + w[23] + sigma0(w[15]) + w[14] + SHA_ADJ - K[14]) & M);
  expand(w, 31);
  const working = rounds(SHA_STATE, w, 14);
  return SHA_INITIAL.map((x, i) => (x + working[i]) & M);
}

function shaDigest(data: Buffer): Buffer {
  const length = 57 + data.length;
  const padLen = (((55 - length) % 64) + 64) % 64;
  const lenBuf = Buffer.alloc(8);
  lenBuf.writeBigUInt64BE(BigInt(length * 8));
  const padded = Buffer.concat([data.subarray(7), Buffer.from([0x80]), Buffer.alloc(padLen), lenBuf]);
  let state = shaInit(data.subarray(0, 7));
  for (let off = 0; off < padded.length; off += 64) {
    const words: bigint[] = [];
    for (let j = 0; j < 16; j++) words.push(BigInt(padded.readUInt32BE(off + j * 4)));
    expand(words);
    const working = rounds(state, words);
    state = state.map((x, i) => (x + working[i]) & M);
  }
  const out = Buffer.alloc(32);
  state.forEach((x, i) => out.writeUInt32BE(Number(x), i * 4));
  return out;
}

function wordsLe4Even(data: Buffer): bigint[] {
  const pad = (4 - (data.length % 4)) % 4;
  const padded = Buffer.concat([data, Buffer.alloc(pad)]);
  const words: bigint[] = [];
  for (let i = 0; i < padded.length; i += 4) words.push(BigInt(padded.readUInt32LE(i)));
  if (words.length % 2) words.push(BigInt(0));
  return words;
}

function cs64(data: Buffer, digest: Buffer): [bigint, bigint] {
  const keyA = BigInt(digest.readUInt32LE(0)) | BigInt(1);
  const keyB = BigInt(digest.readUInt32LE(4)) | BigInt(1);
  const factors = [(keyA * CS64_FACTOR) & M, (keyB * CS64_FACTOR) & M];
  const terms = CS64_COEF.map(([c], i) => (c * factors[i % 2]) & M);
  const offsets = CS64_COEF.map(([, o]) => o);
  wordsLe4Even(Buffer.concat([Buffer.from([0]), data])).forEach((word, i) => {
    let term = word * (i % 2 === 0 ? keyA : keyB);
    let offset = rol16(word) * (i % 2 === 0 ? BigInt(0xef0569fb) : BigInt(0xc31713db));
    if (i === 0) {
      term += CS64_ADJ0 * factors[0];
      offset += CS64_ADJ1;
    }
    terms.push(term & M);
    offsets.push(offset & M);
  });
  let swapAcc = BigInt(0);
  let swapLast = BigInt(0);
  let state = BigInt(0);
  let acc = BigInt(0);
  for (let i = 0; i < terms.length; i += 2) {
    const x = terms[i];
    const y = terms[i + 1];
    let t = rol16((offsets[i] + x) & M);
    let q = (t * BigInt(0x76f50f34)) & M;
    swapAcc += (rol16(q) * BigInt(0xc3efea97) + q) & M;
    t = rol16((offsets[i + 1] + y) & M);
    q = (t * BigInt(0x1881ce3c)) & M;
    swapLast = (rol16(q) * BigInt(0x35bd1ec9) + q) & M;
    swapAcc = (swapAcc + swapLast) & M;

    state = (state * keyA + x) & M;
    state = (rol16(state) * BigInt(0xcf98b111)) & M;
    state = (rol16(state) * BigInt(0x87085b9f)) & M;
    state = (rol16(state) * BigInt(0x12ceb96d)) & M;
    state = (rol16(state) * BigInt(0x257e1d83)) & M;
    acc += state;
    t = (state * keyB + y) & M;
    t = (rol16(t) * BigInt(0xa27416f5)) & M;
    t = (rol16(t) * BigInt(0xd38396ff)) & M;
    state = (rol16((rol16(t) * BigInt(0x7c932b89)) & M) * BigInt(0xbfa49f69)) & M;
    acc = (acc + state) & M;
  }
  return [swapLast ^ state, swapAcc ^ acc];
}

/** 확인값 v2 — unixSeconds 는 시험용(없으면 지금 시각) */
export function secMsGecV2(unixSeconds: number = Date.now() / 1000): string {
  let ticks = unixSeconds + WIN_EPOCH;
  ticks -= ticks % 300;
  ticks *= 1e9 / 100;
  const data = Buffer.from(`${ticks.toFixed(0)}${TRUSTED_TOKEN}`, "ascii");
  const digest = shaDigest(data);
  const [w0, w1] = cs64(data, digest);
  const cs = Buffer.alloc(8);
  cs.writeUInt32LE(Number(w0), 0);
  cs.writeUInt32LE(Number(w1), 4);
  return `${cs.toString("hex").toUpperCase()}-${digest.toString("hex").toUpperCase()}`;
}

/** 창구가 함께 요구하는 쿠키 값 */
export function edgeMuid(): string {
  return randomBytes(16).toString("hex").toUpperCase();
}
