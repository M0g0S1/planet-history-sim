const mapCanvas = document.getElementById('mapCanvas');
const mapCtx = mapCanvas.getContext('2d', { alpha: false });

// Overlay canvas for tribes, borders, labels
const overlayCanvas = document.createElement('canvas');
const overlayCtx = overlayCanvas.getContext('2d', { alpha: true });

const MAP_WIDTH = 2048;
const MAP_HEIGHT = 1024;

const camera = {
  x: 0,
  y: 0,
  zoom: 1.0,
  targetZoom: 1.0,
  minZoom: 0.5,
  maxZoom: 4.0,
  moveSpeed: 20 // pixels per frame
};

// Keyboard state
const keys = {
  w: false,
  a: false,
  s: false,
  d: false,
  ArrowUp: false,
  ArrowLeft: false,
  ArrowDown: false,
  ArrowRight: false
};

let planetData = null;
let basePlanetTexture = null;
let worldRng = null;
let worldNoise = null;

// ============================================
// GAME STATE & SIMULATION
// ============================================

class GameEvent {
  constructor(year, type, message) {
    this.year = year;
    this.type = type; // 'migration', 'settlement', 'war', 'country_formed', etc.
    this.message = message;
    this.id = Date.now() + Math.random();
  }
}

let gameState = {
  year: 0,
  running: false,
  speed: 2, // 0=pause, 1=slow, 2=normal, 3=fast, 4=ultra
  tribes: [],
  countries: [],
  events: [],
  selectedEntity: null // {type: 'tribe'/'country'/'tile', data: ...}
};

function logEvent(type, message) {
  const event = new GameEvent(gameState.year, type, message);
  gameState.events.unshift(event); // Add to beginning
  
  // Keep only last 100 events
  if (gameState.events.length > 100) {
    gameState.events.pop();
  }
  
  updateEventLog();
}

function updateEventLog() {
  const eventLog = document.getElementById('eventLog');
  if (!eventLog) return;
  
  eventLog.innerHTML = '';
  
  // Show last 20 events
  const recentEvents = gameState.events.slice(0, 20);
  
  for (const event of recentEvents) {
    const eventDiv = document.createElement('div');
    eventDiv.className = 'event-item';
    eventDiv.innerHTML = `
      <span class="event-year">${event.year}</span>
      <span class="event-message">${event.message}</span>
    `;
    eventLog.appendChild(eventDiv);
  }
}

const SPEEDS = {
  0: 0,      // paused
  1: 1,      // slow (1 tick/sec)
  2: 4,      // normal (4 ticks/sec)
  3: 10,     // fast (10 ticks/sec)
  4: 30      // ultra (30 ticks/sec)
};

class Tribe {
  constructor(id, x, y, population, rng) {
    this.id = id;
    this.x = x; // tile coordinates
    this.y = y;
    this.population = population;
    this.culture = generateCultureName(rng);
    this.techLevel = 0; // primitive
    this.age = 0; // years existed
    this.settled = false;
    this.settlementYears = 0; // years in same spot
    
    // Visualization
    this.color = generateColor(rng);
    this.territories = []; // Array of {x, y} tile coords
    
    // Migration intent
    this.targetX = null;
    this.targetY = null;
    this.migrationCooldown = 0;
    
    // Leadership
    this.leader = generateTribalLeader(rng);
  }
}

class Country {
  constructor(id, name, capitalX, capitalY, color, rng) {
    this.id = id;
    this.name = name;
    this.capitalX = capitalX;
    this.capitalY = capitalY;
    this.color = color; // for borders
    this.population = 0;
    this.territories = []; // array of {x, y} tile coords
    this.government = 'tribal'; // tribal → chiefdom → kingdom → etc
    this.techLevel = 0;
    this.resources = { food: 0, wood: 0, stone: 0, metal: 0 };
    this.leader = generateLeader(rng);
    this.age = 0;
    this.atWar = false;
  }
}

class Leader {
  constructor(name, traits) {
    this.name = name;
    this.age = Math.floor(Math.random() * 20 + 20); // 20-40 when they take power
    this.traits = traits; // { aggression, diplomacy, ambition, caution }
    this.yearsInPower = 0;
  }
}

function generateColor(rng) {
  const hue = Math.floor(rng.next() * 360);
  const sat = Math.floor(rng.range(50, 85));
  const light = Math.floor(rng.range(40, 65));
  return `hsl(${hue}, ${sat}%, ${light}%)`;
}

function generateLeader(rng) {
  const firstNames = ['Aldric', 'Bjorn', 'Casimir', 'Darius', 'Eamon', 'Falk', 'Gorin', 'Harald', 'Ivar', 'Joran', 'Kael', 'Leif', 'Magnus', 'Niko', 'Orin', 'Pavel', 'Ragnor', 'Sven', 'Thrain', 'Ulric', 'Viktor', 'Wulfric', 'Xerxes', 'Yorick', 'Zoran'];
  const titles = ['the Bold', 'the Wise', 'the Great', 'the Fierce', 'the Just', 'the Cunning', 'the Strong', 'the Fair'];
  
  const firstName = firstNames[Math.floor(rng.next() * firstNames.length)];
  const title = rng.next() > 0.6 ? ' ' + titles[Math.floor(rng.next() * titles.length)] : '';
  
  const traits = {
    aggression: rng.next(),
    diplomacy: rng.next(),
    ambition: rng.next(),
    caution: rng.next(),
    freedom: rng.next(),
    rationality: rng.next()
  };
  
  return new Leader(firstName + title, traits);
}

