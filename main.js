const mapCanvas = document.getElementById('mapCanvas');
const mapCtx = mapCanvas.getContext('2d', { alpha: false });

// Overlay canvas for tribes, borders, labels
const overlayCanvas = document.createElement('canvas');
const overlayCtx = overlayCanvas.getContext('2d', { alpha: true });

const MAP_WIDTH = 2048;
const MAP_HEIGHT = 1024;

const camera = {
  x: 0,
  y: 0,
  zoom: 1.0,
  targetZoom: 1.0,
  minZoom: 0.5,
  maxZoom: 4.0,
  moveSpeed: 20 // pixels per frame
};

// Keyboard state
const keys = {
  w: false,
  a: false,
  s: false,
  d: false,
  ArrowUp: false,
  ArrowLeft: false,
  ArrowDown: false,
  ArrowRight: false
};

let planetData = null;
let basePlanetTexture = null;
let worldRng = null;
let worldNoise = null;

// ============================================
// SEEDED RNG + SIMPLEX NOISE
// ============================================
class SeededRNG {
  constructor(seed) {
    this.seed = seed % 2147483647;
    if (this.seed <= 0) this.seed += 2147483646;
  }
  next() {
    this.seed = (this.seed * 48271) % 2147483647;
    return this.seed / 2147483647;
  }
  range(min, max) {
    return min + this.next() * (max - min);
  }
  int(min, max) {
    return Math.floor(this.range(min, max + 1));
  }
  choice(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }
}

