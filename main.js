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
// RIVER GENERATION SYSTEM
// ============================================

class River {
  constructor(id) {
    this.id = id;
    this.path = []; // Array of {x, y} points
    this.strength = 0; // How big the river is (0-1)
  }
}

async function generateRivers(height, moisture, rng) {
  const rivers = [];
  const riverMap = new Uint8Array(MAP_WIDTH * MAP_HEIGHT); // Which river (if any) flows through each pixel
  
  const idx = (x, y) => {
    x = (x + MAP_WIDTH) % MAP_WIDTH;
    y = Math.max(0, Math.min(MAP_HEIGHT - 1, y));
    return y * MAP_WIDTH + x;
  };
  
  // Find high elevation starting points for rivers
  const numRivers = Math.floor(rng.range(80, 150));
  const riverStarts = [];
  
  for (let attempt = 0; attempt < numRivers * 3; attempt++) {
    const x = Math.floor(rng.next() * MAP_WIDTH);
    const y = Math.floor(rng.next() * MAP_HEIGHT);
    const i = idx(x, y);
    
    const h = height[i];
    const m = moisture[i];
    
    // Rivers start in mountains, in wet regions
    if (h > 0.3 && h < 0.9 && m > 0.4) {
      riverStarts.push({ x, y, elevation: h });
    }
    
    if (riverStarts.length >= numRivers) break;
  }
  
  // Flow each river downhill
  for (let r = 0; r < riverStarts.length; r++) {
    const river = new River(r);
    const start = riverStarts[r];
    
    let x = start.x;
    let y = start.y;
    let prevElev = start.elevation;
    const maxLength = 200;
    
    for (let step = 0; step < maxLength; step++) {
      const i = idx(x, y);
      const currentElev = height[i];
      
      // Stop if we hit ocean
      if (currentElev <= 0) {
        river.path.push({ x, y });
        break;
      }
      
      // Stop if we hit another river (merge)
      if (riverMap[i] > 0 && riverMap[i] !== r + 1) {
        river.path.push({ x, y });
        break;
      }
      
      river.path.push({ x, y });
      riverMap[i] = r + 1;
      
      // Find lowest neighbor
      const neighbors = [
        { x: x - 1, y: y, elev: height[idx(x - 1, y)] },
        { x: x + 1, y: y, elev: height[idx(x + 1, y)] },
        { x: x, y: y - 1, elev: height[idx(x, y - 1)] },
        { x: x, y: y + 1, elev: height[idx(x, y + 1)] }
      ];
      
      // Sort by elevation
      neighbors.sort((a, b) => a.elev - b.elev);
      
      // Flow downhill
      let moved = false;
      for (const n of neighbors) {
        if (n.elev < currentElev) {
          x = (n.x + MAP_WIDTH) % MAP_WIDTH;
          y = Math.max(0, Math.min(MAP_HEIGHT - 1, n.y));
          moved = true;
          break;
        }
      }
      
      if (!moved) break; // Stuck in a local minimum
      
      prevElev = currentElev;
    }
    
    // Calculate river strength based on length and tributaries
    river.strength = Math.min(1, river.path.length / 100);
    
    if (river.path.length > 10) {
      rivers.push(river);
    }
  }
  
  return rivers;
}

// ============================================
// TILE SYSTEM
// ============================================

const TILE_WIDTH = 256;
const TILE_HEIGHT = 128;

class Tile {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    
    // Geography
    this.elevation = 0;
    this.isLand = false;
    this.distanceToCoast = 0;
    this.riverPresence = 'none'; // none / minor / major
    this.roughness = 0; // 0-1 (flat to mountains)
    
    // Climate
    this.temperature = 0; // -1 to 1
    this.rainfall = 0; // 0 to 1
    this.seasonality = 0; // 0-1
    this.climateZone = 'temperate'; // polar / temperate / tropical
    
    // Biome
    this.biomeType = 'ocean';
    
    // Resources
    this.foodPotential = 0; // 0-1
    this.wood = 0; // 0-1
    this.stone = 0; // 0-1
    this.metals = 0; // 0-1
    this.fertility = 0; // 0-1
    
    // Human factors
    this.habitability = 0; // 0-1
    this.populationCapacity = 0; // 0-1
    this.diseaseRisk = 0; // 0-1
    this.movementCost = 1.0; // multiplier for travel
  }
}

