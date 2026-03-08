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

function getProficiencyBonus() {
  const level = parseInt(document.getElementById('f-level')?.value) || 1;
  return Math.ceil(level / 4) + 1;
}

function getAbilityMod(ability) {
  const score = parseInt(document.getElementById(`f-${ability}`)?.value) || 10;
  return Math.floor((score - 10) / 2);
}

function calcProfBonus(level) {
  return Math.ceil(level / 4) + 1;
}

let currentSession = null;
let allSpells = [];
let selectedSpells = [];
let allFeatures = []; // unified list: { name, description, source, sourceDetail }
let selectedFeatures = [];
let allEquipment = [];
let allMonsters = [];
let battlefieldMonsters = []; // { ...monsterData, _uid, currentHP }

function getToken() {
  return localStorage.getItem('dmToken');
}

function authHeaders() {
  return {
    'Content-Type': 'application/json',
    'X-DM-Token': getToken()
  };
}

// --- Init ---
document.addEventListener('DOMContentLoaded', async () => {
  if (!getToken()) {
    window.location.href = '/dm/login';
    return;
  }

  document.getElementById('dm-name').textContent = localStorage.getItem('dmUsername') || '';

  populateDropdowns();
  renderSavingThrows();
  renderSkillInputs();
  loadCharacters();
  checkExistingSession();
  await Promise.all([loadSpellsDB(), loadFeaturesDB(), loadEquipmentDB(), loadMonstersDB()]);
  await loadBattlefield();

  document.getElementById('btn-new-session').addEventListener('click', createSession);
  document.getElementById('btn-show-qr').addEventListener('click', showQR);
  document.getElementById('btn-end-session').addEventListener('click', endSession);
  document.getElementById('btn-add-char').addEventListener('click', () => openCharModal());
  document.getElementById('char-form').addEventListener('submit', saveCharacter);
  document.getElementById('btn-logout').addEventListener('click', logout);

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

  // Update saving throw proficiencies when class changes
  document.getElementById('f-class').addEventListener('change', () => {
    renderSavingThrows();
    autoSetHP();
  });
  document.getElementById('f-CON').addEventListener('input', autoSetHP);

  // Feature search — also refresh when class/species/level change
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
    });
  });

  // Battlefield
  document.getElementById('monster-search').addEventListener('input', filterMonsters);
  document.getElementById('monster-type-filter').addEventListener('change', filterMonsters);
  document.getElementById('monster-cr-filter').addEventListener('change', filterMonsters);
  document.getElementById('btn-clear-battlefield').addEventListener('click', clearBattlefield);

  // Equipment search
  document.getElementById('equip-search').addEventListener('input', filterEquipment);
  document.getElementById('equip-type-filter').addEventListener('change', filterEquipment);

  // Spell search
  document.getElementById('spell-search').addEventListener('input', filterSpells);
  document.getElementById('spell-level-filter').addEventListener('change', filterSpells);
  document.getElementById('spell-class-filter').addEventListener('change', filterSpells);
});

