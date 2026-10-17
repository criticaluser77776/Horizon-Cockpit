'use strict';
/* Werft-, Verteidigungs- und Sondenpläne im Cockpit anzeigen (Paket E, 17.10.2026) – nur lesend, kein Freigeben/Ausführen hier
   (Freigeben läuft wie bei allen Plänen über die Planliste; Ausführer gibt es erst mit Paket F, doku/stand/werft-def.md).
   Planformat payload: { id, kind, startTime, steps: [[kuerzel, menge, ab_h], …], quelle, note } (analyse/werft_plan.js,
   tools/push_plan.py --kind). Die Liste im Spiel hat 8 Plätze: Vorschau = die ersten 8 Schritte als Aufträge.
   Live-Liste aus state_latest data.werft / data.verteidigung ({liste: {wartend, laufend, frei}}), sobald der Collector sie
   erfasst (Paket F); bis dahin nur Hinweis. Läuft vor app.js; nutzt zur Laufzeit dessen Helfer ($, esc, fmt, dt, Cloud, S). */
(function () {
  const PLAETZE = 8;
  const KINDS = ['ship', 'defense', 'probe'];
  const LIVE = { ship: 'werft', defense: 'verteidigung', probe: 'werft' };
  const cache = {};

  function steps(p) {
    const s = p?.payload?.steps;
    return Array.isArray(s) ? s.filter(x => Array.isArray(x) && x.length === 3) : [];
  }
  const at = (p, h) => { const t = Date.parse(p.payload?.startTime || p.created_at); return isFinite(t) ? dt(new Date(t + h * 3600e3).toISOString()) : `+${fmt(h, 1)} h`; };

  function liste(titel, auftraege, frei) {
    const rows = [];
    for (let i = 0; i < PLAETZE; i++) {
      const a = auftraege[i];
      rows.push(`<tr><td class="num">${i + 1}</td><td>${a ? `<b>${esc(a.kuerzel)}</b>` : '<span class="muted">frei</span>'}</td><td class="num">${a?.menge != null ? fmt(a.menge) : ''}</td><td class="small muted">${esc(a?.info || '')}</td></tr>`);
    }
    return `<div class="small" style="margin-top:6px"><b>${esc(titel)}</b>${frei != null ? ` · ${fmt(frei)} von ${PLAETZE} frei` : ''}</div>
      <table class="small"><thead><tr><th>Platz</th><th>Einheit</th><th>Menge</th><th></th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
  }

  function render(p, live) {
    const s = steps(p);
    if (!s.length) return '<p class="small muted">Keine gültigen Schritte im Plan.</p>';
    const summe = {};
    for (const [k, n] of s) summe[k] = (summe[k] || 0) + n;
    const tab = `<table class="small"><thead><tr><th>#</th><th>Einheit</th><th>Menge</th><th>frühestens</th></tr></thead><tbody>${
      s.map(([k, n, h], i) => `<tr><td class="num">${i + 1}</td><td><b>${esc(k)}</b></td><td class="num">${fmt(n)}</td><td>${esc(h ? at(p, h) : 'sofort')}</td></tr>`).join('')}</tbody></table>`;
    const vorschau = liste('Auftragsliste nach Plan (Vorschau)', s.slice(0, PLAETZE).map(([k, n, h]) => ({ kuerzel: k, menge: n, info: h ? `ab ${at(p, h)}` : '' })),
      Math.max(0, PLAETZE - s.length));
    const L = live?.liste;
    const lv = L ? liste('Auftragsliste im Spiel (live)', [...(L.laufend || []).map(a => ({ ...a, info: 'läuft' })), ...(L.wartend || []).map(a => ({ ...a, info: 'wartet' }))], L.frei)
      : '<p class="small muted">Live-Liste: wird erst mit dem Ausführer (Paket F) erfasst.</p>';
    return `<div class="small">Summe: ${Object.entries(summe).map(([k, n]) => `${fmt(n)}× ${esc(k)}`).join(', ')}${p.payload?.quelle ? ` · Quelle ${esc(p.payload.quelle)}` : ''}</div>
      ${tab}${vorschau}${lv}<p class="small muted">Noch ohne Ausführer – Anzeige und Freigabe nur zur Planung.</p>`;
  }

  async function load(box) {
    const id = box.dataset.wplan, kind = box.dataset.kind;
    const body = box.querySelector('.wbody');
    try {
      if (!cache[id]) {
        const [row] = await Cloud.q('plans', { id: `eq.${id}`, select: 'id,kind,created_at,payload' });
        const st = await Cloud.q('state_latest', { account_id: `eq.${S.acc}`, kind: 'eq.live', select: `live:data->${LIVE[kind] || 'werft'}` }).catch(() => []);
        cache[id] = { row, live: st[0]?.live || null };
      }
      body.innerHTML = cache[id].row ? render(cache[id].row, cache[id].live) : '<p class="small muted">Plan nicht gefunden.</p>';
    } catch (e) { body.innerHTML = `<p class="small">Fehler: ${esc(e.message)}</p>`; }
  }

  // Aufklappen lädt den Planinhalt (die Planliste lädt payload nicht mit)
  document.addEventListener('toggle', e => { const b = e.target; if (b?.dataset?.wplan && b.open) load(b); }, true);

  window.HzWerftCockpit = {
    KINDS, render,
    details: p => KINDS.includes(p.kind) ? `<details class="sub" data-wplan="${esc(p.id)}" data-kind="${esc(p.kind)}"><summary class="small muted">Schritte und Auftragsliste (8 Plätze)</summary><div class="wbody"><p class="small muted">Lädt …</p></div></details>` : '',
  };
})();
