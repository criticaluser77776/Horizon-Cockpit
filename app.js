'use strict';
/* Horizon-Cockpit – Fernkontrolle am Handy: Anmeldung, Account, Lage (kompakt, Notfall, Banner), Meldungen, Pläne (Freigabe, „bis #“,
   Start/Stopp), Claude, Mehr (Geräte & Rechte, Push, getData). Seit C1 der Cockpit-Aufteilung (17.10.2026) stehen Galaxie,
   Kompendium, Verbrauch, Imperium, alle Ereignisse, ältere Pläne, Abweichungsgrafik und Plan-Editor im Horizon Atlas (details/).
   Alle Daten aus Supabase (cloud.js); Texte aus der Datenbank werden immer escaped. Gemeinsame Helfer (Formate, Zeiten,
   Ereignis-Zeilen, Sitzungen, Spieldaten) seit C0 der Cockpit-Aufteilung (17.10.2026) in common.js. */


/* ---------- Start und Anmeldung ---------- */

// Installation als App: Chrome meldet beforeinstallprompt nur einmal je Seitenaufruf, deshalb früh merken
let installPrompt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; if (location.hash === '#/mehr') route(); });
window.addEventListener('appinstalled', () => { installPrompt = null; toast('Als App installiert'); });
function isStandalone() { return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; }

// Neue Version online? Der Service Worker liefert zuerst die gespeicherte Fassung und lädt die neue nur im Hintergrund
// (sichtbar erst beim übernächsten Laden). Seit dem Auto-Deploy (12.10.) kommen Versionen oft: config.js frisch lesen und
// bei höherer Nummer „Neu laden“ anbieten. Beim Start und wenn die App wieder in den Vordergrund kommt (höchstens alle 10 min).
async function checkUpdate() {
  if (location.protocol !== 'https:' || Date.now() - (checkUpdate.at || 0) < 10 * 60e3) return;
  checkUpdate.at = Date.now();
  try {
    const txt = await (await fetch('config.js', { cache: 'no-store' })).text();
    const n = +((txt.match(/APP_VERSION = \{"number": (\d+)/) || [])[1] || 0);
    if (n > (+window.APP_VERSION?.number || 0)) toast(`Neue Cockpit-Version ${n} verfügbar`, { label: 'Neu laden', run: () => location.reload() });
  } catch { /* offline */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkUpdate(); });

async function boot() {
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  setTimeout(checkUpdate, 3000);   // nach dem ersten Laden; der Service Worker hat die neue Fassung bis dahin meist geholt
  window.addEventListener('hashchange', route);
  if (!Cloud.loggedIn()) return renderLogin();
  try { await Cloud.touch(); } catch (e) {
    if (e instanceof LoginNeeded) return renderLogin(e.message);
    toast(e.message);  // offline: mit gespeichertem Stand weiter
  }
  afterLogin();
}

function afterLogin() {
  try { S.acc = localStorage.getItem('hz.acc'); } catch { /* egal */ }
  if (!accounts().some(a => a.id === S.acc)) S.acc = accounts()[0]?.id || null;
  renderAccSelect();
  if (!S.acc) return renderNoAccount();
  $('#tabs').hidden = false;
  route();
}

function renderAccSelect() {
  const a = Cloud.access();
  const list = accounts();
  $('#acc').innerHTML = !a?.code ? '' : list.length > 1
    ? `<select id="accSel">${list.map(x => `<option value="${esc(x.id)}"${x.id === S.acc ? ' selected' : ''}>${esc(x.player)} (${esc(ROLE[x.role] || x.role)})</option>`).join('')}</select>`
    : `${esc(account()?.player || a.group || '')}${account() ? ` · ${esc(ROLE[account().role] || '')}` : ''}`;
  $('#accSel')?.addEventListener('change', e => {
    S.acc = e.target.value;
    try { localStorage.setItem('hz.acc', S.acc); } catch { /* egal */ }
    renderAccSelect(); route();
  });
}

function renderLogin(msg = '') {
  $('#tabs').hidden = true; $('#acc').innerHTML = '';
  $('#view').innerHTML = `
  <div class="login stack">
    <div class="card">
      <h2>Anmelden</h2>
      <p class="muted small">Mit dem Gruppen-Code deiner Gruppe. Jedes Gerät meldet sich einmal an.</p>
      <form id="fLogin">
        <label class="f"><span>Gruppen-Code</span><input name="code" autocomplete="off" autocapitalize="characters" required></label>
        <label class="f"><span>Name dieses Geräts</span><input name="name" placeholder="z. B. Handy" required></label>
        <button class="primary">Anmelden</button> <span class="err" id="eLogin">${esc(msg)}</span>
      </form>
    </div>
    <div class="card">
      <h2>Neue Gruppe</h2>
      <p class="muted small">Nur mit einmaligem Einladungscode. Dieses Gerät wird Admin; der Gruppen-Code wird einmal angezeigt.</p>
      <form id="fGroup">
        <label class="f"><span>Einladungscode</span><input name="invite" autocomplete="off" autocapitalize="characters" required></label>
        <label class="f"><span>Name der Gruppe</span><input name="group" required></label>
        <label class="f"><span>Name dieses Geräts</span><input name="name" placeholder="z. B. Handy" required></label>
        <button class="primary">Gruppe anlegen</button> <span class="err" id="eGroup"></span>
      </form>
    </div>
  </div>`;
  $('#fLogin').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    try { await Cloud.login(f.code.value, f.name.value); afterLogin(); }
    catch (err) { $('#eLogin').textContent = err.message; }
  });
  $('#fGroup').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    try {
      const code = await Cloud.createGroup(f.invite.value, f.group.value, f.name.value);
      $('#view').innerHTML = `<div class="login card"><h2>Gruppe angelegt</h2>
        <p>Gruppen-Code (jetzt notieren, er wird nicht wieder angezeigt):</p>
        <p style="font-size:1.6rem;font-weight:700;letter-spacing:.08em">${esc(code)}</p>
        <p class="muted small">Damit melden sich weitere Geräte an: Firefox mit den Skripten, Claude-Wächter, später die Allianz.</p>
        <button class="primary" id="goOn">Weiter</button></div>`;
      $('#goOn').onclick = afterLogin;
    } catch (err) { $('#eGroup').textContent = err.message; }
  });
}

function renderNoAccount() {
  $('#tabs').hidden = true;
  $('#view').innerHTML = `
  <div class="login stack">
    <div class="card">
      <h2>Spielaccount anlegen</h2>
      <p class="muted small">Dieses Gerät wird Owner des Accounts: Es gibt Pläne frei und vergibt Rechte an Skripte und Claude.</p>
      <form id="fAcc">
        <label class="f"><span>Spielername</span><input name="player" value="Mariner77" required></label>
        <label class="f"><span>Runde</span><input name="round" value="Runde 8"></label>
        <label class="f"><span>Heimatplanet (G:S:O)</span><input name="home" value="1:156:7"></label>
        <button class="primary">Anlegen</button> <span class="err" id="eAcc"></span>
      </form>
    </div>
    <div class="card"><p class="muted small">Oder: Ein Owner gibt diesem Gerät Rechte für einen bestehenden Account
      (Mehr → Geräte &amp; Rechte). Gerät: <b>${esc(Cloud.access()?.name)}</b></p>
      <button id="reload">Neu prüfen</button> <button id="out">Abmelden</button></div>
  </div>`;
  $('#fAcc').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    try {
      S.acc = await Cloud.rpc('create_account', { p_player: f.player.value, p_round: f.round.value, p_home: f.home.value });
      try { localStorage.setItem('hz.acc', S.acc); } catch { /* egal */ }
      await Cloud.touch(); afterLogin();
    } catch (err) { $('#eAcc').textContent = err.message; }
  });
  $('#reload').onclick = async () => { await Cloud.touch().catch(e => toast(e.message)); afterLogin(); };
  $('#out').onclick = () => { Cloud.logout(); renderLogin(); };
}

/* ---------- Navigation ---------- */

// ereignisse = alter Name von Meldungen (ältere Push-Nachrichten mit „#/ereignisse“, Links in common.js)
const VIEWS = { lage: viewLage, meldungen: viewMeldungen, ereignisse: viewMeldungen, plaene: viewPlans, claude: viewClaude, mehr: viewMore };
const TAB_OF = { ereignisse: 'meldungen' };