class SimplexNoise {
  constructor(rng) {
    const p = [];
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    this.perm = new Uint8Array(512);
    this.permMod12 = new Uint8Array(512);
    for (let i = 0; i < 512; i++) {
      this.perm[i] = p[i & 255];
      this.permMod12[i] = this.perm[i] % 12;
    }
    this.grad3 = new Float32Array([
      1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
      1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
      0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1
    ]);
    this.F2 = 0.5 * (Math.sqrt(3.0) - 1.0);
    this.G2 = (3.0 - Math.sqrt(3.0)) / 6.0;
  }
  noise2D(xin, yin) {
    let n0, n1, n2;
    const s = (xin + yin) * this.F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * this.G2;
    const X0 = i - t;
    const Y0 = j - t;
    const x0 = xin - X0;
    const y0 = yin - Y0;
    let i1, j1;
    if (x0 > y0) { i1 = 1; j1 = 0; }
    else { i1 = 0; j1 = 1; }
    const x1 = x0 - i1 + this.G2;
    const y1 = y0 - j1 + this.G2;
    const x2 = x0 - 1.0 + 2.0 * this.G2;
    const y2 = y0 - 1.0 + 2.0 * this.G2;
    const ii = i & 255;
    const jj = j & 255;
    const gi0 = this.permMod12[ii + this.perm[jj]] * 3;
    const gi1 = this.permMod12[ii + i1 + this.perm[jj + j1]] * 3;
    const gi2 = this.permMod12[ii + 1 + this.perm[jj + 1]] * 3;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 < 0) n0 = 0.0;
    else {
      const g = this.grad3;
      t0 *= t0;
      n0 = t0 * t0 * (g[gi0] * x0 + g[gi0 + 1] * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 < 0) n1 = 0.0;
    else {
      const g = this.grad3;
      t1 *= t1;
      n1 = t1 * t1 * (g[gi1] * x1 + g[gi1 + 1] * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 < 0) n2 = 0.0;
    else {
      const g = this.grad3;
      t2 *= t2;
      n2 = t2 * t2 * (g[gi2] * x2 + g[gi2 + 1] * y2);
    }
    return 70.0 * (n0 + n1 + n2);
  }
}

// ============================================
// EXPANDED NAME POOLS - WAY MORE NAMES
// ============================================
const NAME_POOLS = {
  // MASSIVELY EXPANDED tribe/civilization prefixes
  prefixes: [
    'Akar', 'Amun', 'Anzu', 'Balar', 'Barak', 'Belos', 'Canar', 'Carul', 'Dagon', 'Darak',
    'Ekur', 'Elar', 'Farak', 'Fenris', 'Galar', 'Gorun', 'Harak', 'Helos', 'Inar', 'Istar',
    'Jarak', 'Kalar', 'Karun', 'Larak', 'Malar', 'Moros', 'Nakar', 'Nimar', 'Okar', 'Orun',
    'Palar', 'Qumar', 'Rakan', 'Salar', 'Talar', 'Telos', 'Ukar', 'Valar', 'Warak', 'Xalar',
    'Yarak', 'Zalar', 'Ashur', 'Belos', 'Carak', 'Dakar', 'Elros', 'Feros', 'Goran', 'Harak',
    'Ibor', 'Joros', 'Keros', 'Loros', 'Marak', 'Noros', 'Othar', 'Poros', 'Qoros', 'Roros',
    'Soros', 'Thoros', 'Uros', 'Voros', 'Woros', 'Xoros', 'Yoros', 'Zoros', 'Athar', 'Belar',
    'Corak', 'Durak', 'Ezran', 'Faros', 'Goros', 'Hular', 'Ixar', 'Jular', 'Kular', 'Lular',
    'Mular', 'Nular', 'Oktar', 'Pular', 'Qular', 'Rular', 'Solar', 'Tular', 'Uktar', 'Vular',
    'Wular', 'Xular', 'Yular', 'Zular', 'Azor', 'Boran', 'Cyrus', 'Doran', 'Ezan', 'Faran',
    'Garan', 'Haran', 'Izan', 'Jaran', 'Karan', 'Laran', 'Maran', 'Naran', 'Oran', 'Paran',
    'Qaran', 'Raran', 'Saran', 'Taran', 'Uran', 'Varan', 'Waran', 'Xaran', 'Yaran', 'Zaran',
    'Akros', 'Baros', 'Caros', 'Daros', 'Eros', 'Faros', 'Garos', 'Haros', 'Iros', 'Jaros',
    'Karos', 'Laros', 'Maros', 'Naros', 'Oros', 'Paros', 'Qaros', 'Raros', 'Saros', 'Taros',
    'Uros', 'Varos', 'Waros', 'Xaros', 'Yaros', 'Zaros', 'Adran', 'Belan', 'Celan', 'Delan',
    'Elan', 'Felan', 'Gelan', 'Helan', 'Ilan', 'Jelan', 'Kelan', 'Lelan', 'Melan', 'Nelan',
    'Olan', 'Pelan', 'Qelan', 'Relan', 'Selan', 'Telan', 'Uelan', 'Velan', 'Welan', 'Xelan',
    'Yelan', 'Zelan', 'Azur', 'Bezur', 'Cezur', 'Dezur', 'Ezur', 'Fezur', 'Gezur', 'Hezur',
    'Izur', 'Jezur', 'Kezur', 'Lezur', 'Mezur', 'Nezur', 'Ozur', 'Pezur', 'Qezur', 'Rezur'
  ],
  
  // MASSIVELY EXPANDED suffixes
  suffixes: [
    'an', 'en', 'ian', 'on', 'ar', 'or', 'us', 'is', 'os', 'as',
    'eth', 'ath', 'oth', 'ith', 'uth', 'yn', 'in', 'un', 'an', 'on',
    'el', 'al', 'ol', 'il', 'ul', 'ak', 'ek', 'ik', 'ok', 'uk',
    'ara', 'era', 'ira', 'ora', 'ura', 'ane', 'ene', 'ine', 'one', 'une',
    'ath', 'eth', 'ith', 'oth', 'uth', 'ar', 'er', 'ir', 'or', 'ur',
    'ax', 'ex', 'ix', 'ox', 'ux', 'az', 'ez', 'iz', 'oz', 'uz',
    'ian', 'ean', 'oan', 'uan', 'yan', 'lar', 'nar', 'tar', 'kar', 'mar',
    'len', 'nen', 'ten', 'ken', 'men', 'los', 'nos', 'tos', 'kos', 'mos',
    'lis', 'nis', 'tis', 'kis', 'mis', 'lus', 'nus', 'tus', 'kus', 'mus',
    'ra', 'na', 'ta', 'ka', 'ma', 'ro', 'no', 'to', 'ko', 'mo',
    'rus', 'nus', 'tus', 'kus', 'mus', 'ris', 'nis', 'tis', 'kis', 'mis',
    'ren', 'nen', 'ten', 'ken', 'men', 'ran', 'nan', 'tan', 'kan', 'man'
  ],
  
  // MASSIVELY EXPANDED leader names (first names)
  leaderFirstNames: [
    'Aeron', 'Aldric', 'Aleron', 'Amos', 'Andor', 'Arkan', 'Asher', 'Athos', 'Azor', 'Balor',
    'Barak', 'Belen', 'Boris', 'Cael', 'Caius', 'Caleb', 'Castor', 'Cedric', 'Cyrus', 'Dagon',
    'Darius', 'Davos', 'Doran', 'Draven', 'Ector', 'Eldon', 'Elex', 'Elric', 'Endor', 'Eris',
    'Eryx', 'Ezra', 'Faron', 'Felix', 'Fenris', 'Galen', 'Gareth', 'Gideon', 'Gorin', 'Hakan',
    'Haldor', 'Harlan', 'Hector', 'Helios', 'Henrik', 'Heron', 'Iban', 'Icarus', 'Igor', 'Ilan',
    'Imran', 'Inor', 'Ivar', 'Jace', 'Jared', 'Jaron', 'Joran', 'Kael', 'Kain', 'Kalen',
    'Kalos', 'Karan', 'Karel', 'Kato', 'Keros', 'Klaus', 'Kyros', 'Lazar', 'Leif', 'Leon',
    'Leron', 'Loras', 'Lucian', 'Magnus', 'Malik', 'Marcus', 'Marius', 'Maxim', 'Melkor', 'Meros',
    'Milan', 'Moran', 'Nero', 'Nicos', 'Nolan', 'Oberon', 'Odin', 'Omeros', 'Orion', 'Osric',
    'Otto', 'Pavel', 'Paxon', 'Perrin', 'Petra', 'Pyrrhus', 'Quinn', 'Ragnar', 'Raven', 'Remus',
    'Renly', 'Rheon', 'Rogan', 'Roland', 'Roman', 'Rorik', 'Rylan', 'Sagan', 'Saul', 'Saxon',
    'Selas', 'Seron', 'Silas', 'Solon', 'Stefan', 'Sven', 'Talan', 'Talos', 'Taron', 'Thane',
    'Theron', 'Titus', 'Tobias', 'Toran', 'Tristan', 'Tyrus', 'Ulric', 'Umar', 'Uras', 'Valen',
    'Varen', 'Varus', 'Victor', 'Viggo', 'Viktor', 'Voran', 'Waldo', 'Warren', 'Xander', 'Xerxes',
    'Yaron', 'Yorick', 'Yvan', 'Zael', 'Zander', 'Zephyr', 'Zoran', 'Zyler', 'Adalric', 'Alaric',
    'Aldous', 'Alrik', 'Ambrose', 'Ansel', 'Archer', 'Arden', 'Arlen', 'Arvin', 'Auric', 'Axel',
    'Bardric', 'Barlow', 'Baron', 'Basil', 'Baxter', 'Benedikt', 'Blaine', 'Braden', 'Brennan', 'Brock',
    'Broderick', 'Byron', 'Cadmus', 'Camden', 'Carrick', 'Cassian', 'Cato', 'Chadwick', 'Clarence', 'Clifton',
    'Colton', 'Conrad', 'Constantine', 'Corbin', 'Cornelius', 'Cortez', 'Cosmo', 'Crispin', 'Damian', 'Dante',
    'Demetrius', 'Denzel', 'Desmond', 'Dexter', 'Dimitri', 'Dominic', 'Drake', 'Duncan', 'Earl', 'Edgar',
    'Edmund', 'Edwin', 'Egon', 'Elias', 'Elliot', 'Emerson', 'Emil', 'Emmett', 'Enoch', 'Ephraim',
    'Ernest', 'Ethan', 'Eugene', 'Evander', 'Everett', 'Fabian', 'Falcon', 'Ferdinand', 'Fletcher', 'Floyd',
    'Foster', 'Francis', 'Franklin', 'Frederick', 'Gabriel', 'Garrison', 'Gaston', 'Geoffrey', 'Gerald', 'Gilbert',
    'Gordon', 'Graham', 'Grant', 'Gregory', 'Griffin', 'Gunnar', 'Gustav', 'Hamilton', 'Hamish', 'Hans',
    'Harold', 'Harrison', 'Harvey', 'Hector', 'Henry', 'Herbert', 'Herman', 'Horace', 'Howard', 'Hugo',
    'Humphrey', 'Ian', 'Ibrahim', 'Ignatius', 'Irving', 'Isaac', 'Isidore', 'Ivan', 'Jabari', 'Jackson',
    'Jacob', 'Jagger', 'Jamal', 'Jasper', 'Javier', 'Jerome', 'Jesse', 'Jonas', 'Jonathan', 'Jordan',
    'Joseph', 'Joshua', 'Julian', 'Julius', 'Justin', 'Karl', 'Keiran', 'Keith', 'Kenneth', 'Kevin'
  ],
  
  // MASSIVELY EXPANDED leader last names
  leaderLastNames: [
    'Blackwood', 'Ironforge', 'Stormborn', 'Ashbane', 'Darkwater', 'Flameheart', 'Frostblade', 'Goldmane', 'Greystone', 'Hawkeye',
    'Ironclaw', 'Lightbringer', 'Moonwhisper', 'Nightshade', 'Oakenshield', 'Ravencrest', 'Redthorn', 'Shadowfang', 'Silverwing', 'Stargazer',
    'Steelborn', 'Stonebreaker', 'Stormbringer', 'Suncrest', 'Swiftarrow', 'Thunderfist', 'Trueblade', 'Whitehawk', 'Wildfire', 'Winterborn',
    'Wolfsbane', 'Brightshield', 'Bronzehammer', 'Crimsonvale', 'Deepwater', 'Duskwalker', 'Earthshaker', 'Emberstorm', 'Fireborn', 'Frostfall',
    'Goldcrest', 'Grimward', 'Highpeak', 'Icevein', 'Ironside', 'Jadewing', 'Lionheart', 'Mithrilhand', 'Northwind', 'Obsidianedge',
    'Peakstone', 'Quicksilver', 'Ravenwood', 'Saltshore', 'Seaborn', 'Shadowmere', 'Skybreaker', 'Snowmane', 'Starheart', 'Stonehelm',
    'Sunderland', 'Thornwood', 'Tidecaller', 'Torchbearer', 'Valorheart', 'Voidwalker', 'Wardstone', 'Watersong', 'Windrunner', 'Wyrmstone',
    'Ashford', 'Blackthorn', 'Bloodmoon', 'Brightblade', 'Clearwater', 'Cloudstrike', 'Coldsteel', 'Darkholm', 'Dawnbringer', 'Dragonheart',
    'Duskwood', 'Eaglewing', 'Earthborn', 'Evermoon', 'Fairhaven', 'Fallowmere', 'Firebrand', 'Frostguard', 'Goldleaf', 'Grayhaven',
    'Greenwood', 'Hallowbrook', 'Harbinger', 'Highborn', 'Hollowdale', 'Ironwood', 'Knightfall', 'Lightholm', 'Longstride', 'Marblehorn',
    'Meadowbrook', 'Mistwood', 'Moonforge', 'Morningstar', 'Nightfall', 'Northstar', 'Oldoak', 'Pathfinder', 'Proudfoot', 'Quickblade',
    'Redfield', 'Riverstone', 'Rockwood', 'Rosewood', 'Shadowbrook', 'Sharpedge', 'Silverbrook', 'Skyward', 'Snowfall', 'Southwind',
    'Starfall', 'Stonefist', 'Stormguard', 'Strongheart', 'Sunblade', 'Swiftbrook', 'Thornfield', 'Thunderforge', 'Trueborn', 'Underwood',
    'Valorborn', 'Waterstone', 'Westwind', 'Whitestone', 'Wildborn', 'Windstone', 'Winterforge', 'Wolfwood', 'Youngblood', 'Ashenheart',
    'Battleborn', 'Bladestorm', 'Braveheart', 'Brightforge', 'Bronzewing', 'Castlerock', 'Copperfield', 'Crownguard', 'Crystalwind', 'Darkbane',
    'Dawnforge', 'Deepforge', 'Diamondback', 'Driftwood', 'Duskblade', 'Eagleheart', 'Elderwood', 'Emberforge', 'Fairwind', 'Fallbrook',
    'Fieldstone', 'Flintstrike', 'Forestborn', 'Freeborn', 'Frostborn', 'Galeforce', 'Gemheart', 'Ghostwalker', 'Gladeheart', 'Goldforge',
    'Grandstone', 'Graveborn', 'Greatwood', 'Greywind', 'Grimforge', 'Hardstone', 'Havenbrook', 'Heartwood', 'Highforge', 'Hillborne',
    'Holyoak', 'Hornwood', 'Iceborn', 'Ironheart', 'Jadeheart', 'Keenedge', 'Kingsbane', 'Knightwood', 'Lakeshire', 'Landfall',
    'Lawbringer', 'Leafborn', 'Lightforge', 'Lionborn', 'Longbow', 'Lordstone', 'Lorekeeper', 'Mageborn', 'Maplebrook', 'Marshwood'
  ],
  
  // MASSIVELY EXPANDED city names
  cityNames: [
    'Aldgate', 'Ashford', 'Avalon', 'Baelfort', 'Blackwater', 'Brightholm', 'Cairnholm', 'Castlerock', 'Clearwater', 'Coldstone',
    'Cragmoor', 'Crossroads', 'Deepwood', 'Dragonspire', 'Duskhollow', 'Eaglecrest', 'Eastmarch', 'Eldergrove', 'Emberfall', 'Evermore',
    'Fairhaven', 'Frostpeak', 'Goldcrest', 'Greenvale', 'Greywatch', 'Harbortown', 'Highcliff', 'Hillcrest', 'Ironforge', 'Kingshaven',
    'Lakeshire', 'Longport', 'Meadowbrook', 'Mistfall', 'Moonhaven', 'Northgate', 'Oakridge', 'Oldtown', 'Ravenswood', 'Redcliff',
    'Riverdale', 'Rockport', 'Rosewood', 'Saltmere', 'Shadowdale', 'Silverstone', 'Skywatch', 'Southport', 'Starfall', 'Stonebridge',
    'Stormhaven', 'Sundale', 'Thornwood', 'Tidehaven', 'Valorkeep', 'Waterford', 'Westgate', 'Whitestone', 'Wildwood', 'Windhelm',
    'Winterhold', 'Wolfden', 'Amberfield', 'Anchorpoint', 'Applegrove', 'Archway', 'Ashenvale', 'Azureport', 'Barrowton', 'Baybridge',
    'Beachside', 'Bellhaven', 'Birchwood', 'Blackburn', 'Bluestone', 'Bridgeton', 'Brightwater', 'Bronzegate', 'Brookhaven', 'Burnwick',
    'Candlewick', 'Cedarwood', 'Charbridge', 'Cherryhill', 'Cliffside', 'Cloudrest', 'Coalport', 'Cobblestone', 'Copperhill', 'Coralshore',
    'Cornerstone', 'Crownpoint', 'Crystalbrook', 'Dawnstar', 'Deepholm', 'Deerfield', 'Diamondport', 'Driftwood', 'Dunwick', 'Eaglepoint',
    'Eastbrook', 'Ebonhold', 'Edgewater', 'Elmwood', 'Emeraldhill', 'Fairfield', 'Fallbrook', 'Featherfall', 'Fernwood', 'Fieldstone',
    'Firestone', 'Fishbrook', 'Flamewood', 'Fleetport', 'Flintwood', 'Fogmere', 'Forestgate', 'Freehold', 'Frostwood', 'Galeport',
    'Gardenhill', 'Gemstone', 'Ghostwood', 'Gildedport', 'Glasswater', 'Glenwood', 'Glimmershore', 'Goldbrook', 'Goodhaven', 'Grandport',
    'Grapehill', 'Grassmere', 'Gravewood', 'Greengate', 'Greyport', 'Grimdale', 'Gullport', 'Hallowdale', 'Hammerstone', 'Harborside',
    'Hartwood', 'Havendale', 'Hawkstone', 'Hazelwood', 'Heartland', 'Heatherfield', 'Highgate', 'Highstone', 'Hillgate', 'Hollowheart',
    'Honeyfield', 'Hopefield', 'Hornwood', 'Iceport', 'Irongate', 'Ironwood', 'Ivydale', 'Jadeport', 'Jewelcrest', 'Keenport',
    'Keystone', 'Kingsbridge', 'Kingsport', 'Knightdale', 'Lakeford', 'Lakeview', 'Lamplight', 'Lanternwood', 'Larkspur', 'Leafdale',
    'Limestone', 'Liongate', 'Lionsport', 'Lockwood', 'Lonestone', 'Lordport', 'Lotusfield', 'Luckport', 'Maplebrook', 'Marbleton',
    'Marshgate', 'Meadowgate', 'Millbrook', 'Millstone', 'Mintwood', 'Mirrorport', 'Mistwood', 'Moonbridge', 'Moonstone', 'Moorgate',
    'Morningdale', 'Mountaingate', 'Myrtle', 'Needlewood', 'Newbridge', 'Newgate', 'Nightbrook', 'Northbrook', 'Northstone', 'Novamere'
  ],
  
  // MASSIVELY EXPANDED country/civilization types (replaces "Civilization" ending)
  countryTypes: [
    'Empire', 'Kingdom', 'Republic', 'Dominion', 'Federation', 'Confederacy', 'Commonwealth', 'Union', 
    'League', 'Alliance', 'Coalition', 'Consortium', 'State', 'Nation', 'Realm', 'Domain',
    'Principality', 'Duchy', 'Protectorate', 'Territory', 'Province', 'Hegemony', 'Dynasty', 'Imperium',
    'Khanate', 'Sultanate', 'Emirate', 'Caliphate', 'Shogunate', 'Tsardom', 'Raj', 'Mandate',
    'Theocracy', 'Autocracy', 'Oligarchy', 'Triumvirate', 'Directorate', 'Regency', 'Sovereignty', 'Freehold',
    'Compact', 'Concord', 'Accord', 'Pact', 'Entente', 'Bloc', 'Council', 'Assembly',
    'Grand Duchy', 'Archduchy', 'Viceroyalty', 'Crown', 'Throne', 'Court', 'House', 'Dynasty',
    'Ascendancy', 'Supremacy', 'Stratocracy', 'Kritarchy', 'Synarchy', 'Technocracy', 'Meritocracy', 'Timocracy'
  ]
};

// ============================================
// WORLD STATE
// ============================================
let gameState = {
  year: 0,
  speed: 2, // 0=pause, 1=slow, 2=normal, 3=fast, 4=ultra
  speedMultipliers: [0, 1, 3, 10, 30],
  tribes: [],
  countries: [],
  events: [],
  lastTick: 0
};

// ============================================
// HELPERS
// ============================================
function generateName(type = 'tribe') {
  const prefix = worldRng.choice(NAME_POOLS.prefixes);
  const suffix = worldRng.choice(NAME_POOLS.suffixes);
  return prefix + suffix;
}

function generateCivilizationName() {
  const baseName = generateName('civilization');
  const civType = worldRng.choice(NAME_POOLS.countryTypes);
  return `${baseName} ${civType}`;
}

function generateLeaderName() {
  const first = worldRng.choice(NAME_POOLS.leaderFirstNames);
  const last = worldRng.choice(NAME_POOLS.leaderLastNames);
  return `${first} ${last}`;
}

function generateCityName() {
  return worldRng.choice(NAME_POOLS.cityNames);
}

function addEvent(message) {
  gameState.events.unshift({ year: gameState.year, message });
  if (gameState.events.length > 50) gameState.events.pop();
  updateEventLog();
}

function updateEventLog() {
  const el = document.getElementById('eventLog');
  if (!el) return;
  el.innerHTML = gameState.events.map(e => 
    `<div class="event-item">
      <span class="event-year">${e.year}</span>
      <span class="event-message">${e.message}</span>
    </div>`
  ).join('');
}

// ============================================
// PLANET GENERATION
// ============================================
async function generatePlanet(seed) {
  worldRng = new SeededRNG(seed);
  worldNoise = new SimplexNoise(worldRng);

  const w = MAP_WIDTH, h = MAP_HEIGHT;
  const terrainData = new Uint8Array(w * h);
  const heightData = new Float32Array(w * h);

  const updateProgress = (pct, msg) => {
    document.getElementById('progressBar').style.width = pct + '%';
    document.getElementById('progressText').textContent = msg;
  };

  updateProgress(0, 'Generating base terrain...');
  await new Promise(r => setTimeout(r, 50));

  // Multi-octave noise for terrain
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = x / w, ny = y / h;
      let val = 0;
      val += worldNoise.noise2D(nx * 4, ny * 4) * 1.0;
      val += worldNoise.noise2D(nx * 8, ny * 8) * 0.5;
      val += worldNoise.noise2D(nx * 16, ny * 16) * 0.25;
      val /= 1.75;
      
      // Polar reduction
      const latFactor = Math.abs(ny - 0.5) * 2;
      val -= latFactor * 0.3;
      
      heightData[y * w + x] = val;
      
      // Terrain type
      let type = 0; // water
      if (val > 0.05) type = 1; // land
      if (val > 0.3) type = 2; // hills
      if (val > 0.5) type = 3; // mountains
      if (latFactor > 0.8 && val > -0.1) type = 4; // ice
      
      terrainData[y * w + x] = type;
    }
    if (y % 128 === 0) {
      updateProgress(10 + (y / h) * 40, 'Shaping continents...');
      await new Promise(r => setTimeout(r, 0));
    }
  }

  updateProgress(50, 'Adding climate zones...');
  await new Promise(r => setTimeout(r, 50));

  const climateData = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const lat = Math.abs(y / h - 0.5) * 2;
    for (let x = 0; x < w; x++) {
      const moisture = worldNoise.noise2D(x / w * 3, y / h * 3);
      let climate = 0; // temperate
      if (lat > 0.7) climate = 3; // polar
      else if (lat < 0.3) climate = 1; // tropical
      else if (moisture < -0.2) climate = 2; // arid
      climateData[y * w + x] = climate;
    }
    if (y % 128 === 0) {
      updateProgress(50 + (y / h) * 20, 'Generating climate...');
      await new Promise(r => setTimeout(r, 0));
    }
  }

  updateProgress(70, 'Creating rivers...');
  await new Promise(r => setTimeout(r, 50));

  const rivers = [];
  for (let i = 0; i < 20; i++) {
    const startX = worldRng.int(0, w - 1);
    const startY = worldRng.int(0, h - 1);
    if (terrainData[startY * w + startX] > 2) {
      const river = [];
      let cx = startX, cy = startY;
      for (let step = 0; step < 200; step++) {
        river.push({ x: cx, y: cy });
        if (terrainData[cy * w + cx] === 0) break;
        
        let lowest = heightData[cy * w + cx];
        let nx = cx, ny = cy;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const tx = (cx + dx + w) % w;
            const ty = Math.max(0, Math.min(h - 1, cy + dy));
            const th = heightData[ty * w + tx];
            if (th < lowest) {
              lowest = th;
              nx = tx;
              ny = ty;
            }
          }
        }
        if (nx === cx && ny === cy) break;
        cx = nx;
        cy = ny;
      }
      if (river.length > 10) rivers.push(river);
    }
  }

  updateProgress(80, 'Rendering world...');
  await new Promise(r => setTimeout(r, 50));

  // Render to texture
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(w, h);
  
  const colors = {
    0: [30, 60, 120],     // ocean
    1: [80, 140, 80],     // land
    2: [110, 150, 90],    // hills
    3: [140, 140, 140],   // mountains
    4: [240, 250, 255]    // ice
  };

  for (let i = 0; i < terrainData.length; i++) {
    const type = terrainData[i];
    const [r, g, b] = colors[type];
    imgData.data[i * 4] = r;
    imgData.data[i * 4 + 1] = g;
    imgData.data[i * 4 + 2] = b;
    imgData.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);

  // Draw rivers
  ctx.strokeStyle = 'rgba(50, 100, 180, 0.5)';
  ctx.lineWidth = 1;
  rivers.forEach(river => {
    ctx.beginPath();
    ctx.moveTo(river[0].x, river[0].y);
    river.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.stroke();
  });

  basePlanetTexture = canvas;

  planetData = {
    terrain: terrainData,
    height: heightData,
    climate: climateData,
    rivers,
    width: w,
    height: h
  };

  updateProgress(100, 'Complete!');
  await new Promise(r => setTimeout(r, 300));
  return planetData;
}

