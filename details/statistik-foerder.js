'use strict';
/* Horizon Atlas – Statistik, Unterreiter „Förderung Top 10“ (26.10.2026): geschätzte Förderung der Top 10 aus den
   Highscore-Listen gegen unsere echte Förderung und die Prognose des aktiven Plans.
   Highscore-Punkte = verbaute Rohstoffe (analyse/SPIELMECHANIK.md, Abschnitt Highscore): Gebäude und Flotte 1:1,
   Forschung (Grundkosten der Stufe)^0,9 → verbaut ≈ Punkte × SF_FORSCH. Ausgaben je Tag = Zuwachs über SF_FENSTER_H
   (+ neu gebaute Schiffe, auch wenn sie später verbraucht werden, z. B. Kolonieschiffe). Geschätzte Förderung = Ausgaben ×
   SF_AUFSCHLAG (Lageraufbau, laufende Bauten; bei uns 20.–26.10. Förderung ≈ 1,4 × Ausgaben). Punkte kommen erst nach
   Fertigstellung → einzelne Tageswerte schwanken stark, deshalb gleitend über 48 h.
   Daten: rpc/hitlist_foerderung (Migration 20261026180001), rpc/stats_series (echte Förderung), aktiver Plan (bis.summe).
   Schreibt nichts. Rechenteil ohne DOM, getestet in Horiversum/tests/atlas_foerder.test.js. */

const SF_FORSCH = 2.3;        // verbaute Rohstoffe je Forschungspunkt (Punkte^(1/0,9) je Stufe, abzüglich Spieler-Rabatt)
const SF_AUFSCHLAG = 1.2;     // Förderung ≈ Ausgaben × Aufschlag (Untergrenze; Lager und laufende Bauten unbekannt)
const SF_FENSTER_H = 48;      // gleitendes Fenster für die Ausgaben je Tag
const SF_TREND_TAGE = 7;      // Trend der Top 10 aus den letzten n Tagen (gerade Linie)
// Spielalter (Nutzer 26.10.2026): Runde 8 startete am 06.10., unser Account am 10.10.; Annahme: die Top 10 spielen ab Rundenstart
const SF_START_RUNDE = Date.parse('2026-10-06T00:00:00+02:00');
const SF_START_WIR = Date.parse('2026-10-10T00:00:00+02:00');

