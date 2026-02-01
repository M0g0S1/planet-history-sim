// entities.js - Tribes, civilizations, cities, leaders, and entity lifecycle

import { generateID, toIndex, wrapX, clampY, distance } from './utils.js';

// Name generation
const TRIBE_PREFIXES = ['Khar', 'Vel', 'Nor', 'Tha', 'Zul', 'Bor', 'Kal', 'Dra', 'Mor', 'Sil', 'Tor', 'Val'];
const TRIBE_SUFFIXES = ['ak', 'un', 'ar', 'os', 'ian', 'eth', 'or', 'is', 'en', 'ax'];

const LEADER_FIRST = ['Aric', 'Bran', 'Cyra', 'Dain', 'Elara', 'Finn', 'Gwen', 'Holt', 'Iris', 'Jace', 'Kira', 'Lorn', 'Mira', 'Nyx', 'Orin', 'Petra', 'Quinn', 'Reva', 'Soren', 'Talia'];
const LEADER_LAST = ['Stone', 'Storm', 'Flame', 'Frost', 'Swift', 'Bold', 'Wise', 'Iron', 'Silver', 'Gold'];

export class Tribe {
  constructor(rng, x, y, color) {
    this.id = generateID('tribe');
    this.name = TRIBE_PREFIXES[Math.floor(rng.next() * TRIBE_PREFIXES.length)] + 
                TRIBE_SUFFIXES[Math.floor(rng.next() * TRIBE_SUFFIXES.length)];
    this.color = color;
    this.population = rng.int(50, 150);
    this.age = 0;
    this.territories = [{ x, y }];
    this.expansionCooldown = 0;
    this.x = x; // Center
    this.y = y;
  }

  tick(world, rng, allTribes, allCountries) {
    this.age++;
    this.population += rng.int(0, 5);
    
    if (this.expansionCooldown > 0) {
      this.expansionCooldown--;
    }
    
    // Migration
    if (rng.bool(0.05)) {
      this.migrate(world, rng);
    }
    
    // Expansion
    if (this.expansionCooldown === 0 && this.territories.length < 20 && rng.bool(0.2)) {
      this.expand(world, rng, allTribes, allCountries);
      this.expansionCooldown = rng.int(3, 8);
    }
    
    // Split
    if (this.population > 300 && this.territories.length > 5 && rng.bool(0.1)) {
      return this.split(rng);
    }
    
    // Check for civilization transformation
    if (this.population > 500 && this.age > 200 && this.territories.length >= 5 && rng.bool(0.05)) {
      return this.formCivilization(world, rng);
    }
    
    return null;
  }

  migrate(world, rng) {
    // Possibly move center
    const current = this.territories[0];
    const neighbors = [
      { x: wrapX(current.x + 1, world.width), y: current.y },
      { x: wrapX(current.x - 1, world.width), y: current.y },
      { x: current.x, y: clampY(current.y + 1, world.height) },
      { x: current.x, y: clampY(current.y - 1, world.height) }
    ];
    
    const valid = neighbors.filter(n => world.isHabitable(n.x, n.y));
    if (valid.length > 0) {
      const newPos = valid[rng.int(0, valid.length - 1)];
      this.territories = [newPos];
      this.x = newPos.x;
      this.y = newPos.y;
    }
  }

  expand(world, rng, allTribes, allCountries) {
    // Find unclaimed neighbors
    const edges = [];
    for (const t of this.territories) {
      const neighbors = [
        { x: wrapX(t.x + 1, world.width), y: t.y },
        { x: wrapX(t.x - 1, world.width), y: t.y },
        { x: t.x, y: clampY(t.y + 1, world.height) },
        { x: t.x, y: clampY(t.y - 1, world.height) }
      ];
      
      for (const n of neighbors) {
        if (!world.isHabitable(n.x, n.y)) continue;
        
        // Check if claimed
        const claimed = this.territories.some(t => t.x === n.x && t.y === n.y) ||
                       allTribes.some(tribe => tribe !== this && tribe.territories.some(t => t.x === n.x && t.y === n.y)) ||
                       allCountries.some(c => c.ownsTerritory(n.x, n.y));
        
        if (!claimed) edges.push(n);
      }
    }
    
    if (edges.length > 0) {
      const newTile = edges[rng.int(0, edges.length - 1)];
      this.territories.push(newTile);
    }
  }

  split(rng) {
    if (this.territories.length < 2) return null;
    
    // Create new tribe with half the territories
    const splitCount = Math.floor(this.territories.length / 2);
    const newTerritories = this.territories.splice(0, splitCount);
    
    this.population = Math.floor(this.population / 2);
    
    const newTribe = new Tribe(rng, newTerritories[0].x, newTerritories[0].y, this.color);
    newTribe.territories = newTerritories;
    newTribe.population = this.population;
    
    return newTribe;
  }

