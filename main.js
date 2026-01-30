// main.js - Planet map generator
// Drop-in file. Designed for incremental generation to avoid browser freeze.

// ---------- Config & Utils ----------
const canvas = document.getElementById('mapCanvas');
const ctx = canvas.getContext('2d');

function fitCanvas() {
  // make canvas a large working area but scale down to fit view
  const wrap = document.getElementById('canvasWrap');
  const w = Math.min(window.innerWidth - 480, 1800);
  const h = Math.min(window.innerHeight - 120, 900);
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  // actual bitmap size will match map resolution (set later)
}
window.addEventListener('resize', fitCanvas);
fitCanvas();

function setProgress(p, text){
  document.getElementById('progressBar').style.width = `${Math.floor(p*100)}%`;
  document.getElementById('progressText').innerText = text || '';
}

// Simple seeded PRNG - mulberry32
function makeRng(seed){
  let s = xfnv1a(seed.toString())(); // use string hash -> uint32
  return function(){
    s |= 0;
    s = (s + 0x6D2B79F5) | 0;
    var t = Math.imul(s ^ s >>> 15, 1 | s);
    t = (t + Math.imul(t ^ t >>> 7, 61 | t)) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
}
// xfnv1a hash
function xfnv1a(str) {
  for(var i=0,h=2166136261>>>0;i<str.length;i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return function() { return h; }
}

// Simple 2D value-noise and fBm (no external libs)
function makeNoise2D(rng){
  // gradient grid method
  const grad = {};
  function randGrad(ix,iy){
    const key = ix + ',' + iy;
    if(grad[key]) return grad[key];
    const a = rng()*Math.PI*2;
    grad[key] = {x: Math.cos(a), y: Math.sin(a)};
    return grad[key];
  }
  function dotGridGradient(ix,iy,x,y){
    const g = randGrad(ix,iy);
    const dx = x - ix, dy = y - iy;
    return g.x*dx + g.y*dy;
  }
  function smootherstep(t){ return t*t*t*(t*(t*6-15)+10); }
  function perlin(x,y){
    const x0 = Math.floor(x), x1 = x0+1;
    const y0 = Math.floor(y), y1 = y0+1;
    const sx = smootherstep(x - x0);
    const sy = smootherstep(y - y0);
    const n0 = dotGridGradient(x0,y0,x,y);
    const n1 = dotGridGradient(x1,y0,x,y);
    const ix0 = n0 + (n1 - n0) * sx;
    const n2 = dotGridGradient(x0,y1,x,y);
    const n3 = dotGridGradient(x1,y1,x,y);
    const ix1 = n2 + (n3 - n2) * sx;
    return ix0 + (ix1 - ix0) * sy;
  }
  function fbm(x,y,octaves=5, lacunarity=2, gain=0.5){
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for(let i=0;i<octaves;i++){
      sum += perlin(x*freq, y*freq) * amp;
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }
  return {perlin, fbm};
}

// ---------- Map Generation Pipeline ----------

async function generateMap(settings, onProgress){
  // settings: {width,height,seaLevel,seed,erosion,rivers,plateCount}
  const rng = makeRng(settings.seed || (Math.floor(Math.random()*1e9).toString()));
  const noise = makeNoise2D(rng);
  const W = settings.width, H = settings.height;

  // Prepare typed arrays for memory efficiency
  const height = new Float32Array(W*H);
  const precipitation = new Float32Array(W*H);
  const temperature = new Float32Array(W*H);
  const river = new Float32Array(W*H);
  const biome = new Uint8Array(W*H); // index

  function idx(x,y){ return y*W + x; }

  // 1) Plate seeds to make continental shapes (voronoi-ish)
  onProgress(0.02, "Seeding plates...");
  const plates = [];
  const plateCount = settings.plateCount || Math.floor(10 + rng()*20);
  for(let i=0;i<plateCount;i++){
    plates.push({
      x: Math.floor(rng()*W),
      y: Math.floor(rng()*H),
      polarity: rng() > 0.5 ? 1 : -1, // uplift or subduct
      mvx: (rng()-0.5)*0.6,
      mvy: (rng()-0.5)*0.3
    });
  }

  // helper: distance to nearest plate and edge intensity
  function plateInfluence(x,y){
    // compute nearest and second nearest plate distance to find boundary
    let best = 1e9, second = 1e9, bi = 0;
    for(let p of plates){
      const dx = x - p.x, dy = (y - p.y)*1.2; // slight lat stretch
      const d = Math.hypot(dx, dy);
      if(d < best){ second = best; best = d; bi = p.polarity; }
      else if(d < second) second = d;
    }
    const boundary = Math.max(0, (second - best) / (W*0.25)); // higher at boundaries
    return {boundary, basePolarity: bi, nearestDist: best};
  }

  // 2) Base elevation using continent mask + fBm detail
  onProgress(0.08, "Generating base elevation...");
  const continentScale = 0.0009 * (W/1024); // bigger map -> adjust scale
  for(let y=0;y<H;y++){
    for(let x=0;x<W;x++){
      const i = idx(x,y);
      const plate = plateInfluence(x,y);
      // continental mask: low-frequency fbm to make large shapes
      const cx = x * continentScale, cy = y * continentScale;
      const continentalNoise = noise.fbm(cx + 100, cy + 200, 5, 2, 0.6) * 0.9 + 0.1*noise.fbm(cx*0.2, cy*0.2, 2);
      // uplift near plate boundaries
      const uplift = plate.boundary * 1.2 * plate.basePolarity;
      // terrain detail
      const detail = noise.fbm(x*0.006, y*0.006, 6, 2, 0.5) * 0.5;
      // polar flattening (ice caps)
      const lat = Math.abs((y/H)*2 - 1);
      const polar = Math.pow(lat,3);
      let elev = continentalNoise + uplift*0.6 + detail;
      // reduce elevation at poles less habitable but still produce ice
      elev -= polar*0.25;
      height[i] = elev;
    }
    if(y % 32 === 0) onProgress(0.08 + (y/H)*0.12, `Base elevation: ${(y/H*100)|0}%`);
    await sleepChunk();
  }

  // 3) Add mountains at strong uplift & noise peaks
  onProgress(0.22, "Shaping mountains and coastlines...");
  for(let y=0;y<H;y++){
    for(let x=0;x<W;x++){
      const i = idx(x,y);
      const plate = plateInfluence(x,y);
      const m = Math.max(0, plate.boundary - 0.2) * 1.6;
      height[i] += m * (0.8 + noise.fbm(x*0.02,y*0.02,3)*0.6);
    }
    if(y % 48 === 0) onProgress(0.22 + (y/H)*0.08, `Mountain shaping: ${(y/H*100)|0}%`);
    await sleepChunk();
  }

  // 4) Sea-level threshold & early smoothing
  const seaLevel = settings.seaLevel || 0.55;
  onProgress(0.32, "Applying coastline smoothing...");
  // normalize heights
  let minH = 1e9, maxH = -1e9;
  for(let i=0;i<W*H;i++){ minH = Math.min(minH, height[i]); maxH = Math.max(maxH, height[i]); }
  const rngRange = maxH - minH || 1;
  for(let i=0;i<W*H;i++) height[i] = (height[i] - minH) / rngRange;

  // small smoothing pass
  for(let pass=0; pass<2; pass++){
    const newH = new Float32Array(W*H);
    for(let y=0;y<H;y++){
      for(let x=0;x<W;x++){
        let sum = 0, cnt = 0;
        for(let oy=-1; oy<=1; oy++){
          for(let ox=-1; ox<=1; ox++){
            const nx = wrapX(x+ox, W), ny = clampY(y+oy, H);
            sum += height[idx(nx,ny)]; cnt++;
          }
        }
        newH[idx(x,y)] = sum/cnt;
      }
      if(y%64===0) onProgress(0.32 + (pass*0.04) + (y/H)*0.04, `Coast smoothing pass ${pass+1}: ${(y/H*100)|0}%`);
      await sleepChunk();
    }
    for(let i=0;i<W*H;i++) height[i] = newH[i];
  }

  // 5) Thermal erosion (optional heavier smoothing)
  if(settings.erosion){
    onProgress(0.42, "Applying erosion (this can take time)...");
    const iterations = Math.min(200, Math.max(30, Math.floor((W*H)/20000)));
    for(let it=0; it<iterations; it++){
      // simple erosion: move small amount from higher to lower neighbors
      const newH = new Float32Array(W*H);
      newH.set(height);
      for(let y=0;y<H;y++){
        for(let x=0;x<W;x++){
          const i = idx(x,y);
          let h = height[i];
          // find lowest neighbor
          let lowest = h, lx=x, ly=y;
          for(let oy=-1; oy<=1; oy++){
            for(let ox=-1; ox<=1; ox++){
              if(ox===0 && oy===0) continue;
              const nx = wrapX(x+ox,W), ny = clampY(y+oy,H);
              const nh = height[idx(nx,ny)];
              if(nh < lowest){ lowest = nh; lx = nx; ly = ny; }
            }
          }
          const dh = h - lowest;
          if(dh > 0.01){
            const move = dh * 0.25 * 0.5; // erosion factor
            newH[i] -= move;
            newH[idx(lx,ly)] += move;
          }
        }
        if(y%64===0) onProgress(0.42 + (it/iterations)*0.18 + (y/H)*0.18, `Erosion ${it+1}/${iterations} row ${(y/H*100)|0}%`);
        await sleepChunk();
      }
      height.set(newH);
    }
  }

  // 6) Temperature & precipitation (latitude + orographic)
  onProgress(0.62, "Calculating climate (temperature & precipitation)...");
  for(let y=0;y<H;y++){
    const latFactor = 1 - Math.abs((y/H)*2 - 1); // 1 at equator -> 0 at poles
    for(let x=0;x<W;x++){
      const i = idx(x,y);
      // base temperature from latitude and elevation
      const baseTemp = latFactor * 1.2 - height[i]*0.8;
      // add noise
      const t = baseTemp + noise.fbm(x*0.003,y*0.003,4)*0.1;
      temperature[i] = clamp(t, -1, 1);
    }
    if(y%32===0) onProgress(0.62 + (y/H)*0.08, `Temperature ${(y/H*100)|0}%`);
    await sleepChunk();
  }

  // precipitation: coastal moisture + wind + orographic rain
  for(let y=0;y<H;y++){
    for(let x=0;x<W;x++){
      const i = idx(x,y);
      // base from low-frequency noise
      let p = noise.fbm(x*0.005,y*0.005,4)*0.6 + 0.4;
      // proximity to coast increases precipitation (coastal moisture)
      let coastDist = distanceToSea(x,y,height,W,H);
      p *= Math.exp(-coastDist/80); // more near coasts
      // orographic: if windward of mountain, add rain; simple check: neighbor upslope in lat-long direction
      const mountainEffect = computeOrographic(x,y,height,W,H);
      p += mountainEffect * 0.8;
      precipitation[idx(x,y)] = clamp(p, 0, 1.8);
    }
    if(y%48===0) onProgress(0.70 + (y/H)*0.05, `Precipitation ${(y/H*100)|0}%`);
    await sleepChunk();
  }

  // 7) Rivers (flow accumulation)
  if(settings.rivers){
    onProgress(0.75, "Tracing rivers (flow accumulation)...");
    // compute flow direction (steepest descent)
    const flowDir = new Int8Array(W*H); // store dx,dy as small codes or -1 for sink
    for(let y=0;y<H;y++){
      for(let x=0;x<W;x++){
        const i = idx(x,y);
        let bestH = height[i], bx=x, by=y;
        for(let oy=-1; oy<=1; oy++){
          for(let ox=-1; ox<=1; ox++){
            if(ox===0 && oy===0) continue;
            const nx = wrapX(x+ox,W), ny = clampY(y+oy,H);
            const nh = height[idx(nx,ny)];
            if(nh < bestH){ bestH = nh; bx=nx; by=ny; }
          }
        }
        if(bx===x && by===y) flowDir[i] = 0; // sink/no flow
        else{
          // encode direction into int (dx + dy*5) offset by +12 to fit -ve
          const dx = bx - x, dy = by - y;
          // normalize dx for wrap
          const dxWrapped = dx > W/2 ? dx - W : dx < -W/2 ? dx + W : dx;
          flowDir[i] = dxWrapped + dy*7; // crude encode
        }
      }
    }
    // accumulate
    const accumulation = new Float32Array(W*H);
    // initialize with precipitation weight
    for(let i=0;i<W*H;i++) accumulation[i] = precipitation[i] * 1.0 + 0.001;
    // propagate accumulation downhill multiple passes
    for(let pass=0; pass<6; pass++){
      for(let y=0;y<H;y++){
        for(let x=0;x<W;x++){
          const i = idx(x,y);
          const fd = flowDir[i];
          if(fd===0) continue;
          // decode dx,dy approx (reverse of encode)
          // we try neighbor offsets from -3..3 to find actual target by checking neighbors for lower height
          let tx=x, ty=y, bestFound=false;
          for(let oy=-1; oy<=1; oy++){
            for(let ox=-1; ox<=1; ox++){
              const nx = wrapX(x+ox,W), ny = clampY(y+oy,H);
              if(height[idx(nx,ny)] < height[i] - 1e-6){
                // send accumulation to first lower neighbor found (approx)
                accumulation[idx(nx,ny)] += accumulation[i]*0.25;
                accumulation[i] *= 0.75;
                bestFound = true;
                break;
              }
            }
            if(bestFound) break;
          }
        }
      }
      onProgress(0.75 + (pass/6)*0.07, `River accumulation pass ${pass+1}/6`);
      await sleepChunk();
    }
    // mark river pixels above threshold
    for(let i=0;i<W*H;i++){
      river[i] = accumulation[i] > 1.2 ? accumulation[i] : 0;
    }
  }

  // 8) Biome classification
  onProgress(0.85, "Classifying biomes...");
  for(let y=0;y<H;y++){
    for(let x=0;x<W;x++){
      const i = idx(x,y);
      const h = height[i];
      const t = (temperature[i] + 1)/2; // 0..1
      const p = precipitation[i]; // 0..~1.8
      // elevation bands
      if(h < settings.seaLevel - 0.02){ biome[i] = 0; } // ocean
      else if(h > 0.85) biome[i] = 6; // high mountains
      else if(t < 0.18) biome[i] = 7; // polar / ice
      else {
        // desert if low precip
        if(p < 0.16) biome[i] = 1;
        // grassland
        else if(p < 0.4) biome[i] = 2;
        // temperate forest
        else if(p < 0.9) biome[i] = 3;
        // rainforest
        else biome[i] = 4;
      }
    }
    if(y%48===0) onProgress(0.85 + (y/H)*0.08, `Biomes ${(y/H*100)|0}%`);
    await sleepChunk();
  }

  // 9) Final normalization and rendering
  onProgress(0.95, "Finalizing and rendering...");
  await drawMapChunked(height, temperature, precipitation, river, biome, W, H, settings);

  onProgress(1.0, "Complete");
  return {height, temperature, precipitation, river, biome, width: W, heightPx: H};
}

// ---------- Helper & rendering functions ----------

function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
function wrapX(x,W){ if(x<0) return x+W; if(x>=W) return x-W; return x; }
function clampY(y,H){ if(y<0) return 0; if(y>=H) return H-1; return y; }
function sleepChunk(){ return new Promise(r => setTimeout(r, 0)); }

// approximate distance to sea (number of steps to a pixel under sea); used for coastal moisture
function distanceToSea(sx,sy,heightArr,W,H){
  const threshold = 0.55;
  // BFS outward up to limit
  const maxDist = 120;
  const q = [[sx,sy,0]];
  const seen = new Set();
  while(q.length){
    const [x,y,d] = q.shift();
    const k = x+','+y;
    if(seen.has(k)) continue;
    seen.add(k);
    if(heightArr[y*W + x] < threshold) return d;
    if(d >= maxDist) continue;
    for(let oy=-1; oy<=1; oy++){
      for(let ox=-1; ox<=1; ox++){
        if(ox===0 && oy===0) continue;
        const nx = wrapX(x+ox,W), ny = clampY(y+oy,H);
        q.push([nx,ny,d+1]);
      }
    }
  }
  return maxDist;
}

// simple orographic estimate: check neighbor upslope in prevailing wind (east->west simplification)
function computeOrographic(x,y,heightArr,W,H){
  // check mountain to west or east and add effect
  const i = y*W + x;
  const h = heightArr[i];
  const neighbors = [
    wrapX(x-1,W), wrapX(x+1,W)
  ];
  // stronger if neighbor higher
  let sum = 0;
  for(let nx of neighbors){
    const nh = heightArr[y*W + nx];
    if(nh > h) sum += (nh - h);
  }
  return clamp(sum*1.2, 0, 1.0);
}

// Color palette & map drawing (chunked)
async function drawMapChunked(heightA, tempA, precipA, riverA, biomeA, W, H, settings){
  // set actual canvas bitmap size to map size, but scaled display via CSS (keeps detail)
  canvas.width = W;
  canvas.height = H;

  // prepare imageData
  const img = ctx.createImageData(W, H);
  const data = img.data;

  function setPixel(x,y,r,g,b,a=255){
    const p = (y*W + x)*4;
    data[p] = r; data[p+1] = g; data[p+2] = b; data[p+3] = a;
  }

  for(let y=0;y<H;y++){
    for(let x=0;x<W;x++){
      const i = y*W + x;
      const h = heightA[i];
      const bi = biomeA[i];
      // color oceans
      if(h < settings.seaLevel - 0.02){
        // deep -> shallow
        const depth = clamp((settings.seaLevel - h)/0.4, 0, 1);
        const r = Math.floor(8 + 24*(1-depth));
        const g = Math.floor(20 + 60*(1-depth));
        const b = Math.floor(80 + 120*(1-depth));
        setPixel(x,y, r, g, b);
        continue;
      }
      // land biomes
      if(bi === 1){ // desert
        const t = 210 + (heightA[i]*20)|0;
        setPixel(x,y, t, 185, 115);
      } else if(bi === 2){ // grass
        const g = 100 + (precipA[i]*60)|0;
        setPixel(x,y, 80, g, 50);
      } else if(bi === 3){ // forest temperate
        const g = 90 + (precipA[i]*80)|0;
        setPixel(x,y, 40, g, 30);
      } else if(bi === 4){ // rainforest
        const g = 120 + (precipA[i]*80)|0;
        setPixel(x,y, 35, g, 40);
      } else if(bi === 6){ // mountains
        const v = 180 + (h*40)|0;
        setPixel(x,y, v, v, v);
      } else if(bi === 7){ // polar
        setPixel(x,y, 240, 245, 250);
      } else {
        // fallback
        setPixel(x,y, 90,120,70);
      }
      // rivers overlay
      if(riverA && riverA[i] > 0.001){
        // blend in blue streaks (simple)
        data[(i*4)+0] = Math.floor((data[(i*4)+0]*0.25) + 20);
        data[(i*4)+1] = Math.floor((data[(i*4)+1]*0.25) + 60);
        data[(i*4)+2] = Math.floor((data[(i*4)+2]*0.2) + 180);
      }
    }
    if(y % 64 === 0) setProgress(0.95 + (y/H)*0.04, `Rendering ${y}/${H}`);
    await sleepChunk();
  }

  ctx.putImageData(img, 0, 0);
  // scale to fit via CSS (we already set CSS scale)
  // center fit handled by container
}

// ---------- UI / Bindings ----------

const presetEl = document.getElementById('preset');
const seedInput = document.getElementById('seedInput');
const generateBtn = document.getElementById('generateBtn');
const randomSeedBtn = document.getElementById('randomSeedBtn');
const seaLevelEl = document.getElementById('seaLevel');
const seaVal = document.getElementById('seaVal');
const erosionToggle = document.getElementById('erosionToggle');
const riversToggle = document.getElementById('riversToggle');

seaLevelEl.addEventListener('input', ()=> seaVal.innerText = seaLevelEl.value);

randomSeedBtn.addEventListener('click', ()=>{
  const s = Math.floor(Math.random()*1e9).toString();
  seedInput.value = s;
});

generateBtn.addEventListener('click', async ()=>{
  generateBtn.disabled = true;
  const preset = presetEl.value;
  // presets
  let W = 512, H = 256;
  if(preset === 'planet'){ W = 2048; H = 1024; }
  const settings = {
    width: W,
    height: H,
    seaLevel: parseFloat(seaLevelEl.value),
    seed: seedInput.value || Math.floor(Math.random()*1e9).toString(),
    erosion: erosionToggle.checked,
    rivers: riversToggle.checked,
    plateCount: Math.floor(10 + Math.random()*25)
  };
  setProgress(0, 'Starting...');
  // chunked generation so UI remains responsive
  try{
    await generateMap(settings, (p,t)=> setProgress(p,t));
  }catch(err){
    console.error(err);
    setProgress(0, 'Error: ' + err.message);
  } finally {
    generateBtn.disabled = false;
  }
});

// ---------- Example small helper to pre-generate quickly on load ----------
window.addEventListener('load', ()=>{
  // auto-generate dev map on first open
  if(!localStorage.getItem('map_generated_once')){
    localStorage.setItem('map_generated_once','1');
    seedInput.value = Math.floor(Math.random()*1e9).toString();
    document.getElementById('preset').value = 'dev';
    generateBtn.click();
  }
});
