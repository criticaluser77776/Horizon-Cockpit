'use strict';
/* Horizon Atlas – Reiter Planeten-DB (#/planeten…, D4 der Cockpit-Aufteilung = plan-planeten-db.md P4, 17.10.2026).
   Nachbau der Ansicht aus horizon-system-planet-database.user.js: DB-Browser (9722 ff.: Filter, Vorlagen, Sortierung in bis zu
   drei Stufen, Favoriten, Vergleich, Statistik), Planet-Detail mit den 15 Prospektionswerten (Farben 16407–16530, Bauzeit-Faktor
   16351), Spieler (18597) und Verlauf über alle Systeme (Ersatz für den Ereignis-Browser 16654 ff.).
   Daten: planets, planet_prospect, prospect_reports, planet_changes – nur lesend. Favoriten, Vergleich, Filter und Vorlagen je
   Browser in localStorage. Noch ohne P1 (Migration Planeten-DB 2): keine Kennung je Bericht (aktiv/inaktiv/leer), kein
   „verschoben“, Spieler aus planets berechnet. Typnamen, Status und Verlaufsarten aus galaxie.js (PL_TYPE, PL_STATUS, PL_FIELD). */

const PD_GROUPS = [
  ['Grundressourcen', ['Metallvorkommen', 'Mineralvorkommen', 'Treibstoffvorkommen']],
  ['Orbital', ['Orbital ausbeutbare Metallvorkommen', 'Orbital ausbeutbare Mineralvorkommen', 'Orbital ausbeutbare Treibstoffvorkommen']],
  ['Eigenschaften', ['Nutzbare Bodenfläche', 'Nutzbare Mondoberfläche', 'Kosten für Wohnraum', 'Forschungskosten', 'Gebäudekosten',
    'Baugeschwindigkeit', 'Geschätzte Besiedelbarkeit', 'Häufigkeit von Artefakten', 'Atmosphärendichte']],
];
const PD_BZF = 'Bauzeit-Faktor';
const PD_KEYS = [...PD_GROUPS.flatMap(g => g[1]), PD_BZF];
const PD_SHORT = { Metallvorkommen: 'Metall', Mineralvorkommen: 'Mineral', Treibstoffvorkommen: 'Treibstoff',
  'Orbital ausbeutbare Metallvorkommen': 'Orb. Metall', 'Orbital ausbeutbare Mineralvorkommen': 'Orb. Mineral',
  'Orbital ausbeutbare Treibstoffvorkommen': 'Orb. Treibstoff', 'Nutzbare Bodenfläche': 'Boden', 'Nutzbare Mondoberfläche': 'Mond',
  'Kosten für Wohnraum': 'Wohnraum', Forschungskosten: 'Forschung', Gebäudekosten: 'Gebäude', Baugeschwindigkeit: 'Baugeschw.',
  'Geschätzte Besiedelbarkeit': 'Besiedelbarkeit', 'Häufigkeit von Artefakten': 'Artefakte', Atmosphärendichte: 'Atmosphäre',
  [PD_BZF]: 'Bauzeit-Faktor' };
// Bewertung wie im Altskript: [Standard, +1 höher besser / −1 niedriger besser, erwartetes Minimum, Maximum]
const PD_RATE = { Metallvorkommen: [100, 1, 0, 300], Mineralvorkommen: [100, 1, 0, 300], Treibstoffvorkommen: [100, 1, 0, 300],
  'Orbital ausbeutbare Metallvorkommen': [100, 1, 0, 4000], 'Orbital ausbeutbare Mineralvorkommen': [100, 1, 0, 4000],
  'Orbital ausbeutbare Treibstoffvorkommen': [100, 1, 0, 4000], 'Nutzbare Bodenfläche': [100, 1, 0, 300],
  'Nutzbare Mondoberfläche': [100, 1, 0, 200], 'Kosten für Wohnraum': [100, -1, 40, 200], Forschungskosten: [100, -1, 30, 200],
  Gebäudekosten: [100, -1, 40, 200], Baugeschwindigkeit: [100, 1, 50, 250], 'Geschätzte Besiedelbarkeit': [100, 1, 0, 200],
  'Häufigkeit von Artefakten': [0, 1, 0, 15e6], Atmosphärendichte: [100, -1, 50, 200], [PD_BZF]: [1, 1, 0.25, 4] };

const pdKey = p => `${p.galaxy}:${p.system}:${p.orbit}`;
const pdGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const pdPut = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* egal */ } };
const pdFmt = (k, v) => v == null ? '–' : k === PD_BZF ? fmt(v, 2) : `${fmt(v, v < 10 ? 1 : 0)} %`;

// Farbe wie Altskript: grün in der guten, rot in der schlechten Richtung; Stärke = Abstand zum Standard / Abstand zur Bereichsgrenze
function pdTone(k, v) {
  const r = PD_RATE[k];
  if (!r || v == null || !isFinite(v)) return '';
  const [std, dir, min, max] = r;
  const good = dir > 0 ? v > std : v < std;
  const t = Math.min(Math.abs(v - std) / (Math.abs(good === dir > 0 ? max - std : std - min) || 1), 1);
  return t < 0.1 ? '' : ` style="background:color-mix(in srgb, var(${good ? '--ok' : '--bad'}) ${Math.round(10 + t * 30)}%, transparent)"`;
}

// Werte eines Planeten aus planet_prospect (gewichtetes Mittel) + Bauzeit-Faktor = Baugeschwindigkeit / Gebäudekosten
function pdVals(pr) {
  if (!pr?.vals) return null;
  const v = {};
  for (const [k, x] of Object.entries(pr.vals)) if (isFinite(+x)) v[k] = +x;
  if (v.Gebäudekosten > 0 && v.Baugeschwindigkeit != null) v[PD_BZF] = v.Baugeschwindigkeit / v.Gebäudekosten;
  return v;
}

