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

  // Compute scale to fill screen while preserving aspect ratio
  const mapAspect = MAP_WIDTH / MAP_HEIGHT;
  const screenAspect = w / h;

  let displayWidth, displayHeight;
  if (screenAspect > mapAspect) {
    // Screen is wider than map
    displayHeight = h;
    displayWidth = displayHeight * mapAspect;
  } else {
    // Screen is taller than map
    displayWidth = w;
    displayHeight = displayWidth / mapAspect;
  }

  mapCanvas.style.width = displayWidth + 'px';
  mapCanvas.style.height = displayHeight + 'px';
  cloudsCanvas.style.width = displayWidth + 'px';
  cloudsCanvas.style.height = displayHeight + 'px';

  // Optional: center the canvases horizontally/vertically
  mapCanvas.style.marginLeft = ((w - displayWidth) / 2) + 'px';
  mapCanvas.style.marginTop = ((h - displayHeight) / 2) + 'px';
  cloudsCanvas.style.marginLeft = ((w - displayWidth) / 2) + 'px';
  cloudsCanvas.style.marginTop = ((h - displayHeight) / 2) + 'px';

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
      const latWeight = 1 - Math.pow(lat, 1.5) * 0.3;
      
      // Large continental masses with domain warping
      const continentalScale = 2.2;
      const continental = noise.fbm(
        nx * continentalScale, 
        ny * continentalScale, 
        5, 
        0.55, 
        2.1,
        0.5
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
  const seaLevel = sorted[Math.floor(sorted.length * 0.60)];
  
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
        const mountainScale = 5;
        let mountainNoise = noise.fbm(
          nx * mountainScale + 300, 
          ny * mountainScale + 300, 
          4, 
          0.5, 
          2.2
        );
        
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
      
      let temp = 1 - lat * 1.3;
      
      if (height[i] > 0) {
        temp -= height[i] * 0.45;
      } else {
        temp += 0.12;
      }
      
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
      
      let precip = noise.fbm(nx * 5 + 500, ny * 5 + 500, 4, 0.5, 2.0);
      precip = (precip + 1) / 2;
      
      precip *= 1.2 - lat * 0.6;
      
      if (height[i] > 0 && height[i] < 0.15) {
        precip += 0.25;
      }
      
      if (height[i] > 0.5) {
        precip *= 0.5;
      }
      
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
  
  // Smooth wrapping at edges (blend left and right edges)
  //setProgress(0.76, 'Smoothing edges for wrapping...');
  //await smoothEdgesForWrapping(height, moisture, temperature);
  
  // STEP 6: Render to texture
  setProgress(0.80, 'Rendering planet...');
  await renderPlanetTexture(height, temperature, moisture);
  
  // STEP 7: Generate clouds layer
  setProgress(0.92, 'Generating clouds...');
  await generateClouds(rng, noise);
  
  // Store planet data
  planetData = { height, temperature, moisture, seed };
  
  setProgress(1, 'Complete!');
  return planetData;
}

// Smooth the edges to allow seamless wrapping
async function smoothEdgesForWrapping(height, moisture, temperature) {
  const blendWidth = 128; // Pixels to blend on each edge
  
  for (let y = 0; y < MAP_HEIGHT; y++) {
    for (let x = 0; x < blendWidth; x++) {
      const t = x / blendWidth; // 0 to 1
      const smoothT = t * t * (3 - 2 * t); // Smoothstep
      
      const leftIdx = y * MAP_WIDTH + x;
      const rightIdx = y * MAP_WIDTH + (MAP_WIDTH - blendWidth + x);
      
      // Get values
      const leftH = height[leftIdx];
      const rightH = height[rightIdx];
      const leftM = moisture[leftIdx];
      const rightM = moisture[rightIdx];
      const leftT = temperature[leftIdx];
      const rightT = temperature[rightIdx];
      
      // Blend
      const blendedH = leftH * (1 - smoothT) + rightH * smoothT;
      const blendedM = leftM * (1 - smoothT) + rightM * smoothT;
      const blendedT = leftT * (1 - smoothT) + rightT * smoothT;
      
      height[leftIdx] = blendedH;
      moisture[leftIdx] = blendedM;
      temperature[leftIdx] = blendedT;
      
      height[rightIdx] = blendedH;
      moisture[rightIdx] = blendedM;
      temperature[rightIdx] = blendedT;
    }
  }
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
      
      // Cloud noise
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
      data[pi + 3] = Math.floor(alpha * 180);
    }
  }
  
  cloudTextureCtx.putImageData(imageData, 0, 0);
  
  baseCloudTexture = cloudTextureCanvas;
  cloudsCtx.drawImage(cloudTextureCanvas, 0, 0);
}

// Store the base planet texture separately
let basePlanetTexture = null;
let baseCloudTexture = null;
let showClouds = true;