// ============================================
// TRIBE SYSTEM (with expansion limits)
// ============================================
function initTribes() {
  const numTribes = worldRng.int(8, 16);
  for (let i = 0; i < numTribes; i++) {
    spawnTribe();
  }
}

function spawnTribe() {
  let x, y, terrain;
  let attempts = 0;
  do {
    x = worldRng.int(0, MAP_WIDTH - 1);
    y = worldRng.int(0, MAP_HEIGHT - 1);
    terrain = planetData.terrain[y * MAP_WIDTH + x];
    attempts++;
  } while ((terrain === 0 || terrain === 4) && attempts < 100);
  
  if (attempts >= 100) return;

  const tribe = {
    id: 'tribe_' + Date.now() + '_' + worldRng.int(0, 9999),
    name: generateName('tribe'),
    x, y,
    population: worldRng.int(50, 200),
    territories: [{ x, y }],
    color: `hsl(${worldRng.int(0, 360)}, 70%, 60%)`,
    age: 0,
    lastExpansion: 0,
    maxTerritoryBeforeCiv: 8 // LIMIT: tribes can't expand beyond 8 territories until they become civilizations
  };
  gameState.tribes.push(tribe);
  addEvent(`${tribe.name} tribe emerges`);
}

function updateTribes() {
  // Tribe logic
  gameState.tribes.forEach(tribe => {
    tribe.age++;
    tribe.population += worldRng.int(-5, 15);
    if (tribe.population < 10) tribe.population = 10;

    // Expansion logic (LIMITED before civilization)
    if (tribe.age - tribe.lastExpansion > 50 && tribe.territories.length < tribe.maxTerritoryBeforeCiv) {
      expandTribeTerritory(tribe);
      tribe.lastExpansion = tribe.age;
    }

    // Become civilization when conditions are met
    if (tribe.population > 500 && tribe.age > 200 && tribe.territories.length >= 5) {
      const civIndex = worldRng.int(0, 1000);
      if (civIndex < 5) { // 0.5% chance per tick
        tribeToCivilization(tribe);
      }
    }
  });

  // Remove dead tribes
  gameState.tribes = gameState.tribes.filter(t => t.population > 0);
}

