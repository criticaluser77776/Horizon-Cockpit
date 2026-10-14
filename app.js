'use strict';
/* Horizon-Cockpit – Gerüst (P1): Anmeldung, Account, Lage, Ereignisse, Pläne (Liste + Freigabe), Kompendium (kompendium.js), Geräte & Rechte.
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
function toast(msg, action) {     // action = { label, run } → Knopf im Toast (z. B. Rückgängig), dann 6 s sichtbar
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  if (action) {
    const b = document.createElement('button'); b.className = 'link'; b.textContent = action.label;
    b.onclick = () => { t.hidden = true; action.run(); }; t.append(' ', b);
  }
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, action ? 6000 : 3500);
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

const VIEWS = { lage: viewLage, ereignisse: viewEvents, plaene: viewPlans, claude: viewClaude, wissen: viewKompendium, mehr: viewMore };

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
  if (document.visibilityState !== 'visible' || !['lage', 'plaene'].includes(tab) || /^#\/plaene\/edit\//.test(location.hash)) return;
  if (document.activeElement?.matches?.('input,select,textarea')) return;
  route(true);
}, 30000);

async function updateBadge() {
  try {
    const r = await Cloud.q('events', { select: 'id', account_id: `eq.${S.acc}`, level: 'eq.hoch', seen_at: 'is.null', dismissed_at: 'is.null', limit: 99 });
    $('#evBadge').hidden = !r.length; $('#evBadge').textContent = r.length;
  } catch { /* egal */ }
}

/* ---------- Lage ---------- */

const RES = ['Eisenerz', 'Mineral', 'Treibstoff'];

