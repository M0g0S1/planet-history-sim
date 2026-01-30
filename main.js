// Realistic Planet Map Generator
// Optimized for speed and realistic geography

const canvas = document.getElementById('mapCanvas');
const ctx = canvas.getContext('2d', { alpha: false });
const generateBtn = document.getElementById('generateBtn');

// Resolution: balanced for quality and performance
const WIDTH = 1600;
const HEIGHT = 800;

// Fit canvas to window
function resizeCanvas() {
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  canvas.style.width = window.innerWidth + 'px';
  canvas.style.height = window.innerHeight + 'px';
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// Progress indicator
function setProgress(percent, text) {
  document.getElementById('progressBar').style.width = `${Math.floor(percent * 100)}%`;
  document.getElementById('progressText').innerText = text || '';
}

// Fast seeded random (xoshiro128**)
class Random {
  constructor(seed) {
    this.s = [0, 0, 0, 0];
    let h = 1779033703 ^ seed;
    for (let i = 0; i < 4; i++) {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      this.s[i] = (h ^= h >>> 16) >>> 0;
    }
  }
  
  next() {
    const t = this.s[1] << 9;
    let r = Math.imul(this.s[0], 5);
    r = ((r << 7) | (r >>> 25)) * 9;
    this.s[2] ^= this.s[0];
    this.s[3] ^= this.s[1];
    this.s[1] ^= this.s[2];
    this.s[0] ^= this.s[3];
    this.s[2] ^= t;
    this.s[3] = (this.s[3] << 11) | (this.s[3] >>> 21);
    return (r >>> 0) / 4294967296;
  }
  
  range(min, max) {
    return min + this.next() * (max - min);
  }
}

// Optimized 2D Perlin noise
class PerlinNoise {
  constructor(rng) {
    this.perm = new Uint8Array(512);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }
  
  fade(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }
  
  lerp(t, a, b) {
    return a + t * (b - a);
  }
  
  grad(hash, x, y) {
    const h = hash & 7;
    const u = h < 4 ? x : y;
    const v = h < 4 ? y : x;
    return ((h & 1) ? -u : u) + ((h & 2) ? -2 * v : 2 * v);
  }
  
  noise(x, y) {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    x -= Math.floor(x);
    y -= Math.floor(y);
    const u = this.fade(x);
    const v = this.fade(y);
    const a = this.perm[X] + Y;
    const b = this.perm[X + 1] + Y;
    
    return this.lerp(v,
      this.lerp(u, this.grad(this.perm[a], x, y), this.grad(this.perm[b], x - 1, y)),
      this.lerp(u, this.grad(this.perm[a + 1], x, y - 1), this.grad(this.perm[b + 1], x - 1, y - 1))
    );
  }
  
  fbm(x, y, octaves, persistence, lacunarity) {
    let total = 0;
    let amplitude = 1;
    let frequency = 1;
    let maxValue = 0;
    
    for (let i = 0; i < octaves; i++) {
      total += this.noise(x * frequency, y * frequency) * amplitude;
      maxValue += amplitude;
      amplitude *= persistence;
      frequency *= lacunarity;
    }
    
    return total / maxValue;
  }
}

// Main generation function
async function generatePlanet() {
  const seed = Date.now();
  const rng = new Random(seed);
  const noise = new PerlinNoise(rng);
  
  setProgress(0, 'Initializing...');
  
  // Data arrays
  const height = new Float32Array(WIDTH * HEIGHT);
  const moisture = new Float32Array(WIDTH * HEIGHT);
  const temperature = new Float32Array(WIDTH * HEIGHT);
  
  const idx = (x, y) => y * WIDTH + x;
  
  // STEP 1: Generate realistic continents using multi-scale noise
  setProgress(0.1, 'Forming continents...');
  
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const i = idx(x, y);
      
      // Normalized coordinates
      const nx = x / WIDTH;
      const ny = y / HEIGHT;
      
      // Latitude factor (higher at equator, lower at poles)
      const lat = Math.abs(ny * 2 - 1); // 0 at equator, 1 at poles
      const latFactor = 1 - lat * lat; // Reduces land at poles
      
      // Multi-octave continental shapes (large landmasses)
      const continentalScale = 2.5;
      const continental = noise.fbm(
        nx * continentalScale, 
        ny * continentalScale, 
        4, 
        0.5, 
        2.0
      );
      
      // Medium-scale terrain variation
      const terrainScale = 8;
      const terrain = noise.fbm(
        nx * terrainScale, 
        ny * terrainScale, 
        6, 
        0.6, 
        2.0
      );
      
      // Fine detail
      const detailScale = 25;
      const detail = noise.fbm(
        nx * detailScale, 
        ny * detailScale, 
        3, 
        0.5, 
        2.0
      );
      
      // Combine with proper weighting for realistic continents
      let elevation = continental * 0.65 + terrain * 0.25 + detail * 0.1;
      
      // Apply latitude bias (more land in mid-latitudes)
      elevation += latFactor * 0.15;
      
      // Add slight equatorial boost for tropical landmasses
      if (lat < 0.3) {
        elevation += 0.05;
      }
      
      height[i] = elevation;
    }
    
    if (y % 40 === 0) {
      setProgress(0.1 + (y / HEIGHT) * 0.3, `Continents: ${Math.floor(y / HEIGHT * 100)}%`);
      await sleep(0);
    }
  }
  
  // STEP 2: Define sea level and normalize
  setProgress(0.4, 'Adjusting sea level...');
  
  // Find good sea level (targeting ~35-40% land coverage)
  const sorted = new Float32Array(height).sort();
  const seaLevel = sorted[Math.floor(sorted.length * 0.58)]; // 58% water, 42% land
  
  // Normalize heights relative to sea level
  for (let i = 0; i < height.length; i++) {
    height[i] = (height[i] - seaLevel) * 2.5; // Amplify relief
  }
  
  // STEP 3: Add mountains at plate boundaries
  setProgress(0.45, 'Raising mountains...');
  
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const i = idx(x, y);
      const nx = x / WIDTH;
      const ny = y / HEIGHT;
      
      // Mountain ridges using different noise frequency
      const mountainScale = 6;
      const mountainNoise = Math.abs(noise.fbm(
        nx * mountainScale + 100, 
        ny * mountainScale + 100, 
        4, 
        0.5, 
        2.0
      ));
      
      // Only add mountains to land
      if (height[i] > 0) {
        const mountainBoost = Math.pow(mountainNoise, 2) * 0.8;
        height[i] += mountainBoost;
      }
    }
    
    if (y % 50 === 0) {
      setProgress(0.45 + (y / HEIGHT) * 0.15, `Mountains: ${Math.floor(y / HEIGHT * 100)}%`);
      await sleep(0);
    }
  }
  
  // STEP 4: Calculate temperature based on latitude and elevation
  setProgress(0.6, 'Calculating temperature...');
  
  for (let y = 0; y < HEIGHT; y++) {
    const lat = Math.abs((y / HEIGHT) * 2 - 1);
    
    for (let x = 0; x < WIDTH; x++) {
      const i = idx(x, y);
      
      // Base temperature from latitude (hot at equator, cold at poles)
      let temp = 1 - lat * 1.2;
      
      // Elevation cooling (higher = colder)
      if (height[i] > 0) {
        temp -= height[i] * 0.4;
      }
      
      // Ocean temperature moderation
      if (height[i] < 0) {
        temp += 0.1;
      }
      
      temperature[i] = Math.max(-1, Math.min(1, temp));
    }
    
    if (y % 50 === 0) {
      setProgress(0.6 + (y / HEIGHT) * 0.1, `Temperature: ${Math.floor(y / HEIGHT * 100)}%`);
      await sleep(0);
    }
  }
  
  // STEP 5: Calculate moisture/precipitation
  setProgress(0.7, 'Simulating climate...');
  
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const i = idx(x, y);
      const nx = x / WIDTH;
      const ny = y / HEIGHT;
      
      // Base precipitation pattern
      const precipScale = 4;
      let precip = noise.fbm(nx * precipScale + 500, ny * precipScale + 500, 4, 0.5, 2.0);
      precip = (precip + 1) / 2; // Normalize to 0-1
      
      // More rain near equator
      const lat = Math.abs((y / HEIGHT) * 2 - 1);
      precip *= 1 - lat * 0.5;
      
      // Coastal moisture (simplified - more rain near coasts)
      if (height[i] > 0 && height[i] < 0.2) {
        precip += 0.2;
      }
      
      // Rain shadow from mountains
      if (height[i] > 0.5) {
        precip *= 0.6;
      }
      
      moisture[i] = Math.max(0, Math.min(1, precip));
    }
    
    if (y % 50 === 0) {
      setProgress(0.7 + (y / HEIGHT) * 0.15, `Climate: ${Math.floor(y / HEIGHT * 100)}%`);
      await sleep(0);
    }
  }
  
  // STEP 6: Render the map
  setProgress(0.85, 'Rendering planet...');
  await renderPlanet(height, temperature, moisture);
  
  setProgress(1, 'Complete!');
}

