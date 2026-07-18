"use client";

/**
 * Tamanor landing — served at /, /sk, /de. Self-contained body (inline styles +
 * a few keyframes); the header and footer are the SHARED SiteHeader / SiteFooter
 * so every public page/subpage carries an identical header and footer.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { SiteHeader } from "../site-header";
import { SiteFooter } from "../site-footer";
import { ShieldEmblem } from "../logo";
import { PersonAvatar } from "./person-avatar";
import type { Dictionary, Locale } from "@/i18n";

type L2 = Dictionary["landingV2"];
export type LandingV2Props = {
  copy: L2;
  logIn: string;
  locale: Locale;
};

/* ---------- palette (V1.61 — modern light system, blue brand) ---------- */
const C = {
  bg: "#f8fafc",
  panel: "#ffffff",
  line: "#e5e7eb",
  mint: "#2563eb", // brand blue (key kept to minimise diff)
  bright: "#111827",
  text: "#111827",
  dim: "#6b7280",
  faint: "#64748b",
  red: "#dc2626",
  amber: "#b45309",
  green: "#16a34a",
};

const KEYFRAMES = `
@keyframes tmr-tkr { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
@keyframes tmr-spin { to { transform: rotate(360deg); } }
@keyframes tmr-blip { 0%,100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.9); opacity: .35; } }
@keyframes tmr-blink { 0%,49% { opacity: 1; } 50%,100% { opacity: 0; } }
@keyframes tmr-glow { 0%,100% { filter: drop-shadow(0 0 10px rgba(37,99,235,.30)); } 50% { filter: drop-shadow(0 0 20px rgba(37,99,235,.5)); } }
.tmr-anim-tkr { animation: tmr-tkr 28s linear infinite; }
.tmr-anim-spin { animation: tmr-spin 4.6s linear infinite; }
.tmr-anim-blip { animation: tmr-blip 1.8s ease-in-out infinite; }
.tmr-anim-blink { animation: tmr-blink 1.1s step-end infinite; }
.tmr-anim-glow { animation: tmr-glow 2.6s ease-in-out infinite; }
.tmr-v2 details > summary { list-style: none; }
.tmr-v2 details > summary::-webkit-details-marker { display: none; }
.tmr-v2 details[open] .tmr-faq-sign { transform: rotate(45deg); }
/* V1.58D.3 — mobile: stack multi-column sections; no horizontal overflow. */
@media (max-width: 860px) {
  .tmr-v2 .tmr-cols { grid-template-columns: 1fr !important; }
  .tmr-v2 .tmr-kpi { grid-template-columns: repeat(2, 1fr) !important; }
}
/* V1.61 — narrow screens: hide the sim panel's top-left feed labels so they never
   collide with the clock on the right. */
@media (max-width: 520px) {
  .tmr-v2 .tmr-simhide { display: none !important; }
}
/* V1.61 — accessibility: honour reduced-motion for every decorative animation. */
@media (prefers-reduced-motion: reduce) {
  .tmr-anim-tkr, .tmr-anim-spin, .tmr-anim-blip, .tmr-anim-blink, .tmr-anim-glow { animation: none !important; }
}
`;