function expandTribeTerritory(tribe) {
  if (tribe.territories.length === 0) return;
  
  // Pick random existing territory to expand from
  const baseTerritory = worldRng.choice(tribe.territories);
  const directions = [
    { dx: -1, dy: 0 }, { dx: 1, dy: 0 },
    { dx: 0, dy: -1 }, { dx: 0, dy: 1 },
    { dx: -1, dy: -1 }, { dx: -1, dy: 1 },
    { dx: 1, dy: -1 }, { dx: 1, dy: 1 }
  ];
  
  // Shuffle directions
  for (let i = directions.length - 1; i > 0; i--) {
    const j = worldRng.int(0, i);
    [directions[i], directions[j]] = [directions[j], directions[i]];
  }
  
  for (const dir of directions) {
    const newX = (baseTerritory.x + dir.dx + MAP_WIDTH) % MAP_WIDTH;
    const newY = Math.max(0, Math.min(MAP_HEIGHT - 1, baseTerritory.y + dir.dy));
    
    // Check if territory is valid and not already owned
    const terrain = planetData.terrain[newY * MAP_WIDTH + newX];
    if (terrain === 0 || terrain === 4) continue; // skip water and ice
    
    // Check if already owned by this tribe
    const alreadyOwned = tribe.territories.some(t => t.x === newX && t.y === newY);
    if (alreadyOwned) continue;
    
    // CRITICAL FIX: Check if owned by ANY other tribe or country
    const ownedByOther = isTerritoryClaimed(newX, newY, tribe.id);
    if (ownedByOther) continue;
    
    // Add new territory
    tribe.territories.push({ x: newX, y: newY });
    return;
  }
}

