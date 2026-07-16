"use client";

/**
 * Tamanor landing v2 — "mission control" redesign.
 * Route: /v2 (see app/v2/page.tsx). Self-contained: fonts via v2/layout.tsx,
 * styles inline + a few keyframes injected below. No external deps.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FooterV2 } from "./footer-v2";
import type { Dictionary, Locale } from "@/i18n";
import { locales, localeShort, localePrefix, LOCALE_COOKIE } from "@/i18n/config";

type L2 = Dictionary["landingV2"];
export type LandingV2Props = {
  copy: L2;
  startFree: string;
  logIn: string;
  footer: Dictionary["footer"];
  locale: Locale;
};

/* ---------- palette ---------- */
const C = {
  bg: "#030b09",
  panel: "#04100d",
  line: "#0f2b25",
  mint: "#2ee3b2",
  bright: "#eafff8",
  text: "#d9fff2",
  dim: "#6fa093",
  faint: "#3c6459",
  red: "#ff4d5e",
  amber: "#ffb454",
};

const KEYFRAMES = `
@keyframes tmr-tkr { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
@keyframes tmr-spin { to { transform: rotate(360deg); } }
@keyframes tmr-blip { 0%,100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.9); opacity: .35; } }
@keyframes tmr-blink { 0%,49% { opacity: 1; } 50%,100% { opacity: 0; } }
@keyframes tmr-glow { 0%,100% { filter: drop-shadow(0 0 18px rgba(46,227,178,.55)); } 50% { filter: drop-shadow(0 0 42px rgba(46,227,178,.95)); } }
.tmr-v2 details > summary { list-style: none; }
.tmr-v2 details > summary::-webkit-details-marker { display: none; }
.tmr-v2 details[open] .tmr-faq-sign { transform: rotate(45deg); }
/* V1.58D.3 — mobile: stack multi-column sections; no horizontal overflow. */
@media (max-width: 860px) {
  .tmr-v2 .tmr-cols { grid-template-columns: 1fr !important; }
  .tmr-v2 .tmr-kpi { grid-template-columns: repeat(2, 1fr) !important; }
  .tmr-v2 .tmr-nav, .tmr-v2 .tmr-online { display: none !important; }
}
@media (max-width: 420px) {
  .tmr-v2 .tmr-cta { display: none !important; }
}
`;

const mono = "var(--font-mono-v2), ui-monospace, Menlo, monospace";
const disp = "var(--font-disp-v2), ui-sans-serif, system-ui, sans-serif";

/* ---------- firewall canvas simulation ---------- */

type Packet = { x: number; y: number; vx: number; threat: boolean; crossed: boolean; hit?: boolean; tag: string };
type Particle = { x: number; y: number; vx: number; vy: number; life: number; hot: boolean };
type Ripple = { x: number; y: number; r: number; a: number; mint?: boolean };

