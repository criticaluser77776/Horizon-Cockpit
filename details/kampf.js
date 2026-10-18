'use strict';
/* Horizon Atlas – Reiter Kampf (D7.3, 18.10.2026): Kampfsimulator im Browser, nur Rechnung – keine Live-Aktion.
   Rechenkern kampfkern.js ist aus analyse/kampfsim/hgamebattle.js + bewertung.js gebaut (analyse/kampfsim/build_browser.js,
   Test kampfkern.test.js), Läufe im Web Worker kampfworker.js. Seite 0 = Verteidiger, Seite 1 = Angreifer; je Seite Teilflotten
   mit eigenen Reglern (−4 … +4 = −100 … +100) und Forschung (Voreinstellung: unser Techstand aus dem neuesten Live-Stand,
   Gegner ±3). Bewertung nach doku/wissen/kampfsystem.md Abschnitt 11: Aufwand gegen Ertrag in Rohstoffen (E+M+T).
   Eingaben bleiben im Browser (localStorage hz.kampf).
   D7.4 (18.10.2026): eigene Schiffe/Verteidigung aus dem neuesten Live-Stand (state_latest → empire.ships/defence, je Planet
   oder alle) als Seite übernehmen, benannte Szenarien im Browser (localStorage hz.kampf.szenarien), Angriffssuche
   (bewertung.besterAngriff) gegen die Verteidigerseite. */
