// main.js - Bootstrap file: initialize game, attach UI handlers, orchestrate flow

import { SeededRNG } from './utils.js';
import { World, MAP_WIDTH, MAP_HEIGHT } from './world.js';
import { Simulation } from './simulation.js';
import { Renderer } from './render.js';
import { UI } from './ui.js';
import { IOManager } from './io.js';

// Global game state
let gameState = {
  world: null,
  simulation: null,
  renderer: null,
  rng: null,
  ui: null,
  io: null,
  running: false,
  animationFrameId: null
};

// Keyboard state
const keys = {
  w: false, a: false, s: false, d: false,
  ArrowUp: false, ArrowLeft: false, ArrowDown: false, ArrowRight: false
};

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  setupUI();
  setupKeyboardControls();
});

function setupUI() {
  gameState.ui = new UI();
  gameState.io = new IOManager();
  
  // Play button
  document.getElementById('playBtn').addEventListener('click', startGame);
  
  // Settings
  document.getElementById('settingsBtn').addEventListener('click', () => {
    gameState.ui.showSettings();
  });
  
  document.getElementById('closeSettings').addEventListener('click', () => {
    gameState.ui.hideSettings();
  });
  
  // Info panel
  document.getElementById('closeInfoPanel').addEventListener('click', () => {
    gameState.ui.hideInfoPanel();
  });
  
  // Time controls
  document.querySelectorAll('.time-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const speed = parseInt(btn.dataset.speed);
      setSpeed(speed);
    });
  });
  
  // Save/Load
  document.getElementById('saveWorldBtn').addEventListener('click', () => {
    if (gameState.simulation) {
      gameState.io.downloadSave(gameState.simulation, gameState.world, gameState.rng);
    }
  });
  
  document.getElementById('loadWorldBtn').addEventListener('click', () => {
    gameState.io.uploadSave((data) => {
      // Reload world from save (simplified - would need full restoration)
      console.log('Load feature not fully implemented yet');
    });
  });
  
  // Endgame buttons
  const returnBtn = document.getElementById('returnToMenuBtn');
  const exportBtn = document.getElementById('exportHistoryBtn');
  
  if (returnBtn) {
    returnBtn.addEventListener('click', returnToMenu);
  }
  
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      if (gameState.simulation) {
        gameState.io.downloadSave(gameState.simulation, gameState.world, gameState.rng);
      }
    });
  }
}

function setupKeyboardControls() {
  window.addEventListener('keydown', (e) => {
    if (e.key in keys) {
      keys[e.key] = true;
      e.preventDefault();
    }
    
    // Space to pause/unpause
    if (e.key === ' ' && gameState.simulation) {
      e.preventDefault();
      const currentSpeed = gameState.simulation.speed;
      setSpeed(currentSpeed === 0 ? 2 : 0);
    }
    
    // S for settings
    if (e.key === 's' && !e.ctrlKey) {
      gameState.ui.showSettings();
    }
  });
  
  window.addEventListener('keyup', (e) => {
    if (e.key in keys) {
      keys[e.key] = false;
      e.preventDefault();
    }
  });
}

function setupMouseControls(canvas) {
  let isDragging = false;
  let lastX = 0, lastY = 0;
  
  canvas.addEventListener('mousedown', (e) => {
    isDragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
  });
  
  canvas.addEventListener('mousemove', (e) => {
    if (isDragging && gameState.renderer) {
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      
      gameState.renderer.panCamera(-dx, -dy);
      
      lastX = e.clientX;
      lastY = e.clientY;
    }
  });
  
  canvas.addEventListener('mouseup', () => {
    isDragging = false;
  });
  
  canvas.addEventListener('mouseleave', () => {
    isDragging = false;
  });
  
  // Mouse wheel zoom
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    
    if (gameState.renderer) {
      const delta = -e.deltaY * 0.001;
      const rect = canvas.getBoundingClientRect();
      const centerX = e.clientX - rect.left;
      const centerY = e.clientY - rect.top;
      
      gameState.renderer.zoom(delta, centerX, centerY);
    }
  });
  
  // Click to show info
  canvas.addEventListener('click', (e) => {
    if (isDragging) return;
    
    if (gameState.renderer && gameState.simulation) {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      const world = gameState.renderer.screenToWorld(x, y);
      const wx = Math.floor(world.x);
      const wy = Math.floor(world.y);
      
      // Find country at this position
      const country = gameState.simulation.countries.find(c => 
        c.ownsTerritory(wx, wy)
      );
      
      if (country) {
        gameState.ui.showCountryInfo(country);
      } else {
        // Check tribes
        const tribe = gameState.simulation.tribes.find(t =>
          t.territories.some(terr => terr.x === wx && terr.y === wy)
        );
        
        if (tribe) {
          gameState.ui.showTribeInfo(tribe);
        }
      }
    }
  });
}