// soft = automatische Aktualisierung: ohne „Lädt …“, die Ansicht bleibt bis zum Neuaufbau stehen
async function route(soft) {
  if (!Cloud.loggedIn() || !S.acc) return;
  const [tab = 'lage', ...rest] = location.hash.replace(/^#\/?/, '').split('/');
  const fn = VIEWS[tab] || viewLage;
  const on = VIEWS[tab] ? TAB_OF[tab] || tab : 'lage';
  document.querySelectorAll('nav.tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === on));
  if (soft !== true) $('#view').innerHTML = '<p class="muted pad">Lädt …</p>';
  try { await loadNums(); await fn(rest); } catch (e) {
    if (e instanceof LoginNeeded) return renderLogin(e.message);
    $('#view').innerHTML = `<div class="card"><p class="err">${esc(e.message)}</p><button onclick="route()">Erneut versuchen</button></div>`;
  }
  updateBadge();
}

// Lage, Pläne und Meldungen alle 30 s still neu laden (nur sichtbar, nicht während einer Eingabe oder bei aufgeklappter Liste).
// Der große Live-Stand kommt dabei nur bei neuem Zeitstempel (S.snap), sonst nur Lauf, Lebenszeichen, Ereignisse.
setInterval(() => {
  const tab = location.hash.replace(/^#\/?/, '').split('/')[0] || 'lage';
  if (document.visibilityState !== 'visible' || !['lage', 'plaene', 'meldungen', 'ereignisse'].includes(tab)) return;
  if (document.activeElement?.matches?.('input,select,textarea')) return;
  route(true);
}, 30000);

// Badge „Meldungen“ (C1): ungesehene Ereignisse „hoch“ + offene Entscheidungen
async function updateBadge() {
  try {
    const [r, dec] = await Promise.all([
      Cloud.q('events', { select: 'id', account_id: `eq.${S.acc}`, level: 'eq.hoch', seen_at: 'is.null', dismissed_at: 'is.null', limit: 99 }),
      loadDecisions('id,data:data->decision,answer:data->answer').then(l => l.map(e => ({ id: e.id, data: { decision: e.data, answer: e.answer } }))).catch(() => []),
    ]);
    const ids = new Set([...r.map(e => e.id), ...dec.filter(openDecision).map(e => e.id)]);
    $('#evBadge').hidden = !ids.size; $('#evBadge').textContent = ids.size;
  } catch { /* egal */ }
}

/* ---------- Lage ---------- */

const RES = ['Eisenerz', 'Mineral', 'Treibstoff'];

async function viewLage() {
  const acc = `eq.${S.acc}`;
  const [heads, sess, nf, effs, gds] = await Promise.all([
    Cloud.q('state_latest', { account_id: acc, kind: 'eq.live', select: 'kind,collected_at,version' }),
    loadSessions(),
    loadNotfall(),
    Cloud.q('events', { account_id: acc, kind: 'eq.bericht', 'data->effect->>until': `gt.${new Date().toISOString()}`,
      select: 'id,t,eff:data->effect', order: 't.desc', limit: 20 }).catch(() => []),
    Cloud.q('getdata_state', { account_id: acc, select: 'at,jobs,wake,expires_at,ok_at,error,error_at' }).catch(() => []),
  ]);
  // Live-Stand (ca. 35 KB) nur laden, wenn er neu ist
  const head = heads[0];
  if (head && (S.snap?.acc !== S.acc || S.snap?.at !== head.collected_at)) {
    const full = await Cloud.q('state_latest', { account_id: acc, kind: 'eq.live', select: 'collected_at,data' });
    S.snap = { acc: S.acc, at: head.collected_at, data: full[0]?.data };
  }
  const live = head ? { collected_at: head.collected_at } : null;
  const d = head ? S.snap?.data : null;
  // jüngster Stand des Autobuilders (laufende Aufträge, Rohstoffe aus seiner letzten Prüfung)
  const abLive = sess.devs.map(x => x.ab?.state).filter(s => s?.liveAt).sort((a, b) => b.liveAt - a.liveAt)[0] || null;
  // C1 (17.10.2026): Lage kompakt – Überblick (mit getData und Effekten in je einer Zeile), Steuerung, Banner.
  // Planeten, Gebäude/Forschung/Funktionen und die volle getData-Karte stehen im Horizon Atlas unter Imperium.
  const W = await loadWissen().catch(() => null);  // Namen für noch nicht gebaute Stufen, Baustellen je Stufe
  S.build = liveBuild(live, abLive, gds[0]);
  const nm = (i, set) => i.name || W?.[set]?.[i.type]?.n || i.type;
  $('#view').innerHTML = overviewCard(sess, d, live, abLive, nm, W, gdLine(gds[0]) + effectsLine(effs)) + notfallCard(sess, nf, d) + bannerCard(sess)
    + '<p class="small muted pad">Planeten, Gebäude, Forschung: <a href="details/#/imperium" target="_blank" rel="noopener">Imperium im Atlas →</a></p>';
  $('#bannerGo')?.addEventListener('click', () => sendBanner(sess));
  bindNotfall(sess, nf);
}

/* ---------- getData-Wächter (B18, 16.10.2026; Migrationen 20261016000001/2) ----------
   Supabase fragt alle 10 min die offizielle getData-Schnittstelle ab (stco ALL + strs), auch ohne eingeloggten PC.
   Im Cockpit seit C1 (17.10.2026) nur eine Zeile im Überblick: Stand, Weckzeit, Fehler, Gastzugang knapp; die volle Karte
   (Weckzeit je Schlange, Rohstoffe, Aufträge, Forschungsstufen) steht im Horizon Atlas unter Imperium. */
function gdLine(g) {
  if (!g) return isOwner() ? '<p class="small muted">getData: nicht eingerichtet – Mehr → getData-Zugang.</p>' : '';
  const bad = g.error && (!g.ok_at || new Date(g.error_at) > new Date(g.ok_at));
  const left = g.expires_at ? (new Date(g.expires_at) - Date.now()) / 86400e3 : null;
  const w = g.wake, s0 = w?.steps?.find(s => s.at && Date.parse(s.at) === Date.parse(w.at)) || null;
  const wake = !w?.steps?.length ? 'kein offener Planschritt' : w.at ? (new Date(w.at) <= Date.now() ? '<b>jetzt startbar</b>' : `Weckzeit <b>${esc(when(w.at))}</b>`) : 'Weckzeit –';
  return `<p class="small" title="${esc(`aus getData ${dt(g.at)}`)}">getData ${g.at ? esc(ago(g.at)) : '–'} · ${wake}${s0 ? ` <span class="muted">#${esc(s0.n)} ${esc(s0.text)}</span>` : ''}
    ${bad ? `<br><span class="err">${esc(tidy(g.error))} (${esc(ago(g.error_at))})</span>` : ''}${left != null && left < 3 ? `<br><span class="err">Gastzugang bis ${esc(dt(g.expires_at))} – im Spiel verlängern, dann Mehr → getData-Zugang</span>` : ''}</p>`;
}
// Aktive Effekte aus Berichten in einer Zeile (volle Liste im Atlas)
function effectsLine(effs) {
  const seen = new Set(), list = (effs || []).filter(r => r.eff?.until && !seen.has(r.eff.name) && seen.add(r.eff.name))
    .sort((a, b) => Date.parse(a.eff.until) - Date.parse(b.eff.until));
  return list.length ? `<p class="small">Effekte: ${list.map(r => `${esc(String(r.eff.name || '').split(/\s*·\s*/)[0])} <span class="muted">bis ${esc(clockT(r.eff.until))}${r.eff.src === 'typisch' ? ' (geschätzt)' : ''}</span>`).join(' · ')}</p>` : '';
}
/* ---------- Planeten + Statistik Imperium (B2, 14.10.2026; Collector ab 0.4.5 → d.empire) ----------
   Alle Planeten ohne Planetenwechsel: Kurzinfo wie die Übersicht im Spiel (main.php?cmd=start), Stufen/Schiffe/Verteidigung
   je Planet (stat_main.php?cmd=overview), Rohstoffe je Kolonie (cmd=emp_prod, Tageswerte). Verbrauch gibt das Spiel
   (cmd=status) nur für den im Spiel gewählten Planeten → nur dort. Arbeiter, Energie, Bauplatz nur in der Ansicht eines
   Planeten; Bauleistung entfällt, dafür „Ausbau x / y“ wie im alten horizon-enhanced (Nutzer 16.10.). */
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
function overviewCard(sess, d, live, abLive, nm, W, extra = '') {
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
  return html + extra + '</div>';
}

/* ---------- Notfallzentrale (Paket F3, 13.10.2026) ----------
   Immer sichtbar, auch ohne freigegebenen Plan (vorher gab es dann keinen Stopp-Knopf). Kommandos gehen an ein Gerät;
   antwortet dort der Autobuilder nicht, führt der Collector (ab 0.4.3) „Neu laden“, „Lage jetzt lesen“ und „Stopp“ selbst
   aus. „Faktoren sichern“ und „Faktor von Hand“ braucht den Autobuilder (ab 0.5.9). Nur der Owner sieht die Knöpfe.
   „Notfall verbauen“ (B7, Autobuilder ab 0.5.18, nur auf Tippen): 2 h lang füllt der Autobuilder jede freie Schlange mit dem
   teuersten startbaren Planschritt der nächsten 25 (auch außer der Reihe, nie Abbrechen); auch am Ereignis „anflug“. */
const NF_CMDS = ['stop', 'reload', 'snapshot', 'factors', 'factor', 'notfall', 'antwort'];
const HANG_MIN = 10;
async function loadNotfall() {
  const acc = `eq.${S.acc}`;
  const [act, cmds] = await Promise.all([
    Cloud.q('plans', { account_id: acc, kind: 'eq.build', status: 'in.(freigegeben,aktiv)', order: 'approved_at.desc.nullslast', limit: 1,
      select: 'id,status,title,plan_hash' }),
    Cloud.q('commands', { account_id: acc, script: 'eq.autobuilder', cmd: `in.(${NF_CMDS.join(',')})`, order: 'id.desc', limit: 5 }),
  ]);
  return { active: act[0] || null, cmds, known: {} };
}
// Pläne, mit denen die Geräte arbeiten (Status im Cockpit), für den Hinweis „Gerät nutzt Plan X“
async function devPlans(sess, nf) {
  const ids = [...new Set(sess.devs.map(x => x.ab?.state?.plan).filter(v => /^[\w-]{4,40}$/.test(v || '')))];
  if (!ids.length) return;
  const rows = await Cloud.q('plans', { account_id: `eq.${S.acc}`, kind: 'eq.build', plan_hash: `in.(${ids.join(',')})`,
    select: 'plan_hash,status,title,created_at', order: 'created_at.desc' }).catch(() => []);
  for (const r of rows) nf.known[r.plan_hash] ||= r;
}
// Alter des jüngsten Lebenszeichens (Autobuilder oder Collector) in Minuten
const hbAge = t => t ? (Date.now() - new Date(t)) / 60e3 : Infinity;
function nfDevRow(x, nf) {
  const age = hbAge(x.last), abAge = hbAge(x.ab?.at), colAge = hbAge(x.col?.at), s = x.ab?.state || {};
  const hang = age >= HANG_MIN;
  let txt = hang ? `hängt / Browser zu (${ago(x.last)})`
    : abAge >= 3 && colAge < HANG_MIN ? `Autobuilder antwortet nicht – „Neu laden“`
    : `${s.page === 'login' ? 'ausgeloggt' : 'im Spiel'} · ${s.running ? `${s.mode === 'live' ? 'baut' : 'Probe'} bis #${s.until}` : 'angehalten'}`;
  // Plan des Geräts gegen den Plan im Cockpit
  let plan = '';
  if (s.plan && !hang) {
    const k = nf.known[s.plan], act = nf.active;
    if (!act || act.plan_hash !== s.plan) {
      plan = `nutzt ${planNo(s.plan) ? `Plan ${planNo(s.plan)}${k ? ` (${k.status})` : ''}` : 'einen im Cockpit unbekannten Plan'} ≠ aktiv ${act ? planLabel(act.plan_hash) : '–'}`;
    }
  }
  // Skript-Stände; älter als der neueste unter den Geräten = rot (Tampermonkey holt Updates selbst)
  const top = S.verTop || {}, old = [['ab', 'AB'], ['col', 'C']].some(([k]) => x[k] && verCmp(x[k].version, top[k]) < 0);
  const ver = [x.ab && `AB ${x.ab.version}`, x.col && `C ${x.col.version}`].filter(Boolean).join(' · ') + (old ? ' ↓ veraltet' : '');
  return `<tr><td>${x.holds ? '★ ' : ''}<b>${esc(x.name)}</b> <span class="small ${hang || abAge >= 3 ? 'err' : 'muted'}">${esc(txt)}</span>
    ${plan ? `<div class="small err">${esc(plan)}</div>` : ''}</td>
    <td class="num small ${hang ? 'err' : 'muted'}" title="${esc(ver)}">${Number.isFinite(age) ? esc(age < 1.5 ? 'jetzt' : `${Math.round(age)} min`) : '–'}<div class="${old ? 'err' : ''}">${esc(ver)}</div></td></tr>`;
}
function notfallCard(sess, nf, snap) {
  const shown = sess.devs.filter(x => x.holds || hbAge(x.last) < 7 * 24 * 60);
  const reach = shown.filter(x => hbAge(x.last) < HANG_MIN);
  S.verTop = {};
  for (const x of shown) for (const k of ['ab', 'col']) if (x[k] && verCmp(x[k].version, S.verTop[k]) > 0) S.verTop[k] = x[k].version;
  const own = isOwner();
  const sel = reach.find(x => x.device === S.nfDev) || reach.find(x => x.holds) || reach.find(x => x.ab?.state?.page === 'game') || reach[0] || null;
  const facts = (snap?.buildings?.items || []).filter(i => i.factor && i.factor.set != null);
  const W = S.wissen;
  const nm = i => i.name || W?.B?.[i.type]?.n || i.type;
  const anyBad = shown.some(x => hbAge(x.last) >= HANG_MIN || hbAge(x.ab?.at) >= 3);
  let html = `<div class="card${anyBad ? ' warn' : ''}" id="notfall"><div class="row between"><h2>Steuerung</h2><span class="muted small">★ hält den Lauf</span></div>`;
  html += shown.length ? `<table>${shown.map(x => nfDevRow(x, nf)).join('')}</table>` : '<p class="muted">Noch keine Lebenszeichen.</p>';
  const nfx = nfActive(sess);
  if (nfx) {
    const n = nfx.ab.state.notfall;
    html += `<div class="row between small" style="margin:6px 0;gap:6px"><span class="warn"><b>Notfall verbauen aktiv</b> auf ${esc(nfx.name)} bis ${esc(clockT(n.until))}
      · ${esc(n.n || 0)} Schritt(e) vorgezogen${n.why ? ` · <span class="muted">${esc(n.why)}</span>` : ''}</span>${own ? '<button data-nf="notfall-off">Beenden</button>' : ''}</div>`;
  }
  if (own) {
    html += `<div class="row" style="margin:8px 0;gap:6px"><button class="danger" id="nfStopAll" title="Stopp an alle Geräte">Alles anhalten</button></div>`;
    if (reach.length) {
      html += `<div class="row" style="margin:8px 0;gap:6px"><select id="nfDev" title="Gerät für die Knöpfe daneben">${reach.map(x => `<option value="${esc(x.device)}"${x === sel ? ' selected' : ''}>${x.holds ? '★ ' : ''}${esc(x.name)}</option>`).join('')}</select>
        <button data-nf="snapshot" title="Live-Stand sofort erfassen und hochladen">Lage lesen</button>
        <button data-nf="reload" title="Spiel-Tab neu laden (ein laufender Lauf geht danach weiter)">Neu laden</button>
        <button data-nf="factors" title="Faktor-Regel einmal anwenden (Minen und Lieferanten laufender Aufträge zuerst), ohne Lauf">Faktoren sichern</button>
        <button class="danger" data-nf="notfall" title="2 h lang freie Baustelle/Forschung sofort mit dem teuersten startbaren Planschritt (nächste 25) füllen – Rohstoffe vor einem Angriff verbauen">Notfall verbauen</button></div>`;
      if (facts.length) {
        const curT = facts.find(i => i.type === S.nfType) || facts[0];
        html += `<details${S.nfType ? ' open' : ''}><summary class="small muted">Faktor von Hand</summary><div class="row small" style="margin:6px 0;gap:6px"><select id="nfType">${facts.map(i => `<option value="${esc(i.type)}"${i === curT ? ' selected' : ''}>${esc(nm(i))} (${esc(i.factor.set)} %)</option>`).join('')}</select>
          <select id="nfTo">${[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map(v => `<option${v === (S.nfTo ?? curT.factor.set) ? ' selected' : ''}>${v}</option>`).join('')}</select> %
          <button data-nf="factor" title="Risiko-Grenzen gelten (Fusionskraftwerk ≤ 20 %, Waffentestgelände ≥ 10 %); ein laufender Lauf wendet danach wieder die Faktor-Regel an">Setzen</button></div></details>`;
      }
    } else html += '<p class="err small">Kein Gerät erreichbar – Browser bzw. PC prüfen.</p>';
  }
  html += `<div id="nfCmds">${cmdTable(nf.cmds)}</div></div>`;
  return html;
}
function bindNotfall(sess, nf) {
  const v = $('#view');
  if (!v.querySelector('#notfall')) return;
  devPlans(sess, nf).then(() => {   // Plan-Hinweise nachladen (kleine Abfrage), ohne die Seite neu aufzubauen
    const box = v.querySelector('#notfall table');
    const shown = sess.devs.filter(x => x.holds || hbAge(x.last) < 7 * 24 * 60);
    if (box && Object.keys(nf.known).length) box.innerHTML = shown.map(x => nfDevRow(x, nf)).join('');
  }).catch(() => { });
  $('#nfDev')?.addEventListener('change', e => { S.nfDev = e.target.value; });
  $('#nfType')?.addEventListener('change', e => { S.nfType = e.target.value; S.nfTo = null; route(true); });
  $('#nfTo')?.addEventListener('change', e => { S.nfTo = +e.target.value; });
  $('#nfStopAll')?.addEventListener('click', async () => {
    // an jedes Gerät, das in den letzten 24 h ein Lebenszeichen hatte (ältere Kommandos verfallen nach 15 min)
    const all = sess.devs.filter(x => hbAge(x.last) < 24 * 60);
    if (!all.length) return toast('Kein Gerät bekannt');
    if (!confirm(`Autobuilder auf allen Geräten anhalten (${all.map(x => x.name).join(', ')})?`)) return;
    const res = await Promise.allSettled(all.map(x => postCmd(x, 'stop', { reason: 'Alles anhalten (Notfallzentrale)' })));
    const bad = res.filter(r => r.status === 'rejected');
    toast(bad.length ? `Stopp an ${all.length - bad.length} von ${all.length} Geräten: ${bad[0].reason?.message || ''}` : `Stopp an ${all.length} Geräte gesendet`);
    setTimeout(() => route(true), 1500);
  });
  v.querySelectorAll('button[data-nf]').forEach(b => b.addEventListener('click', async () => {
    const dev = sess.devs.find(x => x.device === ($('#nfDev')?.value || ''));
    if (!dev) return toast('Kein Gerät gewählt');
    const cmd = b.dataset.nf;
    let args = {};
    if (cmd === 'notfall-off') {
      const x = nfActive(sess);
      if (!x || !confirm(`Notfall verbauen auf ${x.name} beenden?`)) return;
      return sendNotfall(x, { off: true });
    }
    if (cmd === 'notfall') return confirm(NF_ASK(dev.name)) && sendNotfall(dev, { hours: 2 });
    if (cmd === 'factor') {
      args = { type: $('#nfType').value, to: +$('#nfTo').value };
      if (!confirm(`Faktor ${$('#nfType').selectedOptions[0].textContent} auf ${args.to} % setzen (${dev.name})?`)) return;
    } else if (!confirm({ factors: `Faktoren auf ${dev.name} jetzt sichern (Regel F1: Minen und Lieferanten laufender Aufträge auf 100 %, andere geben bei Mangel ab)?`,
      reload: `Spiel-Tab auf ${dev.name} neu laden?`, snapshot: `Live-Stand auf ${dev.name} jetzt lesen?` }[cmd])) return;
    try {
      await postCmd(dev, cmd, args);
      toast(`Kommando an ${dev.name} gesendet – Ergebnis in 15–60 s`);
      setTimeout(() => route(true), 1500);
    } catch (e) { toast(e.message); }
  }));
  watchCmds(nf.cmds, Date.now(), '#nfCmds', { cmd: `in.(${NF_CMDS.join(',')})` });
}

// Notfall verbauen: Gerät mit offenem Fenster (nfTarget, NF_ASK, sendNotfall, anflugNotfall stehen in common.js)
const nfActive = sess => sess.devs.find(x => x.ab && isFresh(x.ab.at, 10) && x.ab.state?.notfall?.until > Date.now()) || null;

/* ---------- Werbebanner (Autobuilder ab 0.5.1) ----------
   Der Autobuilder meldet aktive Banner im Lebenszeichen; aufgerufen werden sie nur per Kommando „banner“ nach Tippen des Owners. */
const bannerDev = sess => sess.devs.find(x => x.ab && isFresh(x.ab.at) && x.ab.state?.page === 'game' && x.ab.state?.banner?.n);
// Ab Autobuilder 0.5.20 (Freigabe Nutzer 15.10.2026): Ist kein Gerät eingeloggt und die Banner sind fällig, loggt ein ausgeloggtes
// Gerät nach Tippen und Bestätigen einmal ein, ruft die Banner auf und loggt ohne Lauf wieder aus. Bevorzugt das Gerät mit dem Lauf.
// Schläft ein Lauf, lehnt der Autobuilder den Banner-Login ab („Auto-Login des Laufs steht an“ bzw. „Lauf liegt bei …“,
// Kommandos 152/153 am 17.10.) → dann kein Login-Knopf, sondern Hinweis auf die Weckzeit; die Banner danach im Spiel tippen.
const bannerSleep = sess => {
  const r = sess.run, d = sess.devs.find(x => x.ab && isFresh(x.ab.at) && x.ab.state?.sleeping);
  if (r?.state !== 'schlaeft' && !d) return null;
  return { wake: (r?.state === 'schlaeft' && r.wake_at) || d?.ab.state.wakeAt || null, name: r?.name || d?.name || null };
};
const bannerLoginDev = sess => {
  const live = sess.devs.filter(x => x.ab && isFresh(x.ab.at));
  if (live.some(x => x.ab.state?.page === 'game') || bannerSleep(sess)) return null;
  const out = live.filter(x => x.ab.state?.page === 'login');
  return out.find(x => x.holds) || out[0] || null;
};
const bannerDue = sess => Math.max(0, ...sess.devs.filter(d => d.ab && isFresh(d.ab.at, 24 * 60)).map(d => +d.ab.state?.bannerDue || 0));
const bannerLoginNow = sess => { const due = bannerDue(sess); return due && due < Date.now() + 15 * 60e3 ? bannerLoginDev(sess) : null; };
function bannerCard(sess) {
  const x = bannerDev(sess), b = x?.ab.state.banner;
  if (!b) {
    const due = bannerDue(sess), lx = bannerLoginNow(sess), zz = due && due < Date.now() + 15 * 60e3 ? bannerSleep(sess) : null;
    return due ? `<div class="card"><div class="row between"><h2>Werbebanner</h2><span class="muted small">${lx ? 'Gerät ausgeloggt' : zz ? 'Lauf schläft' : 'keine offen'}</span></div>
      <p class="small">Nächste erwartet ${due < Date.now() ? 'seit' : 'ab'} <b>${esc(dt(due))}</b> (${due > Date.now() ? `in ${esc(dur((due - Date.now()) / 1000))}` : esc(ago(due))}).</p>
      ${zz ? `<p class="small">Banner nach dem Aufwachen${zz.wake ? ` (<b>${esc(clockT(zz.wake))}</b>, ${new Date(zz.wake) > Date.now() ? `in ${esc(dur((new Date(zz.wake) - Date.now()) / 1000))}` : 'jetzt'})` : ''}: Der Lauf${zz.name ? ` auf ${esc(zz.name)}` : ''} schläft und loggt dann selbst ein – ein Login für die Banner jetzt würde ihn stören, der Autobuilder lehnt ihn ab.</p>` : ''}
      ${lx && isOwner() ? `<p class="small">${esc(lx.name)} ist ausgeloggt. Der Autobuilder loggt dafür einmal ein, ruft die Banner auf und loggt danach wieder aus (läuft dort ein Lauf, macht dieser weiter).</p>
      <div class="row" style="margin-top:6px"><button class="primary" id="bannerGo">Einloggen und Banner öffnen</button></div>` : ''}</div>` : '';
  }
  return `<div class="card"><div class="row between"><h2>Werbebanner</h2><span class="muted small">seit ${esc(when(b.since))}</span></div>
    <p>${esc(b.n)} von 3 Votes offen auf <b>${esc(x.name)}</b></p><div class="small">${(b.slots || []).map(s => `Vote ${esc(s.slot)}: ${esc(s.host || 'Ziel unbekannt')}`).join('<br>')}</div>
    ${(b.slots || []).some(s => s.url || s.href || s.src) ? `<details class="sub"><summary class="small muted">Details</summary><div class="small muted wrapall">${(b.slots || []).map(s => esc(s.url || s.href || s.src || '')).join('<br>')}</div></details>` : ''}
    ${isOwner() ? '<div class="row" style="margin-top:6px"><button class="primary" id="bannerGo">Banner jetzt öffnen</button></div>' : ''}</div>`;
}
async function sendBanner(sess) {
  const x = bannerDev(sess) || bannerLoginNow(sess), login = x && !bannerDev(sess);
  if (!x) return toast('Kein Gerät mit aktiven Bannern erreichbar');
  if (!confirm(login ? `${x.name} ist ausgeloggt. Jetzt einmal einloggen, die Banner aufrufen und danach wieder ausloggen?\n\nEin Spiel auf einem anderen Gerät wird dabei abgemeldet.`
    : `Banner auf ${x.name} jetzt einmal aufrufen?`)) return;
  try {
    await Cloud.rest('commands', { method: 'POST', prefer: 'return=minimal',
      body: { account_id: S.acc, script: 'autobuilder', cmd: 'banner', args: {}, target_device: x.device } });
    toast(`Kommando an ${x.name} gesendet – Ergebnis unter Ereignisse`);
    setTimeout(() => route(true), 1500);
  } catch (e) { toast(e.message); }
}

/* ---------- Meldungen (C1, 17.10.2026) ----------
   Nur, was am Handy eine Reaktion braucht: offene Entscheidungen (Nachrichten mit Knöpfen), Ereignisse der Stufe „hoch“
   und ungesehene Plan-/Lauf-Ereignisse (Bereiche Builder und Cockpit). Alle Ereignisse mit Filtern: Horizon Atlas → Ereignisse.
   Badge am Reiter: ungesehene „hoch“ + offene Entscheidungen. */
const openDecision = e => { const x = e.data || {}; return Array.isArray(x.decision) && x.decision.length && !x.answer?.ok; };
const loadDecisions = (select = '*') => Cloud.q('events', { account_id: `eq.${S.acc}`, kind: 'eq.bericht', 'data->decision': 'not.is.null',
  dismissed_at: 'is.null', order: 't.desc', limit: 30, select });
async function viewMeldungen() {
  const acc = `eq.${S.acc}`;
  const [dec, high, plan] = await Promise.all([
    loadDecisions().catch(() => []),
    Cloud.q('events', { account_id: acc, level: 'eq.hoch', dismissed_at: 'is.null', order: 't.desc', limit: 20 }),
    Cloud.q('events', { account_id: acc, cat: 'in.(builder,cockpit)', level: 'neq.hoch', seen_at: 'is.null', dismissed_at: 'is.null', order: 't.desc', limit: 30 }),
  ]);
  const open = dec.filter(openDecision);
  const canSee = ['owner', 'viewer'].includes(account()?.role);
  const sec = (title, list, empty) => `<div class="card"><h2>${title}${list.length ? ` <span class="muted small">${list.length}</span>` : ''}</h2>${list.length ? list.map(evRow).join('') : `<p class="muted small">${empty}</p>`}</div>`;
  $('#view').innerHTML = (open.length ? sec('Entscheidungen offen', open, '') : '')
    + sec('Stufe „hoch“', high.filter(e => !open.includes(e)), 'Keine.')
    + sec('Plan und Lauf <span class="muted small">ungesehen</span>', plan.filter(e => !open.includes(e)), 'Nichts Neues.')
    + `<div class="card"><div class="row between"><a href="details/#/ereignisse" target="_blank" rel="noopener">Alle Ereignisse mit Filter im Atlas →</a>
      ${canSee ? '<button id="seenAll">alle gesehen</button>' : ''}</div>${canSee ? '<p class="muted small">Nach rechts wischen oder ✕ = ausblenden.</p>' : ''}</div>`;
  swipeEvents($('#view'));
  $('#seenAll')?.addEventListener('click', async () => {
    await Cloud.rest(`events?account_id=eq.${S.acc}&seen_at=is.null`, { method: 'PATCH', body: { seen_at: new Date().toISOString() }, prefer: 'return=minimal' });
    route();
  });
}
/* ---------- Pläne ---------- */


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
// Planeten des Plans: plan.planet (ab 12.10. von build_autobuilder.js), weitere über plan.stepPlanet {Schritt: Koordinaten}
// und plan.planets [{name, coords}]; ältere Pläne ohne Angabe: Heimatplanet aus dem Live-Stand
function planPlanets(plan, home) {
  const list = [plan.planet || home, ...(plan.planets || [])].filter(p => p?.coords);   // Heimat zuerst
  for (const c of Object.values(plan.stepPlanet || {})) if (!list.some(p => p.coords === c)) list.push({ name: '', coords: c });
  return list.filter((p, i) => list.findIndex(q => q.coords === p.coords) === i);
}
const stepPlanet = (plan, n, def) => plan.stepPlanet?.[n] || def;
// Zeiten der Planschritte enthalten immer die Abweichung (Nutzer 16.10.): Planstart + τ + shift (h, wie activeEnd)
// C1 (17.10.2026): nur ein Ausschnitt – die nächsten STEP_NEAR Schritte ab dem ersten offenen und ±3 um „bis #“ (Tipp = „bis #“ wählen);
// die ganze Liste mit Ausführungen steht im Atlas unter Pläne.
const STEP_NEAR = 12;
function stepsTable(plan, st, execs, W, planet, shift = 0) {
  const t0 = Date.parse(plan.startTime) + shift * 3600e3, tp = tau => esc(dt(t0 + tau * 3600e3));
  const tip = tau => shift ? ` title="Plan: ${esc(dt(t0 - shift * 3600e3 + tau * 3600e3))}"` : '';
  const open = (st.open || []).filter(Number.isInteger);
  const first = open.length ? Math.min(...open) : null;
  const until = st.until || null;
  const done = new Map(execs.filter(e => e.step).map(e => [e.step, e]));
  const isDone = n => done.has(n) || (first != null && n < first);
  const nameOf = k => W?.B?.[k]?.n || k;
  const def = (plan.planet || S.home)?.coords;
  const from = first ?? 1;
  const show = n => (n >= from && n < from + STEP_NEAR) || (until && Math.abs(n - until) <= 3);
  const steps = [];
  plan.steps.forEach((s, i) => { if (s[0] !== 's' && show(i + 1) && (!planet || stepPlanet(plan, i + 1, def) === planet)) steps.push({ tau: s[3], n: i + 1, s }); });
  if (!steps.length) return `<p class="muted small">Kein offener Schritt${until ? ` bis #${esc(until)}` : ''}${first ? ` (als Nächstes #${first})` : ''}.</p>`;
  // zusammenhängende Gruppen (Lücke = „…“); Faktorwechsel nur innerhalb einer Gruppe
  const groups = [];
  const gap = until && until - 3 > from + STEP_NEAR;   // Ausschnitt um „bis #“ getrennt vom Anfang
  for (const r of steps) { const g = groups[groups.length - 1]; if (g && !(gap && g[g.length - 1].n < from + STEP_NEAR && r.n >= from + STEP_NEAR)) g.push(r); else groups.push([r]); }
  const fcs = factorChanges(plan);
  const row = r => {
    const e = done.get(r.n), mark = isDone(r.n) ? '✓' : open.includes(r.n) ? '▶' : '';
    return `<tr class="step${isDone(r.n) ? ' muted' : ''}${r.n === until ? ' until' : ''}" data-i="${r.n}"><td class="num">${mark} #${r.n}</td><td>${esc(r.s[5])}${r.s[0] === 'r' ? ' <span class="tag">global</span>' : ''}${r.n === until ? ' <span class="tag ok">bis #</span>' : ''}${e ? `<div class="small">gestartet ${esc(dt(e.t))} · ${esc(e.src_name)}</div>` : ''}</td>
      <td class="num"${tip(r.tau)}>${tp(r.tau)}</td></tr>`;
  };
  const fcRow = fc => `<tr class="muted"><td></td><td>⚙ Faktor ${fc.ch.map(([k, a, b]) => `${esc(nameOf(k))} ${FMT_PCT(a)} → ${FMT_PCT(b)}`).join(', ')}</td><td class="num"${tip(fc.tau)}>${tp(fc.tau)}</td></tr>`;
  return `<table class="small">${groups.map(g => {
    const lo = g[0].tau, hi = g[g.length - 1].tau;
    const list = [...g, ...fcs.filter(fc => fc.tau >= lo && fc.tau <= hi).map(fc => ({ tau: fc.tau, fc }))].sort((a, b) => a.tau - b.tau || (a.fc ? -1 : 1));
    return list.map(r => r.fc ? fcRow(r.fc) : row(r)).join('');
  }).join('<tr class="muted"><td></td><td>…</td><td></td></tr>')}</table>`;
}
function abCard(active, sess, cmds, own, execs, W, drift) {
  const plan = active?.payload, run = sess.run;
  const live = sess.devs.filter(x => x.ab && isFresh(x.ab.at));
  const holder = sess.devs.find(x => x.holds);
  // Zielgerät: gewähltes, sonst Lauf-Halter (wenn erreichbar), sonst eingeloggtes, sonst erstes erreichbares
  const target = live.find(x => x.device === S.abSel?.dev) || (holder && live.includes(holder) && holder)
    || live.find(x => x.ab.state.page === 'game') || live[0] || null;
  const st = target?.ab?.state || {};
  let html = `<div class="card"><div class="row between"><h2>Autobuilder</h2><span class="muted small">${run ? `seit ${esc(dt(run.since))}` : ''}</span></div>`;
  html += runBody(sess);
  if (!active) return html + '<p class="muted">Kein freigegebener Bauplan. Erst einen Entwurf freigeben. Anhalten, Neu laden und Faktoren gehen jederzeit unter <a href="#/lage">Lage → Notfallzentrale</a>.</p>' + `<div id="abCmds">${cmdTable(cmds)}</div></div>`;
  html += `<p class="small">Freigegeben: <b>${esc(planLabel(active.id))}</b> · ${esc(tidy(active.title))} <span class="tag ${esc(active.status)}">${esc(active.status)}</span></p>`;
  if (!live.length) html += '<p class="err small">Kein Autobuilder erreichbar (Browser zu oder Skripte aus).</p>';
  else {
    html += `<div class="row" style="margin:8px 0">Gerät <select id="abDev">${live.map(x => `<option value="${esc(x.device)}"${x === target ? ' selected' : ''}>${x.holds ? '★ ' : ''}${esc(x.name)} – ${x.ab.state.page === 'login' ? 'ausgeloggt' : 'eingeloggt'}</option>`).join('')}</select></div>`;
    if (st.plan !== plan?.id) {
      html += st.offered === plan?.id
        ? `<p class="warn small">${esc(target.name)} hat den freigegebenen Plan angeboten bekommen, arbeitet aber noch mit ${esc(planLabel(st.plan))}.</p>
           ${own ? `<button class="primary" data-cmd="adopt"${st.running ? ' disabled title="erst stoppen"' : ''}>Plan auf ${esc(target.name)} übernehmen</button>` : ''}`
        : '<p class="muted small">Der Collector bietet den Plan beim nächsten Abgleich an (bis 1 min).</p>';
    } else if (own) {
      html += `<div class="row" style="margin:8px 0">bis # <input id="abUntil" type="number" min="1" max="${plan.steps.length}" value="${esc(S.abSel?.until || st.until || run?.until || 10)}" style="width:5em">
        <button data-cmd="dry">Probelauf</button> <button class="primary" data-cmd="live">Start</button> <button class="danger" data-cmd="stop">Stopp</button></div>
        <div class="muted small" id="abStep"></div>`;
    }
  }
  // B13: Pause/Weiter an den Halter des Laufs (Autobuilder ab 0.5.19)
  if (own && run && ['laeuft', 'schlaeft'].includes(run.state) && holder) {
    const hs = holder.ab?.state || {};
    html += run.paused_at
      ? `<div class="row" style="margin:4px 0;gap:6px">${hs.hand ? '<button class="primary" data-cmd="weiter_ok">Von Hand übernehmen und weiter</button>' : '<button class="primary" data-cmd="weiter">Weiter</button>'}</div>`
      : `<div class="row" style="margin:4px 0;gap:6px"><button data-cmd="pause" title="Der Autobuilder startet nichts, loggt nicht aus/ein; der Lauf bleibt angemeldet">Pause</button></div>`;
  }
  html += driftLine(drift, own);
  if (plan) {
    const hst = (holder?.ab?.state?.plan === plan.id ? holder.ab.state : null) || (st.plan === plan.id ? st : {});
    const pls = planPlanets(plan, S.home);
    const cur = pls.find(p => p.coords === S.planet) || pls[0] || null;
    const plName = p => `${p.name || 'Planet'} (${p.coords})`;
    html += `<div class="row between" style="margin-top:10px"><h3 style="margin:0">Nächste Planschritte <span class="muted small">bis #${esc(hst.until || '–')}</span></h3>
      <a class="small" href="details/#/plaene" target="_blank" rel="noopener">alle im Atlas</a></div>
      ${pls.length > 1 ? `<div class="row small" style="margin:4px 0">Planet <select id="plSel">${pls.map(p => `<option value="${esc(p.coords)}"${p === cur ? ' selected' : ''}>${esc(plName(p))}</option>`).join('')}</select></div>`
        : cur ? `<div class="small muted" style="margin:4px 0">Planet ${esc(plName(cur))} · Forschung gilt für alle Planeten („global“)</div>` : ''}
      ${(() => { const sh = planShift(drift); return Math.abs(sh) >= 0.05 ? `<div class="small muted" style="margin:4px 0">Zeiten inkl. Abweichung: ${sh > 0 ? 'Verzug' : 'Vorlauf'} ${esc(hrs(sh))} gegen den Plan (reine Planzeit als Tooltip)</div>` : ''; })()}
      ${stepsTable(plan, hst, execs, W, cur?.coords, planShift(drift))}
      ${own ? `<div class="row between small" style="margin-top:6px"><span class="muted">Tipp auf einen Schritt = „bis #“</span><a href="details/#/plaene/edit/${esc(active.id)}" target="_blank" rel="noopener">Plan ändern (Atlas) →</a></div>` : ''}`;
  }
  return html + `<div id="abCmds">${cmdTable(cmds)}</div></div>`;
}

// Kommandos als zweizeilige Liste (B16: passt aufs Handy): Was → Gerät, Zeit; darunter Status und Ergebnis
const CMD_DE = { start: 'Start', stop: 'Stopp', adopt: 'Plan übernehmen', reload: 'Neu laden', snapshot: 'Lage lesen', factors: 'Faktoren sichern',
  factor: 'Faktor', banner: 'Werbebanner', pause: 'Pause', weiter: 'Weiter' };
const cmdTable = cmds => !cmds.length ? '' : `<h3>Letzte Kommandos</h3>${cmds.map(c => `<div class="list-item small"><div class="row between">
    <span><b>${esc(c.cmd === 'start' && c.args?.mode === 'dry' ? 'Probelauf' : CMD_DE[c.cmd] || c.cmd)}</b>${c.args?.accept ? ' (von Hand übernehmen)' : ''}${c.args?.until ? ' bis #' + esc(c.args.until) : ''}${c.cmd === 'factor' ? ` ${esc(c.args?.type)} ${esc(c.args?.to)} %` : ''}${c.target_name ? ` → ${esc(c.target_name)}` : ''}</span>
    <span class="muted nowrap">${esc(when(c.created_at))}</span></div>
    <div><span class="tag">${esc(c.status)}</span> <span class="muted">${esc(tidy(c.result))}${c.taken_name && c.taken_name !== c.target_name ? ` · ${esc(c.taken_name)}` : ''}</span></div></div>`).join('')}`;

// Offene Kommandos (neu/angenommen) alle 5 s nachsehen, ohne die Seite neu aufzubauen; fertig → einmal neu laden
const OPEN_CMD = c => ['neu', 'angenommen'].includes(c.status);
function watchCmds(cmds, since = Date.now(), el = '#abCmds', filter = {}) {
  clearTimeout(watchCmds.t);
  if (!cmds.some(OPEN_CMD)) return;
  watchCmds.t = setTimeout(async () => {
    if (!$(el) || Date.now() - since > 5 * 60e3) return;
    try {
      const fresh = await Cloud.q('commands', { account_id: `eq.${S.acc}`, script: 'eq.autobuilder', order: 'id.desc', limit: el === '#abCmds' ? 8 : 5, ...filter });
      if (!$(el)) return;
      $(el).innerHTML = cmdTable(fresh);
      if (fresh.some(OPEN_CMD)) watchCmds(fresh, since, el, filter); else route(true);
    } catch { watchCmds(cmds, since, el, filter); }
  }, 5000);
}

async function sendCmd(active, cmd, sess) {
  const plan = active.payload;
  const until = +($('#abUntil')?.value || 0);
  const step = plan.steps[until - 1];
  const live = sess.devs.filter(x => x.ab && isFresh(x.ab.at));
  // Stopp geht an den Halter eines laufenden Laufs, sonst an das gewählte Gerät
  const holder = sess.devs.find(x => x.holds && ['laeuft', 'schlaeft', 'verloren'].includes(sess.run?.state));
  const PAUSE = ['pause', 'weiter', 'weiter_ok'];
  const tgt = (cmd === 'stop' || PAUSE.includes(cmd)) && holder ? holder : PAUSE.includes(cmd) ? null : live.find(x => x.device === $('#abDev')?.value);
  if (!tgt) return toast('Kein Gerät erreichbar');
  const args = cmd === 'stop' || cmd === 'pause' || cmd === 'weiter' ? {} : cmd === 'weiter_ok' ? { accept: true } : cmd === 'adopt' ? { plan: plan.id } : { mode: cmd, until, plan: plan.id };
  const login = tgt.ab?.state?.page === 'login';
  if (cmd === 'live' || cmd === 'dry') {
    if (!step) return toast(`„bis #“ zwischen 1 und ${plan.steps.length}`);
    // B11: Ein Probelauf darf keinen Live-Lauf eines anderen Geräts übernehmen (Autobuilder ab 0.5.16 und ab_sync lehnen ab)
    const r = sess.run;
    if (cmd === 'dry' && r && r.mode === 'live' && ['laeuft', 'schlaeft', 'verloren'].includes(r.state) && r.device !== tgt.device)
      return alert(`Probelauf auf ${tgt.name} nicht möglich: Der Live-Lauf bis #${r.until ?? '?'} liegt bei ${r.name || 'einem anderen Gerät'} (${RUNST[r.state] || r.state}).\n`
        + `Ein Probelauf würde ihn übernehmen und dort anhalten. Erst den Live-Lauf stoppen oder den Probelauf auf ${r.name || 'diesem Gerät'} starten.`);
    if (!confirm(`${cmd === 'live' ? 'LIVE-Start' : 'Probelauf'} bis #${until} (${step[5]}) auf ${tgt.name}?`
      + (login ? `\n${tgt.name} ist ausgeloggt: Mit Auto-Login meldet es sich jetzt im Spiel an – ein anderer eingeloggter PC fliegt dabei raus.` : '')
      + (cmd === 'live' ? '\nDer Autobuilder baut danach selbständig im Spiel.' : ''))) return;
  } else if (!confirm(cmd === 'stop' ? `Autobuilder auf ${tgt.name} anhalten?`
    : cmd === 'pause' ? `Autobuilder auf ${tgt.name} pausieren? Er startet nichts mehr und loggt nicht aus oder ein; der Lauf bleibt angemeldet („bis #“ bleibt). Nach 2 h kommt eine Erinnerung.`
    : cmd === 'weiter' ? `Autobuilder auf ${tgt.name} fortsetzen? Was in der Pause von Hand gebaut wurde, zeigt er erst an.`
    : cmd === 'weiter_ok' ? `In der Pause von Hand Gebautes auf ${tgt.name} übernehmen und weitermachen?
${tgt.ab?.state?.hand || ''}`
    : `${planLabel(plan.id)} auf ${tgt.name} übernehmen? Danach „bis #“ neu wählen.`)) return;
  try {
    await Cloud.rest('commands', { method: 'POST', prefer: 'return=minimal',
      body: { account_id: S.acc, script: 'autobuilder', cmd: cmd === 'live' || cmd === 'dry' ? 'start' : cmd === 'weiter_ok' ? 'weiter' : cmd, args, plan_id: active.id, target_device: tgt.device } });
    toast(`Kommando an ${tgt.name} gesendet – Ergebnis in wenigen Sekunden`);
    setTimeout(() => route(true), 1500);
  } catch (e) { toast(e.message); }
}

// „Neuer Plan verfügbar – starten?“ (B14, 15.10.): Im Cockpit erscheinen nur bessere Pläne. Ein Optimierer-Entwurf zählt,
// wenn er mit Claude im Chat abgestimmt ist (payload.agreed, push_plan.py --abgestimmt), kein Plan aktiv ist oder er das SCOL
// mehr als PLAN_GAIN_MIN h früher erreicht als der aktive Plan – verglichen mit dessen erwartetem Ende laut Live-Stand
// (Planstart + hours + Startverzug + Rückstand bzw. − Vorlauf aus plan_abweichung, B4). Schlechtere Entwürfe sind ausgeblendet
// (push_plan.py legt solche seit B14 gar nicht mehr an); eigene Entwürfe (source user, „Planschritte ändern“) bleiben sichtbar.
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
function newPlanOffer(plans, active, gains) {
  const draft = plans.find(p => p.kind === 'build' && p.status === 'entwurf' && p.source !== 'user' && gains[p.id]?.better);
  if (!draft) return null;
  const g = gains[draft.id];
  if (!g.agreed && !(g.gain > PLAN_GAIN_MIN) && active) return null;
  return { draft, ...g };
}
// Herkunft und Klapper „Details“ eines Plans (B16): Notiz in Anzeigeform, darunter die technischen Kennungen
const SRC = { optimizer: 'Optimierer', user: 'eigener Entwurf', claude: 'Claude' };
const WERFT_KINDS = ['ship', 'defense', 'probe'];   // Vorschau (8 Plätze) seit C1 im Atlas (details/werft.js)
function planDetails(p) {
  if (!p.note && !p.plan_hash && !p.id) return '';
  return `<details class="sub"><summary class="small muted">Details</summary>${p.note ? `<div class="small wrapall" style="white-space:pre-wrap">${esc(tidy(p.note))}</div>` : ''}
    <div class="small muted wrapall">Plan-id ${esc(p.plan_hash || '–')} · Datensatz ${esc(p.id)}${p.parent_id ? ` · Vorlage ${esc(p.parent_id)}` : ''}</div></details>` + (WERFT_KINDS.includes(p.kind) ? `<div class="small"><a href="details/#/werft" target="_blank" rel="noopener">Schritte und Auftragsliste im Atlas →</a></div>` : '');
}
function newPlanCard(o, own) {
  if (!o) return '';
  const why = [o.agreed ? 'mit Claude im Chat abgestimmt' : '', gainText(o)].filter(Boolean).join(' · ');
  return `<div class="card warn"><div class="row between"><h2>Neuer Plan verfügbar – starten?</h2><span class="muted small">${esc(when(o.draft.created_at))}</span></div>
    <p><b>${esc(planLabel(o.draft.id))}</b> · ${esc(tidy(o.draft.title || ''))}${o.end ? ` · SCOL ca. ${esc(dt(o.end))}` : ''}</p>${why ? `<p class="small">${esc(why)}</p>` : ''}
    ${planDetails(o.draft)}
    ${own ? `<div class="row" style="margin-top:6px"><button class="primary" id="npGo">Freigeben</button><button id="npNo">Verwerfen</button></div>
      <p class="muted small">Gestartet wird danach wie gewohnt unter Autobuilder („bis #“ neu wählen, neue Schrittnummern).</p>` : ''}</div>`;
}
async function takeNewPlan(o, sess) {
  if (!confirm(`${planLabel(o.draft.id)} („${tidy(o.draft.title)}“) freigeben? Der bisher freigegebene Bauplan wird damit abgelöst.`)) return;
  try {
    await Cloud.rpc('plan_status', { p_id: o.draft.id, p_status: 'freigegeben' });
    S.planCache = null;
    // F2 (13.10.): direkt „Übernehmen auf <Gerät>“ anbieten. Der Collector legt den Plan im selben Abgleich als Angebot ab,
    // in dem er das Kommando abholt; der Autobuilder übernimmt auch ausgeloggt (ab 0.5.8), aber nicht während eines Laufs.
    const live = sess.devs.filter(x => x.ab && isFresh(x.ab.at));
    const tgt = live.find(x => x.holds) || live.find(x => x.ab.state?.page === 'game') || live[0];
    if (tgt && o.draft.plan_hash && !tgt.ab.state?.running) {
      if (confirm(`Freigegeben. Plan jetzt auf ${tgt.name} übernehmen? Danach „bis #“ neu wählen (neue Schrittnummern).`)) {
        await postCmd(tgt, 'adopt', { plan: o.draft.plan_hash }, o.draft.id);
        toast(`Übernehmen an ${tgt.name} gesendet – Ergebnis unter Autobuilder`);
      } else toast('Freigegeben – übernehmen unter Autobuilder');
    } else toast(tgt ? `Freigegeben – ${tgt.name} läuft noch: erst stoppen, dann unter Autobuilder übernehmen`
      : 'Freigegeben – kein Autobuilder erreichbar; übernehmen unter Autobuilder, sobald ein Gerät da ist');
    setTimeout(() => route(true), 1500);
  } catch (e) { toast(e.message); }
}

/* ---------- Neuen Plan vorschlagen (B3, 13.10.) ----------
   Auftrag „optimierer“ → Supabase (pg_net) startet den Workflow sim-optimize.yml in GitHub Actions: neuester Snapshot →
   Optimierer → Ergebnis-PR → Entwurf hier unter Pläne. Läuft zusätzlich täglich 05:17. Dauer etwa 30–90 min. */
const OPT_ST = { neu: 'angefordert', in_arbeit: 'rechnet', beantwortet: 'fertig', abgelehnt: 'nicht gelaufen', zurueckgezogen: 'zurückgezogen' };
function optCard(req, own) {
  const busy = req && ['neu', 'in_arbeit'].includes(req.status) && Date.now() - new Date(req.created_at) < 3 * 3600e3;
  return `<div class="card"><div class="row between"><h2>Neuer Plan</h2>${req ? `<span class="tag">${esc(OPT_ST[req.status] || req.status)}</span>` : ''}</div>
    <p class="muted small">Automatischer Lauf und Knopf ausgesetzt (17.10.): Pläne mit Kolonien rechnet Claude von Hand; das Ergebnis erscheint hier als Entwurf.</p>
    ${req ? `<div class="small wrapall">Zuletzt ${esc(when(req.created_at))}${busy ? ' (läuft)' : ''}${req.answer ? `: ${esc(tidy(req.answer))}` : ''}</div>` : ''}</div>`;
}

/* ---------- Planabweichung (B4, 14.10.) ----------
   public.plan_abweichung rechnet je Schritt Plan-Start gegen echten Start (executions) und überfällige offene Schritte;
   der Startverzug (erster Start nach dem Planstart, weil der Plan ab seinem Snapshot rechnet) ist abgezogen. Der Wächter in
   Supabase meldet ab 2 h Rückstand „mittel“ (je weitere 2 h erneut) mit dem Angebot, neu zu planen. */
const hrs = h => `${fmt(Math.abs(h), 1)} h`;
const lagText = h => h == null ? '–' : h >= 0.05 ? `${hrs(h)} hinter dem Plan` : h <= -0.05 ? `${hrs(h)} Vorlauf` : 'genau im Plan';
// Im Cockpit seit C1 nur der Rückstand als Zahl (eine Zeile im Autobuilder) und ab der Meldegrenze „Neu planen“; Grafik im Atlas
function driftLine(d, own) {
  if (!d) return '';
  if (d.lag == null) return `<p class="small muted">Abweichung: noch kein Schritt dieses Plans gestartet.</p>`;
  const cls = d.lag >= d.limit ? 'err' : d.lag >= 1 ? 'warn' : 'ok';
  return `<div class="row between small" style="margin:6px 0;gap:6px"><span>Abweichung: <b class="${cls}">${esc(lagText(d.lag))}</b>${d.due?.lag > 0 ? ` · überfällig #${esc(d.due.n)}` : ''}
    · <a href="details/#/plaene" target="_blank" rel="noopener">Grafik im Atlas</a></span></div>`;
}

async function viewPlans(rest = []) {
  // Plan-Editor seit C1 nur im Atlas; alte Links (#/plaene/edit/<id>) dorthin umleiten
  if (rest[0] === 'edit' && rest[1]) { location.replace(`details/#/plaene/edit/${encodeURIComponent(rest[1])}`); return; }
  const acc = `eq.${S.acc}`;
  let [plans, heads, sess, cmds, W, homes, opt] = await Promise.all([
    Cloud.q('plans', { account_id: acc, order: 'created_at.desc', limit: 30,
      select: 'id,kind,source,status,title,note,plan_hash,parent_id,created_at,approved_at,status_at' }),
    Cloud.q('plans', { account_id: acc, kind: 'eq.build', status: 'in.(freigegeben,aktiv)', order: 'approved_at.desc.nullslast', limit: 1,
      select: 'id,status,title,plan_hash' }),
    loadSessions(),
    Cloud.q('commands', { account_id: acc, script: 'eq.autobuilder', order: 'id.desc', limit: 8 }),
    loadWissen().catch(() => null),
    S.home?.acc === S.acc ? null : Cloud.q('state_latest', { account_id: acc, kind: 'eq.live', select: 'start:data->start' }).catch(() => []),
    Cloud.q('requests', { account_id: acc, kind: 'eq.optimierer', order: 'created_at.desc', limit: 1,
      select: 'id,status,answer,created_at' }).catch(() => []),
  ]);
  if (homes) { const st = homes[0]?.start; S.home = { acc: S.acc, name: st?.planet || '', coords: st?.coords || '' }; }
  if (plans.some(p => !planNo(p.id))) await loadNums(true);   // neuer Plan seit dem letzten Zählen
  // Plan-Inhalt (bis ca. 30 KB) nur einmal je Plan laden
  const head = heads[0];
  if (head && S.planCache?.id !== head.id) S.planCache = { id: head.id, payload: (await Cloud.q('plans', { id: `eq.${head.id}`, select: 'payload' }))[0]?.payload };
  const active = head ? { ...head, payload: S.planCache.payload } : null;
  const [execs, drift] = active ? await Promise.all([
    Cloud.q('executions', { account_id: acc, plan_id: `eq.${active.id}`, select: 't,step,action,src_name', order: 't.asc', limit: 1000 }),
    Cloud.rpc('plan_abweichung', { p_plan: active.id }).catch(() => null),
  ]) : [[], null];
  // B14: nur bessere Entwürfe zeigen (Karte und Liste); Gewinn gegen das erwartete Ende des aktiven Plans
  const gains = await draftGains(plans, active, drift).catch(() => ({}));
  const offer = newPlanOffer(plans, active, gains);
  const hidden = plans.filter(p => gains[p.id] && !gains[p.id].better);
  plans = plans.filter(p => !hidden.includes(p));
  const own = isOwner();
  // B15 (15.10.): nur der freigegebene/aktive Plan, der angebotene Entwurf („Neuer Plan verfügbar“) und je Art der neueste
  // Entwurf; ältere Pläne (verworfen, abgebrochen, erledigt, überholte Entwürfe) und Löschen seit C1 im Atlas.
  const newest = new Set(offer ? [offer.draft.id] : []), kinds = new Set();   // plans ist nach created_at absteigend sortiert
  for (const p of plans) if (p.status === 'entwurf' && !kinds.has(p.kind)) { kinds.add(p.kind); newest.add(p.id); }
  const run = p => ['freigegeben', 'aktiv'].includes(p.status);
  const cur = [...plans.filter(run), ...plans.filter(p => !run(p) && newest.has(p.id))];
  const old = plans.filter(p => !cur.includes(p));
  const item = p => `<div class="list-item"><div class="row between">
      <span><b>${esc(planLabel(p.id))}</b> <span class="tag">${esc(KIND[p.kind] || p.kind)}</span></span>
      <span class="tag ${esc(p.status)}">${esc(p.status)}</span></div>
      <div class="small">${esc(tidy(p.title || '(ohne Titel)'))}</div>
      ${gains[p.id]?.gain != null ? `<div class="small ${gains[p.id].gain > PLAN_GAIN_MIN ? 'ok' : ''}">Gegen den aktiven Plan: ${esc(gainText(gains[p.id]))}</div>` : ''}
      <div class="muted small">${esc(SRC[p.source] || p.source)} · ${esc(dt(p.created_at))}${p.parent_id ? ` · aus ${esc(planLabel(p.parent_id))}` : ''}${p.approved_at ? ` · freigegeben ${esc(dt(p.approved_at))}` : ''}</div>
      ${planDetails(p)}
      ${own && p.status === 'entwurf' ? `<div class="row" style="margin-top:6px"><button class="primary" data-act="freigegeben" data-id="${esc(p.id)}">Freigeben</button>
        <button data-act="verworfen" data-id="${esc(p.id)}">Verwerfen</button></div>` : ''}
      ${own && run(p) ? `<div class="row" style="margin-top:6px"><button class="danger" data-act="abgebrochen" data-id="${esc(p.id)}">Abbrechen</button></div>` : ''}
      ${own && p.kind === 'build' && p.plan_hash ? `<div class="small" style="margin-top:6px"><a href="details/#/plaene/edit/${esc(p.id)}" target="_blank" rel="noopener">Plan ändern (Atlas, neuer Entwurf) →</a></div>` : ''}
    </div>`;
  $('#view').innerHTML = newPlanCard(offer, own) + abCard(active, sess, cmds, own, execs, W, drift) + optCard(opt[0], own) + `<div class="card" style="margin-top:12px"><h2>Pläne</h2>
    <p class="muted small">Entwürfe kommen vom Optimierer oder von Claude; gezeigt werden nur Baupläne, die das Ziel früher erreichen als der aktive Plan${hidden.length ? ` (${hidden.length} schlechtere ausgeblendet)` : ''}. Ausgeführt wird nur, was du freigibst; die Skripte melden den Fortschritt.</p>
    ${cur.length ? cur.map(item).join('') : `<p class="muted">${old.length ? 'Kein freigegebener Plan und kein offener Entwurf.' : 'Noch keine Pläne. Der Optimierer legt jeden neuen Bauplan hier als Entwurf ab.'}</p>`}
    <p class="small"><a href="details/#/plaene" target="_blank" rel="noopener">${old.length ? `Ältere Pläne (${old.length}) und Löschen` : 'Alle Pläne'} im Atlas →</a></p></div>`;
  $('#view').querySelectorAll('button[data-act]').forEach(b => b.addEventListener('click', async () => {
    const act = b.dataset.act, p = plans.find(x => x.id === b.dataset.id);
    if (act === 'freigegeben' && p?.kind === 'build') return takeNewPlan({ draft: p }, sess);   // F4: danach direkt übernehmen
    const q = { freigegeben: 'Plan freigeben? Die Skripte dürfen ihn danach ausführen (Start nur per Kommando).',
      verworfen: 'Entwurf verwerfen?', abgebrochen: 'Plan abbrechen? Laufende Skripte halten an.' }[act];
    if (!confirm(q)) return;
    try { await Cloud.rpc('plan_status', { p_id: b.dataset.id, p_status: act }); toast('Gespeichert'); route(); }
    catch (e) { toast(e.message); }
  }));
  $('#view').querySelectorAll('button[data-cmd]').forEach(b => b.addEventListener('click', () => sendCmd(active, b.dataset.cmd, sess)));
  $('#npGo')?.addEventListener('click', () => takeNewPlan(offer, sess));
  $('#npNo')?.addEventListener('click', async () => {
    if (!confirm('Entwurf verwerfen?')) return;
    try { await Cloud.rpc('plan_status', { p_id: offer.draft.id, p_status: 'verworfen' }); toast('Verworfen'); route(); } catch (e) { toast(e.message); }
  });
  $('#plSel')?.addEventListener('change', e => { S.planet = e.target.value; route(true); });
  $('#abDev')?.addEventListener('change', e => { S.abSel = { ...S.abSel, dev: e.target.value }; route(true); });
  watchCmds(cmds);
  const showStep = () => {
    const n = +$('#abUntil').value, s = active?.payload?.steps?.[n - 1];
    S.abSel = { ...S.abSel, until: n };
    $('#abStep').textContent = s ? `#${n}: ${s[5]}` : '';
  };
  if ($('#abUntil')) {
    $('#abUntil').addEventListener('input', showStep);
    const s = active?.payload?.steps?.[+$('#abUntil').value - 1]; $('#abStep').textContent = s ? `#${$('#abUntil').value}: ${s[5]}` : '';
    $('#view').querySelectorAll('tr.step').forEach(r => r.addEventListener('click', () => { $('#abUntil').value = r.dataset.i; showStep(); }));
  }
}

/* ---------- Mehr: Geräte & Rechte, Gruppe, Abmelden ---------- */

/* ---------- Push (B6, 14.10.) ----------
   Gerät meldet sich mit dem öffentlichen VAPID-Schlüssel aus Supabase (push_key) an; das Abo liegt in push_subs.
   Supabase schickt über die Edge Function „push“: Ereignisse „hoch“, Werbebanner da, Antworten von Claude (an Owner/Lesen). */
const b64u = s => { const b = atob((s + '='.repeat((4 - s.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, c => c.charCodeAt(0)); };
async function pushState() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window))
    return { ok: false, why: 'Dieser Browser kann keine Push-Nachrichten (am Handy: Chrome oder Firefox; iPhone nur als installierte App).' };
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return { ok: false, why: 'Service Worker nicht aktiv (nur über https; Seite neu laden).' };
  const [sub, st] = await Promise.all([reg.pushManager.getSubscription(), Cloud.rpc('push_status').catch(() => ({}))]);
  return { ok: true, sub, server: !!st.subscribed, perm: Notification.permission };
}
async function pushOn() {
  const key = await Cloud.rpc('push_key');
  if (!key) throw new Error('Supabase hat noch keinen Push-Schlüssel');
  if (await Notification.requestPermission() !== 'granted') throw new Error('Benachrichtigungen sind für diese Seite nicht erlaubt');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  const opts = { userVisibleOnly: true, applicationServerKey: b64u(key) };
  try { if (!sub) sub = await reg.pushManager.subscribe(opts); }
  catch { await sub?.unsubscribe(); sub = await reg.pushManager.subscribe(opts); }   // altes Abo mit anderem Schlüssel
  const j = sub.toJSON();
  await Cloud.rpc('push_subscribe', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth });
}
async function pushOff() {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  await sub?.unsubscribe().catch(() => {});
  await Cloud.rpc('push_unsubscribe');
}
async function fillPushCard() {
  const el = $('#pushCard');
  if (!el) return;
  const st = await pushState().catch(e => ({ ok: false, why: e.message }));
  const on = st.ok && st.sub && st.server && st.perm === 'granted';
  const canRead = ['owner', 'viewer'].includes(account()?.role);
  el.innerHTML = `<h2>Push</h2>
    <p class="small">Meldet sich bei Ereignissen „hoch“, wenn Werbebanner da sind und wenn Claude einen Auftrag beantwortet – auch wenn kein PC läuft.</p>
    ${!st.ok ? `<p class="warn small">${esc(st.why)}</p>` : `<p>Dieses Gerät: <b>${on ? 'angemeldet' : 'nicht angemeldet'}</b>${st.perm === 'denied' ? ' <span class="warn small">(Benachrichtigungen im Browser blockiert)</span>' : ''}</p>
      ${!canRead ? '<p class="muted small">Push gibt es nur für Geräte mit Recht Owner oder Lesen.</p>' : ''}
      <div class="row">${on ? '<button id="pushTest">Test-Push</button> <button id="pushOff">Abmelden</button>' : '<button class="primary" id="pushOn">Push einschalten</button>'}</div>`}`;
  const act = (id, fn) => $('#' + id)?.addEventListener('click', async () => { try { await fn(); } catch (e) { toast(e.message); } fillPushCard(); });
  act('pushOn', async () => { await pushOn(); toast('Push eingeschaltet'); });
  act('pushOff', async () => { await pushOff(); toast('Push abgemeldet'); });
  act('pushTest', async () => { const r = await Cloud.rpc('push_test', { p_account: S.acc }); toast(r.ok ? 'Test-Push gesendet – kommt in wenigen Sekunden' : r.text); });
}

/* ---------- Claude-Kanal (B6, 14.10.) ----------
   Aufträge (requests) an Claude: Owner stellt sie hier, eine Claude-Sitzung mit Wächter (tools/watch.py) wird geweckt,
   übernimmt (request_claim) und antwortet (request_answer, ggf. mit Planentwurf). Antworten kommen auch als Push. */
const RQ_ST = { neu: 'neu', in_arbeit: 'in Arbeit', beantwortet: 'beantwortet', abgelehnt: 'abgelehnt', zurueckgezogen: 'zurückgezogen' };
const RQ_KIND = { optimierer: 'Neuer Plan' };
const RQ_TGT = { any: 'beliebige Claude-Sitzung', sim: 'Simulations-PC', remote: 'Remote-PC' };
async function viewClaude() {
  const rq = await Cloud.q('requests', { account_id: `eq.${S.acc}`, order: 'created_at.desc', limit: 40,
    select: 'id,kind,target,text,status,answer,plan_ids,created_at,answered_at' });
  const own = isOwner();
  $('#view').innerHTML = `${own ? `<div class="card"><h2>Auftrag an Claude</h2>
      <form id="rqForm"><textarea name="text" rows="4" maxlength="8000" placeholder="Frage oder Auftrag, z. B. „Rechne den Plan neu ab dem neuesten Snapshot“" style="width:100%"></textarea>
      <div class="row" style="margin-top:6px">an <select name="target">${Object.entries(RQ_TGT).map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join('')}</select>
      <button class="primary">Senden</button></div></form>
      <p class="muted small">Claude sieht den Auftrag, sobald eine Sitzung mit Wächter läuft, und antwortet hier (mit Push). Pläne gibt Claude nie frei und schickt keine Kommandos an Skripte – das bleibt bei dir.</p></div>` : ''}
    <div class="card"><h2>Aufträge</h2>${rq.length ? rq.map(r => `<div class="list-item"><div class="row between">
      <span><span class="tag ${r.status === 'beantwortet' ? 'ok' : ''}">${esc(RQ_ST[r.status] || r.status)}</span> ${r.kind !== 'frage' ? `<span class="tag">${esc(RQ_KIND[r.kind] || r.kind)}</span> ` : ''}<span class="muted small">${esc(RQ_TGT[r.target] || r.target)}</span></span>
      <span class="muted small nowrap">${esc(when(r.created_at))}</span></div>
      <div class="wrapall" style="white-space:pre-wrap">${esc(tidy(r.text))}</div>
      ${r.answer ? `<div class="msgbody small"><b>Antwort</b>${r.answered_at ? ` <span class="muted">${esc(when(r.answered_at))}</span>` : ''}<br>${esc(tidy(r.answer))}</div>` : ''}
      ${r.plan_ids?.length ? `<div class="small"><a href="#/plaene">${r.plan_ids.length === 1 ? 'Planentwurf' : r.plan_ids.length + ' Planentwürfe'} unter Pläne →</a></div>` : ''}
      ${own && ['neu', 'in_arbeit'].includes(r.status) ? `<div class="row" style="margin-top:4px"><button class="small" data-wd="${esc(r.id)}">Zurückziehen</button></div>` : ''}
    </div>`).join('') : '<p class="muted">Noch keine Aufträge.</p>'}</div>`;
  $('#rqForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const text = e.target.text.value.trim();
    if (!text) return;
    try {
      await Cloud.rest('requests', { method: 'POST', prefer: 'return=minimal', body: { account_id: S.acc, kind: 'frage', target: e.target.target.value, text } });
      toast('Auftrag gesendet'); route(true);
    } catch (err) { toast(err.message); }
  });
  $('#view').querySelectorAll('button[data-wd]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Auftrag zurückziehen?')) return;
    try { await Cloud.rpc('request_withdraw', { p_id: b.dataset.wd }); toast('Zurückgezogen'); route(true); } catch (e) { toast(e.message); }
  }));
}

