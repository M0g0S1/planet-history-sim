// world.js - World generation: map, noise, climate, rivers, heightmap

import { SimplexNoise, octaveNoise, toIndex, wrapX, clampY, getNeighbors } from './utils.js';

export const MAP_WIDTH = 2048;
export const MAP_HEIGHT = 1024;

// Terrain types
export const TERRAIN = {
  DEEP_OCEAN: 0,
  OCEAN: 1,
  SHALLOW: 2,
  COAST: 3,
  PLAINS: 4,
  HILLS: 5,
  MOUNTAINS: 6,
  SNOW: 7,
  ICE: 8
};

// Climate types
export const CLIMATE = {
  POLAR: 0,
  TUNDRA: 1,
  BOREAL: 2,
  TEMPERATE: 3,
  MEDITERRANEAN: 4,
  SUBTROPICAL: 5,
  TROPICAL: 6,
  ARID: 7,
  DESERT: 8
};

export class World {
  constructor(rng) {
    this.rng = rng;
    this.width = MAP_WIDTH;
    this.height = MAP_HEIGHT;
    
    // Typed arrays for efficient storage
    this.elevation = new Float32Array(MAP_WIDTH * MAP_HEIGHT);
    this.terrain = new Uint8Array(MAP_WIDTH * MAP_HEIGHT);
    this.climate = new Uint8Array(MAP_WIDTH * MAP_HEIGHT);
    this.rivers = new Uint8Array(MAP_WIDTH * MAP_HEIGHT); // 0 = no river, 1+ = river strength
    this.moisture = new Float32Array(MAP_WIDTH * MAP_HEIGHT);
    
    this.noise = new SimplexNoise(rng);
  }

  generate(progressCallback) {
    // Step 1: Generate elevation
    progressCallback(0.1, 'Generating terrain...');
    this.generateElevation();
    
    // Step 2: Assign terrain types based on elevation
    progressCallback(0.3, 'Classifying terrain...');
    this.classifyTerrain();
    
    // Step 3: Generate climate
    progressCallback(0.5, 'Simulating climate...');
    this.generateClimate();
    
    // Step 4: Generate rivers
    progressCallback(0.7, 'Carving rivers...');
    this.generateRivers();
    
    // Step 5: Add moisture from rivers and coasts
    progressCallback(0.9, 'Adding moisture...');
    this.calculateMoisture();
    
    progressCallback(1.0, 'World complete!');
  }

