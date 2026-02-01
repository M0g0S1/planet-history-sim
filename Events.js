// events.js - Event system, logging, event types (surface + latent)

export class EventSystem {
  constructor() {
    this.events = [];
    this.latentEvents = [];
    this.maxVisibleEvents = 200;
  }

  logEvent(year, message, location = null, type = 'surface') {
    const event = {
      year,
      message,
      location, // { x, y }
      type,
      timestamp: Date.now()
    };

    if (type === 'surface') {
      this.events.push(event);
      
      // Keep only last 200 visible events
      if (this.events.length > this.maxVisibleEvents) {
        this.events.shift();
      }
    } else if (type === 'latent') {
      this.latentEvents.push(event);
    }

    return event;
  }

  getRecentEvents(count = 50) {
    return this.events.slice(-count);
  }

  getAllEvents() {
    return [...this.events];
  }

  getLatentEvents() {
    return [...this.latentEvents];
  }

  clearEvents() {
    this.events = [];
    this.latentEvents = [];
  }

  // Event factories
  tribeFormed(year, tribe) {
    return this.logEvent(year, `Tribe ${tribe.name} has formed`, { x: tribe.x, y: tribe.y });
  }

  tribeSplit(year, originalTribe, newTribe) {
    return this.logEvent(year, `Tribe ${originalTribe.name} split into ${newTribe.name}`, { x: newTribe.x, y: newTribe.y });
  }

  civilizationFormed(year, country) {
    return this.logEvent(year, `${country.name} has formed as a civilization!`, { x: country.capitalX, y: country.capitalY });
  }

  leaderDied(year, country, oldLeader, newLeader) {
    return this.logEvent(year, `${oldLeader.name} of ${country.name} has died. ${newLeader.name} takes power.`, { x: country.capitalX, y: country.capitalY });
  }

  warDeclared(year, attacker, defender) {
    return this.logEvent(year, `${attacker.name} declares war on ${defender.name}!`, { x: defender.capitalX, y: defender.capitalY });
  }

  warEnded(year, attacker, defender, winner) {
    return this.logEvent(year, `War between ${attacker.name} and ${defender.name} has ended. ${winner} emerges victorious.`, null);
  }

  territoryConquered(year, attacker, defender, x, y) {
    return this.logEvent(year, `${attacker.name} conquers territory from ${defender.name}`, { x, y });
  }

  allianceFormed(year, country1, country2) {
    return this.logEvent(year, `${country1.name} and ${country2.name} form an alliance`, null);
  }

  cityFounded(year, country, city) {
    return this.logEvent(year, `${country.name} founds ${city.name}`, { x: city.x, y: city.y });
  }

  pandemicStarted(year, disease) {
    return this.logEvent(year, `A deadly pandemic has begun: ${disease.name}`, disease.origin);
  }

  disasterOccurred(year, disaster) {
    return this.logEvent(year, `${disaster.type} strikes!`, disaster.location);
  }

  techAdvancement(year, newLevel) {
    return this.logEvent(year, `Global technology advances to level ${newLevel}`, null);
  }

  // Latent events
  tensionRising(year, region, amount) {
    return this.logEvent(year, `Regional tension increasing in area ${region}`, null, 'latent');
  }

  ideologicalShift(year, country, direction) {
    return this.logEvent(year, `${country.name} experiences ideological shift: ${direction}`, null, 'latent');
  }
}
