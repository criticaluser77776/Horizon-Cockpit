'use strict';
/* Kompendium im Cockpit (Nutzer 14.10.2026, ersetzt den Reiter „Wissen“ und das Kompendium-Artifact).
   Unterreiter: Bauplan · Spielmechanik · Planer · Gebäude · Forschung · Schlüsselforschungen (#/wissen/<unter>/<arg>).
   Quellen: Spieldaten horizon-data.json (öffentlich, loadWissen in app.js); Bauplan aus den Plänen in Supabase (aktiver
   Plan, Umschalter auf den neuesten Entwurf) mit Live-Stand aus state_latest; Texte (Mechanik, Annahmen, Langfristziel)
   aus der Tabelle „wissen“ – nicht in der öffentlichen Web-App (Quelle analyse/kompendium-texte.json, tools/deploy_wissen.py).
   Läuft vor app.js; nutzt zur Laufzeit dessen Helfer ($, esc, fmt, Cloud, S, loadWissen). Logik aus analyse/kompendium.template.html. */
(function () {
  const TZ = { timeZone: 'Europe/Berlin' };
  const SUBS = [['bauplan', 'Bauplan'], ['mechanik', 'Spielmechanik'], ['planer', 'Planer'], ['gebaeude', 'Gebäude'],
    ['forschung', 'Forschung'], ['schluessel', 'Schlüsselforschungen']];
  const PSUBS = [['aktuell', 'Aktuell (24 h)'], ['scol', 'Kolonieschiff'], ['lang', 'Langfristig'], ['modell', 'Faktoren & Modell']];
  const KIND = { b: 'Gebäude', r: 'Forschung', s: 'Schiff' };
  const K = { sub: 'bauplan', psub: 'aktuell', which: 'aktiv', filter: 'all', done: false, all: false, curB: 'metalmine', curR: 'physics' };
  let W = null;          // { B, R } Spieldaten
  let REV = null;        // Rückwärts-Index: was schaltet X frei
  let HAVE = {};         // Planer: eigener Stand (nur dieser Browser)
  try { HAVE = JSON.parse(localStorage.getItem('hz-have') || '{}') || {}; } catch { HAVE = {}; }
  const saveHave = () => { try { localStorage.setItem('hz-have', JSON.stringify(HAVE)); } catch { /* egal */ } };

  // ---------- Helfer ----------
  // Text aus der Tabelle „wissen“: escapen, nur <b>, <sup>, <sub> wieder zulassen (deploy_wissen.py prüft dasselbe)
  const rich = s => esc(s).replace(/&lt;(\/?)(b|sup|sub)&gt;/g, '<$1$2>');
  const obj = (k, id) => (k === 'b' ? W.B : k === 'r' ? W.R : null)?.[id];
  const kindTag = k => `<span class="kind ${k}">${KIND[k] || k}</span>`;
  const nameLink = (k, id) => { const o = obj(k, id); return o ? `<button class="link" type="button" data-open="${k}:${esc(id)}">${esc(o.n)}</button>` : esc(id); };
  const kv = o => Object.entries(o || {}).map(([k, v]) => `${esc(k)} ${fmt(v, 1)}`).join(' · ') || '–';
  const hDur = h => { if (!isFinite(h)) return '–'; let s = Math.round(h * 3600); const d = Math.floor(s / 86400); s %= 86400;
    const p = n => String(n).padStart(2, '0'); return `${d}:${p(Math.floor(s / 3600))}:${p(Math.floor(s % 3600 / 60))}:${p(s % 60)}`; };
  const hrs = h => h < 1 ? Math.round(h * 60) + ' min' : fmt(Math.round(h * 10) / 10, 1) + ' h';
  const days = h => fmt(Math.round(h / 24 * 10) / 10, 1) + ' Tage';
  const res3 = c => `<td class="num e">${fmt(c[0])}</td><td class="num m">${fmt(c[1])}</td><td class="num t">${fmt(c[2])}</td>`;

  function reqsAt(o, lvl) {
    const m = new Map();
    for (const [a, , rs] of o.q) if (a <= lvl) for (const [k, id, l] of rs) if (k === 'b' || k === 'r') { const key = k + ':' + id; m.set(key, Math.max(m.get(key) || 0, l)); }
    return m;
  }
  function rCost(id, l) { const o = W.R[id]; if (!o?.k) return [0, 0, 0]; const m = Math.pow(o.c === 'Allianzforschung' ? 2.5 : 1.5, l - 1); return o.k.map(x => Math.floor(x * m)); }
  function bCost(id, l) { const e = W.B[id]?.L[l]; if (!e) return [0, 0, 0, 0]; const c = e[2]; return [c.Eisenerz || 0, c.Mineral || 0, c.Treibstoff || 0, c.Bauplatz || 0]; }
  const PROD = { b: 'Gebäude', r: 'Forschung' };
  // Leistung aus dem eingetragenen Stand; Hauptquartier mindestens Stufe 1. Labor-Formel aus dem Wiki.
  function autoPower(k) {
    const lv = key => HAVE[key] || 0; const own = { ...HAVE }; if (!own['b:headquarter']) own['b:headquarter'] = 1; let s = 0;
    for (const [key, l] of Object.entries(own)) {
      const [kk, id] = key.split(':'); if (kk !== 'b' || !W.B[id]) continue;
      const e = W.B[id].L[Math.min(l, W.B[id].f)]; let v = e?.[4]?.[PROD[k]] || 0;
      if (k === 'r' && id === 'researchcenter' && v) { const ph = Math.max(1, lv('r:physics')), ct = Math.max(1, lv('r:computertech')); v *= (1 + 0.05 * (ph - 1)) * (1 + (1 + (ct - 1) / 30) * lv('b:computercenter') / 6); }
      s += v;
    }
    return s || 360;
  }
  function power(k) { let v = 0; try { v = +localStorage.getItem('hz-k-' + k) || 0; } catch { /* egal */ } return v > 0 ? v : autoPower(k); }
  function costRange(k, id, from, to) { const s = [0, 0, 0]; for (let l = from; l <= to; l++) { const c = k === 'b' ? bCost(id, l) : rCost(id, l); s[0] += c[0]; s[1] += c[1]; s[2] += c[2]; } return s; }

  async function loadTexts() {
    if (S.kTexts) return S.kTexts;
    const r = await Cloud.q('wissen', { key: 'eq.kompendium', select: 'content,version,updated_at' }).catch(() => []);
    return (S.kTexts = r[0] || null);
  }
  async function loadSnap() {
    if (S.snap?.acc === S.acc && S.snap.data) return S.snap.data;
    const r = (await Cloud.q('state_latest', { account_id: `eq.${S.acc}`, kind: 'eq.live', select: 'collected_at,data' }).catch(() => []))[0];
    if (r) S.snap = { acc: S.acc, at: r.collected_at, data: r.data };
    return r?.data || null;
  }
  // aktiver Bauplan + neuester Entwurf (Inhalt je Plan nur einmal laden)
  async function loadPlans() {
    const acc = `eq.${S.acc}`, sel = 'id,status,title,plan_hash,created_at,approved_at';
    const [act, dr] = await Promise.all([
      Cloud.q('plans', { account_id: acc, kind: 'eq.build', status: 'in.(freigegeben,aktiv)', order: 'approved_at.desc.nullslast', limit: 1, select: sel }),
      Cloud.q('plans', { account_id: acc, kind: 'eq.build', status: 'eq.entwurf', order: 'created_at.desc', limit: 1, select: sel }),
    ]);
    S.kPlans ??= {};
    const out = {};
    for (const [w, p] of [['aktiv', act[0]], ['entwurf', dr[0]]]) {
      if (!p) continue;
      if (!S.kPlans[p.id]) S.kPlans[p.id] = (await Cloud.q('plans', { id: `eq.${p.id}`, select: 'payload' }))[0]?.payload;
      if (S.kPlans[p.id]?.steps?.length) out[w] = { ...p, M: model(S.kPlans[p.id]) };
    }
    return out;
  }

  // ---------- Bauplan: Plan-Nutzlast → Modell ----------
  // Nutzlast (build_autobuilder.js): steps [art, id, stufe, start h, ende h, name, [E, M, T]], factors [[t h, {typ: Anteil}]] (Änderungen);
  // ab 14.10.2026 auch at100 (h mit festen 100 %), lb (Untergrenze h), pflicht ["art:typ:stufe"] – ältere Pläne ohne diese Felder
  function model(p) {
    const req = Array.isArray(p.pflicht) ? new Set(p.pflicht) : null;
    const s = p.steps.map((x, i) => ({ i, k: x[0], id: x[1], l: x[2], t0: x[3], t1: x[4], name: x[5] || '', c: x[6] || [0, 0, 0],
      req: req && x[0] !== 's' ? req.has(`${x[0]}:${x[1]}:${x[2]}`) : null }));
    const hours = p.hours || Math.max(...s.map(x => x.t1));
    const f = []; let cur = {};
    (p.factors || []).forEach(([t, ch], j, a) => { cur = { ...cur, ...ch }; const to = j + 1 < a.length ? a[j + 1][0] : hours; if (to > t) f.push([t, to, { ...cur }]); });
    return { startTime: p.startTime, hours, s, f, id: p.id, created: p.created, at100: p.at100, lb: p.lb, hasReq: !!req };
  }
  // Live-Stand: erledigte und laufende Schritte, Verschiebung in h (positiv = Verzug); wie liveState in build_page.js
  function liveOf(M, snap) {
    if (!snap?.collectedAt) return null;
    const t0 = Date.parse(M.startTime);
    if (Date.parse(snap.collectedAt) <= t0 + 60e3) return null;
    const snapH = (Date.parse(snap.collectedAt) - t0) / 3.6e6;
    const items = { b: snap.buildings?.items || [], r: snap.research?.items || [] };
    const lv = (k, id) => items[k].find(x => x.type === id) || { level: 0 };
    const done = new Set(), running = {}; let late = null, open = null;
    for (const st of M.s) {
      if (st.k === 's') continue;
      const it = lv(st.k, st.id);
      if (it.inProgress && it.level === st.l) { running[st.i] = it.remaining || 0; const d = snapH + (it.remaining || 0) / 3600 - st.t1; late = late == null ? d : Math.max(late, d); }
      else if (it.level >= st.l) done.add(st.i);
      else if (open == null) open = st.t0;
    }
    return { at: snap.collectedAt, offset: late != null ? late : open != null ? snapH - open : 0, done, running };
  }
  const atPlan = (M, h) => new Date(Date.parse(M.startTime) + h * 3.6e6);
  const fmtT = d => d.toLocaleString('de-DE', { ...TZ, weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const stepName = (st) => st.k === 's' ? 'Kolonieschiff (SCOL)' : st.k === 'r' ? `${W.R[st.id]?.n || st.id} ${st.l}` : `${st.name.replace(/\s+\d+$/, '') || W.B[st.id]?.n || st.id} ${st.l}`;
  const stepLink = st => st.k === 's' ? '<b>Kolonieschiff (SCOL)</b>'
    : `<button class="link" type="button" data-open="${st.k}:${esc(st.id)}">${esc(stepName(st).replace(/\s+\d+$/, ''))}</button> <span class="num">${st.l}</span>`;
  const bName = id => W.B[id]?.n || id;

  async function viewBauplan(T) {
    const P = await loadPlans();
    if (!P[K.which]) K.which = P.aktiv ? 'aktiv' : 'entwurf';
    const cur = P[K.which];
    const pick = Object.entries(P).map(([w, p]) => `<button type="button" data-which="${w}" aria-pressed="${w === K.which}">${w === 'aktiv' ? 'Aktiver Plan' : 'Neuester Entwurf'}
      <span class="small muted">${esc(p.plan_hash || '')} · ${hrs(p.M.hours)}</span></button>`).join('');
    const head = `<div class="card"><div class="row between"><div class="kseg" id="kWhich">${pick || ''}</div>
      <nav class="kseg" id="kPsub">${PSUBS.map(([v, l]) => `<button type="button" data-psub="${v}" aria-pressed="${v === K.psub}">${l}</button>`).join('')}</nav></div>
      <p class="small muted" id="kLive"></p></div>`;
    if (!cur && K.psub !== 'lang') {
      $('#kbody').innerHTML = head + '<div class="card"><p class="muted">Noch kein Bauplan im Cockpit (weder aktiv noch als Entwurf).</p></div>';
      return bindBauplan();
    }
    const M = cur?.M, LV = M ? liveOf(M, await loadSnap()) : null, OFF = LV ? LV.offset : 0;
    let body = '';
    if (K.psub === 'aktuell') body = aktuell(M, LV, OFF);
    else if (K.psub === 'scol') body = scol(M, OFF, cur);
    else if (K.psub === 'lang') body = T ? `<div class="card"><h2>${rich(T.lang.h)}</h2><p class="small muted">${rich(T.lang.note)}</p>
      <ul class="kul">${T.lang.items.map(x => `<li>${rich(x)}</li>`).join('')}</ul></div>` : noTexts();
    else body = modell(M, OFF, T);
    $('#kbody').innerHTML = head + body;
    if (M) $('#kLive').innerHTML = LV ? `Zeiten nach dem Live-Stand vom <b>${esc(fmtT(new Date(LV.at)))}</b>: ${LV.offset >= 0 ? 'Verzug' : 'Vorsprung'} <b>${hrs(Math.abs(LV.offset))}</b> gegenüber dem Optimierer-Lauf vom ${esc(fmtT(atPlan(M, 0)))}; alle folgenden Zeiten sind verschoben.${K.which === 'entwurf' ? ' Der Entwurf läuft noch nicht – Stufen, die live schon erreicht sind, zählen trotzdem als erledigt.' : ''}`
      : `Zeiten laut Optimierer-Lauf vom ${esc(fmtT(atPlan(M, 0)))}; noch kein neuerer Live-Stand.`;
    bindBauplan(M, LV, OFF);
  }
  function bindBauplan() {
    $('#kWhich')?.addEventListener('click', e => { const b = e.target.closest('[data-which]'); if (b) { K.which = b.dataset.which; renderSub(); } });
    $('#kPsub').addEventListener('click', e => { const b = e.target.closest('[data-psub]'); if (b) { K.psub = b.dataset.psub; setHash(); renderSub(); } });
    $('#kFilter')?.addEventListener('click', e => { const b = e.target.closest('[data-f]'); if (b) { K.filter = b.dataset.f; renderSub(); } });
    $('#kDone')?.addEventListener('click', () => { K.done = !K.done; renderSub(); });
    $('#kAll')?.addEventListener('click', () => { K.all = !K.all; renderSub(); });
  }
  // Ebene 1: Aufträge und Faktorwechsel nach Zeit, Linie „Jetzt“, erledigte ausgeblendet, nur die nächsten 24 h
  function aktuell(M, LV, OFF) {
    const at = h => atPlan(M, h + OFF);
    const nowH = (Date.now() - Date.parse(M.startTime)) / 3.6e6 - OFF;
    const LD = LV?.done || new Set(), LR = LV?.running || {};
    const rows = M.s.map(s => ({ t: s.i in LR ? Math.min(s.t0, nowH - 1e-6) : s.t0, o: 1, s }));
    let prev = {};
    M.f.forEach(x => { const ch = Object.entries(x[2]).filter(([id, v]) => Math.round((prev[id] ?? 1) * 100) !== Math.round(v * 100)).map(([id, v]) => [id, prev[id] ?? 1, v]); prev = x[2]; if (ch.length) rows.push({ t: x[0], o: 0, ch }); });
    rows.sort((a, b) => a.t - b.t || a.o - b.o || (a.s?.i ?? 0) - (b.s?.i ?? 0));
    const lastFac = rows.filter(r => r.ch && r.t <= nowH).pop();
    const past = r => r.s ? LD.has(r.s.i) || (!(r.s.i in LR) && r.s.t1 > 0 && r.s.t1 <= nowH) : r.t <= nowH && r !== lastFac;
    const pct = v => Math.round(v * 100) + ' %';
    const hm = d => d.toLocaleTimeString('de-DE', { ...TZ, hour: '2-digit', minute: '2-digit' });
    const f = K.filter;
    let curDay = null, hidden = 0, later = 0, nowDone = !(nowH >= 0 && nowH <= M.hours), html = '';
    for (const r of rows) {
      if (r.s && f !== 'all' && r.s.k !== f && r.s.k !== 's') continue;
      if (r.ch && f === 'r') continue;
      if (!K.done && past(r)) { if (r.s) hidden++; continue; }
      if (!K.all && r.t > nowH + 24) { if (r.s) later++; continue; }
      if (!nowDone && r.t > nowH) { nowDone = true; html += `<tr class="know"><td colspan="7">Jetzt · ${esc(hm(new Date()))}</td></tr>`; }
      const d = at(r.t).toLocaleDateString('de-DE', { ...TZ, weekday: 'long', day: '2-digit', month: 'long' });
      if (d !== curDay) { curDay = d; html += `<tr class="kday"><td colspan="7">${esc(d)}</td></tr>`; }
      const tm = r.s && r.s.i in LR ? 'läuft bis ' + esc(hm(new Date(Date.parse(LV.at) + LR[r.s.i] * 1000))) : esc(hm(at(r.t)));
      if (r.ch) { html += `<tr class="kfac"><td></td><td class="num">${tm}</td><td colspan="5">⚙ ${r.ch.map(([id, o, v]) => `${esc(bName(id))} ${pct(o)} → <b>${pct(v)}</b>`).join(', ')}</td></tr>`; continue; }
      const s = r.s;
      html += `<tr${LD.has(s.i) ? ' class="kdone"' : ''}><td class="num">${s.i + 1}</td><td class="num">${tm}</td><td>${s.k === 's' ? '<span class="kind">Schiff</span>' : kindTag(s.k)} ${stepLink(s)}
        <div class="small muted">Dauer ${hrs(s.t1 - s.t0)}${s.req == null ? '' : s.req ? ' · <span class="pill req">Pflicht</span>' : ' · <span class="pill opt">Investition</span>'}</div></td>${res3(s.c)}</tr>`;
    }
    const fb = (v, l) => `<button type="button" data-f="${v}" aria-pressed="${f === v}">${l}</button>`;
    return `<div class="card"><h2>Die nächsten 24 Stunden</h2>
      <p class="small muted">Erledigte Aufträge sind ausgeblendet, „Jetzt“ zeigt die Uhrzeit im Plan. ⚙ = Änderung der Betriebsfaktoren (der Autobuilder stellt sie vor dem nächsten Auftrag ein, live nach der Faktor-Regel).</p>
      <div class="row"><div class="kseg" id="kFilter">${fb('all', 'Alle')}${fb('b', 'Gebäude')}${fb('r', 'Forschung')}</div>
      <button type="button" id="kDone" aria-pressed="${K.done}">${K.done ? 'Erledigte ausblenden' : `Erledigte zeigen (${hidden})`}</button>
      <button type="button" id="kAll" aria-pressed="${K.all}">${K.all ? 'nur 24 h' : `ganzer Plan (+${later})`}</button></div>
      <div class="scroll"><table class="ktbl"><thead><tr><th class="num">#</th><th class="num">Start</th><th>Auftrag</th><th class="num e">Erz</th><th class="num m">Mineral</th><th class="num t">Treibst.</th></tr></thead>
      <tbody>${html || '<tr><td colspan="6" class="muted">Nichts in diesem Zeitraum.</td></tr>'}</tbody></table></div></div>`;
  }
  // Ebene 2: Kennzahlen + Zeitleiste bis zum SCOL
  function scol(M, OFF, cur) {
    const at = h => atPlan(M, h + OFF);
    const nb = M.s.filter(s => s.k === 'b').length, nr = M.s.filter(s => s.k === 'r').length;
    const ship = M.s.find(s => s.k === 's');
    const tile = (l, v, sub) => `<div class="ktot"><span>${l}</span><b>${v}</b>${sub ? `<div class="small muted">${sub}</div>` : ''}</div>`;
    const lanes = [['b', 'Baustelle'], ['r', 'Forschung'], ['s', 'Werft']], Wd = 1100, L = 86, H = 26, top = 22, X = h => L + (Wd - L - 8) * h / M.hours;
    let svg = `<svg viewBox="0 0 ${Wd} ${top + lanes.length * H + 8}" role="img" aria-label="Zeitleiste der Bau- und Forschungsaufträge">`;
    for (let d = 0; d <= M.hours; d += 24) svg += `<line class="grid" x1="${X(d)}" x2="${X(d)}" y1="${top - 4}" y2="${top + lanes.length * H}"/><text x="${X(d) + 3}" y="12">Tag ${d / 24 + 1}</text>`;
    lanes.forEach(([k, n], li) => {
      const y = top + li * H; svg += `<text class="lane" x="4" y="${y + H / 2 + 4}">${n}</text>`;
      for (const s of M.s) if (s.k === k) { const x = X(s.t0), w = Math.max(1, X(s.t1) - x), cls = k === 's' ? 's' : !M.hasReq ? k : s.req ? 'req' : 'opt';
        svg += `<rect class="${cls}" x="${x}" y="${y + 3}" width="${w}" height="${H - 10}" rx="1"><title>${esc(stepName(s))}: ${esc(fmtT(at(s.t0)))} → ${esc(fmtT(at(s.t1)))} (${hrs(s.t1 - s.t0)})</title></rect>`; }
    });
    return `<div class="card"><h2>Schnellster Weg zum ersten Kolonieschiff</h2>
      <p class="small muted">${esc(cur.title || '')} · Plan-id ${esc(M.id || cur.plan_hash || '')} · Optimierer-Lauf ab dem Live-Stand vom ${esc(fmtT(atPlan(M, 0)))}. Der Plan führt alle Voraussetzungen für Kolonieschiff, Raumhafen 1 und Hauptquartier 8 aus, dazu Investitionen in Produktion, Lager und Versorgung.</p>
      <div class="ktots">${tile('Gesamtdauer', days(M.hours), hrs(M.hours))}${tile('Kolonieschiff fertig', esc(fmtT(at(ship ? ship.t1 : M.hours))), OFF ? `nach Live-Stand (${OFF >= 0 ? '+' : '−'}${hrs(Math.abs(OFF))})` : '')}${M.at100 ? tile('Mit festen 100 %', hrs(M.at100), 'Faktoren sparen ' + hrs(M.at100 - M.hours)) : ''}${M.lb ? tile('Untergrenze', hrs(M.lb), 'Relaxation, nicht erreichbar') : ''}${tile('Aufträge', `${nb} + ${nr}`, 'Gebäude + Forschung')}${M.hasReq ? tile('Pflicht', `${M.s.filter(s => s.req).length} von ${nb + nr}`, 'Voraussetzung für SCOL / HQ 8') : ''}</div>${M.hasReq ? '' : '<p class="small muted">Pflicht/Investition, „mit festen 100 %“ und Untergrenze stehen erst in Plänen ab dem 14.10.2026 (neuer Export).</p>'}</div>
      <div class="card"><h3>Zeitleiste</h3><div class="klegend">${M.hasReq ? '<span><i class="req"></i>Pflicht (Voraussetzung für SCOL / HQ 8)</span><span><i class="opt"></i>Investition (Produktion, Lager, Versorgung)</span>' : '<span><i class="b"></i>Gebäude</span><span><i class="r"></i>Forschung</span>'}<span><i class="s"></i>Kolonieschiff</span></div>
      <div class="kgantt">${svg}</svg></div><p class="small muted">Für Details auf einen Balken zeigen (am PC) oder die Tabelle unter „Aktuell“ → „ganzer Plan“ nutzen.</p></div>`;
  }
  function modell(M, OFF, T) {
    const at = h => atPlan(M, h + OFF);
    const fr = M.f.filter(f => Object.values(f[2]).some(v => v < 1));
    return `<div class="card"><h2>Betriebsfaktoren</h2>${T ? `<p class="small muted">${rich(T.faktoren)}</p>` : ''}
      <div class="scroll"><table class="ktbl"><thead><tr><th>Von</th><th>Bis</th><th class="num">Dauer</th><th>Einstellung (alles andere 100 %)</th></tr></thead><tbody>
      ${fr.map(f => `<tr><td class="num">${esc(fmtT(at(f[0])))}</td><td class="num">${esc(fmtT(at(f[1])))}</td><td class="num">${hrs(f[1] - f[0])}</td>
        <td>${Object.entries(f[2]).filter(([, v]) => v < 1).map(([id, v]) => `${esc(bName(id))} <b>${Math.round(v * 100)} %</b>`).join(', ')}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Keine Drosselung im Plan.</td></tr>'}
      </tbody></table></div></div>
      ${T ? `<div class="card"><h2>Modell und Annahmen</h2><ul class="kul">${T.assume.map(a => `<li>${rich(a)}</li>`).join('')}</ul></div>` : noTexts()}`;
  }
  const noTexts = () => '<div class="card"><p class="muted">Texte noch nicht in Supabase (Tabelle „wissen“). Sie kommen per GitHub Action „Kompendium-Texte deployen“.</p></div>';

  // ---------- Spielmechanik ----------
  function viewMechanik(T) {
    if (!T) { $('#kbody').innerHTML = noTexts(); return; }
    const a = T.aufbau;
    $('#kbody').innerHTML = `<div class="kfacts">${T.facts.map(x => `<div class="card"><b>${rich(x.t)}</b><p class="small muted">${rich(x.p)}</p></div>`).join('')}</div>
      <div class="kmech">${T.mech.map(c => `<div class="card"><h2>${rich(c.h)}</h2>${(c.formula || []).map(x => `<div class="kformula">${rich(x)}</div>`).join('')}
        <ul class="kul">${c.items.map(x => `<li>${rich(x)}</li>`).join('')}</ul></div>`).join('')}</div>
      <div class="card"><h2>${rich(a.h)}</h2><p class="small muted">${rich(a.note)}</p><ol class="kul">${a.steps.map(x => `<li>${rich(x)}</li>`).join('')}</ol>
        ${a.goto ? `<p><button type="button" data-goto="${esc(a.goto)}">Im Planer öffnen</button></p>` : ''}</div>
      <p class="small muted">${rich(T.quellen)}</p>`;
  }

  // ---------- Planer ----------
  function need(k, id, lvl) {
    const m = new Map(), stack = [[k, id, lvl]];
    while (stack.length) { const [k2, i2, l2] = stack.pop(); const key = k2 + ':' + i2; if ((m.get(key) || 0) >= l2) continue; m.set(key, l2);
      const o = obj(k2, i2); if (!o) continue; for (const [rk, rl] of reqsAt(o, l2)) { const [a, b] = rk.split(':'); stack.push([a, b, rl]); } }
    return m;
  }
  function depthOf(key, nd, memo, seen) {
    if (memo.has(key)) return memo.get(key); if (seen.has(key)) return 0; seen.add(key);
    const [k, i] = key.split(':'); const o = obj(k, i); let d = 0;
    if (o) for (const [rk] of reqsAt(o, nd.get(key))) if (rk !== key && nd.has(rk) && (HAVE[rk] || 0) < nd.get(rk)) d = Math.max(d, 1 + depthOf(rk, nd, memo, seen));
    seen.delete(key); memo.set(key, d); return d;
  }
  function target() { try { const s = JSON.parse(localStorage.getItem('hz-target') || 'null'); if (s && obj(...s[0].split(':'))) return s; } catch { /* egal */ } return ['b:shipyard', 1]; }
  function setTarget(key, lvl) { try { localStorage.setItem('hz-target', JSON.stringify([key, lvl])); } catch { /* egal */ } }
  function viewPlaner() {
    const groups = {};
    for (const [id, o] of Object.entries(W.B)) (groups['Gebäude · ' + o.c] ??= []).push(['b:' + id, o.n]);
    for (const [id, o] of Object.entries(W.R)) (groups['Forschung · ' + o.c] ??= []).push(['r:' + id, o.n]);
    const [tk, tl] = target();
    const pw = k => { try { return localStorage.getItem('hz-k-' + k) || ''; } catch { return ''; } };
    $('#kbody').innerHTML = `<div class="card"><div class="row kplanbar">
      <label class="f"><span>Ziel</span><select id="kpk">${Object.entries(groups).map(([g, items]) => `<optgroup label="${esc(g)}">${items.sort((a, b) => a[1].localeCompare(b[1], 'de'))
        .map(([v, n]) => `<option value="${v}"${v === tk ? ' selected' : ''}>${esc(n)}</option>`).join('')}</optgroup>`).join('')}</select></label>
      <label class="f"><span>Stufe</span><input id="kpl" type="number" min="1" value="${tl}" style="width:5em"></label>
      <label class="f"><span>Bauleistung/h</span><input id="kbl" type="number" min="1" step="any" value="${esc(pw('b'))}" style="width:8em"></label>
      <label class="f"><span>Forschungsleistung/h</span><input id="kfl" type="number" min="1" step="any" value="${esc(pw('r'))}" style="width:8em"></label></div>
      <div class="row"><button type="button" id="kLiveHave">Live-Stand übernehmen</button><button type="button" id="kClear">Stand zurücksetzen</button></div>
      <p class="small muted">Dauer = (Eisenerz + Minerale + Treibstoff) ÷ Leistung pro Stunde. Leere Leistungsfelder: berechnet aus dem Stand (Bauleistung aus Hauptquartier bis Stufe 7, Bauhof, Himmelswächter; Forschung aus Forschungseinrichtung mit Physik, Computertechnik, Computerzentrum). „Habe“ = Stufe, die du schon hast (nur in diesem Browser gespeichert). Ebene 0 hat keine offenen Voraussetzungen aus der Liste, Ebene 1 braucht etwas aus Ebene 0 usw.</p>
      <div class="ktots" id="kptot"></div></div><div class="card"><div class="scroll"><table class="ktbl" id="kptable"></table></div></div>`;
    const render = () => {
      const [k, id] = $('#kpk').value.split(':'); const o = obj(k, id); const lvl = Math.min(Math.max(1, +$('#kpl').value || 1), o.f); $('#kpl').max = o.f;
      setTarget($('#kpk').value, lvl);
      const nd = need(k, id, lvl), memo = new Map();
      const rows = [...nd].map(([key, l]) => { const [kk, ii] = key.split(':'); const have = Math.min(HAVE[key] || 0, l);
        return { key, k: kk, id: ii, l, have, c: costRange(kk, ii, have + 1, l), d: depthOf(key, nd, memo, new Set()), done: have >= l }; });
      rows.sort((a, b) => a.done - b.done || a.d - b.d || (a.k === b.k ? 0 : a.k === 'r' ? -1 : 1) || obj(a.k, a.id).n.localeCompare(obj(b.k, b.id).n, 'de'));
      const p = { b: power('b'), r: power('r') };
      $('#kbl').placeholder = fmt(autoPower('b')) + ' (auto)'; $('#kfl').placeholder = fmt(autoPower('r')) + ' (auto)';
      const tot = [0, 0, 0], time = { b: 0, r: 0 }; let steps = 0, open = 0;
      for (const r of rows) { r.h = (r.c[0] + r.c[1] + r.c[2]) / p[r.k]; time[r.k] += r.h; tot[0] += r.c[0]; tot[1] += r.c[1]; tot[2] += r.c[2]; steps += r.l - r.have; if (!r.done) open++; }
      const tile = (l, v, cls = '') => `<div class="ktot"><span class="${cls}">${l}</span><b>${v}</b></div>`;
      $('#kptot').innerHTML = tile('Offene Einträge', `${open} / ${rows.length}`) + tile('Ausbauschritte', fmt(steps)) + tile('Eisenerz', fmt(tot[0]), 'e') + tile('Minerale', fmt(tot[1]), 'm')
        + tile('Treibstoff', fmt(tot[2]), 't') + tile('Bauzeit', hDur(time.b)) + tile('Forschungszeit', hDur(time.r));
      let html = '<thead><tr><th>Name</th><th class="num">Habe</th><th class="num">Ziel</th><th class="num e">Erz</th><th class="num m">Mineral</th><th class="num t">Treibst.</th><th class="num">Dauer</th></tr></thead><tbody>';
      let grp = null;
      for (const r of rows) {
        const g = r.done ? 'Erledigt' : 'Ebene ' + r.d + (r.d === 0 ? ' · sofort möglich' : '');
        if (g !== grp) { grp = g; html += `<tr class="kday"><td colspan="7">${g}</td></tr>`; }
        html += `<tr${r.done ? ' class="kdone"' : ''}><td>${kindTag(r.k)} ${nameLink(r.k, r.id)}${r.key === k + ':' + id ? ' <span class="small muted">(Ziel)</span>' : ''}</td>
          <td class="num"><input type="number" min="0" max="${obj(r.k, r.id).f}" value="${HAVE[r.key] || 0}" data-have="${r.key}" style="width:4.5em" aria-label="Habe ${esc(obj(r.k, r.id).n)}"></td>
          <td class="num">${r.l}</td>${res3(r.c)}<td class="num">${hDur(r.h)}</td></tr>`;
      }
      $('#kptable').innerHTML = html + '</tbody>';
    };
    $('#kpk').addEventListener('change', () => { $('#kpl').value = 1; render(); });
    $('#kpl').addEventListener('input', render);
    for (const [sel, k] of [['#kbl', 'b'], ['#kfl', 'r']]) $(sel).addEventListener('input', e => { try { localStorage.setItem('hz-k-' + k, e.target.value); } catch { /* egal */ } render(); });
    $('#kptable').addEventListener('change', e => { const key = e.target.dataset.have; if (!key) return; const v = Math.max(0, +e.target.value || 0); if (v) HAVE[key] = v; else delete HAVE[key]; saveHave(); render(); });
    $('#kClear').addEventListener('click', () => { HAVE = {}; saveHave(); render(); });
    $('#kLiveHave').addEventListener('click', async () => {
      const snap = await loadSnap();
      if (!snap) return toast('Kein Live-Stand vorhanden');
      HAVE = {};
      for (const [k, list] of [['b', snap.buildings?.items], ['r', snap.research?.items]]) for (const x of list || []) {
        const l = x.inProgress ? x.levelDone ?? x.level - 1 : x.level; if (x.type && l > 0) HAVE[`${k}:${x.type}`] = l; }
      saveHave(); render(); toast(`Live-Stand vom ${fmtT(new Date(snap.collectedAt))} übernommen`);
    });
    render();
  }

  // ---------- Gebäude, Forschung ----------
  function reqBlocks(o) {
    if (!o.q.length) return '<p class="small muted">Keine Voraussetzungen.</p>';
    return o.q.map(([a, b, rs]) => `<div class="kreq"><div class="num small muted">Stufe ${a === b ? a : a + '–' + b}</div><div class="kchips">${rs.map(([k, id, l]) => `<span class="kchip">${kindTag(k)} ${nameLink(k, id)} <b>${l}</b></span>`).join('')}</div></div>`).join('');
  }
  function unlocks(key) {
    const list = REV[key]; if (!list) return '<p class="small muted">Wird nirgends als Voraussetzung geführt.</p>';
    const by = {}; for (const u of list) (by[u.l] ??= []).push(u);
    return Object.keys(by).map(Number).sort((a, b) => a - b).map(l => `<div class="kreq"><div class="num small muted">ab Stufe ${l}</div><div class="kchips">${by[l].map(u => `<span class="kchip">${kindTag(u.k)} ${nameLink(u.k, u.id)} <b>${u.a === u.b ? u.a : u.a + '–' + u.b}</b></span>`).join('')}</div></div>`).join('');
  }
  const planBtn = (key, f) => `<div class="row"><span class="small muted">Planen bis Stufe</span><input type="number" min="1" max="${f}" value="1" id="kpp" style="width:5em"><button type="button" data-plan="${key}">Im Planer öffnen</button></div>`;
  function viewList(k, arg) {
    const set = k === 'b' ? W.B : W.R;
    if (arg && set[arg]) K[k === 'b' ? 'curB' : 'curR'] = arg;
    const cur = K[k === 'b' ? 'curB' : 'curR'];
    const q = sessionStorage.getItem('hz.kq' + k) || '';
    $('#kbody').innerHTML = `<div class="kwissen"><div class="card"><input class="search" id="kq" placeholder="${k === 'b' ? 'Gebäude' : 'Forschung'} suchen" value="${esc(q)}"><div class="wlist" id="kl"></div></div><div id="kd"></div></div>`;
    const list = f => {
      const t = f.trim().toLowerCase(), groups = {};
      for (const [id, o] of Object.entries(set)) if (!t || o.n.toLowerCase().includes(t) || id.includes(t)) (groups[o.c] ??= []).push([id, o]);
      $('#kl').innerHTML = Object.entries(groups).map(([g, items]) => `<h3>${esc(g)}</h3>${items.map(([id, o]) => `<button type="button" data-open="${k}:${esc(id)}" class="${id === cur ? 'on' : ''}">${esc(o.n)}</button>`).join('')}`).join('') || '<p class="small muted">Nichts gefunden.</p>';
    };
    list(q);
    $('#kq').oninput = e => { sessionStorage.setItem('hz.kq' + k, e.target.value); list(e.target.value); };
    const o = set[cur];
    if (k === 'b') {
      const tiers = new Set(o.q.map(x => x[0])), pb = power('b');
      const rows = o.l.map(([lv, name, c, u, w]) => `<tr${tiers.has(lv) && lv > 1 ? ' class="ktier"' : ''}><td class="num">${lv}</td><td>${esc(name)}</td>${res3([c.Eisenerz || 0, c.Mineral || 0, c.Treibstoff || 0])}
        <td class="num">${hDur(((c.Eisenerz || 0) + (c.Mineral || 0) + (c.Treibstoff || 0)) / pb)}</td><td class="num">${fmt(c.Bauplatz || 0)}</td><td class="small">${kv(u)}</td><td class="small">${kv(w)}</td></tr>`).join('');
      $('#kd').innerHTML = `<div class="card"><h2>${esc(o.n)} <span class="small muted">${esc(o.c)} · Endstufe ${esc(o.f)}</span></h2>${planBtn('b:' + cur, o.f)}</div>
        <div class="card"><h3>Voraussetzungen</h3>${reqBlocks(o)}</div>
        <div class="card"><h3>Stufen</h3>${o.l.length ? `<p class="small muted">Blaue Linie = ab dieser Stufe gelten neue Voraussetzungen. Bauplatz = Änderung zur vorigen Stufe. Bauzeit bei ${fmt(pb)} Bauleistung/h (im Planer einstellbar). Werte bei 100 % Betriebsfaktor.</p>
          <div class="scroll"><table class="ktbl"><thead><tr><th class="num">Stufe</th><th>Name</th><th class="num e">Erz</th><th class="num m">Mineral</th><th class="num t">Treibst.</th><th class="num">Bauzeit</th><th class="num">Platz</th><th>Bedarf</th><th>Wirkung</th></tr></thead><tbody>${rows}</tbody></table></div>`
          : '<p class="small muted">Keine Kostendaten.</p>'}</div>
        <div class="card"><h3>Schaltet frei</h3>${unlocks('b:' + cur)}</div>`;
    } else {
      const tiers = new Set(o.q.map(x => x[0])), pr = power('r'); let cum = 0;
      const rows = Array.from({ length: o.f || 0 }, (_, i) => { const l = i + 1, c = rCost(cur, l); cum += c[0] + c[1] + c[2];
        return `<tr${tiers.has(l) && l > 1 ? ' class="ktier"' : ''}><td class="num">${l}</td>${res3(c)}<td class="num">${hDur((c[0] + c[1] + c[2]) / pr)}</td><td class="num">${fmt(cum)}</td></tr>`; }).join('');
      $('#kd').innerHTML = `<div class="card"><h2>${esc(o.n)} <span class="small muted">${esc(o.c)} · Endstufe ${esc(o.f)}</span></h2>${planBtn('r:' + cur, o.f)}</div>
        <div class="card"><h3>Wirkung</h3><p>${o.w ? esc(o.w) : 'Im Wiki ist keine Wirkung beschrieben.'}</p>${o.c === 'Allianzforschung' ? '' : '<p class="small muted">Stufe 1 hat noch keine Wirkung, die Boni zählen ab Stufe 2.</p>'}</div>
        <div class="card"><h3>Voraussetzungen</h3>${reqBlocks(o)}</div>
        <div class="card"><h3>Schaltet frei</h3>${unlocks('r:' + cur)}</div>
        <div class="card"><h3>Kosten je Stufe</h3><p class="small muted">Ohne Spieler-Rabatt. Dauer bei ${fmt(pr)} Forschungsleistung/h (im Planer einstellbar). Summe = alle drei Rohstoffe von Stufe 1 bis hier.</p>
          <div class="scroll"><table class="ktbl"><thead><tr><th class="num">Stufe</th><th class="num e">Erz</th><th class="num m">Mineral</th><th class="num t">Treibst.</th><th class="num">Dauer</th><th class="num">Summe</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
    }
  }

  // ---------- Schlüsselforschungen ----------
  function viewSchluessel() {
    const cnt = {};
    for (const set of [W.B, W.R]) for (const o of Object.values(set)) for (const [, , rs] of o.q) for (const [k, id, l] of rs) {
      if (k !== 'b' && k !== 'r') continue; const c = (cnt[k + ':' + id] ??= { n: 0, max: 0 }); c.n++; c.max = Math.max(c.max, l); }
    const top = Object.entries(cnt).sort((a, b) => b[1].n - a[1].n).slice(0, 30), max = top[0]?.[1].n || 1;
    $('#kbody').innerHTML = `<div class="card"><h2>Welche Forschungen überall gebraucht werden</h2>
      <p class="small muted">Gezählt wird, wie oft eine Forschung oder ein Gebäude als Voraussetzung für eine Stufenspanne eines anderen Gebäudes oder einer Forschung auftaucht. Wer diese früh hochzieht, hat später weniger Wartezeit.</p>
      <div class="scroll"><table class="ktbl"><thead><tr><th>Name</th><th class="num">Gefordert</th><th style="width:35%"></th><th class="num">höchste Stufe</th></tr></thead><tbody>
      ${top.map(([key, v]) => { const [k, id] = key.split(':'); return `<tr><td>${kindTag(k)} ${nameLink(k, id)}</td><td class="num">${v.n}×</td><td><div class="bar"><i style="width:${(v.n / max * 100).toFixed(1)}%"></i></div></td><td class="num">${v.max}</td></tr>`; }).join('')}
      </tbody></table></div></div>`;
  }

  // ---------- Navigation ----------
  function setHash() {
    const arg = K.sub === 'bauplan' ? K.psub : K.sub === 'gebaeude' ? K.curB : K.sub === 'forschung' ? K.curR : '';
    const h = `#/wissen/${K.sub}${arg ? '/' + arg : ''}`;
    if (location.hash !== h) try { history.replaceState(null, '', h); } catch { /* egal */ }
  }
  async function renderSub(arg) {
    document.querySelectorAll('#kSub [data-sub]').forEach(b => b.setAttribute('aria-pressed', b.dataset.sub === K.sub));
    const T = (await loadTexts())?.content || null;
    if (K.sub === 'bauplan') await viewBauplan(T);
    else if (K.sub === 'mechanik') viewMechanik(T);
    else if (K.sub === 'planer') viewPlaner();
    else if (K.sub === 'gebaeude') viewList('b', arg);
    else if (K.sub === 'forschung') viewList('r', arg);
    else viewSchluessel();
    setHash();
  }
  function onClick(e) {
    const sb = e.target.closest('[data-sub]');
    if (sb) { K.sub = sb.dataset.sub; window.scrollTo({ top: 0 }); return renderSub(); }
    const op = e.target.closest('[data-open]');
    if (op) { const [k, id] = op.dataset.open.split(':'); K.sub = k === 'b' ? 'gebaeude' : 'forschung'; window.scrollTo({ top: 0 }); return renderSub(id); }
    const go = e.target.closest('[data-goto]');
    if (go) { const [k, id, l] = go.dataset.goto.split(':'); setTarget(k + ':' + id, +l || 1); K.sub = 'planer'; window.scrollTo({ top: 0 }); return renderSub(); }
    const pl = e.target.closest('[data-plan]');
    if (pl) { setTarget(pl.dataset.plan, +$('#kpp')?.value || 1); K.sub = 'planer'; window.scrollTo({ top: 0 }); return renderSub(); }
  }

  window.viewKompendium = async function (rest = []) {
    W = await loadWissen();
    if (!REV) { REV = {}; for (const [k, set] of [['b', W.B], ['r', W.R]]) for (const [id, o] of Object.entries(set)) for (const [a, b, rs] of o.q) for (const [rk, rid, rl] of rs) (REV[rk + ':' + rid] ??= []).push({ k, id, a, b, l: rl }); }
    let [sub = '', arg = ''] = rest;
    if (sub.includes(':')) { const [k, id] = sub.split(':'); sub = k === 'b' ? 'gebaeude' : 'forschung'; arg = id; }   // alte Links #/wissen/b:typ
    if (SUBS.some(([v]) => v === sub)) K.sub = sub;
    if (K.sub === 'bauplan' && PSUBS.some(([v]) => v === arg)) K.psub = arg;
    $('#view').innerHTML = `<div class="komp"><nav class="kseg ksub" id="kSub">${SUBS.map(([v, l]) => `<button type="button" data-sub="${v}" aria-pressed="${v === K.sub}">${l}</button>`).join('')}</nav><div id="kbody"><p class="muted pad">Lädt …</p></div></div>`;
    $('#view .komp').addEventListener('click', onClick);
    await renderSub(arg);
  };
})();