function isTerritoryClaimed(x, y, excludeId = null) {
  // Check all tribes
  for (const tribe of gameState.tribes) {
    if (tribe.id === excludeId) continue;
    if (tribe.territories.some(t => t.x === x && t.y === y)) {
      return true;
    }
  }
  
  // Check all countries
  for (const country of gameState.countries) {
    if (country.id === excludeId) continue;
    if (country.territories.some(t => t.x === x && t.y === y)) {
      return true;
    }
  }
  
  return false;
}

function tribeToCivilization(tribe) {
  const country = {
    id: tribe.id, // Keep same ID
    name: generateCivilizationName(), // NOW USES COUNTRY TYPES, NOT "Civilization"
    x: tribe.x,
    y: tribe.y,
    population: tribe.population,
    territories: [...tribe.territories],
    color: tribe.color,
    leader: {
      name: generateLeaderName(),
      age: worldRng.int(25, 60),
      traits: {
        aggression: worldRng.range(0, 1),
        caution: worldRng.range(0, 1),
        diplomacy: worldRng.range(0, 1),
        ambition: worldRng.range(0, 1)
      }
    },
    government: 'Tribal Chiefdom',
    cities: [],
    age: tribe.age,
    lastExpansion: 0
  };

  // Create capital city
  const capitalName = generateCityName();
  country.cities.push({
    name: capitalName,
    x: tribe.x,
    y: tribe.y,
    population: Math.floor(tribe.population * 0.3),
    isCapital: true
  });

  gameState.countries.push(country);
  gameState.tribes = gameState.tribes.filter(t => t.id !== tribe.id);
  
  addEvent(`${country.name} founded by ${country.leader.name}`);
}

