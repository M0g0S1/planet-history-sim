// ===== CANVAS SETUP =====
const mapCanvas = document.getElementById('mapCanvas');
const mapCtx = mapCanvas.getContext('2d', { alpha: false });
const cloudsCanvas = document.getElementById('cloudsCanvas');
const cloudsCtx = cloudsCanvas.getContext('2d', { alpha: true });

// Map resolution (equirectangular projection)
const MAP_WIDTH = 2048;
const MAP_HEIGHT = 1024;

// Camera state (HOI4-style pan & zoom)
const camera = {
  x: 0,              // Camera offset X (wraps horizontally)
  y: 0,              // Camera offset Y
  zoom: 1.0,         // Zoom level
  targetZoom: 1.0,   // Target zoom for smooth zooming
  minZoom: 0.5,
  maxZoom: 4.0,
  isDragging: false,
  dragStartX: 0,
  dragStartY: 0,
  dragStartCamX: 0,
  dragStartCamY: 0
};

// Cloud animation
let cloudOffset = 0;

// Planet data (stored after generation)
let planetData = null;

// ===== INITIALIZATION =====
function initCanvases() {
  // Set internal resolution
  mapCanvas.width = MAP_WIDTH;
  mapCanvas.height = MAP_HEIGHT;
  cloudsCanvas.width = MAP_WIDTH;
  cloudsCanvas.height = MAP_HEIGHT;
  
  // Set display size to window
  resizeCanvases();
}

function resizeCanvases() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  
  mapCanvas.style.width = w + 'px';
  mapCanvas.style.height = h + 'px';
  cloudsCanvas.style.width = w + 'px';
  cloudsCanvas.style.height = h + 'px';
  
  // Redraw if planet exists
  if (planetData) {
    renderCamera();
  }
}

window.addEventListener('resize', resizeCanvases);

// ===== PROGRESS INDICATOR =====
function setProgress(percent, text) {
  document.getElementById('progressBar').style.width = `${Math.floor(percent * 100)}%`;
  document.getElementById('progressText').innerText = text || '';
}

// ===== RANDOM NUMBER GENERATOR =====
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

