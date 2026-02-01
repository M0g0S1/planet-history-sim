// simulation.js - Tick loop, time controls, tech progression, global state

import { Tribe, Country } from './entities.js';
import { CountryAI } from './ai.js';
import { WarManager } from './war.js';
import { EventSystem } from './events.js';

export class Simulation {
  constructor(world, rng) {
    this.world = world;
    this.rng = rng;
    
    this.year = 0;
    this.tribes = [];
    this.countries = [];
    this.techLevel = 1; // Global tech level (1-10)
    
    this.events = new EventSystem();
    this.warManager = new WarManager();
    this.ai = new CountryAI(this.warManager);
    
    this.speed = 2; // 0=pause, 1=slow, 2=normal, 3=fast, 4=ultra
    this.lastTickTime = 0;
    this.tickIntervals = [0, 2000, 600, 200, 50]; // ms per tick for each speed
    
    this.running = false;
    this.stats = {
      totalDeaths: 0,
      totalWars: 0,
      totalCivilizations: 0
    };
  }

  initialize() {
    // Spawn initial tribes
    const numTribes = this.rng.int(10, 16);
    
    for (let i = 0; i < numTribes; i++) {
      let x, y;
      let attempts = 0;
      
      // Find habitable location
      do {
        x = this.rng.int(0, this.world.width - 1);
        y = this.rng.int(0, this.world.height - 1);
        attempts++;
      } while (!this.world.isHabitable(x, y) && attempts < 100);
      
      if (attempts < 100) {
        const color = `hsl(${this.rng.int(0, 360)}, ${this.rng.int(50, 70)}%, ${this.rng.int(40, 60)}%)`;
        const tribe = new Tribe(this.rng, x, y, color);
        this.tribes.push(tribe);
        this.events.tribeFormed(this.year, tribe);
      }
    }
  }

  start() {
    this.running = true;
    this.lastTickTime = performance.now();
  }

  stop() {
    this.running = false;
  }

  setSpeed(speed) {
    this.speed = Math.max(0, Math.min(4, speed));
  }

  shouldTick(currentTime) {
    if (this.speed === 0 || !this.running) return false;
    
    const elapsed = currentTime - this.lastTickTime;
    const interval = this.tickIntervals[this.speed];
    
    return elapsed >= interval;
  }

  tick() {
    this.year++;
    
    // Process tribes
    for (let i = this.tribes.length - 1; i >= 0; i--) {
      const tribe = this.tribes[i];
      const result = tribe.tick(this.world, this.rng, this.tribes, this.countries);
      
      if (result instanceof Tribe) {
        // Split occurred
        this.tribes.push(result);
        this.events.tribeSplit(this.year, tribe, result);
      } else if (result instanceof Country) {
        // Tribe became civilization
        this.tribes.splice(i, 1);
        this.countries.push(result);
        this.events.civilizationFormed(this.year, result);
        this.stats.totalCivilizations++;
      } else if (result === null && tribe.population < 10) {
        // Tribe died out
        this.tribes.splice(i, 1);
      }
    }
    
    // Process countries
    for (let i = this.countries.length - 1; i >= 0; i--) {
      const country = this.countries[i];
      const result = country.tick(this.world, this.rng, this.countries, this);
      
      if (result && result.type === 'leader_death') {
        const revolutionary = country.unrest > 70;
        const succession = country.replaceLeader(this.rng, revolutionary);
        this.events.leaderDied(this.year, country, succession.old, succession.new);
      }
      
      // AI decisions
      if (!country.atWar && this.year % 5 === 0) {
        this.ai.makeDecisions(country, this.countries, this.world, this.year, this.rng, this.events);
      }
      
      // Check for country collapse
      if (country.population < 50 || country.territories.length === 0) {
        this.countries.splice(i, 1);
      }
    }
    
    // Process wars
    this.warManager.tick(this.year, this.world, this.rng, this.events);
    
    // AI global state
    this.ai.tick();
    
    // Tech progression
    if (this.year % 100 === 0) {
      this.checkTechAdvancement();
    }
    
    this.lastTickTime = performance.now();
  }

  checkTechAdvancement() {
    const totalPop = this.countries.reduce((sum, c) => sum + c.population, 0);
    const numCivs = this.countries.length;
    const numWars = this.warManager.activeWars.length;
    
    // Tech advances based on population, civilizations, and conflict
    const techScore = (totalPop / 10000) + (numCivs * 10) + (this.stats.totalWars * 5);
    
    const requiredScore = this.techLevel * 1000;
    
    if (techScore > requiredScore && this.techLevel < 10 && this.rng.bool(0.1)) {
      this.techLevel++;
      this.events.techAdvancement(this.year, this.techLevel);
      
      // Update all countries
      for (const country of this.countries) {
        country.techLevel = this.techLevel;
      }
    }
  }

  fastForward(ticks) {
    for (let i = 0; i < ticks; i++) {
      this.tick();
    }
  }

  getState() {
    return {
      year: this.year,
      tribes: this.tribes.length,
      countries: this.countries.length,
      techLevel: this.techLevel,
      wars: this.warManager.activeWars.length,
      totalPopulation: this.getTotalPopulation()
    };
  }

  getTotalPopulation() {
    let total = 0;
    for (const tribe of this.tribes) {
      total += tribe.population;
    }
    for (const country of this.countries) {
      total += country.population;
    }
    return total;
  }

  getStats() {
    return {
      year: this.year,
      tribes: this.tribes.length,
      countries: this.countries.length,
      techLevel: this.techLevel,
      population: this.getTotalPopulation(),
      wars: this.warManager.activeWars.length,
      totalWars: this.stats.totalWars,
      totalCivilizations: this.stats.totalCivilizations,
      totalDeaths: this.stats.totalDeaths
    };
  }
}
