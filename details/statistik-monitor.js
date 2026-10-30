'use strict';
/* Horizon Atlas – Reiter Statistik, Unterreiter wie der Statistik-Monitor im Spiel (D8b, 20.10.2026; Tabs und Spalten laut
   Live-Abruf aller Tabs vom 20.10., doku/wissen/statistik-monitor.md). Daten aus dem neuesten Live-Snapshot (state_latest:
   prod, status, requirements, empire, monitor – Collector ab 0.4.26 für monitor) und der Tabelle hitlist (Highscore-Listen,
   alle 6 h). Supabase speichert JSON ohne Schlüsselreihenfolge → Reihenfolge der Zeilen/Spalten wie im Spiel hier fest.
   Schreibt nichts. */

const SM_TABS = [['verlauf', 'Verlauf'], ['prod', 'Produktion & Co.'], ['check', 'Voraussetzungen'], ['wanted', 'Fahndungsliste'],
  ['overview', 'Übersicht'], ['aggregate', 'Aggregate'], ['status', 'Gebäudestatus'], ['emp_prod', 'Rohstoffübersicht'],
  ['hitlist', 'Highscore!'], ['orden', 'Mein Imperium'], ['stan', 'STAN'], ['foerder', 'Förderung Top 10']];   // STAN: öffentliche Rundenstatistik (oeffentlich.js); Förderung Top 10: statistik-foerder.js
// Gebäude in der Reihenfolge des Spiels (Auswahl „Voraussetzungen“, Gebäudestatus)
const SM_BUILD = ['metalmine', 'crystalmine', 'fuelrefinery', 'metalstorage', 'crystalstorage', 'fuelstorage', 'metalsafe', 'crystalsafe',
  'fuelsafe', 'solarcollector', 'fissionreactor', 'tidalpowerplant', 'habitation', 'robotfactory', 'biotechcenter', 'infrastructure',
  'constructionfacility', 'recyclingfacility', 'shipyard', 'researchcenter', 'computercenter', 'rescuestation', 'tradecenter',
  'headquarter', 'spaceobservatory'];
const SM_PROD = [['Förderung', 'Förderung je #'], ['Verbrauch', 'Verbrauch je #'], ['Größe gesichertes Lager'], ['Größe freies Lager'],
  ['Maximal stabile Menge'], ['Aktueller Lagerbestand'], ['Planetares Trümmerfeld']];
const SM_CAP = ['Aktuelle Verfügbarkeit', 'Benötigte Kapazitäten', 'Ungenutzte Kapazitäten'];
const SM_BASE = [['1', '1 Sekunde', 'Sekunde'], ['60', '1 Minute', 'Minute'], ['3600', '1 Stunde', 'Stunde'], ['86400', '1 Tag', 'Tag'],
  ['604800', '1 Woche', 'Woche']];
const SM_STATUS = [['RESOURCES', 'Ressourcen'], ['STORAGE', 'Lager'], ['CONSTRUCTION', 'Konstruktion'], ['FLEET', 'Flotte'],
  ['RESEARCH', 'Forschung'], ['EMBASSY', 'Diplomatie'], ['SUPPORT', 'Unterstützung'], ['MILITARY', 'Militär'], ['ECONOMY', 'Wirtschaft'],
  ['ALIENTECH', 'Alientechnik']];
const SM_COLS = ['Erz', 'Mineral', 'T-Stoff', 'Energie', 'Arbeiter', 'E-Lager', 'M-Lager', 'T-Lager', 'E-Safe', 'M-Safe', 'T-Safe',
  'Gebäude', 'Baustellen', 'Schiffe', 'Verteidigung', 'Bauplatz', 'Mondbauplatz', 'Raumhafen', 'Raumstation', 'Res.Umschlag.',
  'Forschung', 'Hirnwäsche', 'Flottenscan', 'Systemteleskop', 'Planetenteleskop', 'Kolonien', 'Allianzrang', 'Allianzgröße', 'Bündnisse'];
const SM_EMP = [['production', 'Rohstofftagesproduktion'], ['storage', 'Rohstoffvorräte'], ['spacemine', 'Orbitale Rohstoffgewinnung'],
  ['capacity', 'Lagerkapazität'], ['debris', 'Orbitales Trümmerfeld'], ['recycle', 'Planetares Trümmerfeld']];
