'use strict';
/* Horizon Atlas – Reiter Imperium (D2, 17.10.2026): volle Fassung von Überblick, getData-Wächter, Planeten/Statistik,
   Gebäude/Forschung/Funktionen und laufenden Effekten. Karten als Kopie aus cockpit/app.js (im Cockpit bis C1);
   Notfallzentrale und Werbebanner bleiben im Cockpit. */

const RES = ['Eisenerz', 'Mineral', 'Treibstoff'];

/* ---------- getData-Wächter (B18, 16.10.2026; Migrationen 20261016000001/2) ----------
   Supabase fragt alle 10 min die offizielle getData-Schnittstelle ab (stco ALL + strs), auch ohne eingeloggten PC.
   Hier: Stand „aus getData“, Weckzeit (nächster Planschritt je Schlange startbar = Schlange frei + Rohstoffe reichen,
   Planreihenfolge wie im Autobuilder), Rohstoffe hochgerechnet, laufende Aufträge, Gastzugang. Forschungsstufen eingeklappt. */
function getdataCard(g, nm) {
  if (!g) return isOwner() ? '<div class="card"><h2>getData</h2><p class="small muted">Nicht eingerichtet – im Cockpit unter Mehr → getData-Zugang.</p></div>' : '';
  const at = g.at ? new Date(g.at) : null, c = g.colony, hrs = at ? (Date.now() - at) / 3600e3 : 0;
  const bad = g.error && (!g.ok_at || new Date(g.error_at) > new Date(g.ok_at));
  const left = g.expires_at ? (new Date(g.expires_at) - Date.now()) / 86400e3 : null;
  let html = `<div class="card${bad || (left != null && left < 3) ? ' warn' : ''}"><div class="row between"><h2>getData</h2>
    <span class="muted small" title="${esc(dt(g.at))}">${at ? `aus getData · ${esc(ago(at))} (${esc(clockT(at))})` : 'noch kein Abruf'}</span></div>`;
  if (bad) html += `<p class="small err">${esc(tidy(g.error))} <span class="muted">(${esc(ago(g.error_at))})</span></p>`;
  const w = g.wake;
  if (w?.steps?.length) {
    const why = s => s.never ? (/^Voraussetzung/.test(s.why || '') ? `${esc(s.why)} fehlt` : s.why ? `${esc(s.why)} reicht nie` : 'nicht absehbar') : s.why === 'jetzt' ? '' : esc(s.why || '');
    html += `<p>Weckzeit: <b>${w.at ? (new Date(w.at) <= Date.now() ? 'jetzt startbar' : esc(when(w.at))) : '–'}</b>
      <span class="muted small">Plan ${esc(w.hash || '')}</span></p><table class="small">${w.steps.map(s => `<tr>
      <td><span class="tag">${s.k === 'b' ? 'Bau' : 'Forschung'}</span> #${esc(s.n)} ${esc(s.text)}${s.beyond ? ' <span class="tag">hinter „bis #“</span>' : ''}</td>
      <td class="num">${s.at ? (new Date(s.at) <= Date.now() ? '<b>jetzt</b>' : esc(clockT(s.at))) : '–'} <span class="muted">${why(s)}</span></td></tr>`).join('')}</table>`;
  } else html += '<p class="small muted">Kein aktiver Bauplan oder Plan vollständig.</p>';
  if (c) {
    html += `<table class="small">${RES.map((x, i) => {
      const net = (c.net?.[i] || 0) * 3600, cap = c.max?.[i] || Infinity, now = Math.min((c.res?.[i] || 0) + net * hrs, cap);
      const full = net > 0 && isFinite(cap) ? (cap - now) / net * 3600 : null;
      return `<tr><td>${x}${full == null ? '' : `<div class="muted">voll in ${dur(full)}</div>`}</td><td class="num">${fmt(now)}</td><td class="num muted">${net >= 0 ? '+' : ''}${fmt(net)}/h</td></tr>`;
    }).join('')}</table>`;
  }
  const jobs = g.jobs || [];
  html += jobs.length ? `<table class="small">${jobs.map(j => {
    const end = new Date(j.end), s = (end - Date.now()) / 1000;
    return `<tr><td><span class="tag">${j.k === 'b' ? 'Bau' : 'Forschung'}</span> ${esc(j.name || nm({ type: j.cls }, j.k === 'b' ? 'B' : 'R'))}</td>
      <td class="num">${s > 0 ? `${dur(s)} <span class="muted">${esc(clockT(end))}</span>` : 'fertig'}</td></tr>`;
  }).join('')}</table>` : '<p class="small muted">Baustelle und Labor frei.</p>';
  const rs = Object.entries(g.research || {}).map(([k, v]) => ({ k, n: nm({ type: k }, 'R'), ...v })).sort((a, b) => String(a.n).localeCompare(String(b.n), 'de'));
  if (rs.length) html += `<details class="sub"><summary class="small muted">Forschungsstufen (${rs.length}, ${esc(ago(g.research_at))})</summary><table class="small">${rs.map(r =>
    `<tr><td>${esc(r.n)}</td><td class="num">${esc(r.level)}${r.status === 'CONSTRUCTION' ? ` → ${esc(r.level + 1)}` : ''}</td></tr>`).join('')}</table></details>`;
  if (g.expires_at) html += `<p class="small ${left < 3 ? 'err' : 'muted'}">Gastzugang bis ${esc(dt(g.expires_at))}${left < 3 ? ' – im Spiel verlängern, dann im Cockpit unter Mehr → getData-Zugang' : ''}</p>`;
  return html + '</div>';
}