  formCivilization(world, rng) {
    // Transform into a country
    const country = new Country(rng, this);
    return country;
  }
}

export class Country {
  constructor(rng, tribe) {
    this.id = generateID('country');
    this.name = tribe ? tribe.name : 'New Civilization';
    this.color = tribe ? tribe.color : `hsl(${rng.int(0, 360)}, 60%, 50%)`;
    this.population = tribe ? tribe.population : 1000;
    this.age = tribe ? tribe.age : 0;
    this.territories = tribe ? tribe.territories : [];
    
    // Find capital location (prefer river/coast)
    const capital = this.findBestCapital(rng);
    this.capitalX = capital.x;
    this.capitalY = capital.y;
    
    this.cities = [new City(rng, capital.x, capital.y, true)];
    
    this.leader = new Leader(rng);
    this.government = 'Tribal Chiefdom';
    this.techLevel = 1;
    this.unrest = 0;
    this.atWar = false;
    this.wars = [];
    this.allies = [];
    this.enemies = [];
    this.relations = {}; // countryId -> score (-100 to 100)
  }

  findBestCapital(rng) {
    if (this.territories.length === 0) return { x: 0, y: 0 };
    
    // Simple: use first territory
    return this.territories[0];
  }

  ownsTerritory(x, y) {
    return this.territories.some(t => t.x === x && t.y === y);
  }

  tick(world, rng, allCountries, globalState) {
    this.age++;
    
    // Population growth
    const growthRate = 1 + (this.techLevel * 0.01);
    this.population = Math.floor(this.population * growthRate);
    
    // Leader aging
    this.leader.age++;
    this.leader.yearsInPower++;
    
    // Leader death (chance increases with age)
    if (this.leader.age > 50 && rng.bool(Math.min(0.15, (this.leader.age - 50) * 0.01))) {
      return { type: 'leader_death', country: this };
    }
    
    return null;
  }

  replaceLeader(rng, revolutionary = false) {
    const oldLeader = this.leader;
    this.leader = new Leader(rng, revolutionary ? null : oldLeader);
    return { old: oldLeader, new: this.leader };
  }

  expand(x, y) {
    if (!this.ownsTerritory(x, y)) {
      this.territories.push({ x, y });
    }
  }

  annex(territory) {
    this.territories.push(...territory);
  }
}

export class City {
  constructor(rng, x, y, isCapital = false) {
    this.id = generateID('city');
    this.name = this.generateCityName(rng);
    this.x = x;
    this.y = y;
    this.population = isCapital ? 1000 : 500;
    this.isCapital = isCapital;
  }

  generateCityName(rng) {
    const prefixes = ['New', 'Old', 'Great', 'Port', 'Fort', 'Mount'];
    const bases = ['Haven', 'Bridge', 'Hill', 'Valley', 'Bay', 'Keep', 'Town', 'City'];
    
    if (rng.bool(0.5)) {
      return prefixes[rng.int(0, prefixes.length - 1)] + ' ' + bases[rng.int(0, bases.length - 1)];
    } else {
      return bases[rng.int(0, bases.length - 1)];
    }
  }
}

export class Leader {
  constructor(rng, predecessor = null) {
    this.id = generateID('leader');
    this.name = LEADER_FIRST[rng.int(0, LEADER_FIRST.length - 1)] + ' ' + 
                LEADER_LAST[rng.int(0, LEADER_LAST.length - 1)];
    this.age = rng.int(25, 50);
    this.yearsInPower = 0;
    
    // Traits (0.0 to 1.0)
    if (predecessor) {
      // Heir: small drift from predecessor
      this.traits = {
        aggression: Math.max(0, Math.min(1, predecessor.traits.aggression + rng.range(-0.15, 0.15))),
        caution: Math.max(0, Math.min(1, predecessor.traits.caution + rng.range(-0.15, 0.15))),
        diplomacy: Math.max(0, Math.min(1, predecessor.traits.diplomacy + rng.range(-0.15, 0.15))),
        ambition: Math.max(0, Math.min(1, predecessor.traits.ambition + rng.range(-0.15, 0.15))),
        freedom: Math.max(0, Math.min(1, (predecessor.traits.freedom || 0.5) + rng.range(-0.15, 0.15))),
        rationality: Math.max(0, Math.min(1, (predecessor.traits.rationality || 0.5) + rng.range(-0.15, 0.15)))
      };
    } else {
      // Revolutionary: completely new traits
      this.traits = {
        aggression: rng.next(),
        caution: rng.next(),
        diplomacy: rng.next(),
        ambition: rng.next(),
        freedom: rng.next(),
        rationality: rng.next()
      };
    }
  }
}
