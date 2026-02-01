// render.js - Canvas rendering: terrain, territories, cities, rivers

import { toIndex, wrapX } from './utils.js';
import { TERRAIN } from './world.js';

// Terrain colors
const TERRAIN_COLORS = {
  [TERRAIN.DEEP_OCEAN]: '#0a1e3d',
  [TERRAIN.OCEAN]: '#1a3a5c',
  [TERRAIN.SHALLOW]: '#2e5a7d',
  [TERRAIN.COAST]: '#d4c4a0',
  [TERRAIN.PLAINS]: '#6b8e5a',
  [TERRAIN.HILLS]: '#5a7849',
  [TERRAIN.MOUNTAINS]: '#4a4a4a',
  [TERRAIN.SNOW]: '#e8e8e8',
  [TERRAIN.ICE]: '#f0f8ff'
};

export class Renderer {
  constructor(canvas, world) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.world = world;
    
    // Offscreen canvas for pre-rendered terrain
    this.terrainCanvas = document.createElement('canvas');
    this.terrainCanvas.width = world.width;
    this.terrainCanvas.height = world.height;
    this.terrainCtx = this.terrainCanvas.getContext('2d', { alpha: false });
    
    // Camera
    this.camera = {
      x: 0,
      y: 0,
      zoom: 1.0,
      targetZoom: 1.0
    };
    
