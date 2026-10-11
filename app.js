'use strict';
/* Horizon-Cockpit – Gerüst (P1): Anmeldung, Account, Lage, Ereignisse, Pläne (Liste + Freigabe), Wissen, Geräte & Rechte.
   Alle Daten aus Supabase (cloud.js); Texte aus der Datenbank werden immer escaped. */

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 0) => n == null || n === '' || !isFinite(n) ? '–'
  : Number(n).toLocaleString('de-DE', { maximumFractionDigits: d, minimumFractionDigits: 0 });
const dt = t => t ? new Date(t).toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '–';
function ago(t) {
  if (!t) return '–';
  const s = Math.round((Date.now() - new Date(t)) / 1000);
  if (s < 90) return 'gerade eben';
  if (s < 5400) return `vor ${Math.round(s / 60)} min`;
  if (s < 172800) return `vor ${fmt(s / 3600, 1)} h`;
  return `vor ${Math.round(s / 86400)} Tagen`;
}
function dur(sec) {
  if (sec == null || !isFinite(sec)) return '–';
  sec = Math.max(0, Math.round(sec));
  const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60);
  return (d ? `${d} d ` : '') + `${h} h ${String(m).padStart(2, '0')} min`;
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 3500);
}

const S = { acc: null, wissen: null };
const ROLE = { owner: 'Owner', executor: 'Skript', claude: 'Claude', viewer: 'Lesen' };
const STAGES = ['Doku', 'Parser', 'Erkennung', 'Live erhoben', 'Probelauf', 'Erste Aktion', 'Frei'];

function accounts() { return Cloud.access()?.accounts || []; }
function account() { return accounts().find(a => a.id === S.acc) || null; }
function isOwner() { return account()?.role === 'owner'; }

/* ---------- Start und Anmeldung ---------- */

// Installation als App: Chrome meldet beforeinstallprompt nur einmal je Seitenaufruf, deshalb früh merken
let installPrompt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; if (location.hash === '#/mehr') route(); });
window.addEventListener('appinstalled', () => { installPrompt = null; toast('Als App installiert'); });
function isStandalone() { return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; }

