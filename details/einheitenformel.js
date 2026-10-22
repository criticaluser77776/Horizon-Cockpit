'use strict';
/* Einheitenwerte mit Forschung (Nutzer 20.10.2026, doku/stand/erledigt/plan-atlas-sim-einheiten.md „Entscheid Rechengrundlage“):
   Grundwerte nur aus getData (auf Forschung Stufe 1 zurückgerechnet, analyse/build_einheiten.py), unsere Werte immer selbst
   gerechnet. Gegenprobe: Hilfeseiten der baubaren Einheiten (analyse/live/einheiten-*.json, Tests einheiten_formel.test.js).
   Gesichert (live 20.10. PFLS/PTRN/PTNK): Panzerung × (1 + (Materialtechnik − 1)/30); Treibstoffverbrauch × (1 − 0,03 · (Antrieb − 1)),
   Reichweite entsprechend geteilt. Aus dem Kampfsystem (kampfsystem.md Abschnitt 9, nicht live geprüft): Schild/Schildtechnik,
   Waffenreichweite/Militärtechnik, Genauigkeit/Computertechnik (Gildenwaffen ohne), Schaden/Waffentechnik.
   Unverändert: Hülle, Tarnung, Agilität, Kampfgeschwindigkeit, Beschleunigung, Tank, Laderaum, Orbitzeit. Offen: Kontrolle. */
(function (root) {
  const stufe = (F, t) => Math.max(1, +(F && F[t]) || 1);
  const faktor = s => 1 + (Math.max(1, s) - 1) / 30;
  const verbrauch = s => 1 - 0.03 * (Math.max(1, s) - 1);
  const rund = x => Math.floor(x + 0.5);
  const r2 = x => Math.round(x * 100) / 100;
  // Waffe → Forschung für den Schaden (wie analyse/kampfsim/build_combat_units.py SCALE)
  const SCALE = { MissileTech: 'missiletech', LaserTech: 'lasertech', IonTech: 'iontech', PlasmaTech: 'plasmatech', ProtonTech: 'protontech' };
  const GILDE = new Set(['GLCA', 'GICA', 'GMLN', 'GPCA', 'GRAG']);
  // Art der Herleitung je Wert: sicher = live bestätigt, kampf = Formel aus dem Kampfsystem, fest = keine Forschung, offen = unbekannt
  const ART = { armor: 'sicher', fuelUse: 'sicher', range: 'sicher', shield: 'kampf', hull: 'fest', stealth: 'fest', agility: 'fest',
    speed: 'fest', accel: 'fest', tank: 'fest', cargo: 'fest', deck: 'fest', orbitTime: 'fest', control: 'offen' };

  /** Werte einer Einheit (Grundwerte g aus HZ_EINHEITEN.units) mit Forschung F ({materialtech: 8, propulsiontech: 5, …}). */
  function werte(g, F) {
    const mt = faktor(stufe(F, 'materialtech')), st = faktor(stufe(F, 'shieldtech')), v = verbrauch(stufe(F, 'propulsiontech'));
    const out = {
      hull: g.hull, armor: rund(g.armor * mt), shield: rund(g.shield * st), stealth: g.stealth, agility: g.agility, speed: g.speed,
      accel: g.accel, tank: g.tank, cargo: g.cargo, deck: g.deck, orbitTime: g.orbitTime, control: g.control,
      fuelUse: g.fuelUse == null ? null : r2(g.fuelUse * v),
      range: g.range == null ? null : (v > 0 ? rund(g.range / v) : null),   // Spielanzeige ganzzahlig
    };
    out.weapons = (g.weapons || []).map(w => {
      const dmg = SCALE[w.scale] ? faktor(stufe(F, SCALE[w.scale])) : 1;
      const acc = GILDE.has(w.weapon) ? 1 : faktor(stufe(F, 'computertech'));
      return { ...w, damageShips: rund(w.damageShips * dmg), damageGround: rund(w.damageGround * dmg),
        range: rund(w.range * faktor(stufe(F, 'militarytech'))), accuracy: rund(w.accuracy * acc) };
    });
    return out;
  }

  /** Bauzeit je Stück in s bei Werft-Leistung l je h (Werft 1 bei 100 %: 1 080), Betriebsfaktor p (0…1). */
  function bauzeit(kosten, l = 1080, p = 1) {
    if (!kosten || !(l * p > 0)) return null;
    return Math.ceil((kosten[0] + kosten[1] + kosten[2]) / (l * p) * 3600 - 1e-9);   // Spiel rundet auf (PTRN 8 333,3 → 8 334 s)
  }

  const api = { werte, bauzeit, faktor, verbrauch, ART };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HzEinheiten = api;
})(typeof window !== 'undefined' ? window : globalThis);