/* ---------- Planeten + Statistik Imperium (B2, 14.10.2026; Collector ab 0.4.5 → d.empire) ----------
   Alle Planeten ohne Planetenwechsel: Kurzinfo wie die Übersicht im Spiel (main.php?cmd=start), Stufen/Schiffe/Verteidigung
   je Planet (stat_main.php?cmd=overview), Rohstoffe je Kolonie (cmd=emp_prod, Tageswerte). Verbrauch gibt das Spiel
   (cmd=status) nur für den im Spiel gewählten Planeten → nur dort. Arbeiter, Energie, Bauplatz nur in der Ansicht eines
   Planeten; Bauleistung entfällt, dafür „Ausbau x / y“ wie im alten horizon-enhanced (Nutzer 16.10.). */
const EMP_RES = [['Eisenerz', 'Eisenerz'], ['Mineral', 'Minerale'], ['Treibstoff', 'T-Stoff']];
function empirePlanets(d) {
  const e = d?.empire;
  if (!e || e.error) return [];
  const list = (e.planets || []).map(p => ({ ...p }));
  // Spalten der Übersicht (Koordinaten) und Zeilen von emp_prod (nur Name) den Planeten zuordnen
  for (const p of list) {
    for (const t of ['buildings', 'ships', 'defence']) {
      const o = e[t], k = o?.planets ? o.planets.findIndex(x => x.coords === p.coords) : -1;
      p[t] = k >= 0 ? o.items.map(i => ({ type: i.type, cat: i.cat, n: i.values[k], busy: (i.busy || []).includes(k) })).filter(i => i.n) : [];
    }
    for (const [t, v] of Object.entries(e.res || {})) p[t] = v?.planets?.find(x => x.name === p.name) || null;
  }
  return list;
}
// Baustellen je Planet (wie das alte horizon-enhanced): im Spiel gewählter Planet genau aus cmd=status (CONSTRUCTION,
// Summe Baustellen), alle anderen aus den Stufen (stat overview) und den Spieldaten: Σ Baustellen je Stufe (Hauptquartier,
// Gebäudeerstellung, Rechenzentrum) + 1 je Kolonialzentrum (in den Spieldaten ohne Wert). Boni fehlen → „≈“. Nur ganze zählen.
function planetSlots(d, p, W) {
  if (p.coords === d.start?.coords) {
    const v = d.status?.CONSTRUCTION?.tables?.[0]?.Summe?.Baustellen;
    if (v != null) return { n: Math.floor(+v + 1e-9), exact: true };
  }
  if (!W?.B || !p.buildings) return null;
  let n = 0;
  for (const b of p.buildings) {
    const k = String(b.type).toLowerCase();
    n += +(W.B[k]?.L?.[b.n]?.[4]?.Baustellen || 0) + (k === 'colonycenter' && b.n > 0 ? 1 : 0);
  }
  return { n: Math.floor(n + 1e-9), exact: false };
}
// „Ausbau x / y“: x = laufende Bauaufträge, y = Baustellen. x steht im Snapshot nur als erste Zahl der Kurzinfo „Ausbau a/b/c“
// (main.php?cmd=start) und ist oft veraltet (17.10.: Snapshot 06:04 „0“, HQ 4 lief seit 06:06). Für den im Spiel gewählten
// Planeten zählt deshalb die jüngste Quelle mit laufenden Aufträgen (Lebenszeichen des Autobuilders oder getData), wenn sie
// neuer als der Snapshot ist; sonst der Snapshot-Wert mit „Stand hh:mm“. Die 2./3. Zahl der Kurzinfo ist ungeprüft
// (laut Snapshots 16.10. nicht Forschung) und wird nicht angezeigt.
function liveBuild(live, abLive, gd) {
  const snapAt = live ? new Date(live.collected_at).getTime() : 0;
  const src = [abLive?.jobs && { at: +abLive.liveAt, jobs: abLive.jobs, from: 'Autobuilder' },
    gd?.at && gd.jobs && { at: new Date(gd.at).getTime(), jobs: gd.jobs, from: 'getData' }]
    .filter(x => x && x.at > snapAt).sort((a, b) => b.at - a.at)[0];
  return src ? { n: src.jobs.filter(j => j.k === 'b' && !(new Date(j.end) <= Date.now())).length, at: src.at, from: src.from } : { snapAt };
}
const ausbau = (d, p, W) => {
  const b = S.build || {}, lv = b.from && p.coords === d.start?.coords;
  return { busy: lv ? b.n : +(p.Ausbau?.[0] || 0), at: lv ? b.at : b.snapAt || null, from: lv ? b.from : 'Snapshot', slots: planetSlots(d, p, W) };
};
const AUSBAU_TIP = 'x = laufende Bauaufträge, y = Baustellen. Die weiteren Zahlen der Kurzinfo im Spiel (Ausbau a/b/c) sind ungeprüft – laut Snapshots 16.10. ist die zweite nicht Forschung.';
const ausbauText = a => `<span title="${esc(`${AUSBAU_TIP} Quelle x: ${a.from || 'Snapshot'}${a.at ? ` ${clockT(a.at)}` : ''}.`)}">${fmt(a.busy)} / ${a.slots ? `${a.slots.exact ? '' : '≈'}${fmt(a.slots.n)}` : '–'}</span>`
  + (a.from === 'Snapshot' && a.at ? ` <span class="muted">Stand ${esc(clockT(a.at))}</span>` : '');