// Render the final map
async function renderPlanet(height, temperature, moisture) {
  const imageData = ctx.createImageData(WIDTH, HEIGHT);
  const data = imageData.data;
  
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const i = y * WIDTH + x;
      const pi = i * 4;
      
      const h = height[i];
      const t = temperature[i];
      const m = moisture[i];
      
      let r, g, b;
      
      // OCEAN
      if (h < -0.05) {
        const depth = Math.max(0, Math.min(1, -h / 0.8));
        r = Math.floor(10 + depth * 15);
        g = Math.floor(30 + depth * 50);
        b = Math.floor(60 + depth * 140);
      }
      // SHALLOW WATER / COAST
      else if (h < 0) {
        r = 25;
        g = 80;
        b = 180;
      }
      // LAND BIOMES
      else {
        // ICE / SNOW (cold)
        if (t < -0.3) {
          const shade = 235 + h * 20;
          r = g = b = Math.floor(shade);
        }
        // TUNDRA (cold, some vegetation)
        else if (t < 0) {
          r = Math.floor(150 + m * 30);
          g = Math.floor(165 + m * 40);
          b = Math.floor(140 + m * 20);
        }
        // DESERT (hot, dry)
        else if (m < 0.25) {
          r = Math.floor(210 + t * 30);
          g = Math.floor(180 + t * 25);
          b = Math.floor(120 + t * 15);
        }
        // GRASSLAND (moderate moisture)
        else if (m < 0.5) {
          r = Math.floor(120 - m * 40);
          g = Math.floor(140 + m * 40);
          b = Math.floor(60 + m * 20);
        }
        // FOREST (good moisture)
        else if (m < 0.75) {
          r = Math.floor(50 + t * 30);
          g = Math.floor(100 + m * 60);
          b = Math.floor(40 + t * 20);
        }
        // RAINFOREST (very wet)
        else {
          r = Math.floor(30 + t * 20);
          g = Math.floor(100 + m * 80);
          b = Math.floor(40 + t * 30);
        }
        
        // MOUNTAINS (high elevation)
        if (h > 0.6) {
          const mountainFactor = (h - 0.6) / 0.4;
          const grayShade = 140 + h * 60;
          r = Math.floor(r * (1 - mountainFactor) + grayShade * mountainFactor);
          g = Math.floor(g * (1 - mountainFactor) + grayShade * mountainFactor);
          b = Math.floor(b * (1 - mountainFactor) + grayShade * mountainFactor);
        }
        
        // SNOW CAPS (very high + cold)
        if (h > 0.8 && t < 0.2) {
          r = g = b = 250;
        }
      }
      
      data[pi] = r;
      data[pi + 1] = g;
      data[pi + 2] = b;
      data[pi + 3] = 255;
    }
    
    if (y % 100 === 0) {
      setProgress(0.85 + (y / HEIGHT) * 0.14, `Rendering: ${Math.floor(y / HEIGHT * 100)}%`);
      await sleep(0);
    }
  }
  
  ctx.putImageData(imageData, 0, 0);
}

// Utility: non-blocking sleep
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Event handlers
generateBtn.addEventListener('click', async () => {
  generateBtn.disabled = true;
  try {
    await generatePlanet();
  } catch (err) {
    console.error(err);
    setProgress(0, 'Error: ' + err.message);
  } finally {
    generateBtn.disabled = false;
  }
});

// Auto-generate on load
window.addEventListener('load', () => {
  setTimeout(() => generateBtn.click(), 100);
});
