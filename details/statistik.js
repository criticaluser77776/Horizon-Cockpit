'use strict';
/* Horizon Atlas – Reiter Statistik (D3, 18.10.2026): Verlauf aus den Live-Snapshots über die RPC stats_series
   (Migration 20261018120001, je Zeitfenster der letzte Snapshot, wenige KB statt ganzer Snapshots). Punkte, Rang,
   Förderung, Lager, freie Kapazitäten und Stufensummen als Linien; Tagestabelle. Highscores (D8): volle Tabelle
   aus state_latest (empire.highscore, Collector ab 0.4.16, stat_main.php?cmd=orden), Platz je Kategorie aus der Reihe (hs). Schreibt nichts. */

const ST_RANGES = [['1', '24 h'], ['3', '3 Tage'], ['7', '7 Tage'], ['30', '30 Tage'], ['90', '90 Tage']];
const ST_RES = ['Eisenerz', 'Mineral', 'Treibstoff'];
const ST_COL = ['#c0713a', '#3a8fc0', '#8a5cc0'];   // Eisenerz, Mineral, Treibstoff (wie in beiden Themen lesbar)
const stGet = () => { try { return localStorage.getItem('hz.stat.range') || '7'; } catch { return '7'; } };

// Liniendiagramm mit mehreren Reihen: series = [{ name, color, pts: [[t, v]], dash }]; opt.inv = Achse umdrehen (Rang)
function stChart(series, opt = {}) {
  const all = series.flatMap(s => s.pts).filter(p => p[1] != null && isFinite(p[1]));
  if (all.length < 2) return '<p class="small muted">Zu wenig Werte im Zeitraum.</p>';
  const W = 640, H = 200, L = 62, R = 10, T = 10, B = 22;
  const x0 = Math.min(...all.map(p => p[0])), x1 = Math.max(...all.map(p => p[0]));
  let lo = Math.min(...all.map(p => p[1])), hi = Math.max(...all.map(p => p[1]));
  if (opt.zero && lo > 0) lo = 0;
  if (hi === lo) { hi += 1; lo -= opt.inv ? 1 : 0; }
  const pad = (hi - lo) * 0.06; hi += pad; lo = lo >= 0 ? Math.max(0, lo - pad) : lo - pad;   // nicht unter 0, wenn alle Werte ≥ 0
  const X = t => L + (t - x0) / Math.max(1, x1 - x0) * (W - L - R);
  const Y = v => opt.inv ? T + (v - lo) / (hi - lo) * (H - T - B) : T + (hi - v) / (hi - lo) * (H - T - B);
  const ticks = [];
  for (let i = 0; i <= 3; i++) {
    const v = lo + (hi - lo) * i / 3;
    ticks.push(`<line x1="${L}" x2="${W - R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" class="g"/>
      <text x="${L - 4}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end">${esc(stShort(v, opt.dec))}</text>`);
  }
  // x-Achse: Mitternacht (Ortszeit) je Tag bzw. je Woche, unter 2 Tagen alle 6 h
  const span = x1 - x0, dayStep = span > 20 * 864e5 ? 7 : 1, xs = [];
  if (span > 2 * 864e5) {
    for (let t = new Date(x0).setHours(24, 0, 0, 0), i = 0; t <= x1; t += 864e5, i++) {
      if (i % dayStep) continue;
      const p = dtParts(new Date(t));
      xs.push(`<line x1="${X(t).toFixed(1)}" x2="${X(t).toFixed(1)}" y1="${T}" y2="${H - B}" class="g"/><text x="${(X(t) + 3).toFixed(1)}" y="${H - 6}">${esc(`${p.wd} ${p.day}`)}</text>`);
    }
  } else {
    for (let t = Math.ceil(x0 / 216e5) * 216e5; t <= x1; t += 216e5) {
      const p = dtParts(new Date(t));
      xs.push(`<line x1="${X(t).toFixed(1)}" x2="${X(t).toFixed(1)}" y1="${T}" y2="${H - B}" class="g"/><text x="${(X(t) + 3).toFixed(1)}" y="${H - 6}">${esc(p.time === '00:00' ? `${p.wd} ${p.day}` : p.time)}</text>`);
    }
  }
  const lines = series.map(s => {
    const pts = s.pts.filter(p => p[1] != null && isFinite(p[1]));
    if (!pts.length) return '';
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('');
    const last = pts[pts.length - 1];
    return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2"${s.dash ? ' stroke-dasharray="5 4"' : ''}><title>${esc(s.name)}</title></path>
      <circle cx="${X(last[0]).toFixed(1)}" cy="${Y(last[1]).toFixed(1)}" r="3" fill="${s.color}"><title>${esc(s.name)}: ${esc(fmt(last[1], opt.dec || 0))} (${esc(dt(new Date(last[0])))})</title></circle>`;
  }).join('');
  const legend = series.length > 1 ? `<div class="small row" style="gap:4px 14px">${series.map(s => `<span><i class="stkey" style="background:${s.color}${s.dash ? ';opacity:.6' : ''}"></i>${esc(s.name)}</span>`).join('')}</div>` : '';
  return `<svg class="drift stchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opt.label || series.map(s => s.name).join(', '))}">${ticks.join('')}${xs.join('')}${lines}</svg>${legend}`;
}
function stShort(v, dec) {
  const a = Math.abs(v);
  return a >= 1e6 ? fmt(v / 1e6, 1) + ' Mio' : a >= 1e4 ? fmt(v / 1e3, 0) + ' k' : fmt(v, dec || (a < 10 && a % 1 ? 1 : 0));
}
const stSum = a => Array.isArray(a) ? a.reduce((s, x) => s + (+x || 0), 0) : null;

// Je Kalendertag (Europe/Berlin) der letzte Stand und die Änderung zum Vortag
function stDays(rows) {
  const by = new Map();
  for (const r of rows) { const p = dtParts(new Date(r.t)); by.set(p.ymd, { r, p }); }
  const out = [...by.values()];
  return out.map((x, i) => ({ ...x, prev: i ? out[i - 1].r : null })).reverse();
}

async function viewStatistik() {
  const range = stGet(), days = +range;
  const von = new Date(Date.now() - days * 864e5).toISOString();
  // Reihe + volle Highscore-Tabelle des neuesten Stands (eine Zeile, nur das Feld empire.highscore; Collector ab 0.4.16)
  const [res, latest] = await Promise.all([
    Cloud.rpc('stats_series', { p_account: S.acc, p_von: von, p_bis: new Date().toISOString(), p_step: 'auto' }),
    Cloud.q('state_latest', { select: 'collected_at,hs:data->empire->highscore', account_id: `eq.${S.acc}`, kind: 'eq.live' }).catch(() => []),
  ]);
  const rows = res?.rows || [];
  const seg = `<div class="kseg" id="stRange">${ST_RANGES.map(([v, l]) => `<button type="button" data-r="${v}" aria-pressed="${v === range}">${l}</button>`).join('')}</div>`;
  const head = `<div class="card"><div class="row between"><h2>Statistik</h2>${seg}</div>
    <p class="small muted">${rows.length} Stände${res?.step && res.step !== 'snapshot' ? ` (je ${esc({ hour: 'Stunde', '3h': '3 Stunden', '6h': '6 Stunden', day: 'Tag' }[res.step] || res.step)} der letzte)` : ''}
      aus den Live-Snapshots des Collectors · ${rows.length ? `${esc(dt(rows[0].t))} bis ${esc(dt(rows[rows.length - 1].t))}` : 'keine Daten im Zeitraum'}</p></div>`;
  if (!rows.length) { $('#view').innerHTML = head; return stBind(); }

  const T = r => Date.parse(r.t), last = rows[rows.length - 1], first = rows[0];
  const withPts = rows.filter(r => r.points != null), p0 = withPts[0], p1 = withPts[withPts.length - 1];
  const hrsSpan = p0 && p1 ? (T(p1) - T(p0)) / 3600e3 : 0;
  const perDay = hrsSpan >= 6 ? (p1.points - p0.points) / hrsSpan * 24 : null;
  const prodDay = stSum(last.prod) ?? (last.prod_h ? stSum(last.prod_h) * 24 : null);
  const tile = (label, val, sub) => `<div class="pdtile"><span class="small muted">${label}</span><b>${val}</b>${sub ? `<span class="small muted">${sub}</span>` : ''}</div>`;
  const tiles = `<div class="pdtiles">
    ${tile('Punkte', esc(fmt(last.points)), p0 && p1 && p1 !== p0 ? `${p1.points >= p0.points ? '+' : ''}${esc(fmt(p1.points - p0.points))} im Zeitraum` : '')}
    ${tile('Platz', last.rank != null ? esc(fmt(last.rank)) : '–', first.rank != null && last.rank != null && first.rank !== last.rank ? `vorher ${esc(fmt(first.rank))}` : esc(last.status || ''))}
    ${tile('Punkte je Tag', perDay != null ? esc(fmt(perDay)) : '–', perDay != null ? `Ø über ${esc(fmt(hrsSpan / 24, 1))} Tage` : '')}
    ${tile('Förderung je Tag', prodDay != null ? esc(stShort(prodDay)) : '–', last.prod ? ST_RES.map((x, i) => esc(stShort(last.prod[i] || 0))).join(' / ') : '')}
    ${tile('Stufen', `${esc(fmt(last.blevels))} / ${esc(fmt(last.rlevels))}`, 'Gebäude / Forschung')}
    ${last.colony ? tile('Koloniekontrolle', `${esc(fmt(last.colony.used, 0))} / ${esc(fmt(last.colony.max, 0))}`, `frei ${esc(fmt(last.colony.free, 1))}`) : ''}
    ${tile('Energie frei', esc(stShort(last.energy ?? NaN)), `Arbeiter frei ${esc(stShort(last.workers ?? NaN))}`)}
  </div>`;

  const line = (k, i) => rows.map(r => [T(r), k(r)?.[i] ?? null]);
  const res3 = (k, dash) => ST_RES.map((name, i) => ({ name, color: ST_COL[i], pts: line(k, i), dash }));
  const charts = `<div class="cols2">
    <div class="card"><h3>Punkte</h3>${stChart([{ name: 'Punkte', color: 'var(--accent)', pts: rows.map(r => [T(r), r.points]) }])}</div>
    <div class="card"><h3>Platz (gesamt)</h3>${stChart([{ name: 'Platz', color: 'var(--accent)', pts: rows.map(r => [T(r), r.rank]) }], { inv: true })}</div>
    <div class="card"><h3>Förderung je Stunde</h3>${stChart(res3(r => r.prod_h), { zero: true })}</div>
    <div class="card"><h3>Lagerbestand <span class="small muted">(gestrichelt: Lagergröße)</span></h3>${stChart([...res3(r => r.store), ...res3(r => r.cap, true).map(s => ({ ...s, name: s.name + ' Lager' }))], { zero: true })}</div>
    <div class="card"><h3>Freie Kapazitäten</h3>${stChart([{ name: 'Energie', color: '#d4a017', pts: rows.map(r => [T(r), r.energy]) },
      { name: 'Arbeiter', color: '#3aa06a', pts: rows.map(r => [T(r), r.workers]) }])}</div>
    <div class="card"><h3>Stufensummen</h3>${stChart([{ name: 'Gebäude (Heimat)', color: '#c0713a', pts: rows.map(r => [T(r), r.blevels]) },
      { name: 'Forschung', color: '#3a8fc0', pts: rows.map(r => [T(r), r.rlevels]) }])}</div>
  </div>`;

  const dayRows = stDays(rows).map(({ r, p, prev }) => {
    const d = (a, b) => a != null && b != null ? `${a - b >= 0 ? '+' : ''}${fmt(a - b)}` : '';
    return `<tr><td>${esc(`${p.wd} ${p.day}`)}</td><td class="num">${esc(fmt(r.points))}</td><td class="num muted">${esc(prev ? d(r.points, prev.points) : '')}</td>
      <td class="num">${esc(fmt(r.rank))}</td><td class="num muted">${esc(prev && r.rank != null && prev.rank != null && r.rank !== prev.rank ? d(prev.rank, r.rank) : '')}</td>
      <td class="num">${esc(r.prod ? stShort(stSum(r.prod)) : r.prod_h ? stShort(stSum(r.prod_h) * 24) : '–')}</td>
      <td class="num">${esc(fmt(r.blevels))} / ${esc(fmt(r.rlevels))}</td><td class="muted small">${esc(r.v || '')}</td></tr>`;
  }).join('');
  const table = `<div class="card"><h3>Je Tag <span class="small muted">(letzter Stand des Tages)</span></h3><div class="pdscroll"><table class="wide small">
    <thead><tr><th>Tag</th><th class="num">Punkte</th><th class="num">±</th><th class="num">Platz</th><th class="num" title="gewonnene Plätze gegen den Vortag">Plätze ↑</th><th class="num">Förderung/Tag</th><th class="num">Stufen G/F</th><th>Collector</th></tr></thead>
    <tbody>${dayRows}</tbody></table></div></div>`;

  const hsFull = latest?.[0]?.hs, hsRows = rows.filter(r => r.hs);
  const cats = [...new Set(hsRows.flatMap(r => Object.keys(r.hs)))].filter(k => k !== 'total');
  const hsCard = `<div class="cols2"><div class="card"><h3>Highscores je Kategorie${hsFull?.at ? ` <span class="small muted">Stand ${esc(dt(hsFull.at))}</span>` : ''}</h3>
    ${hsFull && !hsFull.error ? stHighscore(hsFull)
      : hsFull?.error ? `<p class="small err">${esc(hsFull.error)}</p>`
      : '<p class="small muted">Noch keine Werte: Der Collector liest die Highscores ab Version 0.4.16 von der Seite „Mein Imperium“ (stat_main.php?cmd=orden), mit dem normalen Imperium-Abruf alle 20 min.</p>'}</div>
    ${cats.length ? `<div class="card"><h3>Platz je Kategorie <span class="small muted">(Kategorien mit Punkten)</span></h3>${stChart(
      ['total', ...cats].slice(0, 8).map((k, i) => ({ name: ST_HS[k] || k, color: ST_HSCOL[i % ST_HSCOL.length], pts: hsRows.map(r => [T(r), r.hs[k]?.[1] ?? null]) })),
      { inv: true })}</div>` : ''}</div>`;

  $('#view').innerHTML = head + `<div class="card">${tiles}</div>` + charts + hsCard + table;
  stBind();
}

// Kategorien des Highscores (Schlüssel wie die Auswahl der Highscore-Liste, doku/wissen/statistik-monitor.md)
const ST_HS = { building: 'Gebäude', research: 'Forschung', fleet: 'Flotte', defence: 'Verteidigung', exploration: 'Entdeckung',
  prosecution: 'Kopfgeld', battle: 'Kampf', trade: 'Handel', war: 'Krieg', alliance: 'Allianz', firepower: 'Feuerkraft',
  artefacts: 'Aggregate', darkenergy: 'Dunkle Energie', ascension: 'Ascension', total: 'Summe' };
const ST_HSCOL = ['var(--accent)', '#c0713a', '#3aa06a', '#8a5cc0', '#d4a017', '#c0392b', '#5d6b80', '#3a8fc0'];
// Volle Tabelle: Zeilen = Kategorien, Spalten global und Prestige (Punkte, Platz); Summe zuletzt, fett
function stHighscore(hs) {
  const secs = ['global', 'prestige', ...Object.keys(hs).filter(k => !['global', 'prestige', 'points', 'status', 'at', 'error'].includes(k)
    && hs[k] && typeof hs[k] === 'object')].filter(k => hs[k]);
  const keys = [...new Set(secs.flatMap(k => Object.keys(hs[k])))].sort((a, b) => (a === 'total') - (b === 'total'));
  if (!keys.length) return '<p class="small muted">Keine Werte.</p>';
  const name = { global: 'Global', prestige: 'Prestige' };
  return `${hs.points != null ? `<p class="small">${esc(fmt(hs.points))} Punkte${hs.status ? ` · ${esc(hs.status)}` : ''}</p>` : ''}
    <table class="wide small"><thead><tr><th>Kategorie</th>${secs.map(k => `<th class="num">${esc(name[k] || k)}</th><th class="num">Platz</th>`).join('')}</tr></thead><tbody>
    ${keys.map(k => `<tr${k === 'total' ? ' style="font-weight:600"' : ''}><td>${esc(ST_HS[k] || k)}</td>${secs.map(s => {
      const v = hs[s][k]; return `<td class="num${v && !v.p ? ' muted' : ''}">${esc(v ? fmt(v.p) : '')}</td><td class="num${v && !v.p ? ' muted' : ''}">${esc(v ? fmt(v.r) : '')}</td>`;
    }).join('')}</tr>`).join('')}</tbody></table>`;
}

function stBind() {
  $('#stRange')?.addEventListener('click', e => {
    const b = e.target.closest('button[data-r]');
    if (!b) return;
    try { localStorage.setItem('hz.stat.range', b.dataset.r); } catch { /* egal */ }
    route();
  });
}
