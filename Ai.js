// ai.js - Country decision logic (leader-influenced behaviors)

import { wrapX, clampY, distance } from './utils.js';

export class CountryAI {
  constructor(warManager) {
    this.warManager = warManager;
    this.globalTension = 0; // 0-1
    this.allianceRigidity = 0.5; // How hard it is to break alliances
    this.ideologicalPolarization = 0; // 0-1
  }

  makeDecisions(country, allCountries, world, year, rng, events) {
    const decisions = [];
    
    // Skip if at war
    if (country.atWar) {
      return decisions;
    }
    
    // Evaluate possible actions
    const expandWeight = this.evaluateExpansion(country, allCountries, world);
    const cityWeight = this.evaluateCityBuilding(country, world);
    const allianceWeight = this.evaluateAlliance(country, allCountries);
    const warWeight = this.evaluateWar(country, allCountries, world);
    const stabilityWeight = this.evaluateStability(country);
    
    // Apply leader personality modifiers
    const traits = country.leader.traits;
    const modifiedWarWeight = warWeight * (1 + traits.aggression) * (1 - traits.caution);
    const modifiedAllianceWeight = allianceWeight * (1 + traits.diplomacy);
    const modifiedExpandWeight = expandWeight * (1 + traits.ambition);
    
    // Make decision based on weighted probabilities
    const total = modifiedExpandWeight + cityWeight + modifiedAllianceWeight + modifiedWarWeight + stabilityWeight;
    
    if (total > 0) {
      const roll = rng.next() * total;
      let cumulative = 0;
      
      cumulative += modifiedExpandWeight;
      if (roll < cumulative) {
        return this.expand(country, allCountries, world, rng);
      }
      
      cumulative += cityWeight;
      if (roll < cumulative) {
        return this.buildCity(country, world, rng, events, year);
      }
      
      cumulative += modifiedAllianceWeight;
      if (roll < cumulative) {
        return this.seekAlliance(country, allCountries, rng, events, year);
      }
      
      cumulative += modifiedWarWeight;
      if (roll < cumulative) {
        return this.declareWar(country, allCountries, rng, events, year);
      }
      
      cumulative += stabilityWeight;
      if (roll < cumulative) {
        return this.improveStability(country);
      }
    }
    
    return null;
  }

  evaluateExpansion(country, allCountries, world) {
    if (country.territories.length > 50) return 0.1;
    
    // Find unclaimed adjacent tiles
    let unclaimedCount = 0;
    for (const t of country.territories) {
      const neighbors = [
        { x: wrapX(t.x + 1, world.width), y: t.y },
        { x: wrapX(t.x - 1, world.width), y: t.y },
        { x: t.x, y: clampY(t.y + 1, world.height) },
        { x: t.x, y: clampY(t.y - 1, world.height) }
      ];
      
      for (const n of neighbors) {
        if (!world.isHabitable(n.x, n.y)) continue;
        
        const claimed = country.ownsTerritory(n.x, n.y) ||
                       allCountries.some(c => c !== country && c.ownsTerritory(n.x, n.y));
        
        if (!claimed) unclaimedCount++;
      }
    }
    
    return unclaimedCount > 0 ? 0.5 : 0;
  }

  evaluateCityBuilding(country, world) {
    // One city per 10 territories
    const idealCities = Math.floor(country.territories.length / 10);
    if (country.cities.length >= idealCities) return 0;
    
    return 0.2;
  }

  evaluateAlliance(country, allCountries) {
    if (country.allies.length > 3) return 0;
    
    const neighbors = this.findNeighbors(country, allCountries);
    if (neighbors.length > 0) return 0.15;
    
    return 0.05;
  }

  evaluateWar(country, allCountries, world) {
    if (country.atWar) return 0;
    if (country.population < 500) return 0;
    
    const neighbors = this.findNeighbors(country, allCountries);
    if (neighbors.length === 0) return 0;
    
    // Base war desire
    let warDesire = 0.1;
    
    // Increase with global tension
    warDesire += this.globalTension * 0.3;
    
    // Weak neighbors increase desire
    for (const n of neighbors) {
      if (n.population < country.population * 0.7) {
        warDesire += 0.2;
      }
    }
    
    return warDesire;
  }

  evaluateStability(country) {
    if (country.unrest > 50) return 0.4;
    return 0.05;
  }

