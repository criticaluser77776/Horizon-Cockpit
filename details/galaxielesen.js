'use strict';
/* Horizon Atlas – fremde Systeme lesen (plan-planeten-db.md P2/P4, Entscheidung 7.3: nur Owner, jede Aktion mit Rückfrage, als
   Kommando ans Skript). Karte unter dem System im Reiter „Galaxie“: „System lesen“ (das angezeigte System) und „Bereich lesen“
   (Galaxie, System von–bis, höchstens 25). Kommando galaxie_lesen {g, von, bis} an einen eingeloggten Collector ab 0.4.21
   (Horiversum/src/collector/05-galaxie.js): nur GET der Galaxieansicht, 3 s Abstand, keine Sonde; jedes System geht sofort an
   planets_ingest, das Ergebnis kommt als Ereignis „galaxie“. Claude legt nie Kommandos an. */
const GLS_MIN_COL = '0.4.21', GLS_MAX = 25;
// Collector im Spiel: eigenes Lebenszeichen bis 6 min (bei lebendem Autobuilder meldet er sich nur alle 5 min) oder
// frisches Lebenszeichen des Autobuilders auf demselben Gerät im Spiel
const glsDev = sess => sess.devs.filter(x => x.col && x.col.state?.page === 'game' && verCmp(x.col.version, GLS_MIN_COL) >= 0
    && (isFresh(x.col.at, 6) || (x.ab && isFresh(x.ab.at) && x.ab.state?.page === 'game')))
  .sort((a, b) => b.holds - a.holds || String(b.col.at).localeCompare(String(a.col.at)))[0] || null;

// Karte; g:s = angezeigtes System
function glsCard(g, s) {
  if (!isOwner()) return '';
  const bis = Math.min(9999, s + 9);
  return `<div class="card glscard"><h2>Fremde Systeme lesen <span class="muted small">nur lesend, mit Rückfrage</span></h2>
    <div class="row" style="flex-wrap:wrap;gap:8px;align-items:center">
      <button class="glsgo" data-g="${g}" data-von="${s}" data-bis="${s}" title="Galaxieansicht ${g}:${s} vom Collector lesen lassen">System ${g}:${s} lesen</button>
      <form class="glsform galin" title="höchstens ${GLS_MAX} Systeme"><span class="small">Bereich</span>
        <input name="g" type="number" min="1" max="99" value="${g}" inputmode="numeric" aria-label="Galaxie">:<input
          name="von" type="number" min="1" max="9999" value="${s}" inputmode="numeric" aria-label="System von">–<input
          name="bis" type="number" min="1" max="9999" value="${bis}" inputmode="numeric" aria-label="System bis">
        <button>Bereich lesen</button></form></div>
    <p class="small muted">Der Collector ruft je System die Galaxieansicht ab (höchstens ${GLS_MAX} Systeme, 3 s Abstand, keine Sonde) und trägt
      Planeten, Besitzer und Status hier ein. Unerforschte Systeme bleiben ohne Planeten. Ergebnis unter Ereignisse („galaxie“).</p></div>`;
}

async function glsSend(g, von, bis) {
  if (!isOwner()) return toast('Nur der Owner kann Systeme lesen lassen');
  if (!(g >= 1 && g <= 99 && von >= 1 && bis <= 9999 && von <= bis)) return toast('Galaxie 1–99, System 1–9999, von ≤ bis');
  const n = bis - von + 1;
  if (n > GLS_MAX) return toast(`Höchstens ${GLS_MAX} Systeme je Auftrag (gewählt: ${n})`);
  const sess = await loadSessions().catch(() => null);
  const dev = sess && glsDev(sess);
  if (!dev) return toast(`Kein Collector ab ${GLS_MIN_COL} im Spiel eingeloggt – erst im Spiel einloggen`);
  const what = n === 1 ? `System ${g}:${von}` : `${n} Systeme ${g}:${von}–${bis}`;
  if (!confirm(`${what} lesen?\nGerät: ${dev.name} (Collector ${dev.col.version})\n\nNur lesend: ${n} Abruf${n > 1 ? 'e' : ''} der Galaxieansicht`
    + `${n > 1 ? ` im Abstand von 3 s (etwa ${Math.ceil(n * 3.6)} s)` : ''}, keine Sonde, keine Spielaktion.`)) return;
  try {
    await postCmd(dev, 'galaxie_lesen', { g, von, bis });
    toast(`Kommando an ${dev.name} gesendet – Ergebnis in 15–60 s${n > 1 ? ` plus etwa ${Math.ceil(n * 3.6)} s` : ''} unter Ereignisse`);
  } catch (e) { toast(e.message); }
}

// ein Handler für Knopf und Formular, einmal angehängt (die Galaxie-Ansicht wird neu gezeichnet)
document.addEventListener('click', e => {
  const b = e.target.closest?.('button.glsgo');
  if (!b || b.disabled) return;
  e.preventDefault(); e.stopPropagation();
  glsSend(+b.dataset.g, +b.dataset.von, +b.dataset.bis).catch(err => toast(err.message));
}, true);
document.addEventListener('submit', e => {
  const f = e.target.closest?.('form.glsform');
  if (!f) return;
  e.preventDefault(); e.stopPropagation();
  glsSend(Math.round(+f.g.value), Math.round(+f.von.value), Math.round(+f.bis.value)).catch(err => toast(err.message));
}, true);