function planetsCard(d, nm, W) {
  if (!d) return '';
  const pl = empirePlanets(d), e = d.empire;
  if (!pl.length) {
    return `<div class="card" id="planets"><h2>Planeten</h2><p class="small muted">${e?.error
      ? `Imperium nicht gelesen: ${esc(e.error)}` : 'Kommt mit dem nächsten Live-Stand (Collector ab 0.4.5).'}</p></div>`;
  }
  const cur = d.start?.coords;      // im Spiel gewählter Planet beim Erfassen (nur für ihn gibt es cmd=status)
  const all = pl.length > 1;
  let sel = S.planet ?? (() => { try { return localStorage.getItem('hz-planet'); } catch { return null; } })();
  if (sel !== 'alle' && !pl.some(p => p.coords === sel)) sel = all ? 'alle' : pl[0].coords;
  if (sel === 'alle' && !all) sel = pl[0].coords;
  const chip = p => {
    const ab = p.Ausbau || [];
    return `<button class="plchip${p.coords === sel ? ' on' : ''}" data-pl="${esc(p.coords)}"><span><b>${esc(p.name)}</b> <span class="muted small">${esc(p.coords)}${p.coords === cur ? ' ◉' : ''}</span></span>
      <span class="small">${EMP_RES.map(([, k]) => fmt(p[k])).join(' · ')}</span>
      ${ab.length ? `<span class="small muted">Ausbau ${ausbauText(ausbau(d, p, W))}</span>` : ''}</button>`;
  };
  let html = `<div class="card" id="planets"><div class="row between"><h2>Planeten</h2><span class="muted small">◉ im Spiel gewählt</span></div>
    <div class="plchips">${all ? `<button class="plchip${sel === 'alle' ? ' on' : ''}" data-pl="alle"><span><b>Imperium</b></span><span class="small muted">${pl.length} Planeten gesamt</span></button>` : ''}${pl.map(chip).join('')}</div>`;
  const p = pl.find(x => x.coords === sel);
  const prodRows = rows => `<table class="small"><tr><th></th><th class="num">/h</th><th class="num">/Tag</th><th class="num">Lager</th><th class="num">Kapazität</th></tr>${EMP_RES.map(([r]) => {
    const day = rows.production?.[r];
    return `<tr><td>${r}</td><td class="num">${day == null ? '–' : fmt(day / 24)}</td><td class="num">${fmt(day)}</td><td class="num muted">${fmt(rows.storage?.[r])}</td><td class="num muted">${fmt(rows.capacity?.[r])}</td></tr>`;
  }).join('')}</table>`;
  if (!p) {      // Imperium gesamt
    const tot = Object.fromEntries(Object.entries(e.res || {}).map(([t, v]) => [t, v?.total || null]));
    html += `<h3>Förderung gesamt</h3>${prodRows(tot)}<h3>Förderung je Planet /h</h3><table class="small"><tr><th></th>${EMP_RES.map(([r]) => `<th class="num">${r}</th>`).join("")}</tr>${pl.map(x => `<tr><td>${esc(x.name)}</td>${EMP_RES.map(([r]) =>
      `<td class="num">${x.production?.[r] == null ? '–' : fmt(x.production[r] / 24)}</td>`).join('')}</tr>`).join('')}</table>`;
    for (const [t, lbl] of [['ships', 'Schiffe'], ['defence', 'Verteidigung']]) {
      const items = e[t]?.items?.filter(i => i.sum || i.values.some(Boolean)) || [];
      if (items.length) html += `<h3>${lbl}</h3><table class="small">${items.map(i => `<tr><td>${esc(i.type)}</td><td class="num">${fmt(i.sum ?? i.values.reduce((a, b) => a + b, 0))}</td></tr>`).join('')}</table>`;
    }
    return html + '</div>';
  }
  const a = ausbau(d, p, W);
  html += `<p class="small">Ausbau <b>${ausbauText(a)}</b>${a.slots && !a.slots.exact ? ' <span class="muted">(Baustellen aus den Stufen berechnet)</span>' : ''}</p>
    <p class="small muted">frei: Energie <span class="${p.Energie < 0 ? 'err' : ''}">${fmt(p.Energie)}</span> · Arbeiter <span class="${p.Population < 0 ? 'err' : ''}">${fmt(p.Population)}</span> · Bauplatz ${fmt(p.Bauplatz)}${p.coords === cur ? supplyText(d) : ''}</p>`;
  html += `<h3>Förderung ${esc(p.name)}</h3>${prodRows(p)}`;
  const extra = ['spacemine', 'debris', 'recycle'].filter(t => p[t] && EMP_RES.some(([r]) => p[t][r]));
  if (extra.length) html += `<p class="small muted">${extra.map(t => `${{ spacemine: 'Orbital', debris: 'Trümmer Orbit', recycle: 'Trümmer Planet' }[t]}: ${EMP_RES.map(([r]) => fmt(p[t][r])).join(' / ')}`).join(' · ')}</p>`;
  html += p.coords === cur ? statDetails(d, nm)
    : `<p class="small muted">Verbrauch liefert das Spiel nur für den im Spiel gewählten Planeten (${esc(d.start?.planet || cur || '–')}).</p>`;
  const lst = (items, set) => items.map(i => `<tr><td>${esc(set ? nm({ type: i.type.toLowerCase() }, set) : i.type)}</td><td class="num">${i.busy ? '<b>' : ''}${fmt(i.n)}${i.busy ? '</b> ⚒' : ''}</td></tr>`).join('');
  const blds = p.buildings || [];
  html += `<details class="sub" data-open="plb"${S.plOpen?.plb ? ' open' : ''}><summary class="small"><b>Gebäude</b> <span class="muted">${blds.length} gebaut</span></summary><table class="small">${lst(blds, 'B')}</table></details>`;
  for (const [t, lbl] of [['ships', 'Schiffe'], ['defence', 'Verteidigung']]) {
    if (p[t]?.length) html += `<details class="sub" data-open="pl${t}"${S.plOpen?.['pl' + t] ? ' open' : ''}><summary class="small"><b>${lbl}</b> <span class="muted">${fmt(p[t].reduce((a, i) => a + i.n, 0))}</span></summary><table class="small">${lst(p[t])}</table></details>`;
  }
  return html + '</div>';
}
// Versorgung des gewählten Planeten (cmd=prod): Anteil der benötigten Arbeiter/Energie, der verfügbar ist
function supplyText(d) {
  const prod = d.prod || {}, avail = prod['Aktuelle Verfügbarkeit'] || {}, need = prod['Benötigte Kapazitäten'] || {};
  return ['Arbeiter', 'Energie'].map(k => {
    const ratio = need[k] ? Math.min(1, (avail[k] || 0) / need[k]) : 1;
    return `<span class="${ratio < 1 ? 'err' : ''}">${k} ${ratio < 1 ? fmt(Math.floor(ratio * 1000) / 10, 1) : 100} %</span>`;
  }).join(' · ').replace(/^/, '<br>Versorgung: ');
}
// Verbrauch (Energie/Arbeiter je Gebäude, Rohstoffe) aus cmd=status des gewählten Planeten
function statDetails(d, nm) {
  const t0 = k => d.status?.[k]?.tables?.[0] || null;
  const res = t0('RESOURCES'), prod = d.prod || {};
  const label = k => nm({ type: k }, 'B');
  const bldRows = o => Object.entries(o || {}).filter(([k]) => k !== 'Summe');
  let html = '';
  if (res) {
    const use = bldRows(res).filter(([, v]) => (v.Energie || 0) < 0 || (v.Arbeiter || 0) < 0).sort((a, b) => (a[1].Energie || 0) - (b[1].Energie || 0));
    const gen = bldRows(res).filter(([, v]) => (v.Energie || 0) > 0 || (v.Arbeiter || 0) > 0);
    const sum = res.Summe || {}, rv = prod['Verbrauch'] || {};
    html += `<details class="sub" data-open="plv"${S.plOpen?.plv ? ' open' : ''}><summary class="small"><b>Verbrauch</b> <span class="muted">frei: Energie ${fmt(sum.Energie)} · Arbeiter ${fmt(sum.Arbeiter)}${RES.some(r => rv[r]) ? ` · Rohstoffe ${RES.map(r => fmt(rv[r])).join(' / ')} je h` : ''}</span></summary>
      <table class="small"><tr><th></th><th class="num">Energie</th><th class="num">Arbeiter</th></tr>${use.map(([k, v]) => `<tr><td>${esc(label(k))} ${esc(v.level ?? '')}</td><td class="num">${fmt(v.Energie)}</td><td class="num">${fmt(v.Arbeiter)}</td></tr>`).join('')}
      ${gen.map(([k, v]) => `<tr class="muted"><td>${esc(label(k))} ${esc(v.level ?? '')}</td><td class="num">${v.Energie > 0 ? '+' : ''}${fmt(v.Energie)}</td><td class="num">${v.Arbeiter > 0 ? '+' : ''}${fmt(v.Arbeiter)}</td></tr>`).join('')}</table></details>`;
  }
  return html;
}
function bindPlanets(d, nm, W) {
  const box = $('#planets');
  if (!box) return;
  box.querySelectorAll('button[data-pl]').forEach(b => b.addEventListener('click', () => {
    S.planet = b.dataset.pl;
    try { localStorage.setItem('hz-planet', S.planet); } catch { /* egal */ }
    box.outerHTML = planetsCard(d, nm, W);
    bindPlanets(d, nm, W);
  }));
  // aufgeklappte Abschnitte über die Auffrischung hinweg merken
  box.querySelectorAll('details[data-open]').forEach(x => x.addEventListener('toggle', () => { (S.plOpen ||= {})[x.dataset.open] = x.open; }));
}

