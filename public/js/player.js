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

const ABILITIES = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];

function calcProfBonus(level) {
  return Math.ceil(level / 4) + 1;
}

// Extract DM username from URL: /join/<dmUsername>
const dmUsername = window.location.pathname.split('/').pop();
let sessionPin = '';
let activeCharacterId = null;
let eventSource = null;

// Player-local session state (preserved across DM updates)
let playerState = {
  currentHP: null,
  tempHP: 0,
  slotChecks: {},   // { "1-0": true, "2-1": false, ... }
  coinDeltas: {}    // { CP: 0, SP: 0, ... } — difference from saved value
};

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-join').addEventListener('click', joinSession);
  document.getElementById('player-pin').addEventListener('keydown', e => {
    if (e.key === 'Enter') joinSession();
  });

  // Tab switching
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(tab.dataset.tab).classList.add('active');
    });
  });
});

async function joinSession() {
  sessionPin = document.getElementById('player-pin').value.trim();
  const errorEl = document.getElementById('join-error');
  errorEl.style.display = 'none';

  if (!sessionPin) { errorEl.textContent = 'Please enter the PIN'; errorEl.style.display = 'block'; return; }

  const res = await fetch(`/api/player/${dmUsername}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: sessionPin })
  });
  const data = await res.json();
  if (!res.ok) {
    errorEl.textContent = data.error;
    errorEl.style.display = 'block';
    return;
  }

  // Connect to SSE
  connectSSE();

  // Show character picker
  document.getElementById('step-join').style.display = 'none';
  document.getElementById('step-pick').style.display = '';
  await renderCharacterPicker(data);
}

function connectSSE() {
  if (eventSource) eventSource.close();
  eventSource = new EventSource(`/api/player/${dmUsername}/events`);
  eventSource.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'character-updated' && activeCharacterId && msg.characterId === activeCharacterId) {
      showCharacterSheet(activeCharacterId);
    }
  };
}

async function renderCharacterPicker(session) {
  const container = document.getElementById('pick-list');
  const charIds = Object.keys(session.characters);

  const characters = await Promise.all(
    charIds.map(async id => {
      const res = await fetch(`/api/player/${dmUsername}/characters/${id}`);
      const c = await res.json();
      c._claimed = session.characters[id].claimedBy || null;
      return c;
    })
  );

  container.innerHTML = characters.map(c => {
    if (c._claimed) {
      return `
        <div class="char-item" style="opacity:0.5;cursor:default;">
          <div class="char-info">
            <span class="char-name">${esc(c.name)}</span>
            <span class="char-meta">Level ${c.level} ${esc(c.species || '')} ${esc(c.class)}</span>
          </div>
          <span style="color:var(--text-muted);font-size:0.85rem;">Claimed</span>
        </div>
      `;
    }
    return `
      <div class="char-item" onclick="claimAndShow('${c._id}')">
        <div class="char-info">
          <span class="char-name">${esc(c.name)}</span>
          <span class="char-meta">Level ${c.level} ${esc(c.species || '')} ${esc(c.class)}</span>
        </div>
        <span style="color:var(--gold);">Select</span>
      </div>
    `;
  }).join('');

  if (characters.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted)">No characters available.</p>';
  }
}

async function claimAndShow(characterId) {
  const res = await fetch(`/api/player/${dmUsername}/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: sessionPin, characterId, playerName: 'player-' + Date.now() })
  });
  if (!res.ok) {
    const data = await res.json();
    alert(data.error || 'Could not select character');
    return;
  }
  showCharacterSheet(characterId);
}

