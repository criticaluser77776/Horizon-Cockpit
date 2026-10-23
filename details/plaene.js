'use strict';
/* Horizon Atlas – Reiter Pläne (Archiv, lesend gespiegelt) und Werft/Def, Plan-Editor #/plaene/edit/<id> (D2, 17.10.2026).
   Kopien aus cockpit/app.js (im Cockpit bis C1). Freigeben, Verwerfen, Abbrechen, „bis #“, Start/Stopp bleiben im Cockpit;
   hier schreibt nur der Owner: Plan-Editor (legt einen Entwurf an) und Löschen älterer Pläne (plan_delete). */

/* Autobuilder-Steuerung: Kommandos gehen über den Collector an GENAU EIN Gerät (target_device): start live/dry bis #N,
   stop, adopt. Ziel ist standardmäßig der PC, der den Lauf hält, sonst der eingeloggte. Der Autobuilder prüft selbst
   Plan-id und „bis #“; ältere Kommandos als 10–15 min verfallen. */
const FMT_PCT = f => `${Math.round(f * 10) * 10} %`;
// Faktorwechsel des Plans: [Planzeit h, {typ: Anteil}] → nur die Änderungen gegenüber der vorigen Liste
function factorChanges(plan) {
  const out = [];
  let prev = {};
  for (const [tau, f] of plan.factors || []) {
    const ch = Object.entries(f).filter(([k, v]) => Math.round((prev[k] ?? 1) * 10) !== Math.round(v * 10)).map(([k, v]) => [k, prev[k] ?? 1, v]);
    if (ch.length) out.push({ tau, ch });
    prev = { ...prev, ...f };
  }
  return out;
}
// Planschritte: aktiver Ausschnitt (erster offener Schritt bis „bis #“) oder alle mit Historie (Ausführungen aus executions)
// Planeten: Reiter aus common.js (planTabs/planInTab, M5): tab = 'alle' | 'heim' | Koordinaten einer Kolonie | 'r' (Forschung)
// Erledigt: Ausführung (executions) oder vor dem ersten offenen Schritt des Autobuilders – Kolonie-Schritte baut er (bis M3)
// nicht, für sie zählt nur eine Ausführung
const planStepDone = (plan, st, execs) => {
  const open = (st.open || []).filter(Number.isInteger), first = open.length ? Math.min(...open) : null;
  const done = new Set(execs.filter(e => e.step).map(e => e.step));
  return n => done.has(n) || (first != null && n < first && !planAway(plan, n));
};
// Zeiten der Planschritte enthalten immer die Abweichung (Nutzer 16.10.): Planstart + τ + shift (h, wie activeEnd)
function stepsTable(plan, st, execs, all, W, tab, shift = 0) {
  const t0 = Date.parse(plan.startTime) + shift * 3600e3, tp = tau => esc(dt(t0 + tau * 3600e3));
  const tip = tau => shift ? ` title="Plan: ${esc(dt(t0 - shift * 3600e3 + tau * 3600e3))}"` : '';
  const open = (st.open || []).filter(Number.isInteger);
  const first = open.length ? Math.min(...open) : null;
  const until = st.until || plan.steps.length;
  const done = new Map(execs.filter(e => e.step).map(e => [e.step, e]));
  const isDone = planStepDone(plan, st, execs);
  const nameOf = k => W?.B?.[k]?.n || k;
  const rows = [];
  plan.steps.forEach((s, i) => { if (s[0] !== 's' && planInTab(plan, tab, s, i + 1)) rows.push({ tau: s[3], n: i + 1, s }); });
  // Faktorwechsel betreffen die Heimat: nur in den Reitern Alle und Heimat
  if (!tab || tab === 'alle' || tab === 'heim') for (const fc of factorChanges(plan)) rows.push({ tau: fc.tau, fc });
  rows.sort((a, b) => a.tau - b.tau || (a.fc ? -1 : 1));
  const from = first ?? 1;
  const vis = all ? rows : rows.filter(r => r.fc ? true : r.n >= from && r.n <= until);
  // Faktorwechsel im Ausschnitt nur zwischen dem ersten und letzten gezeigten Schritt
  const steps = vis.filter(r => !r.fc);
  const lo = steps.length ? steps[0].tau : Infinity, hi = steps.length ? steps[steps.length - 1].tau : -Infinity;
  const list = all ? vis : vis.filter(r => !r.fc || (r.tau >= lo && r.tau <= hi));
  if (!steps.length && !all) return `<p class="muted small">Kein offener Schritt bis #${esc(until)}${first ? ` (als Nächstes #${first})` : ''}.</p>`;
  return `<table class="small">${list.map(r => {
    if (r.fc) return `<tr class="muted"><td></td><td>⚙ Faktor ${r.fc.ch.map(([k, a, b]) => `${esc(nameOf(k))} ${FMT_PCT(a)} → ${FMT_PCT(b)}`).join(', ')}</td><td class="num"${tip(r.tau)}>${tp(r.tau)}</td></tr>`;
    const e = done.get(r.n), mark = isDone(r.n) ? '✓' : open.includes(r.n) ? '▶' : '';
    const kol = planAway(plan, r.n);
    return `<tr class="step${isDone(r.n) ? ' muted' : ''}" data-i="${r.n}"><td class="num">${mark} #${r.n}</td><td>${esc(r.s[5])}${r.s[0] === 'r' ? ' <span class="tag">global</span>' + planResTag(plan, r.n) : ''}${kol && (!tab || tab === 'alle') ? ` <span class="tag aktiv">${esc(planTabName(plan, kol))}</span>` : ''}${kol && !isDone(r.n) && !st?.colony ? ' <span class="muted">· von Hand</span>' : ''}${e ? `<div class="small">gestartet ${esc(dt(e.t))} · ${esc(e.src_name)}${e.carried ? " · aus Vorplan (gleiche Kennung)" : ""}</div>` : ''}</td>
      <td class="num"${tip(r.tau)}>${tp(r.tau)}</td></tr>`;
  }).join('')}</table>`;
}

const PLAN_GAIN_MIN = 0.5;   // h, wie SCHWELLE in tools/push_plan.py
const planEnd = p => {
  const h = +p?.hours || +(String(p?.created || '').match(/([\d.]+) h$/) || [])[1];
  return p?.startTime && h ? Date.parse(p.startTime) + h * 3600e3 : null;
};
// Verschiebung des aktiven Plans in h (positiv = später): Startverzug + Rückstand bzw. − Vorlauf; vor dem ersten Start die Wartezeit
const planShift = drift => !drift ? 0 : drift.lag != null ? (+drift.offset || 0) + +drift.lag : Math.max(+drift.wait || 0, 0);
const activeEnd = (active, drift) => {
  const end = planEnd(active?.payload);
  return end ? end + planShift(drift) * 3600e3 : null;
};
// Gewinn je Bauplan-Entwurf: { end, gain (h), pct (% der Restzeit des aktiven Plans bis zum Ziel), agreed, better }
async function draftGains(plans, active, drift) {
  const drafts = plans.filter(p => p.kind === 'build' && p.status === 'entwurf');
  if (!drafts.length) return {};
  const rows = await Cloud.q('plans', { id: `in.(${drafts.map(p => p.id).join(',')})`,
    select: 'id,startTime:payload->>startTime,hours:payload->>hours,created:payload->>created,agreed:payload->>agreed' });
  const aEnd = activeEnd(active, drift), rest = aEnd ? Math.max((aEnd - Date.now()) / 3600e3, 0.01) : null;
  const out = {};
  for (const d of rows) {
    const p = drafts.find(x => x.id === d.id), end = planEnd(d);
    // eigene Entwürfe tragen Planstart und Stunden des Ausgangsplans → kein Vergleich
    const gain = end && aEnd && p.source !== 'user' ? (aEnd - end) / 3600e3 : null, agreed = d.agreed === 'true';
    out[d.id] = { end, gain, pct: gain != null ? gain / rest * 100 : null, agreed,
      better: agreed || !active || gain == null || gain > PLAN_GAIN_MIN };
  }
  return out;
}
const gainText = g => g?.gain == null ? '' : `SCOL ${fmt(Math.abs(g.gain), 1)} h ${g.gain >= 0 ? 'früher' : 'später'} (${fmt(Math.abs(g.pct), 1)} % der Restzeit)`;

// Herkunft und Klapper „Details“ eines Plans (B16): Notiz in Anzeigeform, darunter die technischen Kennungen
const SRC = { optimizer: 'Optimierer', user: 'eigener Entwurf', claude: 'Claude' };
function planDetails(p) {
  if (!p.note && !p.plan_hash && !p.id) return '';
  return `<details class="sub"><summary class="small muted">Details</summary>${p.note ? `<div class="small wrapall" style="white-space:pre-wrap">${esc(tidy(p.note))}</div>` : ''}
    <div class="small muted wrapall">Plan-id ${esc(p.plan_hash || '–')} · Datensatz ${esc(p.id)}${p.parent_id ? ` · Vorlage ${esc(p.parent_id)}` : ''}</div></details>` + (window.HzWerftCockpit?.details(p) || '');   // Werft-/Def-Pläne: details/werft.js
}

/* ---------- Planabweichung (B4, 14.10.) ----------
   public.plan_abweichung rechnet je Schritt Plan-Start gegen echten Start (executions) und überfällige offene Schritte;
   der Startverzug (erster Start nach dem Planstart, weil der Plan ab seinem Snapshot rechnet) ist abgezogen. Der Wächter in
   Supabase meldet ab 2 h Rückstand „mittel“ (je weitere 2 h erneut) mit dem Angebot, neu zu planen. */
const hrs = h => `${fmt(Math.abs(h), 1)} h`;
const lagText = h => h == null ? '–' : h >= 0.05 ? `${hrs(h)} hinter dem Plan` : h <= -0.05 ? `${hrs(h)} Vorlauf` : 'genau im Plan';
function driftSvg(d) {
  const off = +d.offset || 0, now = Date.now();
  const pts = (d.points || []).map(p => [Date.parse(p.t), p.lag - off]);
  if (d.lag != null) pts.push([now, +d.lag]);
  if (pts.length < 2) return '';
  const W = 480, H = 160, L = 38, R = 8, T = 10, B = 22;
  const x0 = pts[0][0], x1 = Math.max(now, pts[pts.length - 1][0]);
  const ys = pts.map(p => p[1]), lo = Math.min(-0.5, ...ys), hi = Math.max(d.limit + 0.5, ...ys);
  const X = t => L + (t - x0) / Math.max(1, x1 - x0) * (W - L - R), Y = v => T + (hi - v) / (hi - lo) * (H - T - B);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('');
  const tick = v => `<text x="${L - 4}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end">${fmt(v, 0)} h</text>`;
  const days = [];
  for (let t = new Date(x0).setHours(24, 0, 0, 0); t < x1; t += 864e5)
    days.push(`<line x1="${X(t).toFixed(1)}" x2="${X(t).toFixed(1)}" y1="${T}" y2="${H - B}" class="g"/><text x="${(X(t) + 3).toFixed(1)}" y="${H - 6}">${dtParts(new Date(t)).wd}</text>`);
  return `<svg class="drift" viewBox="0 0 ${W} ${H}" role="img" aria-label="Rückstand gegen den Plan über die Zeit">
    ${days.join('')}<line x1="${L}" x2="${W - R}" y1="${Y(0).toFixed(1)}" y2="${Y(0).toFixed(1)}" class="z"/>
    <line x1="${L}" x2="${W - R}" y1="${Y(d.limit).toFixed(1)}" y2="${Y(d.limit).toFixed(1)}" class="lim"/>${tick(0)}${tick(d.limit)}
    <path d="${line}" class="ln"/>${pts.map((p, i) => `<circle cx="${X(p[0]).toFixed(1)}" cy="${Y(p[1]).toFixed(1)}" r="${i === pts.length - 1 && d.lag != null ? 4 : 2.5}" class="${p[1] >= d.limit ? 'bad' : 'pt'}"/>`).join('')}</svg>`;
}
function driftCard(d, own) {
  if (!d) return '';
  const head = `<div class="row between"><h2>Planabweichung</h2><span class="muted small">${esc(planLabel(d.hash))}</span></div>`;
  if (d.lag == null) return `<div class="card">${head}<p class="small">Noch kein Schritt dieses Plans gestartet. Der Plan rechnet ab seinem Snapshot (${esc(dt(d.start))});
    der Verzug bis zum ersten Start zählt nicht als Rückstand.</p></div>`;
  const cls = d.lag >= d.limit ? 'err' : d.lag >= 1 ? 'warn' : 'ok';
  const end = d.hours ? Date.parse(d.start) + (+d.hours + (+d.offset || 0)) * 3600e3 : null;
  return `<div class="card">${head}<p class="${cls}"><b>${esc(lagText(d.lag))}</b></p>
    <div class="small">${d.last ? `Zuletzt #${esc(d.last.n)} ${esc(d.last.text)} gestartet ${esc(when(d.last.t))} (${esc(lagText(d.last.lag))})` : ''}
    ${d.due?.lag > 0 ? `<br>Überfällig: #${esc(d.due.n)} ${esc(d.due.text)} sollte ${esc(dt(d.due.at))} starten` : ''}
    ${d.pause?.h >= 0.05 ? `<br>Davon Pause ${esc(hrs(d.pause.h))}${d.pause.since ? ` (pausiert seit ${esc(dt(d.pause.since))})` : ''}` : ''}
    ${d.offset > 0.05 ? `<br><span class="muted">Startverzug ${esc(hrs(d.offset))} (Plan ab Snapshot ${esc(dt(d.start))}) ist abgezogen.</span>` : ''}
    ${end ? `<br>Planende ${d.lag > 0.05 ? `etwa <b>${esc(dt(end + d.lag * 3600e3))}</b> statt ${esc(dt(end))}` : esc(dt(end))}` : ''}</div>
    ${driftSvg(d)}<p class="muted small">Kurve: Rückstand je gestartetem Schritt (über 0 = hinter dem Plan), gestrichelt die Meldegrenze ${esc(d.limit)} h.
      Ab da meldet Supabase „mittel“, je weitere ${esc(d.limit)} h erneut.</p>
    </div>`;
}

// B15: Plan endgültig löschen (nur Owner, nie freigegeben/aktiv; prüft auch die Datenbank). Erst zählen, was den Bezug verliert.
async function deletePlan(p) {
  if (!p) return;
  try {
    const n = await Cloud.rpc('plan_delete', { p_id: p.id });
    const lost = [n.executions ? `${n.executions} Ausführungen` : '', n.commands ? `${n.commands} Kommandos` : '',
      n.children ? `${n.children} abgeleitete Pläne` : ''].filter(Boolean);
    if (!confirm(`${planLabel(p.id)} („${tidy(p.title || 'ohne Titel')}“, ${p.status}) endgültig löschen?${lost.length
      ? `

${lost.join(', ')} bleiben erhalten, verlieren aber den Bezug zu diesem Plan. Die Planabweichung dieses Plans lässt sich danach nicht mehr ansehen.`
      : ''}

Das lässt sich nicht rückgängig machen.`)) return;
    await Cloud.rpc('plan_delete', { p_id: p.id, p_confirm: true });
    NUMS.at = 0;   // Anzeigenummern neu zählen
    toast('Gelöscht'); route();
  } catch (e) { toast(e.message); }
}

/* ---------- Plan neu starten / Planschritte ändern (Paket F4, 13.10.) ----------
   Aus einem vorhandenen Bauplan (auch abgebrochen oder alt) entsteht ein neuer Entwurf: neue Plan-id (payload.id = plan_hash;
   mit der alten id böte der Collector ihn nicht an und der Autobuilder sähe ihn als abgebrochen), Verweis parent_id.
   Ändern: Schritte überspringen, verschieben und einfügen (B17, 16.10.: Gebäude/Forschung samt Stufe an eine Position; der
   Autobuilder führt ihn wie jeden Planschritt aus – Voraussetzungen über REQS, Startbarkeit und Kosten live von der Seite;
   Planzeit zwischen den Nachbarn mit Dauer 0, damit die Faktor-Liste des Plans unverändert weiter gilt), Haltepunkte (payload.halts: der Autobuilder hält ab 0.5.10 vor diesem
   Schritt an), Faktor-Grenzen je Gebäude (payload.limits {Typ: [min %, max %]}, ab 0.5.10; Risiko-Grenzen und „laufender
   Auftrag ≥ 10 %“ gehen vor). Vor dem Anlegen prüft das Cockpit die Reihenfolge der Voraussetzungen (Datenbank Runde 7 wie
   REQS im Autobuilder) gegen den Live-Stand. Freigeben nur der Owner, wie jeden Entwurf. */
// Voraussetzungen von Objekt k:id für Stufe l (horizon-data: q = [[ab, bis, [[Art, Typ, Stufe] …]] …])
function reqsOf(W, k, id, l) {
  const o = (k === 'b' ? W?.B : W?.R)?.[id];
  return (o?.q || []).filter(([a, b]) => l >= a && l <= b).flatMap(x => x[2]);
}
/* Reihenfolge prüfen. Ausgangsstufe je Objekt: Live-Stufe (laufender Auftrag zählt als fertig), sonst die Stufe vor dem ersten
   Schritt im Ursprungsplan; Objekte, die weder live gelesen noch im Ursprungsplan gebaut werden, gelten als vorhanden (der
   Plan setzte sie voraus). Ergebnis: [{i, text}] (i = Index im neuen Plan). */
function checkOrder(steps, orig, live, W) {
  const have = {};
  for (const s of orig) { const k = `${s[0]}:${s[1]}`; have[k] = Math.min(have[k] ?? Infinity, s[2] - 1); }
  if (live) Object.assign(have, live);
  const lvl = k => have[k] ?? Infinity;
  const nm = (k, id) => (k === 'b' ? W?.B : W?.R)?.[id]?.n || id;
  const errs = [];
  steps.forEach((s, i) => {
    if (s[0] === 's') return;
    const k = `${s[0]}:${s[1]}`;
    if (lvl(k) >= s[2]) return;
    if (lvl(k) < s[2] - 1) errs.push({ i, text: `#${i + 1} ${s[5]}: Stufe ${s[2] - 1} fehlt davor` });
    for (const [rk, rid, rl] of reqsOf(W, s[0], s[1], s[2])) {
      if (lvl(`${rk}:${rid}`) >= rl) continue;
      const j = steps.findIndex((x, n) => n > i && x[0] === rk && x[1] === rid && x[2] >= rl);
      errs.push({ i, text: `#${i + 1} ${s[5]}: braucht ${nm(rk, rid)} ${rl}${j >= 0 ? ` – kommt erst #${j + 1}` : ' – fehlt im Plan'}` });
    }
    have[k] = s[2];
  });
  return errs;
}
// Live-Stufen aus dem neuesten Live-Stand {'b:typ': Stufe} (Titel zeigt bei laufendem Auftrag schon die Zielstufe)
async function liveLevels() {
  const r = (await Cloud.q('state_latest', { account_id: `eq.${S.acc}`, kind: 'eq.live',
    select: 'collected_at,b:data->buildings->items,r:data->research->items' }).catch(() => []))[0];
  if (!r) return null;
  const out = {};
  for (const k of ['b', 'r']) for (const o of r[k] || []) if (o?.type && Number.isInteger(o.level)) out[`${k}:${o.type}`] = o.level;
  return { at: r.collected_at, lv: out };
}
async function planId(x) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(x)));
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 10);
}
// Neuer Plan aus dem Editor-Zustand: Schritte, Haltepunkte (neue Nummern)
function editedPlan(E) {
  const keep = E.rows.filter(r => !r.skip && !(E.dropDone && r.done && !r.ins));
  const steps = keep.map(r => r.s);
  const halts = keep.map((r, i) => r.halt ? i + 1 : null).filter(Boolean);
  const changed = E.rows.some(r => r.skip || r.moved || r.ins || r.halt !== r.halt0) || E.dropDone && E.rows.some(r => r.done)
    || JSON.stringify(E.limits) !== JSON.stringify(E.orig.limits || {});
  return { keep, steps, halts, changed };
}
// Eingefügter Schritt (B17): Name und Kosten wie im Plan (Gebäude: Stufenname der Datenbank, Forschung: Grundkosten × 1,5^(Stufe−1)
// wie im Kompendium); die Kosten nutzt der Autobuilder nur für die Wartezeit-Schätzung, maßgeblich ist die Spielseite.
function newStep(W, k, id, l) {
  if (k === 'b') {
    const o = W.B[id], e = o.L[l], c = e?.[2] || {};
    return ['b', id, l, 0, 0, `${e?.[1] || o.n} ${l}`, [c.Eisenerz || 0, c.Mineral || 0, c.Treibstoff || 0]];
  }
  const o = W.R[id], m = Math.pow(o.c === 'Allianzforschung' ? 2.5 : 1.5, l - 1);
  return ['r', id, l, 0, 0, `${o.n} ${l}`, (o.k || [0, 0, 0]).map(x => Math.floor(x * m))];
}
// Stufe, die ein Objekt vor Zeile j des Editors erreicht hat (frühere Schritte, sonst Live-Stand, sonst 0)
function levelBefore(E, k, id, j) {
  let l = E.L?.lv?.[`${k}:${id}`] ?? 0;
  E.rows.slice(0, j).forEach(r => { if (!r.skip && r.s[0] === k && r.s[1] === id) l = Math.max(l, r.s[2]); });
  return l;
}
// Planzeit für einen neuen Schritt an Position j: zwischen den Startzeiten der Nachbarn (am Ende: Ende des letzten), Dauer 0
function insTime(rows, j) {
  const lo = j ? rows[j - 1].s[3] : 0, hi = rows[j]?.s[3];
  return +(hi == null ? rows[j - 1]?.s[4] ?? 0 : (lo + hi) / 2).toFixed(4);
}
async function viewPlanEdit(id) {
  if (!S.ed || S.ed.id !== id) {
    const [src] = await Cloud.q('plans', { id: `eq.${id}`, account_id: `eq.${S.acc}`, select: 'id,kind,status,title,plan_hash,payload' });
    if (!src || src.kind !== 'build' || !Array.isArray(src.payload?.steps)) throw new Error('Bauplan nicht gefunden');
    const [W, L] = await Promise.all([loadWissen().catch(() => null), liveLevels()]);
    const orig = src.payload, lv = L?.lv;
    S.ed = { id, src, orig, W, L, dropDone: false, limits: { ...(orig.limits || {}) }, note: '', ins: { k: 'b', id: '', l: 1, at: 0 },
      rows: orig.steps.map((s, i) => {
        const halt = (orig.halts || []).includes(i + 1);
        return { s, n0: i + 1, halt, halt0: halt, done: !!lv && s[0] !== 's' && (lv[`${s[0]}:${s[1]}`] ?? -1) >= s[2] };
      }) };
  }
  renderPlanEdit(isOwner());
}
function renderPlanEdit(own) {
  const E = S.ed, { W, L, orig } = E;
  const P = editedPlan(E);
  // eingefügte Objekte: Ausgangsstufe = Stufe davor (sonst gälten Objekte ohne Live-Wert als vorhanden)
  const errs = checkOrder(P.steps, [...orig.steps, ...E.rows.filter(r => r.ins).map(r => r.s)], L?.lv, W);
  const bad = new Set(errs.map(e => e.i));
  const nm = t => W?.B?.[t]?.n || t;
  // Gebäude mit Faktor: aus dem Plan und den Grenzen
  const types = [...new Set([...(orig.factors || []).flatMap(f => Object.keys(f[1] || {})), ...Object.keys(E.limits)])]
    .sort((a, b) => nm(a).localeCompare(nm(b), 'de'));
  let n = 0;
  const rows = E.rows.map((r, i) => {
    const out = r.skip || E.dropDone && r.done && !r.ins;
    const no = out ? 0 : ++n;
    return `${r.halt && !out ? `<tr class="halt"><td></td><td colspan="2">⏸ Haltepunkt: Autobuilder hält vor #${no} an</td></tr>` : ''}
      <tr class="step${out ? ' skip' : ''}${!out && bad.has(no - 1) ? ' bad' : ''}" data-i="${i}">
      <td class="num">${out ? '–' : '#' + no}</td>
      <td>${esc(r.s[5])}${r.s[0] === 'r' ? ' <span class="tag">global</span>' + (r.n0 ? planResTag(E.orig, r.n0) : '') : ''}<div class="small muted">${r.ins ? '<b>neu eingefügt</b>' : `war #${r.n0}`}${r.moved ? ' · verschoben' : ''}${r.done ? ' · live erreicht' : ''}${r.skip ? ' · übersprungen' : ''}</div></td>
      <td class="acts">${own ? `<button data-a="up" title="nach oben"${i ? '' : ' disabled'}>↑</button><button data-a="down" title="nach unten"${i < E.rows.length - 1 ? '' : ' disabled'}>↓</button><button data-a="halt" title="Haltepunkt davor"${r.halt ? ' class="on"' : ''}>⏸</button><button data-a="skip" title="${r.ins ? 'wieder entfernen' : 'überspringen'}"${r.skip ? ' class="on"' : ''}>✕</button>` : ''}</td></tr>`;
  }).join('');
  const lim = Object.entries(E.limits).map(([t, [a, b]]) => `<div class="row between small"><span>${esc(nm(t))}: ${a}–${b} %</span>${own ? `<button class="link" data-lim-del="${esc(t)}">entfernen</button>` : ''}</div>`).join('');
  const pctOpts = sel => Array.from({ length: 11 }, (_, k) => k * 10).map(v => `<option value="${v}"${v === sel ? ' selected' : ''}>${v} %</option>`).join('');
  $('#view').innerHTML = `<div class="card"><div class="row between"><h2>Plan neu starten / ändern</h2><a href="#/plaene" class="small">zurück</a></div>
    <p class="small">Vorlage: <b>${esc(planLabel(E.src.id))}</b> · ${esc(tidy(E.src.title))} <span class="tag ${esc(E.src.status)}">${esc(E.src.status)}</span> · ${orig.steps.length} Schritte</p>
    <p class="muted small">Es entsteht ein <b>neuer Entwurf</b> (neuer Plan mit eigener Nummer) mit neuen Schrittnummern; die Vorlage bleibt unverändert. Freigeben und auf ein Gerät übernehmen danach wie gewohnt, „bis #“ neu wählen. Haltepunkte und Faktor-Grenzen wirken ab Autobuilder 0.5.10.</p>
    <p class="small">${L ? `Live-Stand ${esc(when(L.at))}: ${E.rows.filter(r => r.done).length} Schritte schon erreicht.` : '<span class="warn">Kein Live-Stand – Prüfung nur gegen den Ursprungsplan.</span>'}</p>
    ${L ? `<label class="small"><input type="checkbox" id="edDone"${E.dropDone ? ' checked' : ''}${own ? '' : ' disabled'}> live erreichte Schritte weglassen (Nummern beginnen beim ersten offenen)</label>` : ''}
  </div>
  <div class="card" style="margin-top:12px"><h3 style="margin-top:0">Prüfung der Voraussetzungen</h3>
    ${errs.length ? `<ul class="small err">${errs.slice(0, 30).map(e => `<li>${esc(e.text)}</li>`).join('')}${errs.length > 30 ? `<li>… ${errs.length - 30} weitere</li>` : ''}</ul>`
      : '<p class="small ok">Reihenfolge passt (Stufenfolge und Voraussetzungen laut Datenbank Runde 7).</p>'}
  </div>
  <div class="card" style="margin-top:12px"><h3 style="margin-top:0">Faktor-Grenzen je Gebäude</h3>
    ${lim || '<p class="muted small">Keine – der Autobuilder regelt nach dem Live-Zustand (Risiko-Grenzen laut Wiki gelten immer).</p>'}
    ${own ? `<div class="row wrap" style="margin-top:6px"><select id="limT">${types.map(t => `<option value="${esc(t)}">${esc(nm(t))}</option>`).join('')}</select>
      min <select id="limA">${pctOpts(0)}</select> max <select id="limB">${pctOpts(100)}</select> <button id="limAdd">setzen</button></div>` : ''}
  </div>
  ${own && W ? insCard(E, P) : ''}
  <div class="card" style="margin-top:12px"><h3 style="margin-top:0">Planschritte (${P.steps.length})</h3>
    <div class="scroll"><table class="small edsteps">${rows}</table></div>
  </div>
  ${own ? `<div class="card" style="margin-top:12px"><label class="f"><span>Notiz zum Entwurf</span><input id="edNote" maxlength="500" value="${esc(E.note)}"></label>
    <div class="row"><button class="primary" id="edGo"${P.steps.length ? '' : ' disabled'}>${P.changed ? 'Geänderten Plan als Entwurf anlegen' : 'Plan neu starten (neuer Entwurf)'}</button>
    <button id="edReset">Änderungen verwerfen</button></div></div>` : ''}`;
  if (!own) return;
  $('#edDone')?.addEventListener('change', e => { E.dropDone = e.target.checked; renderPlanEdit(own); });
  $('#edNote').addEventListener('input', e => { E.note = e.target.value; });
  $('#edReset').addEventListener('click', () => { S.ed = null; viewPlanEdit(E.id); });
  $('#limAdd').addEventListener('click', () => {
    const t = $('#limT').value, a = +$('#limA').value, b = +$('#limB').value;
    if (!t) return;
    if (a > b) return toast('min darf nicht über max liegen');
    E.limits[t] = [a, b]; renderPlanEdit(own);
  });
  if (W) bindIns(E, own);
  $('#view').querySelectorAll('[data-lim-del]').forEach(b => b.addEventListener('click', () => { delete E.limits[b.dataset.limDel]; renderPlanEdit(own); }));
  $('#view').querySelector('.edsteps').addEventListener('click', e => {
    const b = e.target.closest('button[data-a]'); if (!b) return;
    const i = +b.closest('tr').dataset.i, r = E.rows[i];
    if (b.dataset.a === 'skip' && r.ins) { E.rows.splice(i, 1); if (E.ins.at > i) E.ins.at--; }
    else if (b.dataset.a === 'skip') r.skip = !r.skip;
    else if (b.dataset.a === 'halt') r.halt = !r.halt;
    else {
      const j = b.dataset.a === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= E.rows.length) return;
      [E.rows[i], E.rows[j]] = [E.rows[j], E.rows[i]];
      retime(E.rows, j);
    }
    renderPlanEdit(own);
  });
  $('#edGo').addEventListener('click', () => createEdited(E, P, errs));
}
// Verschobener Schritt: Startzeit zwischen die neuen Nachbarn legen (Dauer bleibt), damit Planzeiten und Anzeige stimmen
function retime(rows, j) {
  const r = rows[j], s = r.s, lo = rows[j - 1]?.s[3] ?? 0, hi = rows[j + 1]?.s[3] ?? Infinity;
  r.moved = true;
  if (s[3] >= lo && s[3] <= hi) return;
  const t = isFinite(hi) ? (lo + hi) / 2 : lo, d = s[4] - s[3];
  r.s = [...s.slice(0, 3), +t.toFixed(4), +(t + d).toFixed(4), ...s.slice(5)];
}
// Karte „Schritt einfügen“ (B17): Art, Objekt, Stufe, Position (vor Zeile j des Editors; Nummern wie in der Tabelle)
const insObjs = (W, k) => Object.entries(k === 'b' ? W.B : W.R).sort((a, b) => a[1].n.localeCompare(b[1].n, 'de'));
function insCard(E, P) {
  const { W, ins } = E, src = ins.k === 'b' ? W.B : W.R, objs = insObjs(W, ins.k);
  if (!src[ins.id]) { ins.id = objs[0][0]; ins.l = Math.min(levelBefore(E, ins.k, ins.id, ins.at) + 1, src[ins.id].f || 99); }
  if (ins.at > E.rows.length) ins.at = E.rows.length;
  const max = src[ins.id].f || 99, have = levelBefore(E, ins.k, ins.id, ins.at);
  let n = 0;
  const pos = E.rows.map((r, i) => {
    const out = r.skip || E.dropDone && r.done && !r.ins;
    return out ? '' : `<option value="${i}"${i === ins.at ? ' selected' : ''}>vor #${++n} ${esc(r.s[5])}</option>`;
  }).join('') + `<option value="${E.rows.length}"${ins.at === E.rows.length ? ' selected' : ''}>ans Ende (nach #${P.steps.length})</option>`;
  return `<div class="card" style="margin-top:12px"><h3 style="margin-top:0">Schritt einfügen</h3>
    <div class="row wrap"><select id="insK"><option value="b"${ins.k === 'b' ? ' selected' : ''}>Gebäude</option><option value="r"${ins.k === 'r' ? ' selected' : ''}>Forschung</option></select>
      <select id="insId">${objs.map(([id, o]) => `<option value="${esc(id)}"${id === ins.id ? ' selected' : ''}>${esc(o.n)}</option>`).join('')}</select>
      Stufe <input id="insL" type="number" min="1" max="${max}" value="${ins.l}" style="width:4.5em"></div>
    <div class="row wrap" style="margin-top:6px"><select id="insAt" style="max-width:100%">${pos}</select> <button id="insGo">einfügen</button></div>
    <p class="muted small">An dieser Stelle hat ${esc(src[ins.id].n)} Stufe ${have}${have >= max ? ' (Höchststufe)' : ''}. Der Autobuilder führt den Schritt wie jeden Planschritt aus: Voraussetzungen laut Datenbank, Kosten und Bauzeit live von der Spielseite; die Faktor-Vorgaben des Plans bleiben unverändert, spätere Planzeiten verschieben sich nicht.</p></div>`;
}
function bindIns(E, own) {
  const ins = E.ins, max = () => (ins.k === 'b' ? E.W.B : E.W.R)[ins.id]?.f || 99;
  const sugg = () => { ins.l = Math.min(levelBefore(E, ins.k, ins.id, ins.at) + 1, max()); renderPlanEdit(own); };
  $('#insK')?.addEventListener('change', e => { ins.k = e.target.value; ins.id = insObjs(E.W, ins.k)[0][0]; sugg(); });
  $('#insId')?.addEventListener('change', e => { ins.id = e.target.value; sugg(); });
  $('#insAt')?.addEventListener('change', e => { ins.at = +e.target.value; sugg(); });
  $('#insL')?.addEventListener('input', e => { ins.l = +e.target.value; });
  $('#insGo')?.addEventListener('click', () => {
    const l = +$('#insL').value;
    if (!Number.isInteger(l) || l < 1 || l > max()) return toast(`Stufe 1–${max()} wählen`);
    // Stufe steht schon im Plan (z. B. Sternwarte 2 als #78): an die gewählte Stelle verschieben statt doppelt einfügen
    const k = E.rows.findIndex(r => r.s[0] === ins.k && r.s[1] === ins.id && r.s[2] === l);
    if (k >= 0) {
      if (k === ins.at || k === ins.at - 1) return toast(`${E.rows[k].s[5]} steht schon an dieser Stelle`);
      if (!confirm(`${E.rows[k].s[5]} steht schon im Plan${E.rows[k].n0 ? ` (war #${E.rows[k].n0})` : ''}${E.rows[k].skip ? ', übersprungen' : ''}.\nAn die gewählte Stelle verschieben?`)) return;
      const [r] = E.rows.splice(k, 1), at = k < ins.at ? ins.at - 1 : ins.at;
      r.skip = false;
      E.rows.splice(at, 0, r);
      retime(E.rows, at);
      ins.at = at + 1;
      toast(`${r.s[5]} verschoben`);
      return sugg();
    }
    const s = newStep(E.W, ins.k, ins.id, l);
    s[3] = s[4] = insTime(E.rows, ins.at);
    const done = !!E.L && (E.L.lv[`${ins.k}:${ins.id}`] ?? -1) >= l;
    E.rows.splice(ins.at, 0, { s, n0: null, ins: true, halt: false, halt0: false, done });
    ins.at++;
    toast(`${s[5]} eingefügt${done ? ' – live schon erreicht' : ''}`);
    sugg();
  });
}
async function createEdited(E, P, errs) {
  if (errs.length && !confirm(`${errs.length} Probleme bei den Voraussetzungen (erstes: ${errs[0].text}).\nDer Autobuilder würde dort warten oder anhalten. Trotzdem anlegen?`)) return;
  const o = E.orig, now = new Date();
  const stamp = now.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });   // gespeichert; Anzeige über tidy
  const hours = +o.hours || +(String(o.created || '').match(/([\d.]+) h$/) || [])[1] || undefined;
  const payload = { ...o, steps: P.steps, halts: P.halts, limits: E.limits, parent: o.id,
    created: `${String(o.created || '').replace(/ · (neu|geändert) .*$/, '')} · ${P.changed ? 'geändert' : 'neu'} ${stamp}`, hours };
  delete payload.agreed;
  if (!P.halts.length) delete payload.halts;
  if (!Object.keys(E.limits).length) delete payload.limits;
  // Planet je Schritt (Kolonien, plan.stepPlanet {Nr: Koordinaten}) auf die neuen Nummern umschreiben
  // (eine Liste aus Plänen vor M1 gilt nicht und fällt weg)
  delete payload.stepPlanet;
  if (o.stepPlanet && !Array.isArray(o.stepPlanet)) payload.stepPlanet =Object.fromEntries(P.keep.map((r, i) => [i + 1, o.stepPlanet[r.n0]]).filter(x => x[1]));
  // Forschungs-Startplanet (M6, plan.researchPlanet {Nr: Koordinaten}) ebenso; eingefügte Forschung startet auf der Heimat
  delete payload.researchPlanet;
  if (o.researchPlanet) { const rp = Object.fromEntries(P.keep.map((r, i) => [i + 1, r.n0 ? planResPlanet(o, r.n0) : null]).filter(x => x[1])); if (Object.keys(rp).length) payload.researchPlanet = rp; }
  // Haltepunkte zusätzlich über die feste Kennung (M7, Autobuilder ab 0.5.47): gelten auch, wenn sich Nummern verschieben
  delete payload.haltKeys;
  if (P.halts.length) { const ks = planStepKeys(payload); payload.haltKeys = P.halts.map(n => ks[n - 1]).filter(Boolean); }
  payload.id = await planId([payload.startTime, payload.steps, payload.factors, payload.halts || [], payload.limits || {}, o.id, now.toISOString()]);
  const sk = E.rows.filter(r => r.skip).map(r => '#' + r.n0), mv = E.rows.filter(r => r.moved && !r.skip && !r.ins).map(r => '#' + r.n0);
  const ins = P.keep.map((r, i) => r.ins ? `#${i + 1} ${r.s[5]}` : null).filter(Boolean);
  const note = [`${P.changed ? 'Geändert' : 'Neu gestartet'} aus ${o.id} (${E.src.status}) im Cockpit: ${P.steps.length} Schritte`,
    E.dropDone ? `live erreichte weggelassen (${E.rows.filter(r => r.done && !r.skip).length})` : '',
    sk.length ? `übersprungen ${sk.join(' ')}` : '', ins.length ? `eingefügt ${ins.join(', ')}` : '', mv.length ? `verschoben ${mv.join(' ')}` : '',
    P.halts.length ? `Haltepunkte vor #${P.halts.join(', #')}` : '',
    Object.keys(E.limits).length ? `Faktor-Grenzen ${Object.entries(E.limits).map(([t, [a, b]]) => `${t} ${a}–${b} %`).join(', ')}` : '',
    errs.length ? `${errs.length} Voraussetzungs-Hinweise` : '', E.note.trim()].filter(Boolean).join(' · ');
  if (!confirm(`Neuen Entwurf anlegen?\n${tidy(note)}\nFreigeben danach im Cockpit unter Pläne.`)) return;
  try {
    await Cloud.rest('plans', { method: 'POST', prefer: 'return=minimal', body: { account_id: S.acc, kind: 'build', source: 'user',
      title: `Bauplan ${payload.created}`.slice(0, 200), note: note.slice(0, 4000), payload, plan_hash: payload.id, parent_id: E.src.id } });
    S.ed = null;
    toast('Entwurf angelegt – freigeben im Cockpit unter Pläne');
    location.hash = '#/plaene';
  } catch (e) { toast(e.message); }
}



/* ---------- Atlas: Pläne (Archiv) ----------
   Aktiver Bauplan mit ganzer Schrittliste samt Ausführungen und Abweichungsgrafik; alle Baupläne (auch ältere) mit Details,
   Plan-Editor-Link und Löschen (nur Owner, nie freigegebene/aktive). Freigeben & Co. nur im Cockpit. */
/* Neuer Lauf auf Work mit Einstellungen (Teil A, 20.10.2026): „Mit aktuellen Einstellungen rechnen“ stellt den Auftrag über
   public.plan_rechnen(p_params) (nur Owner, höchstens einer offen). Darunter eingeklappt alle Einstellungen, vorbelegt mit dem
   Standard (simparams.js = tools/sim_params.py). Ergebnis nur als Entwurf (sim/auf-….json); result.json, täglicher Lauf und
   Autobuilder bleiben. Der Formularzustand liegt in S.simlauf, damit das stille Neuladen (60 s) nichts verwirft. */
const SL_FIELDS = [
  ['Ziel', [
    ['ziel', 'Ziel', 'sel', [['scol', 'SCOL (1. Kolonieschiff)'], ['kolo3', 'Kolopunkt 3'], ['kolo4', 'Kolopunkt 4'], ['kolo5', 'Kolopunkt 5']]],
    ['kolo', 'Kolonien Bahn:Typ:Rolle', 'txt', 'z. B. 5:JUPL:rohstoff, 6:RKPL:rohstoff · Platzhalter K:STPL:auto · Rolle rohstoff/kolozentrum/auto'],
    ['platzbahn', 'Platzbahn (Flugzeit der Platzhalter)', 'num', 'leer = 6'],
    ['kolopflicht', 'Mindeststufen je Kolonie', 'txt', 'z. B. *:b:metalmine:10, 1:b:researchcenter:heimat'],
  ]],
  ['Flotte', [
    ['flotte', 'Flotte Typ:Anzahl', 'txt', 'z. B. PFLS:1, PTRN:2 · leer = keine'],
    ['flottebis', 'Flotte wann', 'sel', [['nach', 'nach dem Ziel'], ['kolo3', 'bis Kolopunkt 3']]],
    ['werft', 'Werft-Stufe höchstens', 'num', ''],
  ]],
  ['Bauregeln', [
    ['pflicht', 'Pflicht art:id:stufe', 'txt', 'z. B. b:spaceobservatory:2 (b Gebäude, r Forschung)'],
    ['verbot', 'Verbot art:id', 'txt', 'kommt in keinem Plan vor'],
    ['aus', 'Aus (bauen, aber 0 %)', 'txt', 'z. B. b:fissionreactor'],
    ['techcap', 'Obergrenze heben art:id:stufe', 'txt', 'z. B. r:refinerytech:11 (samt Voraussetzungen) · leer = Standard-Obergrenzen'],
    ['bunker', 'Bunker-Stufe', 'num', ''],
    ['rabatt', 'Rabatt (0…0,5)', 'num', ''],
    ['makroziele', 'Makro-Ziele', 'num', ''],
    ['makro', 'Makro-Iterationen', 'num', ''],
  ]],
  ['Motivationsvideo', [
    ['movi_modus', 'Video', 'sel', [['aus', 'ohne'], ['auto', 'bester Zeitpunkt (auto)'], ['zeit', 'fester Zeitpunkt']]],
    ['movi_zeit', 'Zeitpunkt (Planstunde oder ISO)', 'txt', 'nur bei „fester Zeitpunkt“'],
    ['movi_faktor', 'Faktor', 'num', 'Standard 25 (live gemessen 21.10.)'],
    ['movi_schiff', 'Schiffbau beschleunigt', 'sel', [['ja', 'ja'], ['nein', 'nein']]],
    ['movi_neustart', 'Im Video nachlegen (Autobuilder ab 0.5.53)', 'sel', [['ja', 'ja'], ['nein', 'nein (Video ohne Live-Lauf)']]],
  ]],
  ['Aufwand', [
    ['aufwand_stufe', 'Rechenaufwand', 'sel', [['schnell', 'schnell (≈ ¼ h)'], ['normal', 'normal (≈ 1 h)'], ['gruendlich', 'gründlich (≈ 2–3 h)'], ['eigen', 'eigene Werte (Standard 40/2/20/10)']]],
    ['aufwand_iter', 'iter', 'num', 'nur bei „eigene Werte“'], ['aufwand_rounds', 'rounds', 'num', ''],
    ['aufwand_patience', 'patience', 'num', ''], ['aufwand_kicks', 'kicks', 'num', ''],
  ]],
  ['Startplan', [
    ['seeds', 'Startpläne (Dateien in analyse/sim/)', 'txt', 'z. B. result.json, kolo3-stpl-live1821.json'],
  ]],
  ['Erweitert', [
    ['lager', 'Lager', 'sel', [['', 'Standard (getrennt)'], ['getrennt', 'getrennt'], ['kolopool', 'Kolonien gemeinsam'], ['pool', 'alles gemeinsam']]],
    ['kolominen', 'Minen je Kolonie höchstens', 'txt', 'z. B. 16 oder 16:1 (nur Kolonie 1)'],
    ['kolohilfe', 'Hilfsgebäude Kolonien', 'txt', 'leer = aus · ja = Bauhof bis 5 · constructionfacility:6, infrastructure:2'],
    ['forschort', 'Forschungsort Typ:Faktor', 'txt', 'z. B. JUPL:0.69, heimat:1 (günstigster Planet; Heimat-Labor nur als Voraussetzung) · leer = Heimat'],
    ['versorgung', 'Versorgung', 'sel', [['', 'Standard (voll)'], ['voll', 'voll (100 %)'], ['aus', 'aus (nur Vergleich)']]],
    ['bis', 'Simulieren bis (Stunde oder ISO)', 'txt', 'leer = bis zum Ziel'],
    ['mass', 'Maß', 'sel', [['', 'Standard (Landung)'], ['landung', 'Landung'], ['foerderung', 'Förderung bei „bis“']]],
    ['gewicht', 'Gewicht Förderung E, M, T', 'txt', 'z. B. 1, 2, 4 (Händlerkurs) · leer = jede Einheit gleich · nur mit Maß Förderung'],
    ['kololive', 'Gelandete Kolonien aus dem Snapshot', 'sel', [['ja', 'übernehmen'], ['nein', 'nicht übernehmen']]],
    ['flugfaktor', 'Flugfaktor SCOL', 'num', 'z. B. 0,043 (geeicht, ≈ 14 min) · leer = Modellwert'],
    ['takt', 'Transport: Flüge je Tag', 'num', 'z. B. 2 (wie Plan 21) · leer = kein Transport · wirkt nur mit getrennten Lagern und Flotte'],
    ['taktlast', 'Transport: Ladung je Strecke', 'num', 'z. B. 47200 (2 PTRN) · leer = 24000'],
    ['taktmod', 'Transport: Flottenmods', 'txt', 'z. B. tempo:-0.5 · laderaum:<s>, tempo:<s> mit −1…1'],
  ]],
];
function slState() {
  if (!S.simlauf) S.simlauf = { form: HZ_SIMPARAMS.toForm(HZ_SIMPARAMS.defaults()), open: false };
  return S.simlauf;
}
function slField([k, label, type, opt], f) {
  const v = f[k] ?? '';
  const ctl = type === 'sel'
    ? `<select data-sl="${k}">${opt.map(([o, t]) => `<option value="${esc(o)}"${o === v ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>`
    : `<input data-sl="${k}" value="${esc(v)}"${type === 'num' ? ' inputmode="decimal"' : ''}${opt ? ` placeholder="${esc(opt)}" title="${esc(opt)}"` : ''}>`;
  return `<label class="f"><span>${esc(label)}</span>${ctl}</label>`;
}
const slSummary = (d, errs) => `<div class="small" style="margin:6px 0">${d.length ? `Abweichend vom Standard: <b>${esc(d.join(' · '))}</b>` : 'Standard-Einstellungen (wie der tägliche Lauf)'}</div>
  ${errs.length ? `<div class="small warn">${errs.map(esc).join('<br>')}</div>` : ''}`;
function simlaufCard(pl, own) {
  const st = slState(), P = HZ_SIMPARAMS.fromForm(st.form), errs = HZ_SIMPARAMS.check(P), d = HZ_SIMPARAMS.diff(P);
  const w = (pl?.work || [])[0], ws = w?.state || {}, age = w ? Date.now() - new Date(w.at) : Infinity;
  const open = (pl?.offen || []).find(q => q.kind !== 'optimierer');
  const lines = [!pl?.now ? 'Stand nicht abrufbar' : !w ? 'Work: kein Lebenszeichen'
    : ws.phase === 'start' && age < 3 * 3600e3 ? `Work: rechnet seit ${dt(w.at)}` : age > 15 * 60e3 ? `Work: aus (zuletzt ${dt(w.at)})` : 'Work: bereit'];
  if (ws.sperre && !/^frei/i.test(ws.sperre)) lines.push(`Sim-Sperre: ${ws.sperre}`);
  if (open) lines.push(`Auftrag ${open.status === 'in_arbeit' ? 'in Arbeit' : 'angefordert'} seit ${dt(open.created_at)}`);
  return `<div class="card"><div class="row between"><h2>Neuer Lauf auf Work</h2>${open ? '<span class="tag">angefordert</span>' : ''}</div>
    <p class="muted small">Work rechnet mit diesen Einstellungen einen Plan. Das Ergebnis erscheint unten als Entwurf (eigene Datei, der tägliche Lauf und der aktive Plan bleiben). Freigeben und starten weiterhin im Cockpit.</p>
    ${lines.map(t => `<div class="small">${esc(t)}</div>`).join('')}
    <div id="slSum">${slSummary(d, errs)}</div>
    ${own ? `<div class="row" style="margin-top:6px;gap:8px"><button id="slGo"${open || errs.length || !pl?.now ? ' disabled' : ''} data-block="${open || !pl?.now ? 1 : ''}">Mit aktuellen Einstellungen rechnen</button>
      <button id="slReset" class="small">Standard</button></div>` : ''}
    <details id="slDet"${st.open ? ' open' : ''} style="margin-top:8px"><summary>Einstellungen</summary>
      ${SL_FIELDS.map(([g, fs]) => `<h3>${esc(g)}</h3><div class="cols2">${fs.map(x => slField(x, st.form)).join('')}</div>`).join('')}
    </details></div>`;
}
function simlaufWire(el, pl) {
  const st = slState(), card = el.querySelector('#slDet')?.closest('.card');
  if (!card) return;
  const redraw = () => { const n = document.createElement('div'); n.innerHTML = simlaufCard(pl, isOwner()); card.replaceWith(n.firstElementChild); simlaufWire(el, pl); };
  card.querySelector('#slDet').addEventListener('toggle', e => { st.open = e.target.open; });
  const upd = () => {
    const P = HZ_SIMPARAMS.fromForm(st.form), errs = HZ_SIMPARAMS.check(P);
    card.querySelector('#slSum').innerHTML = slSummary(HZ_SIMPARAMS.diff(P), errs);
    const go = card.querySelector('#slGo');
    if (go) go.disabled = !!go.dataset.block || errs.length > 0;
  };
  card.querySelectorAll('[data-sl]').forEach(c => c.addEventListener(c.tagName === 'SELECT' ? 'change' : 'input', () => { st.form[c.dataset.sl] = c.value; upd(); }));
  card.querySelector('#slReset')?.addEventListener('click', () => { st.form = HZ_SIMPARAMS.toForm(HZ_SIMPARAMS.defaults()); redraw(); });
  card.querySelector('#slGo')?.addEventListener('click', async () => {
    const P = HZ_SIMPARAMS.fromForm(st.form), d = HZ_SIMPARAMS.diff(P);
    if (!confirm(`Work soll jetzt einen Plan rechnen${d.length ? ` (${d.join(' · ')})` : ' (Standard-Einstellungen)'}.\nDas Ergebnis erscheint als Entwurf unter Pläne; freigeben und starten weiterhin du.\nAnfordern?`)) return;
    try {
      const r = await Cloud.rpc('plan_rechnen', { p_account: S.acc, p_note: d.length ? `Atlas: ${d.join(' · ')}`.slice(0, 300) : 'Atlas', p_params: P });
      toast(r.text || (r.ok ? 'Angefordert' : 'Nicht angefordert'));
      route(true);
    } catch (e) { toast(e.message); }
  });
}

const ATLAS_RUN = p => ['freigegeben', 'aktiv'].includes(p.status);
async function viewPlans(rest = []) {
  if (rest[0] === 'edit' && rest[1]) return viewPlanEdit(rest[1]);
  const acc = `eq.${S.acc}`;
  const [plans, heads, sess, W, homes, pl] = await Promise.all([
    Cloud.q('plans', { account_id: acc, kind: 'eq.build', order: 'created_at.desc', limit: 200,
      select: 'id,kind,source,status,title,note,plan_hash,parent_id,created_at,approved_at,status_at' }),
    Cloud.q('plans', { account_id: acc, kind: 'eq.build', status: 'in.(freigegeben,aktiv)', order: 'approved_at.desc.nullslast', limit: 1, select: 'id,status,title,plan_hash' }),
    loadSessions(),
    loadWissen().catch(() => null),
    S.home?.acc === S.acc ? null : Cloud.q('state_latest', { account_id: acc, kind: 'eq.live', select: 'start:data->start' }).catch(() => []),
    Cloud.rpc('planlauf_status', { p_account: S.acc }).catch(() => null),
  ]);
  if (homes) { const st = homes[0]?.start; S.home = { acc: S.acc, name: st?.planet || '', coords: st?.coords || '' }; }
  if (plans.some(p => !planNo(p.id))) await loadNums(true);
  const head = heads[0];
  if (head && S.planCache?.id !== head.id) S.planCache = { id: head.id, payload: (await Cloud.q('plans', { id: `eq.${head.id}`, select: 'payload' }))[0]?.payload };
  const active = head ? { ...head, payload: S.planCache.payload } : null;
  const [execs, drift] = active ? await Promise.all([
    loadPlanExecs(acc, active.id, active.payload),
    Cloud.rpc('plan_abweichung', { p_plan: active.id }).catch(() => null),
  ]) : [[], null];
  const gains = await draftGains(plans, active, drift).catch(() => ({}));
  const own = isOwner();
  let html = '';
  // Lokale Vorschau (nur localhost): ?testplan=<Fixture> zeigt einen Testplan aus Horiversum/tests/fixtures statt des aktiven
  // Plans (M5: Kolonie-Testplan plan-kolonie); Ausführungen und Lauf bleiben die echten
  const tpn = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && new URLSearchParams(location.search).get('testplan');
  const testPlan = tpn && /^[\w-]+$/.test(tpn) ? await fetch(`${HZ_ROOT}../Horiversum/tests/fixtures/${tpn}.json`).then(r => r.ok ? r.json() : null).catch(() => null) : null;
  const plan = testPlan || active?.payload;
  if (plan?.steps) {
    const holder = sess.devs.find(x => x.holds);
    const hst = holder?.ab?.state?.plan === plan.id ? holder.ab.state : {};
    const sh = planShift(drift);
    // Mehrere Planeten (M5): Kopfzeile Imperium und Reiter Alle / Heimat / je Kolonie / Forschung (global), Nummern global
    const multi = planMulti(plan), tabs = multi ? planTabs(plan, S.home) : null, tab = multi ? planTabCur(tabs) : null;
    const t0 = Date.parse(plan.startTime) + sh * 3600e3;
    const ex = testPlan ? [] : execs;
    html += `<div class="cols2"><div class="card"><div class="row between"><h2>${testPlan ? `Testplan ${esc(tpn)} <span class="tag">lokal</span>` : `${esc(planLabel(active.id))} <span class="tag ${esc(active.status)}">${esc(active.status)}</span>`}</h2>
      <span class="small">${COCKPIT_LINK('#/plaene', '„bis #“, Start/Stopp im Cockpit')}</span></div>
      <p class="small">${esc(tidy(testPlan ? `${plan.created || ''} · id ${plan.id}` : active.title || ''))}</p>${runBody(sess)}
      ${multi ? `<h3>Imperium</h3>${planEmpire(plan, tabs, planStepDone(plan, hst, ex), tau => t0 + tau * 3600e3, Date.now(), !!hst?.colony)}${planTabsHtml(tabs, tab)}`
        : `<div class="small muted" style="margin:4px 0">Planet ${esc((plan.planet || S.home)?.name || 'Heimat')} ${esc((plan.planet || S.home)?.coords || '')} · Forschung gilt für alle Planeten („global“)</div>`}
      ${Math.abs(sh) >= 0.05 ? `<div class="small muted" style="margin:4px 0">Zeiten inkl. Abweichung: ${sh > 0 ? 'Verzug' : 'Vorlauf'} ${esc(hrs(sh))} (reine Planzeit als Tooltip)</div>` : ''}
      <h3>${multi && tab !== 'alle' ? `${esc(tabs.find(t => t.k === tab).t)}: ${plan.steps.filter((s, i) => s[0] !== 's' && planInTab(plan, tab, s, i + 1)).length} von` : 'Alle'} ${plan.steps.length} Planschritte mit Ausführungen</h3>${stepsTable(plan, hst, ex, true, W, tab, sh)}</div>
      <div class="stack">${driftCard(drift, false)}</div></div>`;
  } else html += `<div class="card"><h2>Bauplan</h2><p class="muted">Kein freigegebener Bauplan. Freigeben im Cockpit: ${COCKPIT_LINK('#/plaene', 'Pläne')}</p></div>`;
  const item = p => `<div class="list-item"><div class="row between">
      <span><b>${esc(planLabel(p.id))}</b> <span class="tag">${esc(KIND[p.kind] || p.kind)}</span></span><span class="tag ${esc(p.status)}">${esc(p.status)}</span></div>
      <div class="small">${esc(tidy(p.title || '(ohne Titel)'))}</div>
      ${gains[p.id]?.gain != null ? `<div class="small ${gains[p.id].gain > PLAN_GAIN_MIN ? 'ok' : ''}">Gegen den aktiven Plan: ${esc(gainText(gains[p.id]))}</div>` : ''}
      <div class="muted small">${esc(SRC[p.source] || p.source)} · ${esc(dt(p.created_at))}${p.parent_id ? ` · aus ${esc(planLabel(p.parent_id))}` : ''}${p.approved_at ? ` · freigegeben ${esc(dt(p.approved_at))}` : ''}${p.status !== 'entwurf' && p.status_at ? ` · ${esc(p.status)} ${esc(dt(p.status_at))}` : ''}</div>
      ${planDetails(p)}
      ${own ? `<div class="row between" style="margin-top:6px">${p.plan_hash ? `<a class="small" href="#/plaene/edit/${esc(p.id)}">${['abgebrochen', 'erledigt', 'verworfen'].includes(p.status) ? 'Plan neu starten / ändern' : 'Planschritte ändern (neuer Entwurf)'}</a>` : '<span></span>'}
        ${ATLAS_RUN(p) ? '' : `<button class="danger small" data-del="${esc(p.id)}">Löschen</button>`}</div>` : ''}</div>`;
  html += simlaufCard(pl, own);
  html += `<div class="card"><h2>Alle Baupläne <span class="muted small">${plans.length}, neueste zuerst</span></h2>
    <p class="muted small">Freigeben, Verwerfen und Abbrechen im Cockpit. Hier: ansehen, als neuen Entwurf ändern, nicht laufende löschen (Owner).</p>
    ${plans.length ? plans.map(item).join('') : '<p class="muted">Noch keine Pläne.</p>'}</div>`;
  $('#view').innerHTML = html;
  planTabsWire($('#view'));
  simlaufWire($('#view'), pl);
  $('#view').querySelectorAll('button[data-del]').forEach(b => b.addEventListener('click', () => deletePlan(plans.find(x => x.id === b.dataset.del))));
}

/* ---------- Atlas: Werft/Def (Paket E): Werft-, Verteidigungs- und Sondenpläne mit Vorschau der 8 Plätze (../werft.js) ---------- */
async function viewWerft() {
  const plans = await Cloud.q('plans', { account_id: `eq.${S.acc}`, kind: 'in.(ship,defense,probe)', order: 'created_at.desc', limit: 100,
    select: 'id,kind,source,status,title,note,plan_hash,parent_id,created_at,approved_at,status_at' });
  const item = p => `<div class="list-item"><div class="row between"><span><b>${esc(planLabel(p.id))}</b> <span class="tag">${esc(KIND[p.kind] || p.kind)}</span></span>
      <span class="tag ${esc(p.status)}">${esc(p.status)}</span></div><div class="small">${esc(tidy(p.title || '(ohne Titel)'))}</div>
      <div class="muted small">${esc(SRC[p.source] || p.source)} · ${esc(dt(p.created_at))}${p.approved_at ? ` · freigegeben ${esc(dt(p.approved_at))}` : ''}</div>
      ${planDetails(p)}</div>`;
  const by = k => plans.filter(p => p.kind === k);
  $('#view').innerHTML = `<div class="card"><h2>Werft, Verteidigung, Sonden</h2><p class="muted small">Pläne aus analyse/werft_plan.js; freigeben im Cockpit wie jeden Entwurf. Ausführer folgen mit Paket F (doku/stand/werft-def.md). „Schritte und Auftragsliste“ aufklappen zeigt die 8 Plätze.</p></div>
    <div class="cols2">${['ship', 'defense', 'probe'].map(k => `<div class="card"><h2>${esc(KIND[k])}</h2>${by(k).length ? by(k).map(item).join('') : '<p class="muted small">Keine.</p>'}</div>`).join('')}</div>`;
}
