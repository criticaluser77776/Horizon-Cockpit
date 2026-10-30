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
const VIEWS = { steuerung: viewSteuerung, lage: viewLage, meldungen: viewMeldungen, ereignisse: viewMeldungen, plaene: viewPlans, transporte: viewTransporte, claude: viewClaude, mehr: viewMore };
const TAB_OF = { ereignisse: 'meldungen' };

// soft = automatische Aktualisierung: ohne „Lädt …“, die Ansicht bleibt bis zum Neuaufbau stehen
async function route(soft) {
  if (!Cloud.loggedIn() || !S.acc) return;
  const [tab = 'lage', ...rest] = location.hash.replace(/^#\/?/, '').split('/');
  const fn = VIEWS[tab] || viewLage;
  const on = VIEWS[tab] ? TAB_OF[tab] || tab : 'lage';
  document.querySelectorAll('nav.tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === on));
  document.querySelector('nav.tabs a.on')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  if (soft !== true) $('#view').innerHTML = '<p class="muted pad">Lädt …</p>';
  try { await loadNums(); await fn(rest); } catch (e) {
    if (e instanceof LoginNeeded) return renderLogin(e.message);
    $('#view').innerHTML = `<div class="card"><p class="err">${esc(e.message)}</p><button onclick="route()">Erneut versuchen</button></div>`;
  }
  updateBadge();
}

// Lage, Pläne, Transporte und Meldungen alle 30 s still neu laden (nur sichtbar, nicht während einer Eingabe oder bei aufgeklappter Liste).
// Der große Live-Stand kommt dabei nur bei neuem Zeitstempel (S.snap), sonst nur Lauf, Lebenszeichen, Ereignisse.
setInterval(() => {
  const tab = location.hash.replace(/^#\/?/, '').split('/')[0] || 'lage';
  if (document.visibilityState !== 'visible' || !['steuerung', 'lage', 'plaene', 'transporte', 'meldungen', 'ereignisse'].includes(tab)) return;
  if (document.activeElement?.matches?.('input,select,textarea')) return;
  route(true);
}, 30000);

// Badges (C1, Umbau 2 U1): Nachrichten = ungesehene Ereignisse „hoch“, Steuerung = offene Entscheidungen
async function updateBadge() {
  try {
    const [r, dec] = await Promise.all([
      Cloud.q('events', { select: 'id', account_id: `eq.${S.acc}`, level: 'eq.hoch', seen_at: 'is.null', dismissed_at: 'is.null', limit: 99 }),
      loadDecisions('id,data:data->decision,answer:data->answer').then(l => l.map(e => ({ id: e.id, data: { decision: e.data, answer: e.answer } }))).catch(() => []),
    ]);
    const nd = dec.filter(openDecision).length;
    $('#evBadge').hidden = !r.length; $('#evBadge').textContent = r.length;
    $('#stBadge').hidden = !nd; $('#stBadge').textContent = nd;
  } catch { /* egal */ }
}

/* ---------- Lage ---------- */

const RES = ['Eisenerz', 'Mineral', 'Treibstoff'];

// Live-Stand (ca. 35 KB) nur laden, wenn er neu ist (head = Kopfzeile aus state_latest mit collected_at); gemeinsam für Lage und Pläne in S.snap
async function ensureSnap(head) {
  if (head && (S.snap?.acc !== S.acc || S.snap?.at !== head.collected_at)) {
    const full = await Cloud.q('state_latest', { account_id: `eq.${S.acc}`, kind: 'eq.live', select: 'collected_at,data' });
    S.snap = { acc: S.acc, at: head.collected_at, data: full[0]?.data };
  }
}

async function viewLage() {
  const acc = `eq.${S.acc}`;
  const [heads, sess, ap, effs, effEnds, gds, movis] = await Promise.all([   // letztes Element loadDrift füllt S.drift (für overviewCard), kein Name nötig
    Cloud.q('state_latest', { account_id: acc, kind: 'eq.live', select: 'kind,collected_at,version' }),
    loadSessions(),
    loadActivePlan(),   // aktiver Bauplan für die Steuerung („bis #“, Start)
    ...loadEffects(acc),
    Cloud.q('getdata_state', { account_id: acc, select: 'at,colony,colonies,queues,jobs,wake,expires_at,ok_at,error,error_at' }).catch(() => []),
    loadDecisions('id,t,text,data:data->decision,answer:data->answer').then(l => l.filter(e => /Motivationsvideo/i.test(e.text || ''))
      .map(e => ({ ...e, data: { decision: e.data, answer: e.answer } })).filter(openDecision)).catch(() => []),
    loadDrift(),
  ]);
  const head = heads[0];
  await ensureSnap(head);
  const live = head ? { collected_at: head.collected_at } : null;
  const d = head ? S.snap?.data : null;
  // jüngster Stand des Autobuilders (laufende Aufträge, Rohstoffe aus seiner letzten Prüfung)
  const abLive = sess.devs.map(x => x.ab?.state).filter(s => s?.liveAt).sort((a, b) => b.liveAt - a.liveAt)[0] || null;
  // C1 (17.10.2026), PR 4 (25.10.2026): Lage kompakt – Werbebanner (nur wenn handelbar), Überblick (mit getData und Effekten in je einer
  // Zeile), Steuerung (Geräte, Lauf, Notfall), Motivationsvideo. Planeten, Ausbau, Gebäude/Forschung, die volle getData-Karte,
  // Wartung (Faktoren, Kommandoliste) stehen im Horizon Atlas unter Imperium.
  const W = await loadWissen().catch(() => null);  // Namen für noch nicht gebaute Stufen
  const active = ap ? { ...ap.row, payload: ap.payload } : null, nf = { active: ap?.row || null, known: {} };
  const nm = (i, set) => i.name || W?.[set]?.[i.type]?.n || i.type;
  const karten = await planetenKarten(d, ap, gds[0], sess, W, live?.collected_at, planetEffects(effs, effEnds)).catch(() => '');   // Fehler hier dürfen die Lage nie blockieren
  const trLine = await naechsterTransport(ap, d).catch(() => '');
  // Umbau 2 U1 (30.10.2026): Werbebanner, Steuerung und Motivationsvideo stehen im Reiter Steuerung; hier nur ein Hinweis
  const todo = [bannerCard(sess) ? 'Werbebanner' : '', movis.length ? 'Motivationsvideo' : ''].filter(Boolean);
  $('#view').innerHTML = (todo.length ? `<div class="card warn small"><a href="#/steuerung">${esc(todo.join(' · '))} wartet – zur Steuerung →</a></div>` : '')
    + overviewCard(sess, d, live, abLive, nm, W, trLine + effectsLine(effs, effEnds), gds[0]) + karten
    + '<p class="small muted pad">Planeten, Gebäude, Forschung: <a href="details/#/imperium" target="_blank" rel="noopener">Imperium im Atlas →</a></p>';
  bindAsk($('#view'), c => S.askLage?.[c]);
  $('#view').querySelectorAll('details[data-lage]').forEach(x => x.addEventListener('toggle', () => lageOpenSet(x.dataset.lage, x.open)));
}

/* Nächster Transport als Zeile im Überblick (Idee aus cockpit-umbau.md, Umbau 2 U2): laufende/offene Transportaufträge an den Autobuilder,
   sonst der nächste noch nicht geflogene Takt-Flug des aktiven Plans (Zeiten wie im Reiter Transport, Transporte.transportListe). */
async function naechsterTransport(ap, d) {
  const nm = c => esc(trName(d, c));
  const [auf, hk, drift] = await Promise.all([
    Cloud.q('transport_auftraege', { account_id: `eq.${S.acc}`, status: 'in.(offen,laeuft)', order: 'id.asc', limit: 5, select: 'id,von,nach,menge,status' }).catch(() => []),
    ap ? Cloud.q('transport_haken', { plan_id: `eq.${ap.row.id}`, select: 'nr' }).catch(() => []) : [],
    loadDrift().catch(() => null)]);
  const parts = (auf || []).map(a => `Auftrag #${esc(a.id)} ${nm(a.von)} → ${nm(a.nach)} <span class="tag ${a.status === 'laeuft' ? 'aktiv' : ''}">${a.status === 'laeuft' ? 'läuft' : 'offen'}</span>`);
  const x = ap ? Transporte.transportListe(ap.payload, drift?.plan === ap.row.id ? drift : null, (hk || []).map(h => h.nr)).find(t => t.status !== 'geflogen') : null;
  if (x) parts.push(`Plan #${x.nr} ${nm(x.von)} → ${nm(x.nach)} <span class="${x.status === 'faellig' ? 'warn' : 'muted'}">${x.status === 'faellig' ? 'fällig seit' : 'ab'} ${esc(clockT(x.ab))}</span>`
    + ` <span class="muted">· hin ${trLad(x.hin)} · zurück ${trLad(x.zurueck)}</span>`);
  return parts.length ? `<p class="small">Nächster Transport: ${parts.join(' · ')} <a href="#/transporte">→</a></p>` : '';
}

/* ---------- Steuerung (Umbau 2 U1, Nutzer 30.10.2026) ----------
   Alles, was etwas auslöst, an einem Ort: Werbebanner, neuer Plan (Freigabe), Steuerung/Notfall (Geräte, Lauf, „bis #“),
   Motivationsvideo, offene Entscheidungen aus Nachrichten. Die Karten und ihre Knöpfe sind dieselben wie vorher in Lage,
   Pläne und Meldungen. */
async function viewSteuerung() {
  const acc = `eq.${S.acc}`;
  const [sess, ap, dec, plans] = await Promise.all([
    loadSessions(),
    loadActivePlan(),
    loadDecisions().catch(() => []),
    Cloud.q('plans', { account_id: acc, order: 'created_at.desc', limit: 30,
      select: 'id,kind,source,status,title,note,plan_hash,parent_id,created_at,approved_at,status_at' }).catch(() => []),
  ]);
  if (plans.some(p => !planNo(p.id))) await loadNums(true);
  const active = ap ? { ...ap.row, payload: ap.payload } : null, nf = { active: ap?.row || null, known: {} };
  const drift0 = await loadDrift(true).catch(() => null);
  const drift = drift0?.plan === active?.id ? drift0 : null;
  const offer = newPlanOffer(plans, active, await draftGains(plans, active, drift).catch(() => ({})));
  const abLive = sess.devs.map(x => x.ab?.state).filter(s => s?.liveAt).sort((a, b) => b.liveAt - a.liveAt)[0] || null;
  const open = dec.filter(openDecision);
  const movis = open.filter(e => /Motivationsvideo/i.test(e.text || ''));
  const others = open.filter(e => !movis.includes(e));
  $('#view').innerHTML = bannerCard(sess) + newPlanCard(offer, isOwner()) + steuerungCard(sess, nf, active) + moviCard(sess, abLive, movis)
    + `<div class="card"><h2>Entscheidungen aus Nachrichten${others.length ? ` <span class="muted small">${others.length}</span>` : ''}</h2>${others.length
      ? others.map(evRow).join('') : '<p class="muted small">Keine offene Entscheidung.</p>'}</div>`;
  $('#bannerGo')?.addEventListener('click', () => sendBanner(sess));
  $('#npGo')?.addEventListener('click', () => takeNewPlan(offer, sess));
  $('#npNo')?.addEventListener('click', async () => {
    if (!confirm('Entwurf verwerfen?')) return;
    try { await Cloud.rpc('plan_status', { p_id: offer.draft.id, p_status: 'verworfen' }); toast('Verworfen'); route(); } catch (e) { toast(e.message); }
  });
  swipeEvents($('#view'));
  bindSteuerung(sess, nf, active);
}

/* ---------- Planetenkarten der Lage (PR 5, 25.10.2026) ----------
   Je eigenem Planeten eine Karte (planetKarte in common.js): Bau, Forschung (auf dem Forschungsplaneten), Werft.
   Quelle: Zeitfeed über planFeed (aktiver Plan + Ausführungen + getData + Lebenszeichen); ohne Plan nur die
   laufenden Aufträge aus getData (gd.jobs). Planetenwerte nur im Atlas (Nutzer 25.10.2026). */
// Ohne Plan: laufende Aufträge aus getData als Feed-Zeilen (nur run, Name aus den Spieldaten)
function liveJobRows(gd, home, W, now = Date.now()) {
  const jobs = (Array.isArray(gd?.jobs) ? gd.jobs : []).filter(j => j && ['b', 'r', 's'].includes(j.k) && Date.parse(j.end) > now);
  return jobs.map(j => {
    const cls = String(j.cls || ''), c = j.coords || home, nm = W?.[j.k === 'r' ? 'R' : 'B']?.[cls]?.n || cls;
    return { q: j.k === 'r' ? 'r' : c === home ? j.k : `${j.k}:${c}`, planet: j.k === 'r' ? null : c, name: j.k === 's' ? nm : `${nm}${j.level != null ? ` ${j.level}` : ''}`,
      run: { i: null, end: Date.parse(j.end), name: j.k === 's' ? nm : `${nm}${j.level != null ? ` ${j.level}` : ''}` }, next: null };
  });
}
async function planetenKarten(d, ap, gd, sess, W, liveAt, effByPl = {}) {
  const pl = empirePlanets(d).filter(p => /^\d+:\d+:\d+$/.test(p.coords || ''));
  if (!pl.length) return '';
  const plan = ap?.payload && Array.isArray(ap.payload.steps) ? ap.payload : null;
  const [execs, wplans] = await Promise.all([plan ? loadPlanExecs(`eq.${S.acc}`, ap.row.id, plan).catch(() => []) : [],
    Cloud.q('plans', { account_id: `eq.${S.acc}`, kind: 'in.(ship,defense)', status: 'in.(freigegeben,aktiv)', select: 'id,kind,created_at,payload', limit: 4 }).catch(() => [])]);
  const home = planHomeCoords(plan, gd, pl[0].coords);
  let feed = plan ? planFeed(plan, execs, sess, gd) : [];
  if (!feed.length) feed = liveJobRows(gd, home, W);
  const by = feedByPlanet(plan, feed, home, pl), cur = d?.start?.coords;   // Zuordnung gemeinsam mit den Planeten-Karten unter Pläne (common.js)
  S.askLage = Object.fromEntries(pl.map(p => [p.coords, askPlanetPayload(p, by[p.coords], ap?.row?.id || null, plan?.steps)]));   // für „Claude fragen“ (bindAsk)
  // Live-Zeitplan wie planFeed (Lebenszeichen des Laufhalters bzw. eines Geräts mit diesem Plan)
  let LT = null, isDone = null;
  if (plan) {
    const dev = sess?.devs?.find(x => x.holds && x.ab) || sess?.devs?.find(x => x.ab?.state?.plan === plan.id) || null;
    const st = dev?.ab?.state || {}, hst = st.plan === plan.id ? st : {};
    isDone = planStepDone(plan, hst, execs);
    LT = planLive(plan, isDone, execs, hst);
  }
  const ctx = { plan, LT, home, gd, d, W, liveAt, wplans: wplans || [], open: lageOpen() };
  return pl.map(p => {
    const rows = by[p.coords];
    return planetKarte(p, rows, { research: rows.some(r => r.q === 'r'), steps: plan?.steps, current: p.coords === cur, plan: null, effects: effByPl[p.coords], extra: lageAusbau(p, ctx) });
  }).join('');
}

/* ---------- Ausbau und Flotten je Planet (Umbau 2 U2, Nutzer 30.10.2026) ----------
   Je Planet aufklappbar: Gebäude, Forschung, Schiffbau, Def-Bau mit Kosten, Start, Dauer und Ende. Planschritte mit Live-Zeiten (planLive
   wie im Reiter Pläne): laufende und offene mit Start in den nächsten 24 h, mindestens die nächsten 5 je Art (Nutzer 30.10.2026). Laufende Aufträge
   ohne Planschritt aus getData (gd.jobs), die Werft des gewählten Planeten aus dem Live-Stand (snapshot.shipyard). Werft-/Def-Pläne
   (Paket E, payload.steps [Kürzel, Menge, ab_h]) kennen keine Kosten und Dauer, nur „frühestens“. Darunter die Schiffe am Planeten
   (Schiffsstatistik empire.ships: Flotte, Hafen, Bunker, im Bau) und die Flotten, die der Autobuilder gesehen hat (snapshot.flotten wie
   Karte „Flotten“ im Reiter Transport). Auf/zu je Planet in localStorage (hz.lageOpen), damit die 30-s-Aktualisierung es nicht zuklappt. */
const lageOpen = () => { try { return JSON.parse(localStorage.getItem('hz.lageOpen') || '{}') || {}; } catch { return {}; } };
function lageOpenSet(c, on) {
  const o = lageOpen();
  if (on) o[c] = 1; else delete o[c];
  try { localStorage.setItem('hz.lageOpen', JSON.stringify(o)); } catch { /* egal */ }
}
const lageKosten = c => { const p = (Array.isArray(c) ? c : []).map((v, i) => +v > 0 ? `${['E', 'M', 'T'][i]} ${fmt(+v)}` : '').filter(Boolean); return p.length ? p.join(' · ') : ''; };
function lageAusbau(p, ctx) {
  const { plan, LT, home, gd, d, W, liveAt, wplans, open } = ctx, now = Date.now(), H = 3600e3;
  const owner = i => plan.steps[i][0] === 'r' ? planResPlanet(plan, i + 1) || home : planAway(plan, i + 1) || home;
  const art = {};
  for (const k of ['b', 'r', 's', 'd']) {
    let rows = [];
    if (plan && LT) {
      const mine = plan.steps.map((s, i) => i).filter(i => plan.steps[i][0] === k && LT.t[i] && owner(i) === p.coords)
        .map(i => { const t = LT.t[i], s = plan.steps[i]; return { n: i + 1, name: s[5], cost: s[6], start: t.run ? t.s : t.a, end: t.e, run: !!t.run, due: t.due }; })
        .sort((a, b) => a.start - b.start || a.n - b.n);
      rows = mine.filter(r => r.run || r.start <= now + 24 * H);
      if (rows.length < 5) rows = mine.slice(0, 5);
    }
    art[k] = rows;
  }
  // laufende Aufträge ohne laufenden Planschritt: getData (Bau, Forschung, Werft), Werft des gewählten Planeten aus dem Live-Stand
  const gdHome = typeof gd?.colony?.coords === 'string' ? gd.colony.coords : home;
  for (const j of Array.isArray(gd?.jobs) ? gd.jobs : []) {
    if (!j || !['b', 'r', 's'].includes(j.k) || !(Date.parse(j.end) > now) || (j.coords || gdHome) !== p.coords || art[j.k].some(r => r.run)) continue;
    const cls = String(j.cls || ''), n = W?.[j.k === 'r' ? 'R' : 'B']?.[cls]?.n || cls;
    art[j.k].unshift({ name: j.k === 's' ? n : `${n}${j.level != null ? ` ${j.level}` : ''}`, end: Date.parse(j.end), run: true, live: true });
  }
  const sy = d?.shipyard && !d.shipyard.error ? d.shipyard : null, snapAt = Date.parse(liveAt);
  if (sy && p.coords === d?.start?.coords && isFinite(snapAt) && !art.s.some(r => r.run)) {
    const q = Array.isArray(sy.queue) ? sy.queue : [], end1 = sy.remaining != null ? snapAt + sy.remaining * 1000 : null;
    const rest = q[0]?.id === sy.id ? q.slice(1) : q;
    const live = [];
    if (sy.id && end1 > now) live.push({ name: `${q[0]?.id === sy.id && q[0].qty > 1 ? `${fmt(q[0].qty)}× ` : ''}${sy.id}`, end: end1, run: true, live: true });
    for (const x of rest) live.push({ name: `${fmt(x.qty)}× ${x.id}`, end: sy.total != null ? snapAt + sy.total * 1000 : null, wait: true, live: true });
    if (live.length && (sy.total == null || snapAt + sy.total * 1000 > now)) art.s.unshift(...live);
  }
  // Werft- und Def-Pläne (Paket E) gehören zur Heimat
  if (p.coords === home) for (const w of wplans) {
    const k = w.kind === 'defense' ? 'd' : 's', t0 = Date.parse(w.payload?.startTime || w.created_at);
    const st = (Array.isArray(w.payload?.steps) ? w.payload.steps : []).filter(x => Array.isArray(x) && x.length === 3).slice(0, 5);
    art[k].push(...st.map(([kz, n, h]) => ({ name: `${fmt(n)}× ${kz}`, start: isFinite(t0) ? Math.max(now, t0 + (+h || 0) * H) : null, plan: true })));
  }
  const row = r => {
    const dauer = r.start != null && r.end != null ? durDHM((r.end - r.start) / 1000) : '–';
    const tag = r.wait ? ' <span class="tag">wartet</span>' : r.due != null ? ` <span class="tag mittel" title="fällig seit ${esc(dt(r.due))}">fällig</span>` : '';
    const sub = [lageKosten(r.cost), r.live ? 'laut Spiel' : '', r.plan ? 'Werft-/Def-Plan, frühestens' : ''].filter(Boolean).join(' · ');
    const zeit = [r.run ? '<span class="tag aktiv">läuft</span>' : r.start != null ? `Start <b title="${esc(dt(r.start))}">${esc(clockT(r.start))}</b>` : '',
      r.start != null && r.end != null ? `Dauer ${dauer}` : '', r.end != null ? `Ende <b title="${esc(dt(r.end))}">${esc(clockT(r.end))}</b>` : ''].filter(Boolean).join(' · ');
    return `<div class="lgrow"><div>${r.n ? `<span class="muted">#${r.n}</span> ` : ''}${esc(r.name)}${tag}</div>`
      + `${sub ? `<div class="small muted">${esc(sub)}</div>` : ''}${zeit ? `<div class="small">${zeit}</div>` : ''}</div>`;
  };
  const leer = { b: 'Nichts geplant.', r: 'Keine Forschung auf diesem Planeten.', s: 'Kein Schiffbau.', d: 'Kein Def-Auftrag (Live-Liste folgt mit Paket F).' };
  const kinds = [['b', 'Gebäude'], ['r', 'Forschung'], ['s', 'Schiffbau'], ['d', 'Def-Bau']].filter(([k]) => k !== 'r' || art.r.length);
  const tabs = kinds.map(([k, t]) => `<div class="small lgart"><b>${t}</b></div>` + (art[k].length
    ? art[k].map(row).join('')
    : `<div class="small muted">${leer[k]}</div>`)).join('');
  return `<details class="sub" data-lage="${esc(p.coords)}"${open[p.coords] ? ' open' : ''}><summary class="small muted">Ausbau und Flotten</summary>${tabs}${lageFlotten(p, d)}</details>`;
}
// Schiffe am Planeten (Schiffsstatistik, Aufteilung ab Collector 0.4.36) und Flotten, die der Autobuilder gesehen hat (im Orbit, unterwegs)
function lageFlotten(p, d) {
  const sh = d?.empire?.ships, k = Array.isArray(sh?.planets) ? sh.planets.findIndex(x => x.coords === p.coords) : -1;
  const ORT = [['flotte', 'in Flotte'], ['hafen', 'im Hafen'], ['bunker', 'im Bunker'], ['flug', 'unterwegs'], ['bau', 'im Bau']];
  const schiffe = k < 0 ? [] : (sh.items || []).map(i => {
    const s = i.split?.[k];
    const wo = s ? ORT.filter(([x]) => +s[x] > 0).map(([x, t]) => `${fmt(+s[x])} ${t}`) : [];
    return (i.values?.[k] || 0) > 0 || wo.length ? `${esc(i.type)} ${wo.length ? esc(wo.join(', ')) : fmt(i.values[k])}` : '';
  }).filter(Boolean);
  const M = d?.flotten, list = (Array.isArray(M?.list) ? M.list : []).filter(f => f.at === p.coords);
  const ops = (Array.isArray(M?.ops?.list) ? M.ops.list : []).filter(o => o.home === p.coords || o.target === p.coords);
  const typen = t => Object.entries(t || {}).map(([x, n]) => `${n} ${x}`).join(', ');
  const fl = [...list.map(f => `<div class="small"><b>${esc(f.name)}</b> <span class="tag ok">im Orbit</span> ${esc(typen(f.types)) || '–'}${f.cargo ? ` · Laderaum ${esc(fmt(f.cargo))} t` : ''} <span class="muted">· gesehen ${esc(when(new Date(f.seen).toISOString()))}</span></div>`),
    ...ops.map(o => `<div class="small"><b>${esc(o.name)}</b> <span class="tag aktiv">unterwegs</span> ${esc(o.cmd || '')} ${esc(o.phase || '')} ${esc(trName(d, o.home))} → ${esc(trName(d, o.target))}, bis ${esc(clockT(o.end))}</div>`)];
  return `<div class="small lgart"><b>Schiffe und Flotten</b></div>`
    + (schiffe.length ? `<div class="small">${schiffe.join(' · ')}</div>` : '<div class="small muted">Keine Schiffe laut Schiffsstatistik.</div>')
    + (fl.length ? fl.join('') : '<div class="small muted">Keine Flotte gesehen (der Autobuilder merkt sie sich beim Fliegen).</div>');
}

// getData-Zeile im Überblick entfällt seit den Nacharbeiten (25.10.2026, Nutzer); Stand, Weckzeit und Gastzugang im Atlas unter Imperium,
// der Zugang unter Mehr → getData-Zugang.

/* Aktive Effekte aus Berichten in einer Zeile (volle Liste im Atlas). Das Ende kommt oft als eigener Bericht („Motivationsvideo
   verliert Wirkung“, „Pilze verlieren Wirkung“, „Reiche Metallvorkommen erschöpft“), während der Autobuilder (13-nachrichten.js) für
   manche Effekte nur eine typische Dauer kennt (Motivationsvideo 336 h = Verfügbarkeit, nicht Wirkung). Deshalb: Ein Effekt gilt als
   beendet, sobald nach ihm ein End-Bericht mit demselben ersten Wort kommt; End-Berichte selbst sind nie ein Effekt. */
const EFF_END_RE = /Wirkung|erschöpft|abgelaufen/i;
const EFF_END_OR = '(text.ilike.*Wirkung*,text.ilike.*erschöpft*,text.ilike.*abgelaufen*)';
const effKey = s => String(s || '').replace(/^Bericht:\s*/i, '').trim().split(/\s+/)[0].toLowerCase();
// Effekt-Berichte mit Ende in der Zukunft und End-Berichte der letzten 15 Tage (zwei Abfragen, für Promise.all ausgebreitet)
const loadEffects = acc => [
  Cloud.q('events', { account_id: acc, kind: 'eq.bericht', 'data->effect->>until': `gt.${new Date().toISOString()}`,
    select: 'id,t,text,eff:data->effect', order: 't.desc', limit: 20 }).catch(() => []),
  Cloud.q('events', { account_id: acc, kind: 'eq.bericht', t: `gt.${new Date(Date.now() - 15 * 86400e3).toISOString()}`, or: EFF_END_OR,
    select: 'id,t,text', order: 't.desc', limit: 30 }).catch(() => []),
];
// noch wirkende Effekte, je Name der jüngste, nach Ende sortiert
function liveEffects(effs, ends = []) {
  const endAt = {};
  for (const e of ends || []) if (EFF_END_RE.test(e.text || '')) { const k = effKey(e.text), t = Date.parse(e.t); if (!(endAt[k] >= t)) endAt[k] = t; }
  const live = r => !EFF_END_RE.test(r.eff.name || '') && !(endAt[effKey(r.eff.name)] > Date.parse(r.t));
  const seen = new Set();
  return (effs || []).filter(r => r.eff?.until && live(r) && !seen.has(r.eff.name) && seen.add(r.eff.name))
    .sort((a, b) => Date.parse(a.eff.until) - Date.parse(b.eff.until));
}
/* Effekte je Planet für die Planetenkarten (Nutzer 30.10.2026): Koordinaten aus dem Berichtstext („(Minenbehörde · Yontaurza V (1:156:5))“).
   Je Planet und Effekt nur der jüngste; ein „… erschöpft“ gilt nur für denselben Planeten (Text mit denselben Koordinaten). */
function planetEffects(effs, ends = []) {
  const at = t => (String(t || '').match(/\((\d+:\d+:\d+)\)/) || [])[1] || null;
  const out = {}, seen = new Set();
  for (const r of (effs || []).filter(r => r.eff?.until && !EFF_END_RE.test(r.eff.name || ''))) {
    const c = at(r.text), k = `${c}|${r.eff.name}`;
    if (!c || seen.has(k)) continue;
    seen.add(k);
    if ((ends || []).some(e => EFF_END_RE.test(e.text || '') && at(e.text) === c && effKey(e.text) === effKey(r.eff.name) && Date.parse(e.t) > Date.parse(r.t))) continue;
    (out[c] = out[c] || []).push({ name: String(r.eff.name).replace(/\s*·\s*$/, '').split(/\s*·\s*/)[0], until: r.eff.until, src: r.eff.src });
  }
  for (const c in out) out[c].sort((a, b) => Date.parse(a.until) - Date.parse(b.until));
  return out;
}
function effectsLine(effs, ends = []) {
  const list = liveEffects(effs, ends);
  return list.length ? `<p class="small">Effekte: ${list.map(r => `${esc(String(r.eff.name || '').split(/\s*·\s*/)[0])} <span class="muted">bis ${esc(clockT(r.eff.until))}${r.eff.src === 'typisch' ? ' (geschätzt)' : ''}</span>`).join(' · ')}</p>` : '';
}
/* ---------- Überblick (B10): Lauf, Rohstoffe, laufende Aufträge in wenigen Zeilen ----------
   Ab 16.10. (Nutzer) Gesamtwerte des Imperiums: Rohstoffe aller Planeten (emp_prod: Lager + Netto-Förderung, auf jetzt
   hochgerechnet), Koloniepunkte benutzt/gesamt (cmd=orden, Collector ab 0.4.7). „Ausbau x / y“ steht nur noch im Atlas (Imperium). */
/* Belegung je Planet (Nutzer 25.10.2026): Bau und Forschung = laufende Aufträge, Werft = belegte Plätze der Warteschlange inkl. des
   laufenden Auftrags, Def = dasselbe für Verteidigung. Quelle: Bau/Forschung aus getData (gd.jobs, alle 10 min), wenn jünger als der
   Live-Stand, sonst „Ausbau Bau / Forschung / Werft“ der Startseite (empire.planets[].Ausbau). Werft der Heimat aus snapshot.shipyard
   (Collector ab 0.4.33: laufend + wartende Aufträge, nach Ablauf von total leer), sonst aus Ausbau. Eine Verteidigungs-Schlange
   liest noch keine Quelle (Paket F) → „–“. */
function ausbauTable(d, gd, liveAt, now = Date.now()) {
  const pl = empirePlanets(d).filter(p => /^\d+:\d+:\d+$/.test(p.coords || ''));
  if (!pl.length) return '';
  const snapAt = Date.parse(liveAt), gdAt = gd?.at ? Date.parse(gd.at) : NaN, home = d?.start?.coords;
  const useGd = isFinite(gdAt) && (!isFinite(snapAt) || gdAt > snapAt) && Array.isArray(gd.jobs);
  const gdHome = typeof gd?.colony?.coords === 'string' ? gd.colony.coords : home;
  const jobs = useGd ? gd.jobs.filter(j => j && Date.parse(j.end) > now) : [];
  const cnt = (k, c) => jobs.filter(j => j.k === k && (j.coords || gdHome) === c).length;
  const sy = d?.shipyard && !d.shipyard.error ? d.shipyard : null;
  // Umbau 2 U2 (30.10.2026): Die Warteschlange (sy.queue, „Wartender Bauauftrag“) enthält den laufenden Auftrag schon (Collector
  // parseShipyard: „nicht addieren“); vorher +1 für den laufenden → bei einem SCOL in Arbeit stand 2 statt 1.
  const werft = p => {
    if (sy && p.coords === home) return isFinite(snapAt) && sy.total != null && snapAt + sy.total * 1000 <= now ? 0 : Math.max((sy.queue || []).length, sy.remaining > 0 ? 1 : 0);
    return Array.isArray(p.Ausbau) ? p.Ausbau[2] ?? null : null;
  };
  const cell = v => v == null ? '<td class="num muted">–</td>' : `<td class="num${v ? '' : ' muted'}">${v ? `<b>${esc(v)}</b>` : '0'}</td>`;
  const src = useGd ? `Bau/Forschung aus getData ${ago(gdAt)}` : `Bau/Forschung aus Live-Stand ${ago(snapAt)}`;
  const rows = pl.map(p => {
    const a = Array.isArray(p.Ausbau) ? p.Ausbau : [];
    return { p, v: [useGd ? cnt('b', p.coords) : a[0] ?? null, useGd ? cnt('r', p.coords) : a[1] ?? null, werft(p), null] };
  });
  const sum = [0, 1, 2, 3].map(k => rows.some(r => r.v[k] != null) ? rows.reduce((s, r) => s + (+r.v[k] || 0), 0) : null);
  return `<table class="small ausbau" title="${esc(`${src}; Werft aus Live-Stand; Def noch ohne Quelle`)}"><tr class="muted"><td>Planet</td><td class="num">Bau</td><td class="num">Forschung</td><td class="num">Werft</td><td class="num">Def</td></tr>
    ${rows.map(({ p, v }) => `<tr><td>${esc(p.name || p.coords)}</td>${v.map(cell).join('')}</tr>`).join('')}
    ${pl.length > 1 ? `<tr class="sum"><td><b>Summe</b></td>${sum.map(cell).join('')}</tr>` : ''}</table>`;
}
function overviewCard(sess, d, live, abLive, nm, W, extra = '', gd = null) {
  const r = sess.run, h = r && sess.devs.find(x => x.holds), s = h?.ab?.state || {};
  const runTxt = !r ? 'kein Lauf'
    : `<b class="${r.state === 'verloren' ? 'err' : ''}">${esc(RUNST[r.state] || r.state)}</b> bis ${esc(untilTxt(r.until, r.until_by))} · ${esc(r.name || '?')}`
      + (r.state === 'schlaeft' && r.wake_at ? ` · Login ${esc(clockT(r.wake_at))}` : '')
      + (['laeuft', 'schlaeft'].includes(r.state) && driftLagText() ? ` · ${esc(driftLagText())}` : '') + pauseTag(r);
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
    html += `<table class="small"><tr class="muted"><td>${pl.length > 1 ? `Summe aller ${pl.length} Planeten` : 'Rohstoffe'}</td><td class="num">Bestand</td><td class="num">Förderung</td></tr>${rows.map(({ x, now, net, full }) =>
      `<tr><td>${x}${full == null ? '' : `<div class="muted">voll in ${dur(full)}</div>`}</td><td class="num">${fmt(now)}</td><td class="num muted">${net >= 0 ? '+' : ''}${fmt(net)}/h</td></tr>`).join('')}</table>`;
    const col = d.empire?.colony;
    html += `<div class="row small" style="margin:4px 0">${col?.max != null
      ? `<span class="${col.free < 0 ? 'err' : ''}" title="frei ${esc(fmt(col.free, 3))}">Kolopunkte <b>${fmt(col.used, 2)}</b> / ${fmt(col.max, 2)}${col.free < 0 ? ' überzogen' : ''}</span>`
      : '<span class="muted">Kolopunkte: ab Collector 0.4.7</span>'}</div>`;
    html += ausbauTable(d, gd, live.collected_at);
    // Laufende Aufträge (Bau/Forschung des gewählten Planeten) stehen seit Umbau 2 U2 nur noch je Planet (Nutzer 30.10.2026)
  }
  return html + extra + '</div>';
}

/* ---------- Steuerung (früher Notfallzentrale, Paket F3, 13.10.2026; mit den Lauf-Knöpfen zusammengeführt im Cockpit-Umbau PR 4) ----------
   Immer sichtbar, auch ohne freigegebenen Plan (vorher gab es dann keinen Stopp-Knopf). Kommandos gehen an ein Gerät;
   antwortet dort der Autobuilder nicht, führt der Collector (ab 0.4.3) „Neu laden“, „Lage jetzt lesen“ und „Stopp“ selbst
   aus. Faktor-Knöpfe und Kommandoliste stehen seit PR 4 im Atlas (Imperium → Wartung). Nur der Owner sieht die Knöpfe.
   Lauf-Knöpfe (bis #, Probelauf, Start, Stopp, Pause/Weiter, Plan übernehmen) wirken auf das hier gewählte Gerät (#nfDev) und den
   freigegebenen Plan (loadActivePlan); sendCmd und abLimits stehen unten bei den Plänen.
   „Notfall verbauen“ (B7, Autobuilder ab 0.5.18, nur auf Tippen): 2 h lang füllt der Autobuilder jede freie Schlange mit dem
   teuersten startbaren Planschritt der nächsten 25 (auch außer der Reihe, nie Abbrechen); auch am Ereignis „anflug“. */
const HANG_MIN = 10;
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
    : `${s.page === 'login' ? 'ausgeloggt' : 'im Spiel'} · ${s.running ? `${s.mode === 'live' ? 'baut' : 'Probe'} bis ${untilTxt(s.until, s.untilBy)}` : 'angehalten'}`;
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
function steuerungCard(sess, nf, active) {
  const shown = sess.devs.filter(x => x.holds || hbAge(x.last) < 7 * 24 * 60);
  const reach = shown.filter(x => hbAge(x.last) < HANG_MIN);
  S.verTop = {};
  for (const x of shown) for (const k of ['ab', 'col']) if (x[k] && verCmp(x[k].version, S.verTop[k]) > 0) S.verTop[k] = x[k].version;
  const own = isOwner();
  const sel = reach.find(x => x.device === S.nfDev) || reach.find(x => x.holds) || reach.find(x => x.ab?.state?.page === 'game') || reach[0] || null;
  const anyBad = shown.some(x => hbAge(x.last) >= HANG_MIN || hbAge(x.ab?.at) >= 3);
  const plan = active?.payload, run = sess.run, holder = sess.devs.find(x => x.holds);
  let html = `<div class="card${anyBad ? ' warn' : ''}" id="notfall"><div class="row between"><h2>Steuerung</h2><span class="muted small">★ hält den Lauf</span></div>`;
  html += shown.length ? `<table>${shown.map(x => nfDevRow(x, nf)).join('')}</table>` : '<p class="muted">Noch keine Lebenszeichen.</p>';
  const nfx = nfActive(sess);
  if (nfx) {
    const n = nfx.ab.state.notfall;
    html += `<div class="row between small" style="margin:6px 0;gap:6px"><span class="warn"><b>Notfall verbauen aktiv</b> auf ${esc(nfx.name)} bis ${esc(clockT(n.until))}
      · ${esc(n.n || 0)} Schritt(e) vorgezogen${n.why ? ` · <span class="muted">${esc(n.why)}</span>` : ''}</span>${own ? '<button data-nf="notfall-off">Beenden</button>' : ''}</div>`;
  }
  if (own) {
    if (reach.length) {
      html += `<div class="row" style="margin:8px 0;gap:6px"><select id="nfDev" title="Gerät für die Knöpfe">${reach.map(x => `<option value="${esc(x.device)}"${x === sel ? ' selected' : ''}>${x.holds ? '★ ' : ''}${esc(x.name)}</option>`).join('')}</select>
        <button data-nf="snapshot" title="Live-Stand sofort erfassen und hochladen">Lage lesen</button>
        <button data-nf="reload" title="Spiel-Tab neu laden (ein laufender Lauf geht danach weiter)">Neu laden</button></div>`;
      // Lauf: „bis #“ und Start/Stopp für das gewählte Gerät (Autobuilder muss antworten, Plan muss freigegeben sein)
      const st = sel?.ab && isFresh(sel.ab.at) ? sel.ab.state || {} : null;
      if (!plan) html += '<p class="muted small">Kein freigegebener Bauplan – Start erst nach Freigabe unter <a href="#/plaene">Pläne</a>.</p>';
      else if (!st) html += `<p class="muted small">Start/Stopp: Autobuilder auf ${esc(sel?.name || 'dem Gerät')} antwortet nicht.</p>`;
      else if (st.plan !== plan.id) {
        html += st.offered === plan.id
          ? `<p class="warn small">${esc(sel.name)} arbeitet noch mit ${esc(planLabel(st.plan))}, nicht mit dem freigegebenen Plan.</p>
             <div class="row" style="margin:6px 0"><button class="primary" data-cmd="adopt"${st.running ? ' disabled title="erst stoppen"' : ''}>Plan auf ${esc(sel.name)} übernehmen</button></div>`
          : '<p class="muted small">Der Collector bietet den Plan beim nächsten Abgleich an (bis 1 min).</p>';
      } else {
        // M8: „bis #“ gilt im gewählten Plan-Reiter (eigene Grenze, „wie Alle“ löscht sie), im Reiter Alle für alle übrigen
        const L = abLimits(plan, st, run), g = abGrp(plan);
        html += `<div class="row" style="margin:8px 0;gap:6px">bis #${g ? ` <span class="muted">(${esc(grpName(plan, g))})</span>` : ''} <input id="abUntil" type="number" min="1" max="${plan.steps.length}" value="${esc(g ? L.by[g] ?? L.until : L.until)}" style="width:4.5em">
          ${g && L.by[g] != null ? '<button id="abAsAll" title="Grenze dieses Reiters löschen, es gilt wieder „bis #“ von Alle">wie Alle</button> ' : ''}<button data-cmd="dry">Probelauf</button> <button class="primary" data-cmd="live">Start</button> <button class="danger" data-cmd="stop">Stopp</button></div>
          ${Object.keys(L.by).length ? `<div class="small" style="margin:-4px 0 4px">Start bis ${esc(untilTxt(L.until, L.by, plan))}</div>` : ''}
          <div class="muted small" id="abStep"></div>`;
      }
    } else html += '<p class="err small">Kein Gerät erreichbar – Browser bzw. PC prüfen.</p>';
    // B13: Pause/Weiter an den Halter des Laufs (Autobuilder ab 0.5.19)
    let pw = '';
    if (plan && run && ['laeuft', 'schlaeft'].includes(run.state) && holder) {
      pw = run.paused_at
        ? (holder.ab?.state?.hand ? '<button class="primary" data-cmd="weiter_ok">Von Hand übernehmen und weiter</button>' : '<button class="primary" data-cmd="weiter">Weiter</button>')
        : '<button data-cmd="pause" title="Der Autobuilder startet nichts, loggt nicht aus/ein; der Lauf bleibt angemeldet">Pause</button>';
    }
    html += `<div class="row" style="margin:8px 0;gap:6px">${pw}<button class="danger" id="nfStopAll" title="Stopp an alle Geräte">Alles anhalten</button>${reach.length
      ? '<button class="danger" data-nf="notfall" title="2 h lang freie Baustelle/Forschung sofort mit dem teuersten startbaren Planschritt (nächste 25) füllen – Rohstoffe vor einem Angriff verbauen">Notfall verbauen</button>' : ''}</div>`;
  }
  return html + '</div>';
}
function bindSteuerung(sess, nf, active) {
  const v = $('#view');
  if (!v.querySelector('#notfall')) return;
  devPlans(sess, nf).then(() => {   // Plan-Hinweise nachladen (kleine Abfrage), ohne die Seite neu aufzubauen
    const box = v.querySelector('#notfall table');
    const shown = sess.devs.filter(x => x.holds || hbAge(x.last) < 7 * 24 * 60);
    if (box && Object.keys(nf.known).length) box.innerHTML = shown.map(x => nfDevRow(x, nf)).join('');
  }).catch(() => { });
  $('#nfDev')?.addEventListener('change', e => { S.nfDev = e.target.value; route(true); });   // „bis #“ und Plan-Hinweis hängen am Gerät
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
    if (cmd === 'notfall-off') {
      const x = nfActive(sess);
      if (!x || !confirm(`Notfall verbauen auf ${x.name} beenden?`)) return;
      return sendNotfall(x, { off: true });
    }
    if (cmd === 'notfall') return confirm(NF_ASK(dev.name)) && sendNotfall(dev, { hours: 2 });
    if (!confirm({ reload: `Spiel-Tab auf ${dev.name} neu laden?`, snapshot: `Live-Stand auf ${dev.name} jetzt lesen?` }[cmd])) return;
    try {
      await postCmd(dev, cmd, {});
      toast(`Kommando an ${dev.name} gesendet – Ergebnis in 15–60 s`);
      setTimeout(() => route(true), 1500);
    } catch (e) { toast(e.message); }
  }));
  // Lauf-Knöpfe (Start, Probelauf, Stopp, Pause, Weiter, Plan übernehmen) und „bis #“ (gemeinsamer Zustand S.abSel)
  if (!active) return;
  v.querySelectorAll('button[data-cmd]').forEach(b => b.addEventListener('click', () => sendCmd(active, b.dataset.cmd, sess)));
  const dev = () => $('#nfDev')?.value;
  const stepTxt = () => { const n = +$('#abUntil').value, st = active.payload.steps?.[n - 1]; return st ? `#${n}: ${st[5]}` : ''; };
  $('#abAsAll')?.addEventListener('click', () => {
    const plan = active.payload, by = { ...abLimits(plan, sess.devs.find(x => x.device === dev())?.ab?.state || {}, sess.run).by };
    delete by[abGrp(plan)]; S.abSel = { ...S.abSel, by }; route(true);
  });
  if ($('#abUntil')) {
    $('#abUntil').addEventListener('input', () => { setBis(active, sess, +$('#abUntil').value, dev()); $('#abStep').textContent = stepTxt(); });
    $('#abStep').textContent = stepTxt();
  }
}

