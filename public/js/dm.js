const SKILL_ABILITIES = [
  { name: 'Acrobatics',      ability: 'DEX' },
  { name: 'Animal Handling',  ability: 'WIS' },
  { name: 'Arcana',          ability: 'INT' },
  { name: 'Athletics',       ability: 'STR' },
  { name: 'Deception',       ability: 'CHA' },
  { name: 'History',         ability: 'INT' },
  { name: 'Insight',         ability: 'WIS' },
  { name: 'Intimidation',    ability: 'CHA' },
  { name: 'Investigation',   ability: 'INT' },
  { name: 'Medicine',        ability: 'WIS' },
  { name: 'Nature',          ability: 'INT' },
  { name: 'Perception',      ability: 'WIS' },
  { name: 'Performance',     ability: 'CHA' },
  { name: 'Persuasion',      ability: 'CHA' },
  { name: 'Religion',        ability: 'INT' },
  { name: 'Sleight of Hand', ability: 'DEX' },
  { name: 'Stealth',         ability: 'DEX' },
  { name: 'Survival',        ability: 'WIS' }
];

function calcProfBonus(level) {
  return Math.ceil(level / 4) + 1;
}

function getProficiencyBonus() {
  const level = parseInt(document.getElementById('f-level')?.value) || 1;
  return calcProfBonus(level);
}

function getAbilityMod(ability) {
  const score = parseInt(document.getElementById(`f-${ability}`)?.value) || 10;
  return Math.floor((score - 10) / 2);
}

let currentSession = null; // { pin, characters: { id: { claimedBy } } }
let dmPeer = null; // PeerJS host instance
let allSpells = [];
let selectedSpells = [];
let allFeatures = [];
let selectedFeatures = [];
let allEquipment = [];
let allMonsters = [];
let battlefieldMonsters = [];
let treasurePool = [];
let allCharacters = [];
let shops = [];
let characterHPState = {};
let bfCharactersCache = [];

// --- Init ---
document.addEventListener('DOMContentLoaded', async () => {
  // --- Register all event listeners first (synchronous) ---
  populateDropdowns();
  renderSavingThrows();
  renderSkillInputs();

  document.getElementById('btn-new-session').addEventListener('click', createSession);
  document.getElementById('btn-show-qr').addEventListener('click', showQR);
  document.getElementById('btn-end-session').addEventListener('click', endSession);
  document.getElementById('btn-add-char').addEventListener('click', () => openCharModal());
  document.getElementById('char-form').addEventListener('submit', saveCharacter);

  // Workspace
  document.getElementById('btn-save-workspace').addEventListener('click', saveWorkspace);
  document.getElementById('load-workspace-file').addEventListener('change', loadWorkspace);
  document.getElementById('btn-clear-workspace').addEventListener('click', clearWorkspace);

  // Recalculate skills and saving throws when abilities or level change
  ['STR','DEX','CON','INT','WIS','CHA'].forEach(a => {
    document.getElementById(`f-${a}`).addEventListener('input', () => {
      updateSkillModifiers();
      updateSavingThrows();
    });
  });
  document.getElementById('f-level').addEventListener('input', () => {
    updateSkillModifiers();
    updateSavingThrows();
  });

  document.getElementById('f-class').addEventListener('change', () => {
    renderSavingThrows();
    autoSetHP();
  });
  document.getElementById('f-CON').addEventListener('input', autoSetHP);

  // Feature search
  document.getElementById('feature-search').addEventListener('input', filterFeatures);
  document.getElementById('feature-source-filter').addEventListener('change', filterFeatures);
  document.getElementById('f-class').addEventListener('change', filterFeatures);
  document.getElementById('f-species').addEventListener('change', filterFeatures);
  document.getElementById('f-level').addEventListener('input', filterFeatures);

  // DM page tabs
  document.querySelectorAll('.tabs .tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tabs .tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(tab.dataset.tab).classList.add('active');
      if (tab.dataset.tab === 'dm-tab-battlefield') renderBattlefieldCharacters();
    });
  });

  // Battlefield
  document.getElementById('monster-search').addEventListener('input', filterMonsters);
  document.getElementById('monster-type-filter').addEventListener('change', filterMonsters);
  document.getElementById('monster-cr-filter').addEventListener('change', filterMonsters);
  document.getElementById('btn-clear-battlefield').addEventListener('click', clearBattlefield);
  document.getElementById('btn-add-monsters').addEventListener('click', () => {
    document.getElementById('monster-search-modal').classList.add('active');
    document.getElementById('monster-search').focus();
  });

  // Treasures
  document.getElementById('treasure-search').addEventListener('input', filterTreasureSearch);
  document.getElementById('treasure-type-filter').addEventListener('change', filterTreasureSearch);
  document.getElementById('btn-clear-treasures').addEventListener('click', clearTreasures);
  document.getElementById('btn-add-items').addEventListener('click', () => {
    document.getElementById('treasure-search-modal').classList.add('active');
    document.getElementById('treasure-search').focus();
  });

  // Shops
  document.getElementById('btn-create-shop').addEventListener('click', createShop);

  // Equipment search
  document.getElementById('equip-search').addEventListener('input', filterEquipment);
  document.getElementById('equip-type-filter').addEventListener('change', filterEquipment);

  // Spell search
  document.getElementById('spell-search').addEventListener('input', filterSpells);
  document.getElementById('spell-level-filter').addEventListener('change', filterSpells);
  document.getElementById('spell-class-filter').addEventListener('change', filterSpells);

  // Compendium (top bar search)
  const topBarSearch = document.getElementById('top-bar-search');
  const topBarDropdown = document.getElementById('top-bar-dropdown');
  topBarSearch.addEventListener('input', () => { openSearchDropdown(); filterCompendium(); });
  topBarSearch.addEventListener('focus', () => { openSearchDropdown(); filterCompendium(); });
  document.getElementById('compendium-category').addEventListener('change', filterCompendium);
  document.getElementById('compendium-spell-level').addEventListener('change', filterCompendium);
  document.getElementById('compendium-spell-class').addEventListener('change', filterCompendium);
  document.getElementById('compendium-monster-type').addEventListener('change', filterCompendium);
  document.getElementById('compendium-monster-cr').addEventListener('change', filterCompendium);
  document.getElementById('compendium-feature-source').addEventListener('change', filterCompendium);
  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    const wrap = document.querySelector('.top-bar-search-wrap');
    if (wrap && !wrap.contains(e.target)) closeSearchDropdown();
  });
  topBarSearch.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeSearchDropdown(); topBarSearch.blur(); }
  });

  // Notes
  const notesEditor = document.getElementById('notes-editor');
  let notesSaveTimeout = null;
  notesEditor.addEventListener('input', () => {
    document.getElementById('notes-save-status').textContent = 'Unsaved changes...';
    clearTimeout(notesSaveTimeout);
    notesSaveTimeout = setTimeout(saveNotes, 1000);
  });

  // --- Load data asynchronously (errors won't break UI) ---
  try {
    loadCharacters();
    await Promise.all([loadSpellsDB(), loadFeaturesDB(), loadEquipmentDB(), loadMonstersDB()]);
    populateCompendiumMonsterFilters();
    await loadBattlefield();
    await loadCharacterHP();
    await loadTreasures();
    await loadShops();
    loadNotes();
  } catch (e) {
    console.error('Error loading data:', e);
  }
});

// --- Dialog helpers (replaces alert/confirm) ---
const DIALOG_ICONS = {
  warn: '\u26A0',
  info: '\u2139\uFE0F',
  success: '\u2714',
  error: '\u2718'
};

function showDialog({ title, message, type = 'info', buttons = ['OK'] }) {
  return new Promise(resolve => {
    const overlay = document.getElementById('dialog-overlay');
    const iconEl = document.getElementById('dialog-icon');
    const titleEl = document.getElementById('dialog-title');
    const msgEl = document.getElementById('dialog-message');
    const btnsEl = document.getElementById('dialog-buttons');

    iconEl.textContent = DIALOG_ICONS[type] || DIALOG_ICONS.info;
    iconEl.className = 'dialog-icon ' + type;
    titleEl.textContent = title || '';
    msgEl.textContent = message || '';

    btnsEl.innerHTML = buttons.map((label, i) => {
      const isPrimary = i === buttons.length - 1;
      const isDanger = type === 'warn' && isPrimary && buttons.length > 1;
      let cls = 'btn btn-small ';
      if (isDanger) cls += 'btn-danger';
      else if (isPrimary) cls += 'btn-primary';
      else cls += 'btn-secondary';
      return `<button class="${cls}" data-dialog-idx="${i}">${esc(label)}</button>`;
    }).join('');

    btnsEl.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        overlay.classList.remove('active');
        resolve(btn.dataset.dialogIdx === String(buttons.length - 1));
      });
    });

    overlay.classList.add('active');
  });
}

function dialogAlert(message, title, type = 'info') {
  return showDialog({ title: title || (type === 'error' ? 'Error' : type === 'success' ? 'Success' : 'Notice'), message, type });
}

function dialogConfirm(message, title) {
  return showDialog({ title: title || 'Confirm', message, type: 'warn', buttons: ['Cancel', 'Confirm'] });
}

