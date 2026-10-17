'use strict';
/* Horizon Atlas – Sonden versenden (plan-planeten-db.md P5, Entscheidung 7.3: nur Owner, jede Aktion mit Rückfrage, als Kommando
   ans Skript). Knopf „Prospektieren …“ in der Galaxie (je Bahn) und im Planet-Detail der Planeten-DB (pdActions in planeten.js).
   Dialog: Ziel, Sondenzahl, Verbände, Vorrat PRDR (letzter Live-Stand), Kosten der verbrauchten Sonden, Gerät. „Nur prüfen“ liest im
   Spiel alles bis zum Formular und sendet nichts; „Senden …“ fragt noch einmal per confirm(). Kommando „sonden“ an einen
   eingeloggten Autobuilder ab 0.5.33 (Horiversum/src/autobuilder/17-sonden.js, doku/wissen/sondenversand.md). Claude legt nie
   Kommandos an. */
const PRB_COST = [150, 170, 20];           // PRDR je Stück Erz/Mineral/Treibstoff (sonden.md, analyse/ships.json); Einweg
const PRB_MIN_AB = '0.5.33';
const prbDev = sess => sess.devs.filter(x => x.ab && isFresh(x.ab.at) && x.ab.state?.page === 'game' && verCmp(x.ab.version, PRB_MIN_AB) >= 0)
  .sort((a, b) => b.holds - a.holds)[0] || null;

// Vorrat PRDR je eigenem Planeten aus dem letzten Live-Stand (Collector: empire.ships = {planets, items: [{type, values}]})
async function prbStock() {
  const r = await Cloud.q('state_latest', { account_id: `eq.${S.acc}`, kind: 'eq.live', select: 'ships:data->empire->ships,at:data->>collectedAt' }).catch(() => []);
  const sh = r[0]?.ships || {}, it = (sh.items || []).find(x => /^PRDR$|Prospektierungssonde/i.test(String(x.type || '').trim()));
  return { at: r[0]?.at || null, planets: (sh.planets || []).map((p, i) => ({ ...p, n: it?.values?.[i] || 0 })), total: it ? (it.sum ?? (it.values || []).reduce((a, b) => a + b, 0)) : 0 };
}

// Knopf; p = Planet {coords, name, type, owner}
function prbButton(p, small) {
  if (!isOwner() || !p?.present) return '';
  const own = p.owner && p.owner === account()?.player;
  return `<button class="${small ? 'small ' : ''}prbgo" data-prb="${esc(p.coords || `${p.galaxy}:${p.system}:${p.orbit}`)}" data-name="${esc(p.name || '')}"
    data-type="${esc(p.type || '')}" data-owner="${esc(p.owner || '')}"${own ? ' disabled title="eigener Planet – Prospektion nicht möglich"' : ' title="Prospektionssonden (PRDR) senden – mit Rückfrage"'}>${small ? '🛰' : 'Prospektieren …'}</button>`;
}

