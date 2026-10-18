'use strict';
/* Horizon Atlas – Rechnungen des Reiters „Kampf“ (D7.3). Läuft als Web Worker (new Worker('kampfworker.js')), sonst als
   normales Skript im Hauptfenster (Rückfall ohne Worker). Rechenkern: kampfkern.js (gebaut aus analyse/kampfsim/). */
if (typeof window === 'undefined' && typeof importScripts === 'function') importScripts('kampfkern.js');

self.HzKampfRechne = function (art, a) {
  const { H, B } = self.HzKampf;
  const t0 = Date.now();
  if (art === 'quote') {
    const opts = { n: a.n, seed: a.seed, runden: a.runden, ungeschuetzt: a.ungeschuetzt, treibstoff: a.treibstoff };
    const q = B.gewinnquote(a.seiten, opts);
    const m = H.battle(a.seiten, { daten: H.KAMPF, runden: a.runden });
    // Empfindlichkeit: Forschung der Gegnerseite −3 / +3 (kampfsystem.md Abschnitt 11)
    const empf = {};
    if (a.empf) for (const d of [-3, 3]) {
      const seiten = a.seiten.map((s, i) => i === a.gegner ? { ...s, research: { ...s.research, ...B.forschungPlus(s.research, d) } } : s);
      empf[d] = B.gewinnquote(seiten, opts);
    }
    return { q, median: { sieger: m.sieger, rest: m.rest, viertelrunden: m.verlauf.length }, empf, ms: Date.now() - t0 };
  }
  if (art === 'def') {
    const r = B.guenstigsteVerteidigung(a.angreifer, { forschung: a.forschung, gegnerForschung: a.gegnerForschung, n: a.n, seed: a.seed });
    return { ...r, ms: Date.now() - t0 };
  }
  throw new Error('unbekannte Rechnung ' + art);
};

if (typeof window === 'undefined') {
  self.onmessage = e => {
    const { id, art, args } = e.data;
    try { self.postMessage({ id, ok: self.HzKampfRechne(art, args) }); }
    catch (err) { self.postMessage({ id, fehler: String(err && err.message || err) }); }
  };
}