// rows [{t, nick, b, r, f}] → { nick: [{t (ms), inv, f}] } (nur Erfassungen mit Gebäude- und Forschungspunkten)
function sfSeries(rows) {
  const out = {};
  for (const x of rows || []) {
    if (x.b == null || x.r == null) continue;
    (out[x.nick] ||= []).push({ t: Date.parse(x.t), inv: +x.b + SF_FORSCH * +x.r, f: +x.f || 0 });
  }
  for (const k in out) out[k].sort((a, b) => a.t - b.t);
  return out;
}
// Ausgaben je Tag je Erfassung: Zuwachs gegen die älteste Erfassung im Fenster (mindestens halbes Fenster), neue Schiffe dazu
function sfRates(ser, fensterH = SF_FENSTER_H) {
  const out = [], H = 3600e3;
  for (let i = 0; i < ser.length; i++) {
    let j = i;
    while (j > 0 && ser[i].t - ser[j - 1].t <= fensterH * H) j--;
    const span = (ser[i].t - ser[j].t) / 864e5;
    if (span < fensterH / 48) continue;
    let schiffe = 0;
    for (let k = j + 1; k <= i; k++) schiffe += Math.max(ser[k].f - ser[k - 1].f, 0);
    out.push({ t: ser[i].t, v: (ser[i].inv - ser[j].inv + schiffe) / span });
  }
  return out;
}
// Gerade durch [[t, v]] (kleinste Quadrate) → v(t) oder null
function sfTrend(pts) {
  const p = pts.filter(x => x[1] != null && isFinite(x[1]));
  if (p.length < 3) return null;
  const n = p.length, mx = p.reduce((a, x) => a + x[0], 0) / n, my = p.reduce((a, x) => a + x[1], 0) / n;
  const sxx = p.reduce((a, x) => a + (x[0] - mx) ** 2, 0);
  if (!sxx) return null;
  const k = p.reduce((a, x) => a + (x[0] - mx) * (x[1] - my), 0) / sxx;
  return t => my + k * (t - mx);
}
// Auswertung: data = Antwort von hitlist_foerderung → { top (ohne uns, nach Platz), me, schnitt [[t, v]], erster, wir, est (nick → [[t, v]]) }
function sfCalc(data, opt = {}) {
  const aufschlag = opt.aufschlag ?? SF_AUFSCHLAG, ser = sfSeries(data?.rows), me = data?.me;
  const est = {};
  for (const [nick, s] of Object.entries(ser)) est[nick] = sfRates(s, opt.fensterH).map(x => [x.t, x.v * aufschlag]);
  const top = (data?.top || []).filter(x => x.nick !== me && x.pl != null).sort((a, b) => a.pl - b.pl);
  const times = [...new Set(top.flatMap(x => (est[x.nick] || []).map(p => p[0])))].sort((a, b) => a - b);
  const schnitt = times.map(t => {
    const v = top.map(x => (est[x.nick] || []).find(p => p[0] === t)?.[1]).filter(v => v != null);
    return [t, v.length >= Math.ceil(top.length / 2) ? v.reduce((a, b) => a + b, 0) / v.length : null];
  });
  // Spalte „Ratio“ der Gesamtliste (Wiki): Vergleich mit allen länger spielenden Spielern bei gleichem Alter, 0–100, 50 = Durchschnitt
  const ratio = nick => (data?.rows || []).filter(x => x.nick === nick && x.q != null).map(x => [Date.parse(x.t), +x.q]);
  const qTimes = [...new Set((data?.rows || []).filter(x => x.q != null).map(x => Date.parse(x.t)))].sort((a, b) => a - b);
  const qSchnitt = qTimes.map(t => {
    const v = top.map(x => (data.rows.find(r => r.nick === x.nick && Date.parse(r.t) === t && r.q != null) || {}).q).filter(v => v != null).map(Number);
    return [t, v.length >= Math.ceil(top.length / 2) ? v.reduce((a, b) => a + b, 0) / v.length : null];
  });
  return { top, me, schnitt, erster: top[0] ? est[top[0].nick] || [] : [], wir: me ? est[me] || [] : [], est,
    qWir: me ? ratio(me) : [], qSchnitt };
}
// Vergleich bei gleichem Spielalter: je ganzer Tag Alter die Erfassung nächst dem Zeitpunkt (±6 h) für Top-10-Schnitt und uns
function sfAlter(data, calc, opt = {}) {
  const runde = opt.runde ?? SF_START_RUNDE, wir = opt.wir ?? SF_START_WIR, ser = sfSeries(data?.rows), H = 3600e3;
  const near = (arr, t) => { let b = null; for (const p of arr || []) if (Math.abs(p.t - t) <= 6 * H && (!b || Math.abs(p.t - t) < Math.abs(b.t - t))) b = p; return b; };
  const nearV = (arr, t) => { let b = null; for (const p of arr || []) if (Math.abs(p[0] - t) <= 6 * H && (!b || Math.abs(p[0] - t) < Math.abs(b[0] - t))) b = p; return b?.[1] ?? null; };
  const out = [];
  for (let d = 1; d <= 120; d++) {
    const tT = runde + d * 864e5, tW = wir + d * 864e5;
    const pts = calc.top.map(x => near(ser[x.nick], tT)).filter(Boolean);
    const w = calc.me ? near(ser[calc.me], tW) : null;
    if (pts.length < Math.ceil(calc.top.length / 2) || !w) continue;
    const inv = pts.reduce((a, p) => a + p.inv, 0) / pts.length;
    out.push({ d, tT, tW, invTop: inv, invWir: w.inv, foeTop: nearV(calc.schnitt, tT), foeWir: nearV(calc.wir, tW) });
  }
  return out;
}

