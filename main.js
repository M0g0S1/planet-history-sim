const mapCanvas = document.getElementById('mapCanvas');
const mapCtx = mapCanvas.getContext('2d', { alpha: false });

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

let planetData = null;
let basePlanetTexture = null;
let worldRng = null;
let worldNoise = null;

const planetPrefixes = [
  'Terra', 'Gaia', 'Kepler', 'Proxima', 'Trappist', 'Nova', 'Aurora', 'Celestia',
  'Olympus', 'Elysium', 'Arcadia', 'Avalon', 'Eden', 'Valhalla', 'Asgard', 'Midgard',
  'Atlantis', 'Thera', 'Harmonia', 'Concordia', 'Serenity', 'Tranquility', 'Verdant',
  'Emerald', 'Sapphire', 'Azure', 'Crimson', 'Golden', 'Silver', 'Crystal'
];

const planetSuffixes = [
  'Prime', 'Major', 'Minor', 'Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon',
  'Centauri', 'Draconis', 'Aquarii', 'Orionis', 'Lyrae', 'Cygni', 'Phoenicis',
  'Novus', 'Secundus', 'Tertius', 'Quartus', 'Quintus'
];

function generatePlanetName(rng) {
  const useNumber = rng.next() > 0.4;
  
  if (useNumber) {
    const prefix = planetPrefixes[Math.floor(rng.next() * planetPrefixes.length)];
    const number = Math.floor(rng.next() * 9999) + 1;
    const letter = String.fromCharCode(97 + Math.floor(rng.next() * 26));
    return `${prefix}-${number}${letter}`;
  } else {
    const prefix = planetPrefixes[Math.floor(rng.next() * planetPrefixes.length)];
    const suffix = planetSuffixes[Math.floor(rng.next() * planetSuffixes.length)];
    return `${prefix} ${suffix}`;
  }
}

