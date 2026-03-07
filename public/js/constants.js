const CLASSES = [
  'Barbarian', 'Bard', 'Cleric', 'Druid', 'Fighter',
  'Monk', 'Paladin', 'Ranger', 'Rogue', 'Sorcerer',
  'Warlock', 'Wizard'
];

const SPECIES = [
  'Aasimar', 'Dragonborn', 'Dwarf', 'Elf', 'Gnome',
  'Goliath', 'Halfling', 'Human', 'Orc', 'Tiefling'
];

// Spellcasting ability per class
const SPELLCASTING_ABILITY = {
  Bard: 'CHA',
  Cleric: 'WIS',
  Druid: 'WIS',
  Paladin: 'CHA',
  Ranger: 'WIS',
  Sorcerer: 'CHA',
  Warlock: 'CHA',
  Wizard: 'INT'
};

// Full caster slot table (Bard, Cleric, Druid, Sorcerer, Wizard)
const FULL_CASTER_SLOTS = {
  1:  [2],
  2:  [3],
  3:  [4, 2],
  4:  [4, 3],
  5:  [4, 3, 2],
  6:  [4, 3, 3],
  7:  [4, 3, 3, 1],
  8:  [4, 3, 3, 2],
  9:  [4, 3, 3, 3, 1],
  10: [4, 3, 3, 3, 2],
  11: [4, 3, 3, 3, 2, 1],
  12: [4, 3, 3, 3, 2, 1],
  13: [4, 3, 3, 3, 2, 1, 1],
  14: [4, 3, 3, 3, 2, 1, 1],
  15: [4, 3, 3, 3, 2, 1, 1, 1],
  16: [4, 3, 3, 3, 2, 1, 1, 1],
  17: [4, 3, 3, 3, 2, 1, 1, 1, 1],
  18: [4, 3, 3, 3, 3, 1, 1, 1, 1],
  19: [4, 3, 3, 3, 3, 2, 1, 1, 1],
  20: [4, 3, 3, 3, 3, 2, 2, 1, 1]
};

// Half caster slot table (Paladin, Ranger)
const HALF_CASTER_SLOTS = {
  1:  [],
  2:  [2],
  3:  [3],
  4:  [3],
  5:  [4, 2],
  6:  [4, 2],
  7:  [4, 3],
  8:  [4, 3],
  9:  [4, 3, 2],
  10: [4, 3, 2],
  11: [4, 3, 3],
  12: [4, 3, 3],
  13: [4, 3, 3, 1],
  14: [4, 3, 3, 1],
  15: [4, 3, 3, 2],
  16: [4, 3, 3, 2],
  17: [4, 3, 3, 3, 1],
  18: [4, 3, 3, 3, 1],
  19: [4, 3, 3, 3, 2],
  20: [4, 3, 3, 3, 2]
};

// Warlock pact magic (slots per short rest, all same level)
const WARLOCK_SLOTS = {
  1:  { slots: 1, level: 1 },
  2:  { slots: 2, level: 1 },
  3:  { slots: 2, level: 2 },
  4:  { slots: 2, level: 2 },
  5:  { slots: 2, level: 3 },
  6:  { slots: 2, level: 3 },
  7:  { slots: 2, level: 4 },
  8:  { slots: 2, level: 4 },
  9:  { slots: 2, level: 5 },
  10: { slots: 2, level: 5 },
  11: { slots: 3, level: 5 },
  12: { slots: 3, level: 5 },
  13: { slots: 3, level: 5 },
  14: { slots: 3, level: 5 },
  15: { slots: 3, level: 5 },
  16: { slots: 3, level: 5 },
  17: { slots: 4, level: 5 },
  18: { slots: 4, level: 5 },
  19: { slots: 4, level: 5 },
  20: { slots: 4, level: 5 }
};

function getSpellSlots(className, level) {
  const fullCasters = ['Bard', 'Cleric', 'Druid', 'Sorcerer', 'Wizard'];
  const halfCasters = ['Paladin', 'Ranger'];

  if (className === 'Warlock') {
    const w = WARLOCK_SLOTS[level] || { slots: 0, level: 0 };
    return { type: 'pact', slots: w.slots, slotLevel: w.level };
  }
  if (fullCasters.includes(className)) {
    return { type: 'full', slots: FULL_CASTER_SLOTS[level] || [] };
  }
  if (halfCasters.includes(className)) {
    return { type: 'half', slots: HALF_CASTER_SLOTS[level] || [] };
  }
  return { type: 'none', slots: [] };
}
