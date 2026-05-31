// =================================================
// Snowdon Towers 4D/5D Viewer — single master view
// Loads the merged "New Construction" master view (all elements aligned).
// =================================================

const DESIGN_URN = 'dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6dmFtc2ktc25vd2Rvbi0xNzgwMjMyMjk1MjEwL3Nub3dkb24tdG93ZXJzLXN0cnVjdHVyYWwucnZ0';
const MASTER_VIEW_NAME = 'New Construction';   // master view created by generateMasterViews:true
const ACTIVITY_PROPERTY = 'Custom 4D Phasing Set - ActivityID';
const DATA_URL = '/Phasing_4D.json';

const COLORS = {
  'completed-ontime': new THREE.Vector4(0.44, 0.68, 0.28, 1.0), // green
  'completed-late':   new THREE.Vector4(0.93, 0.49, 0.19, 1.0), // orange
  'inprogress':       new THREE.Vector4(1.00, 0.75, 0.00, 1.0), // yellow
  'delayed':          new THREE.Vector4(0.75, 0.00, 0.00, 1.0), // red
  'future':           null,                                      // hide
};
const GHOST_COLOR = new THREE.Vector4(0.6, 0.6, 0.7, 0.12);     // soft ghost gray
let ghostMode = false;  // toggle: when true, show future as ghost instead of hidden

let viewer = null;
let phasingData = null;
let activityMap = null;
let currentDate = null;
let playInterval = null;

// ---------- bootstrapping ----------
Autodesk.Viewing.Initializer({ getAccessToken }, async () => {
  viewer = new Autodesk.Viewing.GuiViewer3D(document.getElementById('preview'));
  viewer.start();
  viewer.setTheme('light-theme');
  viewer.setGhosting(false);   // disable APS auto-wireframe of hidden elements
  viewer.setQualityLevel(true, true);   // ambient occlusion + antialias for polish

  Autodesk.Viewing.Document.load(
    'urn:' + DESIGN_URN,
    async (doc) => {
      // Find all 3D viewables, prefer the master view
      const viewables = doc.getRoot().search({ type: 'geometry', role: '3d' });
      console.log('Available 3D views:');
      viewables.forEach(v => console.log('  •', v.data.name, '(guid:', v.data.guid + ')'));

      let target = viewables.find(v => v.data.name === MASTER_VIEW_NAME);
      if (!target) {
        // Fallback — pick whatever is not a discipline-only view, else first
        target = viewables.find(v => !v.data.name.startsWith('Structure ')) || viewables[0];
        console.warn('Master view "' + MASTER_VIEW_NAME + '" not found — using:', target.data.name);
      } else {
        console.log('✅ Loading master view:', target.data.name);
      }

      await viewer.loadDocumentNode(doc, target);
    },
    (code, msg) => alert('Could not load model. Code ' + code + ': ' + msg)
  );

  viewer.addEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, async () => {
    console.log('Geometry loaded. Building activity map...');
    phasingData = await fetch(DATA_URL).then(r => r.json());
    activityMap = await getActivityMap(viewer.model, ACTIVITY_PROPERTY);

    diagnostic();
    initUI();
    setDate(new Date(phasingData.dataDate));
  });
});

async function getAccessToken(cb) {
  const r = await fetch('/api/auth/token');
  const { access_token, expires_in } = await r.json();
  cb(access_token, expires_in);
}

// ---------- read ActivityID property from model ----------
async function getActivityMap(model, propertyName) {
  function userFn(pdb, attrName) {
    const map = new Map();
    pdb.enumObjects(dbid => {
      const res = pdb.getObjectProperties(dbid, [attrName]);
      if (res && res.properties && res.properties.length > 0) {
        const v = res.properties[0].displayValue;
        if (v && String(v).trim() !== '') {
          const key = String(v).trim();
          const list = map.has(key) ? map.get(key) : [];
          list.push(dbid);
          map.set(key, list);
        }
      }
    });
    return map;
  }
  return model.getPropertyDb().executeUserFunction(userFn, propertyName);
}