// ============================================
// COUNTRY SYSTEM (unlimited expansion)
// ============================================
function updateCountries() {
  gameState.countries.forEach(country => {
    country.age++;
    country.population += worldRng.int(10, 50);

    // Countries can expand much more freely
    if (country.age - country.lastExpansion > 30) {
      expandCountryTerritory(country);
      country.lastExpansion = country.age;
    }

    // Create new cities occasionally
    if (country.population > country.cities.length * 1000 && worldRng.next() < 0.01) {
      createCity(country);
    }
  });
}

function expandCountryTerritory(country) {
  if (country.territories.length === 0) return;
  
  const baseTerritory = worldRng.choice(country.territories);
  const directions = [
    { dx: -1, dy: 0 }, { dx: 1, dy: 0 },
    { dx: 0, dy: -1 }, { dx: 0, dy: 1 },
    { dx: -1, dy: -1 }, { dx: -1, dy: 1 },
    { dx: 1, dy: -1 }, { dx: 1, dy: 1 }
  ];
  
  for (let i = directions.length - 1; i > 0; i--) {
    const j = worldRng.int(0, i);
    [directions[i], directions[j]] = [directions[j], directions[i]];
  }
  
  for (const dir of directions) {
    const newX = (baseTerritory.x + dir.dx + MAP_WIDTH) % MAP_WIDTH;
    const newY = Math.max(0, Math.min(MAP_HEIGHT - 1, baseTerritory.y + dir.dy));
    
    const terrain = planetData.terrain[newY * MAP_WIDTH + newX];
    if (terrain === 0 || terrain === 4) continue;
    
    const alreadyOwned = country.territories.some(t => t.x === newX && t.y === newY);
    if (alreadyOwned) continue;
    
    // CRITICAL FIX: Check if owned by ANY other entity
    const ownedByOther = isTerritoryClaimed(newX, newY, country.id);
    if (ownedByOther) continue;
    
    country.territories.push({ x: newX, y: newY });
    return;
  }
}

