'use strict';
/* Horizon Atlas – Reiter Galaxie (#/galaxie/G/S). Kopie aus cockpit/app.js (D1 der Cockpit-Aufteilung, 17.10.2026);
   im Cockpit bleibt die Fassung bis C1. Planetenwerte aus ../planetwerte.js (Messknopf nur Owner, mit Rückfrage). */

/* ---------- Galaxie (B9, 16.10.2026): Planeten eines Systems aus planets/planet_systems, Verlauf aus planet_changes ----------
   Nur lesend. Typen zeigt erst Sternwarte 2 (Faktor ≥ 10 %); bis dahin „Unbekannter Planet“ (type null).
   Planeten, Verlauf und Prospektion kommen je System nur neu, wenn sich planet_systems.last_seen geändert hat (Auffrischung alle 30 s). */
const PL_TYPE = { STPL: 'Standard', JUPL: 'Dschungel', FOPL: 'Wald', RKPL: 'Fels', IDPL: 'Eisenerz', HYPL: 'Wasserstoff', WAPL: 'Wasser',
  ICPL: 'Eis', ACPL: 'Säure', CLPL: 'Wolken', DSPL: 'Wüste', EOPL: 'Ethanozean', VUPL: 'Vulkan', LVPL: 'Lava', MIPL: 'Mineralinsel',
  CRPL: 'Kristall', MUPL: 'Staub', ASFI: 'Asteroidenfeld', JPGT: 'Sprungtor', PRSR: 'Gebetsschrein', ARNA: 'Arena',
  SMOS: 'Kleines Mutterschiff', LMOS: 'Großes Mutterschiff', IMOS: 'Imperiales Mutterschiff' };
const PL_STATUS = { geschuetzt: 'geschützt', aktiv: 'aktiv', inaktiv: 'inaktiv', gesperrt: 'gesperrt', urlaub: 'Urlaub' };
const PL_FIELD = { neu: 'neu', typ: 'Typ', name: 'Name', besitzer: 'Besitzer', allianz: 'Allianz', status: 'Status', weg: 'Bahn leer', zurueck: 'wieder da' };
const SYS_ORBITS = 14;
// SCOL-Regel aus doku/stand/scol-ziel.md (Nutzer 15.10.): Rohstoffe zuerst; CLPL nur prospektiert; gleicher Rang → Bahn 5/6 vor 8/3 vor 1/11–13
const SCOL_RANK = { VUPL: 1, LVPL: 1, JUPL: 2, CLPL: 3, RKPL: 4, FOPL: 5 };
const SCOL_WHY = { VUPL: 'Erz/Mineral 150–175 %, Schiffbau ×2', LVPL: 'Erz/Mineral 250–270 %, baut langsamer', JUPL: 'Forschung billiger',
  CLPL: 'Werte zufällig, prospektiert', RKPL: 'Bauplatz und Baugeschwindigkeit ×1,6', FOPL: 'Bevölkerung ×3' };
const orbitPref = b => [5, 6].includes(b) ? 0 : [8, 3].includes(b) ? 1 : [1, 11, 12, 13].includes(b) ? 2 : 3;
const typeLabel = p => p.type_name || PL_TYPE[p.type] || (p.type ? p.type : 'Unbekannter Planet');

// Planeten, Verlauf und Prospektion eines erfassten Systems; neu nur bei neuem last_seen
async function loadSysData(sys) {
  const key = `${S.acc}|${sys.galaxy}:${sys.system}|${sys.last_seen}`;
  S.sysCache ||= {};
  const hit = S.sysCache[`${sys.galaxy}:${sys.system}`];
  const where = { account_id: `eq.${S.acc}`, galaxy: `eq.${sys.galaxy}`, system: `eq.${sys.system}` };
  const values = Cloud.q('planet_values', { ...where, order: 'orbit,key' }).catch(() => []);   // Planetenwerte (Paket C): immer frisch
  if (hit?.key === key) return { ...hit, values: await values };
  const [planets, changes, prospect] = await Promise.all([
    Cloud.q('planets', { ...where, order: 'orbit' }),
    Cloud.q('planet_changes', { ...where, order: 't.desc,id.desc', limit: 60 }),
    Cloud.q('planet_prospect', { ...where, select: 'orbit,reports,probes,last_report' }).catch(() => []),
  ]);
  S.sysCache[`${sys.galaxy}:${sys.system}`] = { key, sys, planets, changes, prospect };
  return { key, sys, planets, changes, prospect, values: await values };
}