function generateTribalLeader(rng) {
  const tribalNames = ['Atok', 'Bram', 'Crag', 'Durn', 'Eron', 'Fenn', 'Grok', 'Hrok', 'Jarn', 'Korg', 'Loth', 'Murn', 'Norg', 'Olf', 'Rok', 'Skar', 'Thok', 'Ulf', 'Vorn', 'Wrek'];
  const name = tribalNames[Math.floor(rng.next() * tribalNames.length)];
  
  // Generate personality with more variety
  const traits = {
    aggression: rng.next(),      // 0-1: peaceful to warlike
    diplomacy: rng.next(),        // 0-1: hostile to friendly
    ambition: rng.next(),         // 0-1: content to expansionist
    caution: rng.next(),          // 0-1: reckless to cautious
    freedom: rng.next(),          // 0-1: authoritarian to libertarian
    rationality: rng.next()       // 0-1: emotional to logical
  };
  
  return new Leader(name, traits);
}

function generateCultureName(rng) {
  const prefixes = ['Aka', 'Uru', 'Zul', 'Mor', 'Tek', 'Nal', 'Kra', 'Vec', 'Dro', 'Fen'];
  const suffixes = ['ni', 'ka', 'tu', 'ma', 'ri', 'lo', 'sa', 'nu', 'ta', 'ko'];
  const prefix = prefixes[Math.floor(rng.next() * prefixes.length)];
  const suffix = suffixes[Math.floor(rng.next() * suffixes.length)];
  return prefix + suffix;
}

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
  overlayCanvas.width = MAP_WIDTH;
  overlayCanvas.height = MAP_HEIGHT;
  
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

// ============================================
// TRIBE SPAWNING
// ============================================

function spawnInitialTribes(tiles, rng) {
  const tribes = [];
  const numTribes = Math.floor(rng.range(40, 80));
  
  // Find habitable tiles for spawning
  const habitableTiles = tiles.filter(tile => 
    tile.isLand && 
    tile.habitability > 0.3 &&
    tile.biomeType !== 'ice' &&
    tile.biomeType !== 'alpine'
  );
  
  // Sort by habitability
  habitableTiles.sort((a, b) => b.habitability - a.habitability);
  
  // Spawn tribes in best locations
  for (let i = 0; i < numTribes && i < habitableTiles.length; i++) {
    const tile = habitableTiles[Math.floor(rng.next() * Math.min(habitableTiles.length, 200))];
    
    const population = Math.floor(rng.range(50, 200));
    const tribe = new Tribe(i, tile.x, tile.y, population, rng);
    
    // Prefer river valleys and coasts
    if (tile.riverPresence === 'major') {
      tribe.population *= 1.5;
    } else if (tile.riverPresence === 'minor') {
      tribe.population *= 1.2;
    }
    
    if (tile.distanceToCoast < 3) {
      tribe.population *= 1.2;
    }
    
    tribe.population = Math.floor(tribe.population);
    
    // Initialize territory (just current tile)
    tribe.territories = [{ x: tile.x, y: tile.y }];
    
    tribes.push(tribe);
  }
  
  return tribes;
}

// ============================================
// SIMULATION TICK
// ============================================

function getTileAt(tiles, x, y) {
  const index = y * TILE_WIDTH + x;
  return tiles[index];
}