async function prbDialog(b) {
  const t = { coords: b.dataset.prb, name: b.dataset.name, type: b.dataset.type, owner: b.dataset.owner };
  const [stock, sess] = await Promise.all([prbStock(), loadSessions().catch(() => null)]);
  const dev = sess && prbDev(sess);
  const dlg = document.createElement('dialog');
  dlg.className = 'prbdlg';
  const max = Math.min(5000, stock.total || 5000);
  dlg.innerHTML = `<form method="dialog"><h2>Prospektieren ${esc(t.coords)}</h2>
    <p class="small">${t.type ? `<span class="ptype t-${esc(t.type)}">${esc(t.type)}</span> ` : ''}<b>${esc(t.name || 'Planet')}</b> · ${t.owner ? esc(t.owner) : 'frei'}</p>
    <div class="pdf"><label>Sonden (PRDR)<input name="n" class="pdn" type="number" min="1" max="${max}" value="${Math.min(100, max)}" required></label>
      <label>Verbände<input name="k" class="pdn" type="number" min="1" max="20" value="1" required></label></div>
    <p class="small" id="prbSum"></p>
    <p class="small muted">Vorrat laut letztem Live-Stand${stock.at ? ` (${esc(dt(stock.at))})` : ''}: <b>${fmt(stock.total)} PRDR</b>${stock.planets.filter(p => p.n).length
      ? ' – ' + stock.planets.filter(p => p.n).map(p => `${esc(p.name)} ${fmt(p.n)}`).join(', ') : ''}. Gesendet wird vom im Spiel gewählten Planeten;
      jede Sonde misst einen zufälligen Wert, mehrere kleine Verbände sind genauer als einer (Wiki). Flugzeit und Treibstoff zeigt erst das Spiel –
      „Nur prüfen“ meldet, was das Spiel anbietet.</p>
    <p class="small">${dev ? `Gerät: <b>${esc(dev.name)}</b> (Autobuilder ${esc(dev.ab.version)})` : `<span class="err">Kein eingeloggter Autobuilder ab ${PRB_MIN_AB} – erst im Spiel einloggen.</span>`}</p>
    ${stock.total ? '' : '<p class="small warn">Keine PRDR im letzten Live-Stand. Prüfen geht trotzdem (meldet „keine Sonden“).</p>'}
    <div class="row" style="gap:6px;justify-content:flex-end"><button value="cancel" formnovalidate>Abbrechen</button>
      <button value="dry" ${dev ? '' : 'disabled'}>Nur prüfen</button><button value="send" class="danger" ${dev && stock.total ? '' : 'disabled'}>Senden …</button></div></form>`;
  document.body.append(dlg);
  const f = dlg.querySelector('form'), sum = dlg.querySelector('#prbSum');
  const upd = () => {
    const n = Math.round(+f.n.value) || 0, k = Math.max(1, Math.min(20, n, Math.round(+f.k.value) || 1)), q = Math.floor(n / k), r = n % k;
    sum.innerHTML = `${k > 1 ? `${k} Verbände zu ${r ? `${q + 1}–` : ''}${q} Sonden · ` : ''}verbraucht Sonden im Wert von <b>${PRB_COST.map(c => fmt(c * n)).join(' / ')}</b> Erz/Mineral/Treibstoff
      ${stock.total && n > stock.total ? ' · <span class="err">mehr als vorhanden</span>' : ''}`;
  };
  f.addEventListener('input', upd); upd();
  dlg.addEventListener('close', async () => {
    const how = dlg.returnValue, n = Math.round(+f.n.value), k = Math.round(+f.k.value);
    dlg.remove();
    if (how !== 'dry' && how !== 'send') return;
    if (!(n >= 1 && n <= 5000 && k >= 1 && k <= Math.min(20, n))) return toast('Sondenzahl 1–5000, Verbände 1–20 (höchstens so viele wie Sonden)');
    const dry = how === 'dry';
    if (!confirm(dry ? `Sondenversand nach ${t.coords} nur prüfen (${n} Sonden, ${k} Verband/Verbände)?\nDer Autobuilder auf ${dev.name} liest Galaxie und Spionage-Seite und sendet nichts.`
      : `${n} Prospektionssonden in ${k} Verband/Verbänden nach ${t.coords} ${t.name ? `(${t.name}) ` : ''}senden?\nGerät: ${dev.name}\nDie Sonden kehren nicht zurück (Wert ${PRB_COST.map(c => fmt(c * n)).join(' / ')}). Der Versand lässt sich nicht zurücknehmen.`)) return;
    try {
      await postCmd(dev, 'sonden', { coords: t.coords, count: n, groups: k, dry });
      toast(`Kommando an ${dev.name} gesendet – Ergebnis in 15–60 s unter Ereignisse`);
    } catch (e) { toast(e.message); }
  });
  dlg.showModal();
}

// ein Klick-Handler für alle Prospektier-Knöpfe (Galaxie, Planet-Detail), einmal angehängt
document.addEventListener('click', e => {
  const b = e.target.closest?.('button.prbgo');
  if (!b || b.disabled) return;
  e.preventDefault(); e.stopPropagation();
  if (!isOwner()) return toast('Nur der Owner kann Sonden senden');
  prbDialog(b).catch(err => toast(err.message));
}, true);
