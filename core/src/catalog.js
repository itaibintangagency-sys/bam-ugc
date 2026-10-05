'use strict';
const master = require('../data/latar_dan_angle_master.json');
const ARKET = require('../data/arketipe_slot_angle.json').arketipe;
const META = require('../data/archetypes_meta.json');
const LOC_MAP = require('../data/archetype_locations.json');
const { neutralize } = require('./neutralize');
const ACOUSTICS = require('../data/acoustics.json').kelompok;
function acousticFor(id) {
  for (const [group, g] of Object.entries(ACOUSTICS)) if (g.lokasi.includes(id)) return { group, id: g.id, en: g.en };
  return null;
}

const settings = master.tempat.map(t => ({ ...t, prompt_en: neutralize(t.prompt_en), cahaya: neutralize(t.cahaya), acoustic: acousticFor(t.id) }));
const angles = master.angle.map(a => ({ ...a, prompt_en: neutralize(a.prompt_en) }));

function getSetting(id) { return settings.find(s => s.id === id) || null; }
function getAngle(id) { return angles.find(a => a.id === id) || null; }
function listSettings() { return settings.slice(); }
function getArchetype(id) {
  if (!ARKET[id]) return null;
  return { id, ...ARKET[id], meta: META[id] };
}
function listArchetypes() { return Object.keys(ARKET).map(id => ({ id, nama: META[id].nama, risiko: META[id].risiko })); }

// Daftar lokasi untuk dropdown: Disarankan (utama + alternatif) dan Lainnya.
function suggestedSettings(archetypeId) {
  const m = LOC_MAP[archetypeId];
  if (!m) return { disarankan: [], lainnya: settings.map(s => s.id) };
  const rec = [m.utama, ...m.alternatif];
  return { utama: m.utama, disarankan: rec, lainnya: settings.map(s => s.id).filter(id => !rec.includes(id)) };
}

// Peringatan untuk lokasi yang dipilih manusia (bukan larangan).
function settingWarnings(settingId, archetypeId) {
  const s = getSetting(settingId);
  if (!s) return ['lokasi tidak dikenal'];
  const w = [];
  if (s.risiko && s.risiko !== 'tidak ada') w.push(s.risiko);
  const sug = suggestedSettings(archetypeId);
  if (sug.lainnya.includes(settingId)) w.push('di luar saran untuk kategori produk ini');
  if (['S-02', 'S-04'].includes(settingId)) w.push('kamar tidur/kamar mandi: pantau penolakan kebijakan pada telemetri');
  return w;
}

module.exports = { getSetting, getAngle, listSettings, getArchetype, listArchetypes, suggestedSettings, settingWarnings, META };