function simulateTick(tiles) {
  if (!gameState.running) return;
  
  gameState.year += 1;
  
  // Update all tribes
  for (let i = gameState.tribes.length - 1; i >= 0; i--) {
    const tribe = gameState.tribes[i];
    tribe.age++;
    
    const currentTile = getTileAt(tiles, tribe.x, tribe.y);
    
    // Population growth
    if (currentTile.isLand) {
      const growthRate = currentTile.foodPotential * 0.02;
      tribe.population += Math.floor(tribe.population * growthRate);
      
      // Random events can reduce population
      if (worldRng.next() < 0.01) {
        tribe.population = Math.floor(tribe.population * 0.9); // disease/famine
        logEvent('disaster', `${tribe.culture} tribe suffered from disease.`);
      }
    }
    
    // Death if population too low
    if (tribe.population < 10) {
      logEvent('extinction', `${tribe.culture} tribe has died out.`);
      gameState.tribes.splice(i, 1);
      continue;
    }
    
    // Settlement check - if staying in one spot long enough
    if (!tribe.settled) {
      if (tribe.migrationCooldown > 0) {
        tribe.migrationCooldown--;
        tribe.settlementYears++;
        
        // After 20-40 years in same spot (reduced from 50), consider settling
        const settlementThreshold = 20 + (tribe.leader.traits.caution * 20); // 20-40 years based on caution
        
        if (tribe.settlementYears > settlementThreshold && currentTile.habitability > 0.4 && tribe.population > 100) {
          tribe.settled = true;
          
          // Tech advancement from settling
          tribe.techLevel = 1; // Agriculture discovered
          
          logEvent('settlement', `${tribe.culture} tribe has settled under ${tribe.leader.name}.`);
          
          // Ambitious leaders more likely to form proto-states
          if (tribe.leader.traits.ambition > 0.7 && worldRng.next() < 0.4) {
            formCivilization(tribe, tiles);
            gameState.tribes.splice(i, 1);
            continue;
          }
        }
      } else {
        // Time to migrate
        migrateTribe(tribe, tiles);
      }
    } else {
      // Settled tribes can expand territory based on population and resources
      if (tribe.age % 5 === 0 && tribe.population > 150) {
        const tile = getTileAt(tiles, tribe.x, tribe.y);
        
        // Calculate expansion chance based on resources and population
        const resourceScore = (tile.foodPotential + tile.wood + tile.fertility) / 3;
        const populationScore = Math.min(1, tribe.population / 500);
        const expansionChance = (resourceScore * 0.5 + populationScore * 0.3 + tribe.leader.traits.ambition * 0.2);
        
        if (worldRng.next() < expansionChance) {
          expandTerritory(tribe, tiles, 'tribe');
        }
      }
      
      // Settled tribes might form countries (less often, more criteria)
      if (tribe.territories.length > 5 && tribe.population > 400 && tribe.age > 50) {
        const formationChance = tribe.leader.traits.ambition * 0.03;
        if (worldRng.next() < formationChance) {
          formCivilization(tribe, tiles);
          gameState.tribes.splice(i, 1);
          continue;
        }
      }
    }
    
    // Splitting - if population gets too large
    if (tribe.population > 500 && worldRng.next() < 0.05) {
      splitTribe(tribe, tiles);
    }
    
    // Early tribal conflicts
    if (tribe.settled && worldRng.next() < 0.02) {
      tribalConflict(tribe, tiles);
    }
  }
  
  // Update countries
  for (const country of gameState.countries) {
    country.age++;
    country.leader.yearsInPower++;
    country.leader.age++;
    
    // Population growth
    let totalPop = 0;
    for (const terr of country.territories) {
      const tile = getTileAt(tiles, terr.x, terr.y);
      const growth = tile.foodPotential * 0.03 * (1 + country.techLevel * 0.1);
      totalPop += Math.floor(tile.populationCapacity * 1000 * growth);
    }
    country.population = totalPop;
    
    // Tech progression
    if (country.age % 50 === 0 && worldRng.next() < 0.4) {
      country.techLevel++;
      logEvent('tech', `${country.name} advanced to tech level ${country.techLevel}.`);
    }
    
    // Leader death
    if (country.leader.age > 65 && worldRng.next() < 0.05) {
      const oldLeader = country.leader.name;
      country.leader = generateLeader(worldRng);
      logEvent('leader_change', `${oldLeader} of ${country.name} has died. ${country.leader.name} takes power.`);
    }
    
    // Expansion
    if (country.age % 15 === 0) {
      expandTerritory(country, tiles, 'country');
    }
    
    // Warfare
    if (country.age > 30 && !country.atWar && worldRng.next() < 0.03) {
      declareWar(country, tiles);
    }
  }
  
  // Check for tribe mergers
  checkTribeMergers(tiles);
  
  // Update UI
  updateGameUI();
  
  // Render overlay every tick for smooth visualization
  renderOverlay();
}

function migrateTribe(tribe, tiles) {
  const currentTile = getTileAt(tiles, tribe.x, tribe.y);
  
  // Find best neighboring tile
  const neighbors = [];
  const checkRadius = 2;
  
  for (let dy = -checkRadius; dy <= checkRadius; dy++) {
    for (let dx = -checkRadius; dx <= checkRadius; dx++) {
      if (dx === 0 && dy === 0) continue;
      
      const nx = (tribe.x + dx + TILE_WIDTH) % TILE_WIDTH;
      const ny = tribe.y + dy;
      
      if (ny < 0 || ny >= TILE_HEIGHT) continue;
      
      const tile = getTileAt(tiles, nx, ny);
      
      if (!tile.isLand) continue;
      
      // Check if already occupied by another tribe
      const isOccupied = gameState.tribes.some(t => 
        t.id !== tribe.id && t.territories.some(terr => terr.x === nx && terr.y === ny)
      );
      
      if (isOccupied) continue; // Can't spawn in occupied territory
      
      // Score this tile
      let score = tile.habitability * 100;
      
      // Prefer rivers
      if (tile.riverPresence === 'major') score += 50;
      else if (tile.riverPresence === 'minor') score += 25;
      
      // Prefer coasts
      if (tile.distanceToCoast < 2) score += 30;
      
      // Avoid bad biomes
      if (tile.biomeType === 'desert') score -= 40;
      if (tile.biomeType === 'ice' || tile.biomeType === 'tundra') score -= 60;
      
      // Avoid mountains
      if (tile.roughness > 0.5) score -= 30;
      
      neighbors.push({ tile, x: nx, y: ny, score });
    }
  }
  
  if (neighbors.length === 0) return;
  
  // Sort by score
  neighbors.sort((a, b) => b.score - a.score);
  
  // Leader personality affects choice
  let choice;
  
  // REALLY TINY chance (2%) of making a terrible decision (low rationality leaders)
  if (tribe.leader.traits.rationality < 0.3 && worldRng.next() < 0.02) {
    // Pick one of the WORST options 😂
    const worstIndex = Math.max(0, neighbors.length - 1 - Math.floor(worldRng.next() * 3));
    choice = neighbors[worstIndex];
    
    if (worldRng.next() < 0.3) {
      logEvent('migration', `${tribe.culture} tribe made a questionable decision under ${tribe.leader.name}...`);
    }
  } else {
    // Normal behavior: pick from top choices with some randomness
    const rationality = tribe.leader.traits.rationality;
    const topChoices = Math.max(1, Math.floor((1 - rationality) * 5) + 1); // Less rational = more random
    choice = neighbors[Math.floor(worldRng.next() * Math.min(topChoices, neighbors.length))];
  }
  
  // Move tribe
  tribe.x = choice.x;
  tribe.y = choice.y;
  tribe.territories = [{ x: choice.x, y: choice.y }];
  tribe.migrationCooldown = Math.floor(worldRng.range(15, 35)); // Stay for a while (reduced from 10-30)
  tribe.settlementYears = 0;
  
  if (worldRng.next() < 0.05) {
    logEvent('migration', `${tribe.culture} tribe migrated to new lands.`);
  }
}