// alle Planeten des Accounts (seitenweise, PostgREST gibt höchstens 1 000 je Abfrage) + Prospektion; 60 s zwischengespeichert
async function pdData(force) {
  if (!force && S.pd?.acc === S.acc && Date.now() - S.pd.at < 60e3) return S.pd;
  const a = `eq.${S.acc}`;
  const planets = [];
  for (let off = 0; off < 50000; off += 1000) {
    const page = await Cloud.q('planets', { account_id: a, order: 'galaxy,system,orbit', limit: 1000, offset: off });
    planets.push(...page);
    if (page.length < 1000) break;
  }
  const prospect = await Cloud.q('planet_prospect', { account_id: a, select: 'galaxy,system,orbit,reports,probes,last_report,vals' }).catch(() => []);
  const pr = new Map(prospect.map(x => [pdKey(x), x]));
  for (const p of planets) { p.coords = pdKey(p); p.pr = pr.get(p.coords) || null; p.v = pdVals(p.pr); }
  return (S.pd = { acc: S.acc, at: Date.now(), planets, byKey: new Map(planets.map(p => [p.coords, p])) });
}

const PD_DEF = { q: '', type: '', g: '', s1: '', s2: '', occ: '', status: '', prosp: '', vk: '', vop: 'ge', vv: '', fav: false, gone: false,
  col: PD_BZF, sort: [{ k: 'coords', d: 1 }] };
const pdF = () => ({ ...PD_DEF, ...pdGet('hz.pldb.f', {}) });
const pdFav = () => new Set(pdGet('hz.pldb.fav', []));
const pdCmpList = () => pdGet('hz.pldb.cmp', []);
const PD_NAV = [['', 'Suche'], ['statistik', 'Statistik'], ['verlauf', 'Verlauf'], ['spieler', 'Spieler'], ['vergleich', 'Vergleich']];

async function viewPlanetDb(rest = []) {
  const sub = rest[0] || '';
  const d = await pdData();
  const nav = `<div class="card pdnav row">${PD_NAV.map(([k, t]) => `<a href="#/planeten${k ? '/' + k : ''}"${k === sub || (!k && sub === 'p') ? ' class="on"' : ''}>${t}${k === 'vergleich' ? '<span id="pdCmpN"></span>' : ''}</a>`).join('')}
    <span class="small muted">${fmt(d.planets.length)} Planeten erfasst · ${fmt(d.planets.filter(p => p.pr).length)} prospektiert · Stand ${esc(clockT(d.at))}</span>
    <button id="pdReload" class="small" title="Daten neu laden">↻</button></div>`;
  if (sub === 'verlauf') await pdVerlauf(d, nav);
  else if (sub === 'spieler') pdSpieler(d, nav);
  else if (sub === 'statistik') pdStatistik(d, nav);
  else if (sub === 'vergleich') pdVergleich(d, nav);
  else pdBrowser(d, nav, sub === 'p' ? rest[1] : null);
  pdCmpCount();
  $('#pdReload')?.addEventListener('click', async () => { await pdData(true); route(true); });
}

const pdCmpCount = () => { const n = pdCmpList().length, el = $('#pdCmpN'); if (el) el.textContent = n ? ` (${n})` : ''; };

/* ---------- Suche (DB-Browser) ---------- */
const PD_COLS = [['coords', 'Koord.'], ['name', 'Name'], ['type', 'Typ'], ['owner', 'Besitzer'], ['alliance', 'Allianz'], ['status', 'Status'],
  ['prosp', 'Prospektion'], ['val', null], ['seen', 'gesehen']];
function pdSortVal(p, k, f) {
  switch (k) {
    case 'coords': return [p.galaxy, p.system, p.orbit];
    case 'name': return p.name ? p.name.toLowerCase() : null;
    case 'type': return p.type || null;
    case 'owner': return p.owner ? p.owner.toLowerCase() : null;
    case 'alliance': return p.alliance ? p.alliance.toLowerCase() : null;
    case 'status': return p.status || null;
    case 'prosp': return p.pr ? p.pr.probes : null;
    case 'val': return p.v?.[f.col] ?? null;
    case 'seen': return p.last_seen;
  }
  return null;
}
function pdCompare(a, b) {
  if (Array.isArray(a)) { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1; return 0; }
  return a < b ? -1 : a > b ? 1 : 0;
}
function pdFilter(list, f) {
  const q = f.q.trim().toLowerCase(), me = account()?.player || '', fav = pdFav();
  return list.filter(p => (f.gone || p.present)
    && (!q || [p.name, p.owner, p.alliance, p.coords, p.type, typeLabel(p)].some(x => (x || '').toLowerCase().includes(q)))
    && (!f.type || (f.type === '?' ? !p.type : p.type === f.type))
    && (!f.g || p.galaxy === +f.g) && (!f.s1 || p.system >= +f.s1) && (!f.s2 || p.system <= +f.s2)
    && (!f.occ || (f.occ === 'frei' ? !p.owner : f.occ === 'belegt' ? !!p.owner : !!me && p.owner === me))
    && (!f.status || p.status === f.status)
    && (!f.prosp || (f.prosp === 'ja') === !!p.pr)
    && (!f.vk || f.vv === '' || (p.v?.[f.vk] != null && (f.vop === 'le' ? p.v[f.vk] <= +f.vv : p.v[f.vk] >= +f.vv)))
    && (!f.fav || fav.has(p.coords)));
}
function pdSorted(list, f) {
  const keys = f.sort.length ? f.sort : PD_DEF.sort;
  return list.map(p => ({ p, s: keys.map(x => pdSortVal(p, x.k, f)) })).sort((A, B) => {
    for (let i = 0; i < keys.length; i++) {
      const a = A.s[i], b = B.s[i];
      if (a == null || b == null) { if (a !== b) return a == null ? 1 : -1; continue; }   // leer immer ans Ende
      const c = pdCompare(a, b) * keys[i].d;
      if (c) return c;
    }
    return pdCompare(A.s[0] ?? 0, B.s[0] ?? 0);
  }).map(x => x.p);
}