function dialogPrompt(message, title, defaultValue) {
  return new Promise(resolve => {
    const overlay = document.getElementById('dialog-overlay');
    const iconEl = document.getElementById('dialog-icon');
    const titleEl = document.getElementById('dialog-title');
    const msgEl = document.getElementById('dialog-message');
    const btnsEl = document.getElementById('dialog-buttons');

    iconEl.textContent = DIALOG_ICONS.info;
    iconEl.className = 'dialog-icon info';
    titleEl.textContent = title || 'Input';
    msgEl.textContent = message || '';

    btnsEl.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:10px;width:100%;">
        <input type="text" id="dialog-prompt-input" value="${esc(defaultValue || '')}"
          style="width:100%;box-sizing:border-box;padding:8px 12px;background:var(--bg-input);color:var(--text);border:1px solid var(--border);border-radius:6px;font-family:var(--font-body);font-size:1rem;">
        <div style="display:flex;gap:10px;justify-content:center;">
          <button class="btn btn-secondary btn-small">Cancel</button><button class="btn btn-primary btn-small">Save</button>
        </div>
      </div>`;
    const wrapper = btnsEl.querySelector('div > div');

    const input = document.getElementById('dialog-prompt-input');
    input.select();

    const close = (value) => { overlay.classList.remove('active'); resolve(value); };
    wrapper.children[0].addEventListener('click', () => close(null));
    wrapper.children[1].addEventListener('click', () => close(input.value.trim()));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') close(input.value.trim());
      if (e.key === 'Escape') close(null);
    });

    overlay.classList.add('active');
    input.focus();
  });
}

// --- Workspace ---
async function saveWorkspace() {
  const defaultName = `dnd-workspace-${new Date().toISOString().slice(0,10)}`;
  const filename = await dialogPrompt('Enter a filename for the workspace:', 'Save Workspace', defaultName);
  if (!filename) return;

  const json = await db.exportAll();
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.json') ? filename : filename + '.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function loadWorkspace(event) {
  const file = event.target.files[0];
  if (!file) return;
  event.target.value = '';
  if (!await dialogConfirm('This will replace ALL current data. Are you sure?', 'Load Workspace')) return;
  try {
    const text = await file.text();
    await db.importAll(text);
    await dialogAlert('Workspace loaded successfully. Reloading...', 'Success', 'success');
    window.location.reload();
  } catch (e) {
    await dialogAlert('Failed to load workspace: ' + e.message, 'Error', 'error');
  }
}

async function clearWorkspace() {
  if (!await dialogConfirm('This will delete ALL characters, battlefield, treasures, shops, and notes.', 'Clear Workspace')) return;
  if (!await dialogConfirm('This cannot be undone. Continue?', 'Are you sure?')) return;
  try {
    await db.importAll(JSON.stringify({ version: 1, characters: [] }));
    await dialogAlert('Workspace cleared. Reloading...', 'Success', 'success');
    window.location.reload();
  } catch (e) {
    await dialogAlert('Failed to clear workspace: ' + e.message, 'Error', 'error');
  }
}

// --- Dropdowns ---
function populateDropdowns() {
  const classSelect = document.getElementById('f-class');
  classSelect.innerHTML = '<option value="">Select class...</option>' +
    CLASSES.map(c => `<option value="${c}">${c}</option>`).join('');

  const speciesSelect = document.getElementById('f-species');
  speciesSelect.innerHTML = '<option value="">Select species...</option>' +
    SPECIES.map(s => `<option value="${s}">${s}</option>`).join('');

  const bgSelect = document.getElementById('f-background');
  bgSelect.innerHTML = '<option value="">Select background...</option>' +
    BACKGROUNDS.map(b => `<option value="${b}">${b}</option>`).join('') +
    '<option value="__custom__">+ Add Custom</option>';
  bgSelect.addEventListener('change', () => {
    const customInput = document.getElementById('f-background-custom');
    if (bgSelect.value === '__custom__') {
      customInput.style.display = '';
      customInput.focus();
    } else {
      customInput.style.display = 'none';
      customInput.value = '';
    }
  });
}

// --- Auto HP for level 1 ---
function autoSetHP() {
  const level = parseInt(document.getElementById('f-level').value) || 1;
  if (level !== 1) return;
  const cls = document.getElementById('f-class').value;
  if (!cls || !HIT_DIE[cls]) return;
  const conScore = parseInt(document.getElementById('f-CON').value) || 10;
  const conMod = Math.floor((conScore - 10) / 2);
  document.getElementById('f-hp').value = Math.max(1, HIT_DIE[cls] + conMod);
}

// --- Features DB ---
async function loadFeaturesDB() {
  let featsRes, traitsRes, classRes;
  try {
    [featsRes, traitsRes, classRes] = await Promise.all([
      fetch('/api/feats'),
      fetch('/api/species-traits'),
      fetch('/api/class-features')
    ]);
    if (!featsRes.ok || !traitsRes.ok || !classRes.ok) throw new Error('HTTP error loading features');
  } catch (e) {
    console.error('Failed to load features data:', e);
    return;
  }
  const feats = await featsRes.json();
  const speciesTraits = await traitsRes.json();
  const classFeatures = await classRes.json();

  allFeatures = [];

  feats.forEach(f => {
    allFeatures.push({
      name: f.name, description: f.description, source: 'feat',
      sourceDetail: f.category + (f.prerequisite ? ` (${f.prerequisite})` : '')
    });
  });

  for (const [species, traits] of Object.entries(speciesTraits)) {
    traits.forEach(t => {
      allFeatures.push({ name: t.name, description: t.description, source: 'species', sourceDetail: species });
    });
  }

  for (const [className, features] of Object.entries(classFeatures)) {
    features.forEach(f => {
      allFeatures.push({
        name: f.name, description: f.description, source: 'class',
        sourceDetail: `${className} (lvl ${f.level})`, _className: className, _level: f.level
      });
    });
  }

  allFeatures.forEach(f => {
    if (f.source === 'species') f._speciesName = f.sourceDetail;
  });
}

function filterFeatures() {
  const query = document.getElementById('feature-search').value.toLowerCase().trim();
  const sourceFilter = document.getElementById('feature-source-filter').value;
  const resultsEl = document.getElementById('feature-results');
  const charClass = document.getElementById('f-class').value;
  const charSpecies = document.getElementById('f-species').value;
  const charLevel = parseInt(document.getElementById('f-level').value) || 1;

  if (!query && !sourceFilter && !charClass && !charSpecies) {
    resultsEl.style.display = 'none';
    return;
  }

  let filtered = allFeatures.filter(f => {
    if (selectedFeatures.find(s => s.name === f.name && s.sourceDetail === f.sourceDetail)) return false;
    if (query && !f.name.toLowerCase().includes(query) && !f.description.toLowerCase().includes(query)) return false;
    if (sourceFilter && f.source !== sourceFilter) return false;
    if (!query) {
      if (f.source === 'class') return f._className === charClass && f._level <= charLevel;
      if (f.source === 'species') return f._speciesName === charSpecies;
      return f.source === 'feat';
    }
    return true;
  });

  filtered.sort((a, b) => {
    const aMatch = (a.source === 'class' && a._className === charClass) || (a.source === 'species' && a._speciesName === charSpecies);
    const bMatch = (b.source === 'class' && b._className === charClass) || (b.source === 'species' && b._speciesName === charSpecies);
    if (aMatch && !bMatch) return -1;
    if (!aMatch && bMatch) return 1;
    if (a.source === 'class' && b.source === 'class') return (a._level || 0) - (b._level || 0);
    return 0;
  });

  filtered = filtered.slice(0, 50);
  if (filtered.length === 0) {
    resultsEl.innerHTML = '<div style="padding:10px;color:var(--text-muted);">No features found.</div>';
  } else {
    resultsEl.innerHTML = filtered.map((f, i) => `
      <div class="spell-result-item" onclick="selectFeature(${i})" data-idx="${i}" style="padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;">
        <div>
          <strong>${esc(f.name)}</strong>
          <span style="color:var(--text-muted);font-size:0.8rem;margin-left:8px;">${esc(f.sourceDetail)}</span>
        </div>
        <span style="color:var(--text-muted);font-size:0.75rem;">${f.source}</span>
      </div>
    `).join('');
    resultsEl._filtered = filtered;
  }
  resultsEl.style.display = '';
}

function selectFeature(idx) {
  const resultsEl = document.getElementById('feature-results');
  const f = resultsEl._filtered[idx];
  if (!f || selectedFeatures.find(s => s.name === f.name && s.sourceDetail === f.sourceDetail)) return;
  selectedFeatures.push(f);
  renderSelectedFeatures();
  filterFeatures();
}

function removeFeature(idx) {
  selectedFeatures.splice(idx, 1);
  renderSelectedFeatures();
  filterFeatures();
}

function updateCustomFeature(idx, input) { selectedFeatures[idx].name = input.value.trim(); }
function updateCustomFeatureDesc(idx, input) { selectedFeatures[idx].description = input.value.trim(); }

function addCustomFeature() {
  selectedFeatures.push({ name: '', description: '', source: 'custom', sourceDetail: 'Custom', _editing: true });
  renderSelectedFeatures();
  const inputs = document.querySelectorAll('#features-selected .feat-name');
  if (inputs.length) inputs[inputs.length - 1].focus();
}

function renderSelectedFeatures() {
  const container = document.getElementById('features-selected');
  if (selectedFeatures.length === 0) { container.innerHTML = ''; return; }
  container.innerHTML = selectedFeatures.map((f, i) => {
    if (f._editing) {
      return `
    <div class="list-item" style="flex-wrap:wrap;padding:8px 12px;">
      <div class="form-group" style="flex:1;"><label>Name</label><input type="text" class="feat-name" value="${esc(f.name)}" onchange="updateCustomFeature(${i}, this)" placeholder="Feature name"></div>
      <div class="form-group" style="flex:2;"><label>Description</label><input type="text" class="feat-desc" value="${esc(f.description)}" onchange="updateCustomFeatureDesc(${i}, this)" placeholder="Description (optional)"></div>
      <button type="button" class="remove-item" onclick="removeFeature(${i})">&times;</button>
    </div>`;
    }
    return `
    <div class="list-item" style="flex-wrap:nowrap;align-items:center;padding:8px 12px;">
      <div style="flex:1;">
        <strong>${esc(f.name)}</strong>
        <span style="color:var(--text-muted);font-size:0.8rem;margin-left:6px;">${esc(f.sourceDetail)}</span>
        <div style="font-size:0.85rem;color:var(--text-muted);margin-top:2px;">${esc(f.description)}</div>
      </div>
      <button type="button" class="remove-item" onclick="removeFeature(${i})">&times;</button>
    </div>`;
  }).join('');
}

// --- Spells DB ---
async function loadSpellsDB() {
  try {
    const res = await fetch('/api/spells');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    allSpells = await res.json();
  } catch (e) {
    console.error('Failed to load spells data:', e);
  }
}

function filterSpells() {
  const query = document.getElementById('spell-search').value.toLowerCase().trim();
  const levelFilter = document.getElementById('spell-level-filter').value;
  const classFilter = document.getElementById('spell-class-filter').value;
  const resultsEl = document.getElementById('spell-results');

  if (!query && !levelFilter && !classFilter) { resultsEl.style.display = 'none'; return; }

  let filtered = allSpells.filter(sp => {
    if (query && !sp.name.toLowerCase().includes(query)) return false;
    if (levelFilter !== '' && sp.level !== parseInt(levelFilter)) return false;
    if (classFilter && !sp.classes.includes(classFilter)) return false;
    if (selectedSpells.find(s => s.name === sp.name)) return false;
    return true;
  }).slice(0, 50);

  if (filtered.length === 0) {
    resultsEl.innerHTML = '<div style="padding:10px;color:var(--text-muted);">No spells found.</div>';
  } else {
    resultsEl.innerHTML = filtered.map(sp => `
      <div class="spell-result-item" onclick="selectSpell('${esc(sp.name)}')" style="padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;">
        <div>
          <strong>${esc(sp.name)}</strong>
          <span style="color:var(--text-muted);font-size:0.8rem;margin-left:8px;">
            ${sp.level === 0 ? 'Cantrip' : 'Level ' + sp.level} ${esc(sp.school)}
          </span>
        </div>
        <span style="color:var(--text-muted);font-size:0.75rem;">${sp.classes.join(', ')}</span>
      </div>
    `).join('');
  }
  resultsEl.style.display = '';
}

function selectSpell(name) {
  const spell = allSpells.find(s => s.name === name);
  if (!spell || selectedSpells.find(s => s.name === name)) return;
  selectedSpells.push(spell);
  renderSelectedSpells();
  filterSpells();
}

function removeSpell(name) {
  selectedSpells = selectedSpells.filter(s => s.name !== name);
  renderSelectedSpells();
  filterSpells();
}

function removeSpellByIndex(idx) {
  selectedSpells.splice(idx, 1);
  renderSelectedSpells();
  filterSpells();
}

function addCustomSpell() {
  selectedSpells.push({
    name: '', level: 0, school: 'Custom', description: '', actionType: '',
    castingTime: '', range: '', components: '', concentration: false, ritual: false, duration: '', _editing: true
  });
  renderSelectedSpells();
  const inputs = document.querySelectorAll('#spells-selected .spell-name');
  if (inputs.length) inputs[inputs.length - 1].focus();
}

function updateCustomSpellField(idx, field, input) {
  if (field === 'level') selectedSpells[idx].level = parseInt(input.value) || 0;
  else selectedSpells[idx][field] = input.value.trim();
}

function renderSelectedSpells() {
  const container = document.getElementById('spells-selected');
  if (selectedSpells.length === 0) { container.innerHTML = ''; return; }
  const byLevel = {};
  selectedSpells.forEach(sp => {
    const key = sp.level === 0 ? 'Cantrips' : `Level ${sp.level}`;
    if (!byLevel[key]) byLevel[key] = [];
    byLevel[key].push(sp);
  });
  let html = '';
  for (const [level, spells] of Object.entries(byLevel)) {
    html += `<div style="font-size:0.8rem;color:var(--text-muted);margin:8px 0 4px;font-weight:600;">${level}</div>`;
    html += spells.map(sp => {
      const idx = selectedSpells.indexOf(sp);
      if (sp._editing) {
        return `
      <div class="list-item" style="flex-wrap:wrap;padding:8px 12px;">
        <div class="form-group" style="flex:2;"><label>Name</label><input type="text" class="spell-name" value="${esc(sp.name)}" onchange="updateCustomSpellField(${idx}, 'name', this)" placeholder="Spell name"></div>
        <div class="form-group" style="flex:0 0 70px;"><label>Level</label><input type="number" value="${sp.level}" min="0" max="9" onchange="updateCustomSpellField(${idx}, 'level', this)"></div>
        <div class="form-group" style="flex:2;"><label>Description</label><input type="text" value="${esc(sp.description)}" onchange="updateCustomSpellField(${idx}, 'description', this)" placeholder="Description (optional)"></div>
        <button type="button" class="remove-item" onclick="removeSpellByIndex(${idx})">&times;</button>
      </div>`;
      }
      return `
      <div class="list-item" style="flex-wrap:nowrap;align-items:center;padding:8px 12px;">
        <div style="flex:1;">
          <strong>${esc(sp.name)}</strong>
          <span style="color:var(--text-muted);font-size:0.8rem;margin-left:6px;">${esc(sp.school)} | ${esc(sp.actionType)} | ${esc(sp.range)}</span>
        </div>
        <button type="button" class="remove-item" onclick="removeSpell('${esc(sp.name)}')">&times;</button>
      </div>`;
    }).join('');
  }
  container.innerHTML = html;
}

// --- Saving Throws ---
function renderSavingThrows() {
  const container = document.getElementById('saving-throws-inputs');
  const cls = document.getElementById('f-class').value;
  const classSaves = CLASS_SAVING_THROWS[cls] || [];
  container.innerHTML = ABILITIES.map((a, i) => {
    const proficient = classSaves.includes(a);
    return `
      <div style="display:flex;align-items:center;gap:8px;padding:4px 8px;background:var(--bg-input);border-radius:4px;">
        <span style="color:var(--accent);font-weight:600;min-width:14px;">${proficient ? '*' : ''}</span>
        <span style="flex:1;font-size:0.9rem;">${a}</span>
        <span id="f-save-mod-${i}" style="color:var(--gold);font-weight:600;font-size:0.9rem;min-width:28px;text-align:right;">+0</span>
      </div>`;
  }).join('');
  updateSavingThrows();
}

function updateSavingThrows() {
  const profBonus = getProficiencyBonus();
  const cls = document.getElementById('f-class').value;
  const classSaves = CLASS_SAVING_THROWS[cls] || [];
  ABILITIES.forEach((a, i) => {
    const abilityMod = getAbilityMod(a);
    const proficient = classSaves.includes(a);
    const total = abilityMod + (proficient ? profBonus : 0);
    const modEl = document.getElementById(`f-save-mod-${i}`);
    if (modEl) modEl.textContent = total >= 0 ? `+${total}` : `${total}`;
  });
}

// --- Skills form fields ---
function renderSkillInputs(proficiencies) {
  const container = document.getElementById('skills-inputs');
  container.innerHTML = SKILL_ABILITIES.map((s, i) => {
    const checked = proficiencies && proficiencies[i] ? 'checked' : '';
    return `
      <div style="display:flex;align-items:center;gap:8px;padding:4px 8px;background:var(--bg-input);border-radius:4px;">
        <input type="checkbox" id="f-skill-prof-${i}" ${checked} onchange="updateSkillModifiers()">
        <span style="flex:1;font-size:0.9rem;">${s.name}</span>
        <span style="color:var(--text-muted);font-size:0.75rem;">${s.ability}</span>
        <span id="f-skill-mod-${i}" style="color:var(--gold);font-weight:600;font-size:0.9rem;min-width:28px;text-align:right;">+0</span>
      </div>`;
  }).join('');
  updateSkillModifiers();
}

function updateSkillModifiers() {
  const profBonus = getProficiencyBonus();
  document.getElementById('prof-bonus-display').textContent = `(Proficiency Bonus: +${profBonus})`;
  SKILL_ABILITIES.forEach((s, i) => {
    const abilityMod = getAbilityMod(s.ability);
    const proficient = document.getElementById(`f-skill-prof-${i}`)?.checked || false;
    const total = abilityMod + (proficient ? profBonus : 0);
    const modEl = document.getElementById(`f-skill-mod-${i}`);
    if (modEl) modEl.textContent = total >= 0 ? `+${total}` : `${total}`;
  });
}

// --- Characters (IndexedDB) ---
async function loadCharacters() {
  const chars = await db.getAllCharacters();
  allCharacters = chars;
  renderCharacterList(chars);
}

function renderCharacterList(chars) {
  const container = document.getElementById('char-list');
  if (chars.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted)">No characters yet. Create one to get started.</p>';
    return;
  }
  container.innerHTML = chars.map(c => `
    <div class="char-item" onclick="openCharModal('${c._id}')">
      <div class="char-info">
        <span class="char-name">${esc(c.name)}</span>
        <span class="char-meta">Level ${c.level} ${esc(c.species || '')} ${esc(c.class)} — HP ${c.HP} / AC ${c.AC}</span>
      </div>
      <div class="char-item-actions" style="display:flex;gap:6px;">
        <button class="btn btn-secondary btn-small" onclick="event.stopPropagation();openCharModal('${c._id}')">Edit</button>
        <button class="btn btn-secondary btn-small" onclick="event.stopPropagation();exportCharacter('${c._id}')">Export</button>
        <button class="btn btn-danger btn-small" onclick="event.stopPropagation();deleteCharacter('${c._id}')">Delete</button>
      </div>
    </div>
  `).join('');
}

// --- Character Modal ---
async function openCharModal(id) {
  const modal = document.getElementById('char-modal');
  const form = document.getElementById('char-form');
  form.reset();
  document.getElementById('char-edit-id').value = '';
  document.getElementById('equipment-list').innerHTML = '';
  document.getElementById('equip-search').value = '';
  document.getElementById('equip-type-filter').value = '';
  document.getElementById('equip-results').style.display = 'none';
  document.getElementById('f-background-custom').style.display = 'none';
  document.getElementById('f-background-custom').value = '';
  ['cp','sp','ep','gp','pp'].forEach(k => { document.getElementById(`f-${k}`).value = 0; });
  selectedSpells = [];
  renderSelectedSpells();
  document.getElementById('spell-search').value = '';
  document.getElementById('spell-level-filter').value = '';
  document.getElementById('spell-class-filter').value = '';
  document.getElementById('spell-results').style.display = 'none';
  selectedFeatures = [];
  renderSelectedFeatures();
  document.getElementById('feature-search').value = '';
  document.getElementById('feature-source-filter').value = '';
  document.getElementById('feature-results').style.display = 'none';
  renderSavingThrows();
  renderSkillInputs();

  if (id) {
    document.getElementById('char-modal-title').textContent = 'Edit Character';
    const c = await db.getCharacter(id);
    if (!c) return;
    document.getElementById('char-edit-id').value = id;
    document.getElementById('f-name').value = c.name || '';
    document.getElementById('f-class').value = c.class || '';
    document.getElementById('f-species').value = c.species || '';
    document.getElementById('f-level').value = c.level || 1;
    const bgVal = c.background || '';
    const bgSelect = document.getElementById('f-background');
    const bgCustom = document.getElementById('f-background-custom');
    if (bgVal && !BACKGROUNDS.includes(bgVal)) {
      bgSelect.value = '__custom__';
      bgCustom.style.display = '';
      bgCustom.value = bgVal;
    } else {
      bgSelect.value = bgVal;
      bgCustom.style.display = 'none';
      bgCustom.value = '';
    }
    document.getElementById('f-hp').value = c.HP || 10;
    document.getElementById('f-ac').value = c.AC || 10;
    ['STR','DEX','CON','INT','WIS','CHA'].forEach(a => {
      document.getElementById(`f-${a}`).value = c[a] || 10;
    });
    renderSavingThrows();
    renderSkillInputs(c.skills || []);
    if (c.features) {
      c.features.forEach(f => {
        if (typeof f === 'string') {
          selectedFeatures.push({ name: f, description: '', source: '', sourceDetail: '' });
        } else {
          if (f.source === 'custom') f._editing = true;
          selectedFeatures.push(f);
        }
      });
      renderSelectedFeatures();
    }
    const cur = c.currency || {};
    ['cp','sp','ep','gp','pp'].forEach(k => {
      document.getElementById(`f-${k}`).value = cur[k.toUpperCase()] || 0;
    });
    (c.equipment || []).forEach(eq => addEquipmentRow(eq));
    if (c.spells) {
      c.spells.forEach(sp => {
        const dbSpell = allSpells.find(s => s.name === sp.name);
        const spell = dbSpell || sp;
        if (!dbSpell && sp.school === 'Custom') spell._editing = true;
        selectedSpells.push(spell);
      });
      renderSelectedSpells();
    }
  } else {
    document.getElementById('char-modal-title').textContent = 'New Character';
  }
  modal.classList.add('active');
  const scrollY = window.scrollY;
  document.body.style.position = 'fixed';
  document.body.style.top = `-${scrollY}px`;
  document.body.style.width = '100%';
  document.body.dataset.modalScrollY = scrollY;
}

function closeCharModal() {
  document.getElementById('char-modal').classList.remove('active');
  const scrollY = parseInt(document.body.dataset.modalScrollY || '0');
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.width = '';
  window.scrollTo(0, scrollY);
}

async function saveCharacter(e) {
  e.preventDefault();
  const id = document.getElementById('char-edit-id').value;
  const character = {
    name: document.getElementById('f-name').value,
    class: document.getElementById('f-class').value,
    species: document.getElementById('f-species').value,
    level: parseInt(document.getElementById('f-level').value),
    background: document.getElementById('f-background').value === '__custom__'
      ? document.getElementById('f-background-custom').value
      : document.getElementById('f-background').value,
    HP: parseInt(document.getElementById('f-hp').value),
    AC: parseInt(document.getElementById('f-ac').value),
    STR: parseInt(document.getElementById('f-STR').value),
    DEX: parseInt(document.getElementById('f-DEX').value),
    CON: parseInt(document.getElementById('f-CON').value),
    INT: parseInt(document.getElementById('f-INT').value),
    WIS: parseInt(document.getElementById('f-WIS').value),
    CHA: parseInt(document.getElementById('f-CHA').value),
    skills: SKILL_ABILITIES.map((_, i) => document.getElementById(`f-skill-prof-${i}`).checked),
    features: selectedFeatures.map(f => ({ name: f.name, description: f.description, source: f.source, sourceDetail: f.sourceDetail })),
    currency: {
      CP: parseInt(document.getElementById('f-cp').value) || 0,
      SP: parseInt(document.getElementById('f-sp').value) || 0,
      EP: parseInt(document.getElementById('f-ep').value) || 0,
      GP: parseInt(document.getElementById('f-gp').value) || 0,
      PP: parseInt(document.getElementById('f-pp').value) || 0
    },
    equipment: collectEquipment(),
    spells: selectedSpells.map(sp => ({
      name: sp.name, level: sp.level, school: sp.school, description: sp.description,
      castingTime: sp.actionType || sp.castingTime || '', range: sp.range || '',
      components: Array.isArray(sp.components) ? sp.components.join(', ').toUpperCase() : (sp.components || ''),
      concentration: sp.concentration || false, ritual: sp.ritual || false, duration: sp.duration || ''
    }))
  };

  if (id) character._id = id;

  try {
    const saved = await db.putCharacter(character);
    closeCharModal();
    loadCharacters();
    // Broadcast to player if connected
    broadcastCharacterToPlayer(saved._id);
  } catch (err) {
    dialogAlert(err.message, 'Save Error', 'error');
  }
}

async function deleteCharacter(id) {
  const isClaimed = currentSession && currentSession.characters[id]?.claimedBy;
  const msg = isClaimed
    ? 'This character is currently claimed by a player. Deleting it will remove them from the session. Continue?'
    : 'Delete this character?';
  if (!await dialogConfirm(msg, 'Delete Character')) return;
  await db.deleteCharacter(id);
  if (currentSession && currentSession.characters[id]) {
    delete currentSession.characters[id];
    renderBattlefieldCharacters();
  }
  loadCharacters();
}

// --- Equipment DB & Picker ---
async function loadEquipmentDB() {
  try {
    const res = await fetch('/api/equipment');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    allEquipment = await res.json();
  } catch (e) {
    console.error('Failed to load equipment data:', e);
  }
}

function filterEquipment() {
  const query = document.getElementById('equip-search').value.trim().toLowerCase();
  const typeFilter = document.getElementById('equip-type-filter').value;
  const resultsEl = document.getElementById('equip-results');

  if (!query && !typeFilter) { resultsEl.style.display = 'none'; return; }

  let filtered = allEquipment;
  if (typeFilter) filtered = filtered.filter(e => e.type === typeFilter);
  if (query) filtered = filtered.filter(e =>
    e.name.toLowerCase().includes(query) || (e.category && e.category.toLowerCase().includes(query))
  );

  resultsEl.style.display = '';
  resultsEl.innerHTML = filtered.slice(0, 50).map((e, i) => {
    let detail = e.category || '';
    if (e.damage) detail += ` | ${e.damage}`;
    if (e.AC) detail += ` | AC: ${e.AC}`;
    if (e.cost) detail += ` | ${e.cost}`;
    if (e.properties && e.properties !== '—') detail += ` | ${e.properties}`;
    return `
      <div class="list-item" style="cursor:pointer;" onclick="selectEquipment(${i}, this)">
        <div>
          <strong>${esc(e.name)}</strong>
          <span style="color:var(--text-muted);font-size:0.8rem;margin-left:6px;">${esc(detail)}</span>
        </div>
      </div>
    `;
  }).join('') || '<div style="padding:8px;color:var(--text-muted);">No items found</div>';
  resultsEl._filtered = filtered;
}

function selectEquipment(idx, el) {
  const resultsEl = document.getElementById('equip-results');
  const e = resultsEl._filtered[idx];
  if (!e) return;
  let desc = '';
  if (e.damage) desc += e.damage;
  if (e.AC) desc += (desc ? ' | ' : '') + 'AC: ' + e.AC;
  if (e.properties && e.properties !== '—') desc += (desc ? ' | ' : '') + e.properties;
  if (e.weight && e.weight !== '—') desc += (desc ? ' | ' : '') + e.weight;
  if (e.cost) desc += (desc ? ' | ' : '') + e.cost;
  addEquipmentRow({ name: e.name, type: e.category || e.type, description: desc, quantity: 1 });
}

function addEquipmentRow(data) {
  const container = document.getElementById('equipment-list');
  const div = document.createElement('div');
  div.className = 'list-item';
  div.style.flexWrap = 'wrap';
  div.innerHTML = `
    <div class="form-group"><label>Name</label><input type="text" class="eq-name" value="${esc(data?.name || '')}"></div>
    <div class="form-group"><label>Type</label><input type="text" class="eq-type" value="${esc(data?.type || '')}"></div>
    <div class="form-group"><label>Qty</label><input type="number" class="eq-qty" value="${data?.quantity || 1}" min="0" style="width:60px;"></div>
    <div class="form-group" style="flex:2;"><label>Description</label><input type="text" class="eq-desc" value="${esc(data?.description || '')}"></div>
    <button type="button" class="remove-item" onclick="this.parentElement.remove()">&times;</button>
  `;
  container.appendChild(div);
}

function collectEquipment() {
  const items = [];
  document.querySelectorAll('#equipment-list .list-item').forEach(row => {
    const name = row.querySelector('.eq-name').value.trim();
    if (!name) return;
    items.push({
      name, type: row.querySelector('.eq-type').value.trim(),
      description: row.querySelector('.eq-desc').value.trim(),
      quantity: parseInt(row.querySelector('.eq-qty').value) || 1
    });
  });
  return items;
}

// --- Sessions (PeerJS) ---
async function createSession() {
  const pin = await dialogPrompt('Set a PIN for players to join (min 3 characters, alphanumeric):', 'Start Session');
  if (!pin) return;
  if (pin.length < 3) { dialogAlert('PIN must be at least 3 characters.', 'Invalid PIN', 'error'); return; }
  if (!/^[a-zA-Z0-9]+$/.test(pin)) { dialogAlert('PIN must be alphanumeric.', 'Invalid PIN', 'error'); return; }

  await db.savePin(pin);
  const roomId = await db.ensureRoomId();

  // Build session characters from all characters
  const chars = await db.getAllCharacters();
  const characters = {};
  chars.forEach(c => { characters[c._id] = { claimedBy: null }; });
  currentSession = { pin, characters };

  // Initialize PeerJS
  try {
    dmPeer = peerManager.createDMPeer(roomId);
    await dmPeer.init();
    setupPeerHandlers();
    showSessionActive();
    showQR();
    updatePeerStatus();
  } catch (err) {
    dialogAlert('Failed to start session: ' + err.message, 'Session Error', 'error');
    currentSession = null;
  }
}


function setupPeerHandlers() {
  dmPeer.onPlayerMessage(async (peerId, msg) => {
    if (msg.type === 'join') {
      const storedPin = await db.getPin();
      if (msg.pin !== storedPin) {
        dmPeer.sendToPlayer(peerId, { type: 'join-error', error: 'Invalid PIN' });
        return;
      }
      // Send character list — mark characters as claimed only if the claimer's
      // connection is still alive (handles phone backgrounding / stale WebRTC).
      const chars = await db.getAllCharacters();
      const connectedPeers = dmPeer.getConnectedPlayers();
      const charList = chars.map(c => {
        const entry = currentSession.characters[c._id];
        let claimed = entry?.claimedBy || null;
        // If claimer's connection is dead, report as unclaimed so the picker
        // shows it as available and auto-reclaim can proceed.
        if (claimed) {
          const claimerAlive = connectedPeers.some(
            p => p.characterId === c._id && p.alive && p.peerId !== peerId
          );
          if (!claimerAlive) claimed = null;
        }
        return {
          _id: c._id, name: c.name, class: c.class, species: c.species, level: c.level,
          claimed
        };
      });
      dmPeer.sendToPlayer(peerId, { type: 'join-ok', characters: charList });
    } else if (msg.type === 'claim') {
      const { characterId, playerName } = msg;
      const charEntry = currentSession.characters[characterId];
      if (!charEntry) {
        dmPeer.sendToPlayer(peerId, { type: 'claim-error', error: 'Character not in session' });
        return;
      }
      if (charEntry.claimedBy) {
        // Allow reclaim if the previous claimer is no longer connected or their
        // connection is stale (e.g. phone backgrounded, WebRTC died silently).
        const connectedPeers = dmPeer.getConnectedPlayers();
        const claimerStillConnected = connectedPeers.some(
          p => p.characterId === characterId && p.peerId !== peerId && p.alive
        );
        if (claimerStillConnected) {
          dmPeer.sendToPlayer(peerId, { type: 'claim-error', error: 'Character already claimed' });
          return;
        }
        // Previous claimer disconnected or connection dead — allow reclaim.
      }
      charEntry.claimedBy = playerName;
      dmPeer.setPlayerInfo(peerId, playerName, characterId);

      // Send full character data
      const c = await db.getCharacter(characterId);
      const hpState = characterHPState[characterId] || { currentHP: c.HP, tempHP: 0 };
      dmPeer.sendToPlayer(peerId, { type: 'claim-ok', characterId, character: c, hpState });

      // Refresh battlefield characters section
      renderBattlefieldCharacters();
      updatePeerStatus();
    } else if (msg.type === 'ping') {
      // pong is sent automatically by peer.js — nothing else to do here
    }
  });

  dmPeer.onPlayerDisconnect((peerId, info) => {
    if (!currentSession) { updatePeerStatus(); return; }
    let changed = false;
    // Unclaim via tracked characterId (fast path).
    if (info && info.characterId) {
      const entry = currentSession.characters[info.characterId];
      if (entry && entry.claimedBy) {
        entry.claimedBy = null;
        changed = true;
      }
    }
    // Also scan all characters for claims by this peer's playerName
    // in case info.characterId was missing (e.g. stale connection cleanup).
    if (info && info.playerName) {
      for (const entry of Object.values(currentSession.characters)) {
        if (entry.claimedBy === info.playerName) {
          entry.claimedBy = null;
          changed = true;
        }
      }
    }
    if (changed) renderBattlefieldCharacters();
    updatePeerStatus();
  });

  dmPeer.onPlayerConnect((peerId) => {
    updatePeerStatus();
  });

  // Show a notice in the session status if the DM loses signaling server connectivity.
  dmPeer.onSignalingDisconnect(() => {
    const el = document.getElementById('session-status');
    if (el && currentSession) {
      el.textContent = `Session active (PIN: ${currentSession.pin}) — reconnecting…`;
    }
  });

  dmPeer.onSignalingReconnect(() => {
    const el = document.getElementById('session-status');
    if (el && currentSession) {
      el.textContent = `Session active (PIN: ${currentSession.pin})`;
    }
  });
}

function updatePeerStatus() {
  const el = document.getElementById('peer-status');
  if (!dmPeer) { el.textContent = ''; return; }
  const players = dmPeer.getConnectedPlayers();
  el.textContent = `${players.length} player${players.length !== 1 ? 's' : ''} connected`;
}

function showSessionActive() {
  document.getElementById('session-status').textContent = `Session active (PIN: ${currentSession.pin})`;
  document.getElementById('btn-new-session').style.display = 'none';
  document.getElementById('btn-show-qr').style.display = '';
  document.getElementById('btn-end-session').style.display = '';
  renderBattlefieldCharacters();
}

async function endSession() {
  if (!await dialogConfirm('End the current session? Players will be disconnected.', 'End Session')) return;
  if (dmPeer) { dmPeer.destroy(); dmPeer = null; }
  currentSession = null;
  document.getElementById('session-status').textContent = 'No active session';
  document.getElementById('btn-new-session').style.display = '';
  document.getElementById('btn-show-qr').style.display = 'none';
  document.getElementById('btn-end-session').style.display = 'none';
  updatePeerStatus();
  renderBattlefieldCharacters();
}

async function showQR() {
  if (!currentSession) return;
  const roomId = await db.ensureRoomId();
  const protocol = window.location.protocol;
  const host = window.location.host;
  const url = `${protocol}//${host}/join/${roomId}`;

  QRCode.toCanvas(document.getElementById('qr-canvas'), url, { width: 256, margin: 2 });
  document.getElementById('qr-url').textContent = url;
  document.getElementById('qr-pin').textContent = currentSession.pin;
  document.getElementById('qr-modal').classList.add('active');
}

function copySessionUrl() {
  const url = document.getElementById('qr-url').textContent;
  if (!url) return;
  navigator.clipboard.writeText(url).then(() => {
    const btn = document.getElementById('btn-copy-url');
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = orig; }, 2000);
  }).catch(() => {
    dialogAlert('Could not copy URL. Please copy it manually.', 'Copy Failed', 'warn');
  });
}

