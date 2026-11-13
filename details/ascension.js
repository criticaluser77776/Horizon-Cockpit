'use strict';
/* Horizon Atlas – Reiter Ascension / Farmphase (13.11.2026). Zeitplan der Aufstiege (Resets) mit AP-Verteilung je Durchgang aus
   Supabase wissen/ascension (nicht öffentlich; erzeugt von analyse/ascension/zeitplan.js, geladen per GitHub Action beim Merge).
   Rechenhelfer in ../ascension.js (Asc). Auswahl: Annahme (mult/additiv), Betrieb, Übergang, Schwelle Supremum; Standard = Empfehlung. */
(() => {
  const A = { key: null, alle: false };

  async function loadAsc() {
    if (S.asc && Date.now() - S.asc.at < 60e3) return S.asc.row;
    const r = await Cloud.q('wissen', { key: 'eq.ascension', select: 'content,version,updated_at' }).catch(() => []);
    S.asc = { at: Date.now(), row: r[0] || null };
    return S.asc.row;
  }

  // gemeinsames Gerüst der Tabellen/Texte
  const kachel = (l, v, sub) => `<div class="ascK"><span class="muted small">${esc(l)}</span><b>${v}</b>${sub ? `<span class="small muted">${sub}</span>` : ''}</div>`;
  const tagK = (c, t) => t == null ? '–' : esc(Asc.datumText(Asc.tagDatum(c.tNull, t)));
  const tagSub = t => t == null ? '' : `Tag ${Math.round(t)}`;

  // Diagramm: AP-Summe über der Zeit (Tage ab Aufstieg 1), AP logarithmisch; senkrechte Linien bei Supremum 1/2/3 und Farmen ab
  function chart(c, v) {
    const pts = [];
    for (const b of v.bloecke) { pts.push([b.von / 24, b.T]); if ((b.anzahl || 1) > 1) pts.push([(b.bis ?? b.von) / 24, b.Tbis ?? b.T]); }
    const ys = pts.map(p => p[1]).filter(y => y > 0);
    if (pts.length < 2 || !ys.length) return '';
    const W = 760, Hh = 260, L = 46, R = 12, T = 12, B = 26, xMax = Math.max(c.tage || 0, ...pts.map(p => p[0])) || 1;
    const lo = Math.floor(Math.log10(Math.min(...ys))), hi = Math.max(lo + 1, Math.ceil(Math.log10(Math.max(...ys))));
    const X = d => L + d / xMax * (W - L - R), Y = ap => T + (1 - (Math.log10(Math.max(ap, 10 ** lo)) - lo) / (hi - lo)) * (Hh - T - B);
    let g = '';
    for (let e = lo; e <= hi; e++) g += `<line x1="${L}" x2="${W - R}" y1="${Y(10 ** e).toFixed(1)}" y2="${Y(10 ** e).toFixed(1)}" stroke="var(--line)"/><text x="${L - 4}" y="${(Y(10 ** e) + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="var(--muted)">${Asc.apText(10 ** e)}</text>`;
    const step = xMax > 150 ? 30 : xMax > 60 ? 10 : 5;
    for (let d = 0; d <= xMax; d += step) g += `<text x="${X(d).toFixed(1)}" y="${Hh - 8}" text-anchor="middle" font-size="10" fill="var(--muted)">${d}</text>`;
    const k = v.kpi || {};
    [[k.supremumTag, 'S1', 'var(--ok)'], [k.ics2Tag, 'S2', 'var(--accent)'], [k.ics3Tag, 'S3', 'var(--warn)'], [k.farmAbTag, 'Farm', 'var(--bad)']].forEach(([t, l, col], i) => {
      if (t == null) return;
      g += `<line x1="${X(t).toFixed(1)}" x2="${X(t).toFixed(1)}" y1="${T}" y2="${Hh - B}" stroke="${col}" stroke-dasharray="4 3"/><text x="${(X(t) + 3).toFixed(1)}" y="${T + 10 + i * 11}" font-size="10" fill="${col}">${l} Tag ${Math.round(t)}</text>`;
    });
    g += `<polyline fill="none" stroke="var(--accent)" stroke-width="2" points="${pts.map(p => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ')}"/>`;
    const nowD = (Date.now() - Date.parse(c.tNull)) / 864e5;
    if (nowD >= 0 && nowD <= xMax) g += `<line x1="${X(nowD).toFixed(1)}" x2="${X(nowD).toFixed(1)}" y1="${T}" y2="${Hh - B}" stroke="var(--text)" stroke-width="1"/><text x="${(X(nowD) + 3).toFixed(1)}" y="${Hh - B - 4}" font-size="10" fill="var(--text)">jetzt</text>`;
    return `<svg viewBox="0 0 ${W} ${Hh}" width="100%" style="max-width:${W}px" role="img" aria-label="AP-Summe über der Zeit (logarithmisch)">${g}</svg>
      <div class="small muted">AP-Summe (Achse logarithmisch) über den Tagen ab Aufstieg 1; gestrichelt: Supremum 1/2/3 und Beginn der Farmphase.</div>`;
  }

  function jetztKasten(c, v) {
    const p = Asc.phaseJetzt(v, c.tNull, new Date());
    if (!p) return '';
    const n = p.naechsterAufstieg, art = Asc.ART[p.art] || p.art;
    return `<div class="card"><h2>Jetzt</h2>
      <div><b>Durchgang ${p.durchgangNr}</b> · ${esc(art)}${p.vorStart ? ' <span class="muted small">(vor dem ersten Eintrag des Plans)</span>' : ''}</div>
      <div class="small">Verteilung: ${esc(p.vorStart ? 'laut Plan noch nicht berechnet' : Asc.skText(p.sk, c.namen))}</div>
      ${n ? `<div style="margin-top:6px">Nächster Aufstieg <b>Nr ${n.nr}</b>: <b>${esc(Asc.datumText(n.wann))}</b> · danach ${Asc.apText(n.apNach)} AP</div>
      <div class="small">Verteilung danach (${esc(Asc.ART[n.artDanach] || n.artDanach || '')}): ${esc(Asc.skText(n.skDanach, c.namen))}</div>`
        : '<div class="small muted">Kein weiterer Aufstieg im Plan (Horizont erreicht).</div>'}</div>`;
  }

  function zeitplan(c, v) {
    const p = Asc.phaseJetzt(v, c.tNull, new Date()), cur = p ? p.blockIdx : -1;
    const MAX = 30, rows = v.bloecke.map((b, i) => ({ b, i }));
    const show = A.alle ? rows : rows.slice(0, MAX);
    const tr = ({ b, i }) => {
      const [von, bis] = Asc.blockZeit(b, c.tNull), cls = i === cur ? 'ascNow' : i < cur ? 'ascPast' : '';
      const mehr = (b.anzahl || 1) > 1;
      return `<tr class="${cls}"${b.grob ? ' title="zusammengefasst: Verteilung, Dauer und AP des letzten Aufstiegs im Zeitraum"' : ''}><td class="num">${Asc.blockNr(b)}${b.live ? ' <span class="tag" title="echter Aufstieg 2 (schon gemessen)">live</span>' : ''}${b.grob ? ' <span class="tag" title="zusammengefasst">≈</span>' : ''}</td>
        <td>${esc(Asc.datumText(von))}${mehr ? ` – ${esc(Asc.datumText(bis))}` : ''}</td><td class="num">${b.anzahl || 1}</td>
        <td class="num">${Asc.apText(b.T)}${mehr ? ` – ${Asc.apText(b.Tbis)}` : ''}</td><td>${esc(Asc.ART[b.art] || b.art)}</td>
        <td class="num">${Asc.apText(b.h)}</td><td class="num">${Asc.apText(b.apJe)}</td><td class="small">${b.grob ? 'zuletzt: ' : ''}${esc(Asc.skText(b.sk, c.namen))}</td></tr>`;
    };
    return `<div class="card"><h2>Zeitplan</h2><div style="overflow-x:auto"><table class="ascT"><thead><tr><th>Aufstieg Nr</th><th>Datum</th><th class="num">Anzahl</th>
      <th class="num">AP-Summe</th><th>Art</th><th class="num">Dauer je Durchgang (h)</th><th class="num">AP je Aufstieg</th><th>Verteilung (für den folgenden Durchgang)</th></tr></thead>
      <tbody>${show.map(tr).join('')}</tbody></table></div>
      ${v.bloeckeExakt ? `<p class="small muted">Gekürzt: nach den ersten 10 Farm-Blöcken je ${Math.round((c.verdichtet?.grobH || 336) / 24)} Tage zusammengefasst (≈); vollständig sind nur die Empfehlungen.</p>` : ''}
      ${rows.length > MAX ? `<p class="small"><button type="button" id="ascAlle">${A.alle ? 'weniger zeigen' : `alle ${rows.length} zeigen`}</button></p>` : ''}</div>`;
  }

  function vergleich(c, v) {
    const vs = c.varianten.filter(x => !!x.mult === !!v.mult), emp = new Set(Object.values(c.empfehlung || {}));
    const row = x => { const k = x.kpi || {};
      return `<tr data-key="${esc(x.key)}" class="ascRow${x.key === v.key ? ' on' : ''}" title="anklicken = auswählen"><td>${x.betrieb === 'auto' ? 'Autobuilder' : 'von Hand'}</td>
        <td>${x.ueb === 'zwei' ? 'zwei Kol.' : 'eine Kol.'}</td><td class="num">${x.supAb}</td><td class="num">${tagK(c, k.supremumTag)}</td><td class="num">${tagK(c, k.farmAbTag)}</td>
        <td class="num">${tagSub(k.ics2Tag) || '–'}</td><td class="num">${tagSub(k.ics3Tag) || '–'}</td><td class="num">${Asc.apText(k.ap90)}</td><td class="num">${Asc.apText(k.ap180)}</td>
        <td class="num">${Asc.apText(k.apEnde)}</td><td class="num">${k.resets ?? '–'}</td><td class="num">${Asc.apText(k.rateEnde)}</td>
        <td>${emp.has(x.key) ? `<span class="tag ok" title="Empfehlung der Berechnung">Empf. ${Object.entries(c.empfehlung).filter(([, q]) => q === x.key).map(([n]) => n.split('-')[1] === 'auto' ? 'Auto' : 'Hand').join('/')}</span>` : ''}</td></tr>`; };
    return `<div class="card"><h2>Alle Varianten (${v.mult ? 'mult' : 'additiv'})</h2><div style="overflow-x:auto"><table class="ascT"><thead><tr><th>Betrieb</th><th>Übergang</th><th class="num">Supremum ab</th>
      <th class="num">Supremum 1 ab</th><th class="num">Farmen ab</th><th class="num">Supremum 2</th><th class="num">Supremum 3</th><th class="num">AP Tag 90</th><th class="num">AP Tag 180</th>
      <th class="num">AP Horizont</th><th class="num">Aufstiege</th><th class="num">AP/Tag Ende</th><th></th></tr></thead><tbody>${vs.map(row).join('')}</tbody></table></div></div>`;
  }

  function optionen(vals, sel, lab = x => x) { return vals.map(x => `<option value="${esc(x)}"${String(x) === String(sel) ? ' selected' : ''}>${esc(lab(x))}</option>`).join(''); }

  function render(c, row) {
    const v = Asc.findVariante(c, A.key) || Asc.waehleVariante(c);
    A.key = v.key;
    const k = v.kpi || {}, same = c.varianten.filter(x => !!x.mult === !!v.mult && x.betrieb === v.betrieb);
    const uebs = [...new Set(same.map(x => x.ueb))], sups = [...new Set(same.filter(x => x.ueb === v.ueb).map(x => x.supAb))].sort((a, b) => a - b);
    $('#ascBody').innerHTML = `<div class="card"><h2>Ascension / Farmphase</h2><div class="row" style="flex-wrap:wrap;gap:10px;align-items:end">
        <label class="small">Annahme<br><select id="ascMult">${optionen([1, 0], v.mult ? 1 : 0, x => x ? 'mult (multiplikativ)' : 'additiv')}</select></label>
        <label class="small">Betrieb<br><select id="ascBetrieb">${optionen(['auto', 'hand'], v.betrieb, x => x === 'auto' ? 'Autobuilder' : 'von Hand')}</select></label>
        <label class="small">Übergang<br><select id="ascUeb">${optionen(uebs, v.ueb, x => x === 'zwei' ? 'zwei Kolonien' : 'eine Kolonie')}</select></label>
        <label class="small">Schwelle Supremum<br><select id="ascSup">${optionen(sups, v.supAb)}</select></label>
        <button type="button" id="ascEmp">Empfehlung</button></div>
        <div class="small muted" style="margin-top:6px">${c.betrieb?.[v.betrieb]?.text ? esc(c.betrieb[v.betrieb].text) + ' · ' : ''}${c.uebergang?.[v.ueb]?.text ? esc(c.uebergang[v.ueb].text) : ''}</div></div>
      <div class="card"><div class="ascKs">${kachel('Supremum 1 ab', tagK(c, k.supremumTag), tagSub(k.supremumTag))}${kachel('Farmen ab', tagK(c, k.farmAbTag), tagSub(k.farmAbTag))}
        ${kachel('Supremum 2 ab', tagK(c, k.ics2Tag), tagSub(k.ics2Tag))}${kachel('Supremum 3 ab', tagK(c, k.ics3Tag), tagSub(k.ics3Tag))}
        ${kachel('AP bis Tag 90', Asc.apText(k.ap90))}${kachel('AP bis Tag 180', Asc.apText(k.ap180))}${kachel(`AP bis Horizont (Tag ${c.tage ?? '?'})`, Asc.apText(k.apEnde))}
        ${kachel('Aufstiege bis Horizont', k.resets ?? '–')}${kachel('AP-Rate am Ende', Asc.apText(k.rateEnde), 'AP/Tag')}</div></div>
      ${vergleich(c, v)}${jetztKasten(c, v)}<div class="card"><h2>AP-Summe über die Zeit</h2>${chart(c, v)}</div>${zeitplan(c, v)}
      <div class="card small muted"><ul style="margin:0;padding-left:18px">
        <li>Annahme mult/additiv zeigt sich bei Aufstieg 3: 3,38 AP = mult, 3,20 = additiv.</li>
        <li>Betrieb Autobuilder setzt die Farm-Automatik voraus (noch nicht gebaut).</li>
        <li>Stand: erzeugt ${esc(c.erzeugt ? Asc.datumText(c.erzeugt) : '–')}${row.version != null ? ` · Version ${esc(row.version)}` : ''}${c.quelle ? ` · Quelle ${esc(c.quelle)}` : ''}.</li></ul></div>`;
    const sel = id => $('#' + id);
    const nimm = o => { const n = Asc.waehleVariante(c, o); A.key = n.key; render(c, row); };
    sel('ascMult').onchange = e => nimm({ mult: e.target.value === '1', betrieb: v.betrieb });
    sel('ascBetrieb').onchange = e => nimm({ mult: !!v.mult, betrieb: e.target.value });
    sel('ascUeb').onchange = e => nimm({ mult: !!v.mult, betrieb: v.betrieb, ueb: e.target.value, supAb: v.supAb });
    sel('ascSup').onchange = e => nimm({ mult: !!v.mult, betrieb: v.betrieb, ueb: v.ueb, supAb: +e.target.value });
    sel('ascEmp').onclick = () => nimm({ mult: !!v.mult, betrieb: v.betrieb });
    $('#ascBody').querySelectorAll('tr.ascRow').forEach(r => r.addEventListener('click', () => { A.key = r.dataset.key; render(c, row); }));
    sel('ascAlle')?.addEventListener('click', () => { A.alle = !A.alle; render(c, row); });
  }

  window.viewAscension = async function () {
    $('#view').innerHTML = '<div id="ascBody"><p class="muted pad">Lädt …</p></div>';
    const row = await loadAsc();
    let c = row?.content;
    if (typeof c === 'string') { try { c = JSON.parse(c); } catch { c = null; } }
    if (!c || !Array.isArray(c.varianten) || !c.varianten.length) {
      $('#ascBody').innerHTML = '<div class="card"><h2>Ascension / Farmphase</h2><p class="muted">Zeitplan noch nicht in Supabase (kommt per GitHub Action beim Merge).</p></div>';
      return;
    }
    render(c, row);
  };
})();