function pdBrowser(d, nav, sel) {
  const f = pdF(), presets = pdGet('hz.pldb.presets', {});
  const types = [...new Set(d.planets.map(p => p.type).filter(Boolean))].sort();
  const stats = [...new Set(d.planets.map(p => p.status).filter(Boolean))].sort();
  const opt = (v, t, cur) => `<option value="${esc(v)}"${String(v) === String(cur) ? ' selected' : ''}>${esc(t)}</option>`;
  $('#view').innerHTML = `${nav}<div class="card pdfilter"><form id="pdForm" class="pdf">
      <label>Suche<input name="q" value="${esc(f.q)}" placeholder="Name, Spieler, Allianz, G:S:B"></label>
      <label>Typ<select name="type">${opt('', 'alle', f.type)}${opt('?', 'unbekannt', f.type)}${types.map(t => opt(t, `${t} ${PL_TYPE[t] || ''}`, f.type)).join('')}</select></label>
      <label>Galaxie<input name="g" type="number" min="1" max="99" value="${esc(f.g)}" class="pdn"></label>
      <label>System<span class="row nowrap"><input name="s1" type="number" min="1" max="9999" value="${esc(f.s1)}" class="pdn" placeholder="von">–<input name="s2" type="number" min="1" max="9999" value="${esc(f.s2)}" class="pdn" placeholder="bis"></span></label>
      <label>Belegung<select name="occ">${opt('', 'alle', f.occ)}${opt('frei', 'frei', f.occ)}${opt('belegt', 'belegt', f.occ)}${opt('eigen', 'eigene', f.occ)}</select></label>
      <label>Status<select name="status">${opt('', 'alle', f.status)}${stats.map(s => opt(s, PL_STATUS[s] || s, f.status)).join('')}</select></label>
      <label>Prospektiert<select name="prosp">${opt('', 'egal', f.prosp)}${opt('ja', 'ja', f.prosp)}${opt('nein', 'nein', f.prosp)}</select></label>
      <label>Wert<span class="row nowrap"><select name="vk">${opt('', '–', f.vk)}${PD_KEYS.map(k => opt(k, PD_SHORT[k], f.vk)).join('')}</select><select name="vop">${opt('ge', '≥', f.vop)}${opt('le', '≤', f.vop)}</select><input name="vv" type="number" step="any" value="${esc(f.vv)}" class="pdn"></span></label>
      <label>Wertspalte<select name="col">${PD_KEYS.map(k => opt(k, PD_SHORT[k], f.col)).join('')}</select></label>
      <label class="pdchk"><input type="checkbox" name="fav"${f.fav ? ' checked' : ''}> nur Favoriten ★</label>
      <label class="pdchk"><input type="checkbox" name="gone"${f.gone ? ' checked' : ''}> leere Bahnen zeigen</label>
    </form>
    <div class="row pdpre small"><span class="muted">Vorlage</span><select id="pdPreset"><option value="">–</option>${Object.keys(presets).sort().map(n => `<option>${esc(n)}</option>`).join('')}</select>
      <button id="pdPreSave" type="button">speichern …</button><button id="pdPreDel" type="button">löschen</button><button id="pdReset" type="button">Filter zurücksetzen</button>
      <span class="muted">Sortieren: Spaltenkopf antippen, mit Umschalt bis zu drei Stufen.</span></div></div>
    <div class="pdgrid"><div class="card pdlist" id="pdList"></div><div class="pdside" id="pdDet"></div></div>`;
  const form = $('#pdForm');
  const read = () => {
    const n = { ...pdF() };
    for (const el of form.elements) if (el.name) n[el.name] = el.type === 'checkbox' ? el.checked : el.value;
    return n;
  };
  let tm;
  const apply = () => { pdPut('hz.pldb.f', read()); S.pdShow = 200; pdList(d); };
  form.addEventListener('change', apply);
  form.addEventListener('input', e => { if (e.target.name === 'q') { clearTimeout(tm); tm = setTimeout(apply, 250); } });
  form.addEventListener('submit', e => { e.preventDefault(); apply(); });
  $('#pdPreset').onchange = e => { const p = presets[e.target.value]; if (p) { pdPut('hz.pldb.f', { ...PD_DEF, ...p }); route(true); } };
  $('#pdPreSave').onclick = () => {
    const n = (prompt('Name der Vorlage', $('#pdPreset').value || '') || '').trim().slice(0, 40);
    if (!n) return;
    pdPut('hz.pldb.presets', { ...presets, [n]: read() }); toast(`Vorlage „${n}“ gespeichert`); route(true);
  };
  $('#pdPreDel').onclick = () => {
    const n = $('#pdPreset').value;
    if (!n || !confirm(`Vorlage „${n}“ löschen?`)) return;
    const { [n]: _, ...restP } = presets; pdPut('hz.pldb.presets', restP); route(true);
  };
  $('#pdReset').onclick = () => { pdPut('hz.pldb.f', { ...PD_DEF, col: f.col }); route(true); };
  S.pdShow = 200;
  S.pdSel = sel && d.byKey.has(sel) ? sel : null;
  pdList(d);
  pdShowSide(d);
}