async function viewLage() {
  const acc = `eq.${S.acc}`;
  const [heads, sess, evs, feats, nf, effs] = await Promise.all([
    Cloud.q('state_latest', { account_id: acc, kind: 'eq.live', select: 'kind,collected_at,version' }),
    loadSessions(),
    Cloud.q('events', { account_id: acc, dismissed_at: 'is.null', order: 't.desc', limit: 6 }),
    Cloud.q('features', { account_id: acc, order: 'key' }),
    loadNotfall(),
    Cloud.q('events', { account_id: acc, kind: 'eq.bericht', 'data->effect->>until': `gt.${new Date().toISOString()}`,
      select: 'id,t,eff:data->effect', order: 't.desc', limit: 20 }).catch(() => []),
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
  // B10 (Nutzer 13.10.2026): oben nur das Nötigste – Überblick, Steuerung, Banner, Ereignisse; Details eingeklappt
  const W = await loadWissen().catch(() => null);  // Namen für noch nicht gebaute Stufen
  const nm = (i, set) => i.name || W?.[set]?.[i.type]?.n || i.type;
  let html = overviewCard(sess, d, live, abLive, nm) + notfallCard(sess, nf, d) + bannerCard(sess) + effectsCard(effs);
  html += `<div class="card"><div class="row between"><h2>Ereignisse</h2><a href="#/ereignisse" class="small">alle</a></div>${evs.length ? evs.slice(0, 4).map(evRow).join('') : '<p class="muted">Keine.</p>'}</div>`;
  if (d) {
    const lv = (items, set) => items.map(i => `<tr><td>${esc(nm(i, set))}</td><td class="num">${esc(i.levelDone ?? i.level)}${i.inProgress ? ` → ${esc(i.level)}` : ''}</td></tr>`).join('');
    const st = d.start || {};
    html += `<details class="card"><summary><b>Details</b> <span class="muted small">${esc(st.planet || '')} ${esc(st.coords || '')} · Rang ${esc(st.rank ?? '–')} · ${fmt(st.points)} Punkte · Gebäude, Forschung, Funktionen</span></summary>
      <div class="grid" style="margin-top:8px"><div><h3>Gebäude</h3><table>${lv(d.buildings?.items || [], 'B')}</table>
      ${d.buildings?.space ? `<p class="muted small">Bauplatz frei ${fmt(d.buildings.space.free)} von ${fmt(d.buildings.space.total)}</p>` : ''}</div>
      <div><h3>Forschung</h3><table>${lv(d.research?.items || [], 'R') || '<tr><td class="muted">–</td></tr>'}</table></div>
      <div><h3>Funktionen</h3>${feats.length ? `<table>${feats.map(f => `<tr><td>${esc(f.label || f.key)}${f.unlocked_at ? '' : ' <span class="muted small">(gesperrt)</span>'}</td>
        <td title="${esc(STAGES[f.stage])}"><span class="stage">${STAGES.map((_, i) => `<i class="${i <= f.stage ? 'on' : ''}"></i>`).join('')}</span></td></tr>`).join('')}</table>` : '<p class="muted small">Noch keine erfasst.</p>'}</div></div></details>`;
  }
  $('#view').innerHTML = html;
  $('#bannerGo')?.addEventListener('click', () => sendBanner(sess));
  bindNotfall(sess, nf);
  swipeEvents($('#view'));
}

/* ---------- Überblick (B10): Lauf, Rohstoffe, Arbeiter/Energie, laufende Aufträge in wenigen Zeilen ---------- */
function overviewCard(sess, d, live, abLive, nm) {
  const r = sess.run, h = r && sess.devs.find(x => x.holds), s = h?.ab?.state || {};
  const runTxt = !r ? 'kein Lauf'
    : `<b class="${r.state === 'verloren' ? 'err' : ''}">${esc(RUNST[r.state] || r.state)}</b> bis #${esc(r.until ?? '–')} · ${esc(r.name || '?')}`
      + (r.state === 'schlaeft' && r.wake_at ? ` · Login ${esc(clockT(r.wake_at))}` : '')
      + (['laeuft', 'schlaeft'].includes(r.state) && s.ahead != null ? ` · Vorlauf ${esc(fmt(s.ahead, 1))} h` : '');
  let html = `<div class="card${r?.state === 'verloren' || !d ? ' warn' : ''}"><div class="row between"><h2>Überblick</h2>
    <span class="muted small">${live ? `Stand ${esc(ago(live.collected_at))}` : 'noch kein Live-Stand'}</span></div><p>${runTxt}</p>`;
  if (r && ['angehalten', 'verloren'].includes(r.state) && r.reason) html += `<p class="small muted">${esc(r.reason)}</p>`;
  if (d) {
    const prod = d.prod || {}, at = new Date(live.collected_at), hrs = (Date.now() - at) / 3600e3;
    const stock = prod['Aktueller Lagerbestand'] || {}, rate = prod['Förderung'] || {}, use = prod['Verbrauch'] || {}, cap = prod['Maximal stabile Menge'] || {};
    html += `<table class="small">${RES.map(x => {
      const net = (rate[x] || 0) - (use[x] || 0), now = Math.min((stock[x] || 0) + net * hrs, cap[x] || Infinity);
      const full = net > 0 && cap[x] ? (cap[x] - now) / net * 3600 : null;
      return `<tr><td>${x}</td><td class="num">${fmt(now)}</td><td class="num muted">${net >= 0 ? '+' : ''}${fmt(net)}/h</td><td class="num muted">${full == null ? '' : 'voll in ' + dur(full)}</td></tr>`;
    }).join('')}</table>`;
    const avail = prod['Aktuelle Verfügbarkeit'] || {}, need = prod['Benötigte Kapazitäten'] || {};
    html += `<div class="row small" style="margin:4px 0">${['Arbeiter', 'Energie'].map(k => {
      const ratio = need[k] ? Math.min(1, (avail[k] || 0) / need[k]) : 1;
      return `<span class="${ratio < 1 ? 'err' : 'muted'}">${k} ${ratio < 1 ? fmt(Math.floor(ratio * 1000) / 10, 1) : 100} %</span>`;
    }).join(' · ')}</div>`;
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

/* ---------- Notfallzentrale (Paket F3, 13.10.2026) ----------
   Immer sichtbar, auch ohne freigegebenen Plan (vorher gab es dann keinen Stopp-Knopf). Kommandos gehen an ein Gerät;
   antwortet dort der Autobuilder nicht, führt der Collector (ab 0.4.3) „Neu laden“, „Lage jetzt lesen“ und „Stopp“ selbst
   aus. „Faktoren sichern“ und „Faktor von Hand“ braucht den Autobuilder (ab 0.5.9). Nur der Owner sieht die Knöpfe. */
const NF_CMDS = ['stop', 'reload', 'snapshot', 'factors', 'factor'];
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
      plan = `nutzt Plan ${s.plan}${k ? ` (Cockpit: ${k.status})` : ' (im Cockpit unbekannt)'} ≠ aktiv ${act ? act.plan_hash : '–'}`;
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
  if (own) {
    html += `<div class="row" style="margin:8px 0;gap:6px"><button class="danger" id="nfStopAll" title="Stopp an alle Geräte">Alles anhalten</button></div>`;
    if (reach.length) {
      html += `<div class="row" style="margin:8px 0;gap:6px"><select id="nfDev" title="Gerät für die Knöpfe daneben">${reach.map(x => `<option value="${esc(x.device)}"${x === sel ? ' selected' : ''}>${x.holds ? '★ ' : ''}${esc(x.name)}</option>`).join('')}</select>
        <button data-nf="snapshot" title="Live-Stand sofort erfassen und hochladen">Lage lesen</button>
        <button data-nf="reload" title="Spiel-Tab neu laden (ein laufender Lauf geht danach weiter)">Neu laden</button>
        <button data-nf="factors" title="Faktor-Regel einmal anwenden (Minen und Lieferanten laufender Aufträge zuerst), ohne Lauf">Faktoren sichern</button></div>`;
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
async function postCmd(dev, cmd, args = {}, planId = null) {
  await Cloud.rest('commands', { method: 'POST', prefer: 'return=minimal',
    body: { account_id: S.acc, script: 'autobuilder', cmd, args, plan_id: planId, target_device: dev.device } });
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

/* ---------- Werbebanner (Autobuilder ab 0.5.1) ----------
   Der Autobuilder meldet aktive Banner im Lebenszeichen; aufgerufen werden sie nur per Kommando „banner“ nach Tippen des Owners. */
const bannerDev = sess => sess.devs.find(x => x.ab && isFresh(x.ab.at) && x.ab.state?.page === 'game' && x.ab.state?.banner?.n);
function bannerCard(sess) {
  const x = bannerDev(sess), b = x?.ab.state.banner;
  if (!b) {
    const due = Math.max(0, ...sess.devs.filter(d => d.ab && isFresh(d.ab.at, 24 * 60)).map(d => +d.ab.state?.bannerDue || 0));
    return due ? `<div class="card"><div class="row between"><h2>Werbebanner</h2><span class="muted small">keine offen</span></div>
      <p class="small">Nächste erwartet ${due < Date.now() ? 'seit' : 'ab'} <b>${esc(dt(due))}</b> (${due > Date.now() ? `in ${esc(dur((due - Date.now()) / 1000))}` : esc(ago(due))}).</p></div>` : '';
  }
  return `<div class="card"><div class="row between"><h2>Werbebanner</h2><span class="muted small">seit ${esc(dt(b.since))}</span></div>
    <p>${esc(b.n)} von 3 Votes offen auf <b>${esc(x.name)}</b></p><div class="small">${(b.slots || []).map(s => `Vote ${esc(s.slot)}: ${esc(s.host || 'Ziel unbekannt')}
    <span class="muted">${esc(s.url || s.href || s.src || '')}</span>`).join('<br>')}</div>
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
  const can = ['owner', 'viewer'].includes(account()?.role);
  return `<div class="list-item ev${e.seen_at ? '' : ' unseen'}${e.dismissed_at ? ' dismissed' : ''}" data-id="${esc(e.id)}"><div class="row between">
    <span><span class="tag ${esc(e.level)}">${esc(e.level)}</span> <span class="tag">${esc(CAT[e.cat] || e.cat || '')}</span> ${esc(e.kind)}${e.dismissed_at ? ' <span class="tag">ausgeblendet</span>' : ''}</span>
    <span class="muted small">${esc(dt(e.t))}${can ? ` <button class="link small evx" title="${e.dismissed_at ? 'wieder einblenden' : 'ausblenden (oder nach rechts wischen)'}">${e.dismissed_at ? '↺' : '✕'}</button>` : ''}</span></div>
    <div>${esc(e.text)}</div>${bannerSlots(e)}${msgBody(e)}${e.kind === 'abweichung' && e.data?.offer === 'neu_planen' ? '<div class="small"><a href="#/plaene">Planabweichung ansehen / neu planen →</a></div>' : ''}<div class="muted small">${esc(e.src_name || e.origin)}</div></div>`;
}
/* Nachrichten (B1, Autobuilder ab 0.5.13): Inhalt, Links und Effekt stehen in data des Ereignisses „bericht“.
   Links nur als Text – das Cockpit macht daraus keine klickbaren Verweise (Spiel-Links tragen Einmal-Token, fremde Ziele
   ruft niemand automatisch auf). */
const EFF_SRC = { datum: 'Ende laut Nachricht', text: 'Dauer laut Nachricht', typisch: 'typische Dauer (geschätzt)' };
function msgBody(e) {
  const x = e.kind === 'bericht' ? e.data : null;
  if (!x?.body && !x?.effect) return '';
  const eff = x.effect?.until ? `<div class="small">Effekt bis <b>${esc(dt(x.effect.until))}</b>${Date.parse(x.effect.until) > Date.now()
    ? ` (noch ${esc(dur((Date.parse(x.effect.until) - Date.now()) / 1000))})` : ' (abgelaufen)'} <span class="muted">· ${esc(EFF_SRC[x.effect.src] || x.effect.src || '')}</span></div>` : '';
  const links = Array.isArray(x.links) && x.links.length ? `<div class="small muted">Links (nur Text, nicht aufrufen): ${x.links.map(l =>
    `${esc(l.text || 'ohne Text')} <code>${esc(l.href)}</code>`).join(' · ')}</div>` : '';
  return eff + (x.body ? `<details class="msg"><summary class="small">Inhalt</summary><div class="msgbody small">${esc(x.body)}</div>${links}</details>` : '');
}
// Lage: aktive Effekte aus Berichten (Ende in der Zukunft), je Name nur der jüngste
function effectsCard(effs) {
  const seen = new Set(), list = (effs || []).filter(r => r.eff?.until && !seen.has(r.eff.name) && seen.add(r.eff.name))
    .sort((a, b) => Date.parse(a.eff.until) - Date.parse(b.eff.until));
  if (!list.length) return '';
  return `<div class="card"><div class="row between"><h2>Aktive Effekte</h2><span class="muted small">aus Berichten</span></div><table class="small">${list.map(r => `<tr>
    <td>${esc(r.eff.name)}</td><td class="num">noch ${esc(dur((Date.parse(r.eff.until) - Date.now()) / 1000))}</td>
    <td class="muted">bis ${esc(dt(r.eff.until))}${r.eff.src === 'typisch' ? ' (geschätzt)' : ''}</td></tr>`).join('')}</table></div>`;
}
// Werbebanner (Autobuilder ab 0.5.1): Ziele nur als Text zeigen; ob und wie sie geöffnet werden, ist noch offen
function bannerSlots(e) {
  const s = e.kind === 'banner' && Array.isArray(e.data?.slots) ? e.data.slots : [];
  return s.length ? `<div class="small">${s.map(x => `${x.url !== undefined ? 'Vote' : 'Monitor'} ${esc(x.slot)}: ${esc(x.host || (x.href ? 'intern' : 'ohne Link'))}
    <span class="muted">${esc(x.url || x.href || x.onclick || x.src || '')}</span>`).join('<br>')}</div>` : '';
}
// Ereignis ausblenden: nach rechts wischen (Handy) oder ✕ (Rechner); Rückgängig im Toast. Nur Owner/Lesen (wie „gesehen“).
async function setDismissed(id, on) {
  await Cloud.rest(`events?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: { dismissed_at: on ? new Date().toISOString() : null }, prefer: 'return=minimal' });
}
async function dismissEvent(el) {
  const id = el.dataset.id, undo = el.classList.contains('dismissed');
  try {
    await setDismissed(id, !undo);
    if (undo) { route(true); return toast('Wieder eingeblendet'); }
    el.style.transition = 'opacity .2s'; el.style.opacity = '0';
    setTimeout(() => (S.showDismissed ? route(true) : el.remove()), 200);
    toast('Ausgeblendet', { label: 'Rückgängig', run: async () => { try { await setDismissed(id, false); route(true); } catch (e) { toast(e.message); } } });
  } catch (e) { el.style.transform = ''; toast(e.message); }
}
function swipeEvents(root) {
  if (!['owner', 'viewer'].includes(account()?.role)) return;
  root.querySelectorAll('.ev .evx').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); dismissEvent(b.closest('.ev')); }));
  root.querySelectorAll('.ev:not(.dismissed)').forEach(el => {
    let x0 = null, y0 = 0, dx = 0;
    el.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = 0; el.style.transition = ''; }, { passive: true });
    el.addEventListener('touchmove', e => {
      if (x0 == null) return;
      dx = e.touches[0].clientX - x0;
      if (Math.abs(e.touches[0].clientY - y0) > Math.abs(dx)) { x0 = null; el.style.transform = ''; return; }   // senkrecht = scrollen
      if (dx > 0) el.style.transform = `translateX(${dx}px)`;
    }, { passive: true });
    el.addEventListener('touchend', () => {
      if (x0 == null) return;
      x0 = null; el.style.transition = 'transform .15s';
      if (dx > Math.min(120, el.offsetWidth * 0.35)) { el.style.transform = 'translateX(100%)'; dismissEvent(el); }
      else el.style.transform = '';
    });
  });
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
/* ---------- Ereignisse ---------- */