// Broadcast character update to connected player
async function broadcastCharacterToPlayer(characterId) {
  if (!dmPeer) return;
  const c = await db.getCharacter(characterId);
  if (!c) return;
  const hpState = characterHPState[characterId] || { currentHP: c.HP, tempHP: 0 };
  dmPeer.broadcastToCharacter(characterId, { type: 'character-update', characterId, character: c, hpState });
}

// --- Monsters & Battlefield ---
let _bfUid = 0;

async function loadMonstersDB() {
  try {
    const res = await fetch('/api/monsters');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    allMonsters = await res.json();
  } catch (e) {
    console.error('Failed to load monsters data:', e);
    return;
  }

  const types = [...new Set(allMonsters.map(m => m.type).filter(Boolean))].sort();
  const typeSelect = document.getElementById('monster-type-filter');
  types.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t; opt.textContent = t;
    typeSelect.appendChild(opt);
  });

  const crOrder = ['0','1/8','1/4','1/2','1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19','20','21','22','23','24','25','26','27','28','29','30'];
  const crs = [...new Set(allMonsters.map(m => String(m.CR)).filter(Boolean))];
  crs.sort((a, b) => crOrder.indexOf(a) - crOrder.indexOf(b));
  const crSelect = document.getElementById('monster-cr-filter');
  crs.forEach(cr => {
    const opt = document.createElement('option');
    opt.value = cr; opt.textContent = `CR ${cr}`;
    crSelect.appendChild(opt);
  });
}