async function boot() {
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
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

const VIEWS = { lage: viewLage, ereignisse: viewEvents, plaene: viewPlans, wissen: viewWissen, mehr: viewMore };

// soft = automatische Aktualisierung: ohne „Lädt …“, die Ansicht bleibt bis zum Neuaufbau stehen
async function route(soft) {
  if (!Cloud.loggedIn() || !S.acc) return;
  const [tab = 'lage', ...rest] = location.hash.replace(/^#\/?/, '').split('/');
  const fn = VIEWS[tab] || viewLage;
  document.querySelectorAll('nav.tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === (VIEWS[tab] ? tab : 'lage')));
  if (soft !== true) $('#view').innerHTML = '<p class="muted pad">Lädt …</p>';
  try { await fn(rest); } catch (e) {
    if (e instanceof LoginNeeded) return renderLogin(e.message);
    $('#view').innerHTML = `<div class="card"><p class="err">${esc(e.message)}</p><button onclick="route()">Erneut versuchen</button></div>`;
  }
  updateBadge();
}

// Lage und Pläne alle 30 s still neu laden (nur sichtbar, nicht während einer Eingabe oder bei aufgeklappter Liste).
// Der große Live-Stand kommt dabei nur bei neuem Zeitstempel (S.snap), sonst nur Lauf, Lebenszeichen, Ereignisse.
setInterval(() => {
  const tab = location.hash.replace(/^#\/?/, '').split('/')[0] || 'lage';
  if (document.visibilityState !== 'visible' || !['lage', 'plaene'].includes(tab)) return;
  if (document.activeElement?.matches?.('input,select,textarea')) return;
  route(true);
}, 30000);

async function updateBadge() {
  try {
    const r = await Cloud.q('events', { select: 'id', account_id: `eq.${S.acc}`, level: 'eq.hoch', seen_at: 'is.null', limit: 99 });
    $('#evBadge').hidden = !r.length; $('#evBadge').textContent = r.length;
  } catch { /* egal */ }
}

/* ---------- Lage ---------- */

const RES = ['Eisenerz', 'Mineral', 'Treibstoff'];

async function viewLage() {
  const acc = `eq.${S.acc}`;
  const [heads, sess, evs, feats] = await Promise.all([
    Cloud.q('state_latest', { account_id: acc, kind: 'eq.live', select: 'kind,collected_at,version' }),
    loadSessions(),
    Cloud.q('events', { account_id: acc, order: 't.desc', limit: 6 }),
    Cloud.q('features', { account_id: acc, order: 'key' }),
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
  let html = runCard(sess) + sessionsCard(sess) + bannerCard(sess);
  if (!d) {
    html += `<div class="card warn"><h2>Noch kein Live-Stand</h2><p class="muted">Sobald der Collector (ab Version 0.2) mit diesem Account
      verbunden ist, erscheint hier der Spielstand. Bis dahin: Mehr → Geräte &amp; Rechte → Firefox-Gerät als „Skript“ freigeben.</p></div>`;
  } else {
    const st = d.start || {}, prod = d.prod || {};
    const at = new Date(live.collected_at);
    const age = (Date.now() - at) / 3600e3;
    html += `<div class="card${age > 3 ? ' warn' : ''}"><div class="row between"><h2>${esc(st.planet || '')} <span class="muted">${esc(st.coords || '')}</span></h2>
      <span class="muted small">Stand ${esc(dt(live.collected_at))} (${esc(ago(live.collected_at))})</span></div>
      <div class="muted small">${esc(st.player || '')} · Rang ${esc(st.rank ?? '–')} · ${fmt(st.points)} Punkte · ${esc(st.status || '')}</div></div>`;
    html += '<div class="grid">';
    // Rohstoffe: Bestand hochgerechnet auf jetzt
    const stock = prod['Aktueller Lagerbestand'] || {}, rate = prod['Förderung'] || {}, use = prod['Verbrauch'] || {};
    const cap = prod['Maximal stabile Menge'] || {};
    const hrs = (Date.now() - at) / 3600e3;
    html += `<div class="card"><h2>Rohstoffe</h2><table><tr><th></th><th class="num">jetzt ca.</th><th class="num">/h</th><th class="num">stabil bis</th><th class="num">voll in</th></tr>${
      RES.map(r => {
        const net = (rate[r] || 0) - (use[r] || 0);
        const now = Math.min((stock[r] || 0) + net * hrs, cap[r] || Infinity);
        const full = net > 0 && cap[r] ? (cap[r] - now) / net * 3600 : null;
        return `<tr><td>${r}</td><td class="num">${fmt(now)}</td><td class="num">${fmt(net)}</td><td class="num">${fmt(cap[r])}</td><td class="num">${full == null ? '–' : dur(full)}</td></tr>`;
      }).join('')}</table>`;
    const avail = prod['Aktuelle Verfügbarkeit'] || {}, need = prod['Benötigte Kapazitäten'] || {};
    html += `<h3>Arbeiter und Energie</h3><table>${['Arbeiter', 'Energie'].map(k => {
      const ratio = need[k] ? Math.min(1, (avail[k] || 0) / need[k]) : 1;
      return `<tr><td>${k}</td><td class="num">${fmt(avail[k])} / ${fmt(need[k])}</td><td style="width:40%"><div class="bar"><i style="width:${Math.round(ratio * 100)}%"></i></div></td><td class="num">${fmt(ratio * 100)} %</td></tr>`;
    }).join('')}</table></div>`;
    // laufende Aufträge: aus der letzten Prüfung des Autobuilders, wenn die neuer ist als der Live-Stand (Starts des
    // Autobuilders erscheinen sofort, nicht erst nach dem nächsten Login)
    const W = await loadWissen().catch(() => null);  // Namen für noch nicht gebaute Stufen
    const nm = (i, set) => i.name || W?.[set]?.[i.type]?.n || i.type;
    const fromAb = abLive && abLive.liveAt > at.getTime();
    const jobs = fromAb
      ? (abLive.jobs || []).map(j => ({ k: j.k === 'b' ? 'Bau' : 'Forschung', type: j.t, name: W?.[j.k === 'b' ? 'B' : 'R']?.[j.t]?.n, level: j.l, end: new Date(j.end) }))
      : [...(d.buildings?.items || []).map(i => ({ ...i, k: 'Bau' })), ...(d.research?.items || []).map(i => ({ ...i, k: 'Forschung' }))]
        .filter(i => i.inProgress).map(j => ({ ...j, end: j.remaining != null ? new Date(at.getTime() + j.remaining * 1000) : null }));
    html += `<div class="card"><div class="row between"><h2>Laufende Aufträge</h2><span class="muted small">${fromAb
      ? `Autobuilder ${esc(ago(abLive.liveAt))}` : `Live-Stand ${esc(ago(live.collected_at))}`}</span></div>${jobs.length ? `<table>${jobs.map(j => {
      const left = j.end ? (j.end - Date.now()) / 1000 : null;
      const pct = j.totalTime && left != null ? Math.min(100, Math.max(0, 100 - left / j.totalTime * 100)) : null;
      return `<tr><td><span class="tag">${j.k}</span> ${esc(j.name || j.type)} → ${esc(j.level)}
        ${pct == null ? '' : `<div class="bar"><i style="width:${pct.toFixed(0)}%"></i></div>`}</td>
        <td class="num">${j.end ? `${left > 0 ? dur(left) : 'fertig'}<div class="muted small">${esc(dt(j.end))}</div>` : '–'}</td></tr>`;
    }).join('')}</table>` : '<p class="muted">Keine – Baustelle/Labor frei.</p>'}</div>`;
    const lv = (items, set) => items.map(i => `<tr><td>${esc(nm(i, set))}</td><td class="num">${esc(i.levelDone ?? i.level)}${i.inProgress ? ` → ${esc(i.level)}` : ''}</td></tr>`).join('');
    html += `<div class="card"><h2>Gebäude</h2><table>${lv(d.buildings?.items || [], "B")}</table>
      ${d.buildings?.space ? `<p class="muted small">Bauplatz frei ${fmt(d.buildings.space.free)} von ${fmt(d.buildings.space.total)}</p>` : ''}</div>`;
    html += `<div class="card"><h2>Forschung</h2><table>${lv(d.research?.items || [], "R") || '<tr><td class="muted">–</td></tr>'}</table></div>`;
    html += '</div>';
  }
  html += '<div class="grid" style="margin-top:12px">';
  html += `<div class="card"><div class="row between"><h2>Letzte Ereignisse</h2><a href="#/ereignisse" class="small">alle</a></div>${evs.length ? evs.map(evRow).join('') : '<p class="muted">Keine.</p>'}</div>`;
  html += `<div class="card"><h2>Funktionen</h2>${feats.length ? `<table>${feats.map(f => `<tr><td>${esc(f.label || f.key)}${f.unlocked_at ? '' : ' <span class="muted small">(gesperrt)</span>'}</td>
    <td title="${esc(STAGES[f.stage])}"><span class="stage">${STAGES.map((_, i) => `<i class="${i <= f.stage ? 'on' : ''}"></i>`).join('')}</span> <span class="small muted">${esc(STAGES[f.stage])}</span></td></tr>`).join('')}</table>`
    : '<p class="muted">Noch keine erfasst. Der Collector trägt Freischaltungen ein (Werft, Raumhafen, Flotte …).</p>'}</div>`;
  html += '</div>';
  $('#view').innerHTML = html;
  $('#bannerGo')?.addEventListener('click', () => sendBanner(sess));
}

/* ---------- Werbebanner (Autobuilder ab 0.5.1) ----------
   Der Autobuilder meldet aktive Banner im Lebenszeichen; aufgerufen werden sie nur per Kommando „banner“ nach Tippen des Owners. */
const bannerDev = sess => sess.devs.find(x => x.ab && isFresh(x.ab.at) && x.ab.state?.page === 'game' && x.ab.state?.banner?.n);
function bannerCard(sess) {
  const x = bannerDev(sess), b = x?.ab.state.banner;
  if (!b) return '';
  return `<div class="card"><div class="row between"><h2>Werbebanner</h2><span class="muted small">seit ${esc(dt(b.since))}</span></div>
    <p>${esc(b.n)} von 3 aktiv auf <b>${esc(x.name)}</b></p><div class="small">${(b.slots || []).map(s => `Monitor ${esc(s.slot)}: ${esc(s.host || (s.href ? 'intern' : 'ohne Link'))}
    <span class="muted">${esc(s.href || s.src || '')}</span>`).join('<br>')}</div>
    ${isOwner() ? '<div class="row" style="margin-top:6px"><button class="primary" id="bannerGo">Banner jetzt öffnen</button></div>' : ''}</div>`;
}
async function sendBanner(sess) {
  const x = bannerDev(sess);
  if (!x) return toast('Kein Gerät mit aktiven Bannern erreichbar');
  if (!confirm(`Banner auf ${x.name} jetzt einmal aufrufen?`)) return;
  try {
    await Cloud.rest('commands', { method: 'POST', prefer: 'return=minimal',
      body: { account_id: S.acc, script: 'autobuilder', cmd: 'banner', args: {}, target_device: x.device } });
    toast(`Kommando an ${x.name} gesendet – Ergebnis unter Ereignisse`);
    setTimeout(() => route(true), 1500);
  } catch (e) { toast(e.message); }
}

const CAT = { builder: 'Builder', cockpit: 'Cockpit', spiel: 'Spiel', system: 'System' };
function evRow(e) {
  return `<div class="list-item ev${e.seen_at ? '' : ' unseen'}" data-id="${esc(e.id)}"><div class="row between">
    <span><span class="tag ${esc(e.level)}">${esc(e.level)}</span> <span class="tag">${esc(CAT[e.cat] || e.cat || '')}</span> ${esc(e.kind)}</span><span class="muted small">${esc(dt(e.t))}</span></div>
    <div>${esc(e.text)}</div>${bannerSlots(e)}<div class="muted small">${esc(e.src_name || e.origin)}</div></div>`;
}
// Werbebanner (Autobuilder ab 0.5.1): Ziele nur als Text zeigen; ob und wie sie geöffnet werden, ist noch offen
function bannerSlots(e) {
  const s = e.kind === 'banner' && Array.isArray(e.data?.slots) ? e.data.slots : [];
  return s.length ? `<div class="small">${s.map(x => `Monitor ${esc(x.slot)}: ${esc(x.host || (x.href ? 'intern' : 'ohne Link'))}
    <span class="muted">${esc(x.href || x.onclick || x.src || '')}</span>`).join('<br>')}</div>` : '';
}

/* ---------- Sitzungen und Lauf (mehrere PCs) ----------
   runs: genau ein Lauf je Account (Gerät, Plan, bis #, Zustand); heartbeats je Gerät: Autobuilder (voller Zustand inkl.
   Seite Spiel/Login) und Collector. „verloren“ setzt Supabase selbst (pg_cron), wenn der Halter 3 min schweigt. */
const RUNST = { laeuft: 'läuft', schlaeft: 'schläft (ausgeloggt)', angehalten: 'angehalten', verloren: 'verloren' };
const isFresh = (t, min = 3) => !!t && (Date.now() - new Date(t)) / 60e3 < min;
const clockT = t => t ? new Date(t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '–';
async function loadSessions() {
  const acc = `eq.${S.acc}`;
  const [runs, hbs] = await Promise.all([
    Cloud.q('runs', { account_id: acc, script: 'eq.autobuilder' }),
    Cloud.q('heartbeats', { account_id: acc, order: 'at.desc' }),
  ]);
  const by = {};
  for (const h of hbs) {
    const x = by[h.device] ||= { device: h.device, name: '', ab: null, col: null };
    if (h.script === 'autobuilder') x.ab = h; else if (h.script === 'collector') x.col = h;
    if (h.name && !x.name) x.name = h.name;
  }
  const run = runs[0] || null;
  const devs = Object.values(by).map(x => ({ ...x, name: x.name || `Gerät ${x.device.slice(0, 6)}`, holds: run?.device === x.device,
    last: [x.ab?.at, x.col?.at].filter(Boolean).sort().pop() }));
  devs.sort((a, b) => (b.holds - a.holds) || String(b.last).localeCompare(String(a.last)));
  return { run, devs };
}
// Text zum Zustand eines Geräts (Seite, Autobuilder)
function devState(x) {
  const s = x.ab?.state || {};
  if (!x.ab || !isFresh(x.ab.at)) return { on: false, txt: `kein Lebenszeichen ${x.last ? ago(x.last) : ''}`.trim() };
  const page = s.page === 'login' ? 'Login-Seite (ausgeloggt)' : 'im Spiel eingeloggt';
  const ab = s.running ? `${s.mode === 'live' ? 'baut' : 'Probelauf'} bis #${s.until}${s.sleeping ? `, Login ${clockT(s.wakeAt)}` : ''}${s.claim ? ' · meldet sich an' : ''}`
    : `angehalten${s.stopReason ? ': ' + s.stopReason : ''}`;
  return { on: true, page: s.page, txt: `${page} · ${ab}` };
}
function runCard(sess) {
  const r = sess.run;
  return `<div class="card${r?.state === 'verloren' ? ' warn' : ''}"><div class="row between"><h2>Autobuilder</h2>
    <span class="muted small">${r ? `seit ${esc(dt(r.since))}` : ''}</span></div>${runBody(sess)}</div>`;
}
// Zustand des Laufs (wer baut gerade, bis #, schläft/verloren, Status der letzten Prüfung)
function runBody(sess) {
  const r = sess.run, h = r && sess.devs.find(x => x.holds), s = h?.ab?.state || {};
  if (!r) return '<p class="muted">Noch kein Lauf. Start im Spiel (Knopf) oder unter Pläne.</p>';
  let html = `<p><b class="${r.state === 'verloren' ? 'err' : ''}">${esc(RUNST[r.state] || r.state)}</b> · ${r.mode === 'live' ? 'Lauf' : 'Probelauf'} bis #${esc(r.until ?? '–')}
    auf <b>${esc(r.name || 'unbekanntem Gerät')}</b>${r.state === 'schlaeft' && r.wake_at ? ` · Login ${esc(clockT(r.wake_at))}` : ''}</p>`;
  if (r.state === 'verloren' || r.state === 'angehalten') html += `<p class="small ${r.state === 'verloren' ? 'err' : 'muted'}">${esc(r.reason)}</p>`;
  if (['laeuft', 'schlaeft'].includes(r.state) && h?.ab) {
    html += `<p class="small muted">${s.planInfo ? esc(s.planInfo) : s.ahead != null ? `Vorlauf ${esc(fmt(s.ahead, 1))} h` : ''}${s.next ? ` · nächste Prüfung ${esc(clockT(s.next))}` : ''}
      · Lebenszeichen ${esc(ago(h.ab.at))}</p>${s.status ? `<p class="small">${esc(s.status)}</p>` : ''}`;
  }
  return html;
}
// Versionen vergleichen ('0.5.10' > '0.5.9')
const verCmp = (a, b) => {
  const pa = String(a || '').split('.').map(Number), pb = String(b || '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; }
  return 0;
};
function sessionsCard(sess) {
  const shown = sess.devs.filter(x => x.holds || isFresh(x.last, 7 * 24 * 60));
  const hidden = sess.devs.length - shown.length;
  // neueste Version je Skript unter den gezeigten Geräten; ältere Stände markieren (Tampermonkey holt Updates selbst)
  const top = { ab: '', col: '' };
  for (const x of shown) for (const k of ['ab', 'col']) if (x[k] && verCmp(x[k].version, top[k]) > 0) top[k] = x[k].version;
  const ver = (x, k, label) => {
    if (!x[k]) return '';
    const old = verCmp(x[k].version, top[k]) < 0;
    return `<span class="${old ? 'err' : ''}" title="${old ? `veraltet, neueste ${esc(top[k])}` : ''}">${label} ${esc(x[k].version)}${old ? ' ↓' : ''}</span>`;
  };
  const stale = shown.some(x => ['ab', 'col'].some(k => x[k] && verCmp(x[k].version, top[k]) < 0));
  return `<div class="card"><h2>Sitzungen</h2>${shown.length ? `<table>${shown.map(x => {
    const st = devState(x);
    return `<tr><td>${x.holds ? '★ ' : ''}<b>${esc(x.name)}</b><div class="small ${st.on ? '' : 'muted'}">${esc(st.txt)}</div></td>
      <td class="num small muted">${ver(x, 'ab', 'AB')}${x.ab && x.col ? '<br>' : ''}${ver(x, 'col', 'C')}</td></tr>`;
  }).join('')}</table>` : '<p class="muted">Noch keine Lebenszeichen.</p>'}
    ${stale ? '<p class="small err">Die PCs haben verschiedene Skript-Stände (↓ = veraltet). Tampermonkey holt Updates selbst, sobald das Skript einmal über die Update-Adresse installiert ist; sonst dort „Nach Updates suchen“.</p>' : ''}
    <p class="muted small">★ = hält den Lauf. Nur ein PC kann im Spiel eingeloggt sein; ein eingeloggter PC übernimmt den Lauf
    (Option im Autobuilder).${hidden ? ` ${hidden} ältere Geräte ausgeblendet.` : ''}</p></div>`;
}

/* ---------- Ereignisse ---------- */

async function viewEvents() {
  const lvl = sessionStorage.getItem('hz.evlvl') || '', cat = sessionStorage.getItem('hz.evcat') || '';
  const p = { account_id: `eq.${S.acc}`, order: 't.desc', limit: 200 };
  if (lvl) p.level = `eq.${lvl}`;
  if (cat) p.cat = `eq.${cat}`;
  const evs = await Cloud.q('events', p);
  const canSee = ['owner', 'viewer'].includes(account()?.role);
  $('#view').innerHTML = `<div class="card"><div class="row between"><h2>Ereignisse</h2>
    <div class="row"><select id="cat"><option value="">alle Bereiche</option>${Object.entries(CAT).map(([k, t]) => `<option value="${k}"${k === cat ? ' selected' : ''}>${t}</option>`).join('')}</select>
    <select id="lvl"><option value="">alle Stufen</option>${['hoch', 'mittel', 'niedrig'].map(l => `<option${l === lvl ? ' selected' : ''}>${l}</option>`).join('')}</select>
    ${canSee ? '<button id="seenAll">alle gesehen</button>' : ''}</div></div>
    <p class="muted small">Builder = Autobuilder und Sitzungen · Cockpit = Freigaben und Kommandos · Spiel = Berichte und Nachrichten · System = Supabase-Wächter</p>
    ${evs.length ? evs.map(evRow).join('') : '<p class="muted">Keine Ereignisse.</p>'}</div>`;
  $('#lvl').onchange = e => { sessionStorage.setItem('hz.evlvl', e.target.value); route(); };
  $('#cat').onchange = e => { sessionStorage.setItem('hz.evcat', e.target.value); route(); };
  $('#seenAll')?.addEventListener('click', async () => {
    await Cloud.rest(`events?account_id=eq.${S.acc}&seen_at=is.null`, { method: 'PATCH', body: { seen_at: new Date().toISOString() }, prefer: 'return=minimal' });
    route();
  });
}

/* ---------- Pläne ---------- */

const KIND = { build: 'Bau', research: 'Forschung', ship: 'Schiffe', probe: 'Sonden', trade: 'Handel', defense: 'Verteidigung', fleet: 'Flotte', transport: 'Transport' };

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
function stepsTable(plan, st, execs, all, W) {
  const t0 = Date.parse(plan.startTime);
  const open = (st.open || []).filter(Number.isInteger);
  const first = open.length ? Math.min(...open) : null;
  const until = st.until || plan.steps.length;
  const done = new Map(execs.filter(e => e.step).map(e => [e.step, e]));
  const isDone = n => done.has(n) || (first != null && n < first);
  const nameOf = k => W?.B?.[k]?.n || k;
  const rows = [];
  plan.steps.forEach((s, i) => { if (s[0] !== 's') rows.push({ tau: s[3], n: i + 1, s }); });
  for (const fc of factorChanges(plan)) rows.push({ tau: fc.tau, fc });
  rows.sort((a, b) => a.tau - b.tau || (a.fc ? -1 : 1));
  const from = first ?? 1;
  const vis = all ? rows : rows.filter(r => r.fc ? true : r.n >= from && r.n <= until);
  // Faktorwechsel im Ausschnitt nur zwischen dem ersten und letzten gezeigten Schritt
  const steps = vis.filter(r => !r.fc);
  const lo = steps.length ? steps[0].tau : Infinity, hi = steps.length ? steps[steps.length - 1].tau : -Infinity;
  const list = all ? vis : vis.filter(r => !r.fc || (r.tau >= lo && r.tau <= hi));
  if (!steps.length && !all) return `<p class="muted small">Kein offener Schritt bis #${esc(until)}${first ? ` (als Nächstes #${first})` : ''}.</p>`;
  return `<table class="small">${list.map(r => {
    if (r.fc) return `<tr class="muted"><td></td><td>⚙ Faktor ${r.fc.ch.map(([k, a, b]) => `${esc(nameOf(k))} ${FMT_PCT(a)} → ${FMT_PCT(b)}`).join(', ')}</td><td class="num">${esc(dt(t0 + r.tau * 3600e3))}</td></tr>`;
    const e = done.get(r.n), mark = isDone(r.n) ? '✓' : open.includes(r.n) ? '▶' : '';
    return `<tr class="step${isDone(r.n) ? ' muted' : ''}" data-i="${r.n}"><td class="num">${mark} #${r.n}</td><td>${esc(r.s[5])}${e ? `<div class="small">gestartet ${esc(dt(e.t))} · ${esc(e.src_name)}</div>` : ''}</td>
      <td class="num">${esc(dt(t0 + r.tau * 3600e3))}</td></tr>`;
  }).join('')}</table>`;
}
function abCard(active, sess, cmds, own, execs, W) {
  const plan = active?.payload, run = sess.run;
  const live = sess.devs.filter(x => x.ab && isFresh(x.ab.at));
  const holder = sess.devs.find(x => x.holds);
  // Zielgerät: gewähltes, sonst Lauf-Halter (wenn erreichbar), sonst eingeloggtes, sonst erstes erreichbares
  const target = live.find(x => x.device === S.abSel?.dev) || (holder && live.includes(holder) && holder)
    || live.find(x => x.ab.state.page === 'game') || live[0] || null;
  const st = target?.ab?.state || {};
  let html = `<div class="card"><div class="row between"><h2>Autobuilder</h2><span class="muted small">${run ? `seit ${esc(dt(run.since))}` : ''}</span></div>`;
  html += runBody(sess);
  if (!active) return html + '<p class="muted">Kein freigegebener Bauplan. Erst einen Entwurf freigeben.</p>' + `<div id="abCmds">${cmdTable(cmds)}</div></div>`;
  html += `<p class="small">Freigegeben: <b>${esc(active.title)}</b> (Plan-id ${esc(plan?.id)}, ${esc(active.status)})</p>`;
  if (!live.length) html += '<p class="err small">Kein Autobuilder erreichbar (Browser zu oder Skripte aus).</p>';
  else {
    html += `<div class="row" style="margin:8px 0">Gerät <select id="abDev">${live.map(x => `<option value="${esc(x.device)}"${x === target ? ' selected' : ''}>${x.holds ? '★ ' : ''}${esc(x.name)} – ${x.ab.state.page === 'login' ? 'ausgeloggt' : 'eingeloggt'}</option>`).join('')}</select></div>`;
    if (st.plan !== plan?.id) {
      html += st.offered === plan?.id
        ? `<p class="warn small">${esc(target.name)} hat den freigegebenen Plan angeboten bekommen, arbeitet aber noch mit ${esc(st.plan)}.</p>
           ${own ? `<button class="primary" data-cmd="adopt"${st.running || st.page === 'login' ? ' disabled title="erst stoppen bzw. einloggen"' : ''}>Plan auf ${esc(target.name)} übernehmen</button>` : ''}`
        : '<p class="muted small">Der Collector bietet den Plan beim nächsten Abgleich an (bis 1 min).</p>';
    } else if (own) {
      html += `<div class="row" style="margin:8px 0">bis # <input id="abUntil" type="number" min="1" max="${plan.steps.length}" value="${esc(S.abSel?.until || st.until || run?.until || 10)}" style="width:5em">
        <button data-cmd="dry">Probelauf</button> <button class="primary" data-cmd="live">Start</button> <button class="danger" data-cmd="stop">Stopp</button></div>
        <div class="muted small" id="abStep"></div>`;
    }
  }
  if (plan) {
    const hst = (holder?.ab?.state?.plan === plan.id ? holder.ab.state : null) || (st.plan === plan.id ? st : {});
    html += `<div class="row between" style="margin-top:10px"><h3 style="margin:0">Planschritte ${S.allSteps ? `(alle ${plan.steps.length})` : `(offen bis #${esc(hst.until || '–')})`}</h3>
      <button class="link small" id="allSteps">${S.allSteps ? 'nur offene' : 'alle mit Historie'}</button></div>${stepsTable(plan, hst, execs, S.allSteps, W)}`;
  }
  return html + `<div id="abCmds">${cmdTable(cmds)}</div></div>`;
}

const cmdTable = cmds => !cmds.length ? '' : `<h3>Letzte Kommandos</h3><table class="small">${cmds.map(c => `<tr><td>${esc(dt(c.created_at))}</td>
    <td>${esc(c.cmd)}${c.args?.mode ? ' ' + esc(c.args.mode) : ''}${c.args?.until ? ' bis #' + esc(c.args.until) : ''}${c.target_name ? ` → ${esc(c.target_name)}` : ''}</td>
    <td><span class="tag">${esc(c.status)}</span></td><td class="muted">${esc(c.result)}${c.taken_name && c.taken_name !== c.target_name ? ` · ${esc(c.taken_name)}` : ''}</td></tr>`).join('')}</table>`;

// Offene Kommandos (neu/angenommen) alle 5 s nachsehen, ohne die Seite neu aufzubauen; fertig → einmal neu laden
const OPEN_CMD = c => ['neu', 'angenommen'].includes(c.status);
function watchCmds(cmds, since = Date.now()) {
  clearTimeout(watchCmds.t);
  if (!cmds.some(OPEN_CMD)) return;
  watchCmds.t = setTimeout(async () => {
    if (!$('#abCmds') || Date.now() - since > 5 * 60e3) return;
    try {
      const fresh = await Cloud.q('commands', { account_id: `eq.${S.acc}`, script: 'eq.autobuilder', order: 'id.desc', limit: 8 });
      if (!$('#abCmds')) return;
      $('#abCmds').innerHTML = cmdTable(fresh);
      if (fresh.some(OPEN_CMD)) watchCmds(fresh, since); else route(true);
    } catch { watchCmds(cmds, since); }
  }, 5000);
}

async function sendCmd(active, cmd, sess) {
  const plan = active.payload;
  const until = +($('#abUntil')?.value || 0);
  const step = plan.steps[until - 1];
  const live = sess.devs.filter(x => x.ab && isFresh(x.ab.at));
  // Stopp geht an den Halter eines laufenden Laufs, sonst an das gewählte Gerät
  const holder = sess.devs.find(x => x.holds && ['laeuft', 'schlaeft', 'verloren'].includes(sess.run?.state));
  const tgt = cmd === 'stop' && holder ? holder : live.find(x => x.device === $('#abDev')?.value);
  if (!tgt) return toast('Kein Gerät erreichbar');
  const args = cmd === 'stop' ? {} : cmd === 'adopt' ? { plan: plan.id } : { mode: cmd, until, plan: plan.id };
  const login = tgt.ab?.state?.page === 'login';
  if (cmd === 'live' || cmd === 'dry') {
    if (!step) return toast(`„bis #“ zwischen 1 und ${plan.steps.length}`);
    if (!confirm(`${cmd === 'live' ? 'LIVE-Start' : 'Probelauf'} bis #${until} (${step[5]}) auf ${tgt.name}?`
      + (login ? `\n${tgt.name} ist ausgeloggt: Mit Auto-Login meldet es sich jetzt im Spiel an – ein anderer eingeloggter PC fliegt dabei raus.` : '')
      + (cmd === 'live' ? '\nDer Autobuilder baut danach selbständig im Spiel.' : ''))) return;
  } else if (!confirm(cmd === 'stop' ? `Autobuilder auf ${tgt.name} anhalten?` : `Plan ${plan.id} auf ${tgt.name} übernehmen? Danach „bis #“ neu wählen.`)) return;
  try {
    await Cloud.rest('commands', { method: 'POST', prefer: 'return=minimal',
      body: { account_id: S.acc, script: 'autobuilder', cmd: cmd === 'live' || cmd === 'dry' ? 'start' : cmd, args, plan_id: active.id, target_device: tgt.device } });
    toast(`Kommando an ${tgt.name} gesendet – Ergebnis in wenigen Sekunden`);
    setTimeout(() => route(true), 1500);
  } catch (e) { toast(e.message); }
}

async function viewPlans() {
  const acc = `eq.${S.acc}`;
  const [plans, heads, sess, cmds, W] = await Promise.all([
    Cloud.q('plans', { account_id: acc, order: 'created_at.desc', limit: 50,
      select: 'id,kind,source,status,title,note,plan_hash,created_at,approved_at,status_at' }),
    Cloud.q('plans', { account_id: acc, kind: 'eq.build', status: 'in.(freigegeben,aktiv)', order: 'approved_at.desc.nullslast', limit: 1,
      select: 'id,status,title,plan_hash' }),
    loadSessions(),
    Cloud.q('commands', { account_id: acc, script: 'eq.autobuilder', order: 'id.desc', limit: 8 }),
    loadWissen().catch(() => null),
  ]);
  // Plan-Inhalt (bis ca. 30 KB) nur einmal je Plan laden
  const head = heads[0];
  if (head && S.planCache?.id !== head.id) S.planCache = { id: head.id, payload: (await Cloud.q('plans', { id: `eq.${head.id}`, select: 'payload' }))[0]?.payload };
  const active = head ? { ...head, payload: S.planCache.payload } : null;
  const execs = active ? await Cloud.q('executions', { account_id: acc, plan_id: `eq.${active.id}`, select: 't,step,action,src_name', order: 't.asc', limit: 1000 }) : [];
  const own = isOwner();
  $('#view').innerHTML = abCard(active, sess, cmds, own, execs, W) + `<div class="card" style="margin-top:12px"><h2>Pläne</h2>
    <p class="muted small">Entwürfe kommen vom Optimierer oder von Claude. Ausgeführt wird nur, was du freigibst; die Skripte melden den Fortschritt.</p>
    ${plans.length ? plans.map(p => `<div class="list-item"><div class="row between">
      <span><span class="tag">${esc(KIND[p.kind] || p.kind)}</span> <b>${esc(p.title || '(ohne Titel)')}</b></span>
      <span class="tag ${esc(p.status)}">${esc(p.status)}</span></div>
      <div class="muted small">${esc(p.source)} · ${esc(dt(p.created_at))}${p.plan_hash ? ` · Plan-id ${esc(p.plan_hash)}` : ''}${p.approved_at ? ` · freigegeben ${esc(dt(p.approved_at))}` : ''}</div>
      ${p.note ? `<div class="small" style="white-space:pre-wrap">${esc(p.note)}</div>` : ''}
      ${own && p.status === 'entwurf' ? `<div class="row" style="margin-top:6px"><button class="primary" data-act="freigegeben" data-id="${esc(p.id)}">Freigeben</button>
        <button data-act="verworfen" data-id="${esc(p.id)}">Verwerfen</button></div>` : ''}
      ${own && ['freigegeben', 'aktiv'].includes(p.status) ? `<div class="row" style="margin-top:6px"><button class="danger" data-act="abgebrochen" data-id="${esc(p.id)}">Abbrechen</button></div>` : ''}
    </div>`).join('') : '<p class="muted">Noch keine Pläne. Ab P3 legt der Optimierer jeden neuen Bauplan hier als Entwurf ab.</p>'}</div>`;
  $('#view').querySelectorAll('button[data-act]').forEach(b => b.addEventListener('click', async () => {
    const act = b.dataset.act;
    const q = { freigegeben: 'Plan freigeben? Die Skripte dürfen ihn danach ausführen (Start nur per Kommando).',
      verworfen: 'Entwurf verwerfen?', abgebrochen: 'Plan abbrechen? Laufende Skripte halten an.' }[act];
    if (!confirm(q)) return;
    try { await Cloud.rpc('plan_status', { p_id: b.dataset.id, p_status: act }); toast('Gespeichert'); route(); }
    catch (e) { toast(e.message); }
  }));
  $('#view').querySelectorAll('button[data-cmd]').forEach(b => b.addEventListener('click', () => sendCmd(active, b.dataset.cmd, sess)));
  $('#allSteps')?.addEventListener('click', () => { S.allSteps = !S.allSteps; route(true); });
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

/* ---------- Wissen (Gebäude und Forschung, Datenbank Runde 7) ---------- */

async function loadWissen() {
  if (S.wissen) return S.wissen;
  let r = await fetch('data/horizon-data.json').catch(() => null);
  if (!r?.ok) r = await fetch('../analyse/horizon-data.json');  // lokale Vorschau aus dem Repo
  const d = await r.json();
  for (const o of Object.values(d.B)) o.L = Object.fromEntries(o.l.map(x => [x[0], x]));
  return (S.wissen = d);
}

async function viewWissen(rest) {
  const { B, R } = await loadWissen();
  const [sel = ''] = rest;
  const all = [...Object.entries(B).map(([id, o]) => ({ k: 'b', id, o })), ...Object.entries(R).map(([id, o]) => ({ k: 'r', id, o }))]
    .sort((a, b) => a.o.n.localeCompare(b.o.n, 'de'));
  const filt = sessionStorage.getItem('hz.wq') || '';
  $('#view').innerHTML = `<div class="wissen"><div class="card"><input class="search" id="wq" placeholder="Gebäude oder Forschung suchen" value="${esc(filt)}">
    <div class="wlist" id="wl"></div></div><div class="card" id="wd"><p class="muted">Eintrag wählen. Werte aus der Datenbank von Runde 7 (100 % Betriebsfaktor); live gilt vorrangig.</p></div></div>`;
  const list = q => {
    const t = q.trim().toLowerCase();
    $('#wl').innerHTML = all.filter(x => !t || x.o.n.toLowerCase().includes(t) || x.id.includes(t))
      .map(x => `<button data-k="${x.k}" data-id="${esc(x.id)}" class="${x.k + ':' + x.id === sel ? 'on' : ''}">${esc(x.o.n)} <span class="tag">${x.k === 'b' ? 'Gebäude' : 'Forschung'}</span></button>`).join('');
  };
  list(filt);
  $('#wq').oninput = e => { sessionStorage.setItem('hz.wq', e.target.value); list(e.target.value); };
  $('#wl').onclick = e => { const b = e.target.closest('button'); if (b) location.hash = `#/wissen/${b.dataset.k}:${b.dataset.id}`; };
  if (sel) showWissen(sel, B, R);
}

function showWissen(sel, B, R) {
  const [k, id] = sel.split(':');
  const o = (k === 'b' ? B : R)[id];
  if (!o) return;
  const name = (kk, i) => esc(((kk === 'b' ? B : R)[i] || {}).n || i);
  const req = o.q.map(([a, b, rs]) => `<tr><td class="num">${a === b ? a : `${a}–${b}`}</td><td>${rs.map(([kk, i, l]) => `${name(kk, i)} ${l}`).join(', ') || '–'}</td></tr>`).join('');
  let body = '';
  if (k === 'b') {
    body = `<div class="scroll"><table><tr><th class="num">Stufe</th><th>Name</th><th class="num">Erz</th><th class="num">Mineral</th><th class="num">Treibstoff</th><th class="num">Bauplatz</th><th>Bedarf</th><th>Wirkung</th></tr>${
      o.l.map(([l, n, c, u, w]) => `<tr><td class="num">${l}</td><td>${esc(n)}</td><td class="num">${fmt(c.Eisenerz)}</td><td class="num">${fmt(c.Mineral)}</td><td class="num">${fmt(c.Treibstoff)}</td><td class="num">${fmt(c.Bauplatz)}</td>
        <td class="small">${Object.entries(u || {}).map(([a, v]) => `${esc(a)} ${fmt(v)}`).join(' · ')}</td><td class="small">${Object.entries(w || {}).map(([a, v]) => `${esc(a)} ${fmt(v, 1)}`).join(' · ')}</td></tr>`).join('')}</table></div>`;
  } else {
    const m = o.c === 'Allianzforschung' ? 2.5 : 1.5;
    const rows = Array.from({ length: Math.min(o.f || 20, 30) }, (_, i) => i + 1)
      .map(l => `<tr><td class="num">${l}</td>${(o.k || [0, 0, 0]).map(x => `<td class="num">${fmt(Math.floor(x * Math.pow(m, l - 1)))}</td>`).join('')}</tr>`).join('');
    body = `${o.w ? `<p>${esc(o.w)}</p>` : ''}<div class="scroll"><table><tr><th class="num">Stufe</th><th class="num">Erz</th><th class="num">Mineral</th><th class="num">Treibstoff</th></tr>${rows}</table></div>
      <p class="muted small">Kosten ohne Spieler-Rabatt.</p>`;
  }
  $('#wd').innerHTML = `<h2>${esc(o.n)} <span class="muted small">${esc(o.c || '')} · max. ${esc(o.f ?? '–')}</span></h2>
    <h3>Voraussetzungen</h3><table><tr><th class="num">für Stufe</th><th>benötigt</th></tr>${req || '<tr><td colspan="2">–</td></tr>'}</table>
    <h3>${k === 'b' ? 'Stufen' : 'Kosten'}</h3>${body}`;
}

/* ---------- Mehr: Geräte & Rechte, Gruppe, Abmelden ---------- */

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
      ${members.length ? `<table><tr><th>Gerät</th><th>zuletzt</th><th>Recht</th></tr>${members.map(m => `<tr><td>${esc(m.name || '(ohne Namen)')}${m.id === info.me ? ' <span class="muted small">(dieses)</span>' : ''}${m.role === 'admin' ? ' <span class="tag">Admin</span>' : ''}</td>
        <td class="small muted">${esc(ago(m.last_seen))}</td><td>${roleSel(m)}</td></tr>`).join('')}</table>`
        : '<p class="muted">Mitgliederliste nur für Admins und Owner.</p>'}
      <p class="muted small">Neue Geräte melden sich mit dem Gruppen-Code an und erscheinen hier. Skript = Tampermonkey (Collector, Autobuilder);
        Claude = Wächter (nur Entwürfe und Antworten, nie Freigaben).</p></div>
    <div class="card"><h2>Gruppe</h2><p>${esc(info.group)} · dieses Gerät: <b>${esc(a?.name)}</b>${info.role === 'admin' ? ' (Admin)' : ''}</p>
      <form id="fName" class="row"><input name="name" value="${esc(a?.name)}" style="flex:1"><button>Umbenennen</button></form>
      ${info.role === 'admin' ? '<p><button id="newCode" class="danger">Neuen Gruppen-Code erzeugen</button></p><p class="muted small">Alle anderen Geräte müssen sich danach neu anmelden (auch Skripte und Claude).</p>' : ''}
      <p><button id="logout">Abmelden</button></p></div>
    <div class="card"><h2>Über</h2><p class="small">Version ${esc(window.APP_VERSION?.number)} · ${esc(window.APP_VERSION?.built)}</p>
      <p class="small muted">Gerätekennung ${esc(Cloud.device.slice(0, 8))}…</p>
      <p class="small">Ansicht: <b>${isStandalone() ? 'als App (ohne Browserleiste)' : 'im Browser'}</b></p>
      ${!isStandalone() ? `<p><button id="install"${installPrompt ? '' : ' disabled'}>Als App installieren</button></p>
        <p class="muted small" id="installHint">${installPrompt ? 'Chrome bietet die Installation an.'
          : 'Chrome bietet gerade keine Installation an (Seite neu laden; sonst Chrome-Menü ⋮ → „App installieren“, auf dem iPhone Safari → Teilen → „Zum Home-Bildschirm“).'}</p>` : ''}
      <p class="small muted">Plan und Stand: doku/stand/cockpit.md im Horizon-Repo.</p></div></div>`;
  $('#view').querySelectorAll('select[data-member]').forEach(s => s.addEventListener('change', async () => {
    try { await Cloud.rpc('account_grant', { p_account: S.acc, p_member: s.dataset.member, p_role: s.value }); toast('Recht gespeichert'); }
    catch (e) { toast(e.message); route(); }
  }));
  $('#fName').addEventListener('submit', async e => {
    e.preventDefault();
    const n = e.target.name.value.trim();
    if (!n) return;
    try { await Cloud.login(Cloud.access().code, n); toast('Gespeichert'); renderAccSelect(); route(); }  // touch setzt den Namen
    catch (err) { toast(err.message); }
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
