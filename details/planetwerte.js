'use strict';
/* Planetenwerte im Reiter „Galaxie“ (Paket C, 17.10.2026): Grundwerte der eigenen Kolonien in % der Heimat (STPL = 100 %),
   gemessen vom Collector (ab 0.4.12) gleich nach der Kolonisierung – immer Stufe n gegen Stufe n, sonst „offen“.
   Ab Collector 0.4.14 nach der Bedeutung der Prospektionswerte (doku/wissen/statistik-monitor.md): T-Stoff ohne Bahn,
   Wohnraumkosten = Infrastruktur, Bodenfläche = Bauplatz der Infrastruktur, Besiedelbarkeit und Atmosphäre (Solar)
   gemessen, Bauplanet-Faktor neu (Migration 20261018090001).
   Daten: Tabelle planet_values (eine Zeile je Planet und Wert, Migration 20261017110001). Knopf „Planetenwerte messen“
   (nur Owner): Kommando planetwerte {planet, ungebaut?} an den Collector mit frischem Lebenszeichen im Spiel; er misst den im
   Spiel gewählten Planeten und wechselt ihn nie selbst. Ablauf am Tag der Landung: doku/stand/planeten-erfassung.md.
   Läuft vor app.js; nutzt zur Laufzeit dessen Helfer ($, esc, fmt, dt, ago, Cloud, S, account, isOwner, isFresh, verCmp,
   loadSessions, toast, route). */