// ===== CAMERA SYSTEM (HOI4-style with fixed aspect ratio) =====
function renderCamera() {
  if (!basePlanetTexture) return;
  
  const screenWidth = window.innerWidth;
  const screenHeight = window.innerHeight;
  
  // Calculate display size to maintain aspect ratio
  const mapAspect = MAP_WIDTH / MAP_HEIGHT;
  const screenAspect = screenWidth / screenHeight;
  
  let displayWidth, displayHeight;
  if (screenAspect > mapAspect) {
    // Screen is wider than map
    displayHeight = screenHeight;
    displayWidth = displayHeight * mapAspect;
  } else {
    // Screen is taller than map
    displayWidth = screenWidth;
    displayHeight = displayWidth / mapAspect;
  }
  
  // Apply zoom to display size
  displayWidth *= camera.zoom;
  displayHeight *= camera.zoom;
  
  // Clamp Y (no vertical wrapping)
  const maxY = Math.max(0, MAP_HEIGHT - (screenHeight / camera.zoom));
  camera.y = Math.max(0, Math.min(maxY, camera.y));

  const maxX = Math.max(0, MAP_WIDTH - (screenWidth / camera.zoom));
  camera.x = Math.max(0, Math.min(maxX, camera.x));
  
  // Clear main canvas
  mapCtx.fillStyle = '#081420';
  mapCtx.fillRect(0, 0, MAP_WIDTH, MAP_HEIGHT);
  
  // Calculate visible portion
  const viewWidth = screenWidth / camera.zoom;
  const viewHeight = screenHeight / camera.zoom;
  
  // Draw main portion
  const sx = camera.x;
  const sy = camera.y;
  const sw = Math.min(viewWidth, MAP_WIDTH - sx);
  const sh = Math.min(viewHeight, MAP_HEIGHT - sy);
  
  mapCtx.drawImage(
    basePlanetTexture,
    sx, sy, sw, sh,
    0, 0, sw * camera.zoom, sh * camera.zoom
  );
  
  // Render clouds if enabled
  if (showClouds) {
    renderClouds();
  }
}

function renderClouds() {
  if (!baseCloudTexture) return;
  
  const screenWidth = window.innerWidth;
  const screenHeight = window.innerHeight;
  
  // Clear clouds canvas
  cloudsCtx.clearRect(0, 0, MAP_WIDTH, MAP_HEIGHT);
  
  const viewWidth = screenWidth / camera.zoom;
  const viewHeight = screenHeight / camera.zoom;
  
  // Cloud offset for animation
  const cloudX = (camera.x + cloudOffset) % MAP_WIDTH;
  const sy = camera.y;
  const sw = Math.min(viewWidth, MAP_WIDTH - cloudX);
  const sh = Math.min(viewHeight, MAP_HEIGHT - sy);
  
  // Draw main clouds
  cloudsCtx.drawImage(
    baseCloudTexture,
    cloudX, sy, sw, sh,
    0, 0, sw * camera.zoom, sh * camera.zoom
  );
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

// Prevent trackpad/touchpad back navigation
window.addEventListener('wheel', (e) => {
  // Prevent default scroll/navigation behavior
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
  }
}, { passive: false });

// Prevent touchpad gestures from navigating
window.addEventListener('gesturestart', (e) => {
  e.preventDefault();
}, { passive: false });

window.addEventListener('gesturechange', (e) => {
  e.preventDefault();
}, { passive: false });

window.addEventListener('gestureend', (e) => {
  e.preventDefault();
}, { passive: false });

// Zoom with mouse wheel
mapCanvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  
  const zoomSpeed = 0.1;
  const delta = e.deltaY > 0 ? -zoomSpeed : zoomSpeed;
  
  const newZoom = Math.max(camera.minZoom, Math.min(camera.maxZoom, camera.zoom + delta));
  
  // Calculate minimum zoom that fills the screen
  const screenWidth = window.innerWidth;
  const screenHeight = window.innerHeight;
  const mapAspect = MAP_WIDTH / MAP_HEIGHT;
  const screenAspect = screenWidth / screenHeight;
  
  let minDisplayZoom;
  if (screenAspect > mapAspect) {
    minDisplayZoom = screenHeight / MAP_HEIGHT;
  } else {
    minDisplayZoom = screenWidth / MAP_WIDTH;
  }
  
  // Don't allow zooming out past screen fill
  camera.targetZoom = Math.max(minDisplayZoom, newZoom);
  
  // Smooth zoom
  smoothZoom();
}, { passive: false });

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
  cloudOffset += cloudSpeed;

  if (cloudOffset > MAP_WIDTH + 200) {
    cloudOffset = -200;
    generateClouds(worldRng, worldNoise);
  }

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

// Settings menu
document.getElementById('settingsBtn').addEventListener('click', () => {
  document.getElementById('settingsPanel').style.display = 'flex';
});

document.getElementById('closeSettings').addEventListener('click', () => {
  document.getElementById('settingsPanel').style.display = 'none';
});

document.getElementById('showClouds').addEventListener('change', (e) => {
  showClouds = e.target.checked;
  if (!showClouds) {
    cloudsCtx.clearRect(0, 0, MAP_WIDTH, MAP_HEIGHT);
  } else {
    renderCamera();
  }
});

// Close settings on background click
document.getElementById('settingsPanel').addEventListener('click', (e) => {
  if (e.target.id === 'settingsPanel') {
    document.getElementById('settingsPanel').style.display = 'none';
  }
});