  // Actions
  expand(country, allCountries, world, rng) {
    const edges = [];
    
    for (const t of country.territories) {
      const neighbors = [
        { x: wrapX(t.x + 1, world.width), y: t.y },
        { x: wrapX(t.x - 1, world.width), y: t.y },
        { x: t.x, y: clampY(t.y + 1, world.height) },
        { x: t.x, y: clampY(t.y - 1, world.height) }
      ];
      
      for (const n of neighbors) {
        if (!world.isHabitable(n.x, n.y)) continue;
        
        const claimed = country.ownsTerritory(n.x, n.y) ||
                       allCountries.some(c => c !== country && c.ownsTerritory(n.x, n.y));
        
        if (!claimed) edges.push(n);
      }
    }
    
    if (edges.length > 0) {
      const newTile = edges[rng.int(0, edges.length - 1)];
      country.expand(newTile.x, newTile.y);
      return { type: 'expand', country, tile: newTile };
    }
    
    return null;
  }

  buildCity(country, world, rng, events, year) {
    // Pick a good location
    const candidates = country.territories.filter(t => {
      const idx = t.y * world.width + t.x;
      return world.rivers[idx] > 0 || world.getFertility(t.x, t.y) > 0.5;
    });
    
    const location = candidates.length > 0 ? 
                     candidates[rng.int(0, candidates.length - 1)] :
                     country.territories[rng.int(0, country.territories.length - 1)];
    
    const city = {
      id: `city_${Date.now()}_${rng.next()}`,
      name: this.generateCityName(rng),
      x: location.x,
      y: location.y,
      population: 500,
      isCapital: false
    };
    
    country.cities.push(city);
    events.cityFounded(year, country, city);
    
    return { type: 'city', country, city };
  }

  generateCityName(rng) {
    const prefixes = ['New', 'Old', 'Great', 'Port', 'Fort', 'Saint'];
    const bases = ['Haven', 'Bridge', 'Hill', 'Valley', 'Bay', 'Keep', 'Town'];
    
    if (rng.bool(0.5)) {
      return prefixes[rng.int(0, prefixes.length - 1)] + ' ' + bases[rng.int(0, bases.length - 1)];
    } else {
      return bases[rng.int(0, bases.length - 1)];
    }
  }

  seekAlliance(country, allCountries, rng, events, year) {
    const neighbors = this.findNeighbors(country, allCountries);
    const potential = neighbors.filter(n => !country.allies.includes(n.id) && !n.atWar);
    
    if (potential.length > 0) {
      const partner = potential[rng.int(0, potential.length - 1)];
      
      // Mutual alliance
      country.allies.push(partner.id);
      partner.allies.push(country.id);
      
      events.allianceFormed(year, country, partner);
      
      return { type: 'alliance', country, partner };
    }
    
    return null;
  }

  declareWar(country, allCountries, rng, events, year) {
    const neighbors = this.findNeighbors(country, allCountries);
    const targets = neighbors.filter(n => 
      !country.allies.includes(n.id) && 
      !n.atWar &&
      n.population < country.population * 1.2
    );
    
    if (targets.length > 0) {
      const target = targets[rng.int(0, targets.length - 1)];
      
      this.warManager.declareWar(country, target, year, events);
      this.globalTension = Math.min(1, this.globalTension + 0.1);
      
      return { type: 'war', country, target };
    }
    
    return null;
  }

  improveStability(country) {
    country.unrest = Math.max(0, country.unrest - 10);
    return { type: 'stability', country };
  }

  findNeighbors(country, allCountries) {
    const neighbors = [];
    
    for (const other of allCountries) {
      if (other === country) continue;
      
      // Check if any territories are adjacent
      for (const t1 of country.territories) {
        for (const t2 of other.territories) {
          const dx = Math.min(Math.abs(t2.x - t1.x), country.territories[0].x - Math.abs(t2.x - t1.x));
          const dy = Math.abs(t2.y - t1.y);
          
          if (dx <= 2 && dy <= 2) {
            neighbors.push(other);
            break;
          }
        }
        if (neighbors.includes(other)) break;
      }
    }
    
    return neighbors;
  }

  tick() {
    // Slowly decay global tension
    this.globalTension = Math.max(0, this.globalTension - 0.01);
  }
}
