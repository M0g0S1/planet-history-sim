// ui.js - Event bar updates, progress UI, settings, info panel, endgame

export class UI {
  constructor() {
    this.worldNameEl = document.getElementById('worldName');
    this.worldStatsEl = document.getElementById('worldStats');
    this.eventLogEl = document.getElementById('eventLog');
    this.infoPanelEl = document.getElementById('infoPanel');
    this.infoPanelTitleEl = document.getElementById('infoPanelTitle');
    this.infoPanelContentEl = document.getElementById('infoPanelContent');
    this.settingsPanelEl = document.getElementById('settingsPanel');
    this.endgameOverlayEl = document.getElementById('endgameOverlay');
  }

  updateWorldInfo(name, stats) {
    this.worldNameEl.textContent = name;
    this.worldStatsEl.textContent = `Year ${stats.year} | Tribes: ${stats.tribes} | Countries: ${stats.countries}`;
  }

  addEvent(event, onClick) {
    const eventItem = document.createElement('div');
    eventItem.className = 'event-item';
    eventItem.innerHTML = `
      <span class="event-year">${event.year}</span>
      <span class="event-message">${event.message}</span>
    `;
    
    if (onClick) {
      eventItem.addEventListener('click', () => onClick(event));
    }
    
    this.eventLogEl.appendChild(eventItem);
    
    // Auto-scroll to bottom
    this.eventLogEl.scrollTop = this.eventLogEl.scrollHeight;
    
    // Keep only last 200 events in DOM
    while (this.eventLogEl.children.length > 200) {
      this.eventLogEl.removeChild(this.eventLogEl.firstChild);
    }
  }

  showCountryInfo(country) {
    this.infoPanelTitleEl.textContent = country.name;
    
    this.infoPanelContentEl.innerHTML = `
      <div class="info-row"><span class="info-label">Government:</span><span class="info-value">${country.government}</span></div>
      <div class="info-row"><span class="info-label">Leader:</span><span class="info-value">${country.leader.name}</span></div>
      <div class="info-row"><span class="info-label">Leader Age:</span><span class="info-value">${country.leader.age}</span></div>
      <div class="info-row"><span class="info-label">Years in Power:</span><span class="info-value">${country.leader.yearsInPower}</span></div>
      <div class="info-row"><span class="info-label">Population:</span><span class="info-value">${country.population.toLocaleString()}</span></div>
      <div class="info-row"><span class="info-label">Age:</span><span class="info-value">${country.age} years</span></div>
      <div class="info-row"><span class="info-label">Tech Level:</span><span class="info-value">${country.techLevel}</span></div>
      <div class="info-row"><span class="info-label">Territories:</span><span class="info-value">${country.territories.length}</span></div>
      <div class="info-row"><span class="info-label">At War:</span><span class="info-value">${country.atWar ? 'Yes' : 'No'}</span></div>
      <h4 style="color: var(--accent); margin-top: 12px; margin-bottom: 6px;">Leader Traits</h4>
      <div class="info-row"><span class="info-label">Aggression:</span><span class="info-value">${(country.leader.traits.aggression * 100).toFixed(0)}%</span></div>
      <div class="info-row"><span class="info-label">Diplomacy:</span><span class="info-value">${(country.leader.traits.diplomacy * 100).toFixed(0)}%</span></div>
      <div class="info-row"><span class="info-label">Ambition:</span><span class="info-value">${(country.leader.traits.ambition * 100).toFixed(0)}%</span></div>
      <div class="info-row"><span class="info-label">Caution:</span><span class="info-value">${(country.leader.traits.caution * 100).toFixed(0)}%</span></div>
    `;
    
    this.infoPanelEl.style.display = 'block';
  }

  showTribeInfo(tribe) {
    this.infoPanelTitleEl.textContent = tribe.name + ' (Tribe)';
    
    this.infoPanelContentEl.innerHTML = `
      <div class="info-row"><span class="info-label">Population:</span><span class="info-value">${tribe.population}</span></div>
      <div class="info-row"><span class="info-label">Age:</span><span class="info-value">${tribe.age} years</span></div>
      <div class="info-row"><span class="info-label">Territories:</span><span class="info-value">${tribe.territories.length}</span></div>
    `;
    
    this.infoPanelEl.style.display = 'block';
  }

  hideInfoPanel() {
    this.infoPanelEl.style.display = 'none';
  }

  showSettings() {
    this.settingsPanelEl.style.display = 'flex';
  }

  hideSettings() {
    this.settingsPanelEl.style.display = 'none';
  }

  updateProgress(percent, text) {
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');
    
    progressBar.style.width = `${percent * 100}%`;
    progressText.textContent = text;
  }

  showEndgame(stats) {
    const statsDiv = document.getElementById('endgameStats');
    
    statsDiv.innerHTML = `
      <div>Total Deaths: ${stats.totalDeaths.toLocaleString()}</div>
      <div>Total Wars: ${stats.totalWars}</div>
      <div>Civilizations Created: ${stats.totalCivilizations}</div>
      <div>Final Year: ${stats.year}</div>
      <div>Final Population: ${stats.population.toLocaleString()}</div>
    `;
    
    this.endgameOverlayEl.style.display = 'flex';
  }

  hideEndgame() {
    this.endgameOverlayEl.style.display = 'none';
  }

  setTimeButtonActive(speed) {
    const buttons = document.querySelectorAll('.time-btn');
    buttons.forEach(btn => {
      if (parseInt(btn.dataset.speed) === speed) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }
}
