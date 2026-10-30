// Zeit-Feed (Nutzer 24.10.2026): je Planet und Schlange eine verlässliche Zeile „läuft gerade / nächster Start (Realzeit) + Wartegrund“.
// Mischt drei Quellen, keine davon ist Pflicht: getData (Server, gd.wake/jobs/colony/colonies), Lebenszeichen des Autobuilders (hb)
// und der Live-Zeitplan (Zeitplan.forecast, F) mit den Ausführungen. Nutzt Zeitplan.queueOf (zeitplan.js vorher laden).
// Zeiten in ms; alle Zugriffe auf Quellen sind defensiv (fehlende Felder → Quelle entfällt, nie eine Exception).
const Zeitfeed = (() => {
    const RN = ['Eisenerz', 'Mineral', 'Treibstoff'];
    const TOL = 90e3;            // Toleranz beim Vergleichen von Zeiten (Startschätzung des Autobuilders ist auf die Minute gerundet)
    const FRISCH = 10 * 60e3;    // Lebenszeichen älter als das zählt nicht
    const num = v => v == null || v === '' || typeof v === 'boolean' ? null : isFinite(+v) ? +v : null;
    const ms = v => v instanceof Date ? (isFinite(+v) ? +v : null)
        : typeof v === 'number' ? (isFinite(v) ? v : null)
        : typeof v === 'string' && isFinite(Date.parse(v)) ? Date.parse(v) : null;
    const low = v => String(v ?? '').toLowerCase();
    const arr = v => Array.isArray(v) ? v : [];

    /**
     * Lineare Rohstoff-Hochrechnung (wie private.gd_wake in der Migration 20261024090001): wann reichen die Rohstoffe für cost?
     * cost [E, M, T]; lager {res:[3], net:[3] je Sekunde, max:[3] (optional), at: ms Zeitpunkt von res}.
     * Ergebnis {at, which, never, reason}:
     *   reichen schon (jetzt) → at null, which null, never false
     *   reichen später       → at ms, which = zuletzt reichender Rohstoff
     *   reichen nie          → at null, never true, which = erster Rohstoff, der nie reicht, reason 'foerderung' (net <= 0) | 'lager' (Bedarf > max)
     * Ungültiges Lager → null.
     */
    // Bestand, Förderung und Lagergrenze eines Rohstoffs x zum Zeitpunkt now (ab Messzeitpunkt lager.at hochgerechnet)
    function stockAt(x, lager, now) {
        const t0 = ms(lager.at), dt = t0 != null ? Math.max(0, (now - t0) / 1000) : 0;
        const r0 = num(lager.res[x]) ?? 0, net = num(lager.net?.[x]) ?? 0, mx = num(lager.max?.[x]);
        const max = mx != null && mx > 0 ? mx : Infinity;
        let have = r0 + net * dt;
        if (net > 0 && isFinite(max)) have = Math.min(have, Math.max(r0, max));   // Lager voll: Förderung stoppt
        if (net < 0) have = Math.max(0, have);
        return { have, net, max };
    }
    function resAt(cost, lager, now = Date.now()) {
        if (!Array.isArray(cost) || !lager || !Array.isArray(lager.res)) return null;
        let at = null, which = null;
        for (let x = 0; x < 3; x++) {
            const c = num(cost[x]) ?? 0, { have, net, max } = stockAt(x, lager, now);
            if (c <= have) continue;
            if (net <= 0) return { at: null, which: RN[x], never: true, reason: 'foerderung' };
            if (c > max) return { at: null, which: RN[x], never: true, reason: 'lager' };
            const t = now + (c - have) / net * 1000;
            if (at == null || t > at) { at = t; which = RN[x]; }
        }
        return { at, which, never: false };
    }
    // Fehlmenge je Rohstoff jetzt (Kosten minus Bestand, nur was fehlt): { Eisenerz: n, … } oder null (nichts fehlt / ungültig)
    function fehlt(cost, lager, now = Date.now()) {
        if (!Array.isArray(cost) || !lager || !Array.isArray(lager.res)) return null;
        const out = {};
        for (let x = 0; x < 3; x++) { const d = (num(cost[x]) ?? 0) - stockAt(x, lager, now).have; if (d >= 1) out[RN[x]] = Math.ceil(d); }
        return Object.keys(out).length ? out : null;
    }
    // Dauer kurz: „45 min“, „2 h 05 min“, „3 T 4 h“
    const dauer = sec => {
        const s = Math.max(0, Math.round(sec / 60) * 60), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
        return d ? `${d} T ${h} h` : h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
    };
    const menge = n => Math.round(n).toLocaleString('de-DE');

    /* Kurztext des Wartegrunds, eine Stelle für alle Ansichten. wait (next.wait aus feed, Nutzer 30.10.2026): worauf genau gewartet wird –
       fehl = fehlende Rohstoffmengen jetzt, frei = Zeitpunkt (ms), zu dem Baustelle/Labor/Werft frei bzw. die Voraussetzung oder der
       Vorgängerschritt fertig ist. */
    function whyText(why, wait = null, now = Date.now()) {
        if (!why || !why.art) return '';
        const fehl = wait?.fehl && typeof wait.fehl === 'object' ? RN.filter(r => wait.fehl[r] > 0).map(r => `${menge(wait.fehl[r])} ${r}`) : [];
        const frei = num(wait?.frei) != null && wait.frei > now ? dauer((wait.frei - now) / 1000) : null;
        const fz = fehl.length ? ` (fehlen ${fehl.join(', ')})` : '';
        switch (why.art) {
            case 'res': return (why.res ? `wartet auf ${why.res}` : 'wartet auf Rohstoffe') + fz;
            case 'baustelle': return (why.detail === 'werft' ? 'Werft belegt' : 'Baustelle belegt') + (frei ? ` (frei in ${frei})` : '');
            case 'labor': return 'Labor belegt' + (frei ? ` (frei in ${frei})` : '');
            case 'voraussetzung': {
                const d = String(why.detail || '').replace(/^Voraussetzung\s*/i, '').trim();
                return (d ? `Voraussetzung fehlt (${d})` : 'Voraussetzung fehlt') + (frei ? `, fertig in ${frei}` : '');
            }
            case 'nach': return `nach #${String(why.detail ?? '').replace(/^#/, '')}` + (frei ? ` (fertig in ${frei})` : '');
            case 'jetzt': return 'startbar';
            case 'plan': return 'laut Plan';
            case 'nie':
                if (why.detail === 'lager') return 'nie (Lager zu klein)' + fz;
                if (why.detail === 'foerderung') return 'nie (keine Förderung)' + fz;
                return (why.detail ? `nie (${why.detail})` : 'nie') + fz;
            default: return '';
        }
    }

    // „why“-Text der Migration (wake.steps[].why) → { art, res?, detail? }
    function wakeWhy(e) {
        const w = String(e.why ?? '');
        const base = (() => {
            if (/^nach #/i.test(w)) return { art: 'nach', detail: w.replace(/^nach #/i, '').trim() };
            if (/^jetzt$/i.test(w)) return { art: 'jetzt' };
            if (/^baustelle$/i.test(w)) return { art: 'baustelle' };
            if (/^labor$/i.test(w)) return { art: 'labor' };
            if (/^voraussetzung/i.test(w)) return { art: 'voraussetzung', detail: w };
            const r = RN.find(n => low(n) === low(w));
            if (r) return { art: 'res', res: r };
            return null;
        })();
        if (e.never === true) {
            if (base && base.art === 'voraussetzung') return base;
            return { art: 'nie', ...(base?.res ? { res: base.res, detail: `${base.res}: Lager zu klein oder keine Förderung` } : w ? { detail: w } : {}) };
        }
        return base || { art: 'jetzt' };
    }

    /**
     * plan  Plan-Payload {id, startTime, steps, stepPlanet, planet, researchPlanet}
     * F     Ergebnis von Zeitplan.forecast / planLive ({t, first})
     * src   {gd, hb, execs} – alle optional; gd = Zeile getdata_state, hb = Lebenszeichen {at, plan, fc, stock, rate, jobs, liveAt}
     * Ergebnis [{ q, planet: 'heim' | Koordinaten | null (Forschung), run: {i, end} | null,
     *            next: {i, at, due, why: {art, res?, detail?}, wait?: {fehl?, frei?}, src: 'getData'|'Autobuilder'|'Plan', srcAt} | null }]
     *   i ab 0; at/due/end/srcAt in ms; next.at ist nie vor jetzt (due = ursprünglich erwarteter Start, wenn schon überfällig);
     *   next.at null bei „nie“ (why.art 'nie', oder 'voraussetzung' ohne Zeit).
     */
    function feed(plan, F, src, now = Date.now()) {
        const steps = plan && Array.isArray(plan.steps) ? plan.steps : null;
        if (!steps) return [];
        src = src || {}; F = F || {};
        const gd = src.gd && typeof src.gd === 'object' ? src.gd : null;
        const hb = src.hb && typeof src.hb === 'object' ? src.hb : null;
        const gdAt = ms(gd?.at) ?? ms(gd?.wake?.calc_at);
        const hbAt = ms(hb?.at);
        const hbFresh = hbAt != null && now - hbAt < FRISCH;
        // im Browser ist Zeitplan global (zeitplan.js vorher geladen), in Node (Tests) kommt es per require
        const ZP = typeof Zeitplan !== 'undefined' ? Zeitplan : require('./zeitplan.js');
        const qOf = i => { try { return ZP.queueOf(plan, i); } catch (e) { return steps[i]?.[0] === 'r' ? 'r' : steps[i]?.[0] || 'b'; } };
        const home = (typeof gd?.colony?.coords === 'string' && gd.colony.coords) || (typeof plan.planet === 'string' && plan.planet) || null;

        // alle Schlangen des Plans: b, r, s, dann je Kolonie
        const qs = [];
        steps.forEach((s, i) => { if (Array.isArray(s)) { const q = qOf(i); if (!qs.includes(q)) qs.push(q); } });
        const rank = q => q === 'b' ? 0 : q === 'r' ? 1 : q === 's' ? 2 : 3;
        qs.sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0));

        // laufende Aufträge je Quelle (echte Endzeiten): getData jobs {k, cls, level, coords, end}, Autobuilder jobs {k, t, l, end}
        const normJobs = list => arr(list).map(j => j && typeof j === 'object' ? { k: j.k, cls: low(j.cls ?? j.t), level: num(j.level ?? j.l), coords: j.coords || null, end: ms(j.end) } : null)
            .filter(j => j && j.end != null && j.end > now && (j.k === 'b' || j.k === 'r' || j.k === 's'));
        const jobQ = j => j.k === 'r' ? 'r' : (!j.coords || j.coords === home) ? j.k : `${j.k}:${j.coords}`;
        const jobSrc = [];
        if (gd && Array.isArray(gd.jobs)) jobSrc.push({ t: gdAt ?? -Infinity, jobs: normJobs(gd.jobs) });
        if (hb && hbFresh && Array.isArray(hb.jobs)) jobSrc.push({ t: hbAt, jobs: normJobs(hb.jobs) });
        jobSrc.sort((a, b) => b.t - a.t);   // die jüngere Quelle zuerst

        const stepOfJob = (q, j) => {
            let best = null;
            steps.forEach((s, i) => {
                if (!Array.isArray(s) || qOf(i) !== q || s[0] !== j.k || low(s[1]) !== j.cls || num(s[2]) !== j.level) return;
                const sc = F.t?.[i]?.run ? 2 : F.t?.[i] ? 1 : 0;
                if (best == null || sc > best.sc) best = { i, sc };
            });
            return best ? best.i : null;
        };
        const runOf = q => {
            for (const s of jobSrc) {
                const js = s.jobs.filter(j => jobQ(j) === q).sort((a, b) => a.end - b.end);
                if (js.length) return { i: stepOfJob(q, js[0]), end: js[0].end };
            }
            let r = null;
            steps.forEach((s, i) => { const x = F.t?.[i]; if (x && x.run && x.q === q && isFinite(x.e) && x.e > now && (!r || x.e > r.end)) r = { i, end: x.e }; });
            return r;
        };

        // Lager des Startplaneten einer Schlange (getData: eigene Lager je Kolonie), sonst Stand des Autobuilders (nur Heimat)
        const mkLager = (o, at) => o && Array.isArray(o.res) ? { res: o.res, net: o.net, max: o.max, at: ms(o.at) ?? at ?? now } : null;
        const lagerOf = q => {
            const c = q === 'r' ? (typeof plan.researchPlanet === 'string' ? plan.researchPlanet : null) : q.includes(':') ? q.slice(q.indexOf(':') + 1) : null;
            const isHome = !c || c === home;
            if (isHome) {
                const L = mkLager(gd?.colony, gdAt);
                if (L) return L;
                return Array.isArray(hb?.stock) ? mkLager({ res: hb.stock, net: hb.rate }, ms(hb.liveAt) ?? hbAt) : null;
            }
            return mkLager(arr(gd?.colonies).find(x => x && x.coords === c), gdAt);
        };

        // Kosten eines Schritts; Werft: Plankosten gelten je Einheit, der Autobuilder bestellt die ganze Menge (steps[i][7]) auf einmal
        const costOf = i => {
            const n = steps[i]?.[0] === 's' ? Math.max(1, num(steps[i][7]) || 1) : 1;
            return Array.isArray(steps[i]?.[6]) ? steps[i][6].map(c => (num(c) ?? 0) * n) : null;
        };
        // Worauf genau gewartet wird (whyText wait): Fehlmengen bei Rohstoffen, sonst Ende des blockierenden Auftrags
        const waitOf = (q, i, why, run) => {
            if (why.art === 'res' || (why.art === 'nie' && why.res)) {
                const c = costOf(i), L = c ? lagerOf(q) : null, f = L ? fehlt(c, L, now) : null;
                return f ? { fehl: f } : null;
            }
            if (why.art === 'baustelle' || why.art === 'labor') return run && run.end > now ? { frei: run.end } : null;
            if (why.art === 'voraussetzung') {   // „Voraussetzung energy 5“: läuft der Auftrag gerade irgendwo, ist er dann fertig
                const m = /([a-z_]+)\s+(\d+)\s*$/i.exec(String(why.detail || ''));
                if (!m) return null;
                const end = Math.min(...jobSrc.flatMap(s => s.jobs).filter(j => j.cls === low(m[1]) && j.level >= +m[2]).map(j => j.end));
                return isFinite(end) ? { frei: end } : null;
            }
            if (why.art === 'nach') {
                const x = F.t?.[(parseInt(why.detail, 10) || 0) - 1];
                return x?.run && isFinite(x.e) && x.e > now ? { frei: x.e } : null;
            }
            return null;
        };

        // Wartegrund aus eigener Rechnung (Quellen b und c)
        const deriveWhy = (q, i, at, run) => {
            const slot = { art: q[0] === 'r' ? 'labor' : 'baustelle', ...(q[0] === 's' ? { detail: 'werft' } : {}) };
            const rEnd = run && run.end > now ? run.end : null;
            const cost = costOf(i), L = cost ? lagerOf(q) : null;
            const r = L ? resAt(cost, L, now) : null;
            if (r?.never) return { art: 'nie', res: r.which, detail: r.reason };
            const resT = r?.at ?? null;
            if (rEnd != null && at <= rEnd + TOL && (resT == null || rEnd >= resT - TOL)) return slot;
            // auch wenn der Zeitplan „jetzt“ sagt, aber die Rohstoffe noch fehlen (Rückfall Plan: überfälliger Schritt)
            if (resT != null && resT > now && (at >= resT - TOL || (at <= now + TOL && resT > now + TOL))) return { art: 'res', res: r.which };
            if (at <= now + TOL) return { art: 'jetzt' };
            return { art: 'plan' };
        };

        const wakeQ = e => e.k === 'r' ? 'r' : e.planet ? `${e.k}:${e.planet}` : e.k;
        const wakeSteps = Array.isArray(gd?.wake?.steps) ? gd.wake.steps.filter(e => e && typeof e === 'object') : [];

        return qs.map(q => {
            const planet = q === 'r' ? null : q.includes(':') ? q.slice(q.indexOf(':') + 1) : 'heim';
            const run = runOf(q);
            const fq = F.first?.[q];
            let next = null;
            if (fq && Number.isInteger(fq.i) && steps[fq.i]) {
                const i = fq.i, ft = F.t?.[i];
                const fin = (raw, source, srcAt, why) => {
                    const never = why.art === 'nie' || raw == null, wait = waitOf(q, i, why, run);
                    // eigene Rechnung (b, c): wartet der Schritt auf Rohstoffe, startet er frühestens, wenn sie reichen
                    if (!never && source !== 'getData' && why.art === 'res') { const c = costOf(i), L = c && lagerOf(q), r = L ? resAt(c, L, now) : null; if (r?.at > raw) raw = r.at; }
                    return { i, at: never ? null : Math.max(raw, now), due: never ? null : (ft?.due ?? (raw < now ? raw : null)), why, ...(wait ? { wait } : {}), src: source, srcAt };
                };
                const e = wakeSteps.find(x => num(x.n) === i + 1 && wakeQ(x) === q);
                const eAt = e ? ms(e.at) : null;
                const fc = hb && hbFresh && hb.plan === plan.id && hb.fc && typeof hb.fc === 'object' ? hb.fc[q] : null;
                const fcAt = fc && Number.isInteger(fc.i) && fc.i === i ? ms(fc.at) : null;
                if (e && (eAt != null || e.never === true)) {          // (a) getData
                    next = fin(e.never === true ? null : eAt, 'getData', gdAt ?? now, wakeWhy(e));
                } else if (fcAt != null) {                              // (b) Lebenszeichen des Autobuilders
                    const at = Math.max(fcAt, now), why = deriveWhy(q, i, at, run);
                    next = fin(why.art === 'nie' ? null : fcAt, 'Autobuilder', hbAt, why);
                } else if (ft || isFinite(fq.at)) {                     // (c) Rückfall: Live-Zeitplan
                    const raw = isFinite(fq.at) ? fq.at : ft.a, at = Math.max(raw, now), why = deriveWhy(q, i, at, run);
                    next = fin(why.art === 'nie' ? null : raw, 'Plan', now, why);
                }
            }
            return { q, planet, run, next };
        });
    }

    return { resAt, fehlt, feed, whyText };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Zeitfeed;