function filterMonsters() {
  const query = document.getElementById('monster-search').value.trim().toLowerCase();
  const typeFilter = document.getElementById('monster-type-filter').value;
  const crFilter = document.getElementById('monster-cr-filter').value;
  const resultsEl = document.getElementById('monster-results');

  if (!query && !typeFilter && !crFilter) { resultsEl.style.display = 'none'; return; }

  let filtered = allMonsters;
  if (typeFilter) filtered = filtered.filter(m => m.type === typeFilter);
  if (crFilter) filtered = filtered.filter(m => String(m.CR) === crFilter);
  if (query) filtered = filtered.filter(m => m.name.toLowerCase().includes(query));

  resultsEl.style.display = '';
  resultsEl.innerHTML = filtered.slice(0, 50).map((m, i) => {
    const meta = [m.size, m.type, `CR ${m.CR}`, `HP ${m.HP}`, `AC ${m.AC}`].filter(Boolean).join(' | ');
    return `
      <div class="list-item" style="cursor:pointer;justify-content:space-between;" onclick="addToBattlefield(${allMonsters.indexOf(m)})">
        <div>
          <strong>${esc(m.name)}</strong>
          <span style="color:var(--text-muted);font-size:0.8rem;margin-left:6px;">${esc(meta)}</span>
        </div>
        <span style="color:var(--gold);font-size:0.85rem;">+ Add</span>
      </div>
    `;
  }).join('') || '<div style="padding:8px;color:var(--text-muted);">No monsters found</div>';
}