// ===== IMPROVED PERLIN NOISE =====
class PerlinNoise {
  constructor(rng) {
    this.perm = new Uint8Array(512);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    
    // Fisher-Yates shuffle
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
  
  fbm(x, y, octaves, persistence, lacunarity, warp = 0) {
    let total = 0;
    let amplitude = 1;
    let frequency = 1;
    let maxValue = 0;
    
    // Domain warping for more organic shapes
    if (warp > 0) {
      x += this.noise(x * 0.5, y * 0.5) * warp;
      y += this.noise(x * 0.5 + 100, y * 0.5 + 100) * warp;
    }
    
    for (let i = 0; i < octaves; i++) {
      total += this.noise(x * frequency, y * frequency) * amplitude;
      maxValue += amplitude;
      amplitude *= persistence;
      frequency *= lacunarity;
    }
    
    return total / maxValue;
  }
}

// ===== PLANET GENERATION =====
async function generatePlanet() {
  const seed = Date.now();
  const rng = new Random(seed);
  const noise = new PerlinNoise(rng);
  
  setProgress(0, 'Initializing...');
  
  // Data arrays
  const height = new Float32Array(MAP_WIDTH * MAP_HEIGHT);
  const moisture = new Float32Array(MAP_WIDTH * MAP_HEIGHT);
  const temperature = new Float32Array(MAP_WIDTH * MAP_HEIGHT);
  
  const idx = (x, y) => y * MAP_WIDTH + x;
  
  // STEP 1: Generate base continental shapes with domain warping
  setProgress(0.05, 'Forming continents...');
  
  for (let y = 0; y < MAP_HEIGHT; y++) {
    for (let x = 0; x < MAP_WIDTH; x++) {
      const i = idx(x, y);
      
      const nx = x / MAP_WIDTH;
      const ny = y / MAP_HEIGHT;
      
      // Latitude effects
      const lat = Math.abs(ny * 2 - 1);
      const latWeight = 1 - Math.pow(lat, 1.5) * 0.3; // Less land at poles
      
      // Large continental masses with domain warping
      const continentalScale = 2.2;
      const continental = noise.fbm(
        nx * continentalScale, 
        ny * continentalScale, 
        5, 
        0.55, 
        2.1,
        0.5  // Domain warp for organic shapes
      );
      
      // Medium terrain features
      const terrainScale = 7;
      const terrain = noise.fbm(
        nx * terrainScale + 50, 
        ny * terrainScale + 50, 
        5, 
        0.6, 
        2.0
      );
      
      // Fine details
      const detailScale = 20;
      const detail = noise.fbm(
        nx * detailScale + 200, 
        ny * detailScale + 200, 
        4, 
        0.5, 
        2.0
      );
      
      // Combine layers smoothly
      let elevation = continental * 0.60 + terrain * 0.28 + detail * 0.12;
      elevation *= latWeight;
      
      // Slight equatorial boost
      if (lat < 0.35) {
        elevation += 0.08 * (1 - lat / 0.35);
      }
      
      height[i] = elevation;
    }
    
    if (y % 50 === 0) {
      setProgress(0.05 + (y / MAP_HEIGHT) * 0.25, `Continents: ${Math.floor(y / MAP_HEIGHT * 100)}%`);
      await sleep(0);
    }
  }
  
  // STEP 2: Normalize and set sea level
  setProgress(0.30, 'Adjusting sea level...');
  
  const sorted = new Float32Array(height).sort();
  const seaLevel = sorted[Math.floor(sorted.length * 0.60)]; // ~40% land
  
  for (let i = 0; i < height.length; i++) {
    height[i] = (height[i] - seaLevel) * 2.8;
  }
  
  // STEP 3: Add realistic mountain ranges
  setProgress(0.35, 'Raising mountains...');
  
  for (let y = 0; y < MAP_HEIGHT; y++) {
    for (let x = 0; x < MAP_WIDTH; x++) {
      const i = idx(x, y);
      const nx = x / MAP_WIDTH;
      const ny = y / MAP_HEIGHT;
      
      if (height[i] > 0.05) {
        // Mountain ridges (using ridged noise)
        const mountainScale = 5;
        let mountainNoise = noise.fbm(
          nx * mountainScale + 300, 
          ny * mountainScale + 300, 
          4, 
          0.5, 
          2.2
        );
        
        // Ridged effect (absolute value creates ridges)
        mountainNoise = 1 - Math.abs(mountainNoise);
        mountainNoise = Math.pow(mountainNoise, 2.5);
        
        height[i] += mountainNoise * 0.7;
      }
    }
    
    if (y % 60 === 0) {
      setProgress(0.35 + (y / MAP_HEIGHT) * 0.15, `Mountains: ${Math.floor(y / MAP_HEIGHT * 100)}%`);
      await sleep(0);
    }
  }
  
  // STEP 4: Temperature (latitude + elevation)
  setProgress(0.50, 'Calculating temperature...');
  
  for (let y = 0; y < MAP_HEIGHT; y++) {
    const lat = Math.abs((y / MAP_HEIGHT) * 2 - 1);
    
    for (let x = 0; x < MAP_WIDTH; x++) {
      const i = idx(x, y);
      
      let temp = 1 - lat * 1.3; // Base from latitude
      
      if (height[i] > 0) {
        temp -= height[i] * 0.45; // Elevation cooling
      } else {
        temp += 0.12; // Ocean moderation
      }
      
      // Add slight variation
      const nx = x / MAP_WIDTH;
      const ny = y / MAP_HEIGHT;
      temp += noise.noise(nx * 8 + 400, ny * 8 + 400) * 0.08;
      
      temperature[i] = Math.max(-1, Math.min(1, temp));
    }
    
    if (y % 60 === 0) {
      setProgress(0.50 + (y / MAP_HEIGHT) * 0.10, `Temperature: ${Math.floor(y / MAP_HEIGHT * 100)}%`);
      await sleep(0);
    }
  }
  
  // STEP 5: Moisture/precipitation
  setProgress(0.60, 'Simulating climate...');
  
  for (let y = 0; y < MAP_HEIGHT; y++) {
    for (let x = 0; x < MAP_WIDTH; x++) {
      const i = idx(x, y);
      const nx = x / MAP_WIDTH;
      const ny = y / MAP_HEIGHT;
      const lat = Math.abs((y / MAP_HEIGHT) * 2 - 1);
      
      // Base precipitation pattern
      let precip = noise.fbm(nx * 5 + 500, ny * 5 + 500, 4, 0.5, 2.0);
      precip = (precip + 1) / 2; // 0-1 range
      
      // More rain near equator
      precip *= 1.2 - lat * 0.6;
      
      // Coastal moisture
      if (height[i] > 0 && height[i] < 0.15) {
        precip += 0.25;
      }
      
      // Rain shadow (mountains block moisture)
      if (height[i] > 0.5) {
        precip *= 0.5;
      }
      
      // Ocean has moisture but not "precipitation"
      if (height[i] < 0) {
        precip = 0.6;
      }
      
      moisture[i] = Math.max(0, Math.min(1.2, precip));
    }
    
    if (y % 60 === 0) {
      setProgress(0.60 + (y / MAP_HEIGHT) * 0.15, `Climate: ${Math.floor(y / MAP_HEIGHT * 100)}%`);
      await sleep(0);
    }
  }
  
  // STEP 6: Render to texture
  setProgress(0.75, 'Rendering planet...');
  await renderPlanetTexture(height, temperature, moisture);
  
  // STEP 7: Generate clouds layer
  setProgress(0.90, 'Generating clouds...');
  await generateClouds(rng, noise);
  
  // Store planet data
  planetData = { height, temperature, moisture, seed };
  
  setProgress(1, 'Complete!');
  return planetData;
}

// ===== RENDER PLANET TO TEXTURE =====
async function renderPlanetTexture(height, temperature, moisture) {
  // Create a separate canvas for the base texture
  const textureCanvas = document.createElement('canvas');
  textureCanvas.width = MAP_WIDTH;
  textureCanvas.height = MAP_HEIGHT;
  const textureCtx = textureCanvas.getContext('2d', { alpha: false });
  
  const imageData = textureCtx.createImageData(MAP_WIDTH, MAP_HEIGHT);
  const data = imageData.data;
  
  for (let y = 0; y < MAP_HEIGHT; y++) {
    for (let x = 0; x < MAP_WIDTH; x++) {
      const i = y * MAP_WIDTH + x;
      const pi = i * 4;
      
      const h = height[i];
      const t = temperature[i];
      const m = moisture[i];
      
      let r, g, b;
      
      // OCEAN
      if (h < -0.08) {
        const depth = Math.max(0, Math.min(1, -h / 1.0));
        r = Math.floor(8 + depth * 18);
        g = Math.floor(25 + depth * 55);
        b = Math.floor(50 + depth * 150);
      }
      // SHALLOW WATER
      else if (h < 0) {
        r = 22;
        g = 70;
        b = 160;
      }
      // LAND
      else {
        // ICE / SNOW
        if (t < -0.35) {
          const shade = 240 + h * 15;
          r = g = b = Math.floor(shade);
        }
        // TUNDRA
        else if (t < -0.05) {
          r = Math.floor(145 + m * 35);
          g = Math.floor(160 + m * 45);
          b = Math.floor(135 + m * 25);
        }
        // DESERT
        else if (m < 0.22) {
          r = Math.floor(205 + t * 35);
          g = Math.floor(175 + t * 28);
          b = Math.floor(115 + t * 18);
        }
        // GRASSLAND
        else if (m < 0.48) {
          r = Math.floor(125 - m * 45);
          g = Math.floor(145 + m * 45);
          b = Math.floor(65 + m * 25);
        }
        // TEMPERATE FOREST
        else if (m < 0.75) {
          r = Math.floor(55 + t * 30);
          g = Math.floor(105 + m * 55);
          b = Math.floor(45 + t * 20);
        }
        // RAINFOREST
        else {
          r = Math.floor(35 + t * 20);
          g = Math.floor(95 + m * 75);
          b = Math.floor(45 + t * 25);
        }
        
        // MOUNTAINS
        if (h > 0.55) {
          const mountainFactor = Math.min(1, (h - 0.55) / 0.45);
          const grayBase = 135 + h * 70;
          r = Math.floor(r * (1 - mountainFactor) + grayBase * mountainFactor);
          g = Math.floor(g * (1 - mountainFactor) + grayBase * mountainFactor);
          b = Math.floor(b * (1 - mountainFactor) + grayBase * mountainFactor);
        }
        
        // SNOW PEAKS
        if (h > 0.75 && t < 0.15) {
          const snowFactor = Math.min(1, (h - 0.75) / 0.25);
          r = Math.floor(r * (1 - snowFactor) + 248 * snowFactor);
          g = Math.floor(g * (1 - snowFactor) + 250 * snowFactor);
          b = Math.floor(b * (1 - snowFactor) + 252 * snowFactor);
        }
      }
      
      data[pi] = r;
      data[pi + 1] = g;
      data[pi + 2] = b;
      data[pi + 3] = 255;
    }
    
    if (y % 100 === 0) {
      setProgress(0.75 + (y / MAP_HEIGHT) * 0.14, `Rendering: ${Math.floor(y / MAP_HEIGHT * 100)}%`);
      await sleep(0);
    }
  }
  
  textureCtx.putImageData(imageData, 0, 0);
  
  // Store the base texture
  basePlanetTexture = textureCanvas;
  
  // Draw initial view to display canvas
  mapCtx.drawImage(textureCanvas, 0, 0);
}

// ===== GENERATE CLOUD LAYER =====
async function generateClouds(rng, noise) {
  // Create a separate canvas for the cloud texture
  const cloudTextureCanvas = document.createElement('canvas');
  cloudTextureCanvas.width = MAP_WIDTH;
  cloudTextureCanvas.height = MAP_HEIGHT;
  const cloudTextureCtx = cloudTextureCanvas.getContext('2d', { alpha: true });
  
  const imageData = cloudTextureCtx.createImageData(MAP_WIDTH, MAP_HEIGHT);
  const data = imageData.data;
  
  for (let y = 0; y < MAP_HEIGHT; y++) {
    for (let x = 0; x < MAP_WIDTH; x++) {
      const i = y * MAP_WIDTH + x;
      const pi = i * 4;
      
      const nx = x / MAP_WIDTH;
      const ny = y / MAP_HEIGHT;
      
      // Cloud noise (separate from terrain)
      const cloudDensity = noise.fbm(nx * 8 + 1000, ny * 8 + 1000, 4, 0.6, 2.1);
      
      // More clouds near equator
      const lat = Math.abs(ny * 2 - 1);
      const cloudBoost = 1 - lat * 0.4;
      
      let alpha = (cloudDensity + 0.3) * cloudBoost;
      alpha = Math.max(0, Math.min(0.6, alpha));
      
      // White clouds
      data[pi] = 255;
      data[pi + 1] = 255;
      data[pi + 2] = 255;
      data[pi + 3] = Math.floor(alpha * 180); // Semi-transparent
    }
  }
  
  cloudTextureCtx.putImageData(imageData, 0, 0);
  
  // Store the base cloud texture
  baseCloudTexture = cloudTextureCanvas;
  
  // Draw initial clouds to display canvas
  cloudsCtx.drawImage(cloudTextureCanvas, 0, 0);
}

// Store the base planet texture separately
let basePlanetTexture = null;
let baseCloudTexture = null;

// ===== CAMERA SYSTEM (HOI4-style) =====
function renderCamera() {
  if (!basePlanetTexture) return;
  
  const screenWidth = window.innerWidth;
  const screenHeight = window.innerHeight;
  
  // Calculate zoom
  const zoomedWidth = MAP_WIDTH * camera.zoom;
  const zoomedHeight = MAP_HEIGHT * camera.zoom;
  
  // Clamp Y (no vertical wrapping)
  const maxY = Math.max(0, zoomedHeight - screenHeight);
  camera.y = Math.max(0, Math.min(maxY, camera.y));
  
  // X wraps infinitely
  camera.x = ((camera.x % MAP_WIDTH) + MAP_WIDTH) % MAP_WIDTH;
  
  // Clear main canvas
  mapCtx.fillStyle = '#081420';
  mapCtx.fillRect(0, 0, MAP_WIDTH, MAP_HEIGHT);
  
  // Calculate what portion of the base texture to show
  const sourceX = camera.x;
  const sourceY = camera.y;
  const sourceWidth = Math.min(MAP_WIDTH, screenWidth / camera.zoom);
  const sourceHeight = Math.min(MAP_HEIGHT, screenHeight / camera.zoom);
  
  // Draw main view
  mapCtx.drawImage(
    basePlanetTexture,
    sourceX, sourceY, sourceWidth, sourceHeight,
    0, 0, MAP_WIDTH, MAP_HEIGHT
  );
  
  // Handle horizontal wrapping
  if (sourceX + sourceWidth > MAP_WIDTH) {
    const wrapWidth = (sourceX + sourceWidth) - MAP_WIDTH;
    mapCtx.drawImage(
      basePlanetTexture,
      0, sourceY, wrapWidth, sourceHeight,
      (sourceWidth - wrapWidth) * (MAP_WIDTH / sourceWidth), 0, 
      wrapWidth * (MAP_WIDTH / sourceWidth), MAP_HEIGHT
    );
  }
  
  // Render clouds
  renderClouds();
}

function renderClouds() {
  if (!baseCloudTexture) return;
  
  const screenWidth = window.innerWidth;
  const screenHeight = window.innerHeight;
  
  // Clear clouds canvas
  cloudsCtx.clearRect(0, 0, MAP_WIDTH, MAP_HEIGHT);
  
  const zoomedWidth = MAP_WIDTH * camera.zoom;
  const zoomedHeight = MAP_HEIGHT * camera.zoom;
  
  const sourceWidth = Math.min(MAP_WIDTH, screenWidth / camera.zoom);
  const sourceHeight = Math.min(MAP_HEIGHT, screenHeight / camera.zoom);
  
  // Cloud offset for animation
  const cloudX = (camera.x + cloudOffset) % MAP_WIDTH;
  const sourceY = camera.y;
  
  // Draw main clouds
  cloudsCtx.drawImage(
    baseCloudTexture,
    cloudX, sourceY, sourceWidth, sourceHeight,
    0, 0, MAP_WIDTH, MAP_HEIGHT
  );
  
  // Handle wrapping
  if (cloudX + sourceWidth > MAP_WIDTH) {
    const wrapWidth = (cloudX + sourceWidth) - MAP_WIDTH;
    cloudsCtx.drawImage(
      baseCloudTexture,
      0, sourceY, wrapWidth, sourceHeight,
      (sourceWidth - wrapWidth) * (MAP_WIDTH / sourceWidth), 0,
      wrapWidth * (MAP_WIDTH / sourceWidth), MAP_HEIGHT
    );
  }
}

// ===== CAMERA CONTROLS =====
mapCanvas.addEventListener('mousedown', (e) => {
  camera.isDragging = true;
  camera.dragStartX = e.clientX;
  camera.dragStartY = e.clientY;
  camera.dragStartCamX = camera.x;
  camera.dragStartCamY = camera.y;
  mapCanvas.style.cursor = 'grabbing';
});

window.addEventListener('mousemove', (e) => {
  if (!camera.isDragging) return;
  
  const dx = e.clientX - camera.dragStartX;
  const dy = e.clientY - camera.dragStartY;
  
  camera.x = camera.dragStartCamX - dx / camera.zoom;
  camera.y = camera.dragStartCamY - dy / camera.zoom;
  
  renderCamera();
});

window.addEventListener('mouseup', () => {
  camera.isDragging = false;
  mapCanvas.style.cursor = 'grab';
});

// Zoom with mouse wheel
mapCanvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  
  const zoomSpeed = 0.1;
  const delta = e.deltaY > 0 ? -zoomSpeed : zoomSpeed;
  
