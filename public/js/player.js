// --- Dialog helper ---
function dialogAlert(message, title, type = 'info') {
  const icons = { warn: '\u26A0', info: '\u2139\uFE0F', success: '\u2714', error: '\u2718' };
  const overlay = document.getElementById('dialog-overlay');
  document.getElementById('dialog-icon').textContent = icons[type] || icons.info;
  document.getElementById('dialog-icon').className = 'dialog-icon ' + type;
  document.getElementById('dialog-title').textContent = title || 'Notice';
  document.getElementById('dialog-message').textContent = message;
  const btns = document.getElementById('dialog-buttons');
  btns.innerHTML = '<button class="btn btn-primary btn-small">OK</button>';
  btns.querySelector('button').addEventListener('click', () => overlay.classList.remove('active'));
  overlay.classList.add('active');
}

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

// Extract roomId from URL: /join/<roomId>
const roomId = window.location.pathname.split('/').pop();
let sessionPin = '';
let activeCharacterId = null;
let playerPeer = null;
let currentCharacter = null; // cached character data from DM
let currentHPState = null;   // cached HP state from DM
let joinTimeout = null;
let _isRejoining = false;    // true when auto-reconnecting with saved session

// Player-local session state (preserved across DM updates)
let playerState = {
  slotChecks: {}   // { "1-0": true, "2-1": false, ... }
};

// --- Session persistence helpers ---
const SESSION_KEY = 'dnd-session-' + roomId;

function saveSession(pin, characterId) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ pin, characterId, savedAt: Date.now() }));
  } catch (e) {}
}

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
}

// --- Disconnect banner helpers ---
function showBanner(text, isError = false) {
  const banner = document.getElementById('disconnect-banner');
  if (!banner) return;
  banner.textContent = text;
  banner.style.background = isError ? 'var(--accent)' : '#555';
  banner.style.display = 'block';
}

function hideBanner() {
  const banner = document.getElementById('disconnect-banner');
  if (banner) banner.style.display = 'none';
}

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

  // Auto-rejoin if we have a saved session for this room (within the last 8 hours)
  const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000;
  const saved = loadSession();
  if (saved && saved.pin && saved.characterId && (Date.now() - (saved.savedAt || 0)) < SESSION_MAX_AGE_MS) {
    document.getElementById('player-pin').value = saved.pin;
    _isRejoining = true;
    sessionPin = saved.pin;
    activeCharacterId = saved.characterId;
    // Attempt silent reconnect after a short delay so the page finishes loading
    setTimeout(autoRejoin, 500);
  }

  // Re-attempt connection when the user returns to the tab (handles mobile backgrounding)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && playerPeer && !playerPeer.isConnected() && sessionPin) {
      playerPeer.reconnectNow();
    }
  });

  // Re-attempt connection when the network comes back online
  window.addEventListener('online', () => {
    if (playerPeer && !playerPeer.isConnected() && sessionPin) {
      playerPeer.reconnectNow();
    }
  });
});

async function autoRejoin() {
  try {
    await _initPlayerPeer();
  } catch (err) {
    console.error('[Player] Auto-rejoin failed:', err);
    _isRejoining = false;
    showBanner('Could not reconnect. Enter your PIN to rejoin.', true);
  }
}

async function joinSession() {
  sessionPin = document.getElementById('player-pin').value.trim();
  const errorEl = document.getElementById('join-error');
  errorEl.style.display = 'none';

  if (!sessionPin) { errorEl.textContent = 'Please enter the PIN'; errorEl.style.display = 'block'; return; }

  _isRejoining = false;
  activeCharacterId = null;

  try {
    await _initPlayerPeer();
  } catch (err) {
    console.error('[Player] Connection failed:', err);
    errorEl.textContent = 'Could not connect to DM. Make sure the session is active.';
    errorEl.style.display = 'block';
  }
}

async function _initPlayerPeer() {
  // Tear down any previous peer cleanly
  if (playerPeer) {
    playerPeer.cancelReconnect();
    playerPeer.destroy();
    playerPeer = null;
  }

  playerPeer = peerManager.createPlayerPeer(roomId);

  playerPeer.onMessage(handleDMMessage);
  playerPeer.onDisconnect(handleDisconnect);
  playerPeer.onReconnecting(handleReconnecting);
  playerPeer.onConnect(handleConnected);

  // Show loading state
  document.getElementById('btn-join').disabled = true;
  document.getElementById('btn-join').textContent = 'Connecting...';

  await playerPeer.connect();

  // Connected — send join request
  playerPeer.sendToDM({ type: 'join', pin: sessionPin });

  // Timeout if DM never responds
  joinTimeout = setTimeout(() => {
    document.getElementById('btn-join').disabled = false;
    document.getElementById('btn-join').textContent = 'Join';
    const errorEl = document.getElementById('join-error');
    errorEl.textContent = 'No response from DM. Check the PIN and try again.';
    errorEl.style.display = 'block';
    clearSession();
  }, 8000);
}