async function loadBattlefield() {
  try {
    const saved = await db.getBattlefield();
    battlefieldMonsters = [];
    saved.forEach(entry => {
      const m = allMonsters.find(m => m.name === entry.name);
      if (!m) return;
      battlefieldMonsters.push({
        ...m, _uid: ++_bfUid, _label: entry._label || m.name,
        currentHP: entry.currentHP != null ? entry.currentHP : m.HP
      });
    });
    relabelBattlefield();
    renderBattlefield();
  } catch (e) { console.error('Error loading battlefield:', e); }
}

function saveBattlefield() {
  const compact = battlefieldMonsters.map(m => ({ name: m.name, _label: m._label, currentHP: m.currentHP }));
  db.saveBattlefield(compact);
}

function relabelBattlefield() {
  const nameCounts = {};
  battlefieldMonsters.forEach(m => { nameCounts[m.name] = (nameCounts[m.name] || 0) + 1; });
  for (const name of Object.keys(nameCounts)) {
    const instances = battlefieldMonsters.filter(b => b.name === name);
    if (instances.length === 1) { instances[0]._label = name; }
    else { instances.forEach((inst, i) => { inst._label = `${name} #${i + 1}`; }); }
  }
}

function addToBattlefield(idx) {
  const m = allMonsters[idx];
  if (!m) return;
  battlefieldMonsters.push({ ...m, _uid: ++_bfUid, _label: m.name, currentHP: m.HP });
  relabelBattlefield();
  renderBattlefield();
  saveBattlefield();
}

function removeFromBattlefield(uid) {
  battlefieldMonsters = battlefieldMonsters.filter(b => b._uid !== uid);
  relabelBattlefield();
  renderBattlefield();
  saveBattlefield();
}

async function clearBattlefield() {
  if (battlefieldMonsters.length === 0) return;
  if (!await dialogConfirm('Remove all monsters from the battlefield?', 'Clear Battlefield')) return;
  battlefieldMonsters = [];
  renderBattlefield();
  saveBattlefield();
}

function renderBattlefield() {
  const container = document.getElementById('battlefield-list');
  const emptyMsg = document.getElementById('battlefield-empty');

  if (battlefieldMonsters.length === 0) { container.innerHTML = ''; if (emptyMsg) emptyMsg.style.display = ''; return; }
  emptyMsg.style.display = 'none';

  container.innerHTML = battlefieldMonsters.map(m => {
    const hpPercent = Math.max(0, (m.currentHP / m.HP) * 100);
    let hpColor = 'var(--hp-high)';
    if (hpPercent <= 25) hpColor = 'var(--hp-low)';
    else if (hpPercent <= 50) hpColor = 'var(--hp-mid)';
    return `
      <div class="bf-card" data-uid="${m._uid}">
        <div class="bf-header">
          <strong class="bf-name" onclick="showMonsterStats(${m._uid})" style="cursor:pointer;">${esc(m._label)}</strong>
          <span style="color:var(--text-muted);font-size:0.8rem;">${esc(m.size || '')} ${esc(m.type || '')} | AC ${m.AC} | CR ${m.CR}</span>
          <button class="remove-item" onclick="removeFromBattlefield(${m._uid})" title="Remove">&times;</button>
        </div>
        <div class="bf-hp-row">
          <button class="hp-btn" onclick="bfHP(${m._uid}, -1)">−</button>
          <button class="hp-btn hp-btn-sm" onclick="bfHP(${m._uid}, -5)" style="font-size:0.7rem;">-5</button>
          <div class="bf-hp-bar-container">
            <div class="bf-hp-bar" style="width:${hpPercent}%;background:${hpColor};"></div>
          </div>
          <span class="bf-hp-text" style="min-width:70px;text-align:center;font-weight:600;">${m.currentHP} / ${m.HP}</span>
          <button class="hp-btn hp-btn-sm" onclick="bfHP(${m._uid}, 5)" style="font-size:0.7rem;">+5</button>
          <button class="hp-btn" onclick="bfHP(${m._uid}, 1)">+</button>
        </div>
        <div class="bf-actions">
          ${(m.actions || []).slice(0, 6).map(a => {
            const attackMatch = a.description.match(/([+-]\d+) to hit.*?Hit: (\d+.*?)\./);
            const shortDesc = attackMatch ? `${attackMatch[1]} to hit, ${attackMatch[2]}` : '';
            return `<span class="bf-action-tag" title="${esc(a.description)}">${esc(a.name)}${shortDesc ? ' (' + esc(shortDesc) + ')' : ''}</span>`;
          }).join('')}
        </div>
      </div>
    `;
  }).join('');
}

function bfHP(uid, delta) {
  const m = battlefieldMonsters.find(b => b._uid === uid);
  if (!m) return;
  m.currentHP = Math.max(0, Math.min(m.HP, m.currentHP + delta));
  renderBattlefield();
  saveBattlefield();
}

function buildMonsterStatBlockHTML(m) {
  const abilityMod = (score) => {
    const mod = Math.floor((score - 10) / 2);
    return mod >= 0 ? `+${mod}` : `${mod}`;
  };
  let html = `
    <div style="color:var(--text-muted);font-size:0.9rem;margin-bottom:12px;">${[m.size, m.type, m.alignment].filter(Boolean).join(', ')}</div>
    <div class="stat-block-divider"></div>
    <div class="stat-block-line"><strong>AC</strong> ${m.AC}</div>
    <div class="stat-block-line"><strong>HP</strong> ${m.HP}${m.hitDice ? ' (' + m.hitDice + ')' : ''}</div>
    <div class="stat-block-line"><strong>Speed</strong> ${m.speed || '30 ft.'}</div>
    <div class="stat-block-divider"></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0;">
      ${['STR','DEX','CON','INT','WIS','CHA'].map(a => `
        <div class="stat-box" style="min-width:55px;">
          <div class="stat-label">${a}</div>
          <div class="stat-mod" style="font-size:1.1rem;">${abilityMod(m[a] || 10)}</div>
          <div class="stat-value" style="font-size:0.85rem;">${m[a] || 10}</div>
        </div>
      `).join('')}
    </div>
    <div class="stat-block-divider"></div>
  `;
  if (m.savingThrows) html += `<div class="stat-block-line"><strong>Saving Throws</strong> ${esc(m.savingThrows)}</div>`;
  if (m.skills) html += `<div class="stat-block-line"><strong>Skills</strong> ${esc(m.skills)}</div>`;
  if (m.damageResistances) html += `<div class="stat-block-line"><strong>Damage Resistances</strong> ${esc(m.damageResistances)}</div>`;
  if (m.damageImmunities) html += `<div class="stat-block-line"><strong>Damage Immunities</strong> ${esc(m.damageImmunities)}</div>`;
  if (m.conditionImmunities) html += `<div class="stat-block-line"><strong>Condition Immunities</strong> ${esc(m.conditionImmunities)}</div>`;
  if (m.senses) html += `<div class="stat-block-line"><strong>Senses</strong> ${esc(m.senses)}</div>`;
  if (m.languages) html += `<div class="stat-block-line"><strong>Languages</strong> ${esc(m.languages)}</div>`;
  html += `<div class="stat-block-line"><strong>CR</strong> ${m.CR}</div>`;
  if (m.traits && m.traits.length > 0) {
    html += '<div class="stat-block-divider"></div>';
    html += m.traits.map(t => `<div class="stat-block-action"><strong>${esc(t.name)}.</strong> ${esc(t.description)}</div>`).join('');
  }
  if (m.actions && m.actions.length > 0) {
    html += '<div class="stat-block-divider"></div><h3 style="margin:8px 0 4px;">Actions</h3>';
    html += m.actions.map(a => `<div class="stat-block-action"><strong>${esc(a.name)}.</strong> ${esc(a.description)}</div>`).join('');
  }
  if (m.reactions && m.reactions.length > 0) {
    html += '<div class="stat-block-divider"></div><h3 style="margin:8px 0 4px;">Reactions</h3>';
    html += m.reactions.map(r => `<div class="stat-block-action"><strong>${esc(r.name)}.</strong> ${esc(r.description)}</div>`).join('');
  }
  if (m.legendaryActions && m.legendaryActions.length > 0) {
    html += '<div class="stat-block-divider"></div><h3 style="margin:8px 0 4px;">Legendary Actions</h3>';
    html += m.legendaryActions.map(a => `<div class="stat-block-action"><strong>${esc(a.name)}.</strong> ${esc(a.description)}</div>`).join('');
  }
  return html;
}

function showMonsterStats(uid) {
  const m = battlefieldMonsters.find(b => b._uid === uid);
  if (!m) return;
  document.getElementById('monster-modal-title').textContent = m._label;
  document.getElementById('monster-stat-block').innerHTML = buildMonsterStatBlockHTML(m);
  document.getElementById('monster-modal').classList.add('active');
}

// --- Character HP Tracking (Battlefield) ---

async function loadCharacterHP() {
  characterHPState = await db.getCharacterHP();
  renderBattlefieldCharacters();
}

function saveCharacterHP(changedCharId) {
  db.saveCharacterHP(characterHPState);
  // Broadcast HP change to connected player
  if (dmPeer && changedCharId) {
    broadcastCharacterToPlayer(changedCharId);
  }
}

async function renderBattlefieldCharacters() {
  const container = document.getElementById('bf-characters-list');
  const emptyMsg = document.getElementById('bf-characters-empty');

  if (!currentSession) {
    bfCharactersCache = [];
    container.innerHTML = '';
    emptyMsg.style.display = '';
    emptyMsg.textContent = 'No active session. Start a session to track character HP.';
    return;
  }

  const sessionChars = currentSession.characters || {};
  const charIds = Object.keys(sessionChars).filter(id => sessionChars[id].claimedBy);
  if (charIds.length === 0) {
    bfCharactersCache = [];
    container.innerHTML = '';
    emptyMsg.style.display = '';
    emptyMsg.textContent = 'No characters claimed yet.';
    return;
  }

  const characters = [];
  for (const id of charIds) {
    const c = await db.getCharacter(id);
    if (c) characters.push(c);
  }

  bfCharactersCache = characters;
  drawBattlefieldCharacters();
}