  camera.targetZoom = Math.max(camera.minZoom, Math.min(camera.maxZoom, camera.zoom + delta));
  
  // Smooth zoom
  smoothZoom();
});

function smoothZoom() {
  camera.zoom += (camera.targetZoom - camera.zoom) * 0.15;
  
  if (Math.abs(camera.targetZoom - camera.zoom) > 0.01) {
    requestAnimationFrame(smoothZoom);
  }
  
  renderCamera();
}

mapCanvas.style.cursor = 'grab';

// ===== CLOUD ANIMATION =====
function animateClouds() {
  cloudOffset += 0.15; // Slow drift
  if (cloudOffset > MAP_WIDTH) cloudOffset = 0;
  
  if (planetData) {
    renderCamera();
  }
  
  requestAnimationFrame(animateClouds);
}

// ===== UTILITY =====
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ===== MENU SYSTEM =====
document.getElementById('playBtn').addEventListener('click', async () => {
  // Hide menu
  document.getElementById('mainMenu').style.display = 'none';
  document.getElementById('gameView').style.display = 'block';
  
  // Initialize
  initCanvases();
  
  // Generate planet
  try {
    await generatePlanet();
    
    // Hide progress UI
    document.getElementById('progressUI').classList.add('hidden');
    
    // Show game UI
    document.getElementById('gameUI').style.display = 'block';
    
    // Start camera rendering
    renderCamera();
    animateClouds();
    
  } catch (err) {
    console.error(err);
    setProgress(0, 'Error: ' + err.message);
  }
});

// Time controls (placeholder for now)
document.querySelectorAll('.time-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.time-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    // Speed control will be implemented with simulation
  });
});