// Notfall verbauen: Gerät mit offenem Fenster (nfTarget, NF_ASK, sendNotfall, anflugNotfall stehen in common.js)
const nfActive = sess => sess.devs.find(x => x.ab && isFresh(x.ab.at, 10) && x.ab.state?.notfall?.until > Date.now()) || null;

/* ---------- Werbebanner (Autobuilder ab 0.5.1) ----------
   Der Autobuilder meldet aktive Banner im Lebenszeichen; aufgerufen werden sie nur per Kommando „banner“ nach Tippen des Owners. */
const bannerDev = sess => sess.devs.find(x => x.ab && isFresh(x.ab.at) && x.ab.state?.page === 'game' && x.ab.state?.banner?.n);
// Ab Autobuilder 0.5.20 (Freigabe Nutzer 15.10.2026): Ist kein Gerät eingeloggt und die Banner sind fällig, loggt ein ausgeloggtes
// Gerät nach Tippen und Bestätigen einmal ein, ruft die Banner auf und loggt ohne Lauf wieder aus. Bevorzugt das Gerät mit dem Lauf.
// Schläft ein Lauf: ab Autobuilder 0.5.46 (Nutzer 18.10.2026) loggt das Gerät mit dem Lauf trotzdem ein, ruft die Banner auf
// und schläft danach bis zur alten Weckzeit weiter (wie beim Login für eine Antwort). Ältere Autobuilder lehnen das ab („Auto-
// Login des Laufs steht an“) – dann bleibt nur der Hinweis auf die Weckzeit. Ein anderes ausgeloggtes Gerät nie: Der Login
// würde den Lauf stören (der Autobuilder lehnt ihn ebenfalls ab).
const BANNER_SLEEP_VER = '0.5.46';
const bannerSleep = sess => {
  const r = sess.run, d = sess.devs.find(x => x.ab && isFresh(x.ab.at) && x.ab.state?.sleeping);
  if (r?.state !== 'schlaeft' && !d) return null;
  return { wake: (r?.state === 'schlaeft' && r.wake_at) || d?.ab.state.wakeAt || null, name: r?.name || d?.name || null };
};
const bannerLoginDev = sess => {
  const live = sess.devs.filter(x => x.ab && isFresh(x.ab.at));
  if (live.some(x => x.ab.state?.page === 'game')) return null;
  const out = live.filter(x => x.ab.state?.page === 'login');
  if (!bannerSleep(sess)) return out.find(x => x.holds) || out[0] || null;
  const own = out.find(x => x.holds) || out.find(x => x.ab.state?.sleeping);   // holds = Gerät des Laufs
  return own && verCmp(own.ab.version, BANNER_SLEEP_VER) >= 0 ? own : null;
};
const bannerDue = sess => Math.max(0, ...sess.devs.filter(d => d.ab && isFresh(d.ab.at, 24 * 60)).map(d => +d.ab.state?.bannerDue || 0));
const bannerLoginNow = sess => { const due = bannerDue(sess); return due && due < Date.now() + 15 * 60e3 ? bannerLoginDev(sess) : null; };
// Nur sichtbar, wenn etwas zu tun ist: offene Votes (Knopf „Banner jetzt öffnen“) oder ein Login-Knopf für fällige Banner (Owner).
// Reine Info „Nächste erwartet ab …“ ohne Knopf gibt keine Karte mehr (Cockpit-Umbau PR 4, Banner steht oben in der Lage).
function bannerCard(sess) {
  const x = bannerDev(sess), b = x?.ab.state.banner;
  if (!b) {
    const due = bannerDue(sess), lx = bannerLoginNow(sess), zz = due && due < Date.now() + 15 * 60e3 ? bannerSleep(sess) : null;
    if (!due || !lx || !isOwner()) return '';
    return `<div class="card"><div class="row between"><h2>Werbebanner</h2><span class="muted small">${zz ? 'Lauf schläft' : 'Gerät ausgeloggt'}</span></div>
      <p class="small">Fällig ${due < Date.now() ? 'seit' : 'ab'} <b>${esc(clockT(due))}</b> (${due > Date.now() ? `in ${esc(dur((due - Date.now()) / 1000))}` : esc(ago(due))}).
      ${esc(lx.name)} ist ausgeloggt: Der Autobuilder loggt dafür einmal ein, ruft die Banner auf und loggt wieder aus${zz ? `; der schlafende Lauf schläft danach bis ${zz.wake ? `<b>${esc(clockT(zz.wake))}</b>` : 'zu seiner Weckzeit'} weiter` : ''}.</p>
      <div class="row" style="margin-top:6px"><button class="primary" id="bannerGo">Einloggen und Banner öffnen</button></div></div>`;
  }
  return `<div class="card"><div class="row between"><h2>Werbebanner</h2><span class="muted small">seit ${esc(when(b.since))}</span></div>
    <p>${esc(b.n)} von 3 Votes offen auf <b>${esc(x.name)}</b></p><div class="small">${(b.slots || []).map(s => `Vote ${esc(s.slot)}: ${esc(s.host || 'Ziel unbekannt')}`).join('<br>')}</div>
    ${(b.slots || []).some(s => s.url || s.href || s.src) ? `<details class="sub"><summary class="small muted">Details</summary><div class="small muted wrapall">${(b.slots || []).map(s => esc(s.url || s.href || s.src || '')).join('<br>')}</div></details>` : ''}
    ${isOwner() ? '<div class="row" style="margin-top:6px"><button class="primary" id="bannerGo">Banner jetzt öffnen</button></div>' : ''}</div>`;
}
/* Motivationsvideo (Autobuilder 0.5.53): nur Hinweis, abspielen darf nur der Nutzer (im Spiel oder über die Entscheidung unter
   Meldungen). Läuft ein Video, zeigt die Karte das (Lebenszeichen movi). Sonst bei offenem Video: lohnt, wenn Baustelle und
   Forschung mit langen Aufträgen belegt sind (Simulation PR 374: Gewinn vor allem aus Aufträgen im Video-Fenster) und ein
   Live-Lauf mit Autobuilder ab 0.5.53 die verkürzten Restzeiten sofort nachlegt. Werft sieht die Lage hier nicht. */