function drawBattlefieldCharacters() {
  const container = document.getElementById('bf-characters-list');
  const emptyMsg = document.getElementById('bf-characters-empty');
  const characters = bfCharactersCache;

  if (characters.length === 0) {
    container.innerHTML = '';
    emptyMsg.style.display = '';
    emptyMsg.textContent = 'No characters in session.';
    return;
  }
  emptyMsg.style.display = 'none';

  characters.forEach(c => {
    if (!characterHPState[c._id]) characterHPState[c._id] = { currentHP: c.HP, tempHP: 0 };
    if (characterHPState[c._id].currentHP > c.HP) characterHPState[c._id].currentHP = c.HP;
  });

  container.innerHTML = characters.map(c => {
    const state = characterHPState[c._id];
    const hpPercent = Math.max(0, (state.currentHP / c.HP) * 100);
    let hpColor = 'var(--hp-high)';
    if (hpPercent <= 25) hpColor = 'var(--hp-low)';
    else if (hpPercent <= 50) hpColor = 'var(--hp-mid)';
    return `
      <div class="bf-card" data-char-hp-id="${c._id}">
        <div class="bf-header">
          <strong>${esc(c.name)}</strong>
          <span style="color:var(--text-muted);font-size:0.8rem;">Lvl ${c.level} ${esc(c.species || '')} ${esc(c.class)} | AC ${c.AC}</span>
        </div>
        <div class="bf-hp-row">
          <button class="hp-btn" onclick="charHP('${c._id}', -1, ${c.HP})">−</button>
          <button class="hp-btn hp-btn-sm" onclick="charHP('${c._id}', -5, ${c.HP})" style="font-size:0.7rem;">-5</button>
          <div class="bf-hp-bar-container">
            <div class="bf-hp-bar" style="width:${hpPercent}%;background:${hpColor};"></div>
          </div>
          <span class="bf-hp-text" style="min-width:70px;text-align:center;font-weight:600;">${state.currentHP} / ${c.HP}</span>
          <button class="hp-btn hp-btn-sm" onclick="charHP('${c._id}', 5, ${c.HP})" style="font-size:0.7rem;">+5</button>
          <button class="hp-btn" onclick="charHP('${c._id}', 1, ${c.HP})">+</button>
        </div>
        <div class="bf-hp-row" style="margin-top:4px;">
          <button class="hp-btn hp-btn-sm" onclick="charTempHP('${c._id}', -1)">−</button>
          <span style="color:var(--text-muted);font-size:0.85rem;min-width:80px;text-align:center;">Temp HP: ${state.tempHP}</span>
          <button class="hp-btn hp-btn-sm" onclick="charTempHP('${c._id}', 1)">+</button>
        </div>
      </div>
    `;
  }).join('');
}

function charHP(charId, delta, maxHP) {
  if (!characterHPState[charId]) return;
  characterHPState[charId].currentHP = Math.max(0, Math.min(maxHP, characterHPState[charId].currentHP + delta));
  drawBattlefieldCharacters();
  saveCharacterHP(charId);
}

function charTempHP(charId, delta) {
  if (!characterHPState[charId]) return;
  characterHPState[charId].tempHP = Math.max(0, characterHPState[charId].tempHP + delta);
  drawBattlefieldCharacters();
  saveCharacterHP(charId);
}

// --- Compendium ---