// Heimat-Knopf: der in „Planeten“ (Lage) gewählte eigene Planet, sonst der Standardplanet (erster des Imperiums bzw. im Spiel gewählter)
async function homeCoords() {
  let sel = S.planet;
  if (sel == null) try { sel = localStorage.getItem('hz-planet'); } catch { /* egal */ }
  if (/^\d+:\d+:\d+$/.test(sel || '')) return sel;
  if (S.home?.acc !== S.acc) {
    const r = await Cloud.q('state_latest', { account_id: `eq.${S.acc}`, kind: 'eq.live', select: 'start:data->start->>coords,pl:data->empire->planets' }).catch(() => []);
    const pl = Array.isArray(r[0]?.pl) ? r[0].pl : [];
    S.home = { acc: S.acc, coords: pl.find(p => /^\d+:\d+:\d+$/.test(p?.coords || ''))?.coords || r[0]?.start || null };
  }
  return S.home.coords;
}

// freie Planeten nach der Regel sortiert; CLPL zählt nur mit Prospektionsbericht
function scolPick(planets, prospect) {
  const free = planets.filter(p => p.present && !p.owner);
  const probed = new Set((prospect || []).map(x => x.orbit));
  const cands = free.filter(p => SCOL_RANK[p.type] && (p.type !== 'CLPL' || probed.has(p.orbit)))
    .sort((a, b) => SCOL_RANK[a.type] - SCOL_RANK[b.type] || orbitPref(a.orbit) - orbitPref(b.orbit) || Math.abs(a.orbit - 6) - Math.abs(b.orbit - 6));
  return { known: free.filter(p => p.type), unknown: free.filter(p => !p.type), cands,
    cloudOpen: free.filter(p => p.type === 'CLPL' && !probed.has(p.orbit)) };
}

function scolHint(S0) {
  const { known, unknown, cands, cloudOpen } = scolPick(S0.planets, S0.prospect);
  const bahnen = l => l.map(p => p.orbit).join(', ');
  if (!known.length) {
    return { short: 'Typen noch unbekannt', html: `<div class="scolhint"><b>SCOL-Ziel:</b> Typen noch unbekannt – ohne Typ gilt <b>Bahn 6</b>.
      <p class="small muted">Typen zeigt erst Sternwarte 2 (Faktor ≥ 10 %); die nächste Erfassung trägt sie hier ein.</p></div>` };
  }
  const best = cands[0];
  const far = best && orbitPref(best.orbit) === 2;
  const head = best ? `Bahn ${best.orbit} ${best.type} (${PL_TYPE[best.type] || best.type})` : 'Bahn 6';
  const list = cands.slice(0, 4).map((p, i) => `<li${i ? '' : ' class="best"'}>Bahn ${p.orbit} <b>${esc(p.type)}</b> ${esc(PL_TYPE[p.type] || '')}
    <span class="muted">· Rang ${SCOL_RANK[p.type]} · ${esc(SCOL_WHY[p.type])}</span></li>`).join('');
  return { short: `SCOL-Ziel laut Regel: ${head}`, html: `<div class="scolhint"><b>SCOL-Ziel laut Regel: ${esc(head)}</b>
    ${best ? `<ol class="scolc">${list}</ol>` : '<p class="small">Kein Typ der Ränge 1–5 (Vulkan/Lava, Dschungel, Wolken prospektiert, Fels, Wald) → Bahn 6.</p>'}
    ${far ? '<p class="small warn">Bahn 1 bzw. 11–13: vorher die Reichweite des SCOL prüfen.</p>' : ''}
    ${cloudOpen.length ? `<p class="small muted">Wolken (CLPL) auf Bahn ${bahnen(cloudOpen)}: zählt erst nach Prospektion.</p>` : ''}
    ${unknown.length ? `<p class="small muted">Noch unbekannt: Bahn ${bahnen(unknown)}.</p>` : ''}
    <p class="small muted">Regel (scol-ziel.md): VUPL/LVPL → JUPL → CLPL nur prospektiert → RKPL → FOPL, sonst Bahn 6; gleicher Rang: Bahn 5/6 vor 8/3 vor 1/11–13. Das Ziel legt der Nutzer fest.</p></div>` };
}

/* Reiter „Galaxie“ (#/galaxie/G/S): ◀ ▶ springen ins vorige/nächste erfasste System mit Planeten (über Galaxiegrenzen),
   Galaxie/System direkt eingeben, ⌂ = System des gewählten eigenen Planeten. Ohne Angabe: zuletzt angesehenes System, sonst ⌂. */
const hasPlanets = s => s.explored && s.orbits > 0;
const galGo = (g, s) => { location.hash = `#/galaxie/${g}${s ? `/${s}` : ''}`; };