function pdList(d) {
  const f = pdF(), fav = pdFav(), cmp = new Set(pdCmpList()), me = account()?.player || '';
  const list = pdSorted(pdFilter(d.planets, f), f);
  S.pdLast = list;
  pdCmpCount();
  const arrow = k => { const i = f.sort.findIndex(x => x.k === k); return i < 0 ? '' : ` ${f.sort[i].d > 0 ? '▲' : '▼'}${f.sort.length > 1 ? i + 1 : ''}`; };
  const head = PD_COLS.map(([k, t]) => `<th data-sort="${k}"${['prosp', 'val', 'seen'].includes(k) ? ' class="num"' : ''}>${esc(t ?? PD_SHORT[f.col])}${arrow(k)}</th>`).join('');
  const rows = list.slice(0, S.pdShow).map(p => {
    const v = p.v?.[f.col];
    return `<tr data-k="${p.coords}" class="${p.present ? '' : 'gone'}${p.coords === S.pdSel ? ' sel' : ''}${me && p.owner === me ? ' own' : ''}">
      <td class="pdstar${fav.has(p.coords) ? ' on' : ''}" data-fav title="Favorit">${fav.has(p.coords) ? '★' : '☆'}</td>
      <td class="nowrap"><a href="#/galaxie/${p.galaxy}/${p.system}" title="System in der Galaxie">${p.coords}</a></td>
      <td class="nowrap">${esc(p.name || '–')}</td>
      <td class="nowrap">${p.type ? `<span class="ptype t-${esc(p.type)}">${esc(p.type)}</span> <span class="small muted">${esc(PL_TYPE[p.type] || p.type_name || '')}</span>` : '<span class="muted">?</span>'}</td>
      <td>${p.owner ? esc(p.owner) : '<span class="muted">frei</span>'}</td><td>${esc(p.alliance)}</td>
      <td class="small">${esc(PL_STATUS[p.status] || p.status)}${p.present ? '' : ' <b>Bahn leer</b>'}</td>
      <td class="num small">${p.pr ? `${p.pr.reports} Ber. · ${fmt(p.pr.probes)} S.` : '<span class="muted">–</span>'}</td>
      <td class="num"${pdTone(f.col, v)}>${pdFmt(f.col, v)}</td>
      <td class="num small muted nowrap" title="${esc(dt(p.last_seen))}">${esc(ago(p.last_seen))}</td>
      <td><input type="checkbox" data-cmp title="zum Vergleich"${cmp.has(p.coords) ? ' checked' : ''}></td></tr>`;
  }).join('');
  $('#pdList').innerHTML = `<div class="row between"><h2>Planeten <span class="muted small">${fmt(list.length)} Treffer${list.length > S.pdShow ? `, ${fmt(S.pdShow)} gezeigt` : ''}</span></h2>
      <span class="small muted">Zeile antippen = Details · ☐ = Vergleich</span></div>
    ${list.length ? `<div class="pdscroll"><table class="wide pdtab small"><thead><tr><th></th>${head}<th title="Vergleich">⇆</th></tr></thead><tbody>${rows}</tbody></table></div>
      ${list.length > S.pdShow ? `<p><button id="pdMore">weitere ${fmt(Math.min(200, list.length - S.pdShow))} zeigen</button></p>` : ''}`
      : `<p class="muted">${d.planets.length ? 'Kein Planet passt zum Filter.' : 'Noch keine Planeten erfasst – der Collector liest bisher nur das eigene System.'}</p>`}`;
  const L = $('#pdList');
  L.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', e => {
    const k = th.dataset.sort, cur = pdF();
    let s = [...cur.sort];
    const i = s.findIndex(x => x.k === k);
    if (e.shiftKey) { if (i >= 0) s[i] = { k, d: -s[i].d }; else if (s.length < 3) s.push({ k, d: 1 }); }
    else s = [{ k, d: i === 0 && s.length === 1 ? -s[0].d : 1 }];
    pdPut('hz.pldb.f', { ...cur, sort: s }); pdList(d);
  }));
  $('#pdMore')?.addEventListener('click', () => { S.pdShow += 200; pdList(d); });
  L.querySelector('tbody')?.addEventListener('click', e => {
    const tr = e.target.closest('tr[data-k]');
    if (!tr || e.target.closest('a')) return;
    const k = tr.dataset.k;
    if (e.target.closest('[data-fav]')) {
      const s = pdFav(); s.has(k) ? s.delete(k) : s.add(k); pdPut('hz.pldb.fav', [...s]); return pdList(d);
    }
    if (e.target.closest('[data-cmp]')) {
      const c = pdCmpList().filter(x => x !== k);
      if (e.target.checked) c.push(k);
      pdPut('hz.pldb.cmp', c.slice(-8)); return pdList(d);
    }
    S.pdSel = S.pdSel === k ? null : k;
    history.replaceState(null, '', S.pdSel ? `#/planeten/p/${k}` : '#/planeten');
    L.querySelectorAll('tr.sel').forEach(x => x.classList.remove('sel'));
    if (S.pdSel) tr.classList.add('sel');
    pdShowSide(d);
  });
}

// rechte Spalte: Planet-Detail, sonst Statistik der Treffer
function pdShowSide(d) {
  const box = $('#pdDet');
  if (!box) return;
  const p = S.pdSel && d.byKey.get(S.pdSel);
  if (!p) { box.innerHTML = pdStats(S.pdLast || d.planets); return; }
  box.innerHTML = `<div class="card"><p class="muted">Lädt …</p></div>`;
  pdDetail(p).then(h => { if (S.pdSel !== p.coords) return; box.innerHTML = h; pdBindDetail(d, p); })   // inzwischen anderer Planet gewählt → verwerfen
    .catch(e => { if (S.pdSel === p.coords) box.innerHTML = `<div class="card"><p class="err">${esc(e.message)}</p></div>`; });
}

function pdStats(list) {
  const pres = list.filter(p => p.present);
  const by = {};
  for (const p of pres) by[p.type || '?'] = (by[p.type || '?'] || 0) + 1;
  const max = Math.max(1, ...Object.values(by));
  const rows = Object.entries(by).sort((a, b) => b[1] - a[1]).map(([t, n]) => `<tr><td class="nowrap">${t === '?' ? '<span class="muted">unbekannt</span>'
    : `<span class="ptype t-${esc(t)}">${esc(t)}</span> <span class="small">${esc(PL_TYPE[t] || '')}</span>`}</td><td class="num">${n}</td>
    <td style="width:45%"><div class="pdbar" style="width:${Math.round(n / max * 100)}%"></div></td></tr>`).join('');
  const free = pres.filter(p => !p.owner).length;
  return `<div class="card"><h2>Statistik <span class="muted small">der Treffer</span></h2>
    <p class="small">${fmt(pres.length)} Planeten · ${fmt(free)} frei · ${fmt(pres.length - free)} belegt · ${fmt(pres.filter(p => p.pr).length)} prospektiert
      · ${fmt(new Set(pres.map(p => `${p.galaxy}:${p.system}`)).size)} Systeme</p>
    ${rows ? `<table class="wide small"><tr><th>Typ</th><th class="num">Anzahl</th><th>Verteilung</th></tr>${rows}</table>` : ''}
    <p class="small muted">Zeile in der Liste antippen zeigt hier den Planeten: 15 Werte, Berichte, Verlauf.</p></div>`;
}