const SM_OVER = [['buildings', 'Gebäudeübersicht'], ['defence', 'Verteidigungsübersicht'], ['ships', 'Schiffübersicht'], ['alien', 'Alienaggregate']];
const SM_HLCAT = [['total', 'Gesamter Highscore'], ['building', 'Gebäude-Highscore'], ['research', 'Forschung-Highscore'],
  ['fleet', 'Flotten-Highscore'], ['defence', 'Verteidigung-Highscore'], ['exploration', 'Entdeckungs-Highscore'],
  ['prosecution', 'Kopfgeld-Highscore'], ['battle', 'Kampf-Highscore'], ['trade', 'Handels-Highscore'], ['war', 'Kriegs-Highscore'],
  ['firepower', 'Feuerkraft-Highscore'], ['artefacts', 'Aggregate-Highscore'], ['alliance', 'Allianz-Highscore'],
  ['darkenergy', 'Dunkle Energie-Highscore'], ['ascension', 'Ascension-Highscore']];
const SM_PRESTIGE = ['Gebaute Gebäude im Sternhaufen', 'Fertiggestellte Forschung im Sternhaufen', 'Gebaute Flotte im Sternhaufen',
  'Gebaute Verteidigung im Sternhaufen', 'Zerstörte Gebäude des Schwarms', 'Zerstörte Flotte des Schwarms', 'Zerstörte Verteidigung des Schwarms',
  'Verlorene Gebäude gegen den Schwarm', 'Verlorene Flotte gegen den Schwarm', 'Verlorene Verteidigung gegen den Schwarm',
  'Zeit im Sternhaufen', 'Hardcore-Zeit', 'Bezwungene stärkere Feinde'];

