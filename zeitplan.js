// Live-Zeitplan (Nutzer 24.10.2026): erwartete Start- und Endzeiten der Planschritte nach dem letzten Messstand, gemeinsam für
// Autobuilder (analyse/build_userscripts.js setzt die Datei an der Zeile „// __ZEITPLAN__“ ein), Cockpit und Atlas.
// Je Warteschlange (Heimat-Bau, Forschung, Werft, Bau/Werft je Kolonie) ein eigener Versatz gegen die Planzeit:
//   - laufender Schritt: sein echtes Ende (Restzeit); die Folgeschritte behalten ihren Planabstand dazu und starten nie davor
//   - Startschätzung (Rohstoffe, Schlange; anchors) für einen offenen Schritt: ab dort
//   - sonst die Abweichung dieser Schlange (lags, h; positiv = Verzug), sonst lag für alle
// Ein offener Schritt liegt nie in der Vergangenheit: Er rückt auf „jetzt“ (due = ursprünglich erwarteter Start), die
// übrigen Schritte der Schlange rücken mit. Ohne require; Zeiten in ms, Planzeiten (steps[i][3], [4]) in h ab startTime.
const Zeitplan = (() => {
    const H = 3600e3;
    // Schlange eines Schritts (i ab 0): 'r' Forschung (global), 'b' Heimat-Bau, 's' Werft, 'b:<Koordinaten>' / 's:<…>' auf einer Kolonie
    function queueOf(plan, i) {
        const k = plan.steps[i][0], sp = plan.stepPlanet;
        if (k === 'r') return 'r';
        const c = sp && !Array.isArray(sp) && typeof sp[i + 1] === 'string' ? sp[i + 1] : null;
        return c ? `${k}:${c}` : k;
    }
    /**
     * plan     {startTime, steps, stepPlanet}
     * o.state  i => '0' offen | '1' läuft | '2' fertig (Standard: alle offen)
     * o.ends   {i: Ende in ms} laufender Schritte (Restzeit aus dem Spiel bzw. executions.data.end)
     * o.anchors {Schlange: {i, at}} erwarteter Start eines offenen Schritts (Startschätzung des Autobuilders)
     * o.lags   {Schlange: h} Abweichung je Schlange; o.lag Rückfall für alle (h)
     * o.slide  false: nicht auf „jetzt“ rücken (Startpunkte fürs Lebenszeichen, ändern sich nicht mit der Uhr)
     * Ergebnis {t: [{q, a, e, due, run} | null (fertig)], first: {Schlange: {i, at}} erster offener Schritt je Schlange}
     */
    function forecast(plan, o = {}) {
        const t0 = Date.parse(plan.startTime), now = o.now ?? Date.now(), slide = o.slide !== false;
        const state = o.state || (() => '0'), ends = o.ends || {}, anc = o.anchors || {}, lags = o.lags || {};
        const Q = {}, first = {}, t = plan.steps.map(() => null);
        if (!isFinite(t0)) return { t, first };
        plan.steps.forEach((s, i) => {
            const c = state(i);
            if (c === '2') return;
            const q = queueOf(plan, i), ps = t0 + s[3] * H, dur = Math.max(0, (s[4] - s[3]) * H);
            const x = Q[q] || (Q[q] = { sh: (isFinite(lags[q]) ? lags[q] : isFinite(o.lag) ? o.lag : 0) * H, last: -Infinity });
            if (c === '1') {
                let e = isFinite(ends[i]) ? ends[i] : ps + x.sh + dur;
                if (slide && e < now) e = now;
                x.sh = e - ps - dur; x.last = Math.max(x.last, e);   // die Schlange ist bis zum Ende belegt, auch gegen eine frühere Startschätzung
                t[i] = { q, a: null, e, due: null, run: true };
                return;
            }
            const A = anc[q];
            if (A && A.i === i && isFinite(A.at)) x.sh = A.at - ps;
            let a = Math.max(ps + x.sh, x.last), due = null;
            if (!first[q]) first[q] = { i, at: Math.round(a) };
            if (slide && a < now) { due = a; a = now; }
            x.sh = a - ps; x.last = a;
            t[i] = { q, a, e: a + dur, due, run: false };
        });
        return { t, first };
    }
    // Abweichung je Schlange aus Starts [{i, t (ms)}]: der zuletzt gestartete Schritt jeder Schlange (h, positiv = Verzug)
    function lagsFrom(plan, starts) {
        const t0 = Date.parse(plan.startTime), last = {}, out = {};
        for (const x of starts || []) {
            const s = plan.steps[x.i];
            if (!s || !isFinite(x.t)) continue;
            const q = queueOf(plan, x.i);
            if (!last[q] || x.t >= last[q].t) last[q] = x;
        }
        for (const [q, x] of Object.entries(last)) out[q] = (x.t - t0) / H - plan.steps[x.i][3];
        return out;
    }
    // Live-Zeit einer Planzeit tau (Faktorwechsel der Heimat) in Schlange q: ausgerichtet am nächsten offenen Schritt dieser Schlange
    // ab tau (gleicher Planabstand), sonst Planzeit + lagH. F = Ergebnis von forecast.
    function atTau(plan, F, tau, q = 'b', lagH = 0) {
        let best = null;
        plan.steps.forEach((s, i) => { const x = F.t[i]; if (x && !x.run && x.q === q && s[3] >= tau && (best == null || s[3] < plan.steps[best][3])) best = i; });
        return best != null ? F.t[best].a - (plan.steps[best][3] - tau) * H : Date.parse(plan.startTime) + (tau + lagH) * H;
    }
    return { queueOf, forecast, lagsFrom, atTau };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Zeitplan;