async function viewGalaxy(rest = []) {
  const [systems, home] = await Promise.all([
    Cloud.q('planet_systems', { account_id: `eq.${S.acc}`, select: 'galaxy,system,name,discovered_by,explored,orbits,last_seen,source', order: 'galaxy,system' }),
    homeCoords(),
  ]);
  const hm = /^(\d+):(\d+):(\d+)$/.exec(home || '');
  const withPl = systems.filter(hasPlanets);
  let g = +rest[0], s = +rest[1];
  if (!(g >= 1 && g <= 99)) {
    let last = S.galView;
    if (!last) try { last = localStorage.getItem('hz-gal'); } catch { /* egal */ }
    const m = /^(\d+):(\d+)$/.exec(last || '');
    [g, s] = m ? [+m[1], +m[2]] : hm ? [+hm[1], +hm[2]] : withPl[0] ? [withPl[0].galaxy, withPl[0].system] : [1, 1];
  } else if (!(s >= 1 && s <= 9999)) {   // nur Galaxie gewählt: erstes System mit Planeten darin (bzw. das eigene)
    s = (hm && +hm[1] === g ? +hm[2] : 0) || withPl.find(x => x.galaxy === g)?.system || 1;
  }
  S.galView = `${g}:${s}`;
  try { localStorage.setItem('hz-gal', S.galView); } catch { /* egal */ }
  const cmp = x => x.galaxy - g || x.system - s;
  const prev = [...withPl].reverse().find(x => cmp(x) < 0), next = withPl.find(x => cmp(x) > 0);
  const sys = systems.find(x => x.galaxy === g && x.system === s);
  const data = sys ? await loadSysData(sys) : null;
  const isHome = hm && +hm[1] === g && +hm[2] === s;
  const navBtn = (x, lbl, title) => `<button class="gbtn" ${x ? `data-go="${x.galaxy}/${x.system}" title="${esc(title)} ${x.galaxy}:${x.system}${x.name ? ' ' + esc(x.name) : ''}"` : 'disabled'}>${lbl}</button>`;
  const inGal = withPl.filter(x => x.galaxy === g);
  $('#view').innerHTML = `<div class="card galnav">
      <button class="gbtn${isHome ? ' on' : ''}" id="galHome" ${hm ? `title="Eigener Planet ${esc(home)}"` : 'disabled title="Kein eigener Planet bekannt"'}>⌂</button>
      ${navBtn(prev, '◀', 'Voriges System mit Planeten:')}
      <form id="galForm" class="galin"><input name="g" type="number" min="1" max="99" value="${g}" inputmode="numeric" aria-label="Galaxie" title="Galaxie">:<input
        name="s" type="number" min="1" max="9999" value="${s}" inputmode="numeric" aria-label="System" title="System"><button class="gbtn galok" title="System anzeigen">↵</button></form>
      ${navBtn(next, '▶', 'Nächstes System mit Planeten:')}
      <p class="small muted galsum">${withPl.length ? `Erfasst mit Planeten: ${withPl.length} System${withPl.length > 1 ? 'e' : ''}${inGal.length ? `, in Galaxie ${g}: ${inGal.map(x => `<a href="#/galaxie/${x.galaxy}/${x.system}"${x.system === s ? ' class="on"' : ''}>${x.system}</a>`).join(' · ')}` : ` (keins in Galaxie ${g})`}` : 'Noch kein System mit Planeten erfasst.'}</p></div>
    ${systemCard(data, g, s, hm)}`;
  const v = $('#view');
  window.HzPlanetwerte?.bind(v);   // Planetenwerte: details/planetwerte.js
  v.querySelectorAll('button[data-go]').forEach(b => b.addEventListener('click', () => galGo(...b.dataset.go.split('/'))));
  $('#galHome').addEventListener('click', () => hm && galGo(hm[1], hm[2]));
  const f = $('#galForm');
  f.addEventListener('submit', e => {
    e.preventDefault();
    const ng = Math.min(99, Math.max(1, Math.round(+f.g.value) || g)), ns = Math.min(9999, Math.max(1, Math.round(+f.s.value) || s));
    ng !== g && ns === s ? galGo(ng) : galGo(ng, ns);   // nur Galaxie geändert → erstes System mit Planeten dort
  });
  f.g.addEventListener('change', () => { const ng = Math.round(+f.g.value); if (ng >= 1 && ng <= 99 && ng !== g) galGo(ng); });
  f.s.addEventListener('change', () => { const ns = Math.round(+f.s.value); if (ns >= 1 && ns <= 9999 && ns !== s && +f.g.value === g) galGo(g, ns); });
  if (!v.dataset.galToggle) {   // #view bleibt, also nur einmal anhängen
    v.dataset.galToggle = 1;
    v.addEventListener('toggle', e => { if (e.target.dataset?.open) (S.plOpen ||= {})[e.target.dataset.open] = e.target.open; }, true);
  }
}

