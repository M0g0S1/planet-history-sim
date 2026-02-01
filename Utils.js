// utils.js - Utilities: RNG, Simplex noise, typed-array helpers, unique ID gen

// Seeded PRNG using mulberry32
export class SeededRNG {
  constructor(seed = Date.now()) {
    this.seed = seed;
    this.state = seed;
  }

  next() {
    let t = this.state += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }

  range(min, max) {
    return min + this.next() * (max - min);
  }

  int(min, max) {
    return Math.floor(this.range(min, max + 1));
  }

  bool(chance = 0.5) {
    return this.next() < chance;
  }

  choice(arr) {
    return arr[this.int(0, arr.length - 1)];
  }
}

// Simplex noise implementation (2D)
class Grad {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }

  dot2(x, y) {
    return this.x * x + this.y * y;
  }
}

const grad3 = [
  new Grad(1,1), new Grad(-1,1), new Grad(1,-1), new Grad(-1,-1),
  new Grad(1,0), new Grad(-1,0), new Grad(0,1), new Grad(0,-1)
];

export class SimplexNoise {
  constructor(rng) {
    this.p = new Uint8Array(512);
    this.perm = new Uint8Array(512);
    
    // Fill with shuffled 0-255
    const p = [];
    for (let i = 0; i < 256; i++) p[i] = i;
    
    // Fisher-Yates shuffle using RNG
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    
    for (let i = 0; i < 512; i++) {
      this.p[i] = p[i & 255];
      this.perm[i] = this.p[i] % 8;
    }
  }

  noise2D(xin, yin) {
    const F2 = 0.5 * (Math.sqrt(3.0) - 1.0);
    const G2 = (3.0 - Math.sqrt(3.0)) / 6.0;

    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);

    const t = (i + j) * G2;
    const X0 = i - t;
    const Y0 = j - t;
    const x0 = xin - X0;
    const y0 = yin - Y0;

    let i1, j1;
    if (x0 > y0) { i1 = 1; j1 = 0; }
    else { i1 = 0; j1 = 1; }

    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1.0 + 2.0 * G2;
    const y2 = y0 - 1.0 + 2.0 * G2;

    const ii = i & 255;
    const jj = j & 255;

    let n0, n1, n2;

    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 < 0) n0 = 0.0;
    else {
      const gi0 = this.perm[ii + this.p[jj]];
      t0 *= t0;
      n0 = t0 * t0 * grad3[gi0].dot2(x0, y0);
    }

    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 < 0) n1 = 0.0;
    else {
      const gi1 = this.perm[ii + i1 + this.p[jj + j1]];
      t1 *= t1;
      n1 = t1 * t1 * grad3[gi1].dot2(x1, y1);
    }

    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 < 0) n2 = 0.0;
    else {
      const gi2 = this.perm[ii + 1 + this.p[jj + 1]];
      t2 *= t2;
      n2 = t2 * t2 * grad3[gi2].dot2(x2, y2);
    }

    return 70.0 * (n0 + n1 + n2);
  }
}

// Multi-octave noise
export function octaveNoise(noise, x, y, octaves = 4, persistence = 0.5, scale = 1.0) {
  let total = 0;
  let frequency = scale;
  let amplitude = 1;
  let maxValue = 0;

  for (let i = 0; i < octaves; i++) {
    total += noise.noise2D(x * frequency, y * frequency) * amplitude;
    maxValue += amplitude;
    amplitude *= persistence;
    frequency *= 2;
  }

  return total / maxValue;
}

// Unique ID generator
let idCounter = 0;
export function generateID(prefix = 'id') {
  return `${prefix}_${++idCounter}`;
}

// Helper to wrap X coordinate (horizontal wrapping)
export function wrapX(x, width) {
  while (x < 0) x += width;
  while (x >= width) x -= width;
  return x;
}

// Helper to clamp Y coordinate (no vertical wrapping)
export function clampY(y, height) {
  return Math.max(0, Math.min(height - 1, y));
}

// Convert (x,y) to 1D index
export function toIndex(x, y, width) {
  return y * width + x;
}

// Get neighbors (8-directional, with wrapping)
export function getNeighbors(x, y, width, height) {
  const neighbors = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = wrapX(x + dx, width);
      const ny = clampY(y + dy, height);
      neighbors.push({ x: nx, y: ny });
    }
  }
  return neighbors;
}

// Distance between two points (accounting for wrapping)
export function distance(x1, y1, x2, y2, width) {
  const dx = Math.min(Math.abs(x2 - x1), width - Math.abs(x2 - x1));
  const dy = Math.abs(y2 - y1);
  return Math.sqrt(dx * dx + dy * dy);
}

// Lerp
export function lerp(a, b, t) {
  return a + (b - a) * t;
}
