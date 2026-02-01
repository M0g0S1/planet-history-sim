// io.js - Save/load world (JSON), export/import seeds, localStorage backup

export class IOManager {
  constructor() {
    this.autosaveKey = 'orrery_autosave';
  }

  saveWorld(simulation, world, rng) {
    const saveData = {
      version: 1,
      seed: rng.seed,
      year: simulation.year,
      techLevel: simulation.techLevel,
      tribes: simulation.tribes.map(t => this.serializeTribe(t)),
      countries: simulation.countries.map(c => this.serializeCountry(c)),
      stats: simulation.stats,
      timestamp: Date.now()
    };
    
    return JSON.stringify(saveData);
  }

  serializeTribe(tribe) {
    return {
      id: tribe.id,
      name: tribe.name,
      color: tribe.color,
      population: tribe.population,
      age: tribe.age,
      territories: tribe.territories,
      x: tribe.x,
      y: tribe.y
    };
  }

  serializeCountry(country) {
    return {
      id: country.id,
      name: country.name,
      color: country.color,
      population: country.population,
      age: country.age,
      territories: country.territories,
      capitalX: country.capitalX,
      capitalY: country.capitalY,
      cities: country.cities,
      leader: {
        id: country.leader.id,
        name: country.leader.name,
        age: country.leader.age,
        yearsInPower: country.leader.yearsInPower,
        traits: country.leader.traits
      },
      government: country.government,
      techLevel: country.techLevel,
      unrest: country.unrest,
      atWar: country.atWar,
      allies: country.allies,
      enemies: country.enemies
    };
  }

  loadWorld(jsonString) {
    try {
      const data = JSON.parse(jsonString);
      return data;
    } catch (e) {
      console.error('Failed to load world:', e);
      return null;
    }
  }

  downloadSave(simulation, world, rng) {
    const saveData = this.saveWorld(simulation, world, rng);
    const blob = new Blob([saveData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `orrery_save_year${simulation.year}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  uploadSave(callback) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    
    input.onchange = (e) => {
      const file = e.target.files[0];
      const reader = new FileReader();
      
      reader.onload = (event) => {
        const data = this.loadWorld(event.target.result);
        if (data) {
          callback(data);
        }
      };
      
      reader.readAsText(file);
    };
    
    input.click();
  }

  autosave(simulation, world, rng) {
    try {
      const saveData = this.saveWorld(simulation, world, rng);
      localStorage.setItem(this.autosaveKey, saveData);
    } catch (e) {
      console.error('Autosave failed:', e);
    }
  }

  loadAutosave() {
    try {
      const saveData = localStorage.getItem(this.autosaveKey);
      if (saveData) {
        return this.loadWorld(saveData);
      }
    } catch (e) {
      console.error('Failed to load autosave:', e);
    }
    return null;
  }

  clearAutosave() {
    localStorage.removeItem(this.autosaveKey);
  }
}