function formCivilization(tribe, tiles) {
  const civName = tribe.culture + ' Civilization';
  const country = new Country(
    Date.now() + Math.random(), // Unique ID
    civName,
    tribe.x,
    tribe.y,
    tribe.color,
    worldRng
  );
  
  country.population = tribe.population;
  country.territories = [...tribe.territories];
  country.techLevel = tribe.techLevel;
  country.government = 'tribal_confederation';
  country.leader = tribe.leader; // Transfer the leader
  
  gameState.countries.push(country);
  logEvent('civilization', `${civName} has formed under ${tribe.leader.name}!`);
}

function expandTerritory(entity, tiles, entityType) {
  // Find neighboring unclaimed tiles
  const newTerritories = [];
  
  for (const terr of entity.territories) {
    const neighbors = [
      { x: (terr.x - 1 + TILE_WIDTH) % TILE_WIDTH, y: terr.y },
      { x: (terr.x + 1) % TILE_WIDTH, y: terr.y },
      { x: terr.x, y: Math.max(0, terr.y - 1) },
      { x: terr.x, y: Math.min(TILE_HEIGHT - 1, terr.y + 1) }
    ];
    
    for (const n of neighbors) {
      const tile = getTileAt(tiles, n.x, n.y);
      
      if (!tile.isLand) continue;
      
      // Check if already claimed
      const alreadyClaimed = entity.territories.some(t => t.x === n.x && t.y === n.y);
      if (alreadyClaimed) continue;
      
      // Check if claimed by another entity
      let claimedByOther = false;
      if (entityType === 'country') {
        claimedByOther = gameState.countries.some(c => 
          c.id !== entity.id && c.territories.some(t => t.x === n.x && t.y === n.y)
        );
      } else {
        claimedByOther = gameState.tribes.some(tr => 
          tr.id !== entity.id && tr.territories.some(t => t.x === n.x && t.y === n.y)
        );
      }
      
      if (claimedByOther) continue;
      
      // Expand if habitable
      if (tile.habitability > 0.3 && worldRng.next() < 0.3) {
        newTerritories.push({ x: n.x, y: n.y });
      }
    }
  }
  
  entity.territories.push(...newTerritories);
}

function tribalConflict(tribe, tiles) {
  // Find neighboring tribes
  for (const otherTribe of gameState.tribes) {
    if (otherTribe.id === tribe.id) continue;
    
    const dist = Math.abs(tribe.x - otherTribe.x) + Math.abs(tribe.y - otherTribe.y);
    
    if (dist <= 2 && otherTribe.settled) {
      // Conflict!
      if (tribe.population > otherTribe.population * 1.3) {
        // Tribe conquers other tribe
        tribe.population += Math.floor(otherTribe.population * 0.5);
        tribe.territories.push(...otherTribe.territories);
        
        logEvent('conquest', `${tribe.culture} tribe conquered ${otherTribe.culture} tribe.`);
        
        const index = gameState.tribes.indexOf(otherTribe);
        if (index > -1) gameState.tribes.splice(index, 1);
        
        return;
      }
    }
  }
}

function declareWar(country, tiles) {
  // Find neighboring countries
  const neighbors = [];
  
  for (const otherCountry of gameState.countries) {
    if (otherCountry.id === country.id) continue;
    
    // Check for shared borders
    for (const terr of country.territories) {
      const adjacent = [
        { x: (terr.x - 1 + TILE_WIDTH) % TILE_WIDTH, y: terr.y },
        { x: (terr.x + 1) % TILE_WIDTH, y: terr.y },
        { x: terr.x, y: Math.max(0, terr.y - 1) },
        { x: terr.x, y: Math.min(TILE_HEIGHT - 1, terr.y + 1) }
      ];
      
      for (const adj of adjacent) {
        if (otherCountry.territories.some(t => t.x === adj.x && t.y === adj.y)) {
          if (!neighbors.includes(otherCountry)) {
            neighbors.push(otherCountry);
          }
        }
      }
    }
  }
  
  if (neighbors.length === 0) return;
  
  // Pick a target based on leader aggression
  const target = neighbors[Math.floor(worldRng.next() * neighbors.length)];
  
  if (country.leader.traits.aggression > 0.6 || country.territories.length < target.territories.length * 0.5) {
    country.atWar = true;
    target.atWar = true;
    
    logEvent('war', `${country.name} declared war on ${target.name}!`);
    
    // Simple war resolution after some time
    setTimeout(() => {
      resolveWar(country, target, tiles);
    }, worldRng.range(5000, 15000)); // 5-15 seconds
  }
}

