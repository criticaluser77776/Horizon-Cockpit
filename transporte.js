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
  const api = { transportListe, ladungText };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Transporte = api;
})(typeof window !== 'undefined' ? window : globalThis);