function createCity(country) {
  // Find territory without a city
  const availableTerritories = country.territories.filter(t => 
    !country.cities.some(c => c.x === t.x && c.y === t.y)
  );
  
  if (availableTerritories.length === 0) return;
  
  const location = worldRng.choice(availableTerritories);
  const cityName = generateCityName();
  
  country.cities.push({
    name: cityName,
    x: location.x,
    y: location.y,
    population: worldRng.int(100, 500),
    isCapital: false
  });
  
  addEvent(`${cityName} founded in ${country.name}`);
}

// ============================================
// RENDERING
// ============================================
function renderWorld() {
  if (!basePlanetTexture || !planetData) return;

  const cw = mapCanvas.width;
  const ch = mapCanvas.height;
  
  mapCtx.fillStyle = '#000510';
  mapCtx.fillRect(0, 0, cw, ch);

  const scale = Math.min(cw / MAP_WIDTH, ch / MAP_HEIGHT) * camera.zoom;
  const offsetX = cw / 2 - (MAP_WIDTH / 2) * scale - camera.x * scale;
  const offsetY = ch / 2 - (MAP_HEIGHT / 2) * scale - camera.y * scale;

  mapCtx.save();
  mapCtx.translate(offsetX, offsetY);
  mapCtx.scale(scale, scale);
  
  // Draw base planet
  mapCtx.drawImage(basePlanetTexture, 0, 0);
  
  // Draw territories for tribes
  gameState.tribes.forEach(tribe => {
    mapCtx.fillStyle = tribe.color + '40';
    mapCtx.strokeStyle = tribe.color;
    mapCtx.lineWidth = 1 / scale;
    
    tribe.territories.forEach(t => {
      mapCtx.fillRect(t.x, t.y, 1, 1);
      mapCtx.strokeRect(t.x, t.y, 1, 1);
    });
    
    // Tribe marker
    mapCtx.fillStyle = tribe.color;
    mapCtx.fillRect(tribe.x - 2, tribe.y - 2, 4, 4);
  });
  
  // Draw territories for countries
  gameState.countries.forEach(country => {
    mapCtx.fillStyle = country.color + '60';
    mapCtx.strokeStyle = country.color;
    mapCtx.lineWidth = 1 / scale;
    
    country.territories.forEach(t => {
      mapCtx.fillRect(t.x, t.y, 1, 1);
      mapCtx.strokeRect(t.x, t.y, 1, 1);
    });
    
    // City markers
    country.cities.forEach(city => {
      mapCtx.fillStyle = city.isCapital ? '#FFD700' : '#FFFFFF';
      const size = city.isCapital ? 6 : 4;
      mapCtx.fillRect(city.x - size/2, city.y - size/2, size, size);
    });
  });
  
  mapCtx.restore();
  
  // Update UI
  const statsEl = document.getElementById('worldStats');
  if (statsEl) {
    statsEl.textContent = `Year ${gameState.year} | Tribes: ${gameState.tribes.length} | Countries: ${gameState.countries.length}`;
  }
}