function initCanvases() {
  mapCanvas.width = MAP_WIDTH;
  mapCanvas.height = MAP_HEIGHT;
  
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

// ============================================
// TECTONIC PLATE SYSTEM
// ============================================

class TectonicPlate {
  constructor(id, centerX, centerY, type, velocityX, velocityY) {
    this.id = id;
    this.centerX = centerX;
    this.centerY = centerY;
    this.type = type; // 'continental' or 'oceanic'
    this.velocityX = velocityX;
    this.velocityY = velocityY;
    this.baseElevation = type === 'continental' ? 0.15 : -0.05;
  }
}

function generateTectonicPlates(rng, numPlates = 12) {
  const plates = [];
  
  for (let i = 0; i < numPlates; i++) {
    const x = rng.next() * MAP_WIDTH;
    const y = rng.next() * MAP_HEIGHT;
    
    // More continental plates in temperate zones
    const lat = Math.abs((y / MAP_HEIGHT) * 2 - 1);
    const isContinental = (lat < 0.6 && rng.next() > 0.4) || rng.next() > 0.65;
    const type = isContinental ? 'continental' : 'oceanic';
    
    // Random plate motion
    const angle = rng.next() * Math.PI * 2;
    const speed = rng.range(0.3, 1.2);
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed;
    
    plates.push(new TectonicPlate(i, x, y, type, vx, vy));
  }
  
  return plates;
}

function assignPlatesToTiles(plates) {
  const plateMap = new Uint8Array(MAP_WIDTH * MAP_HEIGHT);
  
  // Voronoi diagram: assign each pixel to nearest plate center
  for (let y = 0; y < MAP_HEIGHT; y++) {
    for (let x = 0; x < MAP_WIDTH; x++) {
      const i = y * MAP_WIDTH + x;
      
      let minDist = Infinity;
      let closestPlate = 0;
      
      for (let p = 0; p < plates.length; p++) {
        const plate = plates[p];
        
        // Handle wrapping on X axis
        let dx = Math.abs(x - plate.centerX);
        if (dx > MAP_WIDTH / 2) dx = MAP_WIDTH - dx;
        
        const dy = y - plate.centerY;
        const dist = dx * dx + dy * dy;
        
        if (dist < minDist) {
          minDist = dist;
          closestPlate = p;
        }
      }
      
      plateMap[i] = closestPlate;
    }
  }
  
  return plateMap;
}

function detectPlateBoundaries(plateMap, plates) {
  const boundaries = new Uint8Array(MAP_WIDTH * MAP_HEIGHT);
  const boundaryType = new Uint8Array(MAP_WIDTH * MAP_HEIGHT);
  // 0 = interior, 1 = convergent, 2 = divergent, 3 = transform
  
  const idx = (x, y) => {
    x = (x + MAP_WIDTH) % MAP_WIDTH; // wrap X
    y = Math.max(0, Math.min(MAP_HEIGHT - 1, y)); // clamp Y
    return y * MAP_WIDTH + x;
  };
  
  for (let y = 1; y < MAP_HEIGHT - 1; y++) {
    for (let x = 0; x < MAP_WIDTH; x++) {
      const i = idx(x, y);
      const myPlate = plateMap[i];
      
      // Check neighbors
      const neighbors = [
        plateMap[idx(x - 1, y)],
        plateMap[idx(x + 1, y)],
        plateMap[idx(x, y - 1)],
        plateMap[idx(x, y + 1)]
      ];
      
      const isDifferent = neighbors.some(n => n !== myPlate);
      
      if (isDifferent) {
        boundaries[i] = 1;
        
        // Determine boundary type based on plate velocities
        const otherPlate = neighbors.find(n => n !== myPlate);
        if (otherPlate !== undefined) {
          const p1 = plates[myPlate];
          const p2 = plates[otherPlate];
          
          // Calculate relative velocity
          const relVx = p2.velocityX - p1.velocityX;
          const relVy = p2.velocityY - p1.velocityY;
          
          // Vector from plate center to boundary
          const toX = x - p1.centerX;
          const toY = y - p1.centerY;
          const len = Math.sqrt(toX * toX + toY * toY);
          const normX = len > 0 ? toX / len : 0;
          const normY = len > 0 ? toY / len : 0;
          
          // Dot product to see if converging or diverging
          const dot = relVx * normX + relVy * normY;
          
          if (dot > 0.3) {
            boundaryType[i] = 2; // divergent
          } else if (dot < -0.3) {
            boundaryType[i] = 1; // convergent
          } else {
            boundaryType[i] = 3; // transform
          }
        }
      }
    }
  }
  
  return { boundaries, boundaryType };
}

function generateHotspots(rng, numHotspots = 6) {
  const hotspots = [];
  for (let i = 0; i < numHotspots; i++) {
    hotspots.push({
      x: rng.next() * MAP_WIDTH,
      y: rng.next() * MAP_HEIGHT,
      strength: rng.range(0.12, 0.22)
    });
  }
  return hotspots;
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
  
  // STEP 1: Generate tectonic plates
  setProgress(0.05, 'Generating tectonic plates...');
  const numPlates = Math.floor(rng.range(10, 16));
  const plates = generateTectonicPlates(rng, numPlates);
  
  setProgress(0.10, 'Assigning plate territories...');
  const plateMap = assignPlatesToTiles(plates);
  
  setProgress(0.15, 'Detecting plate boundaries...');
  const { boundaries, boundaryType } = detectPlateBoundaries(plateMap, plates);
  
  setProgress(0.20, 'Placing volcanic hotspots...');
  const hotspots = generateHotspots(rng, Math.floor(rng.range(3, 6)));
  
  // STEP 2: Base elevation from plate type
  setProgress(0.25, 'Setting base plate elevations...');
  for (let y = 0; y < MAP_HEIGHT; y++) {
    for (let x = 0; x < MAP_WIDTH; x++) {
      const i = idx(x, y);
      const plate = plates[plateMap[i]];
      height[i] = plate.baseElevation;
    }
  }
  
  // STEP 3: Apply base continental noise (blend tectonics with natural terrain)
  setProgress(0.30, 'Forming continents...');
  for (let y = 0; y < MAP_HEIGHT; y++) {
    for (let x = 0; x < MAP_WIDTH; x++) {
      const i = idx(x, y);
      const nx = x / MAP_WIDTH;
      const ny = y / MAP_HEIGHT;
      
      const lat = Math.abs(ny * 2 - 1);
      const latWeight = 1 - Math.pow(lat, 1.5) * 0.3;
      
      // Continental scale noise
      const continentalScale = 2.2;
      const continental = noise.fbm(
        nx * continentalScale, 
        ny * continentalScale, 
        5, 
        0.55, 
        2.1,
        0.5
      );
      
      const plate = plates[plateMap[i]];
      
      // Blend plate type with noise
      let baseHeight = plate.baseElevation * 0.4 + continental * 0.6;
      baseHeight *= latWeight;
      
      height[i] = baseHeight;
    }
    
    if (y % 50 === 0) {
      setProgress(0.30 + (y / MAP_HEIGHT) * 0.10, `Continents: ${Math.floor(y / MAP_HEIGHT * 100)}%`);
      await sleep(0);
    }
  }
  
  // STEP 3B: Mark potential mountain zones at convergent boundaries
  setProgress(0.40, 'Simulating tectonic collisions...');
  const mountainSeeds = new Float32Array(MAP_WIDTH * MAP_HEIGHT);
  
  for (let y = 0; y < MAP_HEIGHT; y++) {
    for (let x = 0; x < MAP_WIDTH; x++) {
      const i = idx(x, y);
      
      if (boundaries[i] && boundaryType[i] === 1) { // Only convergent
        const myPlate = plates[plateMap[i]];
        
        // Find neighboring plate
        let otherPlate = null;
        const neighbors = [
          plateMap[idx((x - 1 + MAP_WIDTH) % MAP_WIDTH, y)],
          plateMap[idx((x + 1) % MAP_WIDTH, y)],
          plateMap[idx(x, Math.max(0, y - 1))],
          plateMap[idx(x, Math.min(MAP_HEIGHT - 1, y + 1))]
        ];
        for (const nid of neighbors) {
          if (nid !== plateMap[i]) {
            otherPlate = plates[nid];
            break;
          }
        }
        
        if (otherPlate) {
          // Only add mountain seeds where it makes geological sense
          if (myPlate.type === 'continental' && otherPlate.type === 'continental') {
            // Continental collision → major mountain seed
            mountainSeeds[i] = rng.range(0.25, 0.40);
          } else if (myPlate.type === 'continental' || otherPlate.type === 'continental') {
            // Subduction → moderate mountain seed
            mountainSeeds[i] = rng.range(0.15, 0.28);
          } else {
            // Ocean-ocean → island arc seed
            mountainSeeds[i] = rng.range(0.08, 0.18);
          }
        }
      }
    }
    
    if (y % 50 === 0) {
      setProgress(0.40 + (y / MAP_HEIGHT) * 0.05, `Collisions: ${Math.floor(y / MAP_HEIGHT * 100)}%`);
      await sleep(0);
    }
  }
  
  // STEP 4: Spread mountain ranges naturally using noise-guided growth
  setProgress(0.45, 'Building mountain ranges...');
  
  // Use noise to guide mountain formation along tectonic zones
  for (let y = 1; y < MAP_HEIGHT - 1; y++) {
    for (let x = 0; x < MAP_WIDTH; x++) {
      const i = idx(x, y);
      const nx = x / MAP_WIDTH;
      const ny = y / MAP_HEIGHT;
      
      if (mountainSeeds[i] > 0) {
        // Use ridged noise for mountain shapes
        const mountainScale = 6;
        let ridgeNoise = noise.fbm(
          nx * mountainScale + 300,
          ny * mountainScale + 300,
          4,
          0.5,
          2.2
        );
        
        // Create ridges (inverse abs makes peaks)
        ridgeNoise = 1 - Math.abs(ridgeNoise);
        
        if (ridgeNoise > 0.4) {
          const peakFactor = Math.pow((ridgeNoise - 0.4) / 0.6, 1.3);
          height[i] += mountainSeeds[i] * peakFactor * 1.8;
        } else {
          // Gradual elevation around mountains
          height[i] += mountainSeeds[i] * 0.5;
        }
      }
    }
    
    if (y % 60 === 0) {
      setProgress(0.45 + (y / MAP_HEIGHT) * 0.10, `Mountains: ${Math.floor(y / MAP_HEIGHT * 100)}%`);
      await sleep(0);
    }
  }
  
  // Smooth and spread mountain influence
  const smoothed = new Float32Array(height);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 1; y < MAP_HEIGHT - 1; y++) {
      for (let x = 0; x < MAP_WIDTH; x++) {
        const i = idx(x, y);
        
        if (height[i] > 0.2) {
          const n1 = height[idx((x - 1 + MAP_WIDTH) % MAP_WIDTH, y)];
          const n2 = height[idx((x + 1) % MAP_WIDTH, y)];
          const n3 = height[idx(x, y - 1)];
          const n4 = height[idx(x, y + 1)];
          
          smoothed[i] = (height[i] * 2 + n1 + n2 + n3 + n4) / 6;
        } else {
          smoothed[i] = height[i];
        }
      }
    }
    
    for (let i = 0; i < height.length; i++) {
      if (height[i] > 0.2) {
        height[i] = smoothed[i];
      }
    }
  }
  
  // STEP 5: Add hotspot volcanoes (more subtle)
  setProgress(0.55, 'Placing volcanic islands...');
  for (const hotspot of hotspots) {
    for (let y = 0; y < MAP_HEIGHT; y++) {
      for (let x = 0; x < MAP_WIDTH; x++) {
        const i = idx(x, y);
        
        let dx = Math.abs(x - hotspot.x);
        if (dx > MAP_WIDTH / 2) dx = MAP_WIDTH - dx;
        const dy = y - hotspot.y;
        
        const dist = Math.sqrt(dx * dx + dy * dy);
        const radius = 50;
        
        if (dist < radius) {
          const influence = (1 - dist / radius) * hotspot.strength;
          const peak = influence * influence * 0.8; // Less extreme
          height[i] += peak;
        }
      }
    }
  }
  
  // STEP 6: Add terrain detail noise
  setProgress(0.60, 'Adding terrain detail...');
  for (let y = 0; y < MAP_HEIGHT; y++) {
    for (let x = 0; x < MAP_WIDTH; x++) {
      const i = idx(x, y);
      const nx = x / MAP_WIDTH;
      const ny = y / MAP_HEIGHT;
      
      // Multi-scale terrain noise
      const terrainScale = 8;
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
      
      // Blend noise based on existing elevation
      if (height[i] > 0) {
        height[i] += terrain * 0.12 + detail * 0.05;
      } else {
        height[i] += terrain * 0.04 + detail * 0.02;
      }
    }
    
    if (y % 60 === 0) {
      setProgress(0.60 + (y / MAP_HEIGHT) * 0.05, `Detail: ${Math.floor(y / MAP_HEIGHT * 100)}%`);
      await sleep(0);
    }
  }
  
  // STEP 7: Adjust sea level
  setProgress(0.65, 'Adjusting sea level...');
  const sorted = new Float32Array(height).sort();
  const seaLevel = sorted[Math.floor(sorted.length * 0.60)];
  
  for (let i = 0; i < height.length; i++) {
    height[i] = (height[i] - seaLevel) * 1.5;
  }
  
  // STEP 8: Temperature
  setProgress(0.70, 'Calculating temperature...');
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
      setProgress(0.70 + (y / MAP_HEIGHT) * 0.10, `Temperature: ${Math.floor(y / MAP_HEIGHT * 100)}%`);
      await sleep(0);
    }
  }
  
  // STEP 9: Climate/Moisture
  setProgress(0.80, 'Simulating climate...');
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
      setProgress(0.80 + (y / MAP_HEIGHT) * 0.10, `Climate: ${Math.floor(y / MAP_HEIGHT * 100)}%`);
      await sleep(0);
    }
  }
  
  setProgress(0.90, 'Rendering planet...');
  await renderPlanetTexture(height, temperature, moisture);
  
  planetData = { height, temperature, moisture, seed, plates, plateMap, boundaries, boundaryType };
  
  const planetName = generatePlanetName(rng);
  document.getElementById('worldName').textContent = planetName;
  document.getElementById('worldStats').textContent = `Tectonic Plates: ${plates.length}`;
  
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
        
        if (h > 0.65) {
          const baseGray = 85 + h * 35;
          r = Math.floor(baseGray);
          g = Math.floor(baseGray);
          b = Math.floor(baseGray);
        }
        
        if (h > 0.85 && t < 0.05) {
          r = 245;
          g = 248;
          b = 252;
        }
      }
      
      data[pi] = r;
      data[pi + 1] = g;
      data[pi + 2] = b;
      data[pi + 3] = 255;
    }
    
    if (y % 100 === 0) {
      setProgress(0.90 + (y / MAP_HEIGHT) * 0.09, `Rendering: ${Math.floor(y / MAP_HEIGHT * 100)}%`);
      await sleep(0);
    }
  }
  
  textureCtx.putImageData(imageData, 0, 0);
  
  basePlanetTexture = textureCanvas;
  
  mapCtx.drawImage(textureCanvas, 0, 0);
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

document.getElementById('settingsPanel').addEventListener('click', (e) => {
  if (e.target.id === 'settingsPanel') {
    document.getElementById('settingsPanel').style.display = 'none';
  }
});