/* getData-Zugang (B18): Gäste-Passwort und Ablauf aus dem Spiel (Einstellungen → Account, „Gastzugang verfällt“).
   Das Passwort geht nur an public.getdata_zugang (Owner) und liegt danach im Supabase-Vault; das Cockpit zeigt es nie an. */
async function fillGdCard() {
  const el = $('#gdCard');
  if (!el) return;
  const g = (await Cloud.q('getdata_state', { account_id: `eq.${S.acc}`, select: 'expires_at,ok_at,error,error_at' }).catch(() => []))[0];
  const local = t => { const d = new Date(t); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
  el.innerHTML = `<h2>getData-Zugang</h2>
    <p class="small">${g?.expires_at ? `Gastzugang bis <b>${esc(dt(g.expires_at))}</b>` : 'Noch nicht eingerichtet.'}${g?.ok_at ? ` · letzter Abruf ${esc(ago(g.ok_at))}` : ''}</p>
    ${g?.error ? `<p class="small err">${esc(tidy(g.error))}</p>` : ''}
    <form id="fGd">
      <p><label class="small">Gäste-Passwort<br><input name="pw" type="password" autocomplete="off" placeholder="${g?.expires_at ? 'leer = unverändert' : ''}"></label></p>
      <p><label class="small">Gastzugang verfällt<br><input name="exp" type="datetime-local" required value="${g?.expires_at ? local(g.expires_at) : ''}"></label></p>
      <p><button>Speichern und abrufen</button></p></form>
    <p class="muted small">Im Spiel: Einstellungen → Account → Gastzugang (14d). Das Passwort liegt danach nur im Supabase-Vault. Supabase fragt alle 10 min Kolonien und Forschung ab (nur lesend).</p>`;
  $('#fGd').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, exp = new Date(f.exp.value);
    if (isNaN(exp)) return toast('Ablaufdatum fehlt');
    try {
      await Cloud.rpc('getdata_zugang', { p_account: S.acc, p_expires: exp.toISOString(), p_password: f.pw.value || null });
      f.pw.value = '';
      toast('Gespeichert – Ergebnis in etwa einer Minute unter Lage');
      fillGdCard();
    } catch (err) { toast(err.message); }
  });
}