function resolveWar(attacker, defender, tiles) {
  attacker.atWar = false;
  defender.atWar = false;
  
  // Simple resolution based on size and tech
  const attackerStrength = attacker.territories.length * (1 + attacker.techLevel * 0.2);
  const defenderStrength = defender.territories.length * (1 + defender.techLevel * 0.2);
  
  if (attackerStrength > defenderStrength * 1.3) {
    // Attacker wins - takes some territory
    const taken = Math.floor(defender.territories.length * 0.3);
    const takenTerr = defender.territories.splice(0, taken);
    attacker.territories.push(...takenTerr);
    
    logEvent('war_end', `${attacker.name} victorious over ${defender.name}!`);
    
    // Defender might collapse
    if (defender.territories.length < 2) {
      logEvent('collapse', `${defender.name} has collapsed!`);
      const index = gameState.countries.indexOf(defender);
      if (index > -1) gameState.countries.splice(index, 1);
    }
  } else {
    logEvent('war_end', `${defender.name} defended against ${attacker.name}.`);
  }
}

function splitTribe(tribe, tiles) {
  // Limit total number of tribes
  if (gameState.tribes.length >= 600) return;
  
  const newPopulation = Math.floor(tribe.population * 0.4);
  tribe.population -= newPopulation;
  
  const newTribe = new Tribe(
    Date.now() + Math.random(), // Use unique ID
    tribe.x,
    tribe.y,
    newPopulation,
    worldRng
  );
  
  newTribe.culture = tribe.culture; // Inherit culture
  newTribe.techLevel = tribe.techLevel;
  
  gameState.tribes.push(newTribe);
  
  // New tribe migrates immediately
  newTribe.migrationCooldown = 0;
}

function checkTribeMergers(tiles) {
  for (let i = 0; i < gameState.tribes.length; i++) {
    for (let j = i + 1; j < gameState.tribes.length; j++) {
      const t1 = gameState.tribes[i];
      const t2 = gameState.tribes[j];
      
      // Check if in same location
      if (t1.x === t2.x && t1.y === t2.y) {
        // Check if compatible (same culture or both very small)
        if (t1.culture === t2.culture || (t1.population < 100 && t2.population < 100)) {
          // Merge into larger tribe
          if (t1.population >= t2.population) {
            t1.population += t2.population;
            gameState.tribes.splice(j, 1);
          } else {
            t2.population += t1.population;
            gameState.tribes.splice(i, 1);
          }
          return; // Only one merge per tick
        }
      }
    }
  }
}

function updateGameUI() {
  const tribeCount = gameState.tribes.length;
  const countryCount = gameState.countries.length;
  
  document.getElementById('worldStats').textContent = 
    `Year ${gameState.year} | Tribes: ${tribeCount} | Countries: ${countryCount}`;
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
  
  setProgress(0.85, 'Spawning tribes...');
  const tribes = spawnInitialTribes(tiles, rng);
  gameState.tribes = tribes;
  gameState.year = 0;
  
  console.log(`Spawned ${tribes.length} tribes`);
  console.log('Sample tribe:', tribes[0]);
  
  setProgress(0.90, 'Rendering planet...');
  await renderPlanetTexture(height, temperature, moisture, rivers);
  
  planetData = { height, temperature, moisture, rivers, tiles, seed };
  
  const planetName = generatePlanetName(rng);
  document.getElementById('worldName').textContent = planetName;
  updateGameUI();
  
  setProgress(1, 'Complete!');
  
  // Render initial overlay to show tribes immediately
  renderOverlay();
  
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
  
  // Draw overlay on top
  mapCtx.drawImage(
    overlayCanvas,
    camera.x, camera.y, viewWidth, viewHeight,
    0, 0, MAP_WIDTH, MAP_HEIGHT
  );
}