(function () {
  const TECH = [['ShieldTech', 'Schildtechnik'], ['MaterialTech', 'Materialtechnik'], ['ComputerTech', 'Computertechnik'],
    ['MilitaryTech', 'Militärtechnik'], ['MissileTech', 'Raketentechnik'], ['LaserTech', 'Lasertechnik'], ['IonTech', 'Ionentechnik'],
    ['PlasmaTech', 'Plasmatechnik'], ['ProtonTech', 'Protonentechnik'], ['SensorTech', 'Sensortechnik'], ['StealthTech', 'Tarntechnik']];
  const SEITE = ['Verteidiger', 'Angreifer'];
  const PROFILE = [['0', 'unser Techstand'], ['-3', 'unser −3'], ['-2', 'unser −2'], ['-1', 'unser −1'], ['1', 'unser +1'], ['2', 'unser +2'], ['3', 'unser +3'], ['eigen', 'eigene Werte']];
  const LS = 'hz.kampf', LS_SZ = 'hz.kampf.szenarien';
  let kernP = null, worker = null, wid = 0;
  const offen = {};
  let unser = null;            // { stufen, at, schiffe, verteidigung } – schiffe/verteidigung: { planets, items: [{type, values, sum}] }
  let K = null;                // Eingaben
  let erg = null, def = null, angr = null;  // letzte Ergebnisse
  let szName = '', szWahl = '';

  // ---------- Kern und Worker ----------
  function skript(src) {
    return new Promise((ok, err) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => err(new Error(src + ' nicht geladen')); document.head.appendChild(s); });
  }
  const kern = () => kernP || (kernP = skript('kampfkern.js').then(() => window.HzKampf));
  function neuerWorker() {
    try {
      worker = new Worker('kampfworker.js');
      worker.onmessage = e => { const p = offen[e.data.id]; delete offen[e.data.id]; if (p) e.data.fehler ? p.err(new Error(e.data.fehler)) : p.ok(e.data.ok); };
      worker.onerror = e => { e.preventDefault?.(); worker = false; for (const k of Object.keys(offen)) { offen[k].err(new Error('Worker fehlgeschlagen – bitte erneut starten')); delete offen[k]; } };
    } catch { worker = false; }
  }
  async function rechne(art, args) {
    if (worker == null) neuerWorker();
    if (worker) return new Promise((ok, err) => { const id = ++wid; offen[id] = { ok, err }; worker.postMessage({ id, art, args }); });
    if (!window.HzKampfRechne) await skript('kampfworker.js');   // Rückfall: im Hauptfenster (blockiert kurz)
    await new Promise(r => setTimeout(r, 30));
    return window.HzKampfRechne(art, args);
  }
  function abbrechen() {
    if (worker) worker.terminate();
    worker = null;
    for (const k of Object.keys(offen)) { offen[k].err(new Error('abgebrochen')); delete offen[k]; }
  }

  // ---------- Eingaben ----------
  const leer = () => ({ sa: 0, fr: 0, units: [['', 0]] });
  function start() {
    return {
      seiten: [{ profil: '0', research: {}, flotten: [{ sa: 0, fr: 0, units: [['SITU', 30], ['SISA', 10]] }] },
        { profil: '0', research: {}, flotten: [{ sa: 0, fr: 0, units: [['DSTR', 5]] }] }],
      n: 100, seed: 1, runden: 25, ungeschuetzt: 50000, treibstoff: 0, gegner: 1, empf: true, defN: 15,
    };
  }
  function laden() {
    try { const x = JSON.parse(localStorage.getItem(LS) || 'null'); if (x?.seiten?.length === 2) return { ...start(), ...x }; } catch { /* egal */ }
    return start();
  }
  const sichern = () => { try { localStorage.setItem(LS, JSON.stringify(K)); } catch { /* egal */ } };
  const ganz = (v, min, max, d) => { v = Math.round(+v); return isFinite(v) ? Math.min(max, Math.max(min, v)) : d; };

  // ---------- Szenarien (D7.4): benannte Eingaben, nur in diesem Browser ----------
  function szenarien() {
    try { const x = JSON.parse(localStorage.getItem(LS_SZ) || 'null'); return x && typeof x === 'object' ? x : {}; } catch { return {}; }
  }
  const szSichern = x => { try { localStorage.setItem(LS_SZ, JSON.stringify(x)); return true; } catch { return false; } };

  // ---------- Live-Stand (D7.4): Schiffe/Verteidigung je Planet (Collector: empire.ships/defence = {planets, items: [{type, values}]}) ----------
  // type ist das Kürzel (Zeilenkopf der Übersicht stat_main.php?cmd=overview); zur Sicherheit auch der Name.
  function liveEinheiten(H, i, planet) {
    const quellen = [unser?.schiffe, i === 0 ? unser?.verteidigung : null].filter(Boolean);
    const nachName = Object.fromEntries(Object.entries(H.CU.units).map(([k, u]) => [String(u.name).toLowerCase(), k]));
    const units = {}, fremd = [];
    for (const q of quellen) for (const it of q.items || []) {
      const v = it.values || [];
      const n = planet < 0 ? (it.sum ?? v.reduce((a, b) => a + (+b || 0), 0)) : +v[planet] || 0;
      if (!(n > 0)) continue;
      const t = String(it.type || '').trim(), k = H.CU.units[t.toUpperCase()] ? t.toUpperCase() : nachName[t.toLowerCase()];
      if (k) units[k] = (units[k] || 0) + n; else fremd.push(t);
    }
    return { units: Object.entries(units), fremd };
  }
  const livePlaneten = () => (unser?.schiffe?.planets?.length ? unser.schiffe.planets : unser?.verteidigung?.planets) || [];

  function profilSetzen(seite) {
    if (seite.profil === 'eigen') return;
    const d = +seite.profil, s = unser?.stufen || {};
    seite.research = Object.fromEntries(TECH.map(([t]) => {
      const b = s[t] ?? 1;
      // ±d nur auf die neun Kampfforschungen (wie bewertung.forschungPlus); Sensor/Tarnung bleiben auf unserem Stand
      return [t, ['SensorTech', 'StealthTech'].includes(t) ? b : Math.max(1, b + d)];
    }));
  }

  // Seite für battle(): Teilflotten mit Reglern (Stufe × 25), gleiche Kürzel einer Teilflotte zusammengezählt
  function seiteFuerKampf(s) {
    const flotten = s.flotten.map(f => {
      const units = {};
      for (const [k, n] of f.units) if (k && n > 0) units[k] = (units[k] || 0) + n;
      return { units, mods: { SpeedAccuracy: f.sa * 25, FirepowerRange: f.fr * 25 } };
    }).filter(f => Object.keys(f.units).length);
    return { flotten, research: { ...s.research } };
  }

  // ---------- Darstellung ----------
  let OPTS = '';
  function optionen(H) {
    const gruppen = {};
    for (const [k, u] of Object.entries(H.CU.units)) {
      const g = `${u.kind === 'ship' ? 'Schiffe' : 'Verteidigung'} · ${u.class}`;
      (gruppen[g] = gruppen[g] || []).push([k, u]);
    }
    return Object.entries(gruppen).sort(([a], [b]) => a.localeCompare(b, 'de')).map(([g, l]) =>
      `<optgroup label="${esc(g)}">${l.sort(([a], [b]) => a.localeCompare(b)).map(([k, u]) =>
        `<option value="${k}">${k} – ${esc(u.name)}${u.cost ? '' : ' (ohne Kosten)'}${u.weapons.length ? '' : ' (unbewaffnet)'}</option>`).join('')}</optgroup>`).join('');
  }
  const regler = (i, j, feld, v, titel) => `<label class="small" title="${titel}">${feld === 'sa' ? 'Tempo/Genauigkeit' : 'Feuerkraft/Reichweite'}
    <span class="row nowrap"><input type="range" min="-4" max="4" step="1" value="${v}" data-f="${feld}" data-i="${i}" data-j="${j}"><b class="kreg">${v > 0 ? '+' : ''}${v}</b></span></label>`;

  const zeilenKosten = (H, B, k, n) => k && n > 0 && H.CU.units[k]?.cost ? n * B.kosten(k) : 0;
  const seitenKosten = (H, B, s) => s.flotten.reduce((sum, f) => sum + f.units.reduce((a, [k, n]) => a + zeilenKosten(H, B, k, n), 0), 0);
  function seiteHtml(H, B, i) {
    const s = K.seiten[i];
    const kosten = seitenKosten(H, B, s);
    const fl = s.flotten.map((f, j) => `<div class="kfl">
      <div class="row between"><b class="small">Teilflotte ${j + 1}</b>${s.flotten.length > 1 ? `<button class="link small" data-act="delfl" data-i="${i}" data-j="${j}">entfernen</button>` : ''}</div>
      <div class="pdf">${regler(i, j, 'sa', f.sa, 'SpeedAccuracy: + schneller, aber ungenauer; − langsamer und schwerer zu treffen')}${regler(i, j, 'fr', f.fr, 'FirepowerRange: + mehr Schaden, weniger Reichweite; − umgekehrt')}</div>
      <table class="small kunits">${f.units.map(([k, n], r) => `<tr>
        <td><select data-f="unit" data-i="${i}" data-j="${j}" data-r="${r}"><option value="">– Einheit –</option>${OPTS.replace(`value="${k}"`, `value="${k}" selected`)}</select></td>
        <td><input type="number" min="0" step="1" class="pdn" value="${n || ''}" placeholder="Anzahl" data-f="num" data-i="${i}" data-j="${j}" data-r="${r}"></td>
        <td class="num muted kz">${zeilenKosten(H, B, k, n) ? fmt(zeilenKosten(H, B, k, n)) : ''}</td>
        <td><button class="link" data-act="delu" data-i="${i}" data-j="${j}" data-r="${r}" title="Zeile entfernen">✕</button></td></tr>`).join('')}</table>
      <button class="small" data-act="addu" data-i="${i}" data-j="${j}">+ Einheit</button></div>`).join('');
    const forsch = TECH.map(([t, n]) => `<label>${esc(n)}<input type="number" min="1" max="40" class="pdn" value="${s.research[t] ?? 1}" data-f="tech" data-t="${t}" data-i="${i}"></label>`).join('');
    return `<div class="card"><h2>${SEITE[i]} <span class="small muted">${i === 0 ? 'Position 0, fliegt +1' : 'Position 1000, fliegt −1'}</span>
        ${K.gegner === i ? '<span class="tag">Gegner</span>' : ''}</h2>
      ${liveHtml(i)}
      ${fl}<p><button class="small" data-act="addfl" data-i="${i}">+ Teilflotte</button> <span class="small muted">Baukosten <span data-kosten="${i}">${fmt(kosten)}</span> Rohstoffe</span></p>
      <details class="sub"${K.offenForschung ? ' open' : ''}><summary class="small">Forschung: <select data-f="profil" data-i="${i}">${PROFILE.map(([v, l]) => `<option value="${v}"${s.profil === v ? ' selected' : ''}>${l}</option>`).join('')}</select></summary>
        <div class="pdf" style="margin-top:6px">${forsch}</div></details></div>`;
  }

  function liveHtml(i) {
    if (!unser?.schiffe && !unser?.verteidigung) return '<p class="small muted">Eigene Einheiten: kein Live-Stand mit Schiffen/Verteidigung.</p>';
    const pl = livePlaneten(), wahl = K.seiten[i].planet ?? -1;
    return `<p class="small row">Eigene ${i === 0 ? 'Schiffe + Verteidigung' : 'Schiffe'} aus dem Live-Stand:
      <select data-f="lp" data-i="${i}"><option value="-1">alle Planeten</option>${pl.map((p, x) => `<option value="${x}"${wahl === x ? ' selected' : ''}>${esc(p.coords || '')} ${esc(p.name || '')}</option>`).join('')}</select>
      <button class="small" data-act="live" data-i="${i}" title="ersetzt die Teilflotten dieser Seite; Forschung: unser Techstand">übernehmen</button></p>`;
  }

  const pct = x => `${fmt(x * 100, 0)} %`;
  function ergebnisHtml(H, B) {
    if (!erg) return '<p class="small muted">Noch nicht gerechnet.</p>';
    if (erg.fehler) return `<p class="err small">${esc(erg.fehler)}</p>`;
    const { q, median, empf, ms, seiten, opts } = erg;
    const m = q.mittel;
    const units = seiten.map(B.einheitenSeite);
    const laderaum = Object.entries(units[1]).reduce((s, [k, n]) => s + n * (H.CU.units[k].cargo || 0), 0);
    const sonst = Math.min(laderaum, opts.ungeschuetzt);
    const ohneKosten = [...new Set(units.flatMap(u => Object.keys(u).filter(k => !H.CU.units[k].cost)))];
    const angriffLohnt = m.angriffSaldo > 0, defLohnt = m.verteidigungEffektiv < sonst;
    const zeile = (l, v, cls = '') => `<tr><td>${l}</td><td class="num ${cls}">${v}</td></tr>`;
    const emp = Object.keys(empf || {}).length ? `<h3>Empfindlichkeit (${SEITE[opts.gegner]} = Gegner, Kampfforschungen ±3)</h3>
      <table class="small wide"><thead><tr><th>Gegner</th><th class="num">Verteidiger gewinnt</th><th class="num">Angreifer gewinnt</th><th class="num">Ø Verlust V</th><th class="num">Ø Verlust A</th><th class="num">Ø Saldo Angriff</th></tr></thead><tbody>
      ${[['−3', empf[-3]], ['±0', q], ['+3', empf[3]]].map(([d, x]) => `<tr><td>${d}</td><td class="num">${pct(x.quoteVerteidiger)}</td><td class="num">${pct(x.quoteAngreifer)}</td>
        <td class="num">${fmt(x.mittel.verlustVerteidiger)}</td><td class="num">${fmt(x.mittel.verlustAngreifer)}</td><td class="num">${fmt(x.mittel.angriffSaldo)}</td></tr>`).join('')}</tbody></table>` : '';
    const rest = [0, 1].map(i => Object.entries(seiten[i].flotten.reduce((a, f, j) => {
      for (const [k, n] of Object.entries(f.units)) a[j ? `${k}#${j + 1}` : k] = n;
      return a;
    }, {})).map(([k, n]) => `<tr><td>${SEITE[i]}</td><td>${esc(k)}</td><td class="num">${fmt(n)}</td><td class="num">${fmt(median.rest[i][k] ?? 0)}</td></tr>`).join('')).join('');
    return `<div class="kerg">
      <div class="kpis"><div><span class="small muted">Verteidiger gewinnt</span><b>${pct(q.quoteVerteidiger)}</b></div>
        <div><span class="small muted">Angreifer gewinnt</span><b>${pct(q.quoteAngreifer)}</b></div>
        <div><span class="small muted">unentschieden</span><b>${pct(q.unentschieden / q.n)}</b></div></div>
      <p class="small muted">${fmt(q.n)} Läufe (Seed ${opts.seed} …), ${opts.runden} Runden, ${fmt(ms)} ms. Unentschieden = nach ${opts.runden} Runden haben beide Seiten noch Einheiten.</p>
      <table class="small wide"><tbody>
        ${zeile('Ø Verlust Verteidiger (Baukosten)', fmt(m.verlustVerteidiger))}
        ${zeile('Ø effektiver Verlust Verteidiger (ohne sofortigen Wiederaufbau: Boden 30 %, Satelliten 50 %, Minen 80 %)', fmt(m.verteidigungEffektiv))}
        ${zeile('Ø Verlust Angreifer (Baukosten)', fmt(m.verlustAngreifer))}
        ${zeile(`Ø Beute (Laderaum nach dem Kampf, höchstens ${fmt(opts.ungeschuetzt)} ungeschützt)`, fmt(m.beute))}
        ${zeile(`Ø Saldo Angriff = Beute − Verlust − Treibstoff (${fmt(opts.treibstoff)})`, fmt(m.angriffSaldo), m.angriffSaldo > 0 ? 'ok' : 'err')}
      </tbody></table>
      <h3>Bewertung (kampfsystem.md Abschnitt 11)</h3>
      <ul class="small">
        <li><b>Angriff ${angriffLohnt ? '<span class="ok">lohnt</span>' : '<span class="err">lohnt nicht</span>'}:</b> erwartete Beute ${fmt(m.beute)} ${angriffLohnt ? '>' : '≤'} Verluste + Treibstoff ${fmt(m.verlustAngreifer + opts.treibstoff)}.</li>
        <li><b>Verteidigung ${defLohnt ? '<span class="ok">lohnt</span>' : '<span class="err">lohnt nicht</span>'}:</b> effektiver Verlust ${fmt(m.verteidigungEffektiv)} ${defLohnt ? '<' : '≥'} sonst geraubt ${fmt(sonst)}
          (ungeschützte Rohstoffe, begrenzt durch den Laderaum der Angreifer ${fmt(laderaum)}).
          ${q.quoteVerteidiger > 0.5 ? 'Sie gewinnt mehrheitlich.' : 'Sie gewinnt <b>nicht</b> mehrheitlich.'}</li>
        ${ohneKosten.length ? `<li class="muted">Ohne bekannte Kosten (zählen mit 0): ${ohneKosten.map(esc).join(', ')}.</li>` : ''}
      </ul>${emp}
      <details class="sub"><summary class="small muted">Einzelner Kampf mit Median-Zufall (wie der offizielle Simulator): ${median.sieger === 0 ? 'Verteidiger siegt' : median.sieger === 1 ? 'Angreifer siegt' : 'unentschieden'}, ${median.viertelrunden} Viertelrunden</summary>
        <table class="small wide"><thead><tr><th>Seite</th><th>Einheit</th><th class="num">vorher</th><th class="num">übrig</th></tr></thead><tbody>${rest}</tbody></table></details></div>`;
  }

  function defHtml(B) {
    if (!def) return '';
    if (def.laeuft) return '<p class="small muted">Suche läuft …</p>';
    if (def.fehler) return `<p class="err small">${esc(def.fehler)}</p>`;
    const l = def.loesungen.slice(0, 8);
    return `<p class="small muted">Angreifer kostet ${fmt(def.angreiferKosten)}. Je Anlage die kleinste Anzahl mit Gewinnquote > 50 % (${K.defN} Läufe je Test), dazu Paare der drei günstigsten; ${fmt(def.ms)} ms.</p>
      ${l.length ? `<table class="small wide"><thead><tr><th>Verteidigung</th><th class="num">Kosten</th><th></th></tr></thead><tbody>${l.map((x, i) =>
        `<tr><td>${Object.entries(x.units).map(([k, n]) => `${fmt(n)}× ${esc(k)}`).join(' + ')}${i === 0 && def.beste?.quote ? ` <span class="muted">(Nachprüfung ${def.beste.quote.n} Läufe: ${pct(def.beste.quote.quoteVerteidiger)})</span>` : ''}</td>
        <td class="num">${fmt(x.kosten)}</td><td><button class="small" data-act="uebernehmen" data-x="${i}">als Verteidiger übernehmen</button></td></tr>`).join('')}</tbody></table>`
        : '<p class="small">Keine Verteidigung bis 5 Mio. Rohstoffe gewinnt mehrheitlich.</p>'}`;
  }

  function angrHtml() {
    if (!angr) return '';
    if (angr.laeuft) return '<p class="small muted">Suche läuft …</p>';
    if (angr.fehler) return `<p class="err small">${esc(angr.fehler)}</p>`;
    const l = angr.ergebnisse.slice(0, 8);
    return `<p class="small muted">${fmt(angr.anzahl)} Flotten getestet (${K.defN} Läufe je Test), ${fmt(angr.ms)} ms.
      ${angr.lohnt ? '<span class="ok">Ein Angriff lohnt sich.</span>' : '<span class="err">Kein getesteter Angriff lohnt sich (Saldo ≤ 0).</span>'}</p>
      ${l.length ? `<table class="small wide"><thead><tr><th>Angreifer</th><th class="num">Kosten</th><th class="num">gewinnt</th><th class="num">Ø Beute</th><th class="num">Ø Verlust</th><th class="num">Ø Saldo</th><th></th></tr></thead><tbody>${l.map((x, i) =>
        `<tr><td>${Object.entries(x.units).map(([k, n]) => `${fmt(n)}× ${esc(k)}`).join(' + ')}</td><td class="num">${fmt(x.kosten)}</td><td class="num">${pct(x.quoteAngreifer)}</td>
        <td class="num">${fmt(x.beute)}</td><td class="num">${fmt(x.verlust)}</td><td class="num ${x.saldo > 0 ? 'ok' : 'err'}">${fmt(x.saldo)}</td>
        <td><button class="small" data-act="angrUebernehmen" data-x="${i}">als Angreifer übernehmen</button></td></tr>`).join('')}</tbody></table>` : ''}`;
  }

  async function render() {
    const { H, B } = await kern();
    if (!OPTS) OPTS = optionen(H);
    $('#view').innerHTML = `<div class="kampf">
      <div class="card"><h2>Kampfsimulator <span class="small muted">Nachbau des offiziellen Simulators, Daten Runde 8 (${H.CU.units ? Object.keys(H.CU.units).length : 0} Einheiten)</span></h2>
        <p class="small muted">Nur Rechnung im Browser, keine Aktion im Spiel. Forschung „unser Techstand“: ${unser ? `Live-Stand ${esc(when(unser.at))}` : 'kein Live-Stand gefunden – alle Stufen 1'}.
        Bewertet wird Aufwand gegen Ertrag in Rohstoffen (E+M+T), nicht der Sieg an sich.</p>
        <p class="small muted"><b>Genauigkeit</b> (Eichung an 12 Zeitungsberichten, kampfsystem.md Abschnitt 13): Gewinnquoten brauchbar, die
        <b>Verluste des Siegers eher zu niedrig</b> – der Simulator unterschätzt den Schaden des Verlierers; wenige robuste Schiffe
        (z. B. 5–10 DSTR) verlieren hier oft alles oder nichts. Knappe Ergebnisse mit „Gegner ±3“ gegenprüfen.</p>
        <div class="pdf">
          <label>Läufe (Monte-Carlo)<input type="number" min="1" max="5000" class="pdn" value="${K.n}" data-f="opt" data-o="n"></label>
          <label>Seed<input type="number" min="1" class="pdn" value="${K.seed}" data-f="opt" data-o="seed"></label>
          <label>Runden<input type="number" min="1" max="100" class="pdn" value="${K.runden}" data-f="opt" data-o="runden"></label>
          <label>ungeschützte Rohstoffe Verteidiger<input type="number" min="0" step="1000" class="pdn" style="width:9em" value="${K.ungeschuetzt}" data-f="opt" data-o="ungeschuetzt"></label>
          <label>Treibstoff Angreifer<input type="number" min="0" step="100" class="pdn" value="${K.treibstoff}" data-f="opt" data-o="treibstoff"></label>
          <label>Gegner ist<select data-f="opt" data-o="gegner">${SEITE.map((s, i) => `<option value="${i}"${K.gegner === i ? ' selected' : ''}>${s}</option>`).join('')}</select></label>
          <label class="pdchk"><input type="checkbox" data-f="empf"${K.empf ? ' checked' : ''}> Gegner ±3 mitrechnen</label>
          <span class="row nowrap"><button class="primary" data-act="los">Simulieren</button><button data-act="stopp" title="laufende Rechnung abbrechen">Abbrechen</button><button data-act="reset" title="Eingaben zurücksetzen">Zurücksetzen</button></span>
        </div>
        <div class="pdf ksz"><label>Szenario<select data-f="szwahl"><option value="">– gespeicherte –</option>${Object.entries(szenarien())
          .sort(([a], [b]) => a.localeCompare(b, 'de')).map(([n, x]) => `<option value="${esc(n)}"${szWahl === n ? ' selected' : ''}>${esc(n)} (${esc(when(x.at))})</option>`).join('')}</select></label>
          <span class="row nowrap"><button data-act="szload">Laden</button><button data-act="szdel">Löschen</button></span>
          <label>Name<input type="text" maxlength="60" value="${esc(szName)}" placeholder="z. B. Raubzug Nachbar" data-f="szname"></label>
          <button data-act="szsave" title="aktuelle Eingaben unter diesem Namen speichern (nur in diesem Browser)">Speichern</button></div></div>
      <div class="cols2">${seiteHtml(H, B, 0)}${seiteHtml(H, B, 1)}</div>
      <div class="cols2"><div class="card"><h2>Ergebnis</h2><div id="kErg">${erg?.laeuft ? '<p class="small muted">Rechnet …</p>' : ergebnisHtml(H, B)}</div></div>
        <div class="card"><h2>Optimale Verteidigung</h2>
          <p class="small muted">Günstigste Verteidigung (Boden + Orbit), die gegen die Angreiferflotte mehrheitlich gewinnt – mit der Forschung beider Seiten von oben.
          Teilflotten des Angreifers werden dafür zusammengelegt, ohne Regler.</p>
          <div class="pdf"><label>Läufe je Test<input type="number" min="5" max="200" class="pdn" value="${K.defN}" data-f="opt" data-o="defN"></label>
            <button data-act="def">Suchen</button></div><div id="kDef">${defHtml(B)}</div></div></div>
      <div class="card"><h2>Bester Angriff</h2>
        <p class="small muted">Angriffsflotte mit dem größten Erwartungswert Beute − Verluste − Treibstoff gegen den Verteidiger von oben (Teilflotten zusammengelegt,
        ohne Regler) und die ungeschützten Rohstoffe; je Schiffstyp Anzahlen 1, 2, 3, 5, 8 … bis 5 Mio. Rohstoffe, fehlender Laderaum mit Transportern (LTRN) aufgefüllt.
        Forschung beider Seiten von oben, Läufe je Test wie bei der Verteidigungssuche. Dauert einige Sekunden.</p>
        <div class="pdf"><button data-act="angr">Suchen</button></div><div id="kAngr">${angrHtml()}</div></div></div>`;
  }

  // ---------- Bedienung ----------
  function onInput(e) {
    const el = e.target, f = el.dataset.f;
    if (!f) return;
    const i = +el.dataset.i, j = +el.dataset.j, r = +el.dataset.r;
    const s = K.seiten[i];
    if (f === 'num') {
      const u = s.flotten[j].units[r];
      u[1] = ganz(el.value, 0, 1e9, 0);
      const { H, B } = window.HzKampf, z = zeilenKosten(H, B, u[0], u[1]);
      el.closest('tr').querySelector('.kz').textContent = z ? fmt(z) : '';
      $(`[data-kosten="${i}"]`).textContent = fmt(seitenKosten(H, B, s));
    }
    else if (f === 'unit') { s.flotten[j].units[r][0] = el.value; if (!s.flotten[j].units[r][1]) s.flotten[j].units[r][1] = 1; }
    else if (f === 'sa' || f === 'fr') { s.flotten[j][f] = ganz(el.value, -4, 4, 0); el.nextElementSibling.textContent = (s.flotten[j][f] > 0 ? '+' : '') + s.flotten[j][f]; }
    else if (f === 'tech') {
      s.research[el.dataset.t] = ganz(el.value, 1, 40, 1);
      if (s.profil !== 'eigen') { s.profil = 'eigen'; const sel = el.closest('details').querySelector('[data-f="profil"]'); if (sel) sel.value = 'eigen'; }
    } else if (f === 'profil') { s.profil = el.value; profilSetzen(s); K.offenForschung = true; }
    else if (f === 'opt') K[el.dataset.o] = ganz(el.value, el.dataset.o === 'ungeschuetzt' || el.dataset.o === 'treibstoff' ? 0 : el.dataset.o === 'gegner' ? 0 : 1, { n: 5000, runden: 100, defN: 200, gegner: 1 }[el.dataset.o] ?? 1e12, K[el.dataset.o]);
    else if (f === 'empf') K.empf = el.checked;
    else if (f === 'lp') s.planet = ganz(el.value, -1, 999, -1);
    else if (f === 'szname') { szName = el.value; return; }
    else if (f === 'szwahl') {
      szWahl = el.value;
      const n = $('[data-f="szname"]');
      if (szWahl) { szName = szWahl; if (n) n.value = szWahl; }
      return;
    }
    sichern();
    if (e.type === 'change' && (['unit', 'profil'].includes(f) || el.dataset.o === 'gegner')) render();
  }

  async function onClick(e) {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act, i = +b.dataset.i, j = +b.dataset.j, r = +b.dataset.r;
    const { B } = await kern();
    if (act === 'addu') K.seiten[i].flotten[j].units.push(['', 0]);
    else if (act === 'delu') { K.seiten[i].flotten[j].units.splice(r, 1); if (!K.seiten[i].flotten[j].units.length) K.seiten[i].flotten[j].units.push(['', 0]); }
    else if (act === 'addfl') K.seiten[i].flotten.push(leer());
    else if (act === 'delfl') K.seiten[i].flotten.splice(j, 1);
    else if (act === 'reset') { K = start(); K.seiten.forEach(profilSetzen); erg = def = angr = null; }
    else if (act === 'stopp') { abbrechen(); if (erg?.laeuft) erg = null; if (def?.laeuft) def = null; if (angr?.laeuft) angr = null; }
    else if (act === 'live') {
      const { units, fremd } = liveEinheiten(window.HzKampf.H, i, K.seiten[i].planet ?? -1);
      if (!units.length) return toast(`Im Live-Stand sind dort keine Schiffe${i === 0 ? ' oder Verteidigungsanlagen' : ''}.`);
      K.seiten[i].flotten = [{ sa: 0, fr: 0, units }];
      K.seiten[i].profil = '0';
      profilSetzen(K.seiten[i]);
      erg = null;
      if (fremd.length) toast(`Nicht im Simulator (ausgelassen): ${fremd.join(', ')}`);
    } else if (act === 'szsave') {
      const name = szName.trim();
      if (!name) return toast('Bitte einen Namen für das Szenario eingeben.');
      const alle = szenarien();
      if (alle[name] && !confirm(`Szenario „${name}“ überschreiben?`)) return;
      alle[name] = { at: new Date().toISOString(), K: JSON.parse(JSON.stringify(K)) };
      if (!szSichern(alle)) return toast('Speichern im Browser nicht möglich.');
      szWahl = name;
      toast(`Szenario „${name}“ gespeichert (nur in diesem Browser).`);
    } else if (act === 'szload' || act === 'szdel') {
      const alle = szenarien(), x = alle[szWahl];
      if (!x) return toast('Bitte zuerst ein gespeichertes Szenario wählen.');
      if (act === 'szdel') {
        if (!confirm(`Szenario „${szWahl}“ löschen?`)) return;
        delete alle[szWahl];
        szSichern(alle);
        szWahl = '';
      } else {
        K = { ...start(), ...JSON.parse(JSON.stringify(x.K)) };
        K.seiten.forEach(profilSetzen);   // Profile „unser Techstand ±d“ mit dem heutigen Live-Stand, eigene Werte bleiben
        erg = def = angr = null;
        szName = szWahl;
      }
    }
    else if (act === 'uebernehmen') {
      const x = def?.loesungen?.[+b.dataset.x];
      if (x) K.seiten[0].flotten = [{ sa: 0, fr: 0, units: Object.entries(x.units) }];
    } else if (act === 'angrUebernehmen') {
      const x = angr?.ergebnisse?.[+b.dataset.x];
      if (x) K.seiten[1].flotten = [{ sa: 0, fr: 0, units: Object.entries(x.units) }];
    } else if (act === 'angr') {
      const v = seiteFuerKampf(K.seiten[0]);
      const verteidigung = B.einheitenSeite(v);
      if (!Object.keys(verteidigung).length) return toast('Der Verteidiger braucht mindestens eine Einheit.');
      angr = { laeuft: true };
      render();
      try { angr = await rechne('angriff', { verteidigung, ungeschuetzt: K.ungeschuetzt, treibstoff: K.treibstoff, forschung: K.seiten[1].research, gegnerForschung: v.research, n: K.defN, seed: K.seed }); }
      catch (err) { angr = { fehler: err.message }; }
    } else if (act === 'los') {
      const seiten = K.seiten.map(seiteFuerKampf);
      if (seiten.some(s => !s.flotten.length)) return toast('Beide Seiten brauchen mindestens eine Einheit.');
      const opts = { n: K.n, seed: K.seed, runden: K.runden, ungeschuetzt: K.ungeschuetzt, treibstoff: K.treibstoff, gegner: K.gegner };
      erg = { laeuft: true };
      render();
      try { erg = { ...(await rechne('quote', { seiten, ...opts, empf: K.empf })), seiten, opts }; }
      catch (err) { erg = { fehler: err.message }; }
    } else if (act === 'def') {
      const a = seiteFuerKampf(K.seiten[1]);
      const angreifer = B.einheitenSeite(a);
      if (!Object.keys(angreifer).length) return toast('Der Angreifer braucht mindestens eine Einheit.');
      def = { laeuft: true };
      render();
      try { def = await rechne('def', { angreifer, forschung: K.seiten[0].research, gegnerForschung: a.research, n: K.defN, seed: K.seed }); }
      catch (err) { def = { fehler: err.message }; }
    }
    sichern();
    if (location.hash.startsWith('#/kampf')) render();
  }

  async function unserTechstand() {
    try {
      const [row] = await Cloud.q('state_latest', { account_id: `eq.${S.acc}`, kind: 'eq.live', select: 'collected_at,r:data->research->items,sh:data->empire->ships,df:data->empire->defence' });
      const items = row?.r || [];
      if (!items.length) return null;
      const lv = Object.fromEntries(items.map(x => [String(x.type).toLowerCase(), x.level]));
      return { at: row.collected_at, stufen: Object.fromEntries(TECH.map(([t]) => [t, Math.max(1, +lv[t.toLowerCase()] || 1)])),
        schiffe: row.sh?.items ? row.sh : null, verteidigung: row.df?.items ? row.df : null };
    } catch { return null; }
  }

  let gebunden = false;
  window.viewKampf = async function () {
    if (!K) K = laden();
    $('#view').innerHTML = '<p class="muted pad">Lädt Kampfsimulator …</p>';
    const [, u] = await Promise.all([kern(), unserTechstand()]);
    unser = u;
    K.seiten.forEach(profilSetzen);
    if (!gebunden) {
      gebunden = true;
      const v = $('#view');
      v.addEventListener('input', e => { if (location.hash.startsWith('#/kampf')) onInput(e); });
      v.addEventListener('change', e => { if (location.hash.startsWith('#/kampf') && e.target.dataset.f && ['unit', 'profil', 'opt', 'lp', 'szwahl'].includes(e.target.dataset.f)) onInput(e); });
      v.addEventListener('click', e => { if (location.hash.startsWith('#/kampf')) onClick(e); });
    }
    await render();
  };
})();