function startGame() {
  // Hide main menu
  document.getElementById('mainMenu').style.display = 'none';
  
  // Show game view
  document.getElementById('gameView').style.display = 'block';
  
  // Show progress UI
  document.getElementById('progressUI').style.display = 'flex';
  
  // Generate world
  setTimeout(() => {
    generateWorld();
  }, 100);
}

function generateWorld() {
  const seed = Date.now();
  gameState.rng = new SeededRNG(seed);
  
  gameState.ui.updateProgress(0, 'Initializing...');
  
  // Create world
  gameState.world = new World(gameState.rng);
  
  // Generate in steps with progress updates
  gameState.world.generate((progress, text) => {
    gameState.ui.updateProgress(progress, text);
    
    if (progress >= 1.0) {
      // World generation complete
      setTimeout(() => {
        initializeSimulation();
      }, 500);
    }
  });
}

function initializeSimulation() {
  // Create simulation
  gameState.simulation = new Simulation(gameState.world, gameState.rng);
  gameState.simulation.initialize();
  
  // Create renderer
  const canvas = document.getElementById('mapCanvas');
  gameState.renderer = new Renderer(canvas, gameState.world);
  
  // Setup mouse controls
  setupMouseControls(canvas);
  
  // Hide progress, show game UI
  document.getElementById('progressUI').style.display = 'none';
  document.getElementById('gameUI').style.display = 'block';
  
  // Update UI
  gameState.ui.updateWorldInfo('Planet Kepler-442b', gameState.simulation.getState());
  
  // Start simulation
  gameState.simulation.start();
  gameState.running = true;
  
  // Start render loop
  gameLoop();
  
  // Setup event listener for event log
  gameState.lastEventCount = 0;
}

function gameLoop(timestamp = 0) {
  if (!gameState.running) return;
  
  // Handle keyboard camera movement
  if (gameState.renderer) {
    const moveSpeed = 10 / gameState.renderer.camera.zoom;
    
    if (keys.w || keys.ArrowUp) gameState.renderer.panCamera(0, -moveSpeed);
    if (keys.s || keys.ArrowDown) gameState.renderer.panCamera(0, moveSpeed);
    if (keys.a || keys.ArrowLeft) gameState.renderer.panCamera(-moveSpeed, 0);
    if (keys.d || keys.ArrowRight) gameState.renderer.panCamera(moveSpeed, 0);
  }
  
  // Simulation tick
  if (gameState.simulation) {
    if (gameState.simulation.speed === 4) {
      // Ultra speed: bulk process
      const ticksPerFrame = 10;
      for (let i = 0; i < ticksPerFrame; i++) {
        if (gameState.simulation.shouldTick(timestamp)) {
          gameState.simulation.tick();
        }
      }
    } else if (gameState.simulation.shouldTick(timestamp)) {
      gameState.simulation.tick();
    }
    
    // Update UI
    const state = gameState.simulation.getState();
    gameState.ui.updateWorldInfo('Planet Kepler-442b', state);
    
    // Update event log
    const events = gameState.simulation.events.getRecentEvents(50);
    if (events.length > gameState.lastEventCount) {
      for (let i = gameState.lastEventCount; i < events.length; i++) {
        gameState.ui.addEvent(events[i], (event) => {
          if (event.location && gameState.renderer) {
            gameState.renderer.focusOn(event.location.x, event.location.y);
          }
        });
      }
      gameState.lastEventCount = events.length;
    }
    
    // Autosave every 100 years
    if (gameState.simulation.year % 100 === 0) {
      gameState.io.autosave(gameState.simulation, gameState.world, gameState.rng);
    }
  }
  
  // Render
  if (gameState.renderer && gameState.simulation) {
    gameState.renderer.render(gameState.simulation);
  }
  
  gameState.animationFrameId = requestAnimationFrame(gameLoop);
}

function setSpeed(speed) {
  if (gameState.simulation) {
    gameState.simulation.setSpeed(speed);
    gameState.ui.setTimeButtonActive(speed);
  }
}

function returnToMenu() {
  // Stop simulation
  gameState.running = false;
  if (gameState.animationFrameId) {
    cancelAnimationFrame(gameState.animationFrameId);
  }
  
  // Hide game view
  document.getElementById('gameView').style.display = 'none';
  
  // Show main menu
  document.getElementById('mainMenu').style.display = 'flex';
  
  // Hide endgame
  gameState.ui.hideEndgame();
  
  // Reset state
  gameState.world = null;
  gameState.simulation = null;
  gameState.renderer = null;
}

// Dev mode logging
console.log('%c🌍 ORRERY - Civilization Simulator', 'font-size: 16px; font-weight: bold; color: #ff6b6b');
console.log('Version: 1.0.0');
console.log('Game state accessible via window.gameState');
window.gameState = gameState;