function renderOverlay() {
  overlayCtx.clearRect(0, 0, MAP_WIDTH, MAP_HEIGHT);
  
  const pixelsPerTileX = MAP_WIDTH / TILE_WIDTH;
  const pixelsPerTileY = MAP_HEIGHT / TILE_HEIGHT;
  
  // Draw country territories with fill
  for (const country of gameState.countries) {
    overlayCtx.fillStyle = country.color + '55'; // More visible semi-transparent
    
    for (const terr of country.territories) {
      const px = terr.x * pixelsPerTileX;
      const py = terr.y * pixelsPerTileY;
      overlayCtx.fillRect(px, py, pixelsPerTileX, pixelsPerTileY);
    }
  }
  
  // Draw tribe territories with fill - SHOW ALL TRIBES (not just settled)
  for (const tribe of gameState.tribes) {
    if (tribe.territories.length > 0) {
      overlayCtx.fillStyle = tribe.color + '60'; // Visible semi-transparent
      
      for (const terr of tribe.territories) {
        const px = terr.x * pixelsPerTileX;
        const py = terr.y * pixelsPerTileY;
        overlayCtx.fillRect(px, py, pixelsPerTileX, pixelsPerTileY);
      }
    }
  }
  
  // Draw country borders (thicker and more visible)
  overlayCtx.lineWidth = 3;
  
  for (const country of gameState.countries) {
    overlayCtx.strokeStyle = country.color;
    
    for (const terr of country.territories) {
      const px = terr.x * pixelsPerTileX;
      const py = terr.y * pixelsPerTileY;
      
      // Check each edge
      const neighbors = [
        { dx: -1, dy: 0 }, { dx: 1, dy: 0 },
        { dx: 0, dy: -1 }, { dx: 0, dy: 1 }
      ];
      
      for (const n of neighbors) {
        const nx = (terr.x + n.dx + TILE_WIDTH) % TILE_WIDTH;
        const ny = terr.y + n.dy;
        
        if (ny < 0 || ny >= TILE_HEIGHT) continue;
        
        const isOwn = country.territories.some(t => t.x === nx && t.y === ny);
        
        if (!isOwn) {
          // Draw border
          overlayCtx.beginPath();
          if (n.dx === -1) {
            overlayCtx.moveTo(px, py);
            overlayCtx.lineTo(px, py + pixelsPerTileY);
          } else if (n.dx === 1) {
            overlayCtx.moveTo(px + pixelsPerTileX, py);
            overlayCtx.lineTo(px + pixelsPerTileX, py + pixelsPerTileY);
          } else if (n.dy === -1) {
            overlayCtx.moveTo(px, py);
            overlayCtx.lineTo(px + pixelsPerTileX, py);
          } else if (n.dy === 1) {
            overlayCtx.moveTo(px, py + pixelsPerTileY);
            overlayCtx.lineTo(px + pixelsPerTileX, py + pixelsPerTileY);
          }
          overlayCtx.stroke();
        }
      }
    }
  }
  
  // Draw tribe borders (slightly thinner)
  overlayCtx.lineWidth = 2;
  
  for (const tribe of gameState.tribes) {
    if (tribe.settled && tribe.territories.length > 0) {
      overlayCtx.strokeStyle = tribe.color;
      
      for (const terr of tribe.territories) {
        const px = terr.x * pixelsPerTileX;
        const py = terr.y * pixelsPerTileY;
        
        const neighbors = [
          { dx: -1, dy: 0 }, { dx: 1, dy: 0 },
          { dx: 0, dy: -1 }, { dx: 0, dy: 1 }
        ];
        
        for (const n of neighbors) {
          const nx = (terr.x + n.dx + TILE_WIDTH) % TILE_WIDTH;
          const ny = terr.y + n.dy;
          
          if (ny < 0 || ny >= TILE_HEIGHT) continue;
          
          const isOwn = tribe.territories.some(t => t.x === nx && t.y === ny);
          
          if (!isOwn) {
            overlayCtx.beginPath();
            if (n.dx === -1) {
              overlayCtx.moveTo(px, py);
              overlayCtx.lineTo(px, py + pixelsPerTileY);
            } else if (n.dx === 1) {
              overlayCtx.moveTo(px + pixelsPerTileX, py);
              overlayCtx.lineTo(px + pixelsPerTileX, py + pixelsPerTileY);
            } else if (n.dy === -1) {
              overlayCtx.moveTo(px, py);
              overlayCtx.lineTo(px + pixelsPerTileX, py);
            } else if (n.dy === 1) {
              overlayCtx.moveTo(px, py + pixelsPerTileY);
              overlayCtx.lineTo(px + pixelsPerTileX, py + pixelsPerTileY);
            }
            overlayCtx.stroke();
          }
        }
      }
    }
  }
  
  // Draw labels
  overlayCtx.textAlign = 'center';
  overlayCtx.textBaseline = 'middle';
  overlayCtx.shadowColor = 'rgba(0, 0, 0, 0.9)';
  overlayCtx.shadowBlur = 6;
  
  // Draw country labels
  for (const country of gameState.countries) {
    if (country.territories.length === 0) continue;
    
    // Calculate center of country
    let sumX = 0, sumY = 0;
    for (const terr of country.territories) {
      sumX += terr.x;
      sumY += terr.y;
    }
    const centerX = (sumX / country.territories.length) * pixelsPerTileX + pixelsPerTileX / 2;
    const centerY = (sumY / country.territories.length) * pixelsPerTileY + pixelsPerTileY / 2;
    
    // Font size based on territory size (scaled better)
    const fontSize = Math.max(14, Math.min(48, country.territories.length * 2.5));
    overlayCtx.font = `bold ${fontSize}px Arial`;
    overlayCtx.fillStyle = '#ffffff';
    
    overlayCtx.fillText(country.name, centerX, centerY);
  }
  
  // Draw tribe labels - SHOW ALL TRIBES
  for (const tribe of gameState.tribes) {
    if (tribe.territories.length > 0) {
      let sumX = 0, sumY = 0;
      for (const terr of tribe.territories) {
        sumX += terr.x;
        sumY += terr.y;
      }
      const centerX = (sumX / tribe.territories.length) * pixelsPerTileX + pixelsPerTileX / 2;
      const centerY = (sumY / tribe.territories.length) * pixelsPerTileY + pixelsPerTileY / 2;
      
      const fontSize = Math.max(10, Math.min(20, tribe.territories.length * 2));
      overlayCtx.font = `${fontSize}px Arial`;
      overlayCtx.fillStyle = '#eeeeee';
      
      overlayCtx.fillText(tribe.culture, centerX, centerY);
    }
  }
  
  overlayCtx.shadowBlur = 0;
  
  renderCamera();
}

