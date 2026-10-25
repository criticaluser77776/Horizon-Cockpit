/* Transporte des aktiven Bauplans (Cockpit-Reiter „Transporte“, Nutzer 25.10.2026).
   Der Simulator plant die Takt-Flüge (`--takt`); analyse/build_autobuilder.js schreibt sie als payload.transporte in den Plan:
   [{ nr, t, von, nach, hin:[E,M,T], zurueck:[E,M,T], fuel, anH, rueckH }] – t/anH/rueckH in Planstunden ab startTime.
   Der Nutzer fliegt sie von Hand und hakt sie ab (Tabelle transport_haken). Realzeit = Planstart + Planstunde + Abweichung (lag),
   dieselbe Verschiebung wie bei den Bauschritten. Reine Funktionen, im Browser und unter Node (Tests) nutzbar. */
(function (root) {
  'use strict';
  const H = 3600e3;
  const RES = ['Erz', 'Min', 'Treib'];
  // Ladung [E,M,T] als kurzer Text ohne Nullen, leer → „leer“
  const ladungText = (l, fmt = n => String(Math.round(n))) => {
    const p = (Array.isArray(l) ? l : []).map((v, i) => +v > 0 ? `${RES[i]} ${fmt(+v)}` : '').filter(Boolean);
    return p.length ? p.join(' · ') : 'leer';
  };
  // payload = Plan-Payload, drift = Ergebnis von plan_abweichung_akt (oder null), haken = Set/Array der abgehakten Nummern
  function transportListe(payload, drift, haken, now = Date.now()) {
    const list = Array.isArray(payload?.transporte) ? payload.transporte : [];
    const t0 = Date.parse(drift?.start || payload?.startTime);
    if (!list.length || !isFinite(t0)) return [];
    const lag = drift?.lag != null && isFinite(drift.lag) ? +drift.lag : 0;
    const done = haken instanceof Set ? haken : new Set(haken || []);
    const at = h => h == null || !isFinite(h) ? null : t0 + (+h + lag) * H;
    let next = false;
    return list.filter(x => x && isFinite(x.nr) && isFinite(x.t)).sort((a, b) => a.t - b.t || a.nr - b.nr).map(x => {
      const ab = at(x.t), geflogen = done.has(+x.nr);
      // Status: geflogen (Haken) · faellig (Abflugzeit erreicht, kein Haken) · naechster (erster noch nicht fällige) · spaeter
      const status = geflogen ? 'geflogen' : ab <= now ? 'faellig' : next ? 'spaeter' : (next = true, 'naechster');
      return { nr: +x.nr, von: x.von || '', nach: x.nach || '', hin: x.hin || [0, 0, 0], zurueck: x.zurueck || [0, 0, 0],
        fuel: x.fuel ?? null, ab, an: at(x.anH), rueck: at(x.rueckH), status };
    });
  }

  /* Transportaufträge (Nutzer 25.10.2026, doku/stand/transporte.md): Kapazität je Planet und Vorschau der Flüge für das Formular
     „Neuer Transport“. Der Autobuilder fliegt (PR 4); die Vorschau ist nur eine Schätzung. */
  // Laderaum je Schiffstyp, echte Account-Werte (analyse/live/einheiten-2026-10-20.json, hilfe.cargo; live PFLS 1 + PTRN 1 = 12 000 t)
  const LADERAUM = { PTRN: 12000 };
  // T-Stoff je Flug im selben System (Transport-Formular live 25.10.: Heimat → K1 78 t, → K2 79 t, PFLS 1 + PTRN 1)
  const FUEL_SYSTEM = 80;
  const sameSystem = (a, b) => String(a).split(':').slice(0, 2).join(':') === String(b).split(':').slice(0, 2).join(':');
  // Laderaum am Planeten aus dem Snapshot (empire.ships: planets[], items[].values/split, Collector ab 0.4.36).
  // split je Planet: {hafen, flotte, bunker, flug, bau}; ohne split (ältere Stände) zählt alles als Flotte (geteilt = false).
  // → { flotte, hafen, flug, gesamt } in Tonnen, typen = [{type, n, flotte, hafen, flug}]
  function kapazitaet(ships, coords, laderaum = LADERAUM) {
    const k = (ships?.planets || []).findIndex(p => p.coords === coords);
    const out = { flotte: 0, hafen: 0, flug: 0, gesamt: 0, geteilt: true, typen: [] };
    if (k < 0) return out;
    for (const it of ships.items || []) {
      const cap = laderaum[it.type], n = +it.values?.[k] || 0;
      if (!cap || !n) continue;
      const sp = it.split?.[k];
      const t = sp ? { type: it.type, n, flotte: +sp.flotte || 0, hafen: +sp.hafen || 0, flug: +sp.flug || 0 }
        : { type: it.type, n, flotte: n, hafen: 0, flug: 0 };
      if (!sp) out.geteilt = false;
      out.typen.push(t);
      out.flotte += t.flotte * cap; out.hafen += t.hafen * cap; out.flug += t.flug * cap; out.gesamt += n * cap;
    }
    return out;
  }
  // Vorschau: Menge [E,M,T] in Flüge zu je höchstens `laderaum` t aufteilen (erst Erz, dann Mineral, dann T-Stoff).
  // T-Stoff für die Flüge (fuel je Flug, null = unbekannt) kommt zusätzlich vom Lager der Quelle; lager = [E,M,T] der Quelle oder null.
  // → { fluege:[{nr, ladung:[E,M,T], summe}], fuel, bedarf:[E,M,T], fehlt:[E,M,T], probleme:[Text] }
  function vorschau({ menge, laderaum, fuel = null, lager = null }) {
    const m = [0, 1, 2].map(i => Math.max(0, Math.floor(+menge?.[i] || 0)));
    const sum = m[0] + m[1] + m[2], cap = Math.floor(+laderaum || 0);
    const probleme = [], fluege = [];
    if (!sum) probleme.push('Keine Menge angegeben.');
    if (cap <= 0) probleme.push('Keine Flotte mit Laderaum an Quelle oder Ziel.');
    if (sum && cap > 0) {
      const rest = m.slice();
      while (rest[0] + rest[1] + rest[2] > 0) {
        let frei = cap;
        const ladung = rest.map((v, i) => { const x = Math.min(v, frei); frei -= x; rest[i] -= x; return x; });
        fluege.push({ nr: fluege.length + 1, ladung, summe: cap - frei });
      }
    }
    const f = fuel != null && isFinite(fuel) ? fluege.length * fuel : null;
    const bedarf = [m[0], m[1], m[2] + (f || 0)];
    const fehlt = lager ? bedarf.map((v, i) => Math.max(0, v - Math.floor(+lager[i] || 0))) : [0, 0, 0];
    if (fehlt.some(v => v > 0)) probleme.push(`Lager der Quelle reicht nicht: es fehlen ${ladungText(fehlt)}.`);
    if (f == null && fluege.length) probleme.push('T-Stoff je Flug unbekannt (anderes System); der Autobuilder liest ihn aus dem Formular.');
    return { fluege, fuel: f, bedarf, fehlt, probleme };
  }
  // „max“-Knopf: höchste Menge des Rohstoffs i (0..2) bei den übrigen Mengen, für die das Lager inkl. T-Stoff der Flüge reicht
  function maxMenge(i, { menge, laderaum, fuel = null, lager }) {
    const m = [0, 1, 2].map(k => k === i ? 0 : Math.max(0, Math.floor(+menge?.[k] || 0)));
    let x = Math.max(0, Math.floor(+lager?.[i] || 0));
    for (let n = 0; n < 50 && x > 0; n++) {   // T-Stoff: mehr Flüge = mehr Verbrauch → absenken, bis es passt
      const v = vorschau({ menge: m.map((y, k) => k === i ? x : y), laderaum, fuel, lager });
      if (!v.fehlt[i]) break;
      x = Math.max(0, x - v.fehlt[i]);
    }
    return x;
  }
  const api = { transportListe, ladungText, kapazitaet, vorschau, maxMenge, sameSystem, LADERAUM, FUEL_SYSTEM };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Transporte = api;
})(typeof window !== 'undefined' ? window : globalThis);