// Called every time the WebRTC connection to DM opens (initial connect AND after auto-reconnect)
function handleConnected() {
  hideBanner();
  document.getElementById('btn-join').disabled = false;
  document.getElementById('btn-join').textContent = 'Join';

  if (sessionPin && _isRejoining) {
    // Auto-rejoin: send join, then claim will happen in handleDMMessage → join-ok
    playerPeer.sendToDM({ type: 'join', pin: sessionPin });
    joinTimeout = setTimeout(() => {
      showBanner('Could not reconnect — DM may have ended the session.', true);
    }, 8000);
  }
}

function handleDisconnect() {
  showBanner('Connection lost. Reconnecting...', false);
}

function handleReconnecting(attempt, delay) {
  const secs = Math.round(delay / 1000);
  showBanner(`Reconnecting… (attempt ${attempt}, retrying in ${secs}s)`, false);
}

function handleDMMessage(msg) {
  switch (msg.type) {
    case 'join-ok':
      clearTimeout(joinTimeout);
      document.getElementById('btn-join').disabled = false;
      document.getElementById('btn-join').textContent = 'Join';

      if (_isRejoining && activeCharacterId) {
        // Silently reclaim the same character — no need to show the picker
        playerPeer.sendToDM({ type: 'claim', characterId: activeCharacterId, playerName: 'player-' + Date.now() });
      } else {
        document.getElementById('step-join').style.display = 'none';
        document.getElementById('step-pick').style.display = '';
        renderCharacterPicker(msg.characters);
      }
      break;

    case 'join-error':
      clearTimeout(joinTimeout);
      document.getElementById('btn-join').disabled = false;
      document.getElementById('btn-join').textContent = 'Join';
      clearSession();
      if (_isRejoining) {
        // Was trying to silently rejoin but PIN is now wrong (DM changed session)
        _isRejoining = false;
        showBanner('Session ended or PIN changed. Re-enter PIN to rejoin.', true);
        document.getElementById('player-pin').value = '';
        document.getElementById('step-join').style.display = '';
        document.getElementById('step-pick').style.display = 'none';
        document.getElementById('step-sheet').style.display = 'none';
      } else {
        _isRejoining = false;
        const errorEl = document.getElementById('join-error');
        errorEl.textContent = msg.error;
        errorEl.style.display = 'block';
      }
      break;

    case 'claim-ok':
      clearTimeout(joinTimeout);
      activeCharacterId = msg.characterId;
      currentCharacter = msg.character;
      currentHPState = msg.hpState;
      _isRejoining = false;
      saveSession(sessionPin, activeCharacterId);
      hideBanner();
      renderCharacterSheet(currentCharacter, currentHPState);
      break;

    case 'claim-error':
      if (_isRejoining) {
        // Character may still be in a grace period or genuinely gone; fall back to picker
        _isRejoining = false;
        activeCharacterId = null;
        clearSession();
        showBanner('Could not reclaim character automatically. Please select again.', true);
        playerPeer.sendToDM({ type: 'join', pin: sessionPin });
      } else {
        dialogAlert(msg.error || 'Could not select character', 'Error', 'error');
      }
      break;

    case 'character-update':
      if (msg.characterId === activeCharacterId) {
        currentCharacter = msg.character;
        currentHPState = msg.hpState;
        renderCharacterSheet(currentCharacter, currentHPState);
      }
      break;

    case 'character-list':
      // DM may re-send character list (e.g. after adding characters to session)
      if (!activeCharacterId) {
        renderCharacterPicker(msg.characters);
      }
      break;

    case 'pong':
      // Heartbeat response — connection is confirmed alive, nothing else needed
      break;
  }
}