async function pdDetail(p) {
  const where = { account_id: `eq.${S.acc}`, galaxy: `eq.${p.galaxy}`, system: `eq.${p.system}`, orbit: `eq.${p.orbit}` };
  const [reports, changes] = await Promise.all([
    Cloud.q('prospect_reports', { ...where, select: 'report_at,probes,vals,src_id', order: 'report_at.desc', limit: 50 }).catch(() => []),
    Cloud.q('planet_changes', { ...where, order: 't.desc,id.desc', limit: 50 }),
  ]);
  const fav = pdFav().has(p.coords), cmp = pdCmpList().includes(p.coords);
  const vals = p.v ? PD_GROUPS.map(([g, ks]) => `<tr><th colspan="2" class="pdgrp">${g}</th></tr>${ks.map(k => `<tr><td>${esc(k)}</td>
      <td class="num"${pdTone(k, p.v[k])}>${pdFmt(k, p.v[k])}</td></tr>`).join('')}`).join('')
    + `<tr><th colspan="2" class="pdgrp">Berechnet</th></tr><tr><td title="Baugeschwindigkeit ÷ Gebäudekosten: > 1 baut schneller als ein Standardplanet">${PD_BZF}</td>
      <td class="num"${pdTone(PD_BZF, p.v[PD_BZF])}>${pdFmt(PD_BZF, p.v[PD_BZF])}</td></tr>` : '';
  const rep = reports.map(r => `<tr><td class="small nowrap">${esc(dt(r.report_at))}</td><td class="num">${fmt(r.probes)}</td>
    <td class="num">${Object.keys(r.vals || {}).length || '<span class="muted">leer</span>'}</td></tr>`).join('');
  const chg = changes.map(c => `<tr><td class="small muted nowrap">${esc(dt(c.t))}</td><td class="small">${esc(PL_FIELD[c.field] || c.field)}</td>
    <td class="small wrapall">${c.old && c.new ? `${esc(c.old)} → ${esc(c.new)}` : esc(c.old || c.new)}</td></tr>`).join('');
  return `<div class="card pddet"><div class="row between"><h2>${esc(p.name || 'Planet')} <span class="muted small">${p.coords}</span></h2>
      <span class="row"><button data-dfav title="Favorit">${fav ? '★' : '☆'}</button><button data-dcmp>${cmp ? 'aus Vergleich' : 'zum Vergleich'}</button><button data-dclose title="schließen">✕</button></span></div>
    <p class="small">${p.type ? `<span class="ptype t-${esc(p.type)}">${esc(p.type)}</span> ${esc(typeLabel(p))}` : '<span class="muted">Typ unbekannt</span>'}
      · ${p.owner ? `${esc(p.owner)}${p.alliance ? ` [${esc(p.alliance)}]` : ''}${p.status ? ` · ${esc(PL_STATUS[p.status] || p.status)}` : ''}` : 'frei'}
      ${p.present ? '' : ` · <b>Bahn leer seit ${esc(dt(p.changed_at))}</b>`}</p>
    <p class="small muted">Erstmals ${esc(dt(p.first_seen))} · zuletzt ${esc(dt(p.last_seen))}${p.main_p_id ? ` · Planet-ID ${p.main_p_id}` : ''}
      · <a href="#/galaxie/${p.galaxy}/${p.system}">System ${p.galaxy}:${p.system} in der Galaxie</a></p>
    <h3>Prospektion ${p.pr ? `<span class="muted small">${p.pr.reports} Bericht${p.pr.reports === 1 ? '' : 'e'} · ${fmt(p.pr.probes)} Sonden (⌀ ${fmt(p.pr.probes / p.pr.reports)}) · zuletzt ${esc(dt(p.pr.last_report))}</span>` : ''}</h3>
    ${vals ? `<table class="wide small pdvals">${vals}</table><p class="small muted">Gewichtetes Mittel nach Sondenzahl, je Wert nur über die Berichte, die ihn enthalten.
      Grün/rot = besser/schlechter als ein Standardplanet (Farbregeln aus der alten Planeten-DB).</p>`
      : '<p class="small muted">Noch nicht prospektiert. Prospektionssonden (PRDR) brauchen Werft 3, Kommunikationstechnik 13 und Sensortechnik 1 (sonden.md).</p>'}
    ${rep ? `<details class="sub"><summary class="small">Berichte (${reports.length})</summary><table class="wide small"><tr><th>Zeit</th><th class="num">Sonden</th><th class="num">Werte</th></tr>${rep}</table>
      <p class="small muted">Alle Berichte zählen; aktiv/inaktiv nach einem Planetenwechsel kommt mit der Migration Planeten-DB 2 (P1).</p></details>` : ''}
    <h3>Verlauf</h3>${chg ? `<table class="wide small"><tr><th>Zeit</th><th>Was</th><th>Änderung</th></tr>${chg}</table>` : '<p class="small muted">Keine Änderungen.</p>'}
    ${pdActions(p)}</div>`;
}

// Aktionsbereich (Entscheidung 7.3 neu, 17.10. abends: Spielaktionen im Atlas nur Owner, jede einzeln mit Rückfrage, als Kommando
// ans Skript). Prospektieren: details/sonden.js (Dialog, Kommando „sonden“ an den Autobuilder ab 0.5.33, plan-planeten-db.md P5).
// p = Planet (Planet-Detail) oder null (System in der Galaxie; dort steht der Knopf je Bahn).
function pdActions(p) {
  if (!isOwner()) return '';
  return `<div class="pdact"><h3>Aktionen <span class="muted small">${p ? `Planet ${p.coords}` : 'System'}</span></h3><div class="row">
    ${p ? prbButton(p) || '<span class="small muted">Bahn leer – nichts zu prospektieren</span>' : '<span class="small muted">Prospektieren: Knopf 🛰 an der Bahn</span>'}
    <span class="small muted">Rückfrage mit Sondenzahl, Verbänden und „Nur prüfen“</span></div></div>`;
}