// Click to view info
mapCanvas.addEventListener('click', (e) => {
  const rect = mapCanvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;
  
  // Check if clicking on entity
  const screenWidth = window.innerWidth;
  const screenHeight = window.innerHeight;
  const viewWidth = screenWidth / camera.zoom;
  const viewHeight = screenHeight / camera.zoom;
  
  const worldX = camera.x + (mouseX / screenWidth) * viewWidth;
  const worldY = camera.y + (mouseY / screenHeight) * viewHeight;
  
  const pixelsPerTileX = MAP_WIDTH / TILE_WIDTH;
  const pixelsPerTileY = MAP_HEIGHT / TILE_HEIGHT;
  
  const tileX = Math.floor(worldX / pixelsPerTileX);
  const tileY = Math.floor(worldY / pixelsPerTileY);
  
  // Check if clicking on a country
  let clicked = false;
  for (const country of gameState.countries) {
    if (country.territories.some(t => t.x === tileX && t.y === tileY)) {
      showCountryInfo(country);
      clicked = true;
      return;
    }
  }
  
  // Check if clicking on a tribe
  if (!clicked) {
    for (const tribe of gameState.tribes) {
      if (tribe.territories.some(t => t.x === tileX && t.y === tileY)) {
        showTribeInfo(tribe);
        clicked = true;
        return;
      }
    }
  }
  
  // Otherwise show tile info
  if (!clicked && planetData && planetData.tiles) {
    const tile = getTileAt(planetData.tiles, tileX, tileY);
    if (tile) {
      showTileInfo(tile);
      return;
    }
  }
});

function showTileInfo(tile) {
  const panel = document.getElementById('infoPanel');
  const title = document.getElementById('infoPanelTitle');
  const content = document.getElementById('infoPanelContent');
  
  title.textContent = `Tile (${tile.x}, ${tile.y})`;
  
  content.innerHTML = `
    <div class="info-row"><span class="info-label">Biome:</span><span class="info-value">${tile.biomeType}</span></div>
    <div class="info-row"><span class="info-label">Elevation:</span><span class="info-value">${tile.elevation.toFixed(2)}</span></div>
    <div class="info-row"><span class="info-label">Temperature:</span><span class="info-value">${tile.temperature.toFixed(2)}</span></div>
    <div class="info-row"><span class="info-label">Rainfall:</span><span class="info-value">${tile.rainfall.toFixed(2)}</span></div>
    <div class="info-row"><span class="info-label">Habitability:</span><span class="info-value">${tile.habitability.toFixed(2)}</span></div>
    <div class="info-row"><span class="info-label">River:</span><span class="info-value">${tile.riverPresence}</span></div>
    <div class="info-row"><span class="info-label">Coast Distance:</span><span class="info-value">${tile.distanceToCoast.toFixed(1)}</span></div>
    <div class="info-row"><span class="info-label">Food Potential:</span><span class="info-value">${tile.foodPotential.toFixed(2)}</span></div>
    <div class="info-row"><span class="info-label">Wood:</span><span class="info-value">${tile.wood.toFixed(2)}</span></div>
    <div class="info-row"><span class="info-label">Stone:</span><span class="info-value">${tile.stone.toFixed(2)}</span></div>
    <div class="info-row"><span class="info-label">Metals:</span><span class="info-value">${tile.metals.toFixed(2)}</span></div>
  `;
  
  panel.style.display = 'block';
}

function showTribeInfo(tribe) {
  const panel = document.getElementById('infoPanel');
  const title = document.getElementById('infoPanelTitle');
  const content = document.getElementById('infoPanelContent');
  
  title.textContent = `${tribe.culture} Tribe`;
  
  content.innerHTML = `
    <div class="info-row"><span class="info-label">Leader:</span><span class="info-value">${tribe.leader.name}</span></div>
    <div class="info-row"><span class="info-label">Population:</span><span class="info-value">${tribe.population}</span></div>
    <div class="info-row"><span class="info-label">Age:</span><span class="info-value">${tribe.age} years</span></div>
    <div class="info-row"><span class="info-label">Tech Level:</span><span class="info-value">${tribe.techLevel}</span></div>
    <div class="info-row"><span class="info-label">Status:</span><span class="info-value">${tribe.settled ? 'Settled' : 'Nomadic'}</span></div>
    <div class="info-row"><span class="info-label">Territories:</span><span class="info-value">${tribe.territories.length}</span></div>
    <div class="info-row"><span class="info-label">Location:</span><span class="info-value">(${tribe.x}, ${tribe.y})</span></div>
    <h4 style="color: var(--accent); margin-top: 12px; margin-bottom: 6px;">Leader Traits</h4>
    <div class="info-row"><span class="info-label">Aggression:</span><span class="info-value">${(tribe.leader.traits.aggression * 100).toFixed(0)}%</span></div>
    <div class="info-row"><span class="info-label">Diplomacy:</span><span class="info-value">${(tribe.leader.traits.diplomacy * 100).toFixed(0)}%</span></div>
    <div class="info-row"><span class="info-label">Ambition:</span><span class="info-value">${(tribe.leader.traits.ambition * 100).toFixed(0)}%</span></div>
    <div class="info-row"><span class="info-label">Caution:</span><span class="info-value">${(tribe.leader.traits.caution * 100).toFixed(0)}%</span></div>
    <div class="info-row"><span class="info-label">Freedom:</span><span class="info-value">${(tribe.leader.traits.freedom * 100).toFixed(0)}%</span></div>
    <div class="info-row"><span class="info-label">Rationality:</span><span class="info-value">${(tribe.leader.traits.rationality * 100).toFixed(0)}%</span></div>
  `;
  
  panel.style.display = 'block';
}