function diagnostic() {
  console.log('===== DIAGNOSTIC =====');
  console.log('Unique ActivityIDs found in model:', activityMap.size);
  console.log('Expected ActivityIDs in JSON:', phasingData.activities.length);
  const inJson = new Set(phasingData.activities.map(a => a.id));
  const inMap  = new Set(activityMap.keys());
  console.log('In JSON not in model:', [...inJson].filter(x => !inMap.has(x)));
  console.log('In model not in JSON:', [...inMap].filter(x => !inJson.has(x)));
  const tally = {};
  let total = 0;
  for (const [aid, dbids] of activityMap) { tally[aid] = dbids.length; total += dbids.length; }
  console.log('Total mapped elements:', total);
  console.table(tally);
}

// ---------- UI init ----------
function initUI() {
  document.getElementById('kpi-project').textContent = phasingData.projectName;
  document.getElementById('kpi-start').textContent = fmtDate(phasingData.projectStart);
  document.getElementById('kpi-finish').textContent = fmtDate(phasingData.projectFinish);
  document.getElementById('kpi-budget').textContent = fmtMoney(phasingData.budgetTotal);

  const scrubber = document.getElementById('scrubber');
  const totalDays = daysBetween(phasingData.projectStart, phasingData.projectFinish);
  scrubber.min = 0;
  scrubber.max = totalDays;
  scrubber.value = daysBetween(phasingData.projectStart, phasingData.dataDate);
  scrubber.oninput = () => {
    const d = addDays(phasingData.projectStart, parseInt(scrubber.value));
    setDate(d);
  };

  const ticksEl = document.getElementById('scrubber-ticks');
  let cur = new Date(phasingData.projectStart);
  cur.setDate(1);
  while (cur <= new Date(phasingData.projectFinish)) {
    const span = document.createElement('span');
    span.textContent = cur.toLocaleString('en', { month: 'short' });
    ticksEl.appendChild(span);
    cur.setMonth(cur.getMonth() + 1);
  }

  const di = document.getElementById('data-date-input');
  di.value = phasingData.dataDate;
  di.onchange = () => setDate(new Date(di.value));

  document.getElementById('btn-rewind').onclick    = () => setDate(new Date(phasingData.projectStart));
  document.getElementById('btn-end').onclick       = () => setDate(new Date(phasingData.projectFinish));
  document.getElementById('btn-step-back').onclick = () => setDate(addDays(currentDate, -1));
  document.getElementById('btn-step-fwd').onclick  = () => setDate(addDays(currentDate,  1));
  document.getElementById('btn-play').onclick      = togglePlay;

  document.getElementById('btn-ghost').onclick = () => {
    ghostMode = !ghostMode;
    document.getElementById('btn-ghost').classList.toggle('active', ghostMode);
    applyColors();
  };

  // Mobile drawer toggle
  const openDrawer  = () => document.body.classList.add('drawer-open');
  const closeDrawer = () => document.body.classList.remove('drawer-open');
  document.getElementById('btn-menu').onclick = openDrawer;
  document.getElementById('btn-close-drawer').onclick = closeDrawer;
  document.getElementById('drawer-backdrop').onclick = closeDrawer;

  // Re-render activity strip on window resize (pxPerDay changes)
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => renderActivityStrip(), 200);
  });

  renderActivityStrip();
}

function togglePlay() {
  const btn = document.getElementById('btn-play');
  if (playInterval) {
    clearInterval(playInterval);
    playInterval = null;
    btn.textContent = '▶';
    btn.classList.remove('playing');
  } else {
    btn.textContent = '⏸';
    btn.classList.add('playing');
    const speed = parseInt(document.getElementById('speed').value);
    playInterval = setInterval(() => {
      const next = addDays(currentDate, 1);
      if (next > new Date(phasingData.projectFinish)) { togglePlay(); return; }
      setDate(next);
    }, speed);
  }
}

// ---------- date / state logic ----------
function setDate(date) {
  currentDate = date;
  document.getElementById('floating-date-label').textContent =
    fmtDate(date) + '  (Day ' + (daysBetween(phasingData.projectStart, date) + 1) + ')';
  document.getElementById('scrubber').value = daysBetween(phasingData.projectStart, date);
  document.getElementById('data-date-input').value = isoDate(date);
  applyColors();
  updateCountsAndKPIs();
  updateActivityStripDataLine();
  updateActiveList();
}