/* ---------- Überblick (B10): Lauf, Rohstoffe, laufende Aufträge in wenigen Zeilen ----------
   Ab 16.10. (Nutzer) Gesamtwerte des Imperiums: Rohstoffe aller Planeten (emp_prod: Lager + Netto-Förderung, auf jetzt
   hochgerechnet), Koloniepunkte benutzt/gesamt (cmd=orden, Collector ab 0.4.7), Ausbau x / y über alle Planeten. */
function empireRes(d, hrs) {
  const pl = empirePlanets(d).filter(p => p.storage);
  if (!pl.length) return null;
  const cur = d.start?.coords, stab = d.prod?.['Maximal stabile Menge'] || {};
  return RES.map(x => {
    let now = 0, net = 0, full = null;
    for (const p of pl) {
      const r = (p.production?.[x] ?? 0) / 24, cap = p.coords === cur ? stab[x] : null;   // Grenze nur für den gewählten Planeten bekannt
      const v = Math.min((p.storage[x] || 0) + r * hrs, cap || Infinity);
      now += v; net += r;
      if (r > 0 && cap && pl.length === 1) full = (cap - v) / r * 3600;
    }
    return { x, now, net, full };
  });
}
function overviewCard(sess, d, live, abLive, nm, W) {
  const r = sess.run, h = r && sess.devs.find(x => x.holds), s = h?.ab?.state || {};
  const runTxt = !r ? 'kein Lauf'
    : `<b class="${r.state === 'verloren' ? 'err' : ''}">${esc(RUNST[r.state] || r.state)}</b> bis #${esc(r.until ?? '–')} · ${esc(r.name || '?')}`
      + (r.state === 'schlaeft' && r.wake_at ? ` · Login ${esc(clockT(r.wake_at))}` : '')
      + (['laeuft', 'schlaeft'].includes(r.state) && s.ahead != null ? ` · Vorlauf ${esc(fmt(s.ahead, 1))} h` : '') + pauseTag(r);
  let html = `<div class="card${r?.state === 'verloren' || !d ? ' warn' : ''}"><div class="row between"><h2>Überblick</h2>
    <span class="muted small">${live ? `Stand ${esc(ago(live.collected_at))}` : 'noch kein Live-Stand'}</span></div><p>${runTxt}</p>`;
  if (r && ['angehalten', 'verloren'].includes(r.state) && r.reason) html += `<p class="small muted">${esc(tidy(r.reason))}</p>`;
  if (d) {
    const prod = d.prod || {}, at = new Date(live.collected_at), hrs = (Date.now() - at) / 3600e3;
    const pl = empirePlanets(d);
    // ohne Imperium-Daten (älterer Collector) wie bisher der gewählte Planet aus cmd=prod
    const rows = empireRes(d, hrs) || RES.map(x => {
      const stock = prod['Aktueller Lagerbestand'] || {}, rate = prod['Förderung'] || {}, use = prod['Verbrauch'] || {}, cap = prod['Maximal stabile Menge'] || {};
      const net = (rate[x] || 0) - (use[x] || 0), now = Math.min((stock[x] || 0) + net * hrs, cap[x] || Infinity);
      return { x, now, net, full: net > 0 && cap[x] ? (cap[x] - now) / net * 3600 : null };
    });
    html += `<table class="small"><tr class="muted"><td>${pl.length > 1 ? `Imperium (${pl.length} Planeten)` : 'Rohstoffe'}</td><td class="num">Bestand</td><td class="num">Förderung</td></tr>${rows.map(({ x, now, net, full }) =>
      `<tr><td>${x}${full == null ? '' : `<div class="muted">voll in ${dur(full)}</div>`}</td><td class="num">${fmt(now)}</td><td class="num muted">${net >= 0 ? '+' : ''}${fmt(net)}/h</td></tr>`).join('')}</table>`;
    const col = d.empire?.colony, ab = pl.map(p => ausbau(d, p, W)), abFrom = ab.find(a => a.from !== 'Snapshot');
    const slots = ab.length && ab.every(a => a.slots) ? { n: ab.reduce((s, a) => s + a.slots.n, 0), exact: ab.every(a => a.slots.exact) } : null;
    html += `<div class="row small" style="margin:4px 0">${col?.max != null
      ? `<span class="${col.free < 0 ? 'err' : ''}" title="frei ${esc(fmt(col.free, 3))}">Kolopunkte <b>${fmt(col.used, 2)}</b> / ${fmt(col.max, 2)}${col.free < 0 ? ' überzogen' : ''}</span>`
      : '<span class="muted">Kolopunkte: ab Collector 0.4.7</span>'}${ab.length ? ` · <span>Ausbau <b>${ausbauText({ busy: ab.reduce((s, a) => s + a.busy, 0), slots, ...(ab.length === 1 || !abFrom ? { at: ab[0].at, from: ab[0].from } : { at: abFrom.at, from: `${abFrom.from} (gewählter Planet), sonst Snapshot` }) })}</b></span>` : ''}</div>`;
    const fromAb = abLive && abLive.liveAt > at.getTime();
    const jobs = fromAb
      ? (abLive.jobs || []).map(j => ({ k: j.k === 'b' ? 'Bau' : 'Forschung', name: nm({ type: j.t }, j.k === 'b' ? 'B' : 'R'), level: j.l, end: new Date(j.end) }))
      : [...(d.buildings?.items || []).map(i => ({ ...i, k: 'Bau', name: nm(i, 'B') })), ...(d.research?.items || []).map(i => ({ ...i, k: 'Forschung', name: nm(i, 'R') }))]
        .filter(i => i.inProgress).map(j => ({ ...j, end: j.remaining != null ? new Date(at.getTime() + j.remaining * 1000) : null }));
    html += jobs.length ? `<table class="small">${jobs.map(j => {
      const left = j.end ? (j.end - Date.now()) / 1000 : null;
      return `<tr><td><span class="tag">${j.k}</span> ${esc(j.name)} ${esc(j.level)}</td><td class="num">${left == null ? '–' : left > 0 ? `${dur(left)} <span class="muted">${esc(clockT(j.end))}</span>` : 'fertig'}</td></tr>`;
    }).join('')}</table>` : '<p class="small muted">Baustelle und Labor frei.</p>';
  }
  return html + '</div>';
}