async function viewMore() {
  const a = Cloud.access();
  const info = await Cloud.rpc('group_info');
  const own = isOwner();
  const members = info.members || [];
  const roleSel = m => {
    const r = m.accounts?.[S.acc] || 'none';
    if (!own || m.id === info.me) return `<span class="tag">${esc(ROLE[r] || 'kein Zugriff')}</span>`;
    return `<select data-member="${esc(m.id)}">${[['none', 'kein Zugriff'], ['viewer', 'Lesen'], ['executor', 'Skript'], ['claude', 'Claude'], ['owner', 'Owner']]
      .map(([v, t]) => `<option value="${v}"${v === r ? ' selected' : ''}>${t}</option>`).join('')}</select>`;
  };
  $('#view').innerHTML = `<div class="grid">
    <div class="card"><h2>Geräte &amp; Rechte <span class="muted small">für ${esc(account()?.player || '')}</span></h2>
      ${members.length ? `<table><tr><th>Gerät</th><th>zuletzt</th><th>Recht</th></tr>${members.map(m => `<tr><td>${esc(m.name || '(ohne Namen)')}${m.id === info.me ? ' <span class="muted small">(dieses)</span>' : ''}${m.role === 'admin' ? ' <span class="tag">Admin</span>' : ''}${info.role === 'admin' ? ` <button class="small" data-rename="${esc(m.id)}" data-name="${esc(m.name || '')}" title="Gerät umbenennen">✎</button>` : ''}</td>
        <td class="small muted">${esc(ago(m.last_seen))}</td><td>${roleSel(m)}</td></tr>`).join('')}</table>`
        : '<p class="muted">Mitgliederliste nur für Admins und Owner.</p>'}
      <p class="muted small">Neue Geräte melden sich mit dem Gruppen-Code an und erscheinen hier. Skript = Tampermonkey (Collector, Autobuilder);
        Claude = Wächter (nur Entwürfe und Antworten, nie Freigaben).${info.role === 'admin' ? ' ✎ = umbenennen; der Name bleibt fest (leer = Gerät benennt sich wieder selbst).' : ''}</p></div>
    <div class="card"><h2>Gruppe</h2><p>${esc(info.group)} · dieses Gerät: <b>${esc(a?.name)}</b>${info.role === 'admin' ? ' (Admin)' : ''}</p>
      <form id="fName" class="row"><input name="name" value="${esc(a?.name)}" style="flex:1"><button>Umbenennen</button></form>
      ${info.role === 'admin' ? '<p><button id="newCode" class="danger">Neuen Gruppen-Code erzeugen</button></p><p class="muted small">Alle anderen Geräte müssen sich danach neu anmelden (auch Skripte und Claude).</p>' : ''}
      <p><button id="logout">Abmelden</button></p></div>
    <div class="card" id="pushCard"><h2>Push</h2><p class="muted small">wird geprüft …</p></div>
    <div class="card"><h2>Horizon Atlas</h2><p class="small">Details am PC (gleiche Anmeldung):
      ${[['imperium', 'Imperium'], ['galaxie', 'Galaxie'], ['ereignisse', 'alle Ereignisse'], ['plaene', 'Pläne-Archiv'], ['werft', 'Werft/Def'], ['wissen', 'Kompendium'], ['verbrauch', 'Verbrauch']]
        .map(([h, t]) => `<a href="details/#/${h}" target="_blank" rel="noopener">${t}</a>`).join(' · ')}</p></div>
    ${own ? '<div class="card" id="gdCard"><h2>getData-Zugang</h2><p class="muted small">wird geladen …</p></div>' : ''}
    <div class="card"><h2>Über</h2><p class="small">Version ${esc(window.APP_VERSION?.number)}${window.APP_VERSION?.built && window.APP_VERSION.built !== 'lokal' ? ` vom ${esc(dt(window.APP_VERSION.built))}` : ' (lokal)'}</p>
      <details class="sub"><summary class="small muted">Details</summary><p class="small muted wrapall">Gerätekennung ${esc(Cloud.device)}</p></details>
      <p class="small">Ansicht: <b>${isStandalone() ? 'als App (ohne Browserleiste)' : 'im Browser'}</b></p>
      ${!isStandalone() ? `<p><button id="install"${installPrompt ? '' : ' disabled'}>Als App installieren</button></p>
        <p class="muted small" id="installHint">${installPrompt ? 'Chrome bietet die Installation an.'
          : 'Chrome bietet gerade keine Installation an (Seite neu laden; sonst Chrome-Menü ⋮ → „App installieren“, auf dem iPhone Safari → Teilen → „Zum Home-Bildschirm“).'}</p>` : ''}
      <p class="small muted">Plan und Stand: doku/stand/cockpit.md im Horizon-Repo.</p></div></div>`;
  fillPushCard();
  if (own) fillGdCard();
  $('#view').querySelectorAll('select[data-member]').forEach(s => s.addEventListener('change', async () => {
    try { await Cloud.rpc('account_grant', { p_account: S.acc, p_member: s.dataset.member, p_role: s.value }); toast('Recht gespeichert'); }
    catch (e) { toast(e.message); route(); }
  }));
  // Admin: Gerät umbenennen (Name bleibt fest, touch des Geräts überschreibt ihn nicht; leer = Sperre aufheben)
  $('#view').querySelectorAll('button[data-rename]').forEach(b => b.addEventListener('click', async () => {
    const n = prompt('Neuer Name für das Gerät (leer = Gerät benennt sich wieder selbst):', b.dataset.name);
    if (n === null) return;
    try { await Cloud.rpc('admin_member', { p_id: b.dataset.rename, p_action: 'rename', p_name: n.trim() }); toast('Name gespeichert'); route(); }
    catch (e) { toast(e.message); }
  }));
  $('#fName').addEventListener('submit', async e => {
    e.preventDefault();
    const n = e.target.name.value.trim();
    if (!n) return;
    try {
      if (info.role === 'admin') await Cloud.rpc('admin_member', { p_id: info.me, p_action: 'rename', p_name: n });  // auch bei festem Namen
      await Cloud.login(Cloud.access().code, n); toast('Gespeichert'); renderAccSelect(); route();     // touch setzt den Namen
    } catch (err) { toast(err.message); }
  });
  $('#newCode')?.addEventListener('click', async () => {
    if (!confirm('Neuen Gruppen-Code erzeugen? Alle anderen Geräte müssen sich neu anmelden.')) return;
    try {
      const code = await Cloud.rpc('admin_new_code');
      await Cloud.login(code, Cloud.access().name);
      alert(`Neuer Gruppen-Code: ${code}\nBitte notieren.`);
    } catch (e) { toast(e.message); }
  });
  $('#install')?.addEventListener('click', async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    installPrompt = null;
    toast(outcome === 'accepted' ? 'Wird installiert – danach „Cockpit“ in der App-Übersicht' : 'Installation abgebrochen');
    route();
  });
  $('#logout').onclick = () => { if (confirm('Abmelden?')) { Cloud.logout(); renderLogin(); } };
}

boot();