function determineBiome(elevation, temperature, rainfall) {
  if (elevation <= 0) return 'ocean';
  
  if (temperature < -0.5) return 'ice';
  if (temperature < -0.2) return 'tundra';
  
  if (elevation > 0.7) return 'alpine';
  
  if (rainfall < 0.2) return 'desert';
  if (rainfall < 0.4) {
    if (temperature > 0.3) return 'savanna';
    return 'grassland';
  }
  if (rainfall < 0.7) {
    if (temperature > 0.4) return 'jungle';
    return 'forest';
  }
  
  if (temperature > 0.5) return 'jungle';
  return 'forest';
}

async function generateTileSystem(height, temperature, moisture, rivers, rng) {
  const tiles = [];
  const tileGrid = [];
  
  const pixelsPerTileX = MAP_WIDTH / TILE_WIDTH;
  const pixelsPerTileY = MAP_HEIGHT / TILE_HEIGHT;
  
  const idx = (x, y) => y * MAP_WIDTH + x;
  
  // Create tile grid
  for (let ty = 0; ty < TILE_HEIGHT; ty++) {
    const row = [];
    for (let tx = 0; tx < TILE_WIDTH; tx++) {
      const tile = new Tile(tx, ty);
      
      // Sample the center pixels of this tile region
      const centerX = Math.floor(tx * pixelsPerTileX + pixelsPerTileX / 2);
      const centerY = Math.floor(ty * pixelsPerTileY + pixelsPerTileY / 2);
      
      // Average values across the tile region
      let sumElev = 0, sumTemp = 0, sumMoist = 0;
      let numSamples = 0;
      let minElev = Infinity, maxElev = -Infinity;
      
      for (let dy = 0; dy < pixelsPerTileY; dy += 2) {
        for (let dx = 0; dx < pixelsPerTileX; dx += 2) {
          const px = Math.floor(tx * pixelsPerTileX + dx);
          const py = Math.floor(ty * pixelsPerTileY + dy);
          if (px >= MAP_WIDTH || py >= MAP_HEIGHT) continue;
          
          const i = idx(px, py);
          sumElev += height[i];
          sumTemp += temperature[i];
          sumMoist += moisture[i];
          minElev = Math.min(minElev, height[i]);
          maxElev = Math.max(maxElev, height[i]);
          numSamples++;
        }
      }
      
      tile.elevation = sumElev / numSamples;
      tile.temperature = sumTemp / numSamples;
      tile.rainfall = sumMoist / numSamples;
      tile.isLand = tile.elevation > 0;
      tile.roughness = maxElev - minElev; // Terrain variance
      
      // Climate zone
      const lat = Math.abs(ty / TILE_HEIGHT * 2 - 1);
      if (lat > 0.7) tile.climateZone = 'polar';
      else if (lat < 0.3) tile.climateZone = 'tropical';
      else tile.climateZone = 'temperate';
      
      // Biome
      tile.biomeType = determineBiome(tile.elevation, tile.temperature, tile.rainfall);
      
      // River presence
      let riverStrength = 0;
      for (const river of rivers) {
        for (const point of river.path) {
          const ptx = Math.floor(point.x / pixelsPerTileX);
          const pty = Math.floor(point.y / pixelsPerTileY);
          if (ptx === tx && pty === ty) {
            riverStrength = Math.max(riverStrength, river.strength);
          }
        }
      }
      if (riverStrength > 0.5) tile.riverPresence = 'major';
      else if (riverStrength > 0.2) tile.riverPresence = 'minor';
      
      // Resources
      if (tile.isLand) {
        tile.fertility = tile.rainfall * (1 - tile.roughness) * 0.7;
        tile.foodPotential = tile.fertility * (tile.riverPresence === 'major' ? 1.5 : 1.0);
        
        tile.wood = (tile.biomeType === 'forest' || tile.biomeType === 'jungle') ? rng.range(0.6, 1.0) : rng.range(0, 0.3);
        tile.stone = tile.roughness > 0.3 ? rng.range(0.5, 0.9) : rng.range(0.1, 0.4);
        tile.metals = (tile.roughness > 0.4 && rng.next() > 0.7) ? rng.range(0.5, 1.0) : rng.range(0, 0.3);
        
        // Habitability
        const tempScore = 1 - Math.abs(tile.temperature);
        const moistScore = Math.min(1, tile.rainfall * 1.5);
        tile.habitability = (tempScore + moistScore + (tile.riverPresence !== 'none' ? 0.3 : 0)) / 2.5;
        
        tile.populationCapacity = tile.habitability * tile.foodPotential;
        
        // Disease risk (hot + wet = disease)
        if (tile.temperature > 0.3 && tile.rainfall > 0.6) {
          tile.diseaseRisk = rng.range(0.5, 0.9);
        } else {
          tile.diseaseRisk = rng.range(0, 0.3);
        }
        
        // Movement cost
        tile.movementCost = 1.0;
        if (tile.roughness > 0.5) tile.movementCost += 1.5;
        if (tile.biomeType === 'jungle') tile.movementCost += 1.0;
        if (tile.biomeType === 'desert') tile.movementCost += 0.5;
        if (tile.biomeType === 'ice') tile.movementCost += 2.0;
      }
      
      tiles.push(tile);
      row.push(tile);
    }
    tileGrid.push(row);
  }
  
  // Calculate distance to coast
  for (let ty = 0; ty < TILE_HEIGHT; ty++) {
    for (let tx = 0; tx < TILE_WIDTH; tx++) {
      const tile = tileGrid[ty][tx];
      
      if (tile.isLand) {
        let minDist = Infinity;
        
        // Search in expanding radius
        for (let r = 1; r < 20; r++) {
          let foundCoast = false;
          
          for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
              const nx = (tx + dx + TILE_WIDTH) % TILE_WIDTH;
              const ny = ty + dy;
              
              if (ny < 0 || ny >= TILE_HEIGHT) continue;
              
              const neighbor = tileGrid[ny][nx];
              if (!neighbor.isLand) {
                const dist = Math.sqrt(dx * dx + dy * dy);
                minDist = Math.min(minDist, dist);
                foundCoast = true;
              }
            }
          }
          
          if (foundCoast) break;
        }
        
        tile.distanceToCoast = minDist;
      }
    }
  }
  
  return tiles;
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

      if (height[i] > 0.08) {
        const continentalMask = Math.max(0, Math.min(1,
          (noise.fbm(nx * 0.6 + 900, ny * 0.6 + 900, 2, 0.6, 2.0) + 1) * 0.5
        ));

        const mountainScale = 5;
        let mountainNoise = noise.fbm(
          nx * mountainScale + 300,
          ny * mountainScale + 300,
          4,
          0.5,
          2.2
        );

        mountainNoise = 1 - Math.abs(mountainNoise);
        if (mountainNoise > 0.35) {
          const peakFactor = Math.pow((mountainNoise - 0.35) / (1 - 0.35), 1.6);
          const amplitude = 0.18;
          height[i] += peakFactor * amplitude * continentalMask;
        }
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
      setProgress(0.60 + (y / MAP_HEIGHT) * 0.10, `Climate: ${Math.floor(y / MAP_HEIGHT * 100)}%`);
      await sleep(0);
    }
  }
  
  setProgress(0.70, 'Generating rivers...');
  const rivers = await generateRivers(height, moisture, rng);
  
  setProgress(0.75, 'Creating tile system...');
  const tiles = await generateTileSystem(height, temperature, moisture, rivers, rng);
  
  setProgress(0.80, 'Rendering planet...');
  await renderPlanetTexture(height, temperature, moisture, rivers);
  
  planetData = { height, temperature, moisture, rivers, tiles, seed };
  
  const planetName = generatePlanetName(rng);
  document.getElementById('worldName').textContent = planetName;
  document.getElementById('worldStats').textContent = `Tiles: ${tiles.length} | Rivers: ${rivers.length}`;
  
  setProgress(1, 'Complete!');
  return planetData;
}

async function renderPlanetTexture(height, temperature, moisture, rivers) {
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
      setProgress(0.80 + (y / MAP_HEIGHT) * 0.09, `Rendering: ${Math.floor(y / MAP_HEIGHT * 100)}%`);
      await sleep(0);
    }
  }
  
  textureCtx.putImageData(imageData, 0, 0);
  
  // Draw rivers on top
  for (const river of rivers) {
    if (river.path.length < 2) continue;
    
    const width = Math.max(1, river.strength * 2.5);
    const alpha = Math.min(1, 0.6 + river.strength * 0.4);
    
    textureCtx.strokeStyle = `rgba(50, 120, 200, ${alpha})`;
    textureCtx.lineWidth = width;
    textureCtx.lineCap = 'round';
    textureCtx.lineJoin = 'round';
    
    textureCtx.beginPath();
    textureCtx.moveTo(river.path[0].x, river.path[0].y);
    for (let i = 1; i < river.path.length; i++) {
      textureCtx.lineTo(river.path[i].x, river.path[i].y);
    }
    textureCtx.stroke();
  }
  
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