const mono = "var(--font-mono-v2), ui-monospace, Menlo, monospace";
const disp = "var(--font-disp-v2), ui-sans-serif, system-ui, sans-serif";
const sans = "var(--font-sans-v2), ui-sans-serif, system-ui, sans-serif";


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
    // V1.61 — accessibility: respect reduced-motion. When set, render a single static
    // frame (the wall + grid) and never start the animation loop.
    const reduce = typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches : false;
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

        ctx.strokeStyle = "rgba(15,23,42,0.06)";
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
        ctx.shadowColor = `rgba(37,99,235,${0.45 * pulse})`;
        ctx.shadowBlur = 16;
        ctx.strokeStyle = `rgba(37,99,235,${0.55 + 0.35 * pulse})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(wallX, 14);
        ctx.lineTo(wallX, h - 60);
        ctx.stroke();
        ctx.restore();
        ctx.strokeStyle = "rgba(37,99,235,0.28)";
        ctx.lineWidth = 6;
        ctx.setLineDash([2, 10]);
        ctx.beginPath();
        ctx.moveTo(wallX, 14);
        ctx.lineTo(wallX, h - 60);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = "600 9px var(--font-mono-v2), monospace";
        ctx.fillStyle = "rgba(37,99,235,0.85)";
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
          const c = p.threat ? "rgba(220,38,38," : "rgba(22,163,74,";
          ctx.fillStyle = "rgba(248,250,252,0.96)";
          ctx.strokeStyle = c + (p.crossed ? "0.85)" : "0.45)");
          ctx.lineWidth = 1;
          ctx.fillRect(p.x, p.y, pw, ph);
          ctx.strokeRect(p.x, p.y, pw, ph);
          ctx.fillStyle = c + "0.9)";
          ctx.fillRect(p.x + 8, p.y + ph / 2 - 2.5, 5, 5);
          ctx.fillStyle = "rgba(17,24,39,0.8)";
          ctx.font = "600 8px var(--font-mono-v2), monospace";
          ctx.fillText(p.tag, p.x + 19, p.y + ph / 2 + 3);
          ctx.fillStyle = "rgba(148,163,184,0.55)";
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
          ctx.fillStyle = (q.hot ? "rgba(245,158,11," : "rgba(220,38,38,") + q.life + ")";
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
          ctx.strokeStyle = (r.mint ? "rgba(22,163,74," : "rgba(220,38,38,") + r.a + ")";
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      if (!reduce) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      dead = true;
      cancelAnimationFrame(raf);
    };
  }, [threatRatio, onCount]);

  return <canvas ref={canvasRef} aria-hidden="true" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }} />;
}

/* ---------- small shared bits ---------- */

// V1.58D.5 — premium SaaS section eyebrow (sans, not terminal-mono). Mono stays only on genuine
// technical labels: simulation, diagnostics, timestamps, status, protocol/phase metadata.
const eyebrow: React.CSSProperties = {
  margin: 0,
  fontSize: 12,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.12em",
  color: C.mint,
  fontFamily: "var(--font-sans-v2), ui-sans-serif, system-ui, sans-serif",
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

// V1.62 — radar blips now carry (illustrative, fictional) first names instead of raw ids,
// so the reputation view reads about people, not just numbers.
const BLIPS = [
  { top: "22%", left: "60%", danger: true, label: "Marek · 0.91" },
  { top: "62%", left: "70%", danger: false, label: "Lena · 0.44" },
  { top: "38%", left: "20%", danger: false, label: "Tomáš · 0.38" },
  { top: "74%", left: "34%", danger: true, label: "Adam · 0.87" },
];

// V1.62 — fictional people (name + handle + photo) for the illustrative examples. NOT real
// users and NOT testimonials — purely to make the demo feel human instead of numeric.
const ACTORS = [
  { photo: "/humans/actor1.png", name: "Marek Horák", handle: "@m.horak" },
  { photo: "/humans/actor2.png", name: "Lena Fischer", handle: "@lena.f" },
  { photo: "/humans/actor3.png", name: "Tomáš Varga", handle: "@t.varga" },
];
const COMMENT_AUTHOR = { photo: "/humans/author.png", name: "Adam Král", handle: "@adamk_" };
const FEED_PEOPLE = [
  { photo: "/humans/feed1.png", name: "Jana N." },
  { photo: "/humans/feed2.png", name: "Luca B." },
  { photo: "/humans/feed3.png", name: "Sofia M." },
  { photo: "/humans/feed4.png", name: "David S." },
  { photo: "/humans/feed5.png", name: "Nina R." },
  { photo: "/humans/feed6.png", name: "Peter K." },
];

// V1.63 — "protection network" orbit: 6 people around the Tamanor shield. Positions are on a
// circle (~42% radius); each avatar is centred on its point via translate(-50%,-50%).
const ORBIT = [
  { top: "7%", left: "50%", photo: "/humans/marketing.png" },
  { top: "29%", left: "90%", photo: "/humans/support.png" },
  { top: "71%", left: "90%", photo: "/humans/owner.png" },
  { top: "93%", left: "50%", photo: "/humans/feed3.png" },
  { top: "71%", left: "10%", photo: "/humans/feed5.png" },
  { top: "29%", left: "10%", photo: "/humans/feed1.png" },
];

// Self-serve monthly prices by plan index (Starter/Growth/Agency); Enterprise (index 3) is contact-sales.
const PLAN_PRICES = [49, 149, 399, null] as const;

// V1.62 — real portrait photos for the generic team roles (public/humans/). Order matches
// copy.teamRoles (Marketing manager, Support agent, Brand owner). Extra roles fall back to
// the illustrated PersonAvatar automatically.
const TEAM_PHOTOS = ["/humans/marketing.png", "/humans/support.png", "/humans/owner.png"];

/* ---------- page ---------- */

export function LandingV2({ copy, logIn, locale }: LandingV2Props) {
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

  const secBorder = `1px solid ${C.line}`;
  const pr = copy.protect;

  return (
    <div className="tmr-v2" style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "var(--font-sans-v2), ui-sans-serif, system-ui, sans-serif", overflow: "hidden" }}>
      <style dangerouslySetInnerHTML={{ __html: KEYFRAMES }} />

      {/* Shared global header — identical across every public page/subpage. */}
      <SiteHeader locale={locale} />

      {/* hero */}
      <section id="wall" style={{ position: "relative", borderBottom: secBorder, background: "radial-gradient(70rem 30rem at 50% -20%, rgba(37,99,235,.06), transparent 60%)" }}>
        <div style={{ maxWidth: 1280, margin: "0 auto", padding: "66px 24px 28px" }}>
          <p style={{ ...eyebrow, display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ height: 1, width: 34, background: C.mint }} />{copy.heroEyebrow}
          </p>
          <h1 style={{ margin: "20px 0 0", maxWidth: "18ch", fontSize: "clamp(32px, 5.4vw, 52px)", lineHeight: 1.08, fontWeight: 600, color: C.bright, fontFamily: disp, letterSpacing: "-0.03em" }}>
            {copy.heroA} <span style={{ fontStyle: "italic", color: C.mint }}>{copy.heroB}</span>
          </h1>
          <div style={{ marginTop: 26, display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24, flexWrap: "wrap" }}>
            <p style={{ margin: 0, maxWidth: "52ch", fontSize: 15, lineHeight: 1.75, color: C.dim }}>
              {copy.heroBody}
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <Link href="/register" style={{ border: `1px solid ${C.mint}`, background: C.mint, color: "#fff", padding: "14px 26px", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", boxShadow: "0 6px 18px rgba(37,99,235,.25)", fontFamily: mono }}>{copy.deployFree}</Link>
              <a href="#features" style={{ border: secBorder, color: C.text, padding: "14px 26px", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: mono }}>{copy.theProtocol}</a>
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
            <div className="tmr-simhide" style={{ position: "absolute", top: 12, left: 16, zIndex: 5, display: "flex", gap: 18, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.14em", color: C.faint, fontFamily: mono }}>
              <span>{copy.feedInbound}</span><span style={{ color: C.mint }}>{copy.liveSim}</span>
            </div>
            <div style={{ position: "absolute", top: 12, right: 16, zIndex: 5, fontSize: 10, letterSpacing: "0.14em", color: C.faint, fontFamily: mono }}>
              <Clock /> {copy.utc}
            </div>
            <div className="tmr-kpi" style={{ position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 5, display: "grid", gridTemplateColumns: "repeat(4,1fr)", borderTop: secBorder, background: C.bg }}>
              {[
                { l: copy.c1, v: <span ref={icRef}>12,847</span>, c: C.red },
                { l: copy.c2, v: <span ref={dcRef}>48,102</span>, c: C.green },
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
        <div className="tmr-anim-tkr" style={{ display: "inline-flex", whiteSpace: "nowrap", padding: "10px 0", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: mono }}>
          {[...copy.ticker, ...copy.ticker].map((t, i) => {
            const person = FEED_PEOPLE[i % FEED_PEOPLE.length]!;
            return (
              <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 8, marginRight: 34 }}>
                <span style={{ color: C.faint }}>{t.time}</span>
                <PersonAvatar seed={i + 20} size={18} src={person.photo} alt={person.name} />
                <span style={{ color: C.text, fontWeight: 500 }}>{person.name}</span>
                <span style={{ color: t.bad ? C.red : C.green }}>{t.verb}</span>
                <span style={{ color: C.dim }}>{t.what}</span>
              </span>
            );
          })}
        </div>
      </section>

      {/* phases → "features" (unified header nav target) */}
      <section id="features" style={{ borderBottom: secBorder }}>
        <div style={{ maxWidth: 1280, margin: "0 auto", padding: "96px 24px" }}>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 20, marginBottom: 44 }}>
            <div>
              <p style={eyebrow}>{copy.protocolEyebrow}</p>
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

      {/* radar → "product" (unified header nav target) */}
      <section id="product" style={{ borderBottom: secBorder, background: C.panel }}>
        <div className="tmr-cols" style={{ maxWidth: 1280, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 40, alignItems: "center", padding: "96px 24px" }}>
          <div style={{ position: "relative", margin: "0 auto", height: 420, width: 420 }}>
            {[0, 52, 104, 156].map((inset) => (
              <div key={inset} style={{ position: "absolute", inset, borderRadius: "50%", border: secBorder }} />
            ))}
            <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: C.line }} />
            <div style={{ position: "absolute", top: "50%", left: 0, right: 0, height: 1, background: C.line }} />
            <div className="tmr-anim-spin" style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "conic-gradient(from 0deg, rgba(37,99,235,.20), transparent 70deg, transparent 360deg)" }} />
            <div style={{ position: "absolute", left: "50%", top: "50%", height: 10, width: 10, margin: "-5px 0 0 -5px", borderRadius: "50%", background: C.mint }} />
            {BLIPS.map((b) => (
              <div key={b.label} style={{ position: "absolute", top: b.top, left: b.left, display: "flex", alignItems: "center", gap: 7, zIndex: 3 }}>
                <span className="tmr-anim-blip" style={{ height: 9, width: 9, borderRadius: 9999, flexShrink: 0, background: b.danger ? C.red : C.amber }} />
                <span style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.12em", color: C.dim, whiteSpace: "nowrap", fontFamily: mono }}>{b.label}</span>
              </div>
            ))}
          </div>
          <div>
            <p style={eyebrow}>{copy.actorEyebrow}</p>
            <h2 style={{ margin: "16px 0 0", fontSize: "clamp(26px, 3.6vw, 38px)", lineHeight: 1.08, fontWeight: 600, color: C.bright, fontFamily: disp, letterSpacing: "-0.03em" }}>
              {copy.radarA} <span style={{ fontStyle: "italic", color: C.mint }}>{copy.radarB}</span>
            </h2>
            <p style={{ margin: "20px 0 0", maxWidth: "46ch", fontSize: 15, lineHeight: 1.75, color: C.dim }}>
              {copy.radarBody}
            </p>
            <div style={{ marginTop: 26, display: "flex", flexDirection: "column", gap: 8, fontSize: 12 }}>
              {copy.actors.map((r, i) => {
                const person = ACTORS[i];
                return (
                  <div key={r.a} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, border: secBorder, borderRadius: 12, padding: "9px 12px" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                      <PersonAvatar seed={i + 10} size={30} src={person?.photo} alt={person?.name ?? ""} />
                      <span style={{ minWidth: 0 }}>
                        <span style={{ display: "block", color: C.bright, fontWeight: 600, fontSize: 13 }}>{person?.name}</span>
                        <span style={{ display: "block", color: C.faint, fontSize: 11, fontFamily: mono }}>{person?.handle}</span>
                      </span>
                    </span>
                    <span style={{ color: [C.red, C.amber, C.mint][i] ?? C.dim, fontFamily: mono, whiteSpace: "nowrap" }}>{r.s}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* approval → "control" (unified header nav target) */}
      <section id="control" style={{ borderBottom: secBorder }}>
        <div className="tmr-cols" style={{ maxWidth: 1280, margin: "0 auto", display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: 48, alignItems: "center", padding: "96px 24px" }}>
          <div>
            <p style={eyebrow}>{copy.commandEyebrow}</p>
            <h2 style={{ margin: "16px 0 0", fontSize: "clamp(30px, 4vw, 44px)", lineHeight: 1.16, fontWeight: 600, color: C.bright, fontFamily: disp, letterSpacing: "-0.03em" }}>
              {copy.cmdA}<br /><span style={{ fontStyle: "italic", color: C.mint }}>{copy.cmdB}</span>
            </h2>
            <p style={{ margin: "22px 0 0", maxWidth: "46ch", fontSize: 15, lineHeight: 1.75, color: C.dim }}>
              {copy.cmdBody}
            </p>
            <p style={{ margin: "18px 0 0", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.1em", color: C.faint, fontFamily: mono }}>
              {copy.cmdCursor}<span className="tmr-anim-blink">_</span>
            </p>
            {/* V1.62 — the real people behind the workflow. Generic roles (no fake named
                testimonials); illustrated portraits today, swappable for photos in /public/humans/. */}
            <div style={{ marginTop: 30, paddingTop: 24, borderTop: secBorder }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 20 }}>
                {copy.teamRoles.map((role, i) => (
                  <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 11 }}>
                    <PersonAvatar seed={i + 1} size={40} src={TEAM_PHOTOS[i]} alt={role} />
                    <span style={{ fontSize: 13, color: C.text, fontFamily: sans }}>{role}</span>
                  </span>
                ))}
              </div>
              <p style={{ margin: "16px 0 0", maxWidth: "44ch", fontSize: 14, lineHeight: 1.7, color: C.dim, fontFamily: sans }}>{copy.teamCaption}</p>
              <p style={{ margin: "12px 0 0", fontSize: 12, fontWeight: 600, letterSpacing: "0.04em", color: C.mint, fontFamily: sans }}>{copy.teamTriad}</p>
            </div>
          </div>
          <div style={{ border: secBorder, background: C.panel, padding: 22 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.14em", color: C.faint, fontFamily: mono }}>
              <span>{copy.cardSource}</span><span style={{ color: C.amber }}>{copy.cardPending}</span>
            </div>
            <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 10 }}>
              <PersonAvatar seed={9} size={34} src={COMMENT_AUTHOR.photo} alt={COMMENT_AUTHOR.name} />
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: C.bright }}>{COMMENT_AUTHOR.name}</span>
                <span style={{ display: "block", fontSize: 11, color: C.faint, fontFamily: mono }}>{COMMENT_AUTHOR.handle}</span>
              </span>
            </div>
            <p style={{ margin: "12px 0 0", fontSize: 14, lineHeight: 1.65, color: C.text }}>
              {copy.cardComment}
            </p>
            <div style={{ marginTop: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.14em", fontFamily: mono }}>
                <span style={{ color: C.faint }}>{copy.cardScore}</span><span style={{ color: C.red }}>{copy.cardHigh}</span>
              </div>
              <div style={{ marginTop: 7, height: 5, background: C.line }}>
                <div style={{ height: "100%", width: "82%", background: `linear-gradient(90deg,${C.amber},${C.red})` }} />
              </div>
              <div style={{ marginTop: 12, display: "flex", gap: 6 }}>
                {[copy.cardTag1, copy.cardTag2].map((t) => (
                  <span key={t} style={{ border: "1px solid #fecaca", background: "#fef2f2", color: C.red, padding: "3px 10px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: mono }}>{t}</span>
                ))}
              </div>
            </div>
            <div style={{ marginTop: 18, display: "flex", alignItems: "center", gap: 10 }}>
              <PersonAvatar seed={5} size={30} src="/humans/reviewer.png" alt="Reviewer" />
              <span style={{ fontSize: 11.5, lineHeight: 1.45, color: C.dim, fontFamily: sans }}>{copy.cardReviewer}</span>
            </div>
            <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
              <button style={{ flex: 1, border: secBorder, background: "transparent", color: C.dim, padding: 12, fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", cursor: "pointer", fontFamily: mono }}>{copy.cardReject}</button>
              <button style={{ flex: 2, border: `1px solid ${C.mint}`, background: C.mint, color: "#fff", padding: 12, fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", cursor: "pointer", fontFamily: mono, boxShadow: "0 6px 16px rgba(37,99,235,.22)" }}>{copy.cardApprove}</button>
            </div>
            <p style={{ margin: "12px 0 0", fontSize: 10, color: C.faint, fontFamily: mono }}>{copy.cardFootnote}</p>
          </div>
        </div>
      </section>

      {/* platforms (unified header nav target) */}
      <section id="platforms" style={{ borderBottom: secBorder, background: C.panel }}>
        <div style={{ maxWidth: 1280, margin: "0 auto", padding: "70px 24px" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 16, marginBottom: 34 }}>
            <p style={eyebrow}>{copy.coverageEyebrow}</p>
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

      {/* protect — "protection network" + illustrative time saved */}
      <section style={{ borderBottom: secBorder }}>
        <div className="tmr-cols" style={{ maxWidth: 1280, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 56, alignItems: "center", padding: "96px 24px" }}>
          {/* orbit of protected people around the Tamanor shield */}
          <div style={{ position: "relative", width: "min(420px, 100%)", margin: "0 auto", aspectRatio: "1 / 1" }}>
            <div style={{ position: "absolute", inset: "6%", borderRadius: "50%", border: `1px dashed ${C.line}` }} />
            <div style={{ position: "absolute", inset: "24%", borderRadius: "50%", border: secBorder }} />
            <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", display: "grid", placeItems: "center", textAlign: "center" }}>
              <ShieldEmblem size={116} />
              <span style={{ marginTop: 4, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.16em", color: C.faint, fontFamily: mono, lineHeight: 1.5 }}>
                {pr.centerTop}<br />{pr.centerBottom}
              </span>
            </div>
            {ORBIT.map((o, i) => (
              <div key={i} style={{ position: "absolute", top: o.top, left: o.left, transform: "translate(-50%,-50%)", borderRadius: 9999, boxShadow: "0 6px 18px rgba(15,23,42,.12)" }}>
                <PersonAvatar seed={i + 30} size={54} src={o.photo} />
              </div>
            ))}
          </div>

          <div>
            <p style={eyebrow}>{pr.eyebrow}</p>
            <h2 style={{ margin: "16px 0 0", fontSize: "clamp(28px, 3.8vw, 40px)", lineHeight: 1.1, fontWeight: 600, color: C.bright, fontFamily: disp, letterSpacing: "-0.03em" }}>
              {pr.titleA} <span style={{ fontStyle: "italic", color: C.mint }}>{pr.titleB}</span>
            </h2>
            <p style={{ margin: "18px 0 0", maxWidth: "48ch", fontSize: 15, lineHeight: 1.75, color: C.dim }}>{pr.body}</p>

            <div className="tmr-kpi" style={{ marginTop: 26, display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
              {pr.stats.map((s) => (
                <div key={s.l} style={{ border: secBorder, borderRadius: 14, background: C.panel, padding: "16px 14px" }}>
                  <p style={{ margin: 0, fontSize: 28, fontWeight: 700, color: C.mint, fontFamily: disp, letterSpacing: "-0.02em" }}>{s.v}</p>
                  <p style={{ margin: "4px 0 0", fontSize: 12, lineHeight: 1.5, color: C.dim }}>{s.l}</p>
                </div>
              ))}
            </div>
            <p style={{ margin: "10px 0 0", fontSize: 11, color: C.faint }}>{pr.note}</p>

            <p style={{ margin: "24px 0 0", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.14em", color: C.faint, fontFamily: mono }}>{pr.capsTitle}</p>
            <ul style={{ listStyle: "none", margin: "12px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
              {pr.caps.map((c) => (
                <li key={c} style={{ display: "flex", gap: 10, fontSize: 14, lineHeight: 1.5, color: C.text }}>
                  <span aria-hidden style={{ marginTop: 2, flexShrink: 0, color: C.mint }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                  </span>
                  {c}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* diagnostics → "safety" (unified header nav target) */}
      <section id="safety" style={{ borderBottom: secBorder }}>
        <div className="tmr-cols" style={{ maxWidth: 1280, margin: "0 auto", display: "grid", gridTemplateColumns: "0.9fr 1.1fr", gap: 48, padding: "96px 24px" }}>
          <div>
            <p style={eyebrow}>{copy.diagnosticsEyebrow}</p>
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
                <span style={{ color: C.green, flexShrink: 0, fontWeight: 600 }}>{copy.pass}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* pricing */}
      <section id="pricing" style={{ borderBottom: secBorder, background: C.panel }}>
        <div style={{ maxWidth: 1280, margin: "0 auto", padding: "96px 24px" }}>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 20, marginBottom: 40 }}>
            <div>
              <p style={eyebrow}>{copy.pricingEyebrow}</p>
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
              <div key={p.name} style={p.pop ? { background: "#eff6ff", padding: "26px 24px", boxShadow: `inset 0 0 0 1px ${C.mint}` } : { background: C.bg, padding: "26px 24px" }}>
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
      <section style={{ borderBottom: secBorder, background: "radial-gradient(50rem 26rem at 50% 120%, rgba(37,99,235,.08), transparent 65%)" }}>
        <div style={{ maxWidth: 1280, margin: "0 auto", padding: "104px 24px", textAlign: "center" }}>
          <svg width="64" height="64" viewBox="0 0 32 32" fill="none" className="tmr-anim-glow" style={{ margin: "0 auto" }}>
            <path d="M16 3 5 6.5v7.2c0 6.4 4.5 10.7 11 13.3 6.5-2.6 11-6.9 11-13.3V6.5L16 3Z" fill={C.mint} />
            <rect x="11" y="14.5" width="10" height="8" rx="1.6" fill="#fff" />
            <path d="M13 14.5v-1.8a3 3 0 0 1 6 0v1.8" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
          <h2 style={{ margin: "30px auto 0", maxWidth: "22ch", fontSize: "clamp(30px, 4.5vw, 48px)", lineHeight: 1.08, fontWeight: 600, color: C.bright, fontFamily: disp, letterSpacing: "-0.03em" }}>
            {copy.ctaA} <span style={{ fontStyle: "italic", color: C.mint }}>{copy.ctaB}</span>
          </h2>
          <p style={{ margin: "20px auto 0", maxWidth: "44ch", fontSize: 15, lineHeight: 1.75, color: C.dim }}>
            {copy.ctaBody}
          </p>
          <div style={{ marginTop: 36, display: "flex", justifyContent: "center", gap: 12, flexWrap: "wrap" }}>
            <Link href="/register" style={{ border: `1px solid ${C.mint}`, background: C.mint, color: "#fff", padding: "16px 34px", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", boxShadow: "0 8px 22px rgba(37,99,235,.28)", fontFamily: mono }}>{copy.ctaPrimary}</Link>
            <Link href="/login" style={{ border: secBorder, color: C.text, padding: "16px 34px", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: mono }}>{logIn}</Link>
          </div>
        </div>
      </section>

      {/* Shared global footer — identical across every public page/subpage. */}
      <SiteFooter locale={locale} />
    </div>
  );
}