function resizeCanvas() {
  mapCanvas.width = window.innerWidth;
  mapCanvas.height = window.innerHeight;
  overlayCanvas.width = window.innerWidth;
  overlayCanvas.height = window.innerHeight;
}

// ============================================
// CAMERA CONTROLS
// ============================================
function updateCamera() {
  const moveSpeed = camera.moveSpeed / camera.zoom;
  
  if (keys.w || keys.ArrowUp) camera.y -= moveSpeed;
  if (keys.s || keys.ArrowDown) camera.y += moveSpeed;
  if (keys.a || keys.ArrowLeft) camera.x -= moveSpeed;
  if (keys.d || keys.ArrowRight) camera.x += moveSpeed;
  
  // Smooth zoom
  camera.zoom += (camera.targetZoom - camera.zoom) * 0.1;
}

// ============================================
// GAME LOOP
// ============================================
function gameLoop(timestamp) {
  const delta = timestamp - gameState.lastTick;
  
  if (gameState.speed > 0 && delta >= 100 / gameState.speedMultipliers[gameState.speed]) {
    gameState.year += 1;
    updateTribes();
    updateCountries();
    gameState.lastTick = timestamp;
  }
  
  updateCamera();
  renderWorld();
  
  requestAnimationFrame(gameLoop);
}

// ============================================
// EVENT HANDLERS
// ============================================
document.addEventListener('keydown', (e) => {
  if (e.key in keys) {
    keys[e.key] = true;
    e.preventDefault();
  }
});

document.addEventListener('keyup', (e) => {
  if (e.key in keys) {
    keys[e.key] = false;
    e.preventDefault();
  }
});

mapCanvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
  camera.targetZoom = Math.max(camera.minZoom, Math.min(camera.maxZoom, camera.targetZoom * zoomFactor));
});

// Time controls
document.querySelectorAll('.time-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const speed = parseInt(btn.dataset.speed);
    gameState.speed = speed;
    document.querySelectorAll('.time-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

// Settings
document.getElementById('settingsBtn').addEventListener('click', () => {
  document.getElementById('settingsPanel').style.display = 'flex';
});

document.getElementById('closeSettings').addEventListener('click', () => {
  document.getElementById('settingsPanel').style.display = 'none';
});

// ============================================
// INITIALIZATION
// ============================================
document.getElementById('playBtn').addEventListener('click', async () => {
  document.getElementById('mainMenu').style.display = 'none';
  document.getElementById('gameView').style.display = 'block';
  
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  
  const seed = Date.now();
  await generatePlanet(seed);
  
  document.getElementById('progressUI').classList.add('hidden');
  document.getElementById('gameUI').style.display = 'block';
  
  initTribes();
  
  gameState.lastTick = performance.now();
  requestAnimationFrame(gameLoop);
});