  generateElevation() {
    const scale = 0.006; // Controls "zoom" of noise
    
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const idx = toIndex(x, y, this.width);
        
        // Use multi-octave noise for natural-looking terrain
        let elevation = octaveNoise(this.noise, x, y, 6, 0.5, scale);
        
        // Apply latitude gradient (more ocean near poles)
        const latFactor = Math.abs(y / this.height - 0.5) * 2; // 0 at equator, 1 at poles
        elevation -= latFactor * 0.3;
        
        // Add some randomness
        elevation += (this.rng.next() - 0.5) * 0.05;
        
        this.elevation[idx] = elevation;
      }
    }
    
    // Normalize elevation to -1 to 1 range
    this.normalizeElevation();
  }

  normalizeElevation() {
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < this.elevation.length; i++) {
      if (this.elevation[i] < min) min = this.elevation[i];
      if (this.elevation[i] > max) max = this.elevation[i];
    }
    
    for (let i = 0; i < this.elevation.length; i++) {
      this.elevation[i] = (this.elevation[i] - min) / (max - min) * 2 - 1;
    }
  }

  classifyTerrain() {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const idx = toIndex(x, y, this.width);
        const elev = this.elevation[idx];
        const lat = Math.abs(y / this.height - 0.5) * 2;
        
        // Classify based on elevation and latitude
        if (elev < -0.4) {
          this.terrain[idx] = TERRAIN.DEEP_OCEAN;
        } else if (elev < -0.15) {
          this.terrain[idx] = TERRAIN.OCEAN;
        } else if (elev < 0) {
          this.terrain[idx] = TERRAIN.SHALLOW;
        } else if (elev < 0.05) {
          this.terrain[idx] = TERRAIN.COAST;
        } else if (elev < 0.3) {
          this.terrain[idx] = TERRAIN.PLAINS;
        } else if (elev < 0.6) {
          this.terrain[idx] = TERRAIN.HILLS;
        } else if (elev < 0.8) {
          this.terrain[idx] = TERRAIN.MOUNTAINS;
        } else {
          // High elevation = snow/ice depending on latitude
          this.terrain[idx] = lat > 0.6 ? TERRAIN.ICE : TERRAIN.SNOW;
        }
      }
    }
  }

  generateClimate() {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const idx = toIndex(x, y, this.width);
        const elev = this.elevation[idx];
        
        // Latitude factor (0 = equator, 1 = poles)
        const lat = Math.abs(y / this.height - 0.5) * 2;
        
        // Temperature decreases with latitude and elevation
        const temp = 1 - lat - Math.max(0, elev) * 0.5;
        
        // Moisture from noise (will be modified by rivers/coast later)
        const moistureNoise = octaveNoise(this.noise, x + 1000, y + 1000, 4, 0.5, 0.004);
        
        // Classify climate
        if (this.terrain[idx] <= TERRAIN.SHALLOW) {
          this.climate[idx] = CLIMATE.TROPICAL; // Ocean = tropical for now
        } else if (lat > 0.8) {
          this.climate[idx] = CLIMATE.POLAR;
        } else if (lat > 0.6) {
          this.climate[idx] = CLIMATE.TUNDRA;
        } else if (temp < 0.3) {
          this.climate[idx] = CLIMATE.BOREAL;
        } else if (temp < 0.5) {
          this.climate[idx] = CLIMATE.TEMPERATE;
        } else if (moistureNoise < -0.3) {
          this.climate[idx] = CLIMATE.DESERT;
        } else if (moistureNoise < 0) {
          this.climate[idx] = CLIMATE.ARID;
        } else if (temp < 0.7) {
          this.climate[idx] = CLIMATE.MEDITERRANEAN;
        } else if (temp < 0.85) {
          this.climate[idx] = CLIMATE.SUBTROPICAL;
        } else {
          this.climate[idx] = CLIMATE.TROPICAL;
        }
      }
    }
  }

  generateRivers() {
    const numRivers = 200;
    const minElevation = 0.4; // Rivers start in hills/mountains
    
    // Find potential river sources (high elevation land)
    const sources = [];
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const idx = toIndex(x, y, this.width);
        if (this.elevation[idx] > minElevation && this.terrain[idx] >= TERRAIN.PLAINS) {
          sources.push({ x, y, idx });
        }
      }
    }
    
    // Shuffle and pick river sources
    for (let i = sources.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng.next() * (i + 1));
      [sources[i], sources[j]] = [sources[j], sources[i]];
    }
    
    // Trace rivers downhill
    const riversToGenerate = Math.min(numRivers, sources.length);
    for (let i = 0; i < riversToGenerate; i++) {
      this.traceRiver(sources[i].x, sources[i].y);
    }
  }

  traceRiver(startX, startY) {
    let x = startX, y = startY;
    let steps = 0;
    const maxSteps = 500;
    const visited = new Set();
    
    while (steps < maxSteps) {
      const idx = toIndex(x, y, this.width);
      const key = `${x},${y}`;
      
      // Stop if we hit ocean or revisit a tile
      if (this.terrain[idx] <= TERRAIN.SHALLOW || visited.has(key)) {
        break;
      }
      
      visited.add(key);
      this.rivers[idx] = Math.min(255, this.rivers[idx] + 1);
      
      // Find lowest neighbor
      const neighbors = getNeighbors(x, y, this.width, this.height);
      let lowest = null;
      let lowestElev = this.elevation[idx];
      
      for (const n of neighbors) {
        const nIdx = toIndex(n.x, n.y, this.width);
        if (this.elevation[nIdx] < lowestElev) {
          lowestElev = this.elevation[nIdx];
          lowest = n;
        }
      }
      
      if (!lowest) break; // No downhill path
      
      x = lowest.x;
      y = lowest.y;
      steps++;
    }
  }

  calculateMoisture() {
    // Add moisture from rivers and coasts
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const idx = toIndex(x, y, this.width);
        
        let moisture = 0;
        
        // Rivers add moisture
        if (this.rivers[idx] > 0) {
          moisture += 0.5;
        }
        
        // Check for nearby water
        const neighbors = getNeighbors(x, y, this.width, this.height);
        for (const n of neighbors) {
          const nIdx = toIndex(n.x, n.y, this.width);
          if (this.terrain[nIdx] <= TERRAIN.SHALLOW) {
            moisture += 0.1;
          }
          if (this.rivers[nIdx] > 0) {
            moisture += 0.2;
          }
        }
        
        this.moisture[idx] = Math.min(1, moisture);
      }
    }
  }

  // Helper: is tile habitable?
  isHabitable(x, y) {
    const idx = toIndex(x, y, this.width);
    const t = this.terrain[idx];
    return t >= TERRAIN.COAST && t <= TERRAIN.HILLS;
  }

  // Helper: get fertility (0-1) for agriculture
  getFertility(x, y) {
    const idx = toIndex(x, y, this.width);
    if (!this.isHabitable(x, y)) return 0;
    
    const c = this.climate[idx];
    const moisture = this.moisture[idx];
    
    let fertility = 0.3; // Base
    
    // Climate bonuses
    if (c === CLIMATE.TEMPERATE || c === CLIMATE.MEDITERRANEAN) fertility += 0.4;
    else if (c === CLIMATE.SUBTROPICAL || c === CLIMATE.TROPICAL) fertility += 0.3;
    else if (c === CLIMATE.ARID) fertility -= 0.2;
    else if (c === CLIMATE.DESERT) fertility -= 0.5;
    
    // Moisture bonus
    fertility += moisture * 0.3;
    
    // River bonus
    if (this.rivers[idx] > 0) fertility += 0.3;
    
    return Math.max(0, Math.min(1, fertility));
  }
}