// Unterreiter und Auswahlfelder je Unterreiter (im Browser gemerkt)
function smState() { try { return JSON.parse(localStorage.getItem('hz.stat.mon') || '{}') || {}; } catch { return {}; } }
function smSet(patch) { try { localStorage.setItem('hz.stat.mon', JSON.stringify({ ...smState(), ...patch })); } catch { /* egal */ } }
const smTab = () => SM_TABS.some(t => t[0] === smState().tab) ? smState().tab : 'verlauf';
function smTabs() {
  const cur = smTab();
  return `<div class="kseg" id="smTabs" style="margin-top:8px">${SM_TABS.map(([k, l]) => `<button type="button" data-t="${k}" aria-pressed="${k === cur}">${esc(l)}</button>`).join('')}</div>`;
}
// Auswahlfeld wie im Spiel; Wert gemerkt unter key
function smSel(key, opts, val, label) {
  return `<label class="small">${esc(label)} <select data-sm="${key}">${opts.map(([v, l]) => `<option value="${esc(v)}"${v === val ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
}
const smOrder = (list, keys) => [...keys].sort((a, b) => {
  const i = list.indexOf(a), j = list.indexOf(b);
  return (i < 0 ? 999 : i) - (j < 0 ? 999 : j) || String(a).localeCompare(String(b));
});
const smCell = (v, dec) => typeof v === 'number' ? `<td class="num${v < 0 ? ' err' : ''}">${esc(fmt(v, dec ?? (v % 1 ? 2 : 0)))}</td>` : `<td>${esc(v ?? '')}</td>`;
const smTable = (head, rows, opt = {}) => `<div class="pdscroll"><table class="wide small"><thead><tr>${head.map((h, i) =>
  `<th${i && opt.num !== false ? ' class="num"' : ''}>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;

// Daten: neuester Live-Stand (Teilfelder) und die Highscore-Listen der letzten zwei Erfassungen; 60 s im Speicher
let smCache = null;
async function smLoad() {
  if (smCache && smCache.acc === S.acc && Date.now() - smCache.t < 60e3) return smCache;
  const [st, hl] = await Promise.all([
    Cloud.q('state_latest', { select: 'collected_at,version,start:data->start,prod:data->prod,status:data->status,statusPlanets:data->statusPlanets,req:data->requirements,emp:data->empire,mon:data->monitor,bld:data->buildings->items,res:data->research->items',
      account_id: `eq.${S.acc}`, kind: 'eq.live' }).catch(() => []),
    Cloud.q('hitlist', { select: 'collected_at,mode,side,cat,head,own,list', account_id: `eq.${S.acc}`, order: 'collected_at.desc', limit: 40 }).catch(() => []),
  ]);
  smCache = { acc: S.acc, t: Date.now(), s: st?.[0] || null, hl: hl || [] };
  return smCache;
}

async function viewStatMonitor(head) {
  const tab = smTab(), d = await smLoad(), s = d.s;
  const stand = s ? `<p class="small muted">Stand ${esc(dt(s.collected_at))} · Collector ${esc(s.version || '?')}${s.mon?.at ? ` · Monitor-Tabs ${esc(dt(s.mon.at))}` : ''}</p>` : '';
  let body;
  if (tab === 'stan') body = await smStan(s);
  else if (tab === 'foerder') body = await smFoerder(s);
  else if (!s) body = '<p class="small muted">Kein Live-Stand vorhanden.</p>';
  else if (tab === 'hitlist') body = smHitlist(s, d) + smTrend(await smHist(smHlSel()));
  else body = ({ prod: smProd, check: smCheck, wanted: smWanted, overview: smOverview, aggregate: smAggregate, status: smStatus,
    emp_prod: smEmp, hitlist: smHitlist, orden: smOrden }[tab] || (() => ''))(s, d);
  $('#view').innerHTML = head + `<div class="card">${stand}${body}</div>`;
  smBind();
}
// Unterreiter „STAN“ (23.10.2026): Spielerzahl je Stand, je Forschung Verteilung der Stufen, eigene Stufe und
// Spieler-Rabatt der nächsten Stufe (Untergrenze, k wächst seit dem STAN-Tag)
async function smStan(s) {
  const oe = typeof oeLoad === 'function' ? await oeLoad() : null, stan = oe?.stan, st = stan?.staende?.[0];
  if (!st) return '<p class="small muted">Noch keine STAN-Daten in Supabase (Tabelle „wissen“, Schlüssel „stan“; täglich per GitHub Action „Öffentliche Quellen“).</p>';
  const prev = stan.staende[1], W = await loadWissen().catch(() => null);
  const own = Object.fromEntries((Array.isArray(s?.res) ? s.res : []).map(x => [x.type, +x.level || 0]));
  const rows = Object.entries(st.research).map(([id, lv]) => {
    const l = (own[id] || 0) + 1, rb = oeRabatt(stan, id, l), k1 = oeK(st, id, 1);
    const top = Math.max(0, ...Object.entries(lv).filter(([, c]) => c > 0).map(([n]) => +n));
    const dk = prev ? rb.k - (oeK(prev, id, l) ?? 0) : null;
    return { id, name: W?.R?.[id]?.n || id, l, rb, k1, top, dk, dist: Object.entries(lv).filter(([n, c]) => +n > 0 && c > 0).map(([n, c]) => `${n}:${c}`).join(' ') };
  }).filter(x => x.k1 > 0 || own[x.id]).sort((a, b) => b.rb.r - a.rb.r || a.name.localeCompare(b.name));
  const tr = x => `<tr><td>${esc(x.name)}</td><td class="num">${esc(own[x.id] != null ? fmt(own[x.id]) : '–')}</td><td class="num">${esc(fmt(x.rb.k))}</td>
    <td class="num">${esc(oePct(x.rb.r))}</td>${prev ? `<td class="num muted">${x.dk ? esc((x.dk > 0 ? '+' : '') + fmt(x.dk)) : ''}</td>` : ''}<td class="num">${esc(fmt(x.k1))}</td>
    <td class="num">${esc(fmt(x.top))}</td><td class="small muted">${esc(x.dist)}</td></tr>`;
  const verlauf = (stan.verlauf || []).map(v => `${oeDate(v.date)}: ${fmt(v.players)}`).join(' · ');
  return `<p class="small">STAN-Stand <b>${esc(oeDate(st.date))}</b>: <b>${esc(fmt(st.players))} Spieler</b>. Spieler je Stand: ${esc(verlauf)}.</p>
    <p class="small muted">Spieler-Rabatt der nächsten eigenen Stufe = 1 − ${esc(fmt(stan.b || OE_B, 3))}<sup>k/N</sup> (k = Spieler mit dieser Stufe oder höher, N = alle Spieler), höchstens ≈ ${esc(oePct(oeMax(stan)))}.
      Untergrenze: Seit dem STAN-Tag kommen Spieler dazu. Verteilung = Stufe:Spieler (nur Stufe ≥ 1). Eigene Stufe aus dem neuesten Live-Stand.
      Quelle: stan.goetterheimat.de (öffentlich)${oe.at.stan ? `, geholt ${esc(dt(oe.at.stan))}` : ''}.</p>
    ${smTable(['Forschung', 'Eigene Stufe', 'k nächste Stufe', 'Rabatt nächste ≥', ...(prev ? [`± k seit ${oeDate(prev.date)}`] : []), 'Spieler ≥ 1', 'Höchste Stufe', 'Verteilung'], rows.map(tr))}`;
}
const smNoMon = '<p class="small muted">Noch keine Werte: Diesen Tab liest der Collector ab Version 0.4.26 (alle 6 h).</p>';

function smProd(s) {
  const st = smState(), base = SM_BASE.find(b => b[0] === st.base) || SM_BASE[2], f = +base[0] / 3600, p = s.prod || {};
  const res = SM_PROD.map(([k, l]) => {
    const v = p[k]; if (!v) return '';
    const scale = l ? f : 1;
    return `<tr><td>${esc((l || k).replace('#', base[2]))}</td>${['Eisenerz', 'Mineral', 'Treibstoff'].map(r => smCell(v[r] != null ? Math.round(v[r] * scale) : null)).join('')}</tr>`;
  });
  const cap = SM_CAP.map(k => p[k] ? `<tr><td>${esc(k)}</td>${smCell(p[k].Arbeiter)}${smCell(p[k].Energie)}</tr>` : '');
  return `<div class="row">${smSel('base', SM_BASE.map(b => [b[0], b[1]]), base[0], 'Berechnungszeit:')}</div>
    ${smTable(['', 'Eisenerz', 'Mineral', 'Treibstoff'], res)}${smTable(['', 'Bevölkerung', 'Energie'], cap)}
    <p class="small muted">Förderung und Verbrauch aus dem Stundenwert umgerechnet (das Spiel rechnet mit der genauen Rate, Abweichung ±0,1 %).</p>`;
}

function smCheck(s) {
  const st = smState(), typ = ['b', 'r', 's'].includes(st.ctyp) ? st.ctyp : 'b';
  const bset = new Set([...SM_BUILD, ...(s.bld || []).map(i => String(i.type || '').toLowerCase())]);
  const reqCell = (req, build) => req.filter(r => bset.has(r.id) === build).map(r =>
    `<span class="${r.have < r.need ? 'err' : ''}">${esc(r.id.toUpperCase())} ${esc(r.need)}/${esc(r.have)}</span>`).join('<br>') || '<span class="muted">–</span>';
  let rows;
  if (typ === 's') {
    const sr = s.mon?.shipReq;
    if (!sr) return smSel('ctyp', [['b', 'Gebäude'], ['r', 'Forschung'], ['s', 'Raumschiffe']], typ, 'Auswahl des Typs') + smNoMon;
    rows = Object.keys(sr).sort().map(k => `<tr><td>${esc(k)}</td><td></td><td>${reqCell(sr[k].req || [], true)}</td><td>${reqCell(sr[k].req || [], false)}</td></tr>`);
  } else {
    const all = Object.entries(s.req || {}).filter(([k]) => k.startsWith(typ + ':')).map(([k, v]) => [k.slice(2), v]);
    rows = (typ === 'b' ? smOrder(SM_BUILD, all.map(x => x[0])) : all.map(x => x[0]).sort()).map(k => {
      const v = all.find(x => x[0] === k)[1];
      return `<tr><td>${esc(k)}</td><td class="num">${esc(v.level ?? '')}</td><td>${v.known === false ? '<span class="muted">keine Voraussetzungen ermittelt</span>' : reqCell(v.req || [], true)}</td><td>${v.known === false ? '' : reqCell(v.req || [], false)}</td></tr>`;
    });
  }
  return `<div class="row">${smSel('ctyp', [['b', 'Gebäude'], ['r', 'Forschung'], ['s', 'Raumschiffe']], typ, 'Auswahl des Typs')}</div>
    ${smTable(['Klasse', 'Stufe', 'Gebäude', 'Forschungen'], rows, { num: false })}
    <p class="small muted">Je Klasse die nächste Stufe (benötigt/vorhanden, rot = fehlt). Das Spiel zeigt je Auswahl eine Klasse und Stufe; Verteidigung erst, wenn eine bekannt ist.</p>`;
}

function smRanking(r, me, opt = {}) {
  if (!r?.head) return '<p class="small muted">Keine Liste.</p>';
  const nick = r.head.indexOf('Nickname'), mark = row => me && nick >= 0 && row[nick] === me;
  const tr = (row, extra = '') => `<tr${mark(row) ? ' style="font-weight:600;background:var(--accent-2)"' : ''}>${row.map(v => smCell(v)).join('')}${extra}</tr>`;
  const own = r.own ? smTable(r.head, [tr(r.own)]) : '';
  const rows = (r.rows || r.list || []).map(row => tr(row, opt.delta ? opt.delta(row) : ''));
  return own + smTable([...r.head, ...(opt.delta ? ['± Platz', '± Punkte'] : [])], rows.length ? rows : [`<tr><td colspan="${r.head.length}" class="muted">${esc(opt.empty || 'Keine Einträge.')}</td></tr>`]);
}
function smWanted(s) {
  return s.mon ? (s.mon.wanted ? smRanking(s.mon.wanted, account()?.player, { empty: 'Niemand wird gesucht.' }) : '<p class="small err">Fahndungsliste nicht gelesen.</p>') : smNoMon;
}

function smOverview(s) {
  const st = smState(), typ = SM_OVER.some(o => o[0] === st.otyp) ? st.otyp : 'buildings';
  const o = typ === 'alien' ? s.mon?.alien : s.emp?.[typ];
  const cats = [...new Set((o?.items || []).map(i => i.cat).filter(Boolean))], cat = cats.includes(st.ocat) ? st.ocat : '';
  const sel = `<div class="row">${smSel('otyp', SM_OVER, typ, 'Übersichtstyp:')}${smSel('ocat', [['', 'Alle'], ...cats.map(c => [c, c])], cat, 'Kategorie:')}</div>`;
  if (typ === 'alien' && !s.mon) return sel + smNoMon;
  if (!o || !o.items?.length) return sel + '<p class="small muted">Keine Einträge.</p>';
  const sum = o.items.some(i => i.sum != null), rows = [];
  let last = null;
  for (const it of o.items.filter(i => !cat || i.cat === cat)) {
    if (it.cat !== last) { rows.push(`<tr><td colspan="${o.planets.length + 1 + sum}"><b>${esc(it.cat || '')}</b></td></tr>`); last = it.cat; }
    rows.push(`<tr><td>${esc(it.type)}</td>${it.values.map((v, k) => `<td class="num${v ? '' : ' muted'}">${(it.busy || []).includes(k) ? `<b>${esc(fmt(v))}</b>` : esc(fmt(v))}</td>`).join('')}${sum ? smCell(it.sum) : ''}</tr>`);
  }
  const legend = { buildings: 'dick – Gebäude wird gerade gebaut.', defence: 'dick – Verteidigung wird gerade gebaut.', ships: 'dick – Schiff wird gerade gebaut.', alien: 'dick – Aggregat ist im Schrein.' }[typ];
  return sel + smTable(['', ...o.planets.map(p => `${p.coords}${p.name ? ' ' + p.name : ''}`), ...(sum ? ['∑'] : [])], rows) + `<p class="small muted">Legende: ${esc(legend)}</p>`;
}

// tablesText (Collector): je Tabelle Zeilen „a | b | c“, erste Zeile = Titel
function smTextTables(tables) {
  return (tables || []).map(t => {
    const rows = t.map(r => String(r).split(' | '));
    const [title, ...rest] = rows;
    return `<h3>${esc(title.join(' '))}</h3>` + (rest.length ? smTable(rest[0], rest.slice(1).map(r => `<tr>${r.map(v => `<td>${esc(v)}</td>`).join('')}</tr>`), { num: false }) : '');
  }).join('');
}
function smAggregate(s) {
  const a = s.emp?.aggregate;
  if (!a?.length) return '<p class="small muted">Keine Werte.</p>';
  const hasRows = a.some(t => t.length > 3 || (t.length > 2 && !/^Allianz \| Imperium/.test(t[2])));
  return smTextTables(a) + (hasRows ? '' : '<p class="small muted">Keine aktiven Aggregate im Schrein.</p>');
}

// Gebäudestatus je Planet (Collector ab 0.5.12): Heimat aus status, Kolonien aus statusPlanets (gelesen beim Kolonie-Besuch des
// Autobuilders, höchstens alle 2 h; Stand je Kolonie). Klassen: bekannte in Spielreihenfolge, unbekannte mit ihrem Namen dahinter.
function smStatus(s) {
  const st = smState(), home = s.start?.coords || '';
  const pls = [[home, `${s.start?.chosen?.name || s.start?.planet || 'Heimat'} (${home || '?'})`],
    ...Object.entries(s.statusPlanets || {}).map(([c, v]) => [c, `${v.name || 'Kolonie'} (${c})`])];
  const pl = pls.some(p => p[0] === st.spl) ? st.spl : pls[0][0], kol = pl !== home ? s.statusPlanets?.[pl] : null;
  const status = kol ? kol.status : s.status;
  const keys = [...SM_STATUS.filter(c => status?.[c[0]]),
    ...Object.keys(status || {}).filter(k => !SM_STATUS.some(c => c[0] === k)).map(k => [k, status[k].label || k])];
  const cls = keys.some(c => c[0] === st.scls) ? st.scls : keys[0]?.[0];
  const wahl = pls.length > 1 ? smSel('spl', pls, pl, 'Planet:') + ' ' : '';
  if (!cls) return `<div class="row">${wahl}</div><p class="small muted">Keine Werte.</p>`;
  const tabs = (status[cls].tables || []).map(t => {
    const rk = smOrder([...SM_BUILD, 'Summe'], Object.keys(t)), cols = smOrder(SM_COLS, [...new Set(rk.flatMap(k => Object.keys(t[k]).filter(c => c !== 'level')))]);
    return smTable(['Gebäudeklasse / Stufe', ...cols], rk.map(k => `<tr${k === 'Summe' ? ' style="font-weight:600"' : ''}><td>${esc(k === 'Summe' ? k : `${k.toUpperCase()} ${t[k].level ?? ''}`)}</td>${cols.map(c => smCell(t[k][c])).join('')}</tr>`));
  }).join('');
  const name = pls.find(p => p[0] === pl)[1];
  return `<div class="row">${wahl}${smSel('scls', keys, cls, 'Produktionsklasse:')}</div>${tabs}
    <p class="small muted">Gilt für <b>${esc(name)}</b>${kol ? `, Stand ${esc(dt(kol.at))}` : ''}. Das Spiel liefert den Gebäudestatus nur für den gewählten Planeten: Die Heimat liest der Collector bei jeder Erfassung, Kolonien ab Collector 0.5.12 beim Besuch des Autobuilders (höchstens alle 2 h).</p>`;
}

function smEmp(s) {
  const st = smState(), typ = SM_EMP.some(e => e[0] === st.etyp) ? st.etyp : 'production', r = s.emp?.res?.[typ];
  const R = ['Eisenerz', 'Mineral', 'Treibstoff'];
  const sel = `<div class="row">${smSel('etyp', SM_EMP, typ, 'Übersichtstyp:')}</div>`;
  if (!r) return sel + '<p class="small muted">Keine Werte.</p>';
  const rows = (r.planets || []).map(p => `<tr><td>${esc(p.name)}</td>${R.map(k => smCell(p[k])).join('')}</tr>`);
  if (r.total) {
    rows.push(`<tr style="font-weight:600"><td>Gesamt</td>${R.map(k => smCell(r.total[k])).join('')}</tr>`);
    rows.push(`<tr><td>Summe</td><td class="num" colspan="3">${esc(fmt(R.reduce((a, k) => a + (r.total[k] || 0), 0)))}</td></tr>`);
  }
  return sel + smTable(['Kolonie', 'Eisenerz', 'Minerale', 'Treibstoff'], rows);
}

function smHlSel() {
  const st = smState(), mode = st.hmode === 'hardcore' ? 'hardcore' : 'normal', side = st.hside === 'alliance' ? 'alliance' : 'player';
  return { mode, side, cat: side === 'alliance' ? 'total' : SM_HLCAT.some(c => c[0] === st.hcat) ? st.hcat : 'total' };
}
// Alle Erfassungen einer Liste (Verlauf fremder Spieler, 30.10.2026); 60 s im Speicher je Auswahl
let smHistCache = null;
async function smHist({ mode, side, cat }) {
  const key = `${S.acc}|${mode}|${side}|${cat}`;
  if (smHistCache?.key === key && Date.now() - smHistCache.t < 60e3) return smHistCache.rows;
  const rows = await Cloud.q('hitlist', { select: 'collected_at,head,own,list', account_id: `eq.${S.acc}`, mode: `eq.${mode}`, side: `eq.${side}`,
    cat: `eq.${cat}`, order: 'collected_at.asc', limit: 400 }).catch(() => []);
  smHistCache = { key, t: Date.now(), rows: rows || [] };
  return smHistCache.rows;
}
/* Reihen je Name aus den Erfassungen: [{name, pts: [[t, Punkte, Platz]]}]. Auswahl: „top5“ = Top 5 der neuesten Liste + ich,
   „nah“ = je zwei über und unter mir, sonst ein Name (+ ich). Eigene Zeile kommt aus own, wenn ich nicht in der Liste stehe. */
function smTrendSeries(rows, me, pick) {
  if (!rows.length) return [];
  const H = rows[rows.length - 1].head || [], iN = H.indexOf('Nickname') >= 0 ? H.indexOf('Nickname') : H.indexOf('Name');
  const iP = H.indexOf('Punkte'), iR = H.indexOf('Platz');
  if (iN < 0 || iP < 0) return [];
  const last = rows[rows.length - 1], lst = [...(last.list || [])];
  if (last.own && !lst.some(r => r[iN] === last.own[iN])) lst.push(last.own);
  lst.sort((a, b) => (a[iR] ?? 1e9) - (b[iR] ?? 1e9));
  const mi = lst.findIndex(r => r[iN] === me);
  let names;
  if (pick === 'nah') names = mi < 0 ? [] : lst.slice(Math.max(0, mi - 2), mi + 3).map(r => r[iN]);
  else if (pick && pick !== 'top5') names = [pick];
  else names = lst.slice(0, 5).map(r => r[iN]);
  if (me && !names.includes(me) && mi >= 0) names.push(me);
  return names.map(name => ({ name, pts: rows.map(r => {
    const row = (r.list || []).find(x => x[iN] === name) || (r.own?.[iN] === name ? r.own : null);
    return row && typeof row[iP] === 'number' ? [Date.parse(r.collected_at), row[iP], row[iR]] : null;
  }).filter(Boolean) })).filter(x => x.pts.length);
}
const SM_LINE = ['#2563c9', '#c0392b', '#1f8a4c', '#b7791f', '#8e44ad', '#16a085', '#d35400'];
function smTrend(rows) {
  if (!rows.length) return '';
  const st = smState(), me = account()?.player, H = rows[rows.length - 1].head || [];
  const iN = H.indexOf('Nickname') >= 0 ? H.indexOf('Nickname') : H.indexOf('Name');
  const names = iN < 0 ? [] : (rows[rows.length - 1].list || []).map(r => r[iN]).filter(Boolean);
  const pick = st.hcmp === 'nah' || names.includes(st.hcmp) ? st.hcmp : 'top5';
  const sel = smSel('hcmp', [['top5', 'Top 5 + ich'], ['nah', 'Je 2 über/unter mir'], ...names.map(n => [n, n])], pick, 'Vergleich:');
  const ser = smTrendSeries(rows, me, pick);
  if (!ser.length || rows.length < 2) return `<h3>Verlauf</h3><div class="row">${sel}</div><p class="small muted">Zu wenige Erfassungen für einen Verlauf.</p>`;
  const all = ser.flatMap(x => x.pts), t0 = Math.min(...all.map(p => p[0])), t1 = Math.max(...all.map(p => p[0]));
  const v1 = Math.max(1, ...all.map(p => p[1])), W = 600, Hh = 220, L = 50, B = 20;
  const X = t => L + (t1 > t0 ? (t - t0) / (t1 - t0) : 0) * (W - L - 6), Y = v => 6 + (1 - v / v1) * (Hh - B - 6);
  const grid = [0, 0.5, 1].map(f => `<line x1="${L}" x2="${W - 6}" y1="${Y(v1 * f)}" y2="${Y(v1 * f)}" stroke="var(--line)"/><text x="${L - 4}" y="${Y(v1 * f) + 4}" text-anchor="end" font-size="10" fill="var(--muted)">${esc(fmt(v1 * f))}</text>`).join('');
  const days = `<text x="${L}" y="${Hh - 4}" font-size="10" fill="var(--muted)">${esc(dt(new Date(t0).toISOString()))}</text><text x="${W - 6}" y="${Hh - 4}" text-anchor="end" font-size="10" fill="var(--muted)">${esc(dt(new Date(t1).toISOString()))}</text>`;
  const lines = ser.map((x, i) => {
    const own = x.name === me, col = own ? 'var(--accent)' : SM_LINE[i % SM_LINE.length];
    return `<polyline fill="none" stroke="${col}" stroke-width="${own ? 3 : 1.5}" points="${x.pts.map(p => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ')}"><title>${esc(x.name)}</title></polyline>`;
  }).join('');
  const legend = ser.map((x, i) => {
    const a = x.pts[0], z = x.pts[x.pts.length - 1], d = z[1] - a[1], h = (z[0] - a[0]) / 864e5;
    return `<tr><td><span style="display:inline-block;width:10px;height:10px;background:${x.name === me ? 'var(--accent)' : SM_LINE[i % SM_LINE.length]}"></span> ${x.name === me ? `<b>${esc(x.name)}</b>` : esc(x.name)}</td>${smCell(z[2])}${smCell(z[1])}${smCell(d)}${smCell(h > 0.5 ? d / h : null)}</tr>`;
  });
  return `<h3>Verlauf</h3><div class="row">${sel}</div>
    <svg viewBox="0 0 ${W} ${Hh}" width="100%" role="img" aria-label="Punkte über die Zeit">${grid}${days}${lines}</svg>
    ${smTable(['Spieler', 'Platz', 'Punkte', '± seit Beginn', '± je Tag'], legend)}
    <p class="small muted">${rows.length} Erfassungen (alle 6 h). Lücken = Spieler stand bei der Erfassung nicht in der Liste.</p>`;
}

function smHitlist(s, d) {
  const { mode, side, cat } = smHlSel();
  const sel = `<div class="row">${smSel('hmode', [['normal', 'Normal'], ['hardcore', 'Hardcore']], mode, 'Highscoreliste:')}
    ${smSel('hside', [['player', 'Spieler'], ['alliance', 'Allianz']], side, '')}${smSel('hcat', SM_HLCAT, cat, '')}</div>`;
  const runs = [...new Set(d.hl.map(r => r.collected_at))];
  const pick = at => d.hl.find(r => r.collected_at === at && r.mode === mode && r.side === side && r.cat === cat);
  const cur = runs.length ? pick(runs[0]) : null;
  const meta = s.mon?.hitlist?.[`${mode === 'normal' ? '' : mode}:${side}:${cat}`];
  if (!cur) return sel + (runs.length ? '<p class="small muted">Diese Liste wurde bei der letzten Erfassung nicht gelesen.</p>'
    : '<p class="small muted">Noch keine Listen: Der Collector liest die Highscore-Listen ab Version 0.4.26 alle 6 h.</p>');
  const me = account()?.player, prev = runs[1] ? pick(runs[1]) : null;
  const H = cur.head || [], iN = H.indexOf('Nickname') >= 0 ? H.indexOf('Nickname') : H.indexOf('Name'), iP = H.indexOf('Punkte'), iR = H.indexOf('Platz');
  const old = new Map((prev?.list || []).map(r => [r[iN], r]));
  const delta = prev && iN >= 0 ? row => {
    const o = old.get(row[iN]);
    if (!o) return '<td class="num muted">neu</td><td></td>';
    const dr = o[iR] - row[iR], dp = row[iP] - o[iP];
    return `<td class="num${dr > 0 ? ' ok' : dr < 0 ? ' err' : ' muted'}">${dr ? (dr > 0 ? '+' : '') + fmt(dr) : '·'}</td><td class="num${dp ? '' : ' muted'}">${dp ? (dp > 0 ? '+' : '') + fmt(dp) : '·'}</td>`;
  } : null;
  const zero = !cur.list.length && meta?.zero;
  return sel + `<p class="small muted">Stand ${esc(dt(cur.collected_at))}${prev ? ` · ± gegen ${esc(dt(prev.collected_at))}` : ''}${meta?.n != null ? ` · ${esc(fmt(meta.n))} Einträge` : ''}</p>`
    + smRanking({ head: H, own: cur.own, list: cur.list }, me, { delta, empty: zero ? 'Alle Einträge haben 0 Punkte (Liste nicht gespeichert).' : 'Keine Einträge.' });
}

function smOrden(s) {
  const e = s.emp || {}, hs = e.highscore || {}, raw = e.orden || [], c = e.colony;
  const line = re => (raw.flat().find(x => re.test(x)) || '');
  const allg = line(/Punkte/).split(' | '), alli = line(/^Allianz:/).replace(/^Allianz: \| /, '').replace(/[| ]+$/, '');
  const g = hs.global || {}, pr = hs.prestige || {};
  const gk = smOrder(Object.keys(ST_HS), Object.keys(g)).sort((a, b) => (a === 'total') - (b === 'total'));
  const pk = smOrder(SM_PRESTIGE, Object.keys(pr));
  const orden = raw.flat().filter(x => /Orden|Medaille/.test(x));
  return `<h3>Die Grundfesten des Imperiums${c && c.max != null ? ` (Koloniekontrolle ${esc(c.max.toFixed(3).replace('.', ','))} / ${esc(Number(c.free ?? 0).toFixed(3).replace('.', ','))})` : ''}</h3>
    <div class="cols2"><div>${smTable(['Allgemein', ''], allg.length > 1 ? allg.map(v => `<tr><td colspan="2">${esc(v)}</td></tr>`) : [], { num: false })}</div>
    <div>${smTable(['Allianz'], [`<tr><td>${esc(alli || '–')}</td></tr>`], { num: false })}</div></div>
    <h3>Highscores</h3><div class="cols2">
      <div>${smTable(['Globaler Highscore', 'Punkte', 'Platz'], gk.map(k => `<tr${k === 'total' ? ' style="font-weight:600"' : ''}><td>${esc(ST_HS[k] || k)}</td>${smCell(g[k]?.p)}${smCell(g[k]?.r)}</tr>`))}</div>
      <div>${smTable(['Prestige-Highscore', ''], pk.map(k => `<tr><td>${esc(k)}</td>${smCell(pr[k]?.p)}</tr>`))}</div></div>
    <h3>Orden und Medaillen</h3><p class="small">${orden.length ? orden.map(esc).join('<br>') : '<span class="muted">–</span>'}</p>`;
}

function smBindTabs() {
  $('#smTabs')?.addEventListener('click', e => {
    const b = e.target.closest('button[data-t]');
    if (b) { smSet({ tab: b.dataset.t }); route(); }
  });
}
function smBind() {
  smBindTabs();
  $('#view').querySelectorAll('select[data-sm]').forEach(el => el.addEventListener('change', () => { smSet({ [el.dataset.sm]: el.value }); route(); }));
}