function renderCharacterPicker(characters) {
  const container = document.getElementById('pick-list');

  container.innerHTML = characters.map(c => {
    if (c.claimed) {
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
      <div class="char-item" onclick="claimCharacter('${c._id}')">
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

function claimCharacter(characterId) {
  playerPeer.sendToDM({
    type: 'claim',
    characterId,
    playerName: 'player-' + Date.now()
  });
}

function renderCharacterSheet(c, hpState) {
  const isFirstLoad = !document.getElementById('step-sheet').style.display || document.getElementById('step-sheet').style.display === 'none';

  document.getElementById('step-join').style.display = 'none';
  document.getElementById('step-pick').style.display = 'none';
  document.getElementById('step-sheet').style.display = '';

  const bg = c.background ? ` - ${c.background}` : '';
  const h1 = document.querySelector('h1');
  h1.textContent = `${c.name} ${c.species || ''} ${c.class} lvl ${c.level}${bg}`;
  h1.classList.add('char-title');

  const profBonus = calcProfBonus(c.level);
  const maxHP = c.HP || 0;
  const currentHP = hpState ? hpState.currentHP : maxHP;
  const tempHP = hpState ? (hpState.tempHP || 0) : 0;

  if (isFirstLoad) {
    playerState.slotChecks = {};
  }

  const hpPercent = maxHP > 0 ? Math.max(0, (currentHP / maxHP) * 100) : 0;
  let hpColor = 'var(--hp-high, #4caf50)';
  if (hpPercent <= 25) hpColor = 'var(--hp-low, #e53935)';
  else if (hpPercent <= 50) hpColor = 'var(--hp-mid, #ff9800)';

  document.getElementById('combat-stats').innerHTML = `
    <div class="combat-stat">
      <div class="label">Hit Points</div>
      <div class="hp-tracker">
        <div class="bf-hp-bar-container" style="margin:4px 0;">
          <div class="bf-hp-bar" style="width:${hpPercent}%;background:${hpColor};"></div>
        </div>
        <div class="value" style="font-size:1.2rem;">${currentHP} / ${maxHP}</div>
        ${tempHP > 0 ? `<div style="color:var(--text-muted);font-size:0.85rem;">Temp HP: ${tempHP}</div>` : ''}
      </div>
    </div>
    <div class="combat-stat">
      <div class="label">Armor Class</div>
      <div class="value">${c.AC}</div>
    </div>
  `;

  document.getElementById('prof-bonus-label').textContent = `(Proficiency Bonus: +${profBonus})`;

  document.getElementById('ability-grid').innerHTML = ABILITIES.map(a => {
    const score = c[a] || 10;
    const mod = Math.floor((score - 10) / 2);
    const modStr = mod >= 0 ? `+${mod}` : `${mod}`;
    return `
      <div class="stat-box">
        <div class="stat-label">${a}</div>
        <div class="stat-mod">${modStr}</div>
        <div class="stat-value">${score}</div>
      </div>
    `;
  }).join('');

  const classSaves = CLASS_SAVING_THROWS[c.class] || [];
  document.getElementById('saving-throws-grid').innerHTML = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'].map(a => {
    const abilityScore = c[a] || 10;
    const abilityMod = Math.floor((abilityScore - 10) / 2);
    const proficient = classSaves.includes(a);
    const total = abilityMod + (proficient ? profBonus : 0);
    const modStr = total >= 0 ? `+${total}` : `${total}`;
    return `
      <div class="skill-item">
        <span>${proficient ? '<strong style="color:var(--accent);">*</strong> ' : ''}${a}</span>
        <span class="skill-mod">${modStr}</span>
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

  // --- Currency (read-only, managed by DM) ---
  const cur = c.currency || {};
  const coinDefs = [
    { key: 'CP', cls: 'cp', name: 'Copper' },
    { key: 'SP', cls: 'sp', name: 'Silver' },
    { key: 'EP', cls: 'ep', name: 'Electrum' },
    { key: 'GP', cls: 'gp', name: 'Gold' },
    { key: 'PP', cls: 'pp', name: 'Platinum' },
  ];

  const currencyHtml = `
    <h3>Purse</h3>
    <div class="currency-tracker">
      ${coinDefs.map(({ key, cls, name }) => {
        const amount = cur[key] || 0;
        return `
        <div class="coin-group${amount === 0 ? ' zero' : ''}">
          <div class="coin-disc ${cls}">${key}</div>
          <span class="coin-amount">${amount}</span>
          <span class="coin-name">${name}</span>
        </div>`;
      }).join('')}
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

  document.getElementById('equipment-display').innerHTML = currencyHtml + '<h3>Equipment</h3>' + equipHtml;

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