function computeStatus(act, date) {
  const pStart  = new Date(act.plannedStart);
  const pFinish = new Date(act.plannedFinish);
  const aStart  = act.actualStart  ? new Date(act.actualStart)  : null;
  const aFinish = act.actualFinish ? new Date(act.actualFinish) : null;

  if (aFinish && date >= aFinish) {
    return aFinish <= pFinish ? 'completed-ontime' : 'completed-late';
  }
  if (aStart && date >= aStart) {
    return date > pFinish ? 'delayed' : 'inprogress';
  }
  if (date >= pStart && !aStart) {
    return date > pFinish ? 'delayed' : 'inprogress';
  }
  return 'future';
}

function applyColors() {
  if (!viewer || !viewer.model) return;
  viewer.model.clearThemingColors();

  // 1) Collect all managed dbIds (have an ActivityID)
  const managed = new Set();
  for (const arr of activityMap.values()) for (const id of arr) managed.add(id);

  // 2) Hide everything first, then show only by activity status
  // Get ALL dbIds in the model
  const instanceTree = viewer.model.getInstanceTree();
  const allDbIds = [];
  if (instanceTree) {
    instanceTree.enumNodeChildren(instanceTree.getRootId(), id => {
      if (instanceTree.getChildCount(id) === 0) allDbIds.push(id);  // leaf nodes only
    }, true);
  }

  // Unmanaged elements (Revit site/grids/etc): hide always, OR ghost if toggle on
  const unmanaged = allDbIds.filter(id => !managed.has(id));
  if (unmanaged.length) {
    if (ghostMode) {
      viewer.show(unmanaged);
      for (const id of unmanaged) viewer.setThemingColor(id, GHOST_COLOR);
    } else {
      viewer.hide(unmanaged);
    }
  }

  // 3) For each activity, hide/ghost future / show + color other states
  for (const act of phasingData.activities) {
    const dbids = activityMap.get(act.id) || [];
    if (!dbids.length) continue;
    const status = computeStatus(act, currentDate);
    if (status === 'future') {
      if (ghostMode) {
        viewer.show(dbids);
        for (const id of dbids) viewer.setThemingColor(id, GHOST_COLOR);
      } else {
        viewer.hide(dbids);
      }
    } else {
      viewer.show(dbids);
      const color = COLORS[status];
      if (color) for (const id of dbids) viewer.setThemingColor(id, color);
    }
  }
}

function updateCountsAndKPIs() {
  const counts = { 'completed-ontime': 0, 'completed-late': 0, 'inprogress': 0, 'delayed': 0, 'future': 0 };
  let spent = 0, doneElems = 0, totalElems = 0;
  for (const act of phasingData.activities) {
    const s = computeStatus(act, currentDate);
    counts[s]++;
    totalElems += act.elementCount;
    if (s.startsWith('completed')) {
      doneElems += act.elementCount;
      spent += act.actualCost || act.budgetCost;
    } else if (s === 'inprogress' || s === 'delayed') {
      doneElems += Math.round(act.elementCount * (act.pctComplete / 100));
      spent += Math.round((act.actualCost || act.budgetCost) * (act.pctComplete / 100));
    }
  }
  document.getElementById('cnt-ontime').textContent  = counts['completed-ontime'];
  document.getElementById('cnt-late').textContent    = counts['completed-late'];
  document.getElementById('cnt-inprog').textContent  = counts['inprogress'];
  document.getElementById('cnt-delayed').textContent = counts['delayed'];
  document.getElementById('cnt-future').textContent  = counts['future'];
  document.getElementById('kpi-spent').textContent = fmtMoney(spent);
  document.getElementById('kpi-pct').textContent = Math.round(doneElems / totalElems * 100) + '%';
}

