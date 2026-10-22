'use strict';
/* Planetenwerte im Reiter „Galaxie“ (Paket C, 17.10.2026): Grundwerte der eigenen Kolonien in % der Heimat (STPL = 100 %),
   gemessen vom Collector (ab 0.4.12) gleich nach der Kolonisierung – immer Stufe n gegen Stufe n, sonst „offen“.
   Ab Collector 0.4.14 nach der Bedeutung der Prospektionswerte (doku/wissen/statistik-monitor.md): T-Stoff ohne Bahn,
   Wohnraumkosten = Infrastruktur, Bodenfläche = Bauplatz der Infrastruktur, Besiedelbarkeit und Atmosphäre (Solar)
   gemessen, Bauplanet-Faktor neu (Migration 20261018090001).
   Daten: Tabelle planet_values (eine Zeile je Planet und Wert, Migration 20261017110001). Knopf „Planetenwerte messen“
   (nur Owner): Kommando planetwerte {planet, ungebaut?} an den Collector mit frischem Lebenszeichen im Spiel; er misst den im
   Spiel gewählten Planeten und wechselt ihn nie selbst. Ablauf am Tag der Landung: doku/stand/planeten-erfassung.md.
   STPL (22.10.2026, Nutzer): Ein Standardplanet ist der Bezug, seine Grundwerte stehen ohne Messung überall auf 100 %
   (Karte und Planet-Detail, auch fremde STPL); Umlaufbahn, Mond und Artefakte bleiben planetenabhängig und damit offen.
   Tabelle (22.10.2026, Nutzer): links unter dem System eine Tabelle, Zeilen = Werte, Spalten = eigene Planeten des Systems (Heimat
   zuerst) und die Planeten der Vergleichsauswahl der Planeten-DB (hz.pldb.cmp, bis 8); je Zelle Messung vor Prospektion vor STPL.
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
    'bauplatz-gesamt': 'Bauplatz gesamt', 'typ-median': 'Median des Typs', prospektion: 'erst mit Prospektion', 'prospektion-wert': 'Prospektionsbericht', stpl: 'Standardplanet = Bezug' };
  // Grundwerte eines STPL ohne Messung: überall 100 % (nur MAIN, siehe Kopf)
  const STPL = Object.fromEntries(Object.keys(MAIN).map(k => [k, { pct: 100, status: 'stpl', method: 'stpl' }]));

  const coords = (g, s, b) => `${g}:${s}:${b}`;
  const val = v => !v ? '<span class="muted">–</span>'
    : v.status === 'offen' ? '<span class="tag">offen</span>'
    : `<b>${esc(fmt(v.pct, 1))} %</b>${v.status === 'typ-median' ? ' <span class="tag">Median</span>' : v.status === 'stpl' ? ' <span class="tag">STPL</span>' : ''}`;
  // Spalte „Messung“: gemessen → Methode, Stufe, Notiz; offen → nur der Grund
  const info = v => !v ? '' : v.status === 'offen' ? v.note || METHOD[v.method] || ''
    : [METHOD[v.method] || v.method, v.level != null ? `Stufe ${v.level}` : '', v.note].filter(Boolean).join(' · ');
  const row = (k, n, v) => `<tr><td>${esc(n)}</td><td class="num nowrap">${val(v)}</td><td class="small muted">${esc(info(v))}</td></tr>`;

  // Collector, der messen kann: frisches Lebenszeichen, im Spiel eingeloggt, Version ab 0.4.12; Gerät mit dem Lauf zuerst
  const target = sess => sess.devs.filter(x => x.col && isFresh(x.col.at) && x.col.state?.page === 'game' && verCmp(x.col.version, MIN_VER) >= 0)
    .sort((a, b) => b.holds - a.holds || String(b.col.at).localeCompare(String(a.col.at)))[0] || null;

  // Prospektionswerte (planet_prospect.vals) je Planetenwert; Bauplanet-Faktor = Baugeschwindigkeit ÷ Gebäudekosten.
  // Atmosphäre: die Prospektion liefert die Dichte, nicht die Wirkung auf Solar (Tag „Dichte“).
  const PROS = { metal: 'Metallvorkommen', mineral: 'Mineralvorkommen', fuel: 'Treibstoffvorkommen', buildCost: 'Gebäudekosten',
    buildSpeed: 'Baugeschwindigkeit', researchCost: 'Forschungskosten', ground: 'Nutzbare Bodenfläche', housingCost: 'Kosten für Wohnraum',
    colonizable: 'Geschätzte Besiedelbarkeit', atmosphere: 'Atmosphärendichte', orbMetal: 'Orbital ausbeutbare Metallvorkommen',
    orbMineral: 'Orbital ausbeutbare Mineralvorkommen', orbFuel: 'Orbital ausbeutbare Treibstoffvorkommen', moon: 'Nutzbare Mondoberfläche',
    artefacts: 'Häufigkeit von Artefakten' };
  const CMPKEY = 'hz.pldb.cmp';   // Vergleichsauswahl der Planeten-DB (planeten.js pdCmpList)
  const cmpList = () => { try { const x = JSON.parse(localStorage.getItem(CMPKEY)); return Array.isArray(x) ? x : []; } catch { return []; } };
  const num = x => x != null && x !== '' && isFinite(+x) ? +x : null;

  // Wert eines Planeten (Spalte col): Messung vor Prospektion vor STPL = 100 %; sonst die offene Messung oder nichts
  function pick(col, k) {
    const m = col.meas?.[k];
    if (m && m.status !== 'offen') return m;
    const pr = col.pros;
    if (pr && k === 'buildPlanet') {
      const a = num(pr.Baugeschwindigkeit), b = num(pr.Gebäudekosten);
      if (a != null && b > 0) return { pct: a / b * 100, status: 'prospektion', method: 'prospektion-wert' };
    } else if (pr && num(pr[PROS[k]]) != null) return { pct: num(pr[PROS[k]]), status: 'prospektion', method: 'prospektion-wert',
      ...(k === 'atmosphere' ? { note: 'Atmosphärendichte, nicht die Wirkung auf Solar' } : {}) };
    if (col.type === 'STPL' && STPL[k]) return STPL[k];
    return m || null;
  }
  const TAGS = { 'typ-median': 'Median', prospektion: 'Prosp.' };   // STPL: nur im Spaltenkopf (Bezug), Messweg im Tooltip
  const cell = (k, v) => {
    if (!v) return '<td class="num muted">–</td>';
    if (v.status === 'offen') return `<td class="num" title="${esc(info(v))}"><span class="tag">offen</span></td>`;
    const n = k === 'artefacts' ? esc(fmt(v.pct, 0)) : `${esc(fmt(v.pct, 1))} %`;
    const tag = TAGS[v.status] ? ` <span class="tag">${k === 'atmosphere' && v.status === 'prospektion' ? 'Dichte' : TAGS[v.status]}</span>` : '';
    return `<td class="num nowrap" title="${esc(info(v))}"><b>${n}</b>${tag}</td>`;
  };
  const head = c => `<th class="num"><a href="#/planeten/p/${esc(c.coords)}">${esc(c.coords)}</a>${c.home ? ' ⌂' : ''}<br><span class="small">${esc(c.name || '–')}</span><br>
    ${c.type ? `<span class="ptype t-${esc(c.type)}">${esc(c.type)}</span>` : '<span class="ptype unk">?</span>'}${c.type === 'STPL' ? ' <span class="tag">Bezug 100 %</span>' : ''}${c.cmp ? ' <span class="tag">Vergleich</span>' : ''}
    ${c.at ? `<br><span class="small muted" title="gemessen ${esc(dt(c.at))}">gem. ${esc(ago(c.at))}</span>` : ''}</th>`;
  // Tabelle: Zeilen = Werte, Spalten = eigene Planeten des Systems (Heimat zuerst), dann die Planeten der Vergleichsauswahl
  function table(cols) {
    const rows = keys => Object.entries(keys).map(([k, n]) => `<tr><td>${esc(n)}</td>${cols.map(c => cell(k, pick(c, k))).join('')}</tr>`).join('');
    return `<div class="pdscroll"><table class="small pw pwt"><tr><th></th>${cols.map(head).join('')}</tr>${rows(MAIN)}
      <tr><th colspan="${cols.length + 1}" class="pdgrp">Umlaufbahn, Mond, Artefakte <span class="muted small">(nur Prospektion)</span></th></tr>${rows(REST)}</table></div>`;
  }
  // Spalten aus dem Systemstand (sofort) – Prospektion und Vergleich lädt fill() nach
  function sysCols(S0, g, s, homeOrbit) {
    const me = account()?.player || '';
    const by = {};
    for (const v of S0?.values || []) (by[v.orbit] ||= {})[v.key] = v;
    return (S0?.planets || []).filter(p => p.present && me && p.owner === me)
      .sort((a, b) => (b.orbit === homeOrbit) - (a.orbit === homeOrbit) || a.orbit - b.orbit)
      .map(p => ({ coords: coords(g, s, p.orbit), orbit: p.orbit, name: p.name, type: p.type, home: p.orbit === homeOrbit, meas: by[p.orbit] || null,
        at: by[p.orbit] ? Object.values(by[p.orbit]).map(v => v.measured_at).sort().pop() : null, pros: null }));
  }
  let last = null;   // Spalten der zuletzt gezeigten Karte (für fill)

  // Karte links unter dem System: eine Tabelle aller eigenen Planeten des Systems (+ Vergleichsauswahl) + Messknopf
  function card(S0, g, s, homeOrbit) {
    const cols = sysCols(S0, g, s, homeOrbit);
    last = null;
    if (!cols.length) return '';
    last = { g, s, cols };
    const opts = cols.map(c => `<option value="${esc(c.coords)}"${c.home ? '' : ' selected'}>Bahn ${c.orbit}${c.home ? ' (Heimat)' : ''} ${esc(c.name || '')}</option>`).join('');
    const n = cmpList().filter(k => !cols.some(c => c.coords === k)).length;
    return `<div class="card" id="pwCard"><h2>Planetenwerte <span class="muted small">in % der Heimat (STPL = 100 %)</span></h2>
      <div id="pwTable">${table(cols)}</div>
      <p class="small muted">${cols.some(c => c.meas) ? '' : 'Noch keine Kolonie gemessen. '}Gemessen vor Prospektion („Prosp.“) vor STPL = 100 %; Messweg beim Überfahren der Zahl.
        Kosten: über 100 % heißt teurer als die Heimat; Baugeschwindigkeit, Bauplanet-Faktor und Erträge: über 100 % heißt besser.
        ${n ? `Dazu ${n} Planet${n === 1 ? '' : 'en'} aus dem <a href="#/planeten/vergleich">Vergleich</a>.` : 'Weitere Planeten: in der Planeten-DB zum <a href="#/planeten/vergleich">Vergleich</a> wählen, sie erscheinen hier als Spalten.'}</p>
      ${isOwner() ? `<form id="pwForm" class="row" style="margin-top:6px;flex-wrap:wrap;gap:6px">
        <select name="planet" aria-label="Planet">${opts}</select>
        <label class="small"><input type="checkbox" name="ungebaut"> ungebaute Stufen zählen</label>
        <button class="primary">Planetenwerte messen</button></form>
        <p class="small muted">Gemessen wird der im Spiel gewählte Planet – vorher im Spiel dorthin wechseln, der Autobuilder sollte dabei pausieren.
          Auf der Heimat frischt die Messung den Bezug auf (Gegenprobe = 100 %). „Ungebaute Stufen“ erst nach der Live-Prüfung setzen; die Einstellung bleibt im Collector gespeichert.</p>` : ''}</div>`;
  }

  // Prospektion der Spalten und die Planeten der Vergleichsauswahl nachladen, dann die Tabelle neu zeichnen
  async function fill(view) {
    const L = last, box = view.querySelector('#pwTable');
    if (!L || !box) return;
    const extra = cmpList().filter(k => /^\d+:\d+:\d+$/.test(k) && !L.cols.some(c => c.coords === k)).slice(0, 8);
    const all = [...L.cols.map(c => c.coords), ...extra];
    const or = `(${all.map(k => { const [g, s, o] = k.split(':'); return `and(galaxy.eq.${g},system.eq.${s},orbit.eq.${o})`; }).join(',')})`;
    const a = `eq.${S.acc}`, key = r => `${r.galaxy}:${r.system}:${r.orbit}`;
    const [pros, pls, vals] = await Promise.all([
      Cloud.q('planet_prospect', { account_id: a, or, reports: 'gt.0', select: 'galaxy,system,orbit,vals' }).catch(() => []),
      extra.length ? Cloud.q('planets', { account_id: a, or, select: 'galaxy,system,orbit,name,type' }).catch(() => []) : [],
      extra.length ? Cloud.q('planet_values', { account_id: a, or }).catch(() => []) : [],
    ]);
    if (last !== L) return;   // inzwischen anderes System
    const P = new Map(pros.map(r => [key(r), r.vals || null])), N = new Map(pls.map(r => [key(r), r])), V = {};
    for (const v of vals) (V[key(v)] ||= {})[v.key] = v;
    const cols = [...L.cols.map(c => ({ ...c, pros: P.get(c.coords) || null })),
      ...extra.map(k => ({ coords: k, name: N.get(k)?.name, type: N.get(k)?.type, cmp: true, meas: V[k] || null, pros: P.get(k) || null,
        at: V[k] ? Object.values(V[k]).map(v => v.measured_at).sort().pop() : null }))];
    box.innerHTML = table(cols);
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
    const head = '<h3>Planetenwerte <span class="muted small">in % der Heimat (STPL = 100 %)</span></h3>';
    if (!rows.length && p.type === 'STPL') return `${head}<p class="small muted">Standardplanet${p.coords === home ? ' (Heimat)' : ''} – Bezug für alle Kolonien, Grundwerte ohne Messung 100 %.</p>
      <table class="wide small pw"><tr class="muted"><td>Wert</td><td class="num">Planet</td><td>Messung</td></tr>${Object.entries(MAIN).map(([k, n]) => row(k, n, STPL[k])).join('')}</table>`;
    if (!own && !rows.length) return '';
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
    fill(view).catch(() => { });
  }

  window.HzPlanetwerte = { card, bind, section };
})();
