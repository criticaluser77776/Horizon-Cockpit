'use strict';
/* Horizon Atlas – Detailseite zum Cockpit (doku/stand/cockpit-aufteilung.md, D1 ab 17.10.2026): Router, Kopf, Kontowahl.
   Nur Desktop-Browser am PC: kein Service Worker, kein Push, keine Installation. Anmeldung gemeinsam mit dem Cockpit
   (gleicher Origin, localStorage hz.access/hz.device/hz.acc) – angemeldet wird nur im Cockpit. Schreibt grundsätzlich nicht;
   Ausnahmen: Ereignisse ausblenden/gesehen (owner/viewer) und lesende Kommandos (Planetenwerte messen, nur Owner, mit Rückfrage).
   Reiter in eigenen Dateien (imperium.js, galaxie.js, planeten.js mit der Planeten-DB, ereignisse.js, plaene.js mit Werft/Def und Plan-Editor, verbrauch.js, statistik.js (D3), kampf.js (D7.3, Kern kampfkern.js + kampfworker.js);
   Kompendium aus kompendium.js, Werft-Vorschau aus werft.js, Planetenwerte aus planetwerte.js – seit C1 hier statt im Cockpit). */

const VIEWS = { imperium: viewImperium, statistik: viewStatistik, galaxie: viewGalaxy, planeten: viewPlanetDb, ereignisse: viewEvents, plaene: viewPlans, werft: viewWerft, kampf: viewKampf, wissen: viewKompendium, verbrauch: viewVerbrauch };
const START = 'imperium';

// Neue Atlas-Version online? version.js frisch lesen (höchstens alle 10 min, beim Start und beim Zurückkehren in den Tab)
async function checkUpdate() {
  if (location.protocol !== 'https:' || Date.now() - (checkUpdate.at || 0) < 10 * 60e3) return;
  checkUpdate.at = Date.now();
  try {
    const txt = await (await fetch('version.js', { cache: 'no-store' })).text();
    const n = +((txt.match(/DETAILS_VERSION = \{"number": (\d+)/) || [])[1] || 0);
    if (n > (+window.DETAILS_VERSION?.number || 0)) toast(`Neue Atlas-Version ${n} verfügbar`, { label: 'Neu laden', run: () => location.reload() });
  } catch { /* offline */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkUpdate(); });

async function boot() {
  // Übergang: Ein Cockpit-Service-Worker vor Shell v30 liefert ../common.js aus seinem Cache (ohne ATLAS) und holt die neue
  // im Hintergrund – dann einmal neu laden (nur einmal je Tab, damit offline keine Schleife entsteht)
  if (typeof ATLAS === 'undefined') {
    let again = false;
    try { again = !sessionStorage.getItem('hz.atlasReload'); sessionStorage.setItem('hz.atlasReload', '1'); } catch { /* egal */ }
    if (again) return setTimeout(() => location.reload(), 1500);
  }
  setTimeout(checkUpdate, 3000);
  window.addEventListener('hashchange', route);
  // Anmeldung oder Konto im Cockpit (anderer Tab) geändert → hier übernehmen
  window.addEventListener('storage', e => { if (['hz.access', 'hz.acc'].includes(e.key)) location.reload(); });
  if (!Cloud.loggedIn()) return renderNoLogin();
  try { await Cloud.touch(); } catch (e) {
    if (e instanceof LoginNeeded) return renderNoLogin(e.message);
    toast(e.message);  // offline: mit gespeichertem Stand weiter
  }
  afterLogin();
}

function afterLogin() {
  try { S.acc = localStorage.getItem('hz.acc'); } catch { /* egal */ }
  if (!accounts().some(a => a.id === S.acc)) S.acc = accounts()[0]?.id || null;
  renderAccSelect();
  if (!S.acc) return renderNoLogin('Dieses Gerät hat noch keinen Spielaccount – im Cockpit anlegen oder Rechte geben lassen.');
  $('#tabs').hidden = false;
  route();
}

function renderNoLogin(msg = '') {
  $('#tabs').hidden = true; $('#acc').innerHTML = '';
  $('#view').innerHTML = `<div class="login card"><h2>Horizon Atlas</h2>
    <p>Angemeldet wird im Cockpit; der Atlas nutzt dieselbe Anmeldung dieses Browsers.</p>
    ${msg ? `<p class="err small">${esc(msg)}</p>` : ''}
    <p><a class="atlaslink" href="../">Zum Cockpit (anmelden)</a> <button id="again">Neu prüfen</button></p></div>`;
  $('#again').onclick = () => location.reload();
}

function renderAccSelect() {
  const a = Cloud.access(), list = accounts();
  $('#acc').innerHTML = !a?.code ? '' : list.length > 1
    ? `<select id="accSel">${list.map(x => `<option value="${esc(x.id)}"${x.id === S.acc ? ' selected' : ''}>${esc(x.player)} (${esc(ROLE[x.role] || x.role)})</option>`).join('')}</select>`
    : `${esc(account()?.player || a.group || '')}${account() ? ` · ${esc(ROLE[account().role] || '')}` : ''}`;
  $('#accSel')?.addEventListener('change', e => {
    S.acc = e.target.value;
    try { localStorage.setItem('hz.acc', S.acc); } catch { /* egal */ }
    renderAccSelect(); route();
  });
}

// soft = automatische Aktualisierung: ohne „Lädt …“, die Ansicht bleibt bis zum Neuaufbau stehen
async function route(soft) {
  if (!Cloud.loggedIn() || !S.acc) return;
  const [tab = START, ...rest] = location.hash.replace(/^#\/?/, '').split('/');
  const key = VIEWS[tab] ? tab : START;
  document.querySelectorAll('nav.tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === key));
  document.title = `Horizon Atlas · ${document.querySelector(`nav.tabs a[data-tab="${key}"]`)?.lastChild?.textContent.trim() || ''}`;
  if (soft !== true) $('#view').innerHTML = '<p class="muted pad">Lädt …</p>';
  try { await loadNums(); await VIEWS[key](rest); } catch (e) {
    if (e instanceof LoginNeeded) return renderNoLogin(e.message);
    $('#view').innerHTML = `<div class="card"><p class="err">${esc(e.message)}</p><button onclick="route()">Erneut versuchen</button></div>`;
  }
}

// Imperium, Galaxie und Pläne alle 60 s still neu laden (nur sichtbar, nicht während einer Eingabe, nicht im Plan-Editor);
// der Atlas ist zum Nachsehen, nicht zum Überwachen. Planeten-DB bewusst nicht: Auswahl, Filter und Scroll gingen verloren
setInterval(() => {
  const tab = location.hash.replace(/^#\/?/, '').split('/')[0] || START;
  if (document.visibilityState !== 'visible' || !['imperium', 'galaxie', 'plaene'].includes(tab) || /^#\/plaene\/edit\//.test(location.hash)) return;
  if (document.activeElement?.matches?.('input,select,textarea')) return;
  route(true);
}, 60000);

boot();