function showCountryInfo(country) {
  const panel = document.getElementById('infoPanel');
  const title = document.getElementById('infoPanelTitle');
  const content = document.getElementById('infoPanelContent');
  
  title.textContent = country.name;
  
  content.innerHTML = `
    <div class="info-row"><span class="info-label">Government:</span><span class="info-value">${country.government}</span></div>
    <div class="info-row"><span class="info-label">Leader:</span><span class="info-value">${country.leader.name}</span></div>
    <div class="info-row"><span class="info-label">Leader Age:</span><span class="info-value">${country.leader.age}</span></div>
    <div class="info-row"><span class="info-label">Years in Power:</span><span class="info-value">${country.leader.yearsInPower}</span></div>
    <div class="info-row"><span class="info-label">Population:</span><span class="info-value">${country.population.toLocaleString()}</span></div>
    <div class="info-row"><span class="info-label">Age:</span><span class="info-value">${country.age} years</span></div>
    <div class="info-row"><span class="info-label">Tech Level:</span><span class="info-value">${country.techLevel}</span></div>
    <div class="info-row"><span class="info-label">Territories:</span><span class="info-value">${country.territories.length}</span></div>
    <div class="info-row"><span class="info-label">At War:</span><span class="info-value">${country.atWar ? 'Yes' : 'No'}</span></div>
    <div class="info-row"><span class="info-label">Capital:</span><span class="info-value">(${country.capitalX}, ${country.capitalY})</span></div>
    <h4 style="color: var(--accent); margin-top: 12px; margin-bottom: 6px;">Leader Traits</h4>
    <div class="info-row"><span class="info-label">Aggression:</span><span class="info-value">${(country.leader.traits.aggression * 100).toFixed(0)}%</span></div>
    <div class="info-row"><span class="info-label">Diplomacy:</span><span class="info-value">${(country.leader.traits.diplomacy * 100).toFixed(0)}%</span></div>
    <div class="info-row"><span class="info-label">Ambition:</span><span class="info-value">${(country.leader.traits.ambition * 100).toFixed(0)}%</span></div>
    <div class="info-row"><span class="info-label">Caution:</span><span class="info-value">${(country.leader.traits.caution * 100).toFixed(0)}%</span></div>
    <div class="info-row"><span class="info-label">Freedom:</span><span class="info-value">${((country.leader.traits.freedom || 0.5) * 100).toFixed(0)}%</span></div>
    <div class="info-row"><span class="info-label">Rationality:</span><span class="info-value">${((country.leader.traits.rationality || 0.5) * 100).toFixed(0)}%</span></div>
  `;
  
  panel.style.display = 'block';
}

document.getElementById('closeInfoPanel').addEventListener('click', () => {
  document.getElementById('infoPanel').style.display = 'none';
});

// Keyboard controls for camera movement
window.addEventListener('keydown', (e) => {
  if (e.key in keys || e.key === 'w' || e.key === 'a' || e.key === 's' || e.key === 'd') {
    keys[e.key] = true;
    e.preventDefault();
  }
});

window.addEventListener('keyup', (e) => {
  if (e.key in keys || e.key === 'w' || e.key === 'a' || e.key === 's' || e.key === 'd') {
    keys[e.key] = false;
    e.preventDefault();
  }
});

function updateCameraMovement() {
  let moved = false;
  const speed = camera.moveSpeed / camera.zoom;
  
  if (keys.w || keys.ArrowUp) {
    camera.y -= speed;
    moved = true;
  }
  if (keys.s || keys.ArrowDown) {
    camera.y += speed;
    moved = true;
  }
  if (keys.a || keys.ArrowLeft) {
    camera.x -= speed;
    moved = true;
  }
  if (keys.d || keys.ArrowRight) {
    camera.x += speed;
    moved = true;
  }
  
  if (moved) {
    renderCamera();
  }
}

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

mapCanvas.style.cursor = 'default';

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
    
    // Start simulation
    gameState.running = true;
    startGameLoop();
    
  } catch (err) {
    console.error(err);
    setProgress(0, 'Error: ' + err.message);
  }
});

// ============================================
// GAME LOOP
// ============================================

let lastTickTime = 0;

function startGameLoop() {
  lastTickTime = Date.now();
  requestAnimationFrame(gameLoop);
}

function gameLoop() {
  const now = Date.now();
  const speed = SPEEDS[gameState.speed];
  
  if (speed > 0 && gameState.running) {
    const interval = 1000 / speed; // ms per tick
    
    if (now - lastTickTime >= interval) {
      simulateTick(planetData.tiles);
      lastTickTime = now;
    }
  }
  
  // Update camera movement every frame
  updateCameraMovement();
  
  requestAnimationFrame(gameLoop);
}

document.querySelectorAll('.time-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const speed = parseInt(btn.getAttribute('data-speed'));
    gameState.speed = speed;
    
    if (speed === 0) {
      gameState.running = false;
    } else {
      gameState.running = true;
    }
    
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