function FirewallSim({
  threatRatio = 0.38,
  onCount,
  tags,
}: {
  threatRatio?: number;
  onCount?: (intercepted: number, delivered: number) => void;
  tags: { threat: readonly string[]; clean: readonly string[] };
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    let raf = 0;
    let dead = false;
    let lastSpawn = 0;
    const packets: Packet[] = [];
    const parts: Particle[] = [];
    const ripples: Ripple[] = [];
    let ic = 12847;
    let dc = 48102;

    const tick = (t: number) => {
      if (dead || !cv.isConnected) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = cv.clientWidth;
      const h = cv.clientHeight;
      if (w && h) {
        if (cv.width !== Math.round(w * dpr)) {
          cv.width = Math.round(w * dpr);
          cv.height = Math.round(h * dpr);
        }
        const ctx = cv.getContext("2d")!;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        const wallX = w * 0.6;
        const laneTop = 34;
        const laneBot = h - 66;

        ctx.strokeStyle = "rgba(46,227,178,0.05)";
        ctx.lineWidth = 1;
        for (let x = 0; x < w; x += 64) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, h);
          ctx.stroke();
        }

        if (t - lastSpawn > 620) {
          lastSpawn = t;
          const threat = Math.random() < threatRatio;
          const pool = threat ? tags.threat : tags.clean;
          packets.push({
            x: -110,
            y: laneTop + Math.random() * (laneBot - laneTop - 30),
            vx: 1.5 + Math.random() * 1.1,
            threat,
            crossed: false,
            tag: pool[Math.floor(Math.random() * pool.length)] ?? "",
          });
        }

        const pulse = 0.65 + 0.35 * Math.sin(t / 320);
        ctx.save();
        ctx.shadowColor = `rgba(46,227,178,${0.8 * pulse})`;
        ctx.shadowBlur = 22;
        ctx.strokeStyle = `rgba(46,227,178,${0.55 + 0.35 * pulse})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(wallX, 14);
        ctx.lineTo(wallX, h - 60);
        ctx.stroke();
        ctx.restore();
        ctx.strokeStyle = "rgba(46,227,178,0.25)";
        ctx.lineWidth = 6;
        ctx.setLineDash([2, 10]);
        ctx.beginPath();
        ctx.moveTo(wallX, 14);
        ctx.lineTo(wallX, h - 60);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = "600 9px var(--font-mono-v2), monospace";
        ctx.fillStyle = "rgba(46,227,178,0.8)";
        ctx.fillText("TAMANOR", wallX - 22, 12);

        const pw = 104;
        const ph = 26;
        for (let i = packets.length - 1; i >= 0; i--) {
          const p = packets[i];
          if (!p) continue;
          p.x += p.vx;
          if (p.threat && p.x + pw >= wallX && !p.hit) {
            p.hit = true;
            for (let k = 0; k < 16; k++)
              parts.push({
                x: wallX,
                y: p.y + ph / 2,
                vx: -Math.random() * 3.4 - 0.3,
                vy: (Math.random() - 0.5) * 4.4,
                life: 1,
                hot: Math.random() < 0.5,
              });
            ripples.push({ x: wallX, y: p.y + ph / 2, r: 4, a: 0.9 });
            packets.splice(i, 1);
            ic++;
            onCount?.(ic, dc);
            continue;
          }
          if (!p.threat && !p.crossed && p.x >= wallX) {
            p.crossed = true;
            ripples.push({ x: wallX, y: p.y + ph / 2, r: 3, a: 0.5, mint: true });
          }
          if (p.x > w + 20) {
            packets.splice(i, 1);
            dc++;
            onCount?.(ic, dc);
            continue;
          }
          const c = p.threat ? "rgba(255,77,94," : "rgba(46,227,178,";
          ctx.fillStyle = "rgba(4,16,13,0.92)";
          ctx.strokeStyle = c + (p.crossed ? "0.85)" : "0.4)");
          ctx.lineWidth = 1;
          ctx.fillRect(p.x, p.y, pw, ph);
          ctx.strokeRect(p.x, p.y, pw, ph);
          ctx.fillStyle = c + "0.9)";
          ctx.fillRect(p.x + 8, p.y + ph / 2 - 2.5, 5, 5);
          ctx.fillStyle = "rgba(217,255,242,0.75)";
          ctx.font = "600 8px var(--font-mono-v2), monospace";
          ctx.fillText(p.tag, p.x + 19, p.y + ph / 2 + 3);
          ctx.fillStyle = "rgba(111,160,147,0.35)";
          ctx.fillRect(p.x + 62, p.y + 8, 34, 3);
          ctx.fillRect(p.x + 62, p.y + 15, 24, 3);
        }

        for (let i = parts.length - 1; i >= 0; i--) {
          const q = parts[i];
          if (!q) continue;
          q.x += q.vx;
          q.y += q.vy;
          q.vy += 0.05;
          q.life -= 0.026;
          if (q.life <= 0) {
            parts.splice(i, 1);
            continue;
          }
          ctx.fillStyle = (q.hot ? "rgba(255,180,84," : "rgba(255,77,94,") + q.life + ")";
          ctx.fillRect(q.x, q.y, 2.4, 2.4);
        }

        for (let i = ripples.length - 1; i >= 0; i--) {
          const r = ripples[i];
          if (!r) continue;
          r.r += 2.1;
          r.a -= 0.028;
          if (r.a <= 0) {
            ripples.splice(i, 1);
            continue;
          }
          ctx.strokeStyle = (r.mint ? "rgba(46,227,178," : "rgba(255,77,94,") + r.a + ")";
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      dead = true;
      cancelAnimationFrame(raf);
    };
  }, [threatRatio, onCount]);

  return <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }} />;
}

/* ---------- small shared bits ---------- */

const eyebrow: React.CSSProperties = {
  margin: 0,
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.22em",
  color: C.mint,
  fontFamily: mono,
};

function Corner({ pos }: { pos: "tl" | "tr" | "bl" | "br" }) {
  const s: React.CSSProperties = { position: "absolute", height: 14, width: 14, zIndex: 5 };
  if (pos === "tl") Object.assign(s, { top: -1, left: -1, borderTop: `2px solid ${C.mint}`, borderLeft: `2px solid ${C.mint}` });
  if (pos === "tr") Object.assign(s, { top: -1, right: -1, borderTop: `2px solid ${C.mint}`, borderRight: `2px solid ${C.mint}` });
  if (pos === "bl") Object.assign(s, { bottom: -1, left: -1, borderBottom: `2px solid ${C.mint}`, borderLeft: `2px solid ${C.mint}` });
  if (pos === "br") Object.assign(s, { bottom: -1, right: -1, borderBottom: `2px solid ${C.mint}`, borderRight: `2px solid ${C.mint}` });
  return <span style={s} />;
}

function Clock() {
  const ref = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    const id = setInterval(() => {
      if (ref.current) ref.current.textContent = new Date().toTimeString().slice(0, 8);
    }, 1000);
    return () => clearInterval(id);
  }, []);
  return <span ref={ref}>00:00:00</span>;
}

/* ---------- data (non-textual / technical only) ---------- */

const BLIPS = [
  { top: "22%", left: "60%", danger: true, label: "fb:8842 · 0.91" },
  { top: "62%", left: "70%", danger: false, label: "ig:2214 · 0.44" },
  { top: "38%", left: "20%", danger: false, label: "fb:5511 · 0.38" },
  { top: "74%", left: "34%", danger: true, label: "fb:9917 · 0.87" },
];

// Self-serve monthly prices by plan index (Starter/Growth/Agency); Enterprise (index 3) is contact-sales.
const PLAN_PRICES = [49, 149, 399, null] as const;

/* ---------- language switcher (existing convention: cookie + locale-prefixed route) ---------- */

function LangSwitchV2({ locale }: { locale: Locale }) {
  return (
    <div role="group" aria-label="Language" style={{ display: "inline-flex", gap: 2, border: `1px solid ${C.line}`, padding: 2 }}>
      {locales.map((l) => {
        const on = l === locale;
        return (
          <Link
            key={l}
            href={localePrefix(l) || "/"}
            onClick={() => { document.cookie = `${LOCALE_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`; }}
            aria-current={on ? "true" : undefined}
            style={{ padding: "4px 9px", fontSize: 10, fontFamily: mono, textTransform: "uppercase", letterSpacing: "0.08em", textDecoration: "none", ...(on ? { background: C.mint, color: C.bg, fontWeight: 600 } : { color: C.dim }) }}
          >
            {localeShort[l]}
          </Link>
        );
      })}
    </div>
  );
}

/* ---------- page ---------- */

export function LandingV2({ copy, startFree, logIn, footer, locale }: LandingV2Props) {
  const [yearly, setYearly] = useState(false);
  const icRef = useRef<HTMLSpanElement | null>(null);
  const dcRef = useRef<HTMLSpanElement | null>(null);

  const price = (m: number) => `€${yearly ? m * 10 : m}`;
  const per = yearly ? copy.perYr : copy.perMo;

  const plans = copy.plans.map((p, i) => {
    const m = PLAN_PRICES[i] ?? null;
    return {
      name: p.name,
      pop: i === 1,
      isEnterprise: i === 3,
      price: m === null ? copy.entPrice : price(m),
      per: m === null ? copy.entPer : per,
      tagline: p.tagline,
      cta: p.cta,
      features: p.features,
    };
  });

  const navA: React.CSSProperties = { color: C.dim, fontFamily: mono };
  const secBorder = `1px solid ${C.line}`;

  return (
    <div className="tmr-v2" style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "var(--font-sans-v2), ui-sans-serif, system-ui, sans-serif", overflow: "hidden" }}>
      <style dangerouslySetInnerHTML={{ __html: KEYFRAMES }} />

      {/* scanlines + vignette */}
      <div style={{ position: "fixed", inset: 0, zIndex: 60, pointerEvents: "none", background: "repeating-linear-gradient(0deg, rgba(46,227,178,.028) 0 1px, transparent 1px 3px)" }} />
      <div style={{ position: "fixed", inset: 0, zIndex: 60, pointerEvents: "none", background: "radial-gradient(120% 90% at 50% 10%, transparent 55%, rgba(0,0,0,.5) 100%)" }} />

      {/* header */}
      <header style={{ position: "sticky", top: 0, zIndex: 40, borderBottom: secBorder, background: "rgba(3,11,9,.88)", backdropFilter: "blur(10px)" }}>
        <div style={{ maxWidth: 1280, margin: "0 auto", display: "flex", height: 54, alignItems: "center", justifyContent: "space-between", padding: "0 24px", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
            <svg width="22" height="22" viewBox="0 0 32 32" fill="none" style={{ filter: "drop-shadow(0 0 8px rgba(46,227,178,.6))" }}>
              <path d="M16 3 5 6.5v7.2c0 6.4 4.5 10.7 11 13.3 6.5-2.6 11-6.9 11-13.3V6.5L16 3Z" fill={C.mint} />
              <rect x="11" y="14.5" width="10" height="8" rx="1.6" fill={C.bg} />
              <path d="M13 14.5v-1.8a3 3 0 0 1 6 0v1.8" stroke={C.bg} strokeWidth="1.7" strokeLinecap="round" />
            </svg>
            <span style={{ display: "flex", flexDirection: "column", lineHeight: 1 }}>
              <span style={{ fontFamily: disp, fontSize: 18, textTransform: "none", letterSpacing: "-0.01em", color: C.text, fontWeight: 600 }}>Tamanor</span>
              <span style={{ marginTop: 3, fontSize: 8, letterSpacing: "0.14em", color: C.faint, fontFamily: mono }}>{copy.tagline}</span>
            </span>
          </span>
          <nav className="tmr-nav" style={{ display: "flex", gap: 22 }}>
            <a href="#wall" style={navA}>{copy.navFirewall}</a>
            <a href="#phases" style={navA}>{copy.navProtocol}</a>
            <a href="#radar" style={navA}>{copy.navActorRisk}</a>
            <a href="#diag" style={navA}>{copy.navDiagnostics}</a>
            <a href="#pricing" style={navA}>{copy.navPricing}</a>
          </nav>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span className="tmr-online" style={{ display: "inline-flex", alignItems: "center", gap: 6, color: C.dim, fontFamily: mono }}>
              <span style={{ height: 6, width: 6, borderRadius: 9999, background: C.mint, boxShadow: `0 0 8px ${C.mint}` }} />{copy.online}
            </span>
            <LangSwitchV2 locale={locale} />
            <Link href="/register" className="tmr-cta" style={{ border: `1px solid ${C.mint}`, background: C.mint, color: C.bg, padding: "8px 16px", fontWeight: 600, fontFamily: mono }}>{startFree}</Link>
          </div>
        </div>
      </header>

      {/* hero */}
      <section id="wall" style={{ position: "relative", borderBottom: secBorder, background: "radial-gradient(70rem 30rem at 50% -20%, rgba(46,227,178,.09), transparent 60%)" }}>
        <div style={{ maxWidth: 1280, margin: "0 auto", padding: "66px 24px 28px" }}>
          <p style={{ ...eyebrow, display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ height: 1, width: 34, background: C.mint }} />{copy.heroEyebrow}
          </p>
          <h1 style={{ margin: "20px 0 0", maxWidth: "18ch", fontSize: "clamp(32px, 5.4vw, 52px)", lineHeight: 1.08, fontWeight: 600, color: C.bright, fontFamily: disp, letterSpacing: "-0.03em", textShadow: "0 0 60px rgba(46,227,178,.25)" }}>
            {copy.heroA} <span style={{ fontStyle: "italic", color: C.mint }}>{copy.heroB}</span>
          </h1>
          <div style={{ marginTop: 26, display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24, flexWrap: "wrap" }}>
            <p style={{ margin: 0, maxWidth: "52ch", fontSize: 15, lineHeight: 1.75, color: C.dim }}>
              {copy.heroBody}
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <Link href="/register" style={{ border: `1px solid ${C.mint}`, background: C.mint, color: C.bg, padding: "14px 26px", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", boxShadow: "0 0 34px rgba(46,227,178,.35)", fontFamily: mono }}>{copy.deployFree}</Link>
              <a href="#phases" style={{ border: secBorder, color: C.text, padding: "14px 26px", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: mono }}>{copy.theProtocol}</a>
            </div>
          </div>
        </div>

        {/* sim panel */}
        <div style={{ maxWidth: 1280, margin: "26px auto 0", padding: "0 24px 56px" }}>
          <div style={{ position: "relative", height: 340, border: secBorder, background: C.panel }}>
            <Corner pos="tl" /><Corner pos="tr" /><Corner pos="bl" /><Corner pos="br" />
            <FirewallSim
              tags={copy.tags}
              onCount={(ic, dc) => {
                if (icRef.current) icRef.current.textContent = ic.toLocaleString("en-US");
                if (dcRef.current) dcRef.current.textContent = dc.toLocaleString("en-US");
              }}
            />
            <div style={{ position: "absolute", top: 12, left: 16, zIndex: 5, display: "flex", gap: 18, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.14em", color: C.faint, fontFamily: mono }}>
              <span>{copy.feedInbound}</span><span style={{ color: C.mint }}>{copy.liveSim}</span>
            </div>
            <div style={{ position: "absolute", top: 12, right: 16, zIndex: 5, fontSize: 10, letterSpacing: "0.14em", color: C.faint, fontFamily: mono }}>
              <Clock /> {copy.utc}
            </div>
            <div className="tmr-kpi" style={{ position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 5, display: "grid", gridTemplateColumns: "repeat(4,1fr)", borderTop: secBorder, background: "rgba(3,11,9,.9)" }}>
              {[
                { l: copy.c1, v: <span ref={icRef}>12,847</span>, c: C.red },
                { l: copy.c2, v: <span ref={dcRef}>48,102</span>, c: C.mint },
                { l: copy.c3, v: "3", c: C.amber },
                { l: copy.c4, v: <>0 <span style={{ fontSize: 11, fontFamily: mono, color: C.faint }}>{copy.humansDecide}</span></>, c: C.text },
              ].map((s, i) => (
                <div key={i} style={{ padding: "12px 16px", borderRight: i < 3 ? secBorder : "none" }}>
                  <p style={{ margin: 0, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.16em", color: C.faint, fontFamily: mono }}>{s.l}</p>
                  <p style={{ margin: "3px 0 0", fontSize: 24, color: s.c, fontFamily: disp, fontWeight: 600 }}>{s.v}</p>
                </div>
              ))}
            </div>
          </div>
          <p style={{ margin: "14px 0 0", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.12em", color: C.faint, fontFamily: mono }}>
            {copy.heroFootnote}
          </p>
        </div>
      </section>

      {/* ticker */}
      <section style={{ borderBottom: secBorder, background: C.panel, overflow: "hidden" }}>
        <div style={{ display: "inline-flex", whiteSpace: "nowrap", animation: "tmr-tkr 28s linear infinite", padding: "10px 0", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: mono }}>
          {[...copy.ticker, ...copy.ticker].map((t, i) => (
            <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 8, marginRight: 34 }}>
              <span style={{ color: C.faint }}>{t.time}</span>
              <span style={{ color: t.bad ? C.red : C.mint }}>{t.verb}</span>
              <span style={{ color: C.dim }}>{t.what}</span>
            </span>
          ))}
        </div>
      </section>

      {/* phases */}
      <section id="phases" style={{ borderBottom: secBorder }}>
        <div style={{ maxWidth: 1280, margin: "0 auto", padding: "84px 24px" }}>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 20, marginBottom: 44 }}>
            <div>
              <p style={eyebrow}>SYS / 01 — {copy.protocolEyebrow}</p>
              <h2 style={{ margin: "16px 0 0", fontSize: "clamp(26px, 3.6vw, 38px)", lineHeight: 1.08, fontWeight: 600, color: C.bright, fontFamily: disp, letterSpacing: "-0.03em" }}>
                {copy.phasesA} <span style={{ fontStyle: "italic", color: C.mint }}>{copy.phasesB}</span>
              </h2>
            </div>
            <p style={{ maxWidth: "36ch", fontSize: 13, lineHeight: 1.7, color: C.dim }}>{copy.phasesSub}</p>
          </div>
          <div className="tmr-kpi" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 1, background: C.line, border: secBorder }}>
            {copy.steps.map((s, i) => (
              <div key={s.name} style={{ background: C.bg, padding: "26px 24px", minHeight: 190 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.18em", color: C.faint, fontFamily: mono }}>{copy.phaseWord} 0{i + 1}</span>
                  <span style={{ height: 6, width: 6, borderRadius: 9999, background: C.mint, boxShadow: `0 0 8px ${C.mint}` }} />
                </div>
                <h3 style={{ margin: "14px 0 0", fontSize: 21, fontWeight: 600, color: C.bright, fontFamily: disp }}>{s.name}</h3>
                <p style={{ margin: "10px 0 0", fontSize: 13, lineHeight: 1.7, color: C.dim }}>{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* radar */}
      <section id="radar" style={{ borderBottom: secBorder, background: C.panel }}>
        <div className="tmr-cols" style={{ maxWidth: 1280, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 40, alignItems: "center", padding: "84px 24px" }}>
          <div style={{ position: "relative", margin: "0 auto", height: 420, width: 420 }}>
            {[0, 52, 104, 156].map((inset) => (
              <div key={inset} style={{ position: "absolute", inset, borderRadius: "50%", border: secBorder }} />
            ))}
            <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: C.line }} />
            <div style={{ position: "absolute", top: "50%", left: 0, right: 0, height: 1, background: C.line }} />
            <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "conic-gradient(from 0deg, rgba(46,227,178,.35), transparent 70deg, transparent 360deg)", animation: "tmr-spin 4.6s linear infinite" }} />
            <div style={{ position: "absolute", left: "50%", top: "50%", height: 10, width: 10, margin: "-5px 0 0 -5px", borderRadius: "50%", background: C.mint, boxShadow: `0 0 14px ${C.mint}` }} />
            {BLIPS.map((b) => (
              <div key={b.label} style={{ position: "absolute", top: b.top, left: b.left, display: "flex", alignItems: "center", gap: 7, zIndex: 3 }}>
                <span style={{ height: 9, width: 9, borderRadius: 9999, flexShrink: 0, background: b.danger ? C.red : C.amber, boxShadow: `0 0 12px ${b.danger ? C.red : C.amber}`, animation: "tmr-blip 1.8s ease-in-out infinite" }} />
                <span style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.12em", color: C.dim, whiteSpace: "nowrap", fontFamily: mono }}>{b.label}</span>
              </div>
            ))}
          </div>
          <div>
            <p style={eyebrow}>SYS / 02 — {copy.actorEyebrow}</p>
            <h2 style={{ margin: "16px 0 0", fontSize: "clamp(26px, 3.6vw, 38px)", lineHeight: 1.08, fontWeight: 600, color: C.bright, fontFamily: disp, letterSpacing: "-0.03em" }}>
              {copy.radarA} <span style={{ fontStyle: "italic", color: C.mint }}>{copy.radarB}</span>
            </h2>
            <p style={{ margin: "20px 0 0", maxWidth: "46ch", fontSize: 15, lineHeight: 1.75, color: C.dim }}>
              {copy.radarBody}
            </p>
            <div style={{ marginTop: 26, display: "flex", flexDirection: "column", gap: 8, fontSize: 12, fontFamily: mono }}>
              {copy.actors.map((r, i) => (
                <div key={r.a} style={{ display: "flex", justifyContent: "space-between", border: secBorder, padding: "10px 14px" }}>
                  <span style={{ color: C.dim }}>{r.a}</span><span style={{ color: [C.red, C.amber, C.mint][i] ?? C.dim }}>{r.s}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* approval */}
      <section style={{ borderBottom: secBorder }}>
        <div className="tmr-cols" style={{ maxWidth: 1280, margin: "0 auto", display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: 48, alignItems: "center", padding: "84px 24px" }}>
          <div>
            <p style={eyebrow}>SYS / 03 — {copy.commandEyebrow}</p>
            <h2 style={{ margin: "16px 0 0", fontSize: "clamp(30px, 4vw, 44px)", lineHeight: 1.16, fontWeight: 600, color: C.bright, fontFamily: disp, letterSpacing: "-0.03em" }}>
              {copy.cmdA}<br /><span style={{ fontStyle: "italic", color: C.mint }}>{copy.cmdB}</span>
            </h2>
            <p style={{ margin: "22px 0 0", maxWidth: "46ch", fontSize: 15, lineHeight: 1.75, color: C.dim }}>
              {copy.cmdBody}
            </p>
            <p style={{ margin: "18px 0 0", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.1em", color: C.faint, fontFamily: mono }}>
              {copy.cmdCursor}<span style={{ animation: "tmr-blink 1.1s step-end infinite" }}>_</span>
            </p>
          </div>
          <div style={{ border: secBorder, background: C.panel, padding: 22 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.14em", color: C.faint, fontFamily: mono }}>
              <span>{copy.cardSource}</span><span style={{ color: C.amber }}>{copy.cardPending}</span>
            </div>
            <p style={{ margin: "16px 0 0", fontSize: 14, lineHeight: 1.65, color: C.text }}>
              {copy.cardComment}
            </p>
            <div style={{ marginTop: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.14em", fontFamily: mono }}>
                <span style={{ color: C.faint }}>{copy.cardScore}</span><span style={{ color: C.red }}>{copy.cardHigh}</span>
              </div>
              <div style={{ marginTop: 7, height: 5, background: C.line }}>
                <div style={{ height: "100%", width: "82%", background: `linear-gradient(90deg,${C.amber},${C.red})`, boxShadow: "0 0 12px rgba(255,77,94,.5)" }} />
              </div>
              <div style={{ marginTop: 12, display: "flex", gap: 6 }}>
                {[copy.cardTag1, copy.cardTag2].map((t) => (
                  <span key={t} style={{ border: "1px solid #3a1620", background: "#160a0e", color: C.red, padding: "3px 10px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: mono }}>{t}</span>
                ))}
              </div>
            </div>
            <div style={{ marginTop: 20, display: "flex", gap: 8 }}>
              <button style={{ flex: 1, border: secBorder, background: "transparent", color: C.dim, padding: 12, fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", cursor: "pointer", fontFamily: mono }}>{copy.cardReject}</button>
              <button style={{ flex: 2, border: `1px solid ${C.mint}`, background: C.mint, color: C.bg, padding: 12, fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", cursor: "pointer", fontFamily: mono, boxShadow: "0 0 22px rgba(46,227,178,.4)" }}>{copy.cardApprove}</button>
            </div>
            <p style={{ margin: "12px 0 0", fontSize: 10, color: C.faint, fontFamily: mono }}>{copy.cardFootnote}</p>
          </div>
        </div>
      </section>

      {/* platforms */}
      <section style={{ borderBottom: secBorder, background: C.panel }}>
        <div style={{ maxWidth: 1280, margin: "0 auto", padding: "70px 24px" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 16, marginBottom: 34 }}>
            <p style={eyebrow}>SYS / 04 — {copy.coverageEyebrow}</p>
            <p style={{ margin: 0, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em", color: C.faint, fontFamily: mono }}>{copy.covNote}</p>
          </div>
          <div className="tmr-kpi" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 1, background: C.line, border: secBorder }}>
            {copy.platforms.map((p, i) => {
              const tagStyle: React.CSSProperties = i === 0 ? { background: C.mint, color: C.bg } : i === 1 ? { border: `1px solid ${C.amber}`, color: C.amber } : { border: secBorder, color: C.dim };
              const dim = i >= 2;
              return (
              <div key={p.n} style={{ background: C.bg, padding: 24, opacity: dim ? 0.55 : 1 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 19, fontWeight: 600, color: C.bright, fontFamily: disp }}>{p.n}</span>
                  <span style={{ padding: "2px 8px", fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: mono, ...tagStyle }}>{p.tag}</span>
                </div>
                <p style={{ margin: "12px 0 0", fontSize: 12, lineHeight: 1.65, color: C.dim }}>{p.body}</p>
              </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* diagnostics */}
      <section id="diag" style={{ borderBottom: secBorder }}>
        <div className="tmr-cols" style={{ maxWidth: 1280, margin: "0 auto", display: "grid", gridTemplateColumns: "0.9fr 1.1fr", gap: 48, padding: "84px 24px" }}>
          <div>
            <p style={eyebrow}>SYS / 05 — {copy.diagnosticsEyebrow}</p>
            <h2 style={{ margin: "16px 0 0", fontSize: "clamp(26px, 3.6vw, 38px)", lineHeight: 1.08, fontWeight: 600, color: C.bright, fontFamily: disp, letterSpacing: "-0.03em" }}>
              {copy.diagA} <span style={{ fontStyle: "italic", color: C.mint }}>{copy.diagB}</span>
            </h2>
            <p style={{ margin: "20px 0 0", maxWidth: "40ch", fontSize: 15, lineHeight: 1.75, color: C.dim }}>
              {copy.diagBody}
            </p>
          </div>
          <div style={{ border: secBorder, background: C.panel, padding: "8px 0", fontSize: 12, fontFamily: mono }}>
            {copy.diag.map((d) => (
              <div key={d} style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "10px 20px" }}>
                <span style={{ color: C.dim, flexShrink: 0 }}>{d}</span>
                <span style={{ flex: 1, borderBottom: `1px dotted ${C.line}`, transform: "translateY(-3px)" }} />
                <span style={{ color: C.mint, flexShrink: 0, textShadow: "0 0 10px rgba(46,227,178,.5)" }}>{copy.pass}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* pricing */}
      <section id="pricing" style={{ borderBottom: secBorder, background: C.panel }}>
        <div style={{ maxWidth: 1280, margin: "0 auto", padding: "84px 24px" }}>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 20, marginBottom: 40 }}>
            <div>
              <p style={eyebrow}>SYS / 06 — {copy.pricingEyebrow}</p>
              <h2 style={{ margin: "16px 0 0", fontSize: "clamp(26px, 3.6vw, 38px)", lineHeight: 1.08, fontWeight: 600, color: C.bright, fontFamily: disp, letterSpacing: "-0.03em" }}>
                {copy.priceA} <span style={{ fontStyle: "italic", color: C.mint }}>{copy.priceB}</span>
              </h2>
              <p style={{ margin: "14px 0 0", fontSize: 13, color: C.dim }}>{copy.priceSub}</p>
            </div>
            <div style={{ display: "inline-flex", border: secBorder }} role="group" aria-label={copy.pricingEyebrow}>
              {[{ label: copy.monthly, y: false }, { label: copy.yearly, y: true }].map((opt) => {
                const on = opt.y === yearly;
                return (
                  <button key={opt.label} type="button" aria-pressed={on} onClick={() => setYearly(opt.y)} style={{ border: "none", cursor: "pointer", fontFamily: mono, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em", padding: "10px 20px", background: on ? C.mint : "transparent", color: on ? C.bg : C.dim, fontWeight: 600 }}>
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="tmr-kpi" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 1, background: C.line, border: secBorder }}>
            {plans.map((p) => (
              <div key={p.name} style={p.pop ? { background: "#061711", padding: "26px 24px", boxShadow: `inset 0 0 0 1px ${C.mint}, 0 0 34px rgba(46,227,178,.14)` } : { background: C.bg, padding: "26px 24px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.16em", color: p.pop ? C.mint : C.dim, fontFamily: mono }}>{p.name}</span>
                  {p.pop && <span style={{ background: C.mint, color: C.bg, padding: "2px 8px", fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: mono }}>{copy.popular}</span>}
                </div>
                <div style={{ margin: "18px 0 4px", display: "flex", alignItems: "baseline", gap: 5 }}>
                  <span style={{ fontSize: 34, fontWeight: 600, color: C.bright, fontFamily: disp }}>{p.price}</span>
                  <span style={{ fontSize: 11, color: C.faint, fontFamily: mono }}>{p.per}</span>
                </div>
                <p style={{ margin: "0 0 18px", fontSize: 12, lineHeight: 1.6, color: C.dim, minHeight: 38 }}>{p.tagline}</p>
                <Link href={p.isEnterprise ? "/contact" : "/register"} style={{ display: "block", textAlign: "center", padding: 11, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: mono, fontWeight: p.pop ? 600 : 400, ...(p.pop ? { border: `1px solid ${C.mint}`, background: C.mint, color: C.bg } : { border: secBorder, color: C.text }) }}>
                  {p.cta}
                </Link>
                <ul style={{ listStyle: "none", margin: "18px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                  {p.features.map((f) => (
                    <li key={f} style={{ display: "flex", gap: 9, fontSize: 12, color: C.dim }}>
                      <span style={{ color: C.mint }}>▸</span><span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* faq */}
      <section style={{ borderBottom: secBorder }}>
        <div style={{ maxWidth: 880, margin: "0 auto", padding: "76px 24px" }}>
          <p style={eyebrow}>{copy.faqEyebrow}</p>
          <h2 style={{ margin: "14px 0 34px", fontSize: "clamp(24px, 3vw, 32px)", fontWeight: 600, color: C.bright, fontFamily: disp, letterSpacing: "-0.03em" }}>{copy.faqTitle}</h2>
          <div style={{ borderTop: secBorder }}>
            {copy.faqs.map((f) => (
              <details key={f.q} style={{ borderBottom: secBorder }}>
                <summary style={{ display: "flex", cursor: "pointer", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "20px 0" }}>
                  <span style={{ fontSize: 14, color: C.text }}><span style={{ color: C.mint, fontFamily: mono }}>&gt;_</span> {f.q}</span>
                  <span className="tmr-faq-sign" style={{ flexShrink: 0, color: C.mint, transition: "transform .2s", fontSize: 16 }}>+</span>
                </summary>
                <p style={{ margin: 0, padding: "0 0 20px 26px", maxWidth: "64ch", fontSize: 13, lineHeight: 1.75, color: C.dim }}>{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* cta */}
      <section style={{ borderBottom: secBorder, background: "radial-gradient(50rem 26rem at 50% 120%, rgba(46,227,178,.14), transparent 65%)" }}>
        <div style={{ maxWidth: 1280, margin: "0 auto", padding: "104px 24px", textAlign: "center" }}>
          <svg width="64" height="64" viewBox="0 0 32 32" fill="none" style={{ margin: "0 auto", animation: "tmr-glow 2.6s ease-in-out infinite" }}>
            <path d="M16 3 5 6.5v7.2c0 6.4 4.5 10.7 11 13.3 6.5-2.6 11-6.9 11-13.3V6.5L16 3Z" fill={C.mint} />
            <rect x="11" y="14.5" width="10" height="8" rx="1.6" fill={C.bg} />
            <path d="M13 14.5v-1.8a3 3 0 0 1 6 0v1.8" stroke={C.bg} strokeWidth="1.7" strokeLinecap="round" />
          </svg>
          <h2 style={{ margin: "30px auto 0", maxWidth: "22ch", fontSize: "clamp(30px, 4.5vw, 48px)", lineHeight: 1.08, fontWeight: 600, color: C.bright, fontFamily: disp, letterSpacing: "-0.03em", textShadow: "0 0 60px rgba(46,227,178,.25)" }}>
            {copy.ctaA} <span style={{ fontStyle: "italic", color: C.mint }}>{copy.ctaB}</span>
          </h2>
          <p style={{ margin: "20px auto 0", maxWidth: "44ch", fontSize: 15, lineHeight: 1.75, color: C.dim }}>
            {copy.ctaBody}
          </p>
          <div style={{ marginTop: 36, display: "flex", justifyContent: "center", gap: 12, flexWrap: "wrap" }}>
            <Link href="/register" style={{ border: `1px solid ${C.mint}`, background: C.mint, color: C.bg, padding: "16px 34px", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", boxShadow: "0 0 40px rgba(46,227,178,.45)", fontFamily: mono }}>{copy.ctaPrimary}</Link>
            <Link href="/login" style={{ border: secBorder, color: C.text, padding: "16px 34px", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: mono }}>{logIn}</Link>
          </div>
        </div>
      </section>

      {/* V1.58D.2 — full global public footer (mission-control styling) replaces the old stub */}
      <FooterV2 footer={footer} locale={locale} startFree={startFree} logIn={logIn} />
    </div>
  );
}