function pdBindDetail(d, p) {
  const box = $('#pdDet');
  box.querySelector('[data-dclose]')?.addEventListener('click', () => { S.pdSel = null; history.replaceState(null, '', '#/planeten'); pdList(d); pdShowSide(d); });
  box.querySelector('[data-dfav]')?.addEventListener('click', () => { const s = pdFav(); s.has(p.coords) ? s.delete(p.coords) : s.add(p.coords); pdPut('hz.pldb.fav', [...s]); pdList(d); pdShowSide(d); });
  box.querySelector('[data-dcmp]')?.addEventListener('click', () => {
    const c = pdCmpList(), i = c.indexOf(p.coords);
    i >= 0 ? c.splice(i, 1) : c.push(p.coords);
    pdPut('hz.pldb.cmp', c.slice(-8)); pdList(d); pdShowSide(d);
  });
}

/* ---------- Statistik (Altskript createStatisticsDialog 10846 / calculateDetailedStatistics 12820) ----------
   Kacheln, Besiedlung nach Typ und Galaxie, andere Objekte, Typ-Verteilung je Galaxie, Bahn × Typ je Galaxie (Farbverlauf je Zeile
   rot → gelb → grün zwischen kleinster und größter Zahl, größte fett). Hauptplaneten = die 17 Planetentypen; Asteroidenfelder,
   Sprungtore usw. zählen als andere Objekte, Planeten ohne bekannten Typ (Sternwarte < 2) gesondert. Wahlweise nur die Treffer der Suche. */
const PD_MAIN = new Set(['STPL', 'VUPL', 'JUPL', 'FOPL', 'HYPL', 'DSPL', 'LVPL', 'MUPL', 'CLPL', 'IDPL', 'MIPL', 'EOPL', 'ACPL', 'ICPL', 'WAPL', 'RKPL', 'CRPL']);
const PD_GAL = { 1: 'Green Heart', 2: 'Blue Heaven', 3: 'Ghost Island', 4: 'Deep Water', 5: 'Fire Starter', 6: 'Pantheon' };   // Namen aus dem Altskript (12873)
const pdTypeCell = t => `<span class="ptype t-${esc(t)}">${esc(t)}</span> <span class="small">${esc(PL_TYPE[t] || '')}</span>`;
const pdCount = (list, f) => { const o = {}; for (const x of list) { const k = f(x); o[k] = (o[k] || 0) + 1; } return o; };
function pdBarTable(head, counts, total, label, sort) {
  const rows = Object.entries(counts).sort(sort || ((a, b) => b[1] - a[1]));
  if (!rows.length) return '<p class="small muted">Keine Daten.</p>';
  const max = Math.max(...rows.map(r => r[1]));   // Balken relativ zum größten Wert, Anteil in der Spalte %
  return `<table class="wide small"><tr><th>${head}</th><th class="num">Anzahl</th><th>Verteilung</th><th class="num">%</th></tr>${rows.map(([k, n]) =>
    `<tr><td class="nowrap">${label(k)}</td><td class="num">${fmt(n)}</td><td style="width:45%"><div class="pdbar" style="width:${(n / max * 100).toFixed(1)}%"></div></td>
      <td class="num muted">${fmt(n / total * 100, 1)}</td></tr>`).join('')}</table>`;
}
// Zelle der Bahn-Tabelle: rot (selten) → gelb → grün (häufig) innerhalb der Zeile
function pdHeat(n, min, max) {
  if (!n) return '';
  const t = max === min ? 1 : (n - min) / (max - min);
  const c = t < 0.5 ? `color-mix(in srgb, var(--warn) ${Math.round(t * 200)}%, var(--bad))` : `color-mix(in srgb, var(--ok) ${Math.round((t - 0.5) * 200)}%, var(--warn))`;
  return ` style="background:color-mix(in srgb, ${c} 35%, transparent)"`;
}
function pdStatistik(d, nav) {
  const useF = !!pdGet('hz.pldb.statf', false);
  const all = useF ? pdFilter(d.planets, { ...pdF(), gone: true }) : d.planets;
  const pres = all.filter(p => p.present), gone = all.length - pres.length;
  const main = pres.filter(p => PD_MAIN.has(p.type)), other = pres.filter(p => p.type && !PD_MAIN.has(p.type)), unk = pres.filter(p => !p.type);
  const occ = main.filter(p => p.owner);
  const systems = new Set(pres.map(p => `${p.galaxy}:${p.system}`)).size;
  const gals = [...new Set(main.map(p => p.galaxy))].sort((a, b) => a - b);
  const galName = g => `${g}${PD_GAL[g] ? ` · ${PD_GAL[g]}` : ''}`;
  const tile = (n, t, tip = '') => `<div class="pdtile"${tip ? ` title="${esc(tip)}"` : ''}><b>${n}</b><span class="small muted">${t}</span></div>`;
  const galCards = gals.map(g => {
    const gp = main.filter(p => p.galaxy === g);
    return `<div class="card"><h3>Galaxie ${esc(galName(g))} <span class="muted small">${fmt(gp.length)} Planeten</span></h3>${pdBarTable('Typ', pdCount(gp, p => p.type), gp.length, pdTypeCell)}</div>`;
  }).join('');
  const posCards = gals.map(g => {
    const gp = main.filter(p => p.galaxy === g);
    const types = [...new Set(gp.map(p => p.type))].sort();
    const by = new Map();
    for (const p of gp) { const r = by.get(p.orbit) || {}; r[p.type] = (r[p.type] || 0) + 1; by.set(p.orbit, r); }
    const rows = [...by.keys()].sort((a, b) => a - b).map(o => {
      const r = by.get(o), xs = Object.values(r), min = Math.min(...xs), max = Math.max(...xs);
      return `<tr><th class="num">${o}</th>${types.map(t => `<td class="num"${pdHeat(r[t], min, max)}>${r[t] ? (r[t] === max ? `<b>${r[t]}</b>` : r[t]) : '<span class="muted">–</span>'}</td>`).join('')}
        <td class="num muted">${xs.reduce((a, b) => a + b, 0)}</td></tr>`;
    }).join('');
    return `<div class="card"><h3>Galaxie ${esc(galName(g))} <span class="muted small">Bahn × Typ, ${new Set(gp.map(p => p.system)).size} Systeme</span></h3>
      <div class="pdscroll"><table class="wide small pdheat"><tr><th class="num">Bahn</th>${types.map(t => `<th class="num" title="${esc(PL_TYPE[t] || t)}"><span class="ptype t-${esc(t)}">${esc(t)}</span></th>`).join('')}<th class="num">Σ</th></tr>${rows}</table></div></div>`;
  }).join('');
  $('#view').innerHTML = `${nav}<div class="card"><div class="row between"><h2>Statistik <span class="muted small">${useF ? 'Treffer der Suche' : 'alle erfassten Planeten'}</span></h2>
      <label class="small row"><input type="checkbox" id="pdStatF"${useF ? ' checked' : ''}> Filter der Suche anwenden</label></div>
    <div class="pdtiles">${tile(fmt(systems), 'bekannte Systeme')}${tile(fmt(main.length), 'bekannte Planeten', 'die 17 Planetentypen')}
      ${tile(fmt(occ.length), 'besiedelte Planeten')}${tile(fmt(main.length - occ.length), 'freie Planeten')}${tile(fmt(other.length), 'andere Objekte', 'Asteroidenfelder, Sprungtore, Schreine, Arenen, Mutterschiffe')}
      ${tile(fmt(unk.length), 'Typ unbekannt', 'erst ab Sternwarte 2 sichtbar')}${tile(fmt(all.length), 'erfasste Positionen')}${tile(fmt(gone), 'leere Positionen', 'Bahn war belegt, ist jetzt leer')}
      ${tile(all.length ? `${fmt(pres.length / all.length * 100, 1)} %` : '–', 'Belegungsrate', 'belegte ÷ erfasste Positionen')}</div>
    <p class="small muted">Erfasst wird nur, was der Collector gelesen hat – bisher vor allem das eigene System. Bahnen, die nie belegt waren, kennt die Datenbank nicht.</p></div>
    <div class="cols2"><div class="card"><h3>Besiedlung nach Typ <span class="muted small">${fmt(occ.length)} besiedelt</span></h3>${pdBarTable('Typ', pdCount(occ, p => p.type), occ.length, pdTypeCell)}</div>
      <div class="card"><h3>Besiedlung nach Galaxie</h3>${pdBarTable('Galaxie', pdCount(occ, p => p.galaxy), occ.length, g => esc(galName(g)), (a, b) => a[0] - b[0])}
        ${other.length ? `<h3>Andere Objekte <span class="muted small">${fmt(other.length)}</span></h3>${pdBarTable('Typ', pdCount(other, p => p.type), other.length, pdTypeCell)}` : ''}</div></div>
    <h2 class="pdsec">Typ-Verteilung je Galaxie</h2>${galCards ? `<div class="cols2">${galCards}</div>` : '<p class="muted">Noch keine Planeten mit bekanntem Typ.</p>'}
    <h2 class="pdsec">Typ-Verteilung nach Bahn <span class="muted small">je Zeile rot = selten → grün = häufig, häufigster Typ fett</span></h2>${posCards || '<p class="muted">Noch keine Planeten mit bekanntem Typ.</p>'}`;
  $('#pdStatF').addEventListener('change', e => { pdPut('hz.pldb.statf', e.target.checked); route(true); });
}