(function () {
  const MIN_VER = '0.4.12';
  const MAIN = { metal: 'Erz', mineral: 'Mineral', fuel: 'T-Stoff (ohne Bahn)', buildCost: 'Gebäudekosten', buildSpeed: 'Baugeschwindigkeit',
    buildPlanet: 'Bauplanet-Faktor', researchCost: 'Forschungskosten', ground: 'Bodenfläche (Bauplatz Infrastruktur)',
    housingCost: 'Wohnraumkosten (Infrastruktur)', colonizable: 'Besiedelbarkeit (Arbeiter)', atmosphere: 'Atmosphäre: Wirkung auf Solar' };
  const REST = { orbMetal: 'Erz Umlaufbahn', orbMineral: 'Mineral Umlaufbahn', orbFuel: 'T-Stoff Umlaufbahn', moon: 'Mond', artefacts: 'Artefakte' };
  const METHOD = { 'hilfe-produktion': 'Hilfe: Produktion gleicher Stufe', 'hilfe-produktion-bahn': 'Hilfe: Raffinerie ÷ Bahnfaktor',
    kosten: 'Kosten der nächsten Stufen', 'kosten-wohnkomplex': 'Kosten Wohnkomplex', 'kosten-infrastruktur': 'Kosten Infrastruktur',
    'hilfe-tonnage-infrastruktur': 'Hilfe: Tonnage Infrastruktur', 'hilfe-bauplatz-infrastruktur': 'Hilfe: Bauplatz Infrastruktur',
    'hilfe-arbeiter-wohnkomplex': 'Hilfe: Arbeiter Wohnkomplex', 'hilfe-solar-bahn': 'Hilfe: Solar ÷ Bahnfaktor',
    abgeleitet: 'Baugeschwindigkeit ÷ Gebäudekosten', bauleistung: 'Bauleistung (Statistik)', forschungskosten: 'Kosten der nächsten Forschung',
    'bauplatz-gesamt': 'Bauplatz gesamt', 'typ-median': 'Median des Typs', prospektion: 'erst mit Prospektion' };

  const coords = (g, s, b) => `${g}:${s}:${b}`;
  const val = v => !v ? '<span class="muted">–</span>'
    : v.status === 'offen' ? '<span class="tag">offen</span>'
    : `<b>${esc(fmt(v.pct, 1))} %</b>${v.status === 'typ-median' ? ' <span class="tag">Median</span>' : ''}`;
  // Spalte „Messung“: gemessen → Methode, Stufe, Notiz; offen → nur der Grund
  const info = v => !v ? '' : v.status === 'offen' ? v.note || METHOD[v.method] || ''
    : [METHOD[v.method] || v.method, v.level != null ? `Stufe ${v.level}` : '', v.note].filter(Boolean).join(' · ');
  const row = (k, n, v) => `<tr><td>${esc(n)}</td><td class="num nowrap">${val(v)}</td><td class="small muted">${esc(info(v))}</td></tr>`;

  // Collector, der messen kann: frisches Lebenszeichen, im Spiel eingeloggt, Version ab 0.4.12; Gerät mit dem Lauf zuerst
  const target = sess => sess.devs.filter(x => x.col && isFresh(x.col.at) && x.col.state?.page === 'game' && verCmp(x.col.version, MIN_VER) >= 0)
    .sort((a, b) => b.holds - a.holds || String(b.col.at).localeCompare(String(a.col.at)))[0] || null;

  // Karte unter dem System: Werte je eigener Kolonie + Messknopf; nur im System mit eigenen Planeten
  function card(S0, g, s, homeOrbit) {
    const me = account()?.player || '';
    const mine = (S0?.planets || []).filter(p => p.present && me && p.owner === me);
    if (!mine.length) return '';
    const by = {};
    for (const v of S0.values || []) (by[v.orbit] ||= {})[v.key] = v;
    const blocks = mine.filter(p => by[p.orbit]).map(p => {
      const vs = by[p.orbit], any = Object.values(vs)[0];
      const at = Object.values(vs).map(v => v.measured_at).sort().pop();
      return `<h3>Bahn ${p.orbit} ${esc(any.planet_type || p.type || '')} <span class="muted small">${esc(p.name || '')} · gemessen ${esc(dt(at))} (${esc(ago(at))})</span></h3>
        <table class="small pw"><tr class="muted"><td>Wert</td><td class="num">Kolonie</td><td>Messung</td></tr>${Object.entries(MAIN).map(([k, n]) => row(k, n, vs[k])).join('')}</table>
        <details class="sub"><summary class="small muted">Umlaufbahn, Mond, Artefakte</summary>
          <table class="small pw">${Object.entries(REST).map(([k, n]) => row(k, n, vs[k])).join('')}</table></details>`;
    }).join('');
    const opts = mine.map(p => `<option value="${esc(coords(g, s, p.orbit))}"${p.orbit === homeOrbit ? '' : ' selected'}>Bahn ${p.orbit}${p.orbit === homeOrbit ? ' (Heimat)' : ''} ${esc(p.name || '')}</option>`).join('');
    return `<div class="card" id="pwCard"><h2>Planetenwerte <span class="muted small">in % der Heimat (STPL = 100 %)</span></h2>
      ${blocks || '<p class="small muted">Noch keine Kolonie gemessen.</p>'}
      <p class="small muted">Kosten: über 100 % heißt teurer als die Heimat; Baugeschwindigkeit, Bauplanet-Faktor und Erträge: über 100 % heißt besser. Verglichen wird immer dieselbe Stufe; fehlt sie auf einer Seite, bleibt der Wert offen.</p>
      ${isOwner() ? `<form id="pwForm" class="row" style="margin-top:6px;flex-wrap:wrap;gap:6px">
        <select name="planet" aria-label="Planet">${opts}</select>
        <label class="small"><input type="checkbox" name="ungebaut"> ungebaute Stufen zählen</label>
        <button class="primary">Planetenwerte messen</button></form>
        <p class="small muted">Gemessen wird der im Spiel gewählte Planet – vorher im Spiel dorthin wechseln, der Autobuilder sollte dabei pausieren.
          Auf der Heimat frischt die Messung den Bezug auf (Gegenprobe = 100 %). „Ungebaute Stufen“ erst nach der Live-Prüfung setzen; die Einstellung bleibt im Collector gespeichert.</p>` : ''}</div>`;
  }

  // Heimat = erster Planet des Imperiums im Live-Stand (je Account gemerkt)
  async function homeOf() {
    if (S.pwHome?.acc !== S.acc) {
      const r = await Cloud.q('state_latest', { account_id: `eq.${S.acc}`, kind: 'eq.live', select: 'pl:data->empire->planets' }).catch(() => []);
      const pl = Array.isArray(r[0]?.pl) ? r[0].pl : [];
      S.pwHome = { acc: S.acc, coords: pl.find(p => /^\d+:\d+:\d+$/.test(p?.coords || ''))?.coords || null };
    }
    return S.pwHome.coords;
  }

  // Abschnitt im Planet-Detail der Planeten-DB (planeten.js pdDetail): Werte genau dieses Planeten; nur eigene Planeten
  // und Planeten mit Werten, sonst ''. Messen bleibt die Karte im Reiter „Galaxie“.
  async function section(p) {
    const me = account()?.player || '';
    const where = { account_id: `eq.${S.acc}`, galaxy: `eq.${p.galaxy}`, system: `eq.${p.system}`, orbit: `eq.${p.orbit}` };
    const [rows, home] = await Promise.all([Cloud.q('planet_values', { ...where, order: 'key' }).catch(() => []), homeOf()]);
    const own = p.present && me && p.owner === me;
    if (!own && !rows.length) return '';
    const head = '<h3>Planetenwerte <span class="muted small">in % der Heimat (STPL = 100 %)</span></h3>';
    const link = `<a href="#/galaxie/${p.galaxy}/${p.system}">Karte „Planetenwerte“ in der Galaxie</a>`;
    if (!rows.length) return p.coords === home
      ? `${head}<p class="small muted">Heimat – Bezug für alle Kolonien (100 %).</p>`
      : `${head}<p class="small muted">Noch nicht gemessen. Der Collector misst beim ersten Besuch des Autobuilders auf diesem Planeten, sofort per Knopf in der ${link}.</p>`;
    const vs = Object.fromEntries(rows.map(v => [v.key, v]));
    const at = rows.map(v => v.measured_at).sort().pop();
    const done = Object.keys(MAIN).filter(k => k !== 'buildPlanet' && vs[k]?.status === 'gemessen').length;
    return `${head}<p class="small muted">${done} von 10 gemessen · zuletzt ${esc(dt(at))} (${esc(ago(at))})</p>
      <table class="wide small pw"><tr class="muted"><td>Wert</td><td class="num">Kolonie</td><td>Messung</td></tr>${Object.entries(MAIN).map(([k, n]) => row(k, n, vs[k])).join('')}</table>
      <details class="sub"><summary class="small muted">Umlaufbahn, Mond, Artefakte</summary>
        <table class="wide small pw">${Object.entries(REST).map(([k, n]) => row(k, n, vs[k])).join('')}</table></details>
      <p class="small muted">Kosten: über 100 % heißt teurer als die Heimat; Baugeschwindigkeit, Bauplanet-Faktor und Erträge: über 100 % heißt besser. Messen: ${link}.</p>`;
  }

  async function measure(form) {
    const planet = form.planet.value, ungebaut = form.ungebaut.checked;
    const sess = await loadSessions().catch(() => null);
    const dev = sess && target(sess);
    if (!dev) return toast(`Kein Collector ab ${MIN_VER} im Spiel eingeloggt – erst im Spiel einloggen`);
    if (!confirm(`Planetenwerte von ${planet} auf ${dev.name} messen?\n\nIm Spiel muss ${planet} gewählt sein, sonst bricht die Messung ab. `
      + `Der Collector liest nur (Gebäude, Forschung, Statistik, Hilfeseiten), gebaut wird nichts.${ungebaut ? '\n\nUngebaute Stufen zählen ab jetzt mit.' : ''}`)) return;
    try {
      await Cloud.rest('commands', { method: 'POST', prefer: 'return=minimal',
        body: { account_id: S.acc, script: 'autobuilder', cmd: 'planetwerte', args: { planet, ...(ungebaut ? { ungebaut: true } : {}) }, target_device: dev.device } });
      toast(`Kommando an ${dev.name} gesendet – Ergebnis unter Ereignisse, Werte hier nach dem Neuladen`);
      setTimeout(() => route(true), 1500);
    } catch (e) { toast(e.message); }
  }

  function bind(view) {
    const f = view.querySelector('#pwForm');
    if (f) f.addEventListener('submit', e => { e.preventDefault(); measure(f); });
  }

  window.HzPlanetwerte = { card, bind, section };
})();
