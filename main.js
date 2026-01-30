const mapCanvas = document.getElementById('mapCanvas');
const mapCtx = mapCanvas.getContext('2d', { alpha: false });
const cloudsCanvas = document.getElementById('cloudsCanvas');
const cloudsCtx = cloudsCanvas.getContext('2d', { alpha: true });

const MAP_WIDTH = 2048;
const MAP_HEIGHT = 1024;

const camera = {
  x: 0,
  y: 0,
  zoom: 1.0,
  targetZoom: 1.0,
  minZoom: 0.5,
  maxZoom: 4.0,
  isDragging: false,
  dragStartX: 0,
  dragStartY: 0,
  dragStartCamX: 0,
  dragStartCamY: 0
};

let cloudOffset = 0;
let planetData = null;
let basePlanetTexture = null;
let baseCloudTexture = null;
let showClouds = true;
let cloudOpacity = 0.5;
let cloudSpeed = 0.2;
let worldRng = null;
let worldNoise = null;

function initCanvases() {
  mapCanvas.width = MAP_WIDTH;
  mapCanvas.height = MAP_HEIGHT;
  cloudsCanvas.width = MAP_WIDTH;
  cloudsCanvas.height = MAP_HEIGHT;
  
  const screenWidth = window.innerWidth;
  const screenHeight = window.innerHeight;
  const minZoomX = screenWidth / MAP_WIDTH;
  const minZoomY = screenHeight / MAP_HEIGHT;
  const minZoom = Math.max(minZoomX, minZoomY);
  
  camera.zoom = minZoom;
  camera.targetZoom = minZoom;
  camera.minZoom = minZoom;
  
  resizeCanvases();
}

function resizeCanvases() {
  const w = window.innerWidth;
  const h = window.innerHeight;

  mapCanvas.style.width = w + 'px';
  mapCanvas.style.height = h + 'px';
  cloudsCanvas.style.width = w + 'px';
  cloudsCanvas.style.height = h + 'px';

  const minZoomX = w / MAP_WIDTH;
  const minZoomY = h / MAP_HEIGHT;
  const minZoom = Math.max(minZoomX, minZoomY);
  
  camera.minZoom = minZoom;
  if (camera.zoom < minZoom) {
    camera.zoom = minZoom;
    camera.targetZoom = minZoom;
  }

  if (planetData) {
    renderCamera();
  }
}

window.addEventListener('resize', resizeCanvases);