/* Reiter Imperium: alles aus der Lage des Cockpits außer Steuerung (Notfall, Banner) – Überblick, getData, Planeten,
   aktive Effekte, Gebäude/Forschung/Funktionen offen. Der große Live-Stand (≈ 35 KB) kommt nur bei neuem Zeitstempel. */
async function viewImperium() {
  const acc = `eq.${S.acc}`;
  const [heads, sess, feats, effs, gds] = await Promise.all([
    Cloud.q('state_latest', { account_id: acc, kind: 'eq.live', select: 'kind,collected_at,version' }),
    loadSessions(),
    Cloud.q('features', { account_id: acc, order: 'key' }),
    Cloud.q('events', { account_id: acc, kind: 'eq.bericht', 'data->effect->>until': `gt.${new Date().toISOString()}`,
      select: 'id,t,eff:data->effect', order: 't.desc', limit: 20 }).catch(() => []),
    Cloud.q('getdata_state', { account_id: acc, select: 'at,colony,jobs,research,research_at,wake,queues,expires_at,ok_at,error,error_at' }).catch(() => []),
  ]);
  const head = heads[0];
  if (head && (S.snap?.acc !== S.acc || S.snap?.at !== head.collected_at)) {
    const full = await Cloud.q('state_latest', { account_id: acc, kind: 'eq.live', select: 'collected_at,data' });
    S.snap = { acc: S.acc, at: head.collected_at, data: full[0]?.data };
  }
  const live = head ? { collected_at: head.collected_at } : null;
  const d = head ? S.snap?.data : null;
  const abLive = sess.devs.map(x => x.ab?.state).filter(s => s?.liveAt).sort((a, b) => b.liveAt - a.liveAt)[0] || null;
  const W = await loadWissen().catch(() => null);
  S.build = liveBuild(live, abLive, gds[0]);
  const nm = (i, set) => i.name || W?.[set]?.[i.type]?.n || i.type;
  let html = `<div class="cols2"><div class="stack">${overviewCard(sess, d, live, abLive, nm, W)}<div class="card"><h2>Lauf</h2>${runBody(sess)}
    <p class="small muted">Steuern (Start/Stopp, Pause, Notfall, Werbebanner): ${COCKPIT_LINK('#/lage', 'im Cockpit')}</p></div>${effectsCard(effs)}</div>
    <div class="stack">${getdataCard(gds[0], nm)}</div></div>${planetsCard(d, nm, W)}`;
  if (d) {
    const lv = (items, set) => items.map(i => `<tr><td>${esc(nm(i, set))}</td><td class="num">${esc(i.levelDone ?? i.level)}${i.inProgress ? ` → ${esc(i.level)}` : ''}</td></tr>`).join('');
    const st = d.start || {};
    html += `<div class="card"><h2>Gebäude, Forschung, Funktionen <span class="muted small">${esc(st.planet || '')} ${esc(st.coords || '')} · Rang ${esc(st.rank ?? '–')} · ${fmt(st.points)} Punkte · Stand ${esc(ago(live.collected_at))}</span></h2>
      <div class="grid"><div><h3>Gebäude</h3><table>${lv(d.buildings?.items || [], 'B')}</table>
      ${d.buildings?.space ? `<p class="muted small">Bauplatz frei ${fmt(d.buildings.space.free)} von ${fmt(d.buildings.space.total)}</p>` : ''}</div>
      <div><h3>Forschung</h3><table>${lv(d.research?.items || [], 'R') || '<tr><td class="muted">–</td></tr>'}</table></div>
      <div><h3>Funktionen</h3>${feats.length ? `<table>${feats.map(f => `<tr><td>${esc(f.label || f.key)}${f.unlocked_at ? '' : ' <span class="muted small">(gesperrt)</span>'}</td>
        <td title="${esc(STAGES[f.stage])}"><span class="stage">${STAGES.map((_, i) => `<i class="${i <= f.stage ? 'on' : ''}"></i>`).join('')}</span></td></tr>`).join('')}</table>` : '<p class="muted small">Noch keine erfasst.</p>'}</div></div></div>`;
  }
  $('#view').innerHTML = html;
  bindPlanets(d, nm, W);
}