async function showCharacterSheet(characterId) {
  const isFirstLoad = activeCharacterId !== characterId;
  activeCharacterId = characterId;

  const res = await fetch(`/api/player/${dmUsername}/characters/${characterId}`);
  const c = await res.json();

  document.getElementById('step-join').style.display = 'none';
  document.getElementById('step-pick').style.display = 'none';
  document.getElementById('step-sheet').style.display = '';

  const bg = c.background ? ` - ${c.background}` : '';
  const h1 = document.querySelector('h1');
  h1.textContent = `${c.name} ${c.species || ''} ${c.class} lvl ${c.level}${bg}`;
  h1.classList.add('char-title');

  const profBonus = calcProfBonus(c.level);
  const maxHP = c.HP || 0;

  // Preserve or initialize player-local HP
  if (isFirstLoad || playerState.currentHP === null) {
    playerState.currentHP = maxHP;
    playerState.tempHP = 0;
    playerState.slotChecks = {};
    playerState.coinDeltas = {};
  }
  // Clamp currentHP to new maxHP if DM changed it
  if (playerState.currentHP > maxHP) playerState.currentHP = maxHP;

  let currentHP = playerState.currentHP;
  let tempHP = playerState.tempHP;

  function renderHP() {
    playerState.currentHP = currentHP;
    playerState.tempHP = tempHP;
    document.getElementById('hp-current').textContent = currentHP;
    document.getElementById('hp-max-val').textContent = maxHP;
    document.getElementById('hp-temp').textContent = tempHP;
  }

  document.getElementById('combat-stats').innerHTML = `
    <div class="combat-stat">
      <div class="label">Hit Points</div>
      <div class="hp-tracker">
        <div class="hp-row">
          <button class="hp-btn" id="hp-down">\u2212</button>
          <span class="value" id="hp-current">${currentHP}</span>
          <button class="hp-btn" id="hp-up">+</button>
        </div>
        <div class="hp-max">/ <span id="hp-max-val">${maxHP}</span></div>
        <div class="hp-temp-row">
          <button class="hp-btn hp-btn-sm" id="temp-down">\u2212</button>
          <span class="hp-temp-label">Temp <span id="hp-temp">${tempHP}</span></span>
          <button class="hp-btn hp-btn-sm" id="temp-up">+</button>
        </div>
      </div>
    </div>
    <div class="combat-stat">
      <div class="label">Armor Class</div>
      <div class="value">${c.AC}</div>
    </div>
  `;

  document.getElementById('prof-bonus-label').textContent = `(Proficiency Bonus: +${profBonus})`;

  document.getElementById('hp-down').onclick = () => { if (currentHP > 0) { currentHP--; renderHP(); } };
  document.getElementById('hp-up').onclick = () => { if (currentHP < maxHP) { currentHP++; renderHP(); } };
  document.getElementById('temp-down').onclick = () => { if (tempHP > 0) { tempHP--; renderHP(); } };
  document.getElementById('temp-up').onclick = () => { tempHP++; renderHP(); };

  document.getElementById('ability-grid').innerHTML = ABILITIES.map(a => {
    const score = c[a] || 10;
    const mod = Math.floor((score - 10) / 2);
    const modStr = mod >= 0 ? `+${mod}` : `${mod}`;
    return `
      <div class="stat-box">
        <div class="stat-label">${a}</div>
        <div class="stat-value">${score}</div>
        <div class="stat-mod">${modStr}</div>
      </div>
    `;
  }).join('');

  document.getElementById('skills-grid').innerHTML = SKILL_ABILITIES.map((s, i) => {
    const abilityScore = c[s.ability] || 10;
    const abilityMod = Math.floor((abilityScore - 10) / 2);
    const proficient = c.skills && c.skills[i];
    const total = abilityMod + (proficient ? profBonus : 0);
    const modStr = total >= 0 ? `+${total}` : `${total}`;
    return `
      <div class="skill-item">
        <span>${proficient ? '<strong style="color:var(--accent);">*</strong> ' : ''}${s.name} <span style="color:var(--text-muted);font-size:0.75rem;">(${s.ability})</span></span>
        <span class="skill-mod">${modStr}</span>
      </div>
    `;
  }).join('');

  const features = c.features || [];
  document.getElementById('features-list').innerHTML = features.map(f => {
    if (typeof f === 'string') return `<li>${esc(f)}</li>`;
    return `<li><strong>${esc(f.name)}</strong>${f.sourceDetail ? ' <span style="color:var(--text-muted);font-size:0.8rem;">(' + esc(f.sourceDetail) + ')</span>' : ''}${f.description ? '<br><span style="font-size:0.9rem;color:var(--text-muted);">' + esc(f.description) + '</span>' : ''}</li>`;
  }).join('');

  // --- Currency ---
  const cur = c.currency || {};
  const coins = ['CP','SP','EP','GP','PP'];
  const coinValues = {};
  coins.forEach(k => {
    const saved = cur[k] || 0;
    const delta = playerState.coinDeltas[k] || 0;
    coinValues[k] = Math.max(0, saved + delta);
  });

  function renderCurrency() {
    coins.forEach(k => {
      document.getElementById(`coin-${k}`).textContent = coinValues[k];
      // Update delta relative to saved
      playerState.coinDeltas[k] = coinValues[k] - (cur[k] || 0);
    });
  }

  const currencyHtml = `
    <div class="currency-tracker">
      ${coins.map(k => `
        <div class="coin-group">
          <div class="coin-label">${k}</div>
          <div class="coin-controls">
            <button class="hp-btn hp-btn-sm" data-coin-down="${k}">\u2212</button>
            <span class="coin-value" id="coin-${k}">${coinValues[k]}</span>
            <button class="hp-btn hp-btn-sm" data-coin-up="${k}">+</button>
          </div>
        </div>
      `).join('')}
    </div>
  `;

  const equipment = c.equipment || [];
  const equipHtml = equipment.length === 0
    ? '<p style="color:var(--text-muted)">No equipment.</p>'
    : equipment.map(eq => `
      <div class="item-card">
        <h4>${esc(eq.name)} ${eq.quantity > 1 ? `(x${eq.quantity})` : ''}</h4>
        <div class="meta">${esc(eq.type)}</div>
        <div class="desc">${esc(eq.description)}</div>
      </div>
    `).join('');

  document.getElementById('equipment-display').innerHTML = currencyHtml + '<h3 style="margin-top:16px;">Equipment</h3>' + equipHtml;

  coins.forEach(k => {
    document.querySelector(`[data-coin-down="${k}"]`).onclick = () => { if (coinValues[k] > 0) { coinValues[k]--; renderCurrency(); } };
    document.querySelector(`[data-coin-up="${k}"]`).onclick = () => { coinValues[k]++; renderCurrency(); };
  });

  // --- Spellcasting Info ---
  const spellcastingAbility = SPELLCASTING_ABILITY[c.class] || null;
  const spellcastingInfoEl = document.getElementById('spellcasting-info');
  const spellSlotsEl = document.getElementById('spell-slots-display');

  if (spellcastingAbility) {
    const abilityScore = c[spellcastingAbility] || 10;
    const abilityMod = Math.floor((abilityScore - 10) / 2);
    const spellSaveDC = 8 + profBonus + abilityMod;
    const spellAttack = profBonus + abilityMod;
    const attackStr = spellAttack >= 0 ? `+${spellAttack}` : `${spellAttack}`;

    spellcastingInfoEl.innerHTML = `
      <div class="combat-stats" style="margin-bottom:16px;">
        <div class="combat-stat">
          <div class="label">Spellcasting Ability</div>
          <div class="value" style="font-size:1.4rem;">${spellcastingAbility}</div>
        </div>
        <div class="combat-stat">
          <div class="label">Spell Save DC</div>
          <div class="value">${spellSaveDC}</div>
        </div>
        <div class="combat-stat">
          <div class="label">Spell Attack</div>
          <div class="value">${attackStr}</div>
        </div>
      </div>
    `;

    // Spell slots
    const slotInfo = getSpellSlots(c.class, c.level);
    if (slotInfo.type === 'pact') {
      spellSlotsEl.innerHTML = `
        <div class="item-card" style="margin-bottom:16px;">
          <h4>Pact Magic <span style="font-size:0.8rem;font-weight:normal;color:var(--text-muted);">(recharge on short rest)</span></h4>
          <div style="display:flex;gap:6px;align-items:center;margin-top:8px;">
            <span class="stat-label" style="margin:0;">Level ${slotInfo.slotLevel}</span>
            ${Array.from({length: slotInfo.slots}, (_, j) => {
              const key = `pact-${j}`;
              const checked = playerState.slotChecks[key] ? 'checked' : '';
              return `
              <label class="slot-bubble">
                <input type="checkbox" data-slot="${key}" ${checked}>
                <span class="slot-circle"></span>
              </label>`;
            }).join('')}
          </div>
        </div>
      `;
    } else if (slotInfo.slots.length > 0) {
      spellSlotsEl.innerHTML = `
        <div style="margin-bottom:16px;">
          ${slotInfo.slots.map((count, i) => `
            <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px;">
              <span class="stat-label" style="min-width:32px;margin:0;">${i + 1}${ordinal(i + 1)}</span>
              ${Array.from({length: count}, (_, j) => {
                const key = `${i + 1}-${j}`;
                const checked = playerState.slotChecks[key] ? 'checked' : '';
                return `
                <label class="slot-bubble">
                  <input type="checkbox" data-slot="${key}" ${checked}>
                  <span class="slot-circle"></span>
                </label>`;
              }).join('')}
            </div>
          `).join('')}
        </div>
      `;
    } else {
      spellSlotsEl.innerHTML = '';
    }

    // Persist slot check state on change
    spellSlotsEl.querySelectorAll('input[data-slot]').forEach(cb => {
      cb.addEventListener('change', () => {
        playerState.slotChecks[cb.dataset.slot] = cb.checked;
      });
    });
  } else {
    spellcastingInfoEl.innerHTML = '';
    spellSlotsEl.innerHTML = '';
  }

  // --- Spell list ---
  const spells = c.spells || [];
  const spellsByLevel = {};
  spells.forEach(sp => {
    const key = sp.level === 0 ? 0 : sp.level;
    if (!spellsByLevel[key]) spellsByLevel[key] = [];
    spellsByLevel[key].push(sp);
  });

  if (spells.length === 0) {
    document.getElementById('spells-display').innerHTML = spellcastingAbility
      ? '<p style="color:var(--text-muted)">No spells prepared.</p>'
      : '<p style="color:var(--text-muted)">This class does not use spells.</p>';
  } else {
    let spellHtml = '';
    for (const level of Object.keys(spellsByLevel).sort((a, b) => a - b)) {
      const label = level === '0' ? 'Cantrips' : `Level ${level}`;
      spellHtml += `<h3 style="margin:16px 0 8px;">${label}</h3>`;
      spellHtml += spellsByLevel[level].map(sp => {
        const tags = [];
        if (sp.concentration) tags.push('Concentration');
        if (sp.ritual) tags.push('Ritual');
        return `
          <div class="item-card">
            <h4>${esc(sp.name)} ${tags.length ? '<span style="color:var(--accent);font-size:0.8rem;font-weight:normal;">(' + tags.join(', ') + ')</span>' : ''}</h4>
            <div class="meta">
              ${esc(sp.school)} |
              Cast: ${esc(sp.castingTime)} |
              Range: ${esc(sp.range)} |
              Duration: ${esc(sp.duration || 'Instantaneous')} |
              Components: ${esc(sp.components)}
            </div>
            <div class="desc">${esc(sp.description)}</div>
          </div>
        `;
      }).join('');
    }
    document.getElementById('spells-display').innerHTML = spellHtml;
  }
}

function ordinal(n) {
  if (n === 1) return 'st';
  if (n === 2) return 'nd';
  if (n === 3) return 'rd';
  return 'th';
}

function esc(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