/* ---------- Vergleich: gewählte Planeten nebeneinander, bester Wert je Zeile fett ---------- */
function pdVergleich(d, nav) {
  const list = pdCmpList().map(k => d.byKey.get(k)).filter(Boolean);
  const best = k => {
    const xs = list.map(p => p.v?.[k]).filter(v => v != null);
    if (xs.length < 2) return null;
    return PD_RATE[k][1] > 0 ? Math.max(...xs) : Math.min(...xs);
  };
  const row = (lbl, f) => `<tr><td>${lbl}</td>${list.map(p => `<td>${f(p)}</td>`).join('')}</tr>`;
  const body = !list.length ? '<p class="muted">Noch nichts gewählt – in der Suche bei einem Planeten ☐ anhaken (bis zu 8).</p>'
    : `<div class="pdscroll"><table class="wide small pdcmp"><tr><th></th>${list.map(p => `<th><a href="#/planeten/p/${p.coords}">${p.coords}</a><br>${esc(p.name || '–')}
        <button class="link small" data-rm="${p.coords}" title="aus dem Vergleich">✕</button></th>`).join('')}</tr>
      ${row('Typ', p => p.type ? `<span class="ptype t-${esc(p.type)}">${esc(p.type)}</span> ${esc(PL_TYPE[p.type] || '')}` : '?')}
      ${row('Besitzer', p => p.owner ? esc(p.owner) + (p.alliance ? ` [${esc(p.alliance)}]` : '') : '<span class="muted">frei</span>')}
      ${row('Prospektion', p => p.pr ? `${p.pr.reports} Ber. · ${fmt(p.pr.probes)} S.` : '<span class="muted">–</span>')}
      ${PD_GROUPS.map(([g, ks]) => `<tr><th colspan="${list.length + 1}" class="pdgrp">${g}</th></tr>${ks.map(k => { const b = best(k); return `<tr><td>${esc(PD_SHORT[k])}</td>${list.map(p => {
        const v = p.v?.[k]; return `<td class="num"${pdTone(k, v)}>${v != null && v === b ? `<b>${pdFmt(k, v)}</b>` : pdFmt(k, v)}</td>`; }).join('')}</tr>`; }).join('')}`).join('')}
      <tr><th colspan="${list.length + 1}" class="pdgrp">Berechnet</th></tr>
      <tr><td>${PD_BZF}</td>${list.map(p => { const v = p.v?.[PD_BZF], b = best(PD_BZF); return `<td class="num"${pdTone(PD_BZF, v)}>${v != null && v === b ? `<b>${pdFmt(PD_BZF, v)}</b>` : pdFmt(PD_BZF, v)}</td>`; }).join('')}</tr>
      </table></div><p><button id="pdCmpClear">Vergleich leeren</button></p>`;
  $('#view').innerHTML = `${nav}<div class="card"><h2>Vergleich <span class="muted small">bester Wert je Zeile fett</span></h2>${body}</div>`;
  $('#view').querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => { pdPut('hz.pldb.cmp', pdCmpList().filter(x => x !== b.dataset.rm)); route(true); }));
  $('#pdCmpClear')?.addEventListener('click', () => { pdPut('hz.pldb.cmp', []); route(true); });
}