    this.preRenderTerrain();
  }

  preRenderTerrain() {
    const imageData = this.terrainCtx.createImageData(this.world.width, this.world.height);
    const data = imageData.data;
    
    for (let y = 0; y < this.world.height; y++) {
      for (let x = 0; x < this.world.width; x++) {
        const idx = toIndex(x, y, this.world.width);
        const terrain = this.world.terrain[idx];
        
        const color = TERRAIN_COLORS[terrain] || '#000000';
        const rgb = this.hexToRgb(color);
        
        const pixelIdx = idx * 4;
        data[pixelIdx] = rgb.r;
        data[pixelIdx + 1] = rgb.g;
        data[pixelIdx + 2] = rgb.b;
        data[pixelIdx + 3] = 255;
      }
    }
    
    this.terrainCtx.putImageData(imageData, 0, 0);
  }

  hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : { r: 0, g: 0, b: 0 };
  }

  render(simulation) {
    // Resize canvas to match window
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    
    this.ctx.scale(dpr, dpr);
    this.ctx.imageSmoothingEnabled = false;
    
    // Clear
    this.ctx.fillStyle = '#000000';
    this.ctx.fillRect(0, 0, rect.width, rect.height);
    
    // Smooth camera zoom
    this.camera.zoom += (this.camera.targetZoom - this.camera.zoom) * 0.1;
    
    // Draw terrain
    this.ctx.save();
    this.ctx.translate(-this.camera.x * this.camera.zoom, -this.camera.y * this.camera.zoom);
    this.ctx.scale(this.camera.zoom, this.camera.zoom);
    
    this.ctx.drawImage(this.terrainCanvas, 0, 0);
    
    // Draw rivers
    this.drawRivers();
    
    // Draw territories
    this.drawTerritories(simulation.tribes, simulation.countries);
    
    // Draw cities
    this.drawCities(simulation.countries);
    
    this.ctx.restore();
  }

  drawRivers() {
    this.ctx.strokeStyle = 'rgba(100, 180, 255, 0.4)';
    this.ctx.lineWidth = 1;
    
    for (let y = 0; y < this.world.height; y++) {
      for (let x = 0; x < this.world.width; x++) {
        const idx = toIndex(x, y, this.world.width);
        if (this.world.rivers[idx] > 0) {
          this.ctx.fillStyle = 'rgba(100, 180, 255, 0.3)';
          this.ctx.fillRect(x, y, 1, 1);
        }
      }
    }
  }

  drawTerritories(tribes, countries) {
    // Draw tribe territories
    for (const tribe of tribes) {
      this.ctx.fillStyle = this.hexToRgba(tribe.color, 0.3);
      for (const t of tribe.territories) {
        this.ctx.fillRect(t.x, t.y, 1, 1);
      }
    }
    
    // Draw country territories
    for (const country of countries) {
      this.ctx.fillStyle = this.hexToRgba(country.color, 0.4);
      for (const t of country.territories) {
        this.ctx.fillRect(t.x, t.y, 1, 1);
      }
      
      // Draw borders
      this.ctx.strokeStyle = this.hexToRgba(country.color, 0.8);
      this.ctx.lineWidth = 0.5;
      
      for (const t of country.territories) {
        // Check if edge tile
        const isEdge = this.isEdgeTile(t, country.territories);
        if (isEdge) {
          this.ctx.strokeRect(t.x, t.y, 1, 1);
        }
      }
    }
  }

  isEdgeTile(tile, territories) {
    const neighbors = [
      { x: tile.x + 1, y: tile.y },
      { x: tile.x - 1, y: tile.y },
      { x: tile.x, y: tile.y + 1 },
      { x: tile.x, y: tile.y - 1 }
    ];
    
    for (const n of neighbors) {
      const owned = territories.some(t => t.x === n.x && t.y === n.y);
      if (!owned) return true;
    }
    
    return false;
  }

  drawCities(countries) {
    for (const country of countries) {
      for (const city of country.cities) {
        if (city.isCapital) {
          this.ctx.fillStyle = '#ffd700';
          this.ctx.beginPath();
          this.ctx.arc(city.x + 0.5, city.y + 0.5, 2 / this.camera.zoom, 0, Math.PI * 2);
          this.ctx.fill();
        } else {
          this.ctx.fillStyle = '#ffffff';
          this.ctx.beginPath();
          this.ctx.arc(city.x + 0.5, city.y + 0.5, 1 / this.camera.zoom, 0, Math.PI * 2);
          this.ctx.fill();
        }
      }
    }
  }

  hexToRgba(hex, alpha) {
    // Handle HSL format
    if (hex.startsWith('hsl')) {
      return hex.replace('hsl', 'hsla').replace(')', `, ${alpha})`);
    }
    
    const rgb = this.hexToRgb(hex);
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
  }

  panCamera(dx, dy) {
    this.camera.x += dx / this.camera.zoom;
    this.camera.y += dy / this.camera.zoom;
    
    // Clamp Y
    this.camera.y = Math.max(0, Math.min(this.world.height - this.canvas.height / this.camera.zoom, this.camera.y));
    
    // Wrap X
    while (this.camera.x < 0) this.camera.x += this.world.width;
    while (this.camera.x >= this.world.width) this.camera.x -= this.world.width;
  }

  zoom(delta, centerX = null, centerY = null) {
    const oldZoom = this.camera.targetZoom;
    this.camera.targetZoom = Math.max(0.5, Math.min(4, this.camera.targetZoom * (1 + delta)));
    
    // Zoom toward mouse position if provided
    if (centerX !== null && centerY !== null) {
      const worldX = (centerX + this.camera.x * this.camera.zoom) / this.camera.zoom;
      const worldY = (centerY + this.camera.y * this.camera.zoom) / this.camera.zoom;
      
      this.camera.x = worldX - centerX / this.camera.targetZoom;
      this.camera.y = worldY - centerY / this.camera.targetZoom;
    }
  }

  screenToWorld(screenX, screenY) {
    return {
      x: (screenX + this.camera.x * this.camera.zoom) / this.camera.zoom,
      y: (screenY + this.camera.y * this.camera.zoom) / this.camera.zoom
    };
  }

  focusOn(x, y) {
    const rect = this.canvas.getBoundingClientRect();
    this.camera.x = x - rect.width / (2 * this.camera.zoom);
    this.camera.y = y - rect.height / (2 * this.camera.zoom);
  }
}
