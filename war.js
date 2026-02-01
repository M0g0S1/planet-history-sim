// war.js - Abstract war system, conflict resolution, losses, annexation

import { toIndex } from './utils.js';

export class War {
  constructor(attacker, defender, startYear) {
    this.attacker = attacker;
    this.defender = defender;
    this.startYear = startYear;
    this.currentYear = startYear;
    this.contestedTerritories = [];
    this.attackerExhaustion = 0;
    this.defenderExhaustion = 0;
    this.attackerLosses = 0;
    this.defenderLosses = 0;
  }

  tick(year, world, rng, events) {
    this.currentYear = year;
    
    // Calculate relative strength
    const attackerStrength = this.calculateStrength(this.attacker, world, false);
    const defenderStrength = this.calculateStrength(this.defender, world, true);
    
    const totalStrength = attackerStrength + defenderStrength;
    const attackerAdvantage = attackerStrength / totalStrength;
    
    // Resolve battles
    const battleResult = this.resolveBattle(attackerAdvantage, rng);
    
    // Apply casualties
    const attackerCasualties = Math.floor(this.attacker.population * rng.range(0.001, 0.005));
    const defenderCasualties = Math.floor(this.defender.population * rng.range(0.001, 0.005));
    
    this.attacker.population -= attackerCasualties;
    this.defender.population -= defenderCasualties;
    this.attackerLosses += attackerCasualties;
    this.defenderLosses += defenderCasualties;
    
    // Territory changes
    if (battleResult === 'attacker') {
      this.conquerTerritory(world, rng, events, year);
    } else if (battleResult === 'defender') {
      // Defender holds/reclaims
    }
    
    // Exhaustion
    this.attackerExhaustion += 0.05;
    this.defenderExhaustion += 0.03; // Defender has slight advantage
    
    // Check for war end conditions
    if (this.attackerExhaustion > 1.0 || this.defenderExhaustion > 1.0) {
      return this.endWar(year, events, rng);
    }
    
    // Defender collapse
    if (this.defender.population < 100 || this.defender.territories.length < 2) {
      return this.endWar(year, events, rng, 'attacker_victory');
    }
    
    // Attacker withdraws
    if (this.attacker.population < 200) {
      return this.endWar(year, events, rng, 'defender_victory');
    }
    
    return null;
  }

  calculateStrength(country, world, isDefender) {
    let strength = country.population;
    
    // Tech multiplier
    strength *= (1 + country.techLevel * 0.1);
    
    // Morale (inverse of unrest)
    const morale = 1 - (country.unrest / 100);
    strength *= morale;
    
    // Defender bonus
    if (isDefender) {
      strength *= 1.2;
    }
    
    // Leader traits
    if (!isDefender) {
      strength *= (1 + country.leader.traits.aggression * 0.2);
    } else {
      strength *= (1 + country.leader.traits.caution * 0.2);
    }
    
    return Math.max(1, strength);
  }

  resolveBattle(attackerAdvantage, rng) {
    const roll = rng.next();
    
    if (roll < attackerAdvantage * 0.6) {
      return 'attacker';
    } else if (roll > 0.7) {
      return 'defender';
    }
    
    return 'stalemate';
  }

  conquerTerritory(world, rng, events, year) {
    // Find defender territories adjacent to attacker
    const targets = [];
    
    for (const dTerr of this.defender.territories) {
      for (const aTerr of this.attacker.territories) {
        const dx = Math.min(Math.abs(dTerr.x - aTerr.x), world.width - Math.abs(dTerr.x - aTerr.x));
        const dy = Math.abs(dTerr.y - aTerr.y);
        
        if (dx <= 1 && dy <= 1) {
          targets.push(dTerr);
          break;
        }
      }
    }
    
    if (targets.length > 0 && rng.bool(0.3)) {
      const target = targets[rng.int(0, targets.length - 1)];
      
      // Remove from defender
      const idx = this.defender.territories.findIndex(t => t.x === target.x && t.y === target.y);
      if (idx !== -1) {
        this.defender.territories.splice(idx, 1);
        this.attacker.territories.push(target);
        
        events.territoryConquered(year, this.attacker, this.defender, target.x, target.y);
      }
    }
  }

  endWar(year, events, rng, outcome = null) {
    // Determine outcome if not specified
    if (!outcome) {
      if (this.attackerExhaustion > this.defenderExhaustion) {
        outcome = 'defender_victory';
      } else {
        outcome = 'attacker_victory';
      }
    }
    
    const winner = outcome === 'attacker_victory' ? this.attacker.name : this.defender.name;
    events.warEnded(year, this.attacker, this.defender, winner);
    
    // Peace terms
    if (outcome === 'attacker_victory') {
      // Attacker may annex some territory
      const annexCount = Math.min(3, Math.floor(this.defender.territories.length * 0.3));
      for (let i = 0; i < annexCount; i++) {
        if (this.defender.territories.length > 0) {
          const terr = this.defender.territories.pop();
          this.attacker.territories.push(terr);
        }
      }
    }
    
    this.attacker.atWar = false;
    this.defender.atWar = false;
    
    return { ended: true, winner: outcome };
  }
}

export class WarManager {
  constructor() {
    this.activeWars = [];
  }

  declareWar(attacker, defender, year, events) {
    const war = new War(attacker, defender, year);
    this.activeWars.push(war);
    
    attacker.atWar = true;
    defender.atWar = true;
    
    events.warDeclared(year, attacker, defender);
    
    return war;
  }

  tick(year, world, rng, events) {
    const endedWars = [];
    
    for (let i = this.activeWars.length - 1; i >= 0; i--) {
      const war = this.activeWars[i];
      const result = war.tick(year, world, rng, events);
      
      if (result && result.ended) {
        endedWars.push(war);
        this.activeWars.splice(i, 1);
      }
    }
    
    return endedWars;
  }

  isAtWar(country) {
    return this.activeWars.some(w => w.attacker === country || w.defender === country);
  }

  getActiveWars() {
    return [...this.activeWars];
  }
}