function populateCompendiumMonsterFilters() {
  const types = [...new Set(allMonsters.map(m => m.type).filter(Boolean))].sort();
  const typeEl = document.getElementById('compendium-monster-type');
  types.forEach(t => { const o = document.createElement('option'); o.value = t; o.textContent = t; typeEl.appendChild(o); });

  const crOrder = ['0','1/8','1/4','1/2','1','2','3','4','5','6','7','8','9','10',
    '11','12','13','14','15','16','17','18','19','20','21','22','23','24','25','30'];
  const crs = [...new Set(allMonsters.map(m => String(m.CR)).filter(Boolean))];
  crs.sort((a, b) => {
    const ai = crOrder.indexOf(a), bi = crOrder.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
  const crEl = document.getElementById('compendium-monster-cr');
  crs.forEach(cr => { const o = document.createElement('option'); o.value = cr; o.textContent = `CR ${cr}`; crEl.appendChild(o); });
}

function openSearchDropdown() {
  document.getElementById('top-bar-dropdown').classList.add('open');
}
function closeSearchDropdown() {
  document.getElementById('top-bar-dropdown').classList.remove('open');
}

function filterCompendium() {
  const query = document.getElementById('top-bar-search').value.trim().toLowerCase();
  const category = document.getElementById('compendium-category').value;
  document.getElementById('compendium-spell-filters').style.display = category === 'spell' ? 'flex' : 'none';
  document.getElementById('compendium-monster-filters').style.display = category === 'monster' ? 'flex' : 'none';
  document.getElementById('compendium-feature-filters').style.display = category === 'feature' ? 'flex' : 'none';
  const resultsEl = document.getElementById('compendium-results');
  const hintEl = document.getElementById('compendium-hint');

  if (!query && !category) { resultsEl.style.display = 'none'; hintEl.style.display = ''; return; }

  let candidates = [];
  if (!category || category === 'spell') allSpells.forEach(s => candidates.push({ type: 'spell', item: s }));
  if (!category || category === 'monster') allMonsters.forEach(m => candidates.push({ type: 'monster', item: m }));
  if (!category || category === 'equipment') allEquipment.forEach(e => candidates.push({ type: 'equipment', item: e }));
  if (!category || category === 'feature') allFeatures.forEach(f => candidates.push({ type: 'feature', item: f }));

  if (query) {
    candidates = candidates.filter(({ item }) => {
      const nameMatch = item.name && item.name.toLowerCase().includes(query);
      const descMatch = item.description && item.description.toLowerCase().includes(query);
      return nameMatch || descMatch;
    });
  }

  if (category === 'spell') {
    const lvl = document.getElementById('compendium-spell-level').value;
    const cls = document.getElementById('compendium-spell-class').value;
    if (lvl !== '') candidates = candidates.filter(({ item }) => String(item.level) === lvl);
    if (cls) candidates = candidates.filter(({ item }) => item.classes && item.classes.includes(cls));
  }
  if (category === 'monster') {
    const type = document.getElementById('compendium-monster-type').value;
    const cr = document.getElementById('compendium-monster-cr').value;
    if (type) candidates = candidates.filter(({ item }) => item.type === type);
    if (cr) candidates = candidates.filter(({ item }) => String(item.CR) === cr);
  }
  if (category === 'feature') {
    const src = document.getElementById('compendium-feature-source').value;
    if (src) candidates = candidates.filter(({ item }) => item.source === src);
  }

  const shown = candidates.slice(0, 100);
  if (shown.length === 0) {
    resultsEl.innerHTML = '<div style="padding:12px;color:var(--text-muted);">No results found.</div>';
    resultsEl.style.display = 'block'; hintEl.style.display = 'none'; return;
  }

  resultsEl.innerHTML = shown.map(({ type, item }, idx) => {
    let subtitle = '';
    if (type === 'spell') {
      const lvlLabel = item.level === 0 ? 'Cantrip' : `Level ${item.level}`;
      subtitle = `${lvlLabel}${item.school ? ' ' + item.school.charAt(0).toUpperCase() + item.school.slice(1) : ''}${item.classes?.length ? ' · ' + item.classes.join(', ') : ''}`;
    } else if (type === 'monster') {
      subtitle = [item.size, item.type, `CR ${item.CR}`].filter(Boolean).join(' · ');
    } else if (type === 'equipment') {
      subtitle = [item.type, item.category, item.cost].filter(Boolean).join(' · ');
    } else if (type === 'feature') {
      const srcLabel = item.source === 'class' ? 'Class Feature' : item.source === 'species' ? 'Species Trait' : 'Feat';
      subtitle = `${srcLabel}${item.sourceDetail ? ' · ' + item.sourceDetail : ''}`;
    }
    return `<div class="list-item" style="cursor:pointer;" onclick="showCompendiumDetail(compendiumCurrentResults[${idx}].type, compendiumCurrentResults[${idx}].item)">
      <span>${esc(item.name)}</span>
      <span style="color:var(--text-muted);font-size:0.85rem;">${esc(subtitle)}</span>
    </div>`;
  }).join('');

  window.compendiumCurrentResults = shown;
  resultsEl.style.display = 'block'; hintEl.style.display = 'none';
}

function showCompendiumDetail(type, item) {
  closeSearchDropdown();
  const modal = document.getElementById('compendium-modal');
  document.getElementById('compendium-modal-title').textContent = item.name;
  let html = '';
  if (type === 'spell') {
    const lvlLabel = item.level === 0 ? 'Cantrip' : `Level ${item.level}`;
    html += `<div style="color:var(--text-muted);font-size:0.9rem;margin-bottom:12px;">${esc(lvlLabel + (item.school ? ' ' + item.school.charAt(0).toUpperCase() + item.school.slice(1) : ''))}</div>`;
    html += '<div class="stat-block-divider"></div>';
    if (item.classes?.length) html += `<div class="stat-block-line"><strong>Classes</strong> ${esc(item.classes.join(', '))}</div>`;
    if (item.actionType) html += `<div class="stat-block-line"><strong>Casting Time</strong> ${esc(item.actionType)}</div>`;
    if (item.range) html += `<div class="stat-block-line"><strong>Range</strong> ${esc(item.range)}</div>`;
    if (item.components?.length) html += `<div class="stat-block-line"><strong>Components</strong> ${esc(item.components.map(c => c.toUpperCase()).join(', '))}${item.material ? ' (' + esc(item.material) + ')' : ''}</div>`;
    if (item.duration) html += `<div class="stat-block-line"><strong>Duration</strong> ${item.concentration ? 'Concentration, ' : ''}${esc(item.duration)}</div>`;
    const tags = [];
    if (item.ritual) tags.push('Ritual');
    if (item.concentration) tags.push('Concentration');
    if (tags.length) html += `<div style="margin:6px 0;">${tags.map(t => `<span style="display:inline-block;background:var(--accent);color:#fff;border-radius:4px;padding:1px 7px;font-size:0.78rem;margin-right:4px;">${esc(t)}</span>`).join('')}</div>`;
    html += '<div class="stat-block-divider"></div>';
    html += `<div style="margin-top:8px;line-height:1.6;">${esc(item.description)}</div>`;
    if (item.cantripUpgrade) html += `<div style="margin-top:8px;color:var(--text-muted);font-size:0.9rem;line-height:1.6;"><em>${esc(item.cantripUpgrade)}</em></div>`;
  } else if (type === 'monster') {
    html = buildMonsterStatBlockHTML(item);
  } else if (type === 'equipment') {
    html += '<div class="stat-block-divider"></div>';
    if (item.type) html += `<div class="stat-block-line"><strong>Type</strong> ${esc(item.type)}${item.category ? ' — ' + esc(item.category) : ''}</div>`;
    if (item.damage) html += `<div class="stat-block-line"><strong>Damage</strong> ${esc(item.damage)}</div>`;
    if (item.properties) html += `<div class="stat-block-line"><strong>Properties</strong> ${esc(item.properties)}</div>`;
    if (item.cost) html += `<div class="stat-block-line"><strong>Cost</strong> ${esc(item.cost)}</div>`;
    if (item.weight) html += `<div class="stat-block-line"><strong>Weight</strong> ${esc(item.weight)}</div>`;
  } else if (type === 'feature') {
    const srcLabel = item.source === 'class' ? 'Class Feature' : item.source === 'species' ? 'Species Trait' : 'Feat';
    html += `<div style="color:var(--text-muted);font-size:0.9rem;margin-bottom:12px;">${esc(srcLabel)}${item.sourceDetail ? ' · ' + esc(item.sourceDetail) : ''}${item._level ? ' (Level ' + item._level + ')' : ''}</div>`;
    html += '<div class="stat-block-divider"></div>';
    html += `<div style="margin-top:8px;line-height:1.6;">${esc(item.description)}</div>`;
  }
  document.getElementById('compendium-modal-body').innerHTML = html;
  modal.classList.add('active');
}

// --- Util ---
function esc(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML.replace(/'/g, '&#39;').replace(/"/g, '&quot;');
}

// --- TOML Export / Import ---

function serializeCharToTOML(c) {
  const lines = [];
  function tomlStr(v) {
    if (v == null) return '""';
    return '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t') + '"';
  }
  lines.push(`name       = ${tomlStr(c.name)}`);
  lines.push(`class      = ${tomlStr(c.class)}`);
  lines.push(`species    = ${tomlStr(c.species)}`);
  lines.push(`level      = ${parseInt(c.level) || 1}`);
  lines.push(`background = ${tomlStr(c.background)}`);
  lines.push(`HP         = ${parseInt(c.HP) || 0}`);
  lines.push(`AC         = ${parseInt(c.AC) || 0}`);
  lines.push('');
  lines.push(`STR = ${parseInt(c.STR) || 10}`);
  lines.push(`DEX = ${parseInt(c.DEX) || 10}`);
  lines.push(`CON = ${parseInt(c.CON) || 10}`);
  lines.push(`INT = ${parseInt(c.INT) || 10}`);
  lines.push(`WIS = ${parseInt(c.WIS) || 10}`);
  lines.push(`CHA = ${parseInt(c.CHA) || 10}`);
  lines.push('');
  const skills = Array.isArray(c.skills) ? c.skills : [];
  lines.push('[skills]');
  SKILL_ABILITIES.forEach((s, i) => {
    const key = s.name.includes(' ') ? `"${s.name}"` : s.name;
    lines.push(`${key} = ${skills[i] ? 'true' : 'false'}`);
  });
  lines.push('');
  const cur = c.currency || {};
  lines.push('[currency]');
  lines.push(`CP = ${parseInt(cur.CP) || 0}`);
  lines.push(`SP = ${parseInt(cur.SP) || 0}`);
  lines.push(`EP = ${parseInt(cur.EP) || 0}`);
  lines.push(`GP = ${parseInt(cur.GP) || 0}`);
  lines.push(`PP = ${parseInt(cur.PP) || 0}`);
  lines.push('');
  for (const f of (c.features || [])) {
    lines.push('[[features]]');
    lines.push(`name         = ${tomlStr(f.name)}`);
    lines.push(`description  = ${tomlStr(f.description)}`);
    lines.push(`source       = ${tomlStr(f.source)}`);
    lines.push(`sourceDetail = ${tomlStr(f.sourceDetail)}`);
    lines.push('');
  }
  for (const e of (c.equipment || [])) {
    lines.push('[[equipment]]');
    lines.push(`name        = ${tomlStr(e.name)}`);
    lines.push(`type        = ${tomlStr(e.type)}`);
    lines.push(`description = ${tomlStr(e.description)}`);
    lines.push(`quantity    = ${parseInt(e.quantity) || 1}`);
    lines.push('');
  }
  for (const s of (c.spells || [])) {
    lines.push('[[spells]]');
    lines.push(`name          = ${tomlStr(s.name)}`);
    lines.push(`level         = ${parseInt(s.level) || 0}`);
    lines.push(`school        = ${tomlStr(s.school)}`);
    lines.push(`description   = ${tomlStr(s.description)}`);
    lines.push(`castingTime   = ${tomlStr(s.castingTime)}`);
    lines.push(`range         = ${tomlStr(s.range)}`);
    lines.push(`components    = ${tomlStr(s.components)}`);
    lines.push(`concentration = ${s.concentration ? 'true' : 'false'}`);
    lines.push(`ritual        = ${s.ritual ? 'true' : 'false'}`);
    lines.push(`duration      = ${tomlStr(s.duration)}`);
    lines.push('');
  }
  return lines.join('\n');
}

function parseCharFromTOML(text) {
  const rawLines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  function stripComment(line) {
    let inStr = false, escape = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\' && inStr) { escape = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (ch === '#' && !inStr) return line.slice(0, i).trimEnd();
    }
    return line;
  }
  function unescapeStr(s) {
    return s.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  function parseValue(raw) {
    const v = raw.trim();
    if (v === 'true') return true;
    if (v === 'false') return false;
    if (v.startsWith('"') && v.endsWith('"')) return unescapeStr(v.slice(1, -1));
    const n = Number(v);
    if (!isNaN(n) && v !== '') return Math.round(n);
    throw new Error(`Cannot parse value: ${v}`);
  }
  const c = {
    name: '', class: '', species: '', level: 1, background: '',
    HP: 0, AC: 0, STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10,
    skills: Array(18).fill(false), currency: { CP: 0, SP: 0, EP: 0, GP: 0, PP: 0 },
    features: [], equipment: [], spells: []
  };
  const skillMap = {};
  let section = null;
  let currentItem = null;
  function flushItem() {
    if (currentItem !== null && ['features', 'equipment', 'spells'].includes(section)) c[section].push(currentItem);
    currentItem = null;
  }
  for (const rawLine of rawLines) {
    const line = stripComment(rawLine).trim();
    if (line === '') continue;
    const aotMatch = line.match(/^\[\[(\w+)\]\]$/);
    if (aotMatch) { flushItem(); const key = aotMatch[1]; section = ['features', 'equipment', 'spells'].includes(key) ? key : null; if (section) currentItem = {}; continue; }
    const tableMatch = line.match(/^\[(\w+)\]$/);
    if (tableMatch) { flushItem(); section = tableMatch[1]; currentItem = null; continue; }
    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;
    const rawKey = line.slice(0, eqIdx).trim();
    const rawVal = line.slice(eqIdx + 1).trim();
    const key = rawKey.startsWith('"') && rawKey.endsWith('"') ? rawKey.slice(1, -1) : rawKey;
    let value;
    try { value = parseValue(rawVal); } catch (_) { continue; }
    if (section === null) {
      const intFields = ['level', 'HP', 'AC', 'STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
      if (intFields.includes(key)) c[key] = typeof value === 'number' ? value : parseInt(value) || 0;
      else if (typeof c[key] !== 'undefined' || ['name','class','species','background'].includes(key)) c[key] = value;
    } else if (section === 'skills') {
      if (typeof value === 'boolean') skillMap[key] = value;
    } else if (section === 'currency') {
      if (['CP', 'SP', 'EP', 'GP', 'PP'].includes(key) && typeof value === 'number') c.currency[key] = value;
    } else if (currentItem !== null) {
      currentItem[key] = value;
    }
  }
  flushItem();
  c.skills = SKILL_ABILITIES.map(s => skillMap[s.name] === true);
  return c;
}

async function exportCharacter(id) {
  const c = await db.getCharacter(id);
  if (!c) { dialogAlert('Character not found.', 'Error', 'error'); return; }
  const toml = serializeCharToTOML(c);
  const blob = new Blob([toml], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (c.name || 'character').replace(/[^a-z0-9]/gi, '_') + '.toml';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

async function importCharacterFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  event.target.value = '';
  const text = await file.text();
  let c;
  try { c = parseCharFromTOML(text); } catch (e) { dialogAlert('Failed to parse TOML: ' + e.message, 'Import Error', 'error'); return; }
  try {
    await db.putCharacter(c);
    loadCharacters();
  } catch (e) {
    dialogAlert('Import failed: ' + e.message, 'Import Error', 'error');
  }
}

// --- Treasures (IndexedDB) ---
async function loadTreasures() {
  treasurePool = await db.getTreasures();
  renderTreasures();
}

function saveTreasures() {
  db.saveTreasures(treasurePool);
}

function filterTreasureSearch() {
  const query = document.getElementById('treasure-search').value.trim().toLowerCase();
  const typeFilter = document.getElementById('treasure-type-filter').value;
  const resultsEl = document.getElementById('treasure-results');

  if (!query && !typeFilter) { resultsEl.style.display = 'none'; return; }

  let filtered = allEquipment;
  if (typeFilter) filtered = filtered.filter(e => e.type === typeFilter);
  if (query) filtered = filtered.filter(e =>
    e.name.toLowerCase().includes(query) || (e.category && e.category.toLowerCase().includes(query))
  );

  resultsEl.style.display = '';
  resultsEl.innerHTML = filtered.slice(0, 50).map((e, i) => {
    let detail = e.category || '';
    if (e.damage) detail += ` | ${e.damage}`;
    if (e.AC) detail += ` | AC: ${e.AC}`;
    if (e.cost) detail += ` | ${e.cost}`;
    if (e.properties && e.properties !== '—') detail += ` | ${e.properties}`;
    return `
      <div class="list-item" style="cursor:pointer;" onclick="addToTreasures(${i}, this)">
        <div>
          <strong>${esc(e.name)}</strong>
          <span style="color:var(--text-muted);font-size:0.8rem;margin-left:6px;">${esc(detail)}</span>
        </div>
      </div>`;
  }).join('') || '<div style="padding:8px;color:var(--text-muted);">No items found</div>';
  resultsEl._filtered = filtered;
}

function addToTreasures(idx, el) {
  const resultsEl = document.getElementById('treasure-results');
  const e = resultsEl._filtered[idx];
  if (!e) return;
  let desc = '';
  if (e.damage) desc += e.damage;
  if (e.AC) desc += (desc ? ' | ' : '') + 'AC: ' + e.AC;
  if (e.properties && e.properties !== '—') desc += (desc ? ' | ' : '') + e.properties;
  if (e.weight && e.weight !== '—') desc += (desc ? ' | ' : '') + e.weight;
  if (e.cost) desc += (desc ? ' | ' : '') + e.cost;
  treasurePool.push({ name: e.name, type: e.category || e.type, description: desc, quantity: 1 });
  renderTreasures();
  saveTreasures();
}

function removeFromTreasures(idx) { snapshotTreasureSelections(); treasurePool.splice(idx, 1); renderTreasures(); saveTreasures(); }

async function clearTreasures() {
  if (treasurePool.length === 0) return;
  if (!await dialogConfirm('Remove all items from the treasure pool?', 'Clear Treasures')) return;
  treasurePool = [];
  renderTreasures();
  saveTreasures();
}

function snapshotTreasureSelections() {
  treasurePool.forEach((item, i) => {
    const sel = document.getElementById(`treasure-assign-${i}`);
    if (sel) item._assignTo = sel.value || '';
  });
}

function renderTreasures() {
  const container = document.getElementById('treasure-list');
  const emptyMsg = document.getElementById('treasure-empty');
  if (treasurePool.length === 0) { container.innerHTML = ''; emptyMsg.style.display = ''; return; }
  emptyMsg.style.display = 'none';
  container.innerHTML = treasurePool.map((item, idx) => {
    const charOptions = allCharacters.map(c => `<option value="${c._id}">${esc(c.name)}</option>`).join('');
    return `
      <div class="list-item" style="flex-wrap:wrap;align-items:center;padding:10px 12px;gap:8px;">
        <div style="flex:1;min-width:150px;">
          <strong>${esc(item.name)}</strong>
          <span style="color:var(--text-muted);font-size:0.8rem;margin-left:6px;">${esc(item.type || '')}</span>
          <div style="font-size:0.85rem;color:var(--text-muted);margin-top:2px;">${esc(item.description || '')}</div>
        </div>
        <div class="item-actions" style="display:flex;align-items:center;gap:6px;">
          <select id="treasure-assign-${idx}" style="padding:4px 8px;background:var(--bg-input);color:var(--text);border:1px solid var(--border);border-radius:4px;font-size:0.85rem;">
            <option value="">Assign to...</option>
            ${charOptions}
          </select>
          <button type="button" class="btn btn-primary btn-small" onclick="assignTreasure(${idx})">Assign</button>
          <button type="button" class="remove-item" onclick="removeFromTreasures(${idx})">&times;</button>
        </div>
      </div>`;
  }).join('');
  treasurePool.forEach((item, i) => {
    if (item._assignTo) { const sel = document.getElementById(`treasure-assign-${i}`); if (sel) sel.value = item._assignTo; }
  });
}

async function assignTreasure(idx) {
  const item = treasurePool[idx];
  if (!item) return;
  const select = document.getElementById(`treasure-assign-${idx}`);
  const characterId = select.value;
  if (!characterId) { dialogAlert('Select a character first.', 'Assign Treasure', 'info'); return; }

  const c = await db.getCharacter(characterId);
  if (!c) { dialogAlert('Character not found.', 'Error', 'error'); return; }
  const equipment = c.equipment || [];
  if (equipment.length >= 50) { dialogAlert('Equipment limit reached (max 50).', 'Limit Reached', 'error'); return; }
  equipment.push({ name: item.name, type: item.type, description: item.description, quantity: item.quantity });
  c.equipment = equipment;
  await db.putCharacter(c);
  broadcastCharacterToPlayer(characterId);

  snapshotTreasureSelections();
  treasurePool.splice(idx, 1);
  renderTreasures();
  saveTreasures();
  loadCharacters();
}

// --- Shops (IndexedDB) ---
async function loadShops() {
  shops = await db.getShops();
  renderShops();
}

function saveShops() {
  const clean = shops.map(s => ({
    id: s.id, name: s.name,
    items: s.items.map(it => ({
      name: it.name, type: it.type, description: it.description,
      price: it.price, denomination: it.denomination, quantity: it.quantity
    }))
  }));
  db.saveShops(clean);
}

function createShop() {
  const input = document.getElementById('new-shop-name');
  const name = input.value.trim();
  if (!name) return;
  if (shops.length >= 20) { dialogAlert('Maximum 20 shops.', 'Limit Reached', 'error'); return; }
  shops.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8), name, items: [] });
  input.value = '';
  renderShops();
  saveShops();
}

async function deleteShop(shopIdx) {
  if (!await dialogConfirm(`Delete shop "${shops[shopIdx].name}"?`, 'Delete Shop')) return;
  shops.splice(shopIdx, 1);
  renderShops();
  saveShops();
}

function parseCostString(costStr) {
  if (!costStr || costStr === '—') return { price: 0, denomination: 'GP' };
  const match = costStr.match(/^([\d,]+)\s*(CP|SP|EP|GP|PP)/i);
  if (match) return { price: parseInt(match[1].replace(',', '')), denomination: match[2].toUpperCase() };
  return { price: 0, denomination: 'GP' };
}

function filterShopItems(shopIdx) {
  const search = document.getElementById(`shop-search-${shopIdx}`);
  const typeFilter = document.getElementById(`shop-type-${shopIdx}`);
  const resultsEl = document.getElementById(`shop-results-${shopIdx}`);
  if (!search || !resultsEl) return;
  const query = search.value.trim().toLowerCase();
  const type = typeFilter.value;
  if (!query && !type) { resultsEl.style.display = 'none'; return; }
  let filtered = allEquipment;
  if (type) filtered = filtered.filter(e => e.type === type);
  if (query) filtered = filtered.filter(e =>
    e.name.toLowerCase().includes(query) || (e.category && e.category.toLowerCase().includes(query))
  );
  resultsEl.style.display = '';
  resultsEl.innerHTML = filtered.slice(0, 50).map((e, i) => {
    let detail = e.category || '';
    if (e.damage) detail += ` | ${e.damage}`;
    if (e.AC) detail += ` | AC: ${e.AC}`;
    if (e.cost) detail += ` | ${e.cost}`;
    return `<div class="list-item" style="cursor:pointer;" onclick="addItemToShop(${shopIdx}, ${i})">
        <div><strong>${esc(e.name)}</strong><span style="color:var(--text-muted);font-size:0.8rem;margin-left:6px;">${esc(detail)}</span></div>
      </div>`;
  }).join('') || '<div style="padding:8px;color:var(--text-muted);">No items found</div>';
  resultsEl._filtered = filtered;
}

function addItemToShop(shopIdx, filteredIdx) {
  const resultsEl = document.getElementById(`shop-results-${shopIdx}`);
  const e = resultsEl._filtered[filteredIdx];
  if (!e) return;
  let desc = '';
  if (e.damage) desc += e.damage;
  if (e.AC) desc += (desc ? ' | ' : '') + 'AC: ' + e.AC;
  if (e.properties && e.properties !== '—') desc += (desc ? ' | ' : '') + e.properties;
  const { price, denomination } = parseCostString(e.cost);
  shops[shopIdx].items.push({ name: e.name, type: e.category || e.type, description: desc, price, denomination, quantity: -1 });
  renderShops();
  saveShops();
}

function addCustomShopItem(shopIdx) {
  shops[shopIdx].items.push({ name: '', type: '', description: '', price: 0, denomination: 'GP', quantity: -1, _editing: true });
  renderShops();
  const inputs = document.querySelectorAll(`#shop-inventory-${shopIdx} .shop-item-name`);
  if (inputs.length) inputs[inputs.length - 1].focus();
}

function removeShopItem(shopIdx, itemIdx) { shops[shopIdx].items.splice(itemIdx, 1); renderShops(); saveShops(); }

function updateShopItem(shopIdx, itemIdx, field, value) {
  const item = shops[shopIdx].items[itemIdx];
  if (!item) return;
  if (field === 'price') item.price = Math.max(0, parseInt(value) || 0);
  else if (field === 'quantity') item.quantity = parseInt(value) || -1;
  else item[field] = value;
  saveShops();
}

function renderShops() {
  const container = document.getElementById('shops-list');
  const emptyMsg = document.getElementById('shops-empty');
  const savedSelections = {};
  const savedSearches = {};
  shops.forEach((shop, si) => {
    shop.items.forEach((_, ii) => {
      const sel = document.getElementById(`shop-sell-${si}-${ii}`);
      if (sel && sel.value) savedSelections[`${si}-${ii}`] = sel.value;
    });
    const search = document.getElementById(`shop-search-${si}`);
    if (search && search.value) savedSearches[si] = search.value;
  });
  if (shops.length === 0) { container.innerHTML = ''; emptyMsg.style.display = ''; return; }
  emptyMsg.style.display = 'none';
  const charOptions = allCharacters.map(c => `<option value="${c._id}">${esc(c.name)}</option>`).join('');
  container.innerHTML = shops.map((shop, si) => {
    const itemsHtml = shop.items.map((item, ii) => {
      if (item._editing) {
        return `<div class="list-item" style="flex-wrap:wrap;padding:8px 12px;gap:6px;">
            <div class="form-group" style="flex:2;margin:0;"><input type="text" class="shop-item-name" value="${esc(item.name)}" placeholder="Item name" onchange="updateShopItem(${si},${ii},'name',this.value)"></div>
            <div class="form-group" style="flex:0 0 70px;margin:0;"><input type="number" value="${item.price}" min="0" style="width:100%;" onchange="updateShopItem(${si},${ii},'price',this.value)"></div>
            <div class="form-group" style="flex:0 0 70px;margin:0;">
              <select onchange="updateShopItem(${si},${ii},'denomination',this.value)" style="width:100%;">
                ${['CP','SP','EP','GP','PP'].map(d => `<option value="${d}" ${item.denomination === d ? 'selected' : ''}>${d}</option>`).join('')}
              </select>
            </div>
            <div class="form-group" style="flex:2;margin:0;"><input type="text" value="${esc(item.description)}" placeholder="Description" onchange="updateShopItem(${si},${ii},'description',this.value)"></div>
            <button type="button" class="remove-item" onclick="removeShopItem(${si},${ii})">&times;</button>
          </div>`;
      }
      return `<div class="list-item" style="flex-wrap:wrap;align-items:center;padding:8px 12px;gap:6px;">
          <div style="flex:1;min-width:150px;">
            <strong>${esc(item.name)}</strong>
            <span style="color:var(--text-muted);font-size:0.8rem;margin-left:6px;">${esc(item.type || '')}</span>
            <div style="font-size:0.85rem;color:var(--text-muted);margin-top:2px;">${esc(item.description || '')}</div>
          </div>
          <div style="display:flex;align-items:center;gap:4px;font-weight:600;color:var(--gold);min-width:70px;">
            <input type="number" value="${item.price}" min="0" style="width:50px;padding:2px 4px;background:var(--bg-input);color:var(--text);border:1px solid var(--border);border-radius:4px;text-align:right;" onchange="updateShopItem(${si},${ii},'price',this.value)">
            <select onchange="updateShopItem(${si},${ii},'denomination',this.value)" style="padding:2px;background:var(--bg-input);color:var(--text);border:1px solid var(--border);border-radius:4px;font-size:0.85rem;">
              ${['CP','SP','EP','GP','PP'].map(d => `<option value="${d}" ${item.denomination === d ? 'selected' : ''}>${d}</option>`).join('')}
            </select>
          </div>
          <div class="item-actions" style="display:flex;align-items:center;gap:6px;">
            <select id="shop-sell-${si}-${ii}" style="padding:4px 8px;background:var(--bg-input);color:var(--text);border:1px solid var(--border);border-radius:4px;font-size:0.85rem;">
              <option value="">Sell to...</option>
              ${charOptions}
            </select>
            <button type="button" class="btn btn-primary btn-small" onclick="sellShopItem(${si},${ii})">Sell</button>
            <button type="button" class="remove-item" onclick="removeShopItem(${si},${ii})">&times;</button>
          </div>
        </div>`;
    }).join('');
    return `<div class="card" style="margin-top:12px;border-left:3px solid var(--gold);">
        <div class="header-row" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
          <h3 style="margin:0;">${esc(shop.name)}</h3>
          <button class="btn btn-danger btn-small" onclick="deleteShop(${si})">Delete Shop</button>
        </div>
        <div class="search-bar" style="display:flex;gap:8px;margin-bottom:10px;">
          <input type="text" id="shop-search-${si}" placeholder="Search equipment..." oninput="filterShopItems(${si})" style="flex:1;padding:8px 12px;background:var(--bg-input);color:var(--text);border:1px solid var(--border);border-radius:6px;">
          <select id="shop-type-${si}" onchange="filterShopItems(${si})" style="padding:8px;background:var(--bg-input);color:var(--text);border:1px solid var(--border);border-radius:6px;">
            <option value="">All Types</option><option value="Weapon">Weapons</option><option value="Armor">Armor</option><option value="Item">Items</option>
          </select>
        </div>
        <div id="shop-results-${si}" class="list-section" style="max-height:200px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;display:none;"></div>
        <div id="shop-inventory-${si}" style="margin-top:8px;">
          ${itemsHtml || '<p style="color:var(--text-muted);margin:4px 0;">No items in this shop yet.</p>'}
        </div>
        <button type="button" class="btn btn-secondary btn-small" onclick="addCustomShopItem(${si})" style="margin-top:8px;">+ Add Custom</button>
      </div>`;
  }).join('');
  for (const [key, val] of Object.entries(savedSelections)) { const sel = document.getElementById(`shop-sell-${key}`); if (sel) sel.value = val; }
  for (const [si, val] of Object.entries(savedSearches)) { const search = document.getElementById(`shop-search-${si}`); if (search) search.value = val; }
}

async function sellShopItem(shopIdx, itemIdx) {
  const shop = shops[shopIdx];
  if (!shop) return;
  const item = shop.items[itemIdx];
  if (!item) return;
  const select = document.getElementById(`shop-sell-${shopIdx}-${itemIdx}`);
  const characterId = select.value;
  if (!characterId) { dialogAlert('Select a character first.', 'Sell Item', 'info'); return; }

  const c = await db.getCharacter(characterId);
  if (!c) { dialogAlert('Character not found.', 'Error', 'error'); return; }
  const currency = c.currency || { CP: 0, SP: 0, EP: 0, GP: 0, PP: 0 };
  const equipment = c.equipment || [];
  const validDenoms = ['CP', 'SP', 'EP', 'GP', 'PP'];
  const denom = validDenoms.includes(item.denomination) ? item.denomination : 'GP';
  const price = Math.max(0, Math.min(999999, parseInt(item.price) || 0));
  if (price > 0 && (currency[denom] || 0) < price) {
    dialogAlert(`Not enough ${denom} (need ${price}, have ${currency[denom] || 0}).`, 'Insufficient Funds', 'error'); return;
  }
  if (equipment.length >= 50) { dialogAlert('Equipment limit reached (max 50).', 'Limit Reached', 'error'); return; }

  if (price > 0) currency[denom] -= price;
  equipment.push({ name: item.name, type: item.type, description: item.description, quantity: 1 });
  c.currency = currency;
  c.equipment = equipment;
  await db.putCharacter(c);
  broadcastCharacterToPlayer(characterId);

  if (item.quantity > 0) {
    item.quantity--;
    if (item.quantity === 0) shop.items.splice(itemIdx, 1);
    saveShops();
  }

  const charName = allCharacters.find(ch => ch._id === characterId)?.name || 'character';
  renderShops();
  loadCharacters();

  const newBtn = document.getElementById(`shop-sell-${shopIdx}-${itemIdx}`)?.parentElement?.querySelector('.btn-primary');
  if (newBtn) {
    const orig = newBtn.textContent;
    newBtn.textContent = `Sold to ${charName}!`;
    newBtn.style.background = 'var(--gold)';
    newBtn.disabled = true;
    setTimeout(() => { newBtn.textContent = orig; newBtn.style.background = ''; newBtn.disabled = false; }, 2000);
  }
}

// --- Notes (IndexedDB) ---
async function loadNotes() {
  const notes = await db.getNotes();
  document.getElementById('notes-editor').value = notes;
}

async function saveNotes() {
  const notes = document.getElementById('notes-editor').value;
  await db.saveNotes(notes);
  document.getElementById('notes-save-status').textContent = 'Saved';
  setTimeout(() => { document.getElementById('notes-save-status').textContent = ''; }, 2000);
}