if (typeof module !== 'undefined') module.exports = { sfSeries, sfRates, sfTrend, sfCalc, sfAlter, SF_FORSCH, SF_AUFSCHLAG };

// ---------- Ansicht (im Atlas) ----------
async function smFoerder(s) {
  const von = new Date(Date.now() - 14 * 864e5).toISOString();
  const [data, st, plan] = await Promise.all([
    Cloud.rpc('hitlist_foerderung', { p_account: S.acc, p_von: von, p_top: 10 }).catch(() => null),
    Cloud.rpc('stats_series', { p_account: S.acc, p_von: von, p_bis: new Date().toISOString(), p_step: '6h' }).catch(() => null),
    loadActivePlan().catch(() => null),
  ]);
  if (!data?.top?.length) return '<p class="small muted">Noch keine Highscore-Listen (Collector ab 0.4.26, alle 6 h).</p>';
  const c = sfCalc(data), pct = (a, b) => a != null && b ? `${fmt(a / b * 100)} %` : '–';
  const echt = (st?.rows || []).map(r => [Date.parse(r.t), stSum(r.prod)]).filter(p => p[1] != null);
  const sNow = s?.emp?.res?.production?.total, nowEcht = sNow ? stSum(['Eisenerz', 'Mineral', 'Treibstoff'].map(k => sNow[k])) : echt.at(-1)?.[1];
  const lastS = [...c.schnitt].reverse().find(p => p[1] != null);
  // Prognose am Stichtag des aktiven Plans (bis.summe je Stunde, Simulator) gegen die Gerade der Top 10
  const bis = plan?.payload?.bis, tBis = bis?.t ? Date.parse(bis.t) : null, planTag = bis?.summe != null ? +bis.summe * 24 : null;
  if (plan) await loadNums().catch(() => null);
  const pNr = plan ? planNo(plan.row.id) : null;
  const trend = sfTrend(c.schnitt.filter(p => p[0] >= Date.now() - SF_TREND_TAGE * 864e5));
  const topBis = trend && tBis ? trend(tBis) : null;
  const zukunft = tBis && tBis > Date.now() && planTag != null && nowEcht != null;
  const series = [
    { name: 'Top-10-Schnitt (geschätzt)', color: 'var(--accent)', pts: c.schnitt },
    { name: `Platz 1 (${c.top[0].nick})`, color: '#8a5cc0', pts: c.erster },
    { name: 'Wir (echt)', color: '#3aa06a', pts: echt },
    { name: 'Wir (geschätzt wie die anderen)', color: '#3aa06a', pts: c.wir, dash: true },
    ...(zukunft ? [{ name: `Plan${pNr ? ' ' + pNr : ''} (Prognose)`, color: '#c0713a', pts: [[Date.now(), nowEcht], [tBis, planTag]], dash: true }] : []),
    ...(zukunft && topBis != null && lastS ? [{ name: 'Top 10 (Trend)', color: 'var(--accent)', pts: [[lastS[0], trend(lastS[0])], [tBis, topBis]], dash: true }] : []),
  ];
  const tile = (label, val, sub) => `<div class="pdtile"><span class="small muted">${label}</span><b>${val}</b>${sub ? `<span class="small muted">${sub}</span>` : ''}</div>`;
  const alter = sfAlter(data, c), a = alter.at(-1);
  const tiles = `<div class="pdtiles">
    ${tile('Wir (echt)', esc(stShort(nowEcht ?? NaN)), 'Förderung je Tag')}
    ${tile('Top-10-Schnitt', esc(stShort(lastS?.[1] ?? NaN)), `geschätzt · wir ${esc(pct(nowEcht, lastS?.[1]))}`)}
    ${zukunft ? tile(`Am ${esc(dt(new Date(tBis)))}`, esc(pct(planTag, topBis)), `Plan ${esc(stShort(planTag))} · Top 10 ${esc(stShort(topBis ?? NaN))}`) : ''}
    ${a ? tile(`Gleiches Alter (${esc(a.d)} Tage)`, esc(pct(a.invWir, a.invTop)), 'unsere verbauten Rohstoffe gegen Top 10') : ''}
  </div>`;
  const rows = c.top.map(x => {
    const e = c.est[x.nick] || [], v = e.at(-1)?.[1], v3 = e.find(p => p[0] >= (e.at(-1)?.[0] ?? 0) - 3 * 864e5)?.[1];
    return `<tr><td class="num">${esc(fmt(x.pl))}</td><td>${esc(x.nick)}</td><td class="num">${esc(stShort(v ?? NaN))}</td>
      <td class="num muted">${v != null && v3 ? esc(`${v >= v3 ? '+' : ''}${fmt((v / v3 - 1) * 100)} %`) : ''}</td><td class="num">${esc(pct(nowEcht, v))}</td><td class="num">${esc(fmt(x.q))}</td></tr>`;
  });
  const meRow = c.top.length && data.top.find(x => x.nick === c.me);
  const altRows = alter.map(r => `<tr><td class="num">${esc(r.d)}</td><td>${esc(dtParts(new Date(r.tT)).day)}</td><td class="num">${esc(stShort(r.invTop))}</td>
    <td>${esc(dtParts(new Date(r.tW)).day)}</td><td class="num">${esc(stShort(r.invWir))}</td><td class="num">${esc(pct(r.invWir, r.invTop))}</td>
    <td class="num">${esc(stShort(r.foeTop ?? NaN))}</td><td class="num">${esc(stShort(r.foeWir ?? NaN))}</td></tr>`);
  return `${tiles}
    <h3>Förderung je Tag</h3>${stChart(series, { zero: true, label: 'Geschätzte Förderung je Tag' })}
    <h3>Ratio laut Spiel <span class="small muted">(gleiches Spielalter, 50 = Durchschnitt)</span></h3>${stChart([
      { name: 'Top-10-Schnitt', color: 'var(--accent)', pts: c.qSchnitt }, { name: 'Wir', color: '#3aa06a', pts: c.qWir }], { zero: true, label: 'Ratio' })}
    <h3>Top 10 <span class="small muted">(Stand ${esc(dt(data.at))}${meRow ? ` · wir Platz ${esc(fmt(meRow.pl))}, Ratio ${esc(fmt(meRow.q))}` : ''})</span></h3>
    ${smTable(['Platz', 'Spieler', 'Förderung/Tag', '± 3 Tage', 'wir im Verhältnis', 'Ratio'], rows)}
    ${alter.length ? `<h3>Bei gleichem Spielalter</h3>${smTable(['Alter (Tage)', 'Top 10 am', 'verbaut', 'wir am', 'verbaut', 'wir im Verhältnis', 'Förderung Top 10', 'Förderung wir'], altRows)}` : ''}
    <p class="small muted">Geschätzt aus den Highscore-Listen (alle 6 h): Gebäude- und Flottenpunkte = verbaute Rohstoffe, Forschung × ${esc(fmt(SF_FORSCH, 1))}
      (Punkte = Grundkosten<sup>0,9</sup>), Zuwachs gleitend über ${esc(SF_FENSTER_H)} h, Förderung = Ausgaben × ${esc(fmt(SF_AUFSCHLAG, 1))} (Untergrenze: Lageraufbau und
      laufende Bauten zählen erst später). „Wir (geschätzt)“ ist dieselbe Rechnung für uns – der Abstand zur echten Linie zeigt die Unschärfe.
      Prognose: Förderung des aktiven Plans am Stichtag laut Simulator (bis.summe), Top 10 als Gerade der letzten ${esc(SF_TREND_TAGE)} Tage verlängert.
      Spielalter: Runde ab 06.10., wir ab 10.10. (Annahme: die Top 10 spielen ab Rundenstart).
      Ratio (Spalte der Highscore-Liste, laut Wiki): Vergleich mit allen Spielern, die länger dabei sind, bei gleichem Spielalter
      (deren Tagesstände), 0–100, 50 = Durchschnitt. Sie schwankt, weil der eigene Stand stündlich, der Vergleich täglich gerechnet wird.</p>`;
}