/* ---------- Spieler: aus planets berechnet (View planet_players kommt mit P1) ---------- */
function pdSpieler(d, nav) {
  const by = new Map();
  for (const p of d.planets) {
    if (!p.owner || !p.present) continue;
    const x = by.get(p.owner) || { name: p.owner, n: 0, gal: new Set(), first: p.first_seen, last: p.last_seen, ally: '', status: '', at: '' };
    x.n++; x.gal.add(p.galaxy);
    if (p.first_seen < x.first) x.first = p.first_seen;
    if (p.last_seen >= x.at) { x.at = p.last_seen; x.ally = p.alliance; x.status = p.status; }
    if (p.last_seen > x.last) x.last = p.last_seen;
    by.set(p.owner, x);
  }
  const me = account()?.player || '';
  const list = [...by.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  $('#view').innerHTML = `${nav}<div class="card"><h2>Spieler <span class="muted small">${list.length} mit Planeten in den erfassten Systemen</span></h2>
    ${list.length ? `<table class="wide small"><tr><th>Spieler</th><th>Allianz</th><th>Status</th><th class="num">Planeten</th><th>Galaxien</th><th>erstmals</th><th>zuletzt</th><th></th></tr>
      ${list.map(x => `<tr${x.name === me ? ' class="own"' : ''}><td><b>${esc(x.name)}</b></td><td>${esc(x.ally)}</td><td>${esc(PL_STATUS[x.status] || x.status)}</td><td class="num">${x.n}</td>
        <td>${[...x.gal].sort((a, b) => a - b).join(', ')}</td><td class="nowrap">${esc(dt(x.first))}</td><td class="nowrap">${esc(dt(x.last))}</td>
        <td class="nowrap"><button class="link" data-pl="${esc(x.name)}">Planeten</button> · <button class="link" data-vl="${esc(x.name)}">Verlauf</button></td></tr>`).join('')}</table>`
      : '<p class="muted">Noch keine Planeten mit Besitzer erfasst.</p>'}
    <p class="small muted">Berechnet aus den erfassten Planeten; Allianz und Status vom zuletzt gesehenen Planeten des Spielers.</p></div>`;
  $('#view').querySelectorAll('[data-pl]').forEach(b => b.addEventListener('click', () => {
    pdPut('hz.pldb.f', { ...pdF(), q: b.dataset.pl, occ: '' }); location.hash = '#/planeten';
  }));
  $('#view').querySelectorAll('[data-vl]').forEach(b => b.addEventListener('click', () => {
    pdPut('hz.pldb.vf', { ...pdGet('hz.pldb.vf', {}), q: b.dataset.vl }); location.hash = '#/planeten/verlauf';
  }));
}

/* ---------- Verlauf über alle Systeme (planet_changes, neueste zuerst, höchstens 300) ---------- */
async function pdVerlauf(d, nav) {
  const f = { field: '', g: '', s: '', days: '30', q: '', ...pdGet('hz.pldb.vf', {}) };
  const p = { account_id: `eq.${S.acc}`, order: 't.desc,id.desc', limit: 300 };
  if (f.field) p.field = `eq.${f.field}`;
  if (f.g) p.galaxy = `eq.${+f.g}`;
  if (f.s) p.system = `eq.${+f.s}`;
  if (+f.days) p.t = `gte.${new Date(Date.now() - f.days * 864e5).toISOString()}`;
  const q = f.q.replace(/[,.:()*"\\]/g, ' ').trim().replace(/\s+/g, ' ');   // Sonderzeichen der PostgREST-Logik (or=…) entfernen
  if (q) p.or = `(old.ilike.*${q}*,new.ilike.*${q}*)`;
  const rows = await Cloud.q('planet_changes', p);
  const opt = (v, t, cur) => `<option value="${esc(v)}"${String(v) === String(cur) ? ' selected' : ''}>${esc(t)}</option>`;
  $('#view').innerHTML = `${nav}<div class="card"><form id="pdVf" class="pdf">
      <label>Art<select name="field">${opt('', 'alle', f.field)}${Object.entries(PL_FIELD).map(([k, t]) => opt(k, t, f.field)).join('')}</select></label>
      <label>Galaxie<input name="g" type="number" min="1" max="99" value="${esc(f.g)}" class="pdn"></label>
      <label>System<input name="s" type="number" min="1" max="9999" value="${esc(f.s)}" class="pdn"></label>
      <label>Zeitraum<select name="days">${opt('1', '24 h', f.days)}${opt('7', '7 Tage', f.days)}${opt('30', '30 Tage', f.days)}${opt('0', 'alles', f.days)}</select></label>
      <label>Text<input name="q" value="${esc(f.q)}" placeholder="Spieler, Allianz, Name …"></label></form></div>
    <div class="card"><h2>Verlauf <span class="muted small">${rows.length}${rows.length >= 300 ? '+ (neueste 300)' : ''} Änderungen</span></h2>
    ${rows.length ? `<table class="wide small"><tr><th>Zeit</th><th>Koord.</th><th>Planet</th><th>Was</th><th>Änderung</th><th>Quelle</th></tr>
      ${rows.map(c => { const k = pdKey(c), pl = d.byKey.get(k); return `<tr><td class="nowrap muted">${esc(dt(c.t))}</td><td class="nowrap"><a href="#/planeten/p/${k}">${k}</a></td>
        <td>${esc(pl?.name || '')}${pl?.type ? ` <span class="ptype t-${esc(pl.type)}">${esc(pl.type)}</span>` : ''}</td><td>${esc(PL_FIELD[c.field] || c.field)}</td>
        <td class="wrapall">${c.old && c.new ? `${esc(c.old)} → ${esc(c.new)}` : esc(c.old || c.new)}</td><td class="muted">${esc(c.source)}</td></tr>`; }).join('')}</table>`
      : '<p class="muted">Keine Änderungen im gewählten Zeitraum.</p>'}</div>`;
  const form = $('#pdVf');
  const save = () => {
    const n = {};
    for (const el of form.elements) if (el.name) n[el.name] = el.value;
    pdPut('hz.pldb.vf', n); route(true);
  };
  form.addEventListener('change', save);
  form.addEventListener('submit', e => { e.preventDefault(); save(); });
}