function logout() {
  localStorage.removeItem('dmToken');
  localStorage.removeItem('dmUsername');
  window.location.href = '/dm/login';
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
  const [featsRes, traitsRes, classRes] = await Promise.all([
    fetch('/api/feats'),
    fetch('/api/species-traits'),
    fetch('/api/class-features')
  ]);
  const feats = await featsRes.json();
  const speciesTraits = await traitsRes.json();
  const classFeatures = await classRes.json();

  allFeatures = [];

  // Feats
  feats.forEach(f => {
    allFeatures.push({
      name: f.name,
      description: f.description,
      source: 'feat',
      sourceDetail: f.category + (f.prerequisite ? ` (${f.prerequisite})` : '')
    });
  });

  // Species traits
  for (const [species, traits] of Object.entries(speciesTraits)) {
    traits.forEach(t => {
      allFeatures.push({
        name: t.name,
        description: t.description,
        source: 'species',
        sourceDetail: species
      });
    });
  }

  // Class features
  for (const [className, features] of Object.entries(classFeatures)) {
    features.forEach(f => {
      allFeatures.push({
        name: f.name,
        description: f.description,
        source: 'class',
        sourceDetail: `${className} (lvl ${f.level})`,
        _className: className,
        _level: f.level
      });
    });
  }

  // Species traits — tag with species name
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

  // If no search and no filter, auto-show features matching current class/species/level
  if (!query && !sourceFilter && !charClass && !charSpecies) {
    resultsEl.style.display = 'none';
    return;
  }

  let filtered = allFeatures.filter(f => {
    // Exclude already selected
    if (selectedFeatures.find(s => s.name === f.name && s.sourceDetail === f.sourceDetail)) return false;
    // Text search
    if (query && !f.name.toLowerCase().includes(query) && !f.description.toLowerCase().includes(query)) return false;
    // Source filter
    if (sourceFilter && f.source !== sourceFilter) return false;

    // When no text search, auto-filter to relevant features only
    if (!query) {
      if (f.source === 'class') {
        return f._className === charClass && f._level <= charLevel;
      }
      if (f.source === 'species') {
        return f._speciesName === charSpecies;
      }
      // Feats always show (they're general)
      return f.source === 'feat';
    }
    return true;
  });

  // Sort: matching class/species first, then by level
  filtered.sort((a, b) => {
    const aMatch = (a.source === 'class' && a._className === charClass) ||
                   (a.source === 'species' && a._speciesName === charSpecies);
    const bMatch = (b.source === 'class' && b._className === charClass) ||
                   (b.source === 'species' && b._speciesName === charSpecies);
    if (aMatch && !bMatch) return -1;
    if (!aMatch && bMatch) return 1;
    // Within class features, sort by level
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
    // Store filtered list for index reference
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

function updateCustomFeature(idx, input) {
  selectedFeatures[idx].name = input.value.trim();
}
function updateCustomFeatureDesc(idx, input) {
  selectedFeatures[idx].description = input.value.trim();
}

function addCustomFeature() {
  selectedFeatures.push({ name: '', description: '', source: 'custom', sourceDetail: 'Custom', _editing: true });
  renderSelectedFeatures();
  // Focus the new name input
  const inputs = document.querySelectorAll('#features-selected .feat-name');
  if (inputs.length) inputs[inputs.length - 1].focus();
}

function renderSelectedFeatures() {
  const container = document.getElementById('features-selected');
  if (selectedFeatures.length === 0) {
    container.innerHTML = '';
    return;
  }
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
  const res = await fetch('/api/spells');
  allSpells = await res.json();
}

function filterSpells() {
  const query = document.getElementById('spell-search').value.toLowerCase().trim();
  const levelFilter = document.getElementById('spell-level-filter').value;
  const classFilter = document.getElementById('spell-class-filter').value;
  const resultsEl = document.getElementById('spell-results');

  if (!query && !levelFilter && !classFilter) {
    resultsEl.style.display = 'none';
    return;
  }

  let filtered = allSpells.filter(sp => {
    if (query && !sp.name.toLowerCase().includes(query)) return false;
    if (levelFilter !== '' && sp.level !== parseInt(levelFilter)) return false;
    if (classFilter && !sp.classes.includes(classFilter)) return false;
    // Hide already selected
    if (selectedSpells.find(s => s.name === sp.name)) return false;
    return true;
  });

  filtered = filtered.slice(0, 50);

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
  filterSpells(); // refresh results to hide the selected one
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
    name: '',
    level: 0,
    school: 'Custom',
    description: '',
    actionType: '',
    castingTime: '',
    range: '',
    components: '',
    concentration: false,
    ritual: false,
    duration: '',
    _editing: true
  });
  renderSelectedSpells();
  const inputs = document.querySelectorAll('#spells-selected .spell-name');
  if (inputs.length) inputs[inputs.length - 1].focus();
}

function updateCustomSpellField(idx, field, input) {
  if (field === 'level') {
    selectedSpells[idx].level = parseInt(input.value) || 0;
  } else {
    selectedSpells[idx][field] = input.value.trim();
  }
}

function renderSelectedSpells() {
  const container = document.getElementById('spells-selected');
  if (selectedSpells.length === 0) {
    container.innerHTML = '';
    return;
  }

  // Group by level
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

// --- Characters ---
async function loadCharacters() {
  const res = await fetch('/api/characters', { headers: authHeaders() });
  if (res.status === 401) return logout();
  const chars = await res.json();
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
      <div style="display:flex;gap:6px;">
        <button class="btn btn-secondary btn-small" onclick="event.stopPropagation();openCharModal('${c._id}')">Edit</button>
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
    const res = await fetch(`/api/characters/${id}`, { headers: authHeaders() });
    const c = await res.json();
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
    // Load features
    if (c.features) {
      c.features.forEach(f => {
        if (typeof f === 'string') {
          // Legacy: plain string features
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
    // Load spells: match by name from the DB, or keep raw data for custom spells
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
}

function closeCharModal() {
  document.getElementById('char-modal').classList.remove('active');
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
      name: sp.name,
      level: sp.level,
      school: sp.school,
      description: sp.description,
      castingTime: sp.actionType || sp.castingTime || '',
      range: sp.range || '',
      components: Array.isArray(sp.components) ? sp.components.join(', ').toUpperCase() : (sp.components || ''),
      concentration: sp.concentration || false,
      ritual: sp.ritual || false,
      duration: sp.duration || ''
    }))
  };

  if (id) {
    await fetch(`/api/characters/${id}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify(character)
    });
  } else {
    await fetch('/api/characters', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(character)
    });
  }
  closeCharModal();
  loadCharacters();
}

async function deleteCharacter(id) {
  if (!confirm('Delete this character?')) return;
  await fetch(`/api/characters/${id}`, { method: 'DELETE', headers: authHeaders() });
  loadCharacters();
}

// --- Equipment DB & Picker ---
async function loadEquipmentDB() {
  const res = await fetch('/api/equipment');
  allEquipment = await res.json();
}

function filterEquipment() {
  const query = document.getElementById('equip-search').value.trim().toLowerCase();
  const typeFilter = document.getElementById('equip-type-filter').value;
  const resultsEl = document.getElementById('equip-results');

  if (!query && !typeFilter) { resultsEl.style.display = 'none'; return; }

  let filtered = allEquipment;
  if (typeFilter) filtered = filtered.filter(e => e.type === typeFilter);
  if (query) filtered = filtered.filter(e =>
    e.name.toLowerCase().includes(query) ||
    (e.category && e.category.toLowerCase().includes(query))
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

  // Store filtered list for index reference
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

  addEquipmentRow({
    name: e.name,
    type: e.category || e.type,
    description: desc,
    quantity: 1
  });
}

// --- Equipment rows ---
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
      name,
      type: row.querySelector('.eq-type').value.trim(),
      description: row.querySelector('.eq-desc').value.trim(),
      quantity: parseInt(row.querySelector('.eq-qty').value) || 1
    });
  });
  return items;
}

// --- Sessions ---
async function checkExistingSession() {
  const res = await fetch('/api/sessions/mine', { headers: authHeaders() });
  if (res.ok) {
    currentSession = await res.json();
    showSessionActive();
  }
}

function showSessionActive() {
  document.getElementById('session-status').textContent = `Session active (PIN: ${currentSession.pin})`;
  document.getElementById('btn-new-session').style.display = 'none';
  document.getElementById('btn-show-qr').style.display = '';
  document.getElementById('btn-end-session').style.display = '';
}

async function createSession() {
  const pin = prompt('Set a PIN for players to join (min 3 characters):');
  if (!pin || pin.length < 3) return alert('PIN must be at least 3 characters');

  const res = await fetch('/api/sessions', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ pin })
  });
  if (!res.ok) {
    const data = await res.json();
    return alert(data.error);
  }
  currentSession = await res.json();
  showSessionActive();
  showQR();
}

async function endSession() {
  if (!confirm('End the current session? Players will be disconnected.')) return;
  await fetch('/api/sessions', { method: 'DELETE', headers: authHeaders() });
  currentSession = null;
  document.getElementById('session-status').textContent = 'No active session';
  document.getElementById('btn-new-session').style.display = '';
  document.getElementById('btn-show-qr').style.display = 'none';
  document.getElementById('btn-end-session').style.display = 'none';
}

async function showQR() {
  if (!currentSession) return;
  const res = await fetch('/api/sessions/qr', { headers: authHeaders() });
  const data = await res.json();
  document.getElementById('qr-img').src = data.qr;
  document.getElementById('qr-url').textContent = data.url;
  document.getElementById('qr-pin').textContent = data.pin;
  document.getElementById('qr-modal').classList.add('active');
}

// --- Monsters & Battlefield ---
let _bfUid = 0;

async function loadMonstersDB() {
  const res = await fetch('/api/monsters');
  allMonsters = await res.json();

  // Populate type filter
  const types = [...new Set(allMonsters.map(m => m.type).filter(Boolean))].sort();
  const typeSelect = document.getElementById('monster-type-filter');
  types.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t; opt.textContent = t;
    typeSelect.appendChild(opt);
  });

  // Populate CR filter
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
    const res = await fetch('/api/battlefield', { headers: authHeaders() });
    if (!res.ok) return;
    const saved = await res.json();
    battlefieldMonsters = [];
    saved.forEach(entry => {
      const m = allMonsters.find(m => m.name === entry.name);
      if (!m) return;
      battlefieldMonsters.push({
        ...m,
        _uid: ++_bfUid,
        _label: entry._label || m.name,
        currentHP: entry.currentHP != null ? entry.currentHP : m.HP
      });
    });
    // Fix labels
    relabelBattlefield();
    renderBattlefield();
  } catch (e) {}
}

function saveBattlefield() {
  const compact = battlefieldMonsters.map(m => ({
    name: m.name,
    _label: m._label,
    currentHP: m.currentHP
  }));
  fetch('/api/battlefield', {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(compact)
  }).catch(() => {});
}

function relabelBattlefield() {
  const nameCounts = {};
  battlefieldMonsters.forEach(m => { nameCounts[m.name] = (nameCounts[m.name] || 0) + 1; });
  for (const name of Object.keys(nameCounts)) {
    const instances = battlefieldMonsters.filter(b => b.name === name);
    if (instances.length === 1) {
      instances[0]._label = name;
    } else {
      instances.forEach((inst, i) => { inst._label = `${name} #${i + 1}`; });
    }
  }
}

function addToBattlefield(idx) {
  const m = allMonsters[idx];
  if (!m) return;
  battlefieldMonsters.push({
    ...m,
    _uid: ++_bfUid,
    _label: m.name,
    currentHP: m.HP
  });
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

function clearBattlefield() {
  if (battlefieldMonsters.length === 0) return;
  if (!confirm('Remove all monsters from the battlefield?')) return;
  battlefieldMonsters = [];
  renderBattlefield();
  saveBattlefield();
}

function renderBattlefield() {
  const container = document.getElementById('battlefield-list');
  const emptyMsg = document.getElementById('battlefield-empty');

  if (battlefieldMonsters.length === 0) {
    container.innerHTML = '';
    emptyMsg.style.display = '';
    return;
  }
  emptyMsg.style.display = 'none';

  container.innerHTML = battlefieldMonsters.map(m => {
    const hpPercent = Math.max(0, (m.currentHP / m.HP) * 100);
    let hpColor = 'var(--gold)';
    if (hpPercent <= 25) hpColor = '#c0392b';
    else if (hpPercent <= 50) hpColor = '#e67e22';
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

function showMonsterStats(uid) {
  const m = battlefieldMonsters.find(b => b._uid === uid);
  if (!m) return;

  document.getElementById('monster-modal-title').textContent = m._label;

  const abilityMod = (score) => {
    const mod = Math.floor((score - 10) / 2);
    return mod >= 0 ? `+${mod}` : `${mod}`;
  };

  let html = `
    <div style="color:var(--text-muted);font-size:0.9rem;margin-bottom:12px;">
      ${[m.size, m.type, m.alignment].filter(Boolean).join(', ')}
    </div>
    <div class="stat-block-divider"></div>
    <div class="stat-block-line"><strong>AC</strong> ${m.AC}</div>
    <div class="stat-block-line"><strong>HP</strong> ${m.HP}${m.hitDice ? ' (' + m.hitDice + ')' : ''}</div>
    <div class="stat-block-line"><strong>Speed</strong> ${m.speed || '30 ft.'}</div>
    <div class="stat-block-divider"></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0;">
      ${['STR','DEX','CON','INT','WIS','CHA'].map(a => `
        <div class="stat-box" style="min-width:55px;">
          <div class="stat-label">${a}</div>
          <div class="stat-value" style="font-size:1.1rem;">${m[a] || 10}</div>
          <div class="stat-mod">${abilityMod(m[a] || 10)}</div>
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

  document.getElementById('monster-stat-block').innerHTML = html;
  document.getElementById('monster-modal').classList.add('active');
}

// --- Util ---
function esc(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
