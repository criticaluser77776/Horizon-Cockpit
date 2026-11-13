// Ascension / Farmphase (13.11.2026): reine Funktionen zum Zeitplan der Aufstiege (Supabase wissen/ascension, erzeugt von
// analyse/ascension/zeitplan.js), gemeinsam für Cockpit-Karte (app.js) und Atlas-Ansicht (details/ascension.js). Kein DOM, kein require.
// Zeiten: tNull = Aufstieg 1 (ISO), Blöcke in Stunden ab tNull. Ein Farm-Block fasst Aufstiege mit gleicher Verteilung zusammen
// (anzahl Aufstiege zwischen von und bis, gleichmäßig verteilt gerechnet). Fehlende Felder = Standard (anzahl 1, bis = von, Tbis = T);
// grob = mehrere Blöcke einer Nicht-Empfehlung zusammengefasst (Verteilung des letzten Aufstiegs, zeitplan.js verdichte).
const Asc = (() => {
    const H = 3600e3;
    // feste Reihenfolge der Verteilung (Kürzel aus content.namen)
    const SK_ORDER = ['ics', 'vv', 'gk', 'gah', 'preis', 'forschung', 'tempo', 'foerd', 'metall', 'mineral', 'treibstoff'];
    const ART = { neuaufbau: 'Neuaufbau', uebergang: 'Übergang', farm: 'Farmen' };

    const keyOf = (mult, betrieb) => `${mult ? 'mult' : 'add'}-${betrieb}`;
    const findVariante = (c, key) => (c?.varianten || []).find(v => v.key === key) || null;
    // Standard: Empfehlung zu Annahme + Betrieb (Standard mult/auto), sonst die erste Variante
    function waehleVariante(c, o = {}) {
        const vs = c?.varianten || [];
        if (!vs.length) return null;
        if (o.key) { const v = findVariante(c, o.key); if (v) return v; }
        const mult = o.mult ?? true, betrieb = o.betrieb || 'auto';
        const emp = findVariante(c, c.empfehlung?.[keyOf(mult, betrieb)]);
        if (o.ueb == null && o.supAb == null) return emp || vs.find(v => !!v.mult === mult && v.betrieb === betrieb) || vs[0];
        return vs.find(v => !!v.mult === mult && v.betrieb === betrieb && (o.ueb == null || v.ueb === o.ueb) && (o.supAb == null || v.supAb === o.supAb))
            || emp || vs[0];
    }

    // Verteilung als Text: „Supremum 3 · Vervielfältigung 12 · …“ in fester Reihenfolge; Kürzel ohne Name erscheinen mit dem Kürzel
    function skText(sk, namen = {}) {
        if (!sk) return '–';
        const keys = [...SK_ORDER.filter(k => sk[k] > 0), ...Object.keys(sk).filter(k => !SK_ORDER.includes(k) && sk[k] > 0)];
        return keys.length ? keys.map(k => `${namen[k] || k} ${sk[k]}`).join(' · ') : '–';
    }

    // Zeitpunkte der einzelnen Aufstiege je Block (Farm-Blöcke gleichmäßig zwischen von und bis)
    function aufstiege(v, tNull) {
        const t0 = typeof tNull === 'number' ? tNull : Date.parse(tNull), out = [];
        (v?.bloecke || []).forEach((b, bi) => {
            const n = Math.max(1, b.anzahl || 1);
            for (let j = 0; j < n; j++) {
                const f = n > 1 ? j / (n - 1) : 0;
                out.push({ bi, j, nr: b.nr + j, art: b.art, sk: b.sk, h: b.h, apJe: b.apJe, live: !!b.live && j === 0,
                    at: t0 + (b.von + ((b.bis ?? b.von) - b.von) * f) * H, ap: b.T + ((b.Tbis ?? b.T) - b.T) * f });
            }
        });
        return out;
    }

    /**
     * Laufender Durchgang und nächster Aufstieg.
     * Ergebnis {block, blockIdx, durchgangNr, art, sk, seit (Date), naechsterAufstieg: {wann, nr, apNach, skDanach, artDanach} | null, vorStart}
     * Vor dem ersten Block läuft noch der Durchgang nach Aufstieg 1 (art 'neuaufbau', sk unbekannt).
     */
    function phaseJetzt(v, tNull, jetzt) {
        const ev = aufstiege(v, tNull), now = jetzt instanceof Date ? jetzt.getTime() : jetzt;
        if (!ev.length) return null;
        let i = -1;
        for (let k = 0; k < ev.length && ev[k].at <= now; k++) i = k;
        const nxt = ev[i + 1], mk = e => ({ wann: new Date(e.at), nr: e.nr, apNach: e.ap, skDanach: e.sk, artDanach: e.art });
        if (i < 0) {
            const t0 = typeof tNull === 'number' ? tNull : Date.parse(tNull);
            return { block: null, blockIdx: -1, durchgangNr: ev[0].nr, art: 'neuaufbau', sk: null, seit: new Date(t0), naechsterAufstieg: mk(ev[0]), vorStart: true };
        }
        const e = ev[i];
        return { block: v.bloecke[e.bi], blockIdx: e.bi, durchgangNr: e.nr + 1, art: e.art, sk: e.sk, seit: new Date(e.at),
            naechsterAufstieg: nxt ? mk(nxt) : null, vorStart: false };
    }

    // Datum „Mo 23.11. 12:10“ in Europe/Berlin
    function datumText(d) {
        const x = d instanceof Date ? d : new Date(d);
        if (d == null || !isFinite(x)) return '–';
        const p = Object.fromEntries(new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', weekday: 'short', day: '2-digit', month: '2-digit',
            hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(x).map(q => [q.type, q.value]));
        return `${String(p.weekday).replace('.', '')} ${p.day}.${p.month}. ${p.hour}:${p.minute}`;
    }
    // Tag ab tNull (Zahl, auch Bruchteile) → Date; null bleibt null
    const tagDatum = (tNull, tag) => tag == null ? null : new Date(Date.parse(tNull) + tag * 24 * H);
    const tagText = (tNull, tag) => tag == null ? '–' : `${datumText(tagDatum(tNull, tag))} (Tag ${Math.round(tag)})`;
    // AP-Zahl: ab 1000 ohne Nachkommastellen, ab 100 eine, sonst zwei (deutsche Schreibweise)
    function apText(n) {
        if (n == null || !isFinite(n)) return '–';
        const d = Math.abs(n) >= 1000 ? 0 : Math.abs(n) >= 100 ? 1 : 2;
        return new Intl.NumberFormat('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
    }
    // Block-Zeitraum als Date-Paar (von, bis des ersten bzw. letzten Aufstiegs im Block)
    const blockZeit = (b, tNull) => { const t0 = Date.parse(tNull); return [new Date(t0 + b.von * H), new Date(t0 + (b.bis ?? b.von) * H)]; };
    // Nummernbereich eines Blocks: „12“ oder „12–40“
    const blockNr = b => (b.anzahl || 1) > 1 ? `${b.nr}–${b.nr + b.anzahl - 1}` : String(b.nr);

    // Abgleich eines echten Farm-Aufstiegs (R14, Ereignis „aufstieg“ mit data.farm des Autobuilders ab 0.7.48) mit dem Zeitplan:
    // ist {at (ms oder ISO), T (AP-Summe nach dem Aufstieg)} → {soll: letzter geplanter Aufstieg bis at {nr, ap, at}, diff: T/ap − 1,
    // vorH: Zeitvorsprung in h (wann der Zeitplan diese AP-Summe erreicht, positiv = früher als geplant)} oder null
    function abgleich(v, tNull, ist) {
        const at = typeof ist?.at === 'number' ? ist.at : Date.parse(ist?.at || ''), T = +ist?.T;
        if (!isFinite(at) || !(T > 0)) return null;
        const ev = aufstiege(v, tNull);
        let soll = null;
        for (const e of ev) if (e.at <= at) soll = e;
        if (!soll) return null;
        const hit = ev.find(e => e.ap >= T - 1e-9);
        return { soll: { nr: soll.nr, ap: soll.ap, at: soll.at }, diff: T / soll.ap - 1, vorH: hit ? (hit.at - at) / H : null };
    }

    return { SK_ORDER, ART, keyOf, findVariante, waehleVariante, skText, aufstiege, phaseJetzt, datumText, tagDatum, tagText, apText, blockZeit, blockNr, abgleich };
})();
if (typeof window !== 'undefined') window.Asc = Asc;
if (typeof module !== 'undefined' && module.exports) module.exports = Asc;