function systemCard(S0, g, s, hm) {
  if (!S0) return `<div class="card"><h2>System ${g}:${s}</h2><p class="muted small">Nicht erfasst. Der Collector liest bisher nur das eigene System
    (bei jeder Erfassung); fremde Systeme kommen erst mit einem Scan auf Anforderung.</p></div>`;
  const { sys, planets, changes } = S0;
  const me = account()?.player || '';
  const byOrbit = new Map(planets.map(p => [p.orbit, p]));
  const probed = new Set((S0.prospect || []).map(x => x.orbit));
  const n = planets.filter(p => p.present).length;
  const own = planets.some(p => p.present && me && p.owner === me);
  const hint = sys.explored && own ? scolHint(S0) : null;   // SCOL-Regel gilt für das eigene System
  const homeOrbit = hm && +hm[1] === g && +hm[2] === s ? +hm[3] : 0;
  const n0 = Math.max(SYS_ORBITS, ...planets.map(p => p.orbit));
  const rows = Array.from({ length: n0 }, (_, i) => i + 1).map(b => {
    const p = byOrbit.get(b);
    if (!p) return `<div class="orb empty"><span class="ob">${b}</span><span class="muted small">leer</span></div>`;
    const typ = p.type ? `<span class="ptype t-${esc(p.type)}">${esc(p.type)}</span>` : '<span class="ptype unk">?</span>';
    const rank = !own || p.owner || !p.present || !SCOL_RANK[p.type] ? ''
      : p.type === 'CLPL' && !probed.has(b) ? ' <span class="tag">erst prospektieren</span>' : ` <span class="tag ok">Rang ${SCOL_RANK[p.type]}</span>`;
    const who = p.owner ? `${esc(p.owner)}${p.alliance ? ` [${esc(p.alliance)}]` : ''}${p.status ? ` · ${esc(PL_STATUS[p.status] || p.status)}` : ''}` : 'frei';
    const mine = me && p.owner === me;
    return `<div class="orb${p.present ? '' : ' gone'}${p.type ? '' : ' unknown'}${mine ? ' own' : ''}${b === homeOrbit ? ' home' : ''}"><span class="ob">${b === homeOrbit ? '⌂' : b}</span>${typ}
      <span class="oi"><b>${esc(p.name || '–')}</b> <span class="small${p.type ? '' : ' muted'}">${esc(typeLabel(p))}</span>${rank}
        <span class="small muted od">${b === homeOrbit ? `Bahn ${b} · ` : ''}${who}${p.present ? '' : ` · <b>Bahn leer seit ${esc(dt(p.changed_at))}</b>`}<span class="osm"> · ${esc(ago(p.last_seen))}</span></span></span>
      <span class="small muted os" title="zuletzt gesehen ${esc(dt(p.last_seen))}">${esc(ago(p.last_seen))}</span></div>`;
  }).join('');
  const chRow = c => `<tr><td class="small muted nowrap">${esc(dt(c.t))}</td><td class="num">${c.orbit}</td><td class="small">${esc(PL_FIELD[c.field] || c.field)}</td>
    <td class="small wrapall">${c.old && c.new ? `${esc(c.old)} → ${esc(c.new)}` : esc(c.old || c.new)}</td></tr>`;
  const ch = changes.length ? `<h3>Verlauf <span class="muted small">neueste zuerst</span></h3><table class="small chg"><tr><th>Zeit</th><th class="num">Bahn</th><th>Was</th><th>Änderung</th></tr>${changes.slice(0, 10).map(chRow).join('')}</table>
    ${changes.length > 10 ? `<details class="sub" data-open="syschg"${S.plOpen?.syschg ? ' open' : ''}><summary class="small">ältere (${changes.length - 10}${changes.length >= 60 ? '+' : ''})</summary><table class="small chg">${changes.slice(10).map(chRow).join('')}</table></details>` : ''}`
    : '<p class="small muted">Noch keine Änderungen.</p>';
  return `<div class="card" id="sysCard"><h2>System ${sys.galaxy}:${sys.system} <span class="muted small">${esc(sys.name)} · ${sys.explored ? `${n} Planet${n === 1 ? '' : 'en'}` : 'unerforscht'} · erfasst ${esc(ago(sys.last_seen))}</span></h2>
    ${!sys.explored ? '<p class="small warn">Das System gilt im Spiel als unerforscht (Sternwarte fehlt oder steht auf Faktor 0) – keine Planeten.</p>' : ''}
    ${hint?.html || ''}
    <div class="orbits">${rows}</div>
    <p class="small muted">Zuletzt erfasst ${esc(dt(sys.last_seen))} (${esc(sys.source)})${sys.discovered_by ? ` · entdeckt von ${esc(sys.discovered_by)}` : ''}. Grau = „Unbekannter Planet“ (Typ erst ab Sternwarte 2).</p>
    ${ch}</div>${window.HzPlanetwerte?.card(S0, g, s, homeOrbit) || ''}`;   // Planetenwerte: details/planetwerte.js
}