const MOVI_VER = '0.5.53', MOVI_LONG = 2 * 3600e3;
function moviCard(sess, abLive, movis) {
  const on = sess.devs.map(x => x.ab && isFresh(x.ab.at, 10) && x.ab.state?.movi).find(m => m && m.until > Date.now());
  if (on) return `<div class="card"><div class="row between"><h2>Motivationsvideo</h2><span class="muted small">läuft</span></div>
    <p class="small">Erkannt seit <b>${esc(clockT(on.from))}</b>${on.f ? ` (Tempo ≈ ×${esc(on.f)})` : ''}, gilt bis <b>${esc(clockT(on.until))}</b>. Der Autobuilder prüft alle 20 s, legt sofort nach und loggt nicht aus.</p></div>`;
  const v = movis[0];
  if (!v) return '';
  const jobs = abLive?.jobs || [], left = k => Math.max(0, ...jobs.filter(j => j.k === k).map(j => j.end - Date.now()));
  const b = left('b'), r = left('r'), long = [b, r].filter(x => x >= MOVI_LONG).length;
  const run = sess.devs.find(x => x.ab && isFresh(x.ab.at, 10) && x.ab.state?.running && x.ab.state?.mode === 'live');
  const runOk = run && verCmp(run.ab.version, MOVI_VER) >= 0 && !run.ab.state.pausedAt;
  const verdict = long === 2 && runOk ? 'lohnt jetzt' : long ? 'lohnt teilweise' : 'lohnt noch nicht';
  const q = (k, x) => x > 0 ? `${k} noch ${esc(dur(x / 1000))}` : `${k} frei`;
  return `<div class="card"><div class="row between"><h2>Motivationsvideo</h2><span class="muted small">${verdict}</span></div>
    <p class="small">Video verfügbar seit ${esc(dt(v.t))}, verfällt ${esc(dt(new Date(v.t).getTime() + 14 * 86400e3))}. Lage: ${q('Baustelle', b)}, ${q('Forschung', r)} (Werft hier nicht sichtbar).</p>
    <p class="small">${runOk ? 'Live-Lauf aktiv – der Autobuilder erkennt das Video und legt im Fenster sofort nach.'
      : run ? `Live-Lauf ohne Nachlegen im Video (${run.ab.state.pausedAt ? 'pausiert' : `Autobuilder ${esc(run.ab.version)}, nötig ab ${MOVI_VER}`}).` : 'Kein Live-Lauf – im Video-Fenster startet niemand neue Aufträge.'}
    Am meisten bringt es, wenn Baustelle und Forschung lange Aufträge haben (ab ${MOVI_LONG / 3600e3} h). Abspielen nur von Hand: im Spiel oder unter Meldungen.</p></div>`;
}
async function sendBanner(sess) {
  const x = bannerDev(sess) || bannerLoginNow(sess), login = x && !bannerDev(sess);
  if (!x) return toast('Kein Gerät mit aktiven Bannern erreichbar');
  const zz = login && bannerSleep(sess);
  if (!confirm(login ? `${x.name} ist ausgeloggt. Jetzt einmal einloggen, die Banner aufrufen und danach wieder ausloggen?${zz ? `\nDer schlafende Lauf schläft danach bis ${zz.wake ? clockT(zz.wake) : 'zu seiner Weckzeit'} weiter.` : ''}\n\nEin Spiel auf einem anderen Gerät wird dabei abgemeldet.`
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
  $('#view').innerHTML = `<div class="card"><div class="row between"><a href="details/#/ereignisse" target="_blank" rel="noopener">Alle Ereignisse mit Filter im Atlas →</a>
      ${canSee ? '<button id="seenAll">alle gesehen</button>' : ''}</div>${canSee ? '<p class="muted small">Nach rechts wischen oder ✕ = ausblenden.</p>' : ''}</div>`
    + (open.length ? `<div class="card warn small"><a href="#/steuerung">${open.length} offene Entscheidung${open.length > 1 ? 'en' : ''} – zur Steuerung →</a></div>` : '')
    + sec('Stufe „hoch“', high.filter(e => !open.includes(e)), 'Keine.')
    + sec('Plan und Lauf <span class="muted small">ungesehen</span>', plan.filter(e => !open.includes(e)), 'Nichts Neues.');
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
// „bis“ für den Start: gemeinsames until und eigene Reiter-Grenzen by {Gruppe: Nummer} (nur abweichende). Ohne Eingabe im
// Cockpit (S.abSel.by) der Stand des Autobuilders (Lebenszeichen untilBy, ab 0.5.65), sonst der des Laufs.
function abLimits(plan, st, run) {
  const until = S.abSel?.until || st.until || run?.until || 10;
  const src = S.abSel?.by || (st.plan === plan.id ? st.untilBy : null) || run?.until_by || {};
  const gs = planGroups(plan);
  return { until, by: Object.fromEntries(Object.entries(src).filter(([g, n]) => gs.includes(g) && Number.isInteger(n) && (S.abSel?.by || n !== until))) };
}
// Zielgerät für Plan-Zustand und „bis #“: gewähltes (S.nfDev, Steuerung), sonst Lauf-Halter (wenn erreichbar), sonst eingeloggtes, sonst erstes erreichbares
function abTarget(sess) {
  const live = sess.devs.filter(x => x.ab && isFresh(x.ab.at));
  const holder = sess.devs.find(x => x.holds);
  return live.find(x => x.device === S.nfDev) || (holder && live.includes(holder) && holder)
    || live.find(x => x.ab.state.page === 'game') || live[0] || null;
}
// M8: Reiter-Gruppe, für die „bis #“ gilt (null = Alle bzw. nur ein Planet)
const abGrp = plan => planMulti(plan) ? tabGrp(planTabCur(planTabs(plan, S.home))) : null;
// „bis #n“ wählen (gemeinsamer Zustand S.abSel, Lage und Pläne): im Reiter einer Gruppe deren Grenze (alle bisherigen Grenzen werden dabei
// zur eigenen Auswahl), sonst until. dev = Gerätekennung (Auswahl in der Lage), sonst abTarget. Liefert den Planschritt oder null.
function setBis(active, sess, n, dev) {
  const plan = active?.payload, step = plan?.steps?.[n - 1];
  if (!step) return null;
  const g = abGrp(plan), st = sess.devs.find(x => x.device === dev)?.ab?.state || abTarget(sess)?.ab?.state || {};
  const base = abLimits(plan, st, sess.run);
  S.abSel = g ? { ...S.abSel, by: { ...base.by, [g]: n } } : { ...S.abSel, until: n, by: S.abSel?.by || base.by };
  return step;
}
// Plan-Kopf (PR 6, 25.10.2026): ein Plan, Status, „bis #“, Lauf, eine Abweichungszeile. Die Schrittlisten stehen in den Planeten-Karten (planetKarte, common.js).
function planKopfCard(active, sess, own, drift, hst) {
  if (!active) return `<div class="card"><h2>Plan</h2>${runBody(sess, { drift: false })}
    <p class="muted small">Kein freigegebener Bauplan. Erst einen Entwurf freigeben. Anhalten, Neu laden und Start gehen unter <a href="#/steuerung">Steuerung</a>.</p></div>`;
  const plan = active.payload;
  return `<div class="card"><div class="row between"><h2>${esc(planLabel(active.id))}</h2><span class="tag ${esc(active.status)}">${esc(active.status)}</span></div>
    <p class="small">${esc(tidy(active.title))}${plan ? ` · bis <b>${esc(hst.until ? untilTxt(hst.until, hst.untilBy, plan) : '#–')}</b>` : ''}</p>
    ${runBody(sess, { drift: false })}${driftLine(drift)}
    <div class="row between small"><a href="#/steuerung">Start/Stopp unter Steuerung</a>${own && active.plan_hash ? `<a href="details/#/plaene/edit/${esc(active.id)}" target="_blank" rel="noopener">Plan ändern (Atlas) →</a>` : ''}</div>
    ${own ? `<div class="row" style="margin-top:6px"><button class="danger" data-act="abgebrochen" data-id="${esc(active.id)}">Plan abbrechen</button></div>` : ''}</div>`;
}

// „Letzte Kommandos“ (cmdTable, watchCmds) stehen seit PR 4 in common.js und nur noch im Atlas (Imperium → Wartung).

async function sendCmd(active, cmd, sess) {
  const plan = active.payload;
  const live = sess.devs.filter(x => x.ab && isFresh(x.ab.at));
  // Stopp geht an den Halter eines laufenden Laufs, sonst an das gewählte Gerät
  const holder = sess.devs.find(x => x.holds && ['laeuft', 'schlaeft', 'verloren'].includes(sess.run?.state));
  const PAUSE = ['pause', 'weiter', 'weiter_ok'];
  const tgt = (cmd === 'stop' || PAUSE.includes(cmd)) && holder ? holder : PAUSE.includes(cmd) ? null : live.find(x => x.device === $('#nfDev')?.value);
  if (!tgt) return toast('Kein Gerät erreichbar');
  // M8: eigene Reiter-Grenzen → untilBy mit allen Gruppen (null = alle wie until, löscht alte Reiter-Grenzen). Ein Autobuilder
  // vor 0.5.65 kennt untilBy nicht: Er bekommt als until die kleinste Grenze (hält eher zu früh als zu spät).
  const L = abLimits(plan, tgt.ab?.state || {}, sess.run), byOn = Object.keys(L.by).length > 0;
  const full = byOn ? Object.fromEntries(planGroups(plan).map(g => [g, L.by[g] ?? L.until])) : null;
  const newAb = verGe(tgt.ab?.state?.v, '0.5.65');
  const until = byOn && !newAb ? Math.min(...Object.values(full)) : L.until;
  const step = plan.steps[until - 1];
  const args = cmd === 'stop' || cmd === 'pause' || cmd === 'weiter' ? {} : cmd === 'weiter_ok' ? { accept: true } : cmd === 'adopt' ? { plan: plan.id }
    : { mode: cmd, until, plan: plan.id, ...(newAb ? { untilBy: full } : {}) };
  const login = tgt.ab?.state?.page === 'login';
  if (cmd === 'live' || cmd === 'dry') {
    if (!step || (full && Object.values(full).some(n => !plan.steps[n - 1]))) return toast(`„bis #“ zwischen 1 und ${plan.steps.length}`);
    if (byOn && !newAb && !confirm(`${tgt.name} hat Autobuilder ${tgt.ab?.state?.v || '?'} und kennt kein „bis“ je Reiter – er läuft für alle Reiter nur bis #${until}. Trotzdem?`)) return;
    // B11: Ein Probelauf darf keinen Live-Lauf eines anderen Geräts übernehmen (Autobuilder ab 0.5.16 und ab_sync lehnen ab)
    const r = sess.run;
    if (cmd === 'dry' && r && r.mode === 'live' && ['laeuft', 'schlaeft', 'verloren'].includes(r.state) && r.device !== tgt.device)
      return alert(`Probelauf auf ${tgt.name} nicht möglich: Der Live-Lauf bis #${r.until ?? '?'} liegt bei ${r.name || 'einem anderen Gerät'} (${RUNST[r.state] || r.state}).\n`
        + `Ein Probelauf würde ihn übernehmen und dort anhalten. Erst den Live-Lauf stoppen oder den Probelauf auf ${r.name || 'diesem Gerät'} starten.`);
    if (!confirm(`${cmd === 'live' ? 'LIVE-Start' : 'Probelauf'} bis ${byOn && newAb ? untilTxt(until, L.by, plan) : `#${until}`} (${step[5]}) auf ${tgt.name}?`
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
// das Ziel mindestens PLAN_GAIN_MIN_PCT % früher erreicht als der aktive Plan (B1 29.10.2026, Zeit bis zum Ziel; Rückfall ohne Zielzeit:
// SCOL mehr als PLAN_GAIN_MIN h früher) – verglichen mit dessen erwartetem Ende laut Live-Stand
// (Planstart + hours + Startverzug + Rückstand bzw. − Vorlauf aus plan_abweichung, B4). Schlechtere Entwürfe sind ausgeblendet
// (push_plan.py legt solche seit B14 gar nicht mehr an); eigene Entwürfe (source user, „Planschritte ändern“) bleiben sichtbar.
function newPlanOffer(plans, active, gains) {
  const draft = plans.find(p => p.kind === 'build' && p.status === 'entwurf' && p.source !== 'user' && gains[p.id]?.better);
  if (!draft) return null;
  const g = gains[draft.id];
  if (!g.agreed && !gainOk(g) && active) return null;
  return { draft, ...g };
}
function newPlanCard(o, own) {
  if (!o) return '';
  const why = [o.agreed ? 'mit Claude im Chat abgestimmt' : '', gainText(o)].filter(Boolean).join(' · ');
  return `<div class="card warn"><div class="row between"><h2>Neuer Plan verfügbar – starten?</h2><span class="muted small">${esc(when(o.draft.created_at))}</span></div>
    <p><b>${esc(planLabel(o.draft.id))}</b> · ${esc(tidy(o.draft.title || ''))}${o.end ? ` · SCOL ca. ${esc(dt(o.end))}` : ''}</p>${why ? `<p class="small">${esc(why)}</p>` : ''}
    ${planTeilHtml(o.teil)}${planDetails(o.draft)}
    ${own ? `<div class="row" style="margin-top:6px"><button class="primary" id="npGo">Freigeben</button><button id="npNo">Verwerfen</button></div>
      <p class="muted small">Gestartet wird danach wie gewohnt in der Steuerung („bis #“ neu wählen, neue Schrittnummern).</p>` : ''}</div>`;
}
// takeNewPlan (Freigeben + Übernehmen anbieten) steht seit 27.10.2026 in common.js, der Atlas nutzt es auch

/* ---------- Planabweichung (B4, 14.10.) ----------
   public.plan_abweichung rechnet je Schritt Plan-Start gegen echten Start (executions) und überfällige offene Schritte;
   der Startverzug (erster Start nach dem Planstart, weil der Plan ab seinem Snapshot rechnet) ist abgezogen. Der Wächter in
   Supabase meldet ab 2 h Rückstand „mittel“ (je weitere 2 h erneut) mit dem Angebot, neu zu planen. */
// Im Cockpit nur der Rückstand als Zahl in einer Zeile (Plan-Kopf), dazu ein überfälliger Schritt; Grafik im Atlas
function driftLine(d) {
  if (!d) return '';
  const atlas = '<a href="details/#/plaene" target="_blank" rel="noopener">Grafik im Atlas</a>';
  if (d.lag == null) return `<p class="small muted">Abweichung: noch kein Schritt gestartet · ${atlas}</p>`;
  const cls = d.lag >= d.limit ? 'err' : d.lag >= 1 ? 'warn' : 'ok';
  return `<p class="small">Abweichung: <b class="${cls}">${esc(lagText(d.lag))}</b>${d.due?.lag > 0 ? ` · überfällig #${esc(d.due.n)}` : ''} · ${atlas}</p>`;
}

/* ---------- Pläne (PR 6, 25.10.2026) ----------
   Aufbau: Angebot „Neuer Plan“ (nur wenn besser) · Plan-Kopf (Status, „bis #“, Lauf, Abweichung) · je Planet eine Karte
   (Bau/Forschung/Werft in Realzeit, nächste Planschritte, letzte Schritte; planetKarte mit opts.plan) · Entwürfe (der neueste je Art).
   „bis #“ ist hier global (Tipp auf einen Schritt, Start unter Steuerung); Reiter je Planet gibt es im Cockpit nicht mehr. */
async function viewPlans(rest = []) {
  // Plan-Editor seit C1 nur im Atlas; alte Links (#/plaene/edit/<id>) dorthin umleiten
  if (rest[0] === 'edit' && rest[1]) { location.replace(`details/#/plaene/edit/${encodeURIComponent(rest[1])}`); return; }
  const acc = `eq.${S.acc}`;
  let [plans, heads, sess, W, lives, gds, effs, effEnds] = await Promise.all([
    Cloud.q('plans', { account_id: acc, order: 'created_at.desc', limit: 30,
      select: 'id,kind,source,status,title,note,plan_hash,parent_id,created_at,approved_at,status_at' }),
    Cloud.q('plans', { account_id: acc, kind: 'eq.build', status: 'in.(freigegeben,aktiv)', order: 'approved_at.desc.nullslast', limit: 1,
      select: 'id,status,title,plan_hash' }),
    loadSessions(),
    loadWissen().catch(() => null),
    Cloud.q('state_latest', { account_id: acc, kind: 'eq.live', select: 'kind,collected_at,version' }).catch(() => []),
    Cloud.q('getdata_state', { account_id: acc, select: 'at,colony,colonies,queues,jobs,wake,expires_at,ok_at,error,error_at' }).catch(() => []),
    ...loadEffects(acc),
  ]);
  await ensureSnap(lives[0]).catch(() => {});
  const d = lives[0] ? S.snap?.data : null;
  if (S.home?.acc !== S.acc) { const st = d?.start; S.home = { acc: S.acc, name: st?.planet || '', coords: st?.coords || '' }; }
  if (plans.some(p => !planNo(p.id))) await loadNums(true);   // neuer Plan seit dem letzten Zählen
  // Plan-Inhalt (bis ca. 30 KB) nur einmal je Plan laden
  const head = heads[0];
  if (head && S.planCache?.id !== head.id) S.planCache = { id: head.id, payload: (await Cloud.q('plans', { id: `eq.${head.id}`, select: 'payload' }))[0]?.payload };
  const active = head ? { ...head, payload: S.planCache.payload } : null;
  const plan = active?.payload && Array.isArray(active.payload.steps) ? active.payload : null;
  const pl = empirePlanets(d).filter(p => /^\d+:\d+:\d+$/.test(p.coords || ''));
  // Abweichung: ein Ladeweg (loadDrift → S.drift); gilt nur, wenn der Server denselben Plan meint wie die Ansicht
  const [execs, drift0] = await Promise.all([
    plan ? loadPlanExecs(acc, active.id, plan) : [],
    loadDrift(true),
  ]);
  const drift = drift0?.plan === active?.id ? drift0 : null;
  // B14: nur bessere Entwürfe zeigen (Karte und Liste); Gewinn gegen das erwartete Ende des aktiven Plans
  const gains = await draftGains(plans, active, drift).catch(() => ({}));
  const offer = newPlanOffer(plans, active, gains);
  const hidden = plans.filter(p => gains[p.id] && !gains[p.id].better);
  plans = plans.filter(p => !hidden.includes(p));
  const own = isOwner();
  // Stand des Autobuilders für diesen Plan (Lauf-Halter bevorzugt), Erledigt-Logik und Live-Zeitplan
  let hst = {}, planCards = '', askCtx = {};
  if (plan) {
    const holder = sess.devs.find(x => x.holds), st = abTarget(sess)?.ab?.state || {};
    const h0 = (holder?.ab?.state?.plan === plan.id ? holder.ab.state : null) || (st.plan === plan.id ? st : {});
    // Haltepunkte inkl. vom Vorplan übernommener (Lebenszeichen halts, ab 0.5.65)
    hst = { ...h0, halts: Array.isArray(h0.halts) ? h0.halts.filter(Number.isInteger) : [] };
    const LT = planLive(plan, planStepDone(plan, hst, execs), execs, hst);
    const gd = gds[0] || null, home = planHomeCoords(plan, gd, pl[0]?.coords), cur = d?.start?.coords;
    const by = feedByPlanet(plan, planFeed(plan, execs, sess, gd), home, pl);
    askCtx = Object.fromEntries(pl.map(p => [p.coords, askPlanetPayload(p, by[p.coords], active.id, plan.steps)]));
    const effByPl = planetEffects(effs, effEnds);
    planCards = pl.map(p => planetKarte(p, by[p.coords], { research: by[p.coords].some(r => r.q === 'r'), effects: effByPl[p.coords],
      steps: plan.steps, current: p.coords === cur, plan: { plan, st: hst, execs, W, LT, home } })).join('');
  }
  // B15: je Art nur der neueste Entwurf (der angebotene steht schon oben im Angebot); ältere Pläne und Löschen im Atlas
  const kinds = new Set(), list = [];   // plans ist nach created_at absteigend sortiert
  for (const p of plans) if (p.status === 'entwurf' && !kinds.has(p.kind)) { kinds.add(p.kind); if (p.id !== offer?.draft.id) list.push(p); }
  const old = plans.filter(p => p.id !== active?.id && p.id !== offer?.draft.id && !list.includes(p));
  const item = p => `<div class="list-item"><div class="row between">
      <span><b>${esc(planLabel(p.id))}</b> <span class="tag">${esc(KIND[p.kind] || p.kind)}</span></span><span class="muted small">${esc(when(p.created_at))}</span></div>
      <div class="small">${esc(tidy(p.title || '(ohne Titel)'))}</div>
      ${gainText(gains[p.id]) ? `<div class="small ${gainOk(gains[p.id]) ? 'ok' : ''}">Gegen den aktiven Plan: ${esc(gainText(gains[p.id]))}</div>` : ''}
      ${planTeilHtml(gains[p.id]?.teil)}${planDetails(p)}
      ${own ? `<div class="row" style="margin-top:6px"><button class="primary" data-act="freigegeben" data-id="${esc(p.id)}">Freigeben</button>
        <button data-act="verworfen" data-id="${esc(p.id)}">Verwerfen</button></div>` : ''}
    </div>`;
  $('#view').innerHTML = (offer ? `<div class="card warn small"><a href="#/steuerung">Neuer Plan verfügbar: ${esc(planLabel(offer.draft.id))} – Freigabe in der Steuerung →</a></div>` : '') + planKopfCard(active, sess, own, drift, hst) + (plan && !pl.length ? '<p class="small muted pad">Noch keine Planetendaten (Live-Stand fehlt).</p>' : planCards)
    + `<div class="card"><h2>Entwürfe</h2>${list.length ? list.map(item).join('') : `<p class="muted small">Kein offener Entwurf.${hidden.length ? ` (${hidden.length} schlechtere ausgeblendet)` : ''}</p>`}
    <p class="small"><a href="details/#/plaene" target="_blank" rel="noopener">${old.length ? `Ältere Pläne (${old.length}) und Löschen` : 'Alle Pläne'} im Atlas →</a></p></div>`;
  bindAsk($('#view'), c => askCtx[c]);
  $('#view').querySelectorAll('button[data-act]').forEach(b => b.addEventListener('click', async () => {
    const act = b.dataset.act, p = plans.find(x => x.id === b.dataset.id);
    if (act === 'freigegeben' && p?.kind === 'build') return takeNewPlan({ draft: p, teil: gains[p.id]?.teil }, sess);   // F4: danach direkt übernehmen
    const q = { freigegeben: 'Plan freigeben? Die Skripte dürfen ihn danach ausführen (Start nur per Kommando).',
      verworfen: 'Entwurf verwerfen?', abgebrochen: 'Plan abbrechen? Laufende Skripte halten an.' }[act];
    if (!confirm(q)) return;
    try { await Cloud.rpc('plan_status', { p_id: b.dataset.id, p_status: act }); toast('Gespeichert'); route(); }
    catch (e) { toast(e.message); }
  }));
  // Tipp auf einen Planschritt = „bis #“ (gemeinsamer Zustand S.abSel); gestartet wird im Reiter Steuerung
  if (own && plan) {
    $('#view').querySelectorAll('tr.step').forEach(r => r.addEventListener('click', () => {
      const n = +r.dataset.i, st = setBis(active, sess, n);
      if (st) toast(`bis #${n} gewählt (${st[5]}) – Start unter Steuerung`);
    }));
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

/* ---------- Transporte (Nutzer 25.10.2026) ----------
   Takt-Flüge des aktiven Plans (payload.transporte, cockpit/transporte.js) mit Realzeit wie die Bauschritte (Planstart + Abweichung).
   Der Nutzer fliegt von Hand und hakt ab (RPC transport_haken_setzen, nur Owner). Offene zuerst, abgehakte zugeklappt darunter. */
const TR_ST = { faellig: ['fällig', 'warn'], naechster: ['als Nächstes', 'ok'], spaeter: ['', ''], geflogen: ['geflogen', 'muted'] };
// Reiter Transport: oben Transportaufträge (Formular + Liste), darunter die Takt-Flüge des aktiven Plans
async function viewTransporte() {
  const [ap, d, heads, auf, sperre] = await Promise.all([loadActivePlan(), loadDrift(true),
    Cloud.q('state_latest', { account_id: `eq.${S.acc}`, kind: 'eq.live', select: 'kind,collected_at,version' }).catch(() => []),
    Cloud.q('transport_auftraege', { account_id: `eq.${S.acc}`, order: 'created_at.desc', limit: 30,
      select: 'id,von,nach,menge,flotte,status,geliefert,fluege,meldung,created_at,updated_at,done_at,plan_id,plan_nr,plan_nrs,einmal' }).catch(() => null),
    Cloud.q('flotten_sperre', { account_id: `eq.${S.acc}`, select: 'name' }).catch(() => null)]);
  await ensureSnap(heads[0]).catch(() => {});
  const snap = heads[0] ? S.snap?.data : null;
  $('#view').innerHTML = `<div class="stack">${isOwner() ? auftragFormCard(snap, heads[0]) : ''}${auftragListCard(auf, snap, ap?.row?.id)}${flottenCard(snap, sperre)}${await planTransportCard(ap, d)}</div>`;
  if (isOwner()) bindAuftragForm(snap);
  $('#view').querySelectorAll('button[data-fsperre]').forEach(b => b.addEventListener('click', async () => {
    const name = b.dataset.fsperre, on = !!b.dataset.on;
    if (!confirm(on ? `Flotte „${name}“ für Transporte sperren? Der Autobuilder nimmt sie ab dem nächsten Abgleich (≈ 1 min) nicht mehr.`
      : `Flotte „${name}“ für Transporte freigeben?`)) return;
    try { await Cloud.rpc('flotte_sperren', { p_account: S.acc, p_name: name, p_on: on }); toast(on ? 'Gesperrt' : 'Freigegeben'); route(true); } catch (e) { toast(e.message); }
  }));
  $('#view').querySelectorAll('button[data-tr]').forEach(b => b.addEventListener('click', async () => {
    try { await Cloud.rpc('transport_haken_setzen', { p_plan: ap.row.id, p_nr: +b.dataset.tr, p_on: !!b.dataset.on }); route(true); } catch (e) { toast(e.message); }
  }));
  $('#view').querySelectorAll('button[data-tauf]').forEach(b => b.addEventListener('click', async () => {
    const x = (ap.payload?.transporte || []).find(t => +t.nr === +b.dataset.tauf);
    if (!x) return toast('Plan-Transport nicht gefunden');
    const pa = await Cloud.q('transport_auftraege', { plan_id: `eq.${ap.row.id}`, select: 'id,plan_nr,plan_nrs,von,nach,status' }).catch(() => []);
    const legs = trPlanLegs(x, pa), nm = c => trName(S.snap?.data, c);
    if (!legs.length) return toast('Schon angelegt');
    if (!confirm(`Plan-Transport #${x.nr} als Auftrag an den Autobuilder?
${legs.map(l => `${nm(l.von)} → ${nm(l.nach)}: ${Transporte.ladungText(l.menge, n => fmt(n))}`).join('\n')}

Der Autobuilder fliegt, sobald er Zeit hat (Bau hat Vorrang, Option „Transporte fliegen“ muss an sein). Sind alle Aufträge erledigt, wird der Transport abgehakt.`)) return;
    try {
      const ids = [];
      for (const l of legs) ids.push(await Cloud.rpc('transport_anlegen', { p_account: S.acc, p_von: l.von, p_nach: l.nach, p_menge: l.menge, p_flotte: null, p_plan: ap.row.id, p_nr: +x.nr }));
      toast(`Auftrag ${ids.map(i => '#' + i).join(', ')} angelegt`); route(true);
    } catch (e) { toast(e.message); route(true); }
  }));
  $('#view').querySelectorAll('button[data-ta]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm(`Transport #${b.dataset.ta} abbrechen? Ein Flug in der Luft landet trotzdem, weitere startet der Autobuilder nicht.`)) return;
    try { await Cloud.rpc('transport_abbrechen', { p_id: +b.dataset.ta }); toast('Abgebrochen'); route(true); } catch (e) { toast(e.message); }
  }));
}

/* Flotten (Punkt 6.2, Nutzer 29.10.2026): was der Autobuilder beim Fliegen gesehen hat (snapshot.flotten, AB ab 0.7.9: Transportformular
   je Planet und Flottenstatus der Startseite, kein eigener Abruf) und je Flottenname „Für Transporte sperren/freigeben“ (Tabelle
   flotten_sperre, RPC flotte_sperren, nur Owner). Wirkt sofort; nicht eingetragen = frei, Flotten ohne Laderaum fliegen ohnehin nie. */
function flottenCard(snap, sperre) {
  const own = isOwner(), M = snap?.flotten, list = Array.isArray(M?.list) ? M.list : [];
  const ops = Array.isArray(M?.ops?.list) ? M.ops.list : [], gesperrt = new Set((sperre || []).map(x => x.name));
  const names = [...new Set([...list.map(f => f.name), ...gesperrt])].sort((a, b) => a.localeCompare(b, 'de'));
  const typen = t => Object.entries(t || {}).map(([k, n]) => `${n} ${k}`).join(', ');
  const item = name => {
    const at = list.filter(f => f.name === name), op = ops.filter(o => o.name === name), zu = gesperrt.has(name);
    const cargo = Math.max(0, ...at.map(f => +f.cargo || 0));
    return `<div class="list-item"><div class="row between">
      <span><b>${esc(name)}</b> ${zu ? '<span class="tag hoch">gesperrt</span>' : cargo ? '<span class="tag ok">frei</span>' : '<span class="tag">ohne Laderaum</span>'}</span>
      ${own ? `<button class="small" data-fsperre="${esc(name)}"${zu ? '' : ' data-on="1"'}>${zu ? 'Freigeben' : 'Sperren'}</button>` : ''}</div>
      ${at.map(f => `<div class="small">im Orbit von ${esc(trName(snap, f.at))} <span class="muted">${esc(f.at)}</span>: ${esc(typen(f.types)) || '–'}${f.cargo ? ` · Laderaum ${esc(fmt(f.cargo))} t` : ''} <span class="muted">· gesehen ${esc(when(new Date(f.seen).toISOString()))}</span></div>`).join('')}
      ${op.map(o => `<div class="small">unterwegs: ${esc(o.cmd)} ${esc(o.phase)} ${esc(trName(snap, o.home))} → ${esc(trName(snap, o.target))}, bis ${esc(clockT(o.end))}</div>`).join('')}
      ${!at.length && !op.length ? '<div class="small muted">zurzeit nicht gesehen</div>' : ''}
    </div>`;
  };
  return `<div class="card"><h2>Flotten</h2>
    ${names.length ? names.map(item).join('') : '<p class="muted">Noch keine Flotten gesehen. Der Autobuilder merkt sie sich beim Fliegen (ab Version 0.7.9).</p>'}
    <p class="small muted">Gesperrte Flotten nimmt der Autobuilder nie für Transporte, auch wenn ein Auftrag sie nennt; die Sperre gilt sofort (≈ 1 min) für alle gleichnamigen Flotten. Gesehen = Transportformular des Planeten${M?.ops?.at ? ` · Flottenstatus ${esc(when(new Date(M.ops.at).toISOString()))}` : ''}.</p></div>`;
}

/* Transportaufträge (Nutzer 25.10.2026, doku/stand/transporte.md): Der Owner legt Quelle, Ziel, Menge [E,M,T] und Flotte (Name oder
   leer = Autobuilder entscheidet) an (RPC transport_anlegen, Anlegen = Freigabe). Der Autobuilder fliegt in einem oder mehreren Flügen
   (ab PR 4) und meldet Stand und Flüge (transport_melden). Laderaum je Planet aus der Schiffsstatistik (empire.ships, split ab
   Collector 0.4.36), Vorschau und „max“ in cockpit/transporte.js. Formularwerte in S.trForm, damit das stille Neuladen sie nicht löscht. */
const TA_ST = { offen: ['offen', ''], laeuft: ['läuft', 'aktiv'], erledigt: ['erledigt', 'erledigt'], abgebrochen: ['abgebrochen', 'abgebrochen'], fehler: ['Fehler', 'hoch'] };
const trPlanets = snap => empirePlanets(snap).filter(p => /^\d+:\d+:\d+$/.test(p.coords || ''));
const trName = (snap, c) => trPlanets(snap).find(p => p.coords === c)?.name || c;
const trLager = (snap, c) => { const s = trPlanets(snap).find(p => p.coords === c)?.storage; return s ? RES.map(x => +s[x] || 0) : null; };
const trLad = l => esc(Transporte.ladungText(l, n => fmt(n)));
// Laderaum für einen Flug: größter Laderaum in Flotten an Quelle (Liefern) oder Ziel (Abholen); freie Schiffe im Hafen zählen noch nicht
function trInfo(snap, f) {
  const ships = snap?.empire?.ships, kv = Transporte.kapazitaet(ships, f.von), kn = Transporte.kapazitaet(ships, f.nach);
  const fuel = f.von && f.nach && Transporte.sameSystem(f.von, f.nach) ? Transporte.FUEL_SYSTEM : null;
  const opt = { menge: f.menge, laderaum: Math.max(kv.flotte, kn.flotte), fuel, lager: trLager(snap, f.von) };
  return { kv, kn, opt, v: Transporte.vorschau(opt) };
}
function trVorschauHtml(snap, f) {
  if (!f.von || !f.nach || f.von === f.nach) return '<p class="small muted">Quelle und Ziel wählen.</p>';
  const { v, opt } = trInfo(snap, f);
  return `${v.fluege.length ? `<div class="small"><b>${v.fluege.length} ${v.fluege.length === 1 ? 'Flug' : 'Flüge'}</b> zu je höchstens ${esc(fmt(opt.laderaum))} t${v.fuel != null ? ` · T-Stoff für die Flüge ≈ ${esc(fmt(v.fuel))} (zusätzlich von der Quelle)` : ''}</div>
    ${v.fluege.map(x => `<div class="small muted">Flug ${x.nr}: ${trLad(x.ladung)}</div>`).join('')}` : ''}
    ${v.probleme.map(p => `<div class="small err">${esc(p)}</div>`).join('')}`;
}
function trKapHtml(snap) {
  const pl = trPlanets(snap), ships = snap?.empire?.ships;
  const rows = pl.map(p => ({ p, k: Transporte.kapazitaet(ships, p.coords) }));
  const geteilt = rows.every(r => r.k.geteilt);
  return `<details class="sub"><summary class="small muted">Laderaum je Planet</summary>
    ${rows.map(({ p, k }) => `<div class="small"><b>${esc(p.name)}</b> <span class="muted">${esc(p.coords)}</span>: ${k.gesamt
      ? `in Flotten ${esc(fmt(k.flotte))} t${k.hafen ? ` · frei im Hafen ${esc(fmt(k.hafen))} t` : ''}${k.flug ? ` · unterwegs ${esc(fmt(k.flug))} t` : ''}`
      : '<span class="muted">keine Transporter</span>'}</div>`).join('')}
    <p class="small muted">Schiffe aus der Schiffsstatistik × Laderaum je Typ (PTRN 12 000 t). Freie Schiffe im Hafen bilden noch keine neue Flotte (später).${geteilt ? '' : ' Der Stand enthält noch keine Aufteilung Hafen/Flotte (Collector ab 0.4.36), alles zählt als Flotte.'}</p></details>`;
}
function auftragFormCard(snap, head) {
  const pl = trPlanets(snap);
  if (!pl.length) return '<div class="card"><h2>Neuer Transport</h2><p class="muted">Kein Live-Stand mit Planeten vorhanden.</p></div>';
  const f = S.trForm?.acc === S.acc ? S.trForm : (S.trForm = { acc: S.acc, von: pl[0].coords, nach: pl[1]?.coords || '', menge: [0, 0, 0], flotte: '' });
  const opts = sel => pl.map(p => `<option value="${esc(p.coords)}"${p.coords === sel ? ' selected' : ''}>${esc(p.name)} (${esc(p.coords)})</option>`).join('');
  const lager = trLager(snap, f.von);
  return `<div class="card"><h2>Neuer Transport</h2>
    <form id="taForm">
      <div class="row"><label class="f" style="flex:1 1 140px"><span>Von</span><select name="von">${opts(f.von)}</select></label>
        <label class="f" style="flex:1 1 140px"><span>Nach</span><select name="nach">${opts(f.nach)}</select></label></div>
      <p class="small muted"><span id="taLager">${lager ? `Lager der Quelle: ${trLad(lager)}` : 'Lager der Quelle unbekannt'}</span>${head ? ` · Stand ${esc(when(head.collected_at))}` : ''}</p>
      <div class="row">${['Eisenerz', 'Mineral', 'T-Stoff'].map((x, i) => `<label class="f" style="flex:1 1 180px;margin:2px 0"><span>${x}</span>
        <div class="row" style="flex-wrap:nowrap;gap:4px"><input name="m${i}" type="number" min="0" step="1" inputmode="numeric" value="${f.menge[i] || ''}" style="min-width:0;flex:1">
        <button type="button" class="small" data-max="${i}">max</button></div></label>`).join('')}</div>
      <label class="f"><span>Flotte (Name aus dem Spiel; leer = Autobuilder entscheidet)</span><input name="flotte" maxlength="60" value="${esc(f.flotte)}" placeholder="Automatisch"></label>
      <div id="taVorschau">${trVorschauHtml(snap, f)}</div>
      <div class="row" style="margin-top:6px"><button class="primary">Transport anlegen</button></div>
    </form>
    <p class="small muted">Anlegen = Freigabe: Der Autobuilder fliegt den Auftrag (Liefern mit einer Flotte an der Quelle, Abholen mit einer am Ziel). Bauten haben Vorrang; er nimmt nur Rohstoffe, die er nicht für den Bau zurückhält. Die Vorschau ist eine Schätzung.</p>
    ${trKapHtml(snap)}</div>`;
}
function bindAuftragForm(snap) {
  const form = $('#taForm');
  if (!form) return;
  const f = S.trForm;
  const read = () => {
    f.von = form.von.value; f.nach = form.nach.value; f.flotte = form.flotte.value;
    f.menge = [0, 1, 2].map(i => Math.max(0, Math.floor(+form['m' + i].value || 0)));
  };
  const show = () => {
    $('#taVorschau').innerHTML = trVorschauHtml(snap, f);
    const l = trLager(snap, f.von);
    $('#taLager').textContent = l ? `Lager der Quelle: ${Transporte.ladungText(l, n => fmt(n))}` : 'Lager der Quelle unbekannt';
  };
  form.addEventListener('input', () => { read(); show(); });
  form.addEventListener('change', () => { read(); show(); });
  form.querySelectorAll('button[data-max]').forEach(b => b.addEventListener('click', () => {
    read();
    const i = +b.dataset.max, { opt } = trInfo(snap, f);
    form['m' + i].value = f.menge[i] = opt.lager ? Transporte.maxMenge(i, opt) : 0;
    show();
  }));
  form.addEventListener('submit', async e => {
    e.preventDefault(); read();
    if (f.von === f.nach) return toast('Quelle und Ziel sind gleich');
    if (!f.menge.some(x => x > 0)) return toast('Keine Menge angegeben');
    const { v } = trInfo(snap, f);
    const txt = `Transport anlegen?\n${trName(snap, f.von)} → ${trName(snap, f.nach)}: ${Transporte.ladungText(f.menge, n => fmt(n))}\nFlotte: ${f.flotte.trim() || 'Autobuilder entscheidet'}${v.fluege.length ? ` · ca. ${v.fluege.length} Flug/Flüge` : ''}${v.probleme.length ? '\n\nHinweis: ' + v.probleme.join(' ') : ''}\n\nDer Autobuilder fliegt ihn, sobald er läuft.`;
    if (!confirm(txt)) return;
    try {
      const id = await Cloud.rpc('transport_anlegen', { p_account: S.acc, p_von: f.von, p_nach: f.nach, p_menge: f.menge, p_flotte: f.flotte.trim() || null });
      S.trForm = null; toast(`Transport #${id} angelegt`); route(true);
    } catch (err) { toast(err.message); }
  });
}
// Abgeschlossene Aufträge früherer Pläne (plan_id gesetzt, nicht der aktive Plan) stehen zugeklappt in „Aus früheren Plänen“
// (Nutzer 30.10.2026: nur ausblenden, nichts löschen); von Hand angelegte (ohne Plan) bleiben unter „Abgeschlossen“
function auftragListCard(auf, snap, planId = null) {
  if (auf == null) return '<div class="card"><h2>Transportaufträge</h2><p class="err small">Liste nicht ladbar.</p></div>';
  const own = isOwner(), offen = auf.filter(a => ['offen', 'laeuft'].includes(a.status));
  const frueher = auf.filter(a => !offen.includes(a) && a.plan_id && a.plan_id !== planId), alt = auf.filter(a => !offen.includes(a) && !frueher.includes(a));
  const item = a => {
    const [st, cls] = TA_ST[a.status] || [a.status, ''];
    const fl = Array.isArray(a.fluege) ? a.fluege : [];
    return `<div class="list-item"><div class="row between">
      <span><b>#${esc(a.id)}</b> ${esc(trName(snap, a.von))} → ${esc(trName(snap, a.nach))} <span class="tag ${cls}">${esc(st)}</span>${a.plan_nr ? ` <span class="tag kt">Plan-Transport #${esc((a.plan_nrs || [a.plan_nr]).join(', #'))}</span>` : ''}${a.einmal ? ' <span class="tag">automatisch</span>' : ''}</span>
      <span class="muted small nowrap">${esc(when(a.created_at))}</span></div>
      <div class="small">Menge: ${trLad(a.menge)}${(a.geliefert || []).some(x => +x > 0) ? ` · geliefert: ${trLad(a.geliefert)}` : ''}</div>
      <div class="small muted">Flotte: ${a.flotte ? esc(a.flotte) : 'Autobuilder entscheidet'}${fl.length ? ` · ${fl.length} ${fl.length === 1 ? 'Flug' : 'Flüge'}` : ''}${a.done_at ? ` · fertig ${esc(when(a.done_at))}` : ''}</div>
      ${fl.length ? `<details class="sub"><summary class="small muted">Flüge</summary>${fl.map(x => `<div class="small">${esc(x.nr ?? '')} ${esc(x.befehl || '')} ${esc(x.flotte || '')}: ${trLad(x.ladung)}${x.an ? ` · an ${esc(clockT(Date.parse(x.an)))}` : ''}${x.status ? ` · ${esc(x.status)}` : ''}</div>`).join('')}</details>` : ''}
      ${a.meldung ? `<div class="small${a.status === 'fehler' ? ' err' : ' muted'}">${esc(a.meldung)}</div>` : ''}
      ${own && ['offen', 'laeuft'].includes(a.status) ? `<div class="row" style="margin-top:4px"><button class="small" data-ta="${esc(a.id)}">Abbrechen</button></div>` : ''}
    </div>`;
  };
  return `<div class="card"><h2>Transportaufträge</h2>
    ${offen.length ? offen.map(item).join('') : '<p class="muted">Kein offener Auftrag.</p>'}
    ${alt.length ? `<details class="sub"><summary class="small muted">Abgeschlossen (${alt.length})</summary>${alt.map(item).join('')}</details>` : ''}
    ${frueher.length ? `<details class="sub"><summary class="small muted">Aus früheren Plänen (${frueher.length})</summary>${frueher.map(item).join('')}</details>` : ''}
    <p class="small muted">Der Autobuilder fliegt offene Aufträge, wenn im Autobuilder-Panel „Transporte fliegen“ an ist und ein Lauf läuft.</p></div>`;
}

// Plan-Transport als Transportaufträge (Nutzer 26.10.2026): hin = Heimat → Kolonie, zurück = Kolonie → Heimat (Abholen); je Strecke mit
// Menge > 0 ein Auftrag, ohne die schon angelegten (offen/läuft/erledigt, pa = Aufträge dieses Plans). Der Autobuilder fliegt sie wie jeden
// Auftrag, sobald er Zeit hat (Bau hat Vorrang); sind alle erledigt, setzt transport_melden den Haken selbst.
// Auftrag gehört zu Plan-Transport nr (auch zusammengelegt: plan_nrs, ab 27.10.2026 vom Autobuilder angelegt)
const trHasNr = (a, nr) => a.plan_nr === nr || (Array.isArray(a.plan_nrs) && a.plan_nrs.includes(nr));
const trSum = l => (Array.isArray(l) ? l : []).reduce((a, v) => a + (+v > 0 ? +v : 0), 0);
function trPlanLegs(x, pa) {
  const legs = [];
  if (trSum(x.hin) > 0) legs.push({ von: x.von, nach: x.nach, menge: x.hin.map(v => Math.max(0, Math.round(+v || 0))) });
  if (trSum(x.zurueck) > 0) legs.push({ von: x.nach, nach: x.von, menge: x.zurueck.map(v => Math.max(0, Math.round(+v || 0))) });
  return legs.filter(l => trSum(l.menge) > 0 && !pa.some(a => trHasNr(a, x.nr) && a.von === l.von && a.nach === l.nach
    && ['offen', 'laeuft', 'erledigt'].includes(a.status)));
}
const trAufHtml = (list, plName) => list.length ? `<div class="small">${list.map(a => { const [st, cls] = TA_ST[a.status] || [a.status, ''];
  return `Auftrag #${a.id} ${plName(a.von)} → ${plName(a.nach)} <span class="tag ${cls}">${esc(st)}</span>`; }).join(' · ')}</div>` : '';
// Takt-Flüge des aktiven Plans als Karte (HTML); Knöpfe „Geflogen“ und „Auftrag an Autobuilder“ bindet viewTransporte
async function planTransportCard(ap, d) {
  if (!ap) return '<div class="card"><h2>Transporte im Plan</h2><p class="muted">Kein Bauplan freigegeben.</p></div>';
  const [hk, pa] = await Promise.all([Cloud.q('transport_haken', { plan_id: `eq.${ap.row.id}`, select: 'nr,geflogen_at' }),
    Cloud.q('transport_auftraege', { plan_id: `eq.${ap.row.id}`, select: 'id,plan_nr,plan_nrs,von,nach,status', order: 'id.asc' }).catch(() => [])]);
  const drift = d?.plan === ap.row.id ? d : null;
  const list = Transporte.transportListe(ap.payload, drift, hk.map(h => h.nr));
  const home = ap.payload?.planet;   // Heimat steht nicht in plan.planets, sondern als planet {name, coords}
  const own = isOwner(), plName = c => !c ? '?' : esc(c === home?.coords ? home.name || 'Heimat' : planTabName(ap.payload, c));
  const lad = l => esc(Transporte.ladungText(l, n => fmt(n)));
  const item = x => {
    const [st, cls] = TR_ST[x.status] || ['', ''];
    return `<div class="list-item"><div class="row between">
      <span><b>#${x.nr}</b> ${plName(x.von)} → ${plName(x.nach)}${st ? ` <span class="tag ${cls}">${st}</span>` : ''}</span>
      <span class="nowrap"${x.ab ? ` title="${esc(dt(x.ab))}"` : ''}>${esc(clockT(x.ab))}</span></div>
      <div class="small">hin: ${lad(x.hin)} · zurück: ${lad(x.zurueck)}</div>
      <div class="small muted">Ankunft ${esc(clockT(x.an))} · zurück ${esc(clockT(x.rueck))}${x.fuel != null ? ` · Treibstoff ${esc(fmt(x.fuel))}` : ''}</div>
      ${trAufHtml(pa.filter(a => trHasNr(a, x.nr)), plName)}
      ${own ? `<div class="row" style="margin-top:4px">${x.status !== 'geflogen' && trPlanLegs(x, pa).length ? `<button class="small primary" data-tauf="${x.nr}">Auftrag an Autobuilder</button>` : ''}<button class="small${x.status === 'faellig' ? ' primary' : ''}" data-tr="${x.nr}" data-on="${x.status === 'geflogen' ? '' : 1}">${x.status === 'geflogen' ? 'Haken lösen' : 'Geflogen'}</button></div>` : ''}
    </div>`;
  };
  // Stationieren laut Plan (Punkt C, 26.10.2026): macht der Autobuilder, hier nur Anzeige
  const park = Transporte.parkListe(ap.payload, drift).map(x => {
    const [st, cls] = TR_ST[x.status] || ['', ''];
    return `<div class="list-item"><div class="row between">
      <span><b>Stationieren</b> ${esc(x.schiffe.join(' + '))} → ${plName(x.nach)}${st ? ` <span class="tag ${cls}">${st}</span>` : ''}</span>
      <span class="nowrap" title="${esc(dt(x.ab))}">${esc(clockT(x.ab))}</span></div>
      <div class="small muted">Ankunft ${esc(clockT(x.an))}${x.vor ? ` · danach #${x.vor} ${esc(x.vorName || '')} (wartet bis dahin auf Hafenplatz)` : ''} · Autobuilder, Option „Flotte stationieren“</div>
    </div>`;
  }).join('');
  const parkCard = park ? `<div class="card"><h2>Umparken im Plan</h2>${park}</div>` : '';
  const open = list.filter(x => x.status !== 'geflogen'), done = list.filter(x => x.status === 'geflogen');
  const soon = open.filter(x => x.status !== 'spaeter' || x.ab < Date.now() + 24 * 3600e3), later = open.slice(soon.length);
  return parkCard + (!list.length
    ? `<div class="card"><h2>Transporte im Plan</h2><p class="muted">Der aktive Plan enthält keine Transportliste. Sie kommt mit dem nächsten Plan aus der Simulation (Takt-Flüge).</p></div>`
    : `<div class="card"><h2>Transporte im Plan</h2>
      <p class="small muted">${esc(ap.row.title || 'Aktiver Plan')} · ${open.length} offen, ${done.length} geflogen${drift?.lag != null ? ` · Zeiten verschoben: ${esc(lagText(drift.lag))}` : ''}</p>
      ${soon.length ? soon.map(item).join('') : '<p class="muted">In den nächsten 24 h kein Transport.</p>'}
      ${later.length ? `<details class="sub"><summary class="small muted">Später (${later.length})</summary>${later.map(item).join('')}</details>` : ''}
      ${done.length ? `<details class="sub"><summary class="small muted">Geflogen (${done.length})</summary>${done.map(item).join('')}</details>` : ''}
    </div>`);
}

/* ---------- Claude-Kanal (B6, 14.10.) ----------
   Aufträge (requests) an Claude: Owner stellt sie hier (Ziel immer „any“), eine Claude-Sitzung mit Wächter (tools/watch.py; Claude-Wache
   auf Work am 24.10. abgeschaltet) übernimmt (request_claim) und antwortet (request_answer,
   ggf. mit Planentwurf). Antworten kommen auch als Push. */
const RQ_ST = { neu: 'neu', in_arbeit: 'in Arbeit', beantwortet: 'beantwortet', abgelehnt: 'abgelehnt', zurueckgezogen: 'zurückgezogen' };
const RQ_KIND = { optimierer: 'Neuer Plan', plan_rechnen: 'Plan-Lauf Work', ereignis: 'Ereignis', schritt: 'Planschritt' };
const RQ_TGT = { sim: 'Simulations-PC', remote: 'Remote-PC' };  // nur noch für alte Aufträge; neue gehen an „any“
async function viewClaude() {
  const rq = await Cloud.q('requests', { account_id: `eq.${S.acc}`, hidden_at: 'is.null', order: 'created_at.desc', limit: 40,
    select: 'id,kind,target,text,context,status,answer,plan_ids,created_at,answered_at' });
  const own = isOwner();
  $('#view').innerHTML = `${own ? `<div class="card"><h2>Auftrag an Claude</h2>
      <form id="rqForm"><textarea name="text" rows="4" maxlength="8000" placeholder="Frage oder Auftrag, z. B. „Rechne den Plan neu ab dem neuesten Snapshot“" style="width:100%"></textarea>
      <div class="row" style="margin-top:6px"><button class="primary">Senden</button></div></form>
      <p class="muted small">Eine offene Claude-Sitzung mit Wächter holt den Auftrag ab und antwortet hier (mit Push). Läuft gerade keine, bleibt er „neu“, bis eine startet. Pläne gibt Claude nie frei und schickt keine Kommandos an Skripte – das bleibt bei dir.</p></div>` : ''}
    <div class="card"><h2>Aufträge</h2>${own && rq.length ? '<p class="muted small">Zum Entfernen nach rechts wischen.</p>' : ''}${rq.length ? rq.map(r => `<div class="list-item${own ? ' swipe' : ''}" data-rq="${esc(r.id)}" data-open="${['neu', 'in_arbeit'].includes(r.status) ? 1 : ''}"><div class="row between">
      <span><span class="tag ${r.status === 'beantwortet' ? 'ok' : ''}">${esc(RQ_ST[r.status] || r.status)}</span> ${r.kind !== 'frage' ? `<span class="tag">${esc(RQ_KIND[r.kind] || r.kind)}</span> ` : ''}${r.target !== 'any' ? `<span class="muted small">${esc(RQ_TGT[r.target] || r.target)}</span>` : ''}</span>
      <span class="muted small nowrap">${esc(when(r.created_at))}</span></div>
      <div class="wrapall" style="white-space:pre-wrap">${esc(tidy(r.text))}</div>
      ${r.context && typeof r.context === 'object' && Object.keys(r.context).length ? `<details class="sub"><summary class="small muted">Kontext</summary><pre class="small">${esc(JSON.stringify(r.context, null, 1))}</pre></details>` : ''}
      ${r.answer ? `<div class="msgbody small"><b>Antwort</b>${r.answered_at ? ` <span class="muted">${esc(when(r.answered_at))}</span>` : ''}<br>${esc(tidy(r.answer))}</div>` : ''}
      ${r.plan_ids?.length ? `<div class="small"><a href="#/plaene">${r.plan_ids.length === 1 ? 'Planentwurf' : r.plan_ids.length + ' Planentwürfe'} unter Pläne →</a></div>` : ''}
      ${own && ['neu', 'in_arbeit'].includes(r.status) ? `<div class="row" style="margin-top:4px"><button class="small" data-wd="${esc(r.id)}">Zurückziehen</button></div>` : ''}
    </div>`).join('') : '<p class="muted">Noch keine Aufträge.</p>'}</div>`;
  $('#rqForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const text = e.target.text.value.trim();
    if (!text) return;
    try {
      await Cloud.rest('requests', { method: 'POST', prefer: 'return=minimal', body: { account_id: S.acc, kind: 'frage', target: 'any', text } });
      toast('Auftrag gesendet'); route(true);
    } catch (err) { toast(err.message); }
  });
  $('#view').querySelectorAll('button[data-wd]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Auftrag zurückziehen?')) return;
    try { await Cloud.rpc('request_withdraw', { p_id: b.dataset.wd }); toast('Zurückgezogen'); route(true); } catch (e) { toast(e.message); }
  }));
  if (own) $('#view').querySelectorAll('.list-item.swipe').forEach(el => bindSwipeRight(el, async () => {
    if (el.dataset.open && !confirm('Auftrag ist noch offen. Zurückziehen und entfernen?')) return false;
    try { await Cloud.rpc('request_hide', { p_id: el.dataset.rq }); el.remove(); toast('Entfernt'); return true; }
    catch (e) { toast(e.message); return false; }
  }));
}
/* Wischen nach rechts (Nutzer 25.10.2026, Reiter Claude): Zeile folgt dem Finger bzw. der Maus; ab 35 % der Breite löst onDone aus
   (liefert true = entfernt, sonst springt die Zeile zurück). Senkrechtes Scrollen bleibt frei (touch-action: pan-y in style.css). */
function bindSwipeRight(el, onDone) {
  let x0 = null, y0 = 0, dx = 0, lock = null;
  const reset = () => { el.style.transition = 'transform .2s, opacity .2s'; el.style.transform = ''; el.style.opacity = ''; x0 = null; lock = null; };
  el.addEventListener('pointerdown', e => {
    if (e.target.closest('button, a, summary, textarea, input')) return;
    x0 = e.clientX; y0 = e.clientY; dx = 0; lock = null; el.style.transition = 'none';
  });
  el.addEventListener('pointermove', e => {
    if (x0 == null) return;
    const mx = e.clientX - x0, my = e.clientY - y0;
    if (!lock && Math.abs(mx) + Math.abs(my) > 8) { lock = Math.abs(mx) > Math.abs(my) && mx > 0 ? 'x' : 'y'; if (lock === 'x') el.setPointerCapture?.(e.pointerId); }
    if (lock !== 'x') return;
    dx = Math.max(0, mx);
    el.style.transform = `translateX(${dx}px)`; el.style.opacity = String(Math.max(0.3, 1 - dx / el.offsetWidth));
  });
  const end = async () => {
    if (x0 == null) return;
    const hit = lock === 'x' && dx > el.offsetWidth * 0.35;
    x0 = null;
    if (!hit) return reset();
    el.style.transition = 'transform .2s, opacity .2s'; el.style.transform = 'translateX(100%)'; el.style.opacity = '0';
    if (!(await onDone())) reset();
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', reset);
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