function setProgress(percent, text) {
  document.getElementById('progressBar').style.width = `${Math.floor(percent * 100)}%`;
  document.getElementById('progressText').innerText = text || '';
}

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
  
  fbm(x, y, octaves, persistence, lacunarity, warp = 0) {
    let total = 0;
    let amplitude = 1;
    let frequency = 1;
    let maxValue = 0;
    
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

async function generatePlanet() {
  const seed = Date.now();
  const rng = new Random(seed);
  const noise = new PerlinNoise(rng);
  
  worldRng = rng;
  worldNoise = noise;
  
  setProgress(0, 'Initializing...');
  
  const height = new Float32Array(MAP_WIDTH * MAP_HEIGHT);
  const moisture = new Float32Array(MAP_WIDTH * MAP_HEIGHT);
  const temperature = new Float32Array(MAP_WIDTH * MAP_HEIGHT);
  
  const idx = (x, y) => y * MAP_WIDTH + x;
  
  setProgress(0.05, 'Forming continents...');
  
  for (let y = 0; y < MAP_HEIGHT; y++) {
    for (let x = 0; x < MAP_WIDTH; x++) {
      const i = idx(x, y);
      
      const nx = x / MAP_WIDTH;
      const ny = y / MAP_HEIGHT;
      
      const lat = Math.abs(ny * 2 - 1);
      const latWeight = 1 - Math.pow(lat, 1.5) * 0.3;
      
      const continentalScale = 2.2;
      const continental = noise.fbm(
        nx * continentalScale, 
        ny * continentalScale, 
        5, 
        0.55, 
        2.1,
        0.5
      );
      
      const terrainScale = 7;
      const terrain = noise.fbm(
        nx * terrainScale + 50, 
        ny * terrainScale + 50, 
        5, 
        0.6, 
        2.0
      );
      
      const detailScale = 20;
      const detail = noise.fbm(
        nx * detailScale + 200, 
        ny * detailScale + 200, 
        4, 
        0.5, 
        2.0
      );
      
      let elevation = continental * 0.60 + terrain * 0.28 + detail * 0.12;
      elevation *= latWeight;
      
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
  
  setProgress(0.30, 'Adjusting sea level...');
  
  const sorted = new Float32Array(height).sort();
  const seaLevel = sorted[Math.floor(sorted.length * 0.60)];
  
  for (let i = 0; i < height.length; i++) {
    height[i] = (height[i] - seaLevel) * 2.8;
  }
  
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
  
  setProgress(0.80, 'Rendering planet...');
  await renderPlanetTexture(height, temperature, moisture);
  
  setProgress(0.92, 'Generating clouds...');
  await generateClouds(rng, noise);
  
  planetData = { height, temperature, moisture, seed };
  
  setProgress(1, 'Complete!');
  return planetData;
}

async function renderPlanetTexture(height, temperature, moisture) {
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
      
      if (h < -0.08) {
        const depth = Math.max(0, Math.min(1, -h / 1.0));
        r = Math.floor(8 + depth * 18);
        g = Math.floor(25 + depth * 55);
        b = Math.floor(50 + depth * 150);
      }
      else if (h < 0) {
        r = 22;
        g = 70;
        b = 160;
      }
      else {
        if (t < -0.35) {
          const shade = 240 + h * 15;
          r = g = b = Math.floor(shade);
        }
        else if (t < -0.05) {
          r = Math.floor(145 + m * 35);
          g = Math.floor(160 + m * 45);
          b = Math.floor(135 + m * 25);
        }
        else if (m < 0.22) {
          r = Math.floor(205 + t * 35);
          g = Math.floor(175 + t * 28);
          b = Math.floor(115 + t * 18);
        }
        else if (m < 0.48) {
          r = Math.floor(125 - m * 45);
          g = Math.floor(145 + m * 45);
          b = Math.floor(65 + m * 25);
        }
        else if (m < 0.75) {
          r = Math.floor(55 + t * 30);
          g = Math.floor(105 + m * 55);
          b = Math.floor(45 + t * 20);
        }
        else {
          r = Math.floor(35 + t * 20);
          g = Math.floor(95 + m * 75);
          b = Math.floor(45 + t * 25);
        }
        
        if (h > 0.55) {
          const mountainFactor = Math.min(1, (h - 0.55) / 0.45);
          const grayBase = 120 + h * 50;
          r = Math.floor(r * (1 - mountainFactor) + grayBase * mountainFactor);
          g = Math.floor(g * (1 - mountainFactor) + grayBase * mountainFactor);
          b = Math.floor(b * (1 - mountainFactor) + grayBase * mountainFactor);
        }
        
        if (h > 0.75 && t < 0.15) {
          const snowFactor = Math.min(1, (h - 0.75) / 0.25);
          r = Math.floor(r * (1 - snowFactor) + 245 * snowFactor);
          g = Math.floor(g * (1 - snowFactor) + 247 * snowFactor);
          b = Math.floor(b * (1 - snowFactor) + 250 * snowFactor);
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
  
  basePlanetTexture = textureCanvas;
  
  mapCtx.drawImage(textureCanvas, 0, 0);
}

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
      
      const angle = nx * Math.PI * 2;
      const cloudX = Math.cos(angle) * 1.2732;
      const cloudY = Math.sin(angle) * 1.2732;
      
      const cloudDensity = noise.fbm(cloudX + 1000, cloudY + 1000, ny * 8, 4, 0.6, 2.1);
      
      const lat = Math.abs(ny * 2 - 1);
      const cloudBoost = 1 - lat * 0.4;
      
      let alpha = (cloudDensity + 0.3) * cloudBoost;
      alpha = Math.max(0, Math.min(0.6, alpha));
      
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

function renderCamera() {
  if (!basePlanetTexture) return;
  
  const screenWidth = window.innerWidth;
  const screenHeight = window.innerHeight;
  
  const viewWidth = screenWidth / camera.zoom;
  const viewHeight = screenHeight / camera.zoom;
  
  const maxX = Math.max(0, MAP_WIDTH - viewWidth);
  const maxY = Math.max(0, MAP_HEIGHT - viewHeight);
  
  camera.x = Math.max(0, Math.min(maxX, camera.x));
  camera.y = Math.max(0, Math.min(maxY, camera.y));
  
  mapCtx.clearRect(0, 0, MAP_WIDTH, MAP_HEIGHT);
  
  mapCtx.drawImage(
    basePlanetTexture,
    camera.x, camera.y, viewWidth, viewHeight,
    0, 0, MAP_WIDTH, MAP_HEIGHT
  );
  
  if (showClouds) {
    renderClouds();
  }
}

function renderClouds() {
  if (!baseCloudTexture) return;
  
  const screenWidth = window.innerWidth;
  const screenHeight = window.innerHeight;
  
  cloudsCtx.clearRect(0, 0, MAP_WIDTH, MAP_HEIGHT);
  
  const viewWidth = screenWidth / camera.zoom;
  const viewHeight = screenHeight / camera.zoom;
  
  const wrappedCloudOffset = ((cloudOffset % MAP_WIDTH) + MAP_WIDTH) % MAP_WIDTH;
  const cloudX = (camera.x + wrappedCloudOffset) % MAP_WIDTH;
  const sy = camera.y;
  const sh = Math.min(viewHeight, MAP_HEIGHT - sy);
  
  cloudsCtx.globalAlpha = cloudOpacity;
  
  if (cloudX + viewWidth <= MAP_WIDTH) {
    cloudsCtx.drawImage(
      baseCloudTexture,
      cloudX, sy, viewWidth, sh,
      0, 0, MAP_WIDTH, MAP_HEIGHT
    );
  } else {
    const firstPartWidth = MAP_WIDTH - cloudX;
    const secondPartWidth = viewWidth - firstPartWidth;
    
    cloudsCtx.drawImage(
      baseCloudTexture,
      cloudX, sy, firstPartWidth, sh,
      0, 0, MAP_WIDTH * (firstPartWidth / viewWidth), MAP_HEIGHT
    );
    
    cloudsCtx.drawImage(
      baseCloudTexture,
      0, sy, secondPartWidth, sh,
      MAP_WIDTH * (firstPartWidth / viewWidth), 0, MAP_WIDTH * (secondPartWidth / viewWidth), MAP_HEIGHT
    );
  }
  
  cloudsCtx.globalAlpha = 1.0;
}

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

window.addEventListener('wheel', (e) => {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
  }
}, { passive: false });

window.addEventListener('gesturestart', (e) => {
  e.preventDefault();
}, { passive: false });

window.addEventListener('gesturechange', (e) => {
  e.preventDefault();
}, { passive: false });

window.addEventListener('gestureend', (e) => {
  e.preventDefault();
}, { passive: false });

mapCanvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  
  const rect = mapCanvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;
  
  const screenWidth = window.innerWidth;
  const screenHeight = window.innerHeight;
  
  const minZoomX = screenWidth / MAP_WIDTH;
  const minZoomY = screenHeight / MAP_HEIGHT;
  const minZoom = Math.max(minZoomX, minZoomY);
  
  const worldX = camera.x + (mouseX / screenWidth) * (screenWidth / camera.zoom);
  const worldY = camera.y + (mouseY / screenHeight) * (screenHeight / camera.zoom);
  
  const zoomSpeed = 0.1;
  const delta = e.deltaY > 0 ? -zoomSpeed : zoomSpeed;
  
  const oldZoom = camera.zoom;
  const newZoom = Math.max(minZoom, Math.min(camera.maxZoom, camera.zoom + delta));
  
  camera.targetZoom = newZoom;
  camera.zoom = newZoom;
  
  camera.x = worldX - (mouseX / screenWidth) * (screenWidth / camera.zoom);
  camera.y = worldY - (mouseY / screenHeight) * (screenHeight / camera.zoom);
  
  renderCamera();
}, { passive: false });

mapCanvas.style.cursor = 'grab';

function animateClouds() {
  cloudOffset += cloudSpeed;

  if (cloudOffset > MAP_WIDTH + 200) {
    cloudOffset = -200;
    if (worldRng && worldNoise) {
      generateClouds(worldRng, worldNoise);
    }
  }

  if (planetData) {
    renderCamera();
  }
  
  requestAnimationFrame(animateClouds);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

document.getElementById('playBtn').addEventListener('click', async () => {
  document.getElementById('mainMenu').style.display = 'none';
  document.getElementById('gameView').style.display = 'block';
  
  initCanvases();
  
  try {
    await generatePlanet();
    
    document.getElementById('progressUI').classList.add('hidden');
    
    document.getElementById('gameUI').style.display = 'block';
    
    renderCamera();
    animateClouds();
    
  } catch (err) {
    console.error(err);
    setProgress(0, 'Error: ' + err.message);
  }
});

document.querySelectorAll('.time-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.time-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

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

document.getElementById('cloudOpacity').addEventListener('input', (e) => {
  cloudOpacity = parseFloat(e.target.value);
  document.getElementById('cloudOpacityValue').textContent = cloudOpacity.toFixed(2);
  if (showClouds) {
    renderCamera();
  }
});

document.getElementById('settingsPanel').addEventListener('click', (e) => {
  if (e.target.id === 'settingsPanel') {
    document.getElementById('settingsPanel').style.display = 'none';
  }
});
