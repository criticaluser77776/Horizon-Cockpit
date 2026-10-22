'use strict';
/* Horizon Atlas – Reiter Einheiten (20.10.2026, doku/stand/erledigt/plan-atlas-sim-einheiten.md Teil B). Nur lesend.
   Alle 185 Schiffe und Verteidigungsanlagen mit allen Werten: Grundwerte aus getData (einheiten-daten.js, analyse/build_einheiten.py),
   „unser Stand“ selbst gerechnet mit der Forschung aus dem neuesten Live-Stand (einheitenformel.js), Live-Gegenprobe (Hilfeseite),
   Kosten live oder „ungeprüft“ (Wiki/ships.json), Bestand aus state_latest → empire.ships/defence.
   Läuft vor details.js; nutzt dessen Helfer ($, esc, fmt, when, Cloud, S). Ansicht-Einstellungen in localStorage (hz.einheiten). */
(function () {
  const LS = 'hz.einheiten';
  const ART_TXT = { sicher: 'live bestätigt', kampf: 'Formel aus dem Kampfsystem (nicht live geprüft)', fest: 'keine Forschung', offen: 'Formel unbekannt – Grundwert' };
  // Spalten: [Schlüssel, Kopf, Gruppe, Wert(e, w), Format]
  const SP = [
    ['hull', 'Hülle', 'kampf'], ['armor', 'Panzer', 'kampf'], ['shield', 'Schild', 'kampf'], ['stealth', 'Tarnung', 'kampf'],
    ['agility', 'Agilität', 'kampf'], ['speed', 'Kampfgeschw.', 'kampf'], ['waffen', 'Waffen', 'kampf'],
    ['accel', 'Beschl.', 'flug'], ['tank', 'Tank', 'flug'], ['fuelUse', 'Verbrauch', 'flug', 2], ['range', 'Reichweite', 'flug'],
    ['cargo', 'Laderaum', 'flug'], ['deck', 'Flugdeck', 'flug'], ['orbitTime', 'Orbit', 'flug'], ['control', 'Kontrolle', 'flug'],
    ['kosten', 'Kosten E/M/T', 'bau'], ['ksum', 'Summe', 'bau'], ['bau', 'Bau/Stck (W1)', 'bau'], ['tonnage', 'Tonnage', 'bau'],
    ['bestand', 'Bestand', 'bau'],
  ];
  const GRUPPEN = [['kampf', 'Kampf'], ['flug', 'Flug'], ['bau', 'Bau & Bestand']];
  const E = { art: 'ship', klasse: '', suche: '', sort: 'kuerzel', ab: false, gruppen: ['kampf', 'flug', 'bau'], stand: 'unser', wahl: null };
  try { Object.assign(E, JSON.parse(localStorage.getItem(LS) || '{}')); } catch { /* egal */ }
  const merke = () => { try { localStorage.setItem(LS, JSON.stringify(E)); } catch { /* egal */ } };
  let live = null;

  const dauer = s => {
    if (s == null) return '–';
    const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
    return `${d ? d + ':' : ''}${String(h).padStart(d ? 2 : 1, '0')}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`;
  };

  async function liveStand() {
    try {
      const [row] = await Cloud.q('state_latest', { account_id: `eq.${S.acc}`, kind: 'eq.live', select: 'collected_at,r:data->research->items,sh:data->empire->ships,df:data->empire->defence' });
      const F = Object.fromEntries((row?.r || []).map(x => [String(x.type).toLowerCase(), +x.level || 0]));
      const bestand = {};
      for (const g of [row?.sh, row?.df]) for (const it of g?.items || []) bestand[it.type] = (bestand[it.type] || 0) + (+it.sum || 0);
      return { at: row?.collected_at, F, bestand, ok: !!(row?.r || []).length };
    } catch { return { F: {}, bestand: {}, ok: false }; }
  }

  function zeile(k, u, F) {
    const w = E.stand === 'grund' ? HzEinheiten.werte(u, {}) : HzEinheiten.werte(u, F);
    const ksum = u.cost ? u.cost[0] + u.cost[1] + u.cost[2] : null;
    return { k, u, w, ksum, bau: u.kind === 'ship' ? HzEinheiten.bauzeit(u.cost) : null, bestand: live.bestand[k] || 0,
      waffen: (w.weapons || []).map(x => `${x.count}× ${x.weapon}`).join(', ') };
  }
  const wert = (z, key) => key === 'kuerzel' ? z.k : key === 'name' ? z.u.name : key === 'klasse' ? z.u.class
    : key === 'ksum' ? z.ksum : key === 'bau' ? z.bau : key === 'tonnage' ? z.u.tonnage : key === 'bestand' ? z.bestand
      : key === 'waffen' ? (z.w.weapons || []).reduce((a, x) => a + x.count, 0) : key === 'kosten' ? z.ksum : z.w[key];

  function zelle(z, [key, , , dez]) {
    if (key === 'waffen') {
      const l = (z.w.weapons || []).map(x => `${fmt(x.count)}× ${x.weapon}`);
      return `<td class="small" style="white-space:nowrap" title="${esc(l.join(', '))}">${esc(l.slice(0, 3).join(', ') || '–')}${l.length > 3 ? ` <span class="muted">+${l.length - 3}</span>` : ''}</td>`;
    }
    if (key === 'kosten') return `<td class="num small">${z.u.cost ? z.u.cost.map(x => fmt(x)).join(' / ') : '–'}${z.u.cost && !/^live/.test(z.u.costSource) ? '<sup title="ungeprüft (Wiki/ships.json)">*</sup>' : ''}</td>`;
    if (key === 'ksum') return `<td class="num">${fmt(z.ksum)}</td>`;
    if (key === 'bau') return `<td class="num small">${z.bau ? dauer(z.bau) : '–'}</td>`;
    if (key === 'tonnage') return `<td class="num">${fmt(z.u.tonnage)}${z.u.tonnage != null && !/^live/.test(z.u.tonnageSource || '') ? '<sup title="ungeprüft (ships.json)">*</sup>' : ''}</td>`;
    if (key === 'bestand') return `<td class="num">${z.bestand ? `<b>${fmt(z.bestand)}</b>` : '<span class="muted">0</span>'}</td>`;
    if (key === 'control') return `<td class="num small" title="Formel unbekannt – Grundwert aus getData">${esc(z.w.control ?? '–')}</td>`;
    return `<td class="num">${fmt(z.w[key], dez || 0)}</td>`;
  }

  function detail(z, F) {
    const u = z.u, g = HzEinheiten.werte(u, {}), w = HzEinheiten.werte(u, F), h = u.live?.hilfe;
    const L = h ? HzEinheiten.werte(u, u.live.forschung) : null;
    const FELD = [['hull', 'Hülle'], ['armor', 'Panzerung'], ['shield', 'Schild'], ['stealth', 'Tarnung'], ['agility', 'Agilität'],
      ['speed', 'Kampfgeschwindigkeit', 'combatSpeed'], ['accel', 'Beschleunigung'], ['tank', 'Treibstoffvorrat'], ['fuelUse', 'Treibstoffverbrauch'],
      ['range', 'Reichweite'], ['cargo', 'Laderaum'], ['deck', 'Flugdeck'], ['orbitTime', 'Orbitzeit'], ['control', 'Kontrolle']];
    const fz = x => typeof x === 'number' ? fmt(x, 2) : esc(String(x ?? '–'));
    const rows = FELD.map(([k, n, hk]) => {
      const lv = h ? h[hk || k] : null, ok = h ? String(L[k]) === String(lv) : null;
      return `<tr><td>${esc(n)}</td><td class="num">${fz(g[k])}</td><td class="num"><b>${fz(w[k])}</b></td>
        ${h ? `<td class="num">${fz(lv)} ${ok ? '<span class="ok">✓</span>' : `<span class="warn" title="gerechnet ${esc(String(L[k]))}">≠</span>`}</td>` : ''}
        <td class="small muted">${esc(ART_TXT[HzEinheiten.ART[k]] || '')}</td></tr>`;
    }).join('');
    const wf = (w.weapons || []).length ? `<h3>Waffen (unser Stand)</h3><table class="small"><thead><tr><th>Waffe</th><th>Anzahl</th><th>Schüsse</th><th>Schaden Schiffe</th><th>Schaden Boden</th><th>Reichweite</th><th>Genauigkeit</th><th>Wirkung Panzer/Schild</th><th>Forschung Schaden</th></tr></thead><tbody>${
      w.weapons.map(x => `<tr><td><b>${esc(x.weapon)}</b></td><td class="num">${fmt(x.count)}</td><td class="num">${fmt(x.shots)}</td><td class="num">${fmt(x.damageShips)}</td><td class="num">${fmt(x.damageGround)}</td><td class="num">${fmt(x.range)}</td><td class="num">${fmt(x.accuracy)}</td><td class="num">${fmt(x.effArmor, 2)} / ${fmt(x.effShield, 2)}</td><td class="small">${esc(x.scale || '–')}</td></tr>`).join('')}</tbody></table>
      <p class="small muted">Waffenwerte mit Formeln aus dem Kampfsystem (Schaden je Waffentechnik, Reichweite Militärtechnik, Genauigkeit Computertechnik) – noch nicht live geprüft.</p>` : '';
    return `<div class="card" id="einDetail"><div class="row between"><h2>${esc(z.k)} · ${esc(u.name || '')}</h2><button id="einZu">Schließen</button></div>
      <p class="small">${esc(u.class || '')} · ${u.kind === 'ship' ? 'Schiff' : 'Verteidigung'}${u.feature ? ` · Besonderheit <b>${esc(u.feature)}</b>` : ''}${u.hyper ? ` · Hyperraum ${fmt(u.hyper[0])} / ${fmt(u.hyper[1])}` : ''}
        · Bestand <b>${fmt(z.bestand)}</b></p>
      <table class="small"><thead><tr><th>Wert</th><th>Grundwert (getData)</th><th>unser Stand</th>${h ? `<th>live ${esc(u.live.datum)}</th>` : ''}<th>Herleitung</th></tr></thead><tbody>${rows}</tbody></table>
      ${h ? '<p class="small muted">Live = Hilfeseite im Spiel mit dem Forschungsstand von damals; ✓ = die Formel ergibt genau diesen Wert.</p>' : '<p class="small muted">Noch keine Live-Gegenprobe (Hilfeseiten gibt es nur für baubare Einheiten).</p>'}
      ${wf}
      <h3>Bau</h3><p class="small">Kosten ${u.cost ? `<b>${u.cost.map(x => fmt(x)).join(' / ')}</b> (Summe ${fmt(z.ksum)}) – ${esc(u.costSource)}` : 'unbekannt'}
        ${u.tonnage != null ? ` · Tonnage ${fmt(u.tonnage)} (${esc(u.tonnageSource || '')})` : ''}
        ${z.bau ? ` · Bau je Stück bei Werft 1 und 100 %: <b>${dauer(z.bau)}</b> (Kostensumme / 1 080 je h)` : ''}</p></div>`;
  }

  function render() {
    const F = live.F, alle = Object.entries(HZ_EINHEITEN.units).filter(([, u]) => u.kind === E.art);
    const klassen = [...new Set(alle.map(([, u]) => u.class))].sort();
    if (E.klasse && !klassen.includes(E.klasse)) E.klasse = '';
    const q = E.suche.trim().toLowerCase();
    let z = alle.filter(([k, u]) => (!E.klasse || u.class === E.klasse) && (!q || k.toLowerCase().includes(q) || (u.name || '').toLowerCase().includes(q)))
      .map(([k, u]) => zeile(k, u, F));
    z.sort((a, b) => {
      const x = wert(a, E.sort), y = wert(b, E.sort);
      const c = typeof x === 'number' || typeof y === 'number' ? (x ?? -Infinity) - (y ?? -Infinity) : String(x ?? '').localeCompare(String(y ?? ''), 'de');
      return E.ab ? -c : c;
    });
    const sp = SP.filter(s => E.gruppen.includes(s[2]));
    const kopf = (key, n) => `<th class="sortk" data-sort="${key}" style="cursor:pointer">${esc(n)}${E.sort === key ? (E.ab ? ' ▼' : ' ▲') : ''}</th>`;
    const tech = ['materialtech', 'shieldtech', 'propulsiontech', 'computertech', 'militarytech'].map(t => `${t.replace('tech', '')} ${Math.max(1, F[t] || 1)}`).join(' · ');
    const wahl = E.wahl && HZ_EINHEITEN.units[E.wahl] ? zeile(E.wahl, HZ_EINHEITEN.units[E.wahl], F) : null;
    $('#view').innerHTML = `<div class="card">
      <div class="row between"><h2>Einheiten</h2><span class="small muted">${alle.length} ${E.art === 'ship' ? 'Schiffe' : 'Verteidigungsanlagen'} · gezeigt ${z.length}</span></div>
      <div class="row" style="gap:8px;flex-wrap:wrap;margin:6px 0">
        <select id="einArt"><option value="ship"${E.art === 'ship' ? ' selected' : ''}>Schiffe</option><option value="defence"${E.art === 'defence' ? ' selected' : ''}>Verteidigung</option></select>
        <select id="einKl"><option value="">alle Klassen</option>${klassen.map(k => `<option${k === E.klasse ? ' selected' : ''}>${esc(k)}</option>`).join('')}</select>
        <input id="einQ" type="search" placeholder="Kürzel oder Name" value="${esc(E.suche)}" style="min-width:160px">
        <select id="einStand"><option value="unser"${E.stand === 'unser' ? ' selected' : ''}>Werte: unser Stand</option><option value="grund"${E.stand === 'grund' ? ' selected' : ''}>Werte: Grundwert</option></select>
        ${GRUPPEN.map(([g, n]) => `<label class="small"><input type="checkbox" class="einGr" value="${g}"${E.gruppen.includes(g) ? ' checked' : ''}> ${n}</label>`).join('')}
      </div>
      <p class="small muted">Grundwerte aus getData (15.10., auf Forschung Stufe 1 zurückgerechnet), unser Stand selbst gerechnet mit ${live.ok ? `Live-Stand ${esc(when(live.at))}` : 'Stufe 1 (kein Live-Stand)'}: ${esc(tech)}.
        <sup>*</sup> = Kosten/Tonnage ungeprüft (Wiki/ships.json), live sobald baubar. Tippen auf eine Zeile zeigt alle Werte.</p>
      <div style="overflow-x:auto"><table class="small" id="einTab"><thead><tr>${kopf('kuerzel', 'Kürzel')}${kopf('name', 'Name')}${kopf('klasse', 'Klasse')}${sp.map(s => kopf(s[0], s[1])).join('')}</tr></thead>
        <tbody>${z.map(r => `<tr data-k="${esc(r.k)}" style="cursor:pointer${r.k === E.wahl ? ';background:var(--sel, rgba(127,127,127,.15))' : ''}"><td><b>${esc(r.k)}</b>${r.u.live ? ' <span class="ok" title="live geprüft">✓</span>' : ''}</td><td>${esc(r.u.name || '')}</td><td class="small">${esc(r.u.class || '')}</td>${sp.map(s => zelle(r, s)).join('')}</tr>`).join('')}</tbody></table></div>
    </div>${wahl ? detail(wahl, F) : ''}`;
    $('#einArt').onchange = e => { E.art = e.target.value; E.klasse = ''; merke(); render(); };
    $('#einKl').onchange = e => { E.klasse = e.target.value; merke(); render(); };
    $('#einStand').onchange = e => { E.stand = e.target.value; merke(); render(); };
    $('#einQ').oninput = e => { E.suche = e.target.value; merke(); clearTimeout(render.t); render.t = setTimeout(() => { render(); const i = $('#einQ'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); };
    document.querySelectorAll('.einGr').forEach(c => c.onchange = () => { E.gruppen = [...document.querySelectorAll('.einGr:checked')].map(x => x.value); merke(); render(); });
    document.querySelectorAll('#einTab th.sortk').forEach(th => th.onclick = () => { const k = th.dataset.sort; E.ab = E.sort === k ? !E.ab : false; E.sort = k; merke(); render(); });
    document.querySelectorAll('#einTab tbody tr').forEach(tr => tr.onclick = () => { E.wahl = tr.dataset.k === E.wahl ? null : tr.dataset.k; merke(); render(); if (E.wahl) $('#einDetail')?.scrollIntoView({ behavior: 'smooth' }); });
    const zu = $('#einZu'); if (zu) zu.onclick = () => { E.wahl = null; merke(); render(); };
  }

  window.viewEinheiten = async function (rest) {
    if (typeof HZ_EINHEITEN === 'undefined' || typeof HzEinheiten === 'undefined') throw new Error('Einheiten-Daten fehlen (einheiten-daten.js)');
    if (rest?.[0] && HZ_EINHEITEN.units[rest[0].toUpperCase()]) { E.wahl = rest[0].toUpperCase(); E.art = HZ_EINHEITEN.units[E.wahl].kind; }
    live = await liveStand();
    render();
  };
})();