async function viewEvents() {
  const lvl = sessionStorage.getItem('hz.evlvl') || '', cat = sessionStorage.getItem('hz.evcat') || '';
  const p = { account_id: `eq.${S.acc}`, order: 't.desc', limit: 200 };
  if (lvl) p.level = `eq.${lvl}`;
  if (cat) p.cat = `eq.${cat}`;
  S.showDismissed = sessionStorage.getItem('hz.evdis') === '1';
  if (!S.showDismissed) p.dismissed_at = 'is.null';
  const evs = await Cloud.q('events', p);
  const canSee = ['owner', 'viewer'].includes(account()?.role);
  $('#view').innerHTML = `<div class="card"><div class="row between"><h2>Ereignisse</h2>
    <div class="row"><select id="cat"><option value="">alle Bereiche</option>${Object.entries(CAT).map(([k, t]) => `<option value="${k}"${k === cat ? ' selected' : ''}>${t}</option>`).join('')}</select>
    <select id="lvl"><option value="">alle Stufen</option>${['hoch', 'mittel', 'niedrig'].map(l => `<option${l === lvl ? ' selected' : ''}>${l}</option>`).join('')}</select>
    ${canSee ? '<button id="seenAll">alle gesehen</button>' : ''}</div></div>
    <label class="small"><input type="checkbox" id="evDis"${S.showDismissed ? ' checked' : ''}> ausgeblendete zeigen</label>
    ${canSee ? '<span class="muted small"> · nach rechts wischen oder ✕ = ausblenden</span>' : ''}
    <p class="muted small">Builder = Autobuilder und Sitzungen · Cockpit = Freigaben und Kommandos · Spiel = Berichte und Nachrichten · System = Supabase-Wächter</p>
    ${evs.length ? evs.map(evRow).join('') : '<p class="muted">Keine Ereignisse.</p>'}</div>`;
  $('#lvl').onchange = e => { sessionStorage.setItem('hz.evlvl', e.target.value); route(); };
  $('#cat').onchange = e => { sessionStorage.setItem('hz.evcat', e.target.value); route(); };
  $('#evDis').onchange = e => { sessionStorage.setItem('hz.evdis', e.target.checked ? '1' : ''); route(); };
  swipeEvents($('#view'));
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
// Planeten des Plans: plan.planet (ab 12.10. von build_autobuilder.js), weitere über plan.stepPlanet {Schritt: Koordinaten}
// und plan.planets [{name, coords}]; ältere Pläne ohne Angabe: Heimatplanet aus dem Live-Stand
function planPlanets(plan, home) {
  const list = [plan.planet || home, ...(plan.planets || [])].filter(p => p?.coords);   // Heimat zuerst
  for (const c of Object.values(plan.stepPlanet || {})) if (!list.some(p => p.coords === c)) list.push({ name: '', coords: c });
  return list.filter((p, i) => list.findIndex(q => q.coords === p.coords) === i);
}
const stepPlanet = (plan, n, def) => plan.stepPlanet?.[n] || def;
function stepsTable(plan, st, execs, all, W, planet) {
  const t0 = Date.parse(plan.startTime);
  const open = (st.open || []).filter(Number.isInteger);
  const first = open.length ? Math.min(...open) : null;
  const until = st.until || plan.steps.length;
  const done = new Map(execs.filter(e => e.step).map(e => [e.step, e]));
  const isDone = n => done.has(n) || (first != null && n < first);
  const nameOf = k => W?.B?.[k]?.n || k;
  const rows = [];
  const def = (plan.planet || S.home)?.coords;
  plan.steps.forEach((s, i) => { if (s[0] !== 's' && (!planet || stepPlanet(plan, i + 1, def) === planet)) rows.push({ tau: s[3], n: i + 1, s }); });
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
    return `<tr class="step${isDone(r.n) ? ' muted' : ''}" data-i="${r.n}"><td class="num">${mark} #${r.n}</td><td>${esc(r.s[5])}${r.s[0] === 'r' ? ' <span class="tag">global</span>' : ''}${e ? `<div class="small">gestartet ${esc(dt(e.t))} · ${esc(e.src_name)}</div>` : ''}</td>
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
  if (!active) return html + '<p class="muted">Kein freigegebener Bauplan. Erst einen Entwurf freigeben. Anhalten, Neu laden und Faktoren gehen jederzeit unter <a href="#/lage">Lage → Notfallzentrale</a>.</p>' + `<div id="abCmds">${cmdTable(cmds)}</div></div>`;
  html += `<p class="small">Freigegeben: <b>${esc(active.title)}</b> (Plan-id ${esc(plan?.id)}, ${esc(active.status)})</p>`;
  if (!live.length) html += '<p class="err small">Kein Autobuilder erreichbar (Browser zu oder Skripte aus).</p>';
  else {
    html += `<div class="row" style="margin:8px 0">Gerät <select id="abDev">${live.map(x => `<option value="${esc(x.device)}"${x === target ? ' selected' : ''}>${x.holds ? '★ ' : ''}${esc(x.name)} – ${x.ab.state.page === 'login' ? 'ausgeloggt' : 'eingeloggt'}</option>`).join('')}</select></div>`;
    if (st.plan !== plan?.id) {
      html += st.offered === plan?.id
        ? `<p class="warn small">${esc(target.name)} hat den freigegebenen Plan angeboten bekommen, arbeitet aber noch mit ${esc(st.plan)}.</p>
           ${own ? `<button class="primary" data-cmd="adopt"${st.running ? ' disabled title="erst stoppen"' : ''}>Plan auf ${esc(target.name)} übernehmen</button>` : ''}`
        : '<p class="muted small">Der Collector bietet den Plan beim nächsten Abgleich an (bis 1 min).</p>';
    } else if (own) {
      html += `<div class="row" style="margin:8px 0">bis # <input id="abUntil" type="number" min="1" max="${plan.steps.length}" value="${esc(S.abSel?.until || st.until || run?.until || 10)}" style="width:5em">
        <button data-cmd="dry">Probelauf</button> <button class="primary" data-cmd="live">Start</button> <button class="danger" data-cmd="stop">Stopp</button></div>
        <div class="muted small" id="abStep"></div>`;
    }
  }
  if (plan) {
    const hst = (holder?.ab?.state?.plan === plan.id ? holder.ab.state : null) || (st.plan === plan.id ? st : {});
    const pls = planPlanets(plan, S.home);
    const cur = pls.find(p => p.coords === S.planet) || pls[0] || null;
    const plName = p => `${p.name || 'Planet'} (${p.coords})`;
    html += `<div class="row between" style="margin-top:10px"><h3 style="margin:0">Planschritte ${S.allSteps ? `(alle ${plan.steps.length})` : `(offen bis #${esc(hst.until || '–')})`}</h3>
      <button class="link small" id="allSteps">${S.allSteps ? 'nur offene' : 'alle mit Historie'}</button></div>
      ${pls.length > 1 ? `<div class="row small" style="margin:4px 0">Planet <select id="plSel">${pls.map(p => `<option value="${esc(p.coords)}"${p === cur ? ' selected' : ''}>${esc(plName(p))}</option>`).join('')}</select></div>`
        : cur ? `<div class="small muted" style="margin:4px 0">Planet ${esc(plName(cur))} · Forschung gilt für alle Planeten („global“)</div>` : ''}
      ${stepsTable(plan, hst, execs, S.allSteps, W, cur?.coords)}`;
  }
  return html + `<div id="abCmds">${cmdTable(cmds)}</div></div>`;
}

const cmdTable = cmds => !cmds.length ? '' : `<h3>Letzte Kommandos</h3><table class="small">${cmds.map(c => `<tr><td>${esc(dt(c.created_at))}</td>
    <td>${esc(c.cmd)}${c.args?.mode ? ' ' + esc(c.args.mode) : ''}${c.args?.until ? ' bis #' + esc(c.args.until) : ''}${c.cmd === 'factor' ? ` ${esc(c.args?.type)} ${esc(c.args?.to)} %` : ''}${c.target_name ? ` → ${esc(c.target_name)}` : ''}</td>
    <td><span class="tag">${esc(c.status)}</span></td><td class="muted">${esc(c.result)}${c.taken_name && c.taken_name !== c.target_name ? ` · ${esc(c.taken_name)}` : ''}</td></tr>`).join('')}</table>`;

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

// „Neuer Plan verfügbar – starten?“: neuester Bauplan-Entwurf, der mit Claude im Chat abgestimmt ist (payload.agreed,
// push_plan.py --abgestimmt) oder früher fertig wird als der aktive Plan (Planstart + hours; ältere Pläne: Stunden aus created)
const planEnd = p => {
  const h = +p?.hours || +(String(p?.created || '').match(/([\d.]+) h$/) || [])[1];
  return p?.startTime && h ? Date.parse(p.startTime) + h * 3600e3 : null;
};
async function newPlanOffer(plans, active) {
  const draft = plans.find(p => p.kind === 'build' && p.status === 'entwurf');
  if (!draft) return null;
  const d = (await Cloud.q('plans', { id: `eq.${draft.id}`, select: 'startTime:payload->>startTime,hours:payload->>hours,created:payload->>created,agreed:payload->>agreed' }))[0] || {};
  const end = planEnd(d), activeEnd = planEnd(active?.payload);
  const gain = end && activeEnd ? (activeEnd - end) / 3600e3 : null;
  const agreed = d.agreed === 'true';
  if (!agreed && !(gain > 0.5) && active) return null;
  return { draft, end, gain, agreed };
}
function newPlanCard(o, own) {
  if (!o) return '';
  const why = [o.agreed ? 'mit Claude im Chat abgestimmt' : '', o.gain > 0.5 ? `SCOL ${fmt(o.gain, 1)} h früher` : o.gain != null && o.gain < -0.5 ? `SCOL ${fmt(-o.gain, 1)} h später` : '']
    .filter(Boolean).join(' · ');
  return `<div class="card warn"><div class="row between"><h2>Neuer Plan verfügbar – starten?</h2><span class="muted small">${esc(dt(o.draft.created_at))}</span></div>
    <p><b>${esc(o.draft.title || '')}</b>${o.end ? ` · SCOL ca. ${esc(dt(o.end))}` : ''}</p>${why ? `<p class="small">${esc(why)}</p>` : ''}
    ${o.draft.note ? `<div class="small muted" style="white-space:pre-wrap">${esc(o.draft.note)}</div>` : ''}
    ${own ? `<div class="row" style="margin-top:6px"><button class="primary" id="npGo">Freigeben</button><button id="npNo">Verwerfen</button></div>
      <p class="muted small">Gestartet wird danach wie gewohnt unter Autobuilder („bis #“ neu wählen, neue Schrittnummern).</p>` : ''}</div>`;
}
async function takeNewPlan(o, sess) {
  if (!confirm(`Plan „${o.draft.title}“ freigeben? Der bisher freigegebene Bauplan wird damit abgelöst.`)) return;
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
    <p class="muted small">Optimierer-Lauf in GitHub Actions ab dem neuesten Snapshot (täglich 05:17 und auf Knopfdruck); das Ergebnis erscheint hier als Entwurf.</p>
    ${req ? `<div class="small">Zuletzt ${esc(dt(req.created_at))}${req.answer ? `: ${esc(req.answer)}` : ''}</div>` : ''}
    ${own ? `<div class="row" style="margin-top:6px"><button id="optGo"${busy ? ' disabled' : ''}>${busy ? 'Lauf angefordert …' : 'Neuen Plan vorschlagen'}</button></div>` : ''}</div>`;
}
async function askPlan() {
  if (!confirm('Optimierer-Lauf in GitHub Actions starten? Dauer etwa 30–90 min, das Ergebnis kommt als Entwurf (Freigabe weiter nur durch dich).')) return;
  try {
    const r = await Cloud.rpc('plan_vorschlagen', { p_account: S.acc });
    toast(r.ok ? 'Lauf angefordert – Ergebnis als Entwurf unter Pläne' : r.text);
    setTimeout(() => route(true), 1000);
  } catch (e) { toast(e.message); }
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
    days.push(`<line x1="${X(t).toFixed(1)}" x2="${X(t).toFixed(1)}" y1="${T}" y2="${H - B}" class="g"/><text x="${(X(t) + 3).toFixed(1)}" y="${H - 6}">${new Date(t).toLocaleDateString('de-DE', { weekday: 'short' })}</text>`);
  return `<svg class="drift" viewBox="0 0 ${W} ${H}" role="img" aria-label="Rückstand gegen den Plan über die Zeit">
    ${days.join('')}<line x1="${L}" x2="${W - R}" y1="${Y(0).toFixed(1)}" y2="${Y(0).toFixed(1)}" class="z"/>
    <line x1="${L}" x2="${W - R}" y1="${Y(d.limit).toFixed(1)}" y2="${Y(d.limit).toFixed(1)}" class="lim"/>${tick(0)}${tick(d.limit)}
    <path d="${line}" class="ln"/>${pts.map((p, i) => `<circle cx="${X(p[0]).toFixed(1)}" cy="${Y(p[1]).toFixed(1)}" r="${i === pts.length - 1 && d.lag != null ? 4 : 2.5}" class="${p[1] >= d.limit ? 'bad' : 'pt'}"/>`).join('')}</svg>`;
}
function driftCard(d, own) {
  if (!d) return '';
  const head = `<div class="row between"><h2>Planabweichung</h2><span class="muted small">Plan-id ${esc(d.hash)}</span></div>`;
  if (d.lag == null) return `<div class="card">${head}<p class="small">Noch kein Schritt dieses Plans gestartet. Der Plan rechnet ab seinem Snapshot (${esc(dt(d.start))});
    der Verzug bis zum ersten Start zählt nicht als Rückstand.</p></div>`;
  const cls = d.lag >= d.limit ? 'err' : d.lag >= 1 ? 'warn' : 'ok';
  const end = d.hours ? Date.parse(d.start) + (+d.hours + (+d.offset || 0)) * 3600e3 : null;
  return `<div class="card">${head}<p class="${cls}"><b>${esc(lagText(d.lag))}</b></p>
    <div class="small">${d.last ? `Zuletzt #${esc(d.last.n)} ${esc(d.last.text)} gestartet ${esc(dt(d.last.t))} (${esc(lagText(d.last.lag))})` : ''}
    ${d.due?.lag > 0 ? `<br>Überfällig: #${esc(d.due.n)} ${esc(d.due.text)} sollte ${esc(dt(d.due.at))} starten` : ''}
    ${d.offset > 0.05 ? `<br><span class="muted">Startverzug ${esc(hrs(d.offset))} (Plan ab Snapshot ${esc(dt(d.start))}) ist abgezogen.</span>` : ''}
    ${end ? `<br>Planende ${d.lag > 0.05 ? `etwa <b>${esc(dt(end + d.lag * 3600e3))}</b> statt ${esc(dt(end))}` : esc(dt(end))}` : ''}</div>
    ${driftSvg(d)}<p class="muted small">Kurve: Rückstand je gestartetem Schritt (über 0 = hinter dem Plan), gestrichelt die Meldegrenze ${esc(d.limit)} h.
      Ab da meldet Supabase „mittel“, je weitere ${esc(d.limit)} h erneut.</p>
    ${own && d.lag >= d.limit ? '<div class="row" style="margin-top:6px"><button class="primary" id="driftGo">Neu planen (Neuen Plan vorschlagen)</button></div>' : ''}</div>`;
}

async function viewPlans(rest = []) {
  if (rest[0] === 'edit' && rest[1]) return viewPlanEdit(rest[1]);
  const acc = `eq.${S.acc}`;
  const [plans, heads, sess, cmds, W, homes, opt] = await Promise.all([
    Cloud.q('plans', { account_id: acc, order: 'created_at.desc', limit: 50,
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
  // Plan-Inhalt (bis ca. 30 KB) nur einmal je Plan laden
  const head = heads[0];
  if (head && S.planCache?.id !== head.id) S.planCache = { id: head.id, payload: (await Cloud.q('plans', { id: `eq.${head.id}`, select: 'payload' }))[0]?.payload };
  const active = head ? { ...head, payload: S.planCache.payload } : null;
  const offer = await newPlanOffer(plans, active).catch(() => null);
  const [execs, drift] = active ? await Promise.all([
    Cloud.q('executions', { account_id: acc, plan_id: `eq.${active.id}`, select: 't,step,action,src_name', order: 't.asc', limit: 1000 }),
    Cloud.rpc('plan_abweichung', { p_plan: active.id }).catch(() => null),
  ]) : [[], null];
  const own = isOwner();
  $('#view').innerHTML = newPlanCard(offer, own) + abCard(active, sess, cmds, own, execs, W) + driftCard(drift, own) + optCard(opt[0], own) + `<div class="card" style="margin-top:12px"><h2>Pläne</h2>
    <p class="muted small">Entwürfe kommen vom Optimierer oder von Claude. Ausgeführt wird nur, was du freigibst; die Skripte melden den Fortschritt.</p>
    ${plans.length ? plans.map(p => `<div class="list-item"><div class="row between">
      <span><span class="tag">${esc(KIND[p.kind] || p.kind)}</span> <b>${esc(p.title || '(ohne Titel)')}</b></span>
      <span class="tag ${esc(p.status)}">${esc(p.status)}</span></div>
      <div class="muted small">${esc(p.source)} · ${esc(dt(p.created_at))}${p.plan_hash ? ` · Plan-id ${esc(p.plan_hash)}` : ''}${p.parent_id ? ` · aus ${esc(plans.find(x => x.id === p.parent_id)?.plan_hash || 'älterem Plan')}` : ''}${p.approved_at ? ` · freigegeben ${esc(dt(p.approved_at))}` : ''}</div>
      ${p.note ? `<div class="small" style="white-space:pre-wrap">${esc(p.note)}</div>` : ''}
      ${own && p.status === 'entwurf' ? `<div class="row" style="margin-top:6px"><button class="primary" data-act="freigegeben" data-id="${esc(p.id)}">Freigeben</button>
        <button data-act="verworfen" data-id="${esc(p.id)}">Verwerfen</button></div>` : ''}
      ${own && ['freigegeben', 'aktiv'].includes(p.status) ? `<div class="row" style="margin-top:6px"><button class="danger" data-act="abgebrochen" data-id="${esc(p.id)}">Abbrechen</button></div>` : ''}
      ${own && p.kind === 'build' && p.plan_hash ? `<div class="row" style="margin-top:6px"><a class="small" href="#/plaene/edit/${esc(p.id)}">${['abgebrochen', 'erledigt', 'verworfen'].includes(p.status) ? 'Plan neu starten / ändern' : 'Planschritte ändern (neuer Entwurf)'}</a></div>` : ''}
    </div>`).join('') : '<p class="muted">Noch keine Pläne. Ab P3 legt der Optimierer jeden neuen Bauplan hier als Entwurf ab.</p>'}</div>`;
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
  $('#allSteps')?.addEventListener('click', () => { S.allSteps = !S.allSteps; route(true); });
  $('#npGo')?.addEventListener('click', () => takeNewPlan(offer, sess));
  $('#optGo')?.addEventListener('click', askPlan);
  $('#driftGo')?.addEventListener('click', askPlan);
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

/* ---------- Plan neu starten / Planschritte ändern (Paket F4, 13.10.) ----------
   Aus einem vorhandenen Bauplan (auch abgebrochen oder alt) entsteht ein neuer Entwurf: neue Plan-id (payload.id = plan_hash;
   mit der alten id böte der Collector ihn nicht an und der Autobuilder sähe ihn als abgebrochen), Verweis parent_id.
   Ändern: Schritte überspringen und verschieben, Haltepunkte (payload.halts: der Autobuilder hält ab 0.5.10 vor diesem
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
  const keep = E.rows.filter(r => !r.skip && !(E.dropDone && r.done));
  const steps = keep.map(r => r.s);
  const halts = keep.map((r, i) => r.halt ? i + 1 : null).filter(Boolean);
  const changed = E.rows.some(r => r.skip || r.moved || r.halt !== r.halt0) || E.dropDone && E.rows.some(r => r.done)
    || JSON.stringify(E.limits) !== JSON.stringify(E.orig.limits || {});
  return { keep, steps, halts, changed };
}
async function viewPlanEdit(id) {
  if (!S.ed || S.ed.id !== id) {
    const [src] = await Cloud.q('plans', { id: `eq.${id}`, account_id: `eq.${S.acc}`, select: 'id,kind,status,title,plan_hash,payload' });
    if (!src || src.kind !== 'build' || !Array.isArray(src.payload?.steps)) throw new Error('Bauplan nicht gefunden');
    const [W, L] = await Promise.all([loadWissen().catch(() => null), liveLevels()]);
    const orig = src.payload, lv = L?.lv;
    S.ed = { id, src, orig, W, L, dropDone: false, limits: { ...(orig.limits || {}) }, note: '',
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
  const errs = checkOrder(P.steps, orig.steps, L?.lv, W);
  const bad = new Set(errs.map(e => e.i));
  const nm = t => W?.B?.[t]?.n || t;
  // Gebäude mit Faktor: aus dem Plan und den Grenzen
  const types = [...new Set([...(orig.factors || []).flatMap(f => Object.keys(f[1] || {})), ...Object.keys(E.limits)])]
    .sort((a, b) => nm(a).localeCompare(nm(b), 'de'));
  let n = 0;
  const rows = E.rows.map((r, i) => {
    const out = r.skip || E.dropDone && r.done;
    const no = out ? 0 : ++n;
    return `${r.halt && !out ? `<tr class="halt"><td></td><td colspan="2">⏸ Haltepunkt: Autobuilder hält vor #${no} an</td></tr>` : ''}
      <tr class="step${out ? ' skip' : ''}${!out && bad.has(no - 1) ? ' bad' : ''}" data-i="${i}">
      <td class="num">${out ? '–' : '#' + no}</td>
      <td>${esc(r.s[5])}${r.s[0] === 'r' ? ' <span class="tag">global</span>' : ''}<div class="small muted">war #${r.n0}${r.moved ? ' · verschoben' : ''}${r.done ? ' · live erreicht' : ''}${r.skip ? ' · übersprungen' : ''}</div></td>
      <td class="acts">${own ? `<button data-a="up" title="nach oben"${i ? '' : ' disabled'}>↑</button><button data-a="down" title="nach unten"${i < E.rows.length - 1 ? '' : ' disabled'}>↓</button><button data-a="halt" title="Haltepunkt davor"${r.halt ? ' class="on"' : ''}>⏸</button><button data-a="skip" title="überspringen"${r.skip ? ' class="on"' : ''}>✕</button>` : ''}</td></tr>`;
  }).join('');
  const lim = Object.entries(E.limits).map(([t, [a, b]]) => `<div class="row between small"><span>${esc(nm(t))}: ${a}–${b} %</span>${own ? `<button class="link" data-lim-del="${esc(t)}">entfernen</button>` : ''}</div>`).join('');
  const pctOpts = sel => Array.from({ length: 11 }, (_, k) => k * 10).map(v => `<option value="${v}"${v === sel ? ' selected' : ''}>${v} %</option>`).join('');
  $('#view').innerHTML = `<div class="card"><div class="row between"><h2>Plan neu starten / ändern</h2><a href="#/plaene" class="small">zurück</a></div>
    <p class="small">Vorlage: <b>${esc(E.src.title)}</b> <span class="tag ${esc(E.src.status)}">${esc(E.src.status)}</span> · Plan-id ${esc(orig.id)} · ${orig.steps.length} Schritte</p>
    <p class="muted small">Es entsteht ein <b>neuer Entwurf</b> mit neuer Plan-id und neuen Schrittnummern; die Vorlage bleibt unverändert. Freigeben und auf ein Gerät übernehmen danach wie gewohnt, „bis #“ neu wählen. Haltepunkte und Faktor-Grenzen wirken ab Autobuilder 0.5.10.</p>
    <p class="small">${L ? `Live-Stand ${esc(dt(L.at))}: ${E.rows.filter(r => r.done).length} Schritte schon erreicht.` : '<span class="warn">Kein Live-Stand – Prüfung nur gegen den Ursprungsplan.</span>'}</p>
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
  $('#view').querySelectorAll('[data-lim-del]').forEach(b => b.addEventListener('click', () => { delete E.limits[b.dataset.limDel]; renderPlanEdit(own); }));
  $('#view').querySelector('.edsteps').addEventListener('click', e => {
    const b = e.target.closest('button[data-a]'); if (!b) return;
    const i = +b.closest('tr').dataset.i, r = E.rows[i];
    if (b.dataset.a === 'skip') r.skip = !r.skip;
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
async function createEdited(E, P, errs) {
  if (errs.length && !confirm(`${errs.length} Probleme bei den Voraussetzungen (erstes: ${errs[0].text}).\nDer Autobuilder würde dort warten oder anhalten. Trotzdem anlegen?`)) return;
  const o = E.orig, now = new Date();
  const when = now.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const hours = +o.hours || +(String(o.created || '').match(/([\d.]+) h$/) || [])[1] || undefined;
  const payload = { ...o, steps: P.steps, halts: P.halts, limits: E.limits, parent: o.id,
    created: `${String(o.created || '').replace(/ · (neu|geändert) .*$/, '')} · ${P.changed ? 'geändert' : 'neu'} ${when}`, hours };
  delete payload.agreed;
  if (!P.halts.length) delete payload.halts;
  if (!Object.keys(E.limits).length) delete payload.limits;
  // Planet je Schritt (Kolonien, plan.stepPlanet {Nr: Koordinaten}) auf die neuen Nummern umschreiben
  if (o.stepPlanet) payload.stepPlanet = Object.fromEntries(P.keep.map((r, i) => [i + 1, o.stepPlanet[r.n0]]).filter(x => x[1]));
  payload.id = await planId([payload.startTime, payload.steps, payload.factors, payload.halts || [], payload.limits || {}, o.id, now.toISOString()]);
  const sk = E.rows.filter(r => r.skip).map(r => '#' + r.n0), mv = E.rows.filter(r => r.moved && !r.skip).map(r => '#' + r.n0);
  const note = [`${P.changed ? 'Geändert' : 'Neu gestartet'} aus ${o.id} (${E.src.status}) im Cockpit: ${P.steps.length} Schritte`,
    E.dropDone ? `live erreichte weggelassen (${E.rows.filter(r => r.done && !r.skip).length})` : '',
    sk.length ? `übersprungen ${sk.join(' ')}` : '', mv.length ? `verschoben ${mv.join(' ')}` : '',
    P.halts.length ? `Haltepunkte vor #${P.halts.join(', #')}` : '',
    Object.keys(E.limits).length ? `Faktor-Grenzen ${Object.entries(E.limits).map(([t, [a, b]]) => `${t} ${a}–${b} %`).join(', ')}` : '',
    errs.length ? `${errs.length} Voraussetzungs-Hinweise` : '', E.note.trim()].filter(Boolean).join(' · ');
  if (!confirm(`Neuen Entwurf anlegen?\n${note}\nPlan-id ${payload.id}. Freigeben danach unter Pläne.`)) return;
  try {
    await Cloud.rest('plans', { method: 'POST', prefer: 'return=minimal', body: { account_id: S.acc, kind: 'build', source: 'user',
      title: `Bauplan ${payload.created}`.slice(0, 200), note: note.slice(0, 4000), payload, plan_hash: payload.id, parent_id: E.src.id } });
    S.ed = null;
    toast('Entwurf angelegt – freigeben unter Pläne');
    location.hash = '#/plaene';
  } catch (e) { toast(e.message); }
}

/* ---------- Spieldaten (Gebäude und Forschung, Datenbank Runde 7); Reiter Kompendium in kompendium.js ---------- */

async function loadWissen() {
  if (S.wissen) return S.wissen;
  let r = await fetch('data/horizon-data.json').catch(() => null);
  if (!r?.ok) r = await fetch('../analyse/horizon-data.json');  // lokale Vorschau aus dem Repo
  const d = await r.json();
  for (const o of Object.values(d.B)) o.L = Object.fromEntries(o.l.map(x => [x[0], x]));
  return (S.wissen = d);
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
      <span><span class="tag ${r.status === 'beantwortet' ? 'ok' : ''}">${esc(RQ_ST[r.status] || r.status)}</span> ${r.kind !== 'frage' ? `<span class="tag">${esc(r.kind)}</span> ` : ''}<span class="muted small">${esc(RQ_TGT[r.target] || r.target)}</span></span>
      <span class="muted small">${esc(dt(r.created_at))}</span></div>
      <div style="white-space:pre-wrap">${esc(r.text)}</div>
      ${r.answer ? `<div class="msgbody small"><b>Antwort</b>${r.answered_at ? ` <span class="muted">${esc(dt(r.answered_at))}</span>` : ''}<br>${esc(r.answer)}</div>` : ''}
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
    <div class="card"><h2>Über</h2><p class="small">Version ${esc(window.APP_VERSION?.number)} · ${esc(window.APP_VERSION?.built)}</p>
      <p class="small muted">Gerätekennung ${esc(Cloud.device.slice(0, 8))}…</p>
      <p class="small">Ansicht: <b>${isStandalone() ? 'als App (ohne Browserleiste)' : 'im Browser'}</b></p>
      ${!isStandalone() ? `<p><button id="install"${installPrompt ? '' : ' disabled'}>Als App installieren</button></p>
        <p class="muted small" id="installHint">${installPrompt ? 'Chrome bietet die Installation an.'
          : 'Chrome bietet gerade keine Installation an (Seite neu laden; sonst Chrome-Menü ⋮ → „App installieren“, auf dem iPhone Safari → Teilen → „Zum Home-Bildschirm“).'}</p>` : ''}
      <p class="small muted">Plan und Stand: doku/stand/cockpit.md im Horizon-Repo.</p></div></div>`;
  fillPushCard();
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