function updateActiveList() {
  const active = phasingData.activities.filter(a => {
    const s = computeStatus(a, currentDate);
    return s === 'inprogress' || s === 'delayed';
  });
  const el = document.getElementById('active-list');
  if (!active.length) { el.innerHTML = '<em>No active activities</em>'; return; }
  el.innerHTML = active.map(a => {
    const s = computeStatus(a, currentDate);
    return `<div class="active-item" style="border-left-color:${s === 'delayed' ? '#C00000' : '#FFC000'}">
      <div class="aid">${a.id}</div>
      <div class="meta">${a.name}<br>${a.pctComplete}% • ${a.resource}</div>
    </div>`;
  }).join('');
}

// ---------- activity strip ----------
function renderActivityStrip() {
  const strip = document.getElementById('activity-strip');
  const totalDays = daysBetween(phasingData.projectStart, phasingData.projectFinish);
  const widthPx = strip.clientWidth - 8;
  const pxPerDay = widthPx / totalDays;
  const rowH = 18;
  const rowEnds = [];
  const sorted = [...phasingData.activities].sort((a, b) => new Date(a.plannedStart) - new Date(b.plannedStart));
  for (const act of sorted) {
    const start = daysBetween(phasingData.projectStart, act.plannedStart);
    const end   = daysBetween(phasingData.projectStart, act.plannedFinish);
    let row = rowEnds.findIndex(e => e <= start);
    if (row === -1) { row = rowEnds.length; rowEnds.push(0); }
    rowEnds[row] = end + 1;
    act._row = row;
    act._startPx = start * pxPerDay;
    act._widthPx = Math.max(2, (end - start + 1) * pxPerDay);
  }
  strip.innerHTML = '';
  for (const act of sorted) {
    const bar = document.createElement('div');
    bar.className = 'act-bar s-' + computeStatus(act, currentDate || new Date(phasingData.dataDate));
    bar.style.left = act._startPx + 'px';
    bar.style.top  = (4 + act._row * (rowH + 2)) + 'px';
    bar.style.width = act._widthPx + 'px';
    bar.textContent = act.id;
    bar.title = `${act.id} — ${act.name}\nPlanned: ${act.plannedStart} → ${act.plannedFinish}\n${act.elementCount} elements`;
    bar.dataset.aid = act.id;
    bar.onclick = () => {
      const dbids = activityMap?.get(act.id) || [];
      if (dbids.length) {
        viewer.isolate(dbids);
        viewer.fitToView(dbids);
      }
    };
    strip.appendChild(bar);
  }
  const line = document.createElement('div');
  line.className = 'data-date-line';
  line.id = 'data-date-line';
  strip.appendChild(line);
  updateActivityStripDataLine();
}

function updateActivityStripDataLine() {
  const strip = document.getElementById('activity-strip');
  if (!strip || !currentDate) return;
  const totalDays = daysBetween(phasingData.projectStart, phasingData.projectFinish);
  const widthPx = strip.clientWidth - 8;
  const pxPerDay = widthPx / totalDays;
  const x = daysBetween(phasingData.projectStart, currentDate) * pxPerDay;
  const line = document.getElementById('data-date-line');
  if (line) line.style.left = (4 + x) + 'px';
  for (const bar of strip.querySelectorAll('.act-bar')) {
    const act = phasingData.activities.find(a => a.id === bar.dataset.aid);
    if (!act) continue;
    bar.className = 'act-bar s-' + computeStatus(act, currentDate);
  }
}

// ---------- helpers ----------
function isoDate(d) {
  const yr = d.getFullYear(), mo = String(d.getMonth() + 1).padStart(2, '0'), da = String(d.getDate()).padStart(2, '0');
  return `${yr}-${mo}-${da}`;
}
function fmtDate(d) {
  const dt = (d instanceof Date) ? d : new Date(d);
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtMoney(n) { return '$' + Math.round(n).toLocaleString(); }
function daysBetween(a, b) {
  const da = (a instanceof Date) ? a : new Date(a);
  const db = (b instanceof Date) ? b : new Date(b);
  return Math.round((db - da) / 86400000);
}
function addDays(d, n) {
  const dt = new Date(d);
  dt.setDate(dt.getDate() + n);
  return dt;
}
