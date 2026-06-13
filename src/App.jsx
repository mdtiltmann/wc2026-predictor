import { useState, useEffect, useCallback } from "react";
import { supabase, LEAGUE_ID } from "./supabase.js";

// ─── Theme ────────────────────────────────────────────────────────────────────
const C = {
  bg:          "#060912",
  surface:     "#0C1020",
  card:        "#101624",
  cardHover:   "#141C2E",
  border:      "#1A2338",
  borderLight: "#243050",
  gold:        "#F0C040",
  goldDim:     "#B8922E",
  green:       "#00C853",
  greenDark:   "#00703A",
  blue:        "#1A8CFF",
  blueDark:    "#0A5299",
  red:         "#FF3D57",
  text:        "#EAECF4",
  textSoft:    "#8A94B0",
  textFaint:   "#3A4560",
  accent:      "#B91C3C",   // FIFA maroon-red
  accentLight: "#DC2C50",
};

const LEAGUE_PASSWORD = "fifa-sa";

// ─── Scoring ──────────────────────────────────────────────────────────────────
function calcScore(predHome, predAway, actualHome, actualAway) {
  const exact         = predHome === actualHome && predAway === actualAway;
  const correctResult = Math.sign(predHome - predAway) === Math.sign(actualHome - actualAway);
  const points        = (exact ? 3 : 0) + (correctResult ? 1 : 0);
  return { points, exact, correctResult };
}

// ─── Match importance ──────────────────────────────────────────────────────────
function importanceLabel(match) {
  const r = (match.round || "").toUpperCase();
  if (match.group_name) {
    if (match.matchday === 3) return { text: "Group Decider", color: C.red };
    if (match.matchday === 2) return { text: "Matchday 2",    color: C.gold };
    return null;
  }
  if (r.includes("32"))       return { text: "Round of 32 · Knockout", color: C.red };
  if (r.includes("16"))       return { text: "Round of 16 · Knockout", color: C.red };
  if (r.includes("QUARTER"))  return { text: "Quarter-Final",          color: "#A855F7" };
  if (r.includes("SEMI"))     return { text: "Semi-Final",             color: C.gold };
  return                               { text: "THE FINAL 🏆",         color: C.gold };
}

// ─── Achievements ─────────────────────────────────────────────────────────────
const ACHIEVEMENTS = [
  { id:"first_exact",  icon:"🎯", name:"Sharpshooter", desc:"First exact score",         check:(s)=>s.exact>=1 },
  { id:"three_exact",  icon:"🔮", name:"Psychic",       desc:"3 exact scores",            check:(s)=>s.exact>=3 },
  { id:"five_exact",   icon:"👑", name:"Oracle",        desc:"5 exact scores",            check:(s)=>s.exact>=5 },
  { id:"streak3",      icon:"🔥", name:"On Fire",       desc:"3 correct in a row",        check:(s)=>s.bestStreak>=3 },
  { id:"streak5",      icon:"⚡", name:"Unstoppable",   desc:"5 correct in a row",        check:(s)=>s.bestStreak>=5 },
  { id:"fifty_pct",    icon:"📊", name:"Consistent",    desc:"50%+ accuracy (min 10)",    check:(s)=>s.played>=10&&s.pct>=50 },
  { id:"twenty_preds", icon:"📋", name:"Committed",     desc:"20 predictions made",       check:(s)=>s.played>=20 },
  { id:"top3",         icon:"🏅", name:"Podium",        desc:"Finish top 3",              check:(s)=>s.rank<=3&&s.rank>0 },
];

function computeStats(rows, rank) {
  let exact=0, correct=0, bestStreak=0, cur=0;
  for (const r of rows) {
    if (r.points>=4) exact++;
    if (r.points>0) { cur++; bestStreak=Math.max(bestStreak,cur); correct++; }
    else cur=0;
  }
  return { exact, bestStreak, played:rows.length, rank,
    pct: rows.length ? Math.round((correct/rows.length)*100) : 0 };
}

// ─── Flag helper ──────────────────────────────────────────────────────────────
const FLAG_MAP = {
  ARG:"🇦🇷",BRA:"🇧🇷",FRA:"🇫🇷",ENG:"🏴󠁧󠁢󠁥󠁮󠁧󠁿",ESP:"🇪🇸",GER:"🇩🇪",POR:"🇵🇹",
  NED:"🇳🇱",USA:"🇺🇸",MEX:"🇲🇽",MAR:"🇲🇦",JPN:"🇯🇵",BEL:"🇧🇪",URY:"🇺🇾",
  COL:"🇨🇴",SEN:"🇸🇳",KOR:"🇰🇷",AUS:"🇦🇺",CAN:"🇨🇦",CRO:"🇭🇷",SUI:"🇨🇭",
  DEN:"🇩🇰",SWE:"🇸🇪",SRB:"🇷🇸",TUN:"🇹🇳",ECU:"🇪🇨",IRN:"🇮🇷",KSA:"🇸🇦",
};
const flag = (code) => FLAG_MAP[code] || "🏳️";

// ─── ESPN Live Scores ─────────────────────────────────────────────────────────
function useESPNScores() {
  const [events, setEvents] = useState([]);
  const [lastUpdated, setLastUpdated] = useState(null);

  const fetch_ = useCallback(async () => {
    try {
      const res = await fetch(
        "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard"
      );
      if (!res.ok) return;
      const data = await res.json();
      setEvents(data.events || []);
      setLastUpdated(new Date());
    } catch (_) {}
  }, []);

  useEffect(() => {
    fetch_();
    const iv = setInterval(fetch_, 10000);
    return () => clearInterval(iv);
  }, [fetch_]);

  return { events, lastUpdated, refresh: fetch_ };
}

function ESPNLiveScores() {
  const { events, lastUpdated, refresh } = useESPNScores();

  const live     = events.filter(e => e.status?.type?.state === "in");
  const upcoming = events.filter(e => e.status?.type?.state === "pre");
  const finished = events.filter(e => e.status?.type?.state === "post" || e.status?.type?.completed);

  if (!events.length) return null;

  const getTeams = (event) => {
    const comps = event.competitions?.[0]?.competitors || [];
    return {
      home: comps.find(c => c.homeAway === "home"),
      away: comps.find(c => c.homeAway === "away"),
    };
  };

  const MatchRow = ({ event }) => {
    const { home, away } = getTeams(event);
    const state    = event.status?.type?.state;
    const detail   = event.status?.type?.detail || "";
    const isLive   = state === "in";
    const isPre    = state === "pre";
    const homeName = home?.team?.shortDisplayName || home?.team?.displayName || "?";
    const awayName = away?.team?.shortDisplayName || away?.team?.displayName || "?";
    const homeLogo = home?.team?.logo;
    const awayLogo = away?.team?.logo;

    return (
      <div style={{
        background: isLive ? "rgba(0,200,83,0.04)" : "rgba(255,255,255,0.02)",
        border: `1px solid ${isLive ? "rgba(0,200,83,0.2)" : C.border}`,
        borderRadius: 12, padding: "10px 12px", marginBottom: 8,
        display: "flex", alignItems: "center", gap: 10,
      }}>
        <div style={{ display:"flex", alignItems:"center", gap:6, flex:1, minWidth:0 }}>
          {awayLogo
            ? <img src={awayLogo} style={{width:22,height:22,objectFit:"contain",flexShrink:0}} alt={awayName} />
            : <span style={{fontSize:18,flexShrink:0}}>{flag(away?.team?.abbreviation)}</span>}
          <span style={{ fontSize:12, fontWeight:700, color:away?.winner?C.text:C.textSoft,
            overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{awayName}</span>
        </div>

        <div style={{ textAlign:"center", flexShrink:0, minWidth:64 }}>
          {isLive || state === "post" ? (
            <div style={{ fontSize:16, fontWeight:900, color:C.text, fontFamily:"'SF Mono',monospace", letterSpacing:2,
              textShadow: isLive ? `0 0 12px ${C.green}` : undefined }}>
              {away?.score ?? 0}
              <span style={{color:C.textFaint,fontSize:12,letterSpacing:0}}> – </span>
              {home?.score ?? 0}
            </div>
          ) : (
            <div style={{ fontSize:11, color:C.blue, fontWeight:700 }}>
              {new Date(event.date).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}
            </div>
          )}
          <div style={{ fontSize:9, fontWeight:800, marginTop:2,
            color: isLive ? C.green : C.textFaint,
            animation: isLive ? "pulse 2s infinite" : undefined,
            letterSpacing:"0.06em" }}>
            {isLive ? `● ${detail}` : state==="post" ? "FT" : isPre ? "UPCOMING" : detail}
          </div>
        </div>

        <div style={{ display:"flex", alignItems:"center", gap:6, flex:1, minWidth:0, justifyContent:"flex-end" }}>
          <span style={{ fontSize:12, fontWeight:700, color:home?.winner?C.text:C.textSoft,
            overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", textAlign:"right" }}>{homeName}</span>
          {homeLogo
            ? <img src={homeLogo} style={{width:22,height:22,objectFit:"contain",flexShrink:0}} alt={homeName} />
            : <span style={{fontSize:18,flexShrink:0}}>{flag(home?.team?.abbreviation)}</span>}
        </div>
      </div>
    );
  };

  const Section = ({ label, items }) => {
    if (!items.length) return null;
    return (
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize:9, fontWeight:700, color:C.textFaint, letterSpacing:"0.12em",
          textTransform:"uppercase", marginBottom:8 }}>{label}</div>
        {items.map(e => <MatchRow key={e.id} event={e} />)}
      </div>
    );
  };

  return (
    <div style={{ background:C.card, border:`1px solid ${C.border}`,
      borderRadius:18, padding:"14px 14px 10px", marginBottom:20 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ fontSize:13, fontWeight:800, color:C.text }}>⚽ WC 2026 Scores</span>
          <span style={{ background:"rgba(240,192,64,0.12)", border:"1px solid rgba(240,192,64,0.25)",
            color:C.gold, fontSize:8, fontWeight:800, padding:"2px 6px", borderRadius:4, letterSpacing:"0.08em" }}>
            ESPN
          </span>
          {live.length > 0 && (
            <span style={{ background:"rgba(0,200,83,0.1)", border:"1px solid rgba(0,200,83,0.25)",
              color:C.green, fontSize:8, fontWeight:800, padding:"2px 6px", borderRadius:4,
              animation:"pulse 2s infinite", letterSpacing:"0.06em" }}>
              ● LIVE
            </span>
          )}
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          {lastUpdated && (
            <span style={{ fontSize:9, color:C.textFaint }}>
              {lastUpdated.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"})}
            </span>
          )}
          <button onClick={refresh}
            style={{ background:"rgba(255,255,255,0.04)", border:`1px solid ${C.border}`,
              color:C.textSoft, fontSize:10, padding:"3px 8px", borderRadius:6, cursor:"pointer" }}>
            ↻
          </button>
        </div>
      </div>

      <Section label="Live Now" items={live} />
      <Section label="Upcoming" items={upcoming} />
      <Section label="Final" items={finished} />
    </div>
  );
}

// ─── Join Screen ──────────────────────────────────────────────────────────────
function JoinScreen({ onJoined }) {
  const [step,    setStep]   = useState("name");
  const [name,    setName]   = useState("");
  const [pass,    setPass]   = useState("");
  const [loading, setLoading] = useState(false);
  const [error,   setError]  = useState(null);
  const [shake,   setShake]  = useState(false);

  // Fake email derived from name — same on every device, no real email ever sent
  const nameToEmail = (n) => `${n.trim().toLowerCase().replace(/\s+/g, ".")}@wc2026.app`;

  const handleJoin = async () => {
    if (!name.trim()) return;
    if (pass !== LEAGUE_PASSWORD) {
      setError("Wrong password. Ask the league admin.");
      setShake(true); setTimeout(() => setShake(false), 500);
      return;
    }
    setLoading(true); setError(null);
    try {
      // Call Edge Function — runs on Supabase servers, no client-side rate limits
      const { data, error: fnErr } = await supabase.functions.invoke("auth-player", {
        body: { name: name.trim(), password: pass },
      });
      if (fnErr) throw fnErr;
      if (data?.error) throw new Error(data.error);

      // Set the session returned by the function
      const { error: sessErr } = await supabase.auth.setSession({
        access_token:  data.session.access_token,
        refresh_token: data.session.refresh_token,
      });
      if (sessErr) throw sessErr;

      onJoined({ userId: data.session.user.id, name: name.trim() });
    } catch(e) {
      setError(e.message || "Something went wrong — please try again.");
    }
    setLoading(false);
  };

  const wc26Gradient = "linear-gradient(160deg, #B91C3C 0%, #7C0C28 35%, #060912 70%)";

  return (
    <div style={{ minHeight:"100vh", background:C.bg, display:"flex", flexDirection:"column",
      alignItems:"center", justifyContent:"center", padding:20,
      backgroundImage: wc26Gradient }}>
      <style>{`
        @keyframes slideUp { from{opacity:0;transform:translateY(24px)} to{opacity:1;transform:translateY(0)} }
        @keyframes shake { 0%,100%{transform:translateX(0)} 20%,60%{transform:translateX(-8px)} 40%,80%{transform:translateX(8px)} }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
        @keyframes spin { to{transform:rotate(360deg)} }
      `}</style>

      {/* Logo area */}
      <div style={{ textAlign:"center", marginBottom:32, animation:"slideUp 0.5s ease" }}>
        <div style={{ width:80, height:80, borderRadius:20, background:"rgba(240,192,64,0.12)",
          border:"2px solid rgba(240,192,64,0.3)", display:"flex", alignItems:"center",
          justifyContent:"center", fontSize:42, margin:"0 auto 16px",
          boxShadow:"0 0 40px rgba(240,192,64,0.15)" }}>🏆</div>
        <div style={{ fontSize:11, letterSpacing:"0.3em", color:C.gold, fontWeight:800, marginBottom:6 }}>FIFA WORLD CUP 2026</div>
        <div style={{ fontSize:30, fontWeight:900, color:"white", letterSpacing:"-0.5px", lineHeight:1.1 }}>
          Prediction<br/>League
        </div>
        <div style={{ fontSize:13, color:"rgba(255,255,255,0.5)", marginTop:10 }}>
          🇺🇸 🇨🇦 🇲🇽 &nbsp;USA · Canada · Mexico
        </div>
      </div>

      {/* Card */}
      <div style={{ width:"100%", maxWidth:380, background:"rgba(12,16,32,0.95)",
        borderRadius:24, padding:28, border:"1px solid rgba(240,192,64,0.15)",
        boxShadow:"0 32px 64px rgba(0,0,0,0.6)", animation:"slideUp 0.5s 0.1s both" }}>

        <div style={{ fontSize:16, fontWeight:800, color:"white", marginBottom:6 }}>Join the league</div>
        <div style={{ fontSize:13, color:C.textSoft, marginBottom:20 }}>Enter your name and the league password.</div>
        {error && <div style={{ color:C.red, fontSize:12, marginBottom:12, fontWeight:600 }}>⚠ {error}</div>}
        <input value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key==="Enter" && name.trim() && pass && !loading && handleJoin()}
          placeholder="Your name" autoFocus
          style={{ width:"100%", background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)",
            borderRadius:12, padding:"14px 16px", color:"white", fontSize:16,
            outline:"none", boxSizing:"border-box", marginBottom:12, fontFamily:"inherit" }}
          onFocus={e => e.target.style.borderColor="rgba(240,192,64,0.5)"}
          onBlur={e => e.target.style.borderColor="rgba(255,255,255,0.1)"} />
        <div style={{ animation:shake?"shake 0.4s ease":undefined }}>
          <input value={pass} onChange={e => setPass(e.target.value)} type="password"
            onKeyDown={e => e.key==="Enter" && name.trim() && !loading && handleJoin()}
            placeholder="League password"
            style={{ width:"100%", background:"rgba(255,255,255,0.05)",
              border:`1px solid ${error?"rgba(255,61,87,0.5)":"rgba(255,255,255,0.1)"}`,
              borderRadius:12, padding:"14px 16px", color:"white", fontSize:16,
              outline:"none", boxSizing:"border-box", marginBottom:16, fontFamily:"inherit" }}
            onFocus={e => e.target.style.borderColor="rgba(240,192,64,0.5)"}
            onBlur={e => e.target.style.borderColor=error?"rgba(255,61,87,0.5)":"rgba(255,255,255,0.1)"} />
        </div>
        <button onClick={handleJoin} disabled={!name.trim() || !pass || loading}
          style={{ width:"100%", background:(!name.trim()||!pass||loading)?"rgba(255,255,255,0.06)":`linear-gradient(135deg,${C.accentLight},${C.accent})`,
            border:"none", borderRadius:12, padding:16, color:"white", fontWeight:800, fontSize:15,
            cursor:(!name.trim()||!pass||loading)?"not-allowed":"pointer",
            boxShadow:name.trim()&&pass&&!loading?"0 4px 20px rgba(185,28,60,0.4)":"none",
            display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
          {loading ? <><span style={{display:"inline-block",width:16,height:16,border:"2px solid rgba(255,255,255,0.3)",borderTopColor:"white",borderRadius:"50%",animation:"spin 0.7s linear infinite"}} /> Joining…</> : "Enter League →"}
        </button>

        <div style={{ marginTop:24, padding:14, background:"rgba(240,192,64,0.05)",
          borderRadius:12, border:"1px solid rgba(240,192,64,0.12)" }}>
          <div style={{ fontSize:11, color:C.gold, fontWeight:700, marginBottom:8, letterSpacing:"0.05em" }}>SCORING</div>
          {[["🎯","Exact score","3 pts",C.gold],["✅","Correct result","1 pt",C.green],["❌","Wrong","0 pts",C.textFaint]].map(([ic,l,v,col])=>(
            <div key={l} style={{ display:"flex", justifyContent:"space-between", fontSize:12, marginBottom:4 }}>
              <span style={{color:C.textSoft}}>{ic} {l}</span>
              <span style={{fontWeight:700,color:col}}>{v}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop:20, fontSize:11, color:"rgba(255,255,255,0.2)", textAlign:"center" }}>
        Returning? Just enter your name + league password.
      </div>
    </div>
  );
}

// ─── Score input ──────────────────────────────────────────────────────────────
function ScoreInput({ value, onChange, disabled }) {
  const num = value === "" ? null : parseInt(value);
  const btnStyle = (active) => ({
    width:44, height:44, background:active?"rgba(0,200,83,0.12)":"transparent",
    border:`1px solid ${active?C.greenDark:C.textFaint}`,
    borderRadius:12, color:active?C.green:C.textFaint,
    fontSize:16, cursor:active?"pointer":"default",
    display:"flex", alignItems:"center", justifyContent:"center",
    WebkitUserSelect:"none", userSelect:"none",
  });
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:4 }}>
      <button onClick={() => !disabled && onChange(Math.min(20,(num||0)+1))}
        disabled={disabled} style={btnStyle(!disabled)}>▲</button>
      <div style={{ width:56, height:56, borderRadius:14,
        background:disabled?"rgba(255,255,255,0.02)":"rgba(0,200,83,0.08)",
        border:`2px solid ${disabled?C.textFaint:num!==null?C.greenDark:C.border}`,
        display:"flex", alignItems:"center", justifyContent:"center",
        fontSize:28, fontWeight:900, color:disabled?C.textSoft:C.text,
        fontFamily:"'SF Mono',monospace",
        boxShadow:num!==null&&!disabled?"inset 0 1px 0 rgba(0,200,83,0.15)":"none" }}>
        {num===null ? <span style={{color:C.textFaint,fontSize:14}}>–</span> : num}
      </div>
      <button onClick={() => !disabled && onChange(Math.max(0,(num||0)-1))}
        disabled={disabled} style={btnStyle(!disabled)}>▼</button>
    </div>
  );
}

// ─── Form dots ────────────────────────────────────────────────────────────────
function FormDots({ form = [] }) {
  if (!form?.length) return null;
  const col = { W:C.green, D:C.gold, L:C.red };
  return (
    <div style={{ display:"flex", gap:3 }}>
      {form.slice(0,5).map((r,i) => (
        <div key={i} style={{ width:18, height:18, borderRadius:5,
          background:col[r]||C.textFaint, display:"flex", alignItems:"center",
          justifyContent:"center", fontSize:8, fontWeight:900, color:"white",
          boxShadow:`0 2px 6px ${(col[r]||C.textFaint)}40` }}>{r}</div>
      ))}
    </div>
  );
}

// ─── H2H badge ────────────────────────────────────────────────────────────────
function H2HBadge({ h2h, homeName, awayName }) {
  if (!h2h?.played) return null;
  return (
    <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:10,
      padding:"8px 12px", background:"rgba(255,255,255,0.02)",
      borderRadius:10, border:`1px solid ${C.border}` }}>
      <span style={{ fontSize:10, color:C.textSoft, fontWeight:600, letterSpacing:"0.08em" }}>H2H ({h2h.played}g)</span>
      <div style={{ flex:1, display:"flex", justifyContent:"center", gap:10, fontSize:12 }}>
        <span style={{fontWeight:800,color:C.green}}>{h2h.home_wins}W</span>
        <span style={{color:C.textFaint}}>·</span>
        <span style={{fontWeight:800,color:C.gold}}>{h2h.draws}D</span>
        <span style={{color:C.textFaint}}>·</span>
        <span style={{fontWeight:800,color:C.red}}>{h2h.away_wins}L</span>
      </div>
      <span style={{ fontSize:10, color:C.textSoft }}>{awayName?.split(" ").slice(-1)[0]}</span>
    </div>
  );
}

// ─── Live elapsed clock ───────────────────────────────────────────────────────
function useLiveClock(match) {
  const [elapsed, setElapsed] = useState(null);
  useEffect(() => {
    if (match.status !== "live") { setElapsed(null); return; }
    const tick = () => {
      const mins = Math.floor((Date.now() - new Date(match.kickoff).getTime()) / 60000);
      setElapsed(Math.min(mins, 90));
    };
    tick();
    const iv = setInterval(tick, 30000);
    return () => clearInterval(iv);
  }, [match.status, match.kickoff]);
  return elapsed;
}

// ─── Status pill ──────────────────────────────────────────────────────────────
function StatusPill({ status }) {
  const m = {
    live:      { bg:"rgba(0,200,83,0.12)",  c:C.green, b:"rgba(0,200,83,0.3)",  label:"● LIVE", pulse:true },
    finished:  { bg:"rgba(138,148,176,0.08)",c:C.textSoft,b:"rgba(138,148,176,0.15)",label:"FT" },
    upcoming:  { bg:"rgba(26,140,255,0.08)", c:C.blue, b:"rgba(26,140,255,0.2)", label:"UPCOMING" },
    postponed: { bg:"rgba(255,61,87,0.08)",  c:C.red,  b:"rgba(255,61,87,0.2)", label:"PPD" },
  };
  const s = m[status] || m.upcoming;
  return (
    <span style={{ background:s.bg, color:s.c, border:`1px solid ${s.b}`,
      fontSize:9, fontWeight:800, padding:"3px 8px", borderRadius:20, letterSpacing:"0.1em",
      animation:s.pulse?"pulse 2s infinite":undefined }}>
      {s.label}
    </span>
  );
}

// ─── Match Card ───────────────────────────────────────────────────────────────
function startOfISOWeek(d = new Date()) {
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diff));
}

function MatchCard({ match, pred, onSave, chipActive = false, chipAvailable = false, onChipToggle, chipWeekUsed = false, leagueId }) {
  const [chipSaving, setChipSaving] = useState(false);
  const [showPreds, setShowPreds]   = useState(false);
  const [allPreds,  setAllPreds]    = useState(null);
  const [predsLoading, setPredsLoading] = useState(false);
  const elapsed = useLiveClock(match);

  // Lock at kickoff time client-side — don't rely only on status from server
  const pastKickoff = new Date(match.kickoff) <= new Date();
  const locked = match.status !== "upcoming" || pastKickoff;
  const home   = match.home_team;
  const away   = match.away_team;
  const imp    = importanceLabel(match);
  const predHome = pred?.predicted_home ?? "";
  const predAway = pred?.predicted_away ?? "";

  const [lh, setLh] = useState(predHome);
  const [la, setLa] = useState(predAway);
  const [dirty, setDirty]       = useState(false);
  const [saveState, setSaveState] = useState("idle");

  const loadPreds = async () => {
    if (allPreds) { setShowPreds(v => !v); return; }
    setPredsLoading(true);
    // Fetch predictions (no FK to profiles, so join separately)
    const { data: pData } = await supabase
      .from("predictions")
      .select("user_id, predicted_home, predicted_away")
      .eq("match_id", match.id)
      .eq("league_id", leagueId);
    if (pData?.length) {
      const userIds = [...new Set(pData.map(p => p.user_id))];
      const { data: prData } = await supabase
        .from("profiles")
        .select("id, name")
        .in("id", userIds);
      const nameMap = new Map((prData || []).map(p => [p.id, p.name]));
      const withPts = pData.map(p => {
        const pts = (match.status === "finished" && match.home_score != null)
          ? calcScore(p.predicted_home, p.predicted_away, match.home_score, match.away_score).points
          : null;
        return { ...p, name: nameMap.get(p.user_id) || "Unknown", pts };
      });
      setAllPreds(withPts);
    } else {
      setAllPreds([]);
    }
    setShowPreds(true);
    setPredsLoading(false);
  };

  useEffect(() => { setLh(predHome); setLa(predAway); setDirty(false); }, [pred?.id]);

  const mark = (fn) => (v) => { fn(v); setDirty(true); setSaveState("idle"); };

  const save = async () => {
    if (lh===""||la==="") return;
    setSaveState("saving");
    try {
      await onSave({ matchId:match.id, home:parseInt(lh), away:parseInt(la) });
      setSaveState("saved"); setDirty(false);
      setTimeout(()=>setSaveState("idle"),2000);
    } catch { setSaveState("error"); }
  };

  const pts = (match.status==="finished" && pred && predHome!=="")
    ? calcScore(parseInt(predHome), parseInt(predAway), match.home_score, match.away_score) : null;

  const ko = new Date(match.kickoff);
  const dateStr = ko.toLocaleDateString([],{weekday:"short",day:"numeric",month:"short"});
  const timeStr = ko.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});

  return (
    <div style={{ background:C.card, borderRadius:20, overflow:"hidden", marginBottom:10,
      border:`1px solid ${match.status==="live"?"rgba(0,200,83,0.3)":C.border}`,
      boxShadow:match.status==="live"?"0 0 20px rgba(0,200,83,0.08)":"none",
      transition:"all 0.2s" }}>

      {/* Card header */}
      <div style={{ padding:"9px 12px", background:"rgba(255,255,255,0.018)",
        borderBottom:`1px solid ${C.border}`,
        display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:8 }}>
        <div style={{ minWidth:0 }}>
          <span style={{ fontSize:11, color:C.textSoft, fontWeight:600 }}>
            {match.group_name || match.round}
          </span>
          {imp && (
            <span style={{ marginLeft:6, fontSize:10, fontWeight:700, color:imp.color,
              background:`${imp.color}18`, border:`1px solid ${imp.color}30`,
              borderRadius:20, padding:"2px 7px", whiteSpace:"nowrap" }}>
              {imp.text}
            </span>
          )}
        </div>
        <div style={{ display:"flex", gap:5, alignItems:"center", flexShrink:0 }}>
          <span style={{ fontSize:10, color:C.textSoft, whiteSpace:"nowrap" }}>{dateStr} · {timeStr}</span>
          <StatusPill status={match.status} />
        </div>
      </div>

      {/* Teams */}
      <div style={{ padding:"16px 12px 12px" }}>
        <div style={{ display:"grid", gridTemplateColumns:"1fr auto 1fr", alignItems:"center", gap:4 }}>

          {/* Home */}
          <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:6 }}>
            <div style={{ width:44, height:32, overflow:"hidden", borderRadius:6, background:"rgba(255,255,255,0.04)",
              display:"flex", alignItems:"center", justifyContent:"center" }}>
              {home?.flag_url
                ? <img src={home.flag_url} style={{width:"100%",height:"100%",objectFit:"cover"}} alt={home?.code} />
                : <span style={{fontSize:24}}>{flag(home?.code)}</span>}
            </div>
            <div style={{ fontSize:12, fontWeight:800, color:C.text, textAlign:"right", lineHeight:1.3, wordBreak:"break-word" }}>
              {home?.name}
            </div>
            <FormDots form={home?.form} />
          </div>

          {/* Score / inputs */}
          <div style={{ textAlign:"center", minWidth:120, maxWidth:150 }}>
            {locked ? (
              <div>
                {(match.status==="finished"||match.status==="live") && (
                  <div>
                    <div style={{ fontSize:36, fontWeight:900, color:C.text,
                      fontFamily:"'SF Mono',monospace", letterSpacing:6,
                      textShadow:match.status==="live"?`0 0 24px ${C.green}`:undefined }}>
                      {match.home_score}
                      <span style={{color:C.textFaint,fontSize:22,letterSpacing:0}}> – </span>
                      {match.away_score}
                    </div>
                    {match.status==="live" && elapsed !== null && (
                      <div style={{ fontSize:11, fontWeight:800, color:C.green, marginTop:2,
                        animation:"pulse 2s infinite" }}>
                        {elapsed}'
                      </div>
                    )}
                  </div>
                )}
                {!match.group_name && match.status==="upcoming" && (
                  <div style={{fontSize:20,color:C.textFaint,fontWeight:900}}>vs</div>
                )}
                {predHome!=="" && (
                  <div style={{ marginTop:6, display:"inline-flex", alignItems:"center", gap:4,
                    background:"rgba(255,255,255,0.04)", border:`1px solid ${C.border}`,
                    borderRadius:8, padding:"3px 10px" }}>
                    <span style={{fontSize:10,color:C.textSoft}}>You:</span>
                    <span style={{fontSize:12,fontWeight:800,color:C.text}}>{predHome}–{predAway}</span>
                  </div>
                )}
              </div>
            ) : (
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <ScoreInput value={lh} onChange={mark(setLh)} disabled={locked} />
                <span style={{fontSize:16,color:C.textFaint,fontWeight:900,paddingBottom:30}}>–</span>
                <ScoreInput value={la} onChange={mark(setLa)} disabled={locked} />
              </div>
            )}
          </div>

          {/* Away */}
          <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-start", gap:6 }}>
            <div style={{ width:44, height:32, overflow:"hidden", borderRadius:6, background:"rgba(255,255,255,0.04)",
              display:"flex", alignItems:"center", justifyContent:"center" }}>
              {away?.flag_url
                ? <img src={away.flag_url} style={{width:"100%",height:"100%",objectFit:"cover"}} alt={away?.code} />
                : <span style={{fontSize:24}}>{flag(away?.code)}</span>}
            </div>
            <div style={{ fontSize:12, fontWeight:800, color:C.text, lineHeight:1.3, wordBreak:"break-word" }}>
              {away?.name}
            </div>
            <FormDots form={away?.form} />
          </div>
        </div>

        {match.h2h?.played > 0 && (
          <H2HBadge h2h={match.h2h} homeName={home?.name} awayName={away?.name} />
        )}

        {/* All predictions panel */}
        {locked && leagueId && (
          <div style={{ marginTop:10 }}>
            <button onClick={loadPreds}
              style={{ width:"100%", background:"rgba(185,28,60,0.10)", border:`1px solid rgba(185,28,60,0.3)`,
                borderRadius:10, padding:"9px 12px", color:C.text, fontSize:12, fontWeight:700,
                cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:6,
                touchAction:"manipulation" }}>
              {predsLoading ? "Loading…" : showPreds ? "▲ Hide predictions" : "👥 See all predictions"}
            </button>
            {showPreds && allPreds && (
              <div style={{ marginTop:8, display:"flex", flexDirection:"column", gap:4 }}>
                {allPreds.length === 0
                  ? <div style={{fontSize:11,color:C.textFaint,textAlign:"center",padding:"8px 0"}}>No predictions made</div>
                  : allPreds
                      .sort((a, b) => (b.pts ?? -1) - (a.pts ?? -1))
                      .map((p, i) => {
                        const pts = p.pts;
                        const exact = pts === 4;
                        const correct = pts === 1;
                        return (
                          <div key={i} style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
                            background: exact ? "rgba(240,192,64,0.06)" : correct ? "rgba(0,200,83,0.05)" : "rgba(255,255,255,0.02)",
                            border: `1px solid ${exact ? "rgba(240,192,64,0.15)" : correct ? "rgba(0,200,83,0.12)" : C.border}`,
                            borderRadius:8, padding:"6px 10px" }}>
                            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                              <div style={{ width:26, height:26, borderRadius:7, flexShrink:0,
                                background: exact ? "rgba(240,192,64,0.15)" : "rgba(255,255,255,0.05)",
                                display:"flex", alignItems:"center", justifyContent:"center",
                                fontSize:10, fontWeight:800, color: exact ? C.gold : C.textSoft }}>
                                {p.name?.charAt(0).toUpperCase()}
                              </div>
                              <span style={{fontSize:12, fontWeight:600, color:C.text}}>{p.name}</span>
                            </div>
                            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                              <span style={{ fontSize:13, fontWeight:800, fontFamily:"'SF Mono',monospace",
                                color: exact ? C.gold : correct ? C.green : C.textSoft }}>
                                {p.predicted_home}–{p.predicted_away}
                              </span>
                              {pts !== null && pts !== undefined && (
                                <span style={{ fontSize:11, fontWeight:800,
                                  color: exact ? C.gold : correct ? C.green : C.textFaint }}>
                                  {pts}pt{pts !== 1 ? "s" : ""}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })
                }
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
          marginTop:12, paddingTop:10, borderTop:`1px solid ${C.border}` }}>
          <div style={{ fontSize:10, color:C.textFaint }}>📍 {match.stadium || "TBC"}</div>

          <div style={{ display:"flex", gap:8, alignItems:"center" }}>
            {!locked && (onChipToggle || chipWeekUsed) && (
              <button
                onClick={async e => {
                  e.stopPropagation();
                  if (chipSaving || !onChipToggle) return;
                  setChipSaving(true);
                  try { await onChipToggle(); } finally { setChipSaving(false); }
                }}
                style={{
                  background: chipActive
                    ? `linear-gradient(135deg,rgba(240,192,64,0.3),rgba(240,192,64,0.15))`
                    : onChipToggle
                      ? `linear-gradient(135deg,rgba(255,255,255,0.1),rgba(255,255,255,0.06))`
                      : "rgba(255,255,255,0.03)",
                  border: `1px solid ${chipActive ? C.gold : onChipToggle ? "rgba(255,255,255,0.2)" : C.border}`,
                  borderRadius:10, padding:"6px 12px",
                  color: chipActive ? C.gold : onChipToggle ? C.text : C.textFaint,
                  fontSize:12, fontWeight:800,
                  cursor: onChipToggle ? "pointer" : "default",
                  display:"flex", alignItems:"center", gap:5,
                  transition:"all 0.15s",
                  boxShadow: chipActive ? `0 0 14px rgba(240,192,64,0.3)` : "none",
                  opacity: chipSaving ? 0.6 : chipWeekUsed ? 0.3 : 1,
                  minHeight:34, minWidth:60, justifyContent:"center",
                }}>
                {chipSaving ? "…" : chipWeekUsed ? "⚡ used" : "⚡ 2×"}
              </button>
            )}
            {!locked && dirty && lh!=="" && la!=="" && (
              <button onClick={save} disabled={saveState==="saving"}
                style={{ background:`linear-gradient(135deg,${C.green},${C.greenDark})`,
                  border:"none", borderRadius:10, padding:"6px 16px",
                  color:"white", fontSize:12, fontWeight:800, cursor:"pointer",
                  boxShadow:"0 3px 12px rgba(0,200,83,0.3)" }}>
                {saveState==="saving"?"Saving…":saveState==="error"?"Retry ↺":"Save ✓"}
              </button>
            )}
            {saveState==="saved" && <span style={{fontSize:12,color:C.green,fontWeight:700}}>✓ Saved</span>}

            {pts && (
              <div style={{ background:pts.points===0?"rgba(255,255,255,0.03)":pts.exact?"rgba(240,192,64,0.1)":"rgba(0,200,83,0.1)",
                border:`1px solid ${pts.points===0?C.border:pts.exact?C.gold:C.green}`,
                borderRadius:12, padding:"4px 14px", textAlign:"center",
                boxShadow:pts.exact?`0 0 12px rgba(240,192,64,0.2)`:pts.points>0?`0 0 8px rgba(0,200,83,0.12)`:undefined }}>
                <div style={{ fontSize:22, fontWeight:900, lineHeight:1,
                  color:pts.points===0?C.textFaint:pts.exact?C.gold:C.green }}>{pts.points}</div>
                <div style={{fontSize:9,color:C.textSoft}}>pts</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Leaderboard row ──────────────────────────────────────────────────────────
function LbRow({ entry, rank, currentUserId }) {
  const medals = {1:"🥇",2:"🥈",3:"🥉"};
  const isMe   = entry.user_id === currentUserId;
  const init   = entry.name.split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase();
  const barPct = entry.total_points > 0 ? Math.min(100, (entry.total_points / 60) * 100) : 0;

  return (
    <div style={{ display:"flex", alignItems:"center", padding:"12px 14px", marginBottom:6,
      background:isMe?"linear-gradient(90deg,rgba(0,200,83,0.07),rgba(0,200,83,0.02))":C.card,
      borderRadius:14, border:`1px solid ${isMe?"rgba(0,200,83,0.2)":rank<=3?"rgba(240,192,64,0.1)":C.border}`,
      transition:"all 0.15s" }}>
      <div style={{ width:28, textAlign:"center", fontSize:18, flexShrink:0 }}>
        {medals[rank] || <span style={{fontSize:12,fontWeight:700,color:C.textSoft}}>{rank}</span>}
      </div>
      <div style={{ width:38, height:38, borderRadius:12, flexShrink:0, marginLeft:10,
        background:isMe?`linear-gradient(135deg,${C.greenDark},${C.green}20)`:
          rank===1?"linear-gradient(135deg,rgba(240,192,64,0.2),rgba(240,192,64,0.05))":
          "rgba(255,255,255,0.04)",
        display:"flex", alignItems:"center", justifyContent:"center",
        fontSize:13, fontWeight:800, color:isMe?C.green:rank===1?C.gold:C.textSoft,
        border:`1px solid ${isMe?"rgba(0,200,83,0.3)":rank===1?"rgba(240,192,64,0.2)":C.border}` }}>
        {init}
      </div>
      <div style={{ flex:1, marginLeft:10, minWidth:0, overflow:"hidden" }}>
        <div style={{ fontSize:13, fontWeight:700, color:isMe?C.green:C.text, display:"flex", gap:5, alignItems:"center",
          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
          <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{entry.name}</span>
          {isMe && <span style={{fontSize:9,color:C.textSoft,fontWeight:400,flexShrink:0}}>(you)</span>}
        </div>
        <div style={{ marginTop:5, height:3, background:C.border, borderRadius:2 }}>
          <div style={{ height:"100%", width:`${barPct}%`, borderRadius:2,
            background:isMe?C.green:rank===1?C.gold:rank===2?"#94A3B8":rank===3?"#CD7F32":C.blue,
            transition:"width 0.6s ease" }} />
        </div>
        <div style={{ fontSize:10, color:C.textSoft, marginTop:4,
          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
          {entry.exact_scores}🎯 · {entry.correct_results}✅ · {entry.predictions_made} preds
        </div>
      </div>
      <div style={{ textAlign:"right", marginLeft:10, flexShrink:0 }}>
        <div style={{ fontSize:22, fontWeight:900, fontVariantNumeric:"tabular-nums",
          color:isMe?C.gold:rank<=3?C.gold:C.text }}>{entry.total_points}</div>
        <div style={{fontSize:9,color:C.textFaint}}>pts</div>
      </div>
    </div>
  );
}

// ─── Pages ────────────────────────────────────────────────────────────────────
function DashboardPage({ fixtures, predMap, leaderboard, userId, userName, onNav, missingCount }) {
  const now      = new Date();
  const myEntry  = leaderboard.find(e => e.user_id === userId);
  const unpred   = fixtures.filter(m => !predMap.has(m.id) && new Date(m.kickoff) > now);
  const live     = fixtures.filter(m => m.status==="live");
  const next3    = unpred.slice(0,3);
  const myRank   = leaderboard.findIndex(e=>e.user_id===userId)+1;

  return (
    <div>
      <ESPNLiveScores />
      {/* Hero */}
      <div style={{ borderRadius:22, overflow:"hidden", marginBottom:16, position:"relative",
        background:"linear-gradient(135deg,#0A1F3A 0%,#071428 50%,#060912 100%)",
        border:`1px solid rgba(26,140,255,0.2)`, padding:"22px 18px 20px" }}>
        <div style={{ position:"absolute", inset:0, opacity:0.04,
          backgroundImage:"repeating-linear-gradient(0deg,transparent,transparent 30px,rgba(255,255,255,0.5) 30px,rgba(255,255,255,0.5) 31px),repeating-linear-gradient(90deg,transparent,transparent 30px,rgba(255,255,255,0.5) 30px,rgba(255,255,255,0.5) 31px)" }} />
        <div style={{ position:"relative" }}>
          <div style={{ fontSize:10, letterSpacing:"0.2em", color:C.blue, fontWeight:700, marginBottom:8 }}>
            FIFA WORLD CUP 2026
          </div>
          <div style={{ fontSize:26, fontWeight:900, color:"white", marginBottom:4 }}>
            Hey {userName?.split(" ")[0]} 👋
          </div>
          <div style={{ fontSize:13, color:C.textSoft }}>
            {live.length>0 ? `🟢 ${live.length} match${live.length>1?"es":""} live right now!` :
              unpred.length>0 ? `⏰ ${unpred.length} match${unpred.length>1?"es":""} still to predict` :
              "All caught up! ✓"}
          </div>
          {myEntry && (
            <div style={{ display:"flex", gap:8, marginTop:16 }}>
              {[{v:myEntry.total_points,l:"Points",c:C.gold},{v:myEntry.exact_scores,l:"Exact",c:C.green},{v:myRank?`#${myRank}`:"–",l:"Rank",c:C.blue}].map(({v,l,c})=>(
                <div key={l} style={{ background:"rgba(255,255,255,0.05)", border:`1px solid rgba(255,255,255,0.08)`,
                  borderRadius:12, padding:"10px 8px", flex:1, textAlign:"center" }}>
                  <div style={{fontSize:20,fontWeight:900,color:c}}>{v}</div>
                  <div style={{fontSize:10,color:C.textSoft,marginTop:2}}>{l}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Missing banner */}
      {missingCount>0 && (
        <button onClick={()=>onNav("missing")} style={{ width:"100%", marginBottom:16,
          background:"linear-gradient(135deg,rgba(255,61,87,0.12),rgba(255,61,87,0.06))",
          border:"1px solid rgba(255,61,87,0.3)", borderRadius:14, padding:"12px 16px",
          display:"flex", alignItems:"center", gap:12, cursor:"pointer", textAlign:"left" }}>
          <div style={{ width:36, height:36, borderRadius:10, background:"rgba(255,61,87,0.15)",
            display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0 }}>⚠️</div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:13,fontWeight:800,color:C.red}}>
              {missingCount} prediction{missingCount>1?"s":""} missing
            </div>
            <div style={{fontSize:11,color:C.textSoft,marginTop:2}}>
              Tap to see what you still need to predict
            </div>
          </div>
          <span style={{fontSize:16,color:C.red,flexShrink:0}}>→</span>
        </button>
      )}

      {/* Live */}
      {live.length>0 && (
        <div style={{ marginBottom:20 }}>
          <SectionHeader label="🟢 LIVE NOW" />
          {live.map(m=><MatchCard key={m.id} match={m} pred={predMap.get(m.id)} onSave={()=>{}} leagueId={LEAGUE_ID} />)}
        </div>
      )}

      {/* Next to predict */}
      {next3.length>0 && (
        <div style={{ marginBottom:20 }}>
          <SectionHeader label="⏰ PREDICT BEFORE KICKOFF" action={unpred.length>3?{label:`+${unpred.length-3} more`,fn:()=>onNav("fixtures")}:undefined} />
          {next3.map(m => {
            const imp = importanceLabel(m);
            return (
              <div key={m.id} onClick={()=>onNav("fixtures")} style={{ cursor:"pointer",
                background:C.card, border:`1px solid ${C.border}`, borderRadius:14,
                padding:"12px 14px", marginBottom:8, display:"flex", alignItems:"center", justifyContent:"space-between",
                transition:"background 0.15s" }}
                onMouseEnter={e=>e.currentTarget.style.background=C.cardHover}
                onMouseLeave={e=>e.currentTarget.style.background=C.card}>
                <div style={{ display:"flex", gap:10, alignItems:"center" }}>
                  <div style={{ display:"flex", gap:2 }}>
                    {[m.home_team, m.away_team].map((t,i)=>(
                      <div key={i} style={{width:28,height:20,borderRadius:4,overflow:"hidden",background:"rgba(255,255,255,0.04)"}}>
                        {t?.flag_url
                          ? <img src={t.flag_url} style={{width:"100%",height:"100%",objectFit:"cover"}} />
                          : <span style={{fontSize:14}}>{flag(t?.code)}</span>}
                      </div>
                    ))}
                  </div>
                  <div>
                    <div style={{fontSize:13,fontWeight:700,color:C.text}}>
                      {m.home_team?.name} <span style={{color:C.textFaint}}>vs</span> {m.away_team?.name}
                    </div>
                    <div style={{fontSize:10,color:C.textSoft,marginTop:2}}>
                      {new Date(m.kickoff).toLocaleDateString([],{weekday:"short",day:"numeric",month:"short"})}
                      {" · "}{new Date(m.kickoff).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}
                      {imp && <span style={{color:imp.color,marginLeft:6}}>· {imp.text}</span>}
                    </div>
                  </div>
                </div>
                <span style={{fontSize:18}}>→</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Mini leaderboard */}
      <div>
        <SectionHeader label="🏆 LEADERBOARD" action={{label:"See all",fn:()=>onNav("leaderboard")}} />
        {leaderboard.slice(0,5).map((e,i)=>
          <LbRow key={e.user_id} entry={e} rank={i+1} currentUserId={userId} />
        )}
      </div>
    </div>
  );
}

function FixturesPage({ fixtures, predMap, onSave, chipMatchId, chipAvailable, onChipToggle, leagueId }) {
  const [filter, setFilter] = useState("all");

  const filtered = filter==="unpredicted"
    ? fixtures.filter(m=>m.status==="upcoming"&&!predMap.has(m.id))
    : filter==="live"
    ? fixtures.filter(m=>m.status==="live")
    : filter==="finished"
    ? fixtures.filter(m=>m.status==="finished")
    : fixtures;

  const filters = [
    {v:"all",l:"All"},
    {v:"unpredicted",l:"To Predict"},
    {v:"live",l:"🟢 Live"},
    {v:"finished",l:"Results"},
  ];

  return (
    <div>
      <PageTitle title="Fixtures" sub="Predictions lock at kickoff" />
      <div style={{ display:"flex", gap:6, marginBottom:18, overflowX:"auto", paddingBottom:2 }}>
        {filters.map(({v,l})=>(
          <button key={v} onClick={()=>setFilter(v)}
            style={{ flexShrink:0, background:filter===v?`linear-gradient(135deg,${C.accentLight},${C.accent})`:"rgba(255,255,255,0.04)",
              border:`1px solid ${filter===v?"transparent":C.border}`,
              borderRadius:20, padding:"7px 16px", color:filter===v?"white":C.textSoft,
              fontSize:12, fontWeight:600, cursor:"pointer", transition:"all 0.15s",
              boxShadow:filter===v?"0 3px 10px rgba(185,28,60,0.3)":"none" }}>
            {l}
          </button>
        ))}
      </div>
      {filtered.length===0
        ? <EmptyState msg="Nothing to show here." />
        : filtered.map(m => {
            const isActive  = chipMatchId === m.id;
            const canToggle = isActive || chipMatchId === null;
            return (
              <MatchCard key={m.id} match={m} pred={predMap.get(m.id)} onSave={onSave}
                chipActive={isActive}
                chipAvailable={canToggle}
                onChipToggle={onChipToggle && canToggle ? () => onChipToggle(m.id) : null}
                chipWeekUsed={chipMatchId !== null && !isActive}
                leagueId={leagueId} />
            );
          })
      }
    </div>
  );
}

function LeaderboardPage({ leaderboard, userId }) {
  const top3 = leaderboard.slice(0,3);
  const totalPred = leaderboard.reduce((a,e)=>a+e.predictions_made,0);

  return (
    <div>
      <PageTitle title="Leaderboard" sub={`${leaderboard.length} players · ${totalPred} predictions`} />

      {/* Podium */}
      {top3.length>=2 && (
        <div style={{ background:"linear-gradient(160deg,rgba(10,31,58,0.8),rgba(6,9,18,0.8))",
          border:`1px solid rgba(240,192,64,0.15)`, borderRadius:20,
          padding:"20px 16px 16px", marginBottom:16,
          display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, alignItems:"end" }}>
          {[1,0,2].map(i => {
            const e = top3[i]; if(!e) return <div key={i}/>;
            const rank = i+1;
            const h = rank===1?80:64;
            return (
              <div key={e.user_id} style={{ textAlign:"center" }}>
                <div style={{ fontSize:rank===1?32:24, marginBottom:4 }}>
                  {rank===1?"🥇":rank===2?"🥈":"🥉"}
                </div>
                <div style={{ width:h, height:h, borderRadius:16, margin:"0 auto 8px",
                  background:rank===1?"linear-gradient(135deg,rgba(240,192,64,0.25),rgba(240,192,64,0.05))":
                    rank===2?"linear-gradient(135deg,rgba(148,163,184,0.2),rgba(148,163,184,0.05))":
                    "linear-gradient(135deg,rgba(205,127,50,0.2),rgba(205,127,50,0.05))",
                  border:`2px solid ${rank===1?"rgba(240,192,64,0.4)":rank===2?"rgba(148,163,184,0.3)":"rgba(205,127,50,0.3)"}`,
                  display:"flex", alignItems:"center", justifyContent:"center",
                  fontSize:rank===1?22:18, fontWeight:900,
                  color:rank===1?C.gold:rank===2?"#94A3B8":"#CD7F32" }}>
                  {e.name.split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase()}
                </div>
                <div style={{fontSize:12,fontWeight:700,color:C.text}}>{e.name.split(" ")[0]}</div>
                <div style={{fontSize:20,fontWeight:900,color:rank===1?C.gold:C.text,marginTop:2}}>{e.total_points}</div>
                <div style={{fontSize:9,color:C.textSoft}}>pts</div>
              </div>
            );
          })}
        </div>
      )}

      {leaderboard.map((e,i)=><LbRow key={e.user_id} entry={e} rank={i+1} currentUserId={userId} />)}
    </div>
  );
}

function StatsPage({ fixtures, predMap, leaderboard, userId }) {
  const finished = fixtures.filter(m=>m.status==="finished");
  const myRank = leaderboard.findIndex(e=>e.user_id===userId)+1;
  const rows = finished.map(m => {
    const pred = predMap.get(m.id);
    if (!pred||pred.predicted_home===undefined) return null;
    const s = calcScore(pred.predicted_home, pred.predicted_away, m.home_score, m.away_score);
    return { match:m, pred, points:pred.scores?.points_awarded??s.points, ...s };
  }).filter(Boolean);
  const stats = computeStats(rows, myRank);
  const total = rows.reduce((a,r)=>a+r.points,0);
  const earned = ACHIEVEMENTS.filter(a=>a.check(stats));
  const locked_ = ACHIEVEMENTS.filter(a=>!a.check(stats));

  return (
    <div>
      <PageTitle title="My Stats" sub="Your performance across the tournament" />

      {/* Stats grid */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(2,minmax(0,1fr))", gap:8, marginBottom:20 }}>
        {[
          {label:"TOTAL POINTS", value:total, color:C.gold, icon:"⭐"},
          {label:"ACCURACY", value:`${stats.pct}%`, sub:`${rows.filter(r=>r.points>0).length}/${rows.length}`, color:C.green, icon:"📊"},
          {label:"EXACT SCORES", value:stats.exact, color:"#A855F7", icon:"🎯"},
          {label:"BEST STREAK", value:stats.bestStreak, sub:"correct in a row", color:C.blue, icon:"🔥"},
        ].map(({label,value,sub,color,icon})=>(
          <div key={label} style={{ background:C.card, border:`1px solid ${C.border}`,
            borderRadius:16, padding:16, position:"relative", overflow:"hidden" }}>
            <div style={{ position:"absolute", top:10, right:12, fontSize:24, opacity:0.1 }}>{icon}</div>
            <div style={{fontSize:9,color:C.textSoft,letterSpacing:"0.1em",marginBottom:8}}>{label}</div>
            <div style={{fontSize:32,fontWeight:900,color,lineHeight:1}}>{value}</div>
            {sub && <div style={{fontSize:10,color:C.textFaint,marginTop:4}}>{sub}</div>}
          </div>
        ))}
      </div>

      {/* Achievements */}
      <div style={{fontSize:14,fontWeight:800,color:C.text,marginBottom:12}}>
        Achievements <span style={{fontSize:11,color:C.textSoft,fontWeight:400}}>({earned.length}/{ACHIEVEMENTS.length})</span>
      </div>
      {earned.length>0 && (
        <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:12}}>
          {earned.map(a=>(
            <div key={a.id} style={{ background:"linear-gradient(135deg,rgba(240,192,64,0.1),rgba(240,192,64,0.04))",
              border:"1px solid rgba(240,192,64,0.25)", borderRadius:14, padding:"10px 14px",
              display:"flex", alignItems:"center", gap:8 }}>
              <span style={{fontSize:22}}>{a.icon}</span>
              <div>
                <div style={{fontSize:12,fontWeight:800,color:C.gold}}>{a.name}</div>
                <div style={{fontSize:10,color:C.textSoft}}>{a.desc}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      {locked_.length>0 && (
        <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:24}}>
          {locked_.map(a=>(
            <div key={a.id} style={{ background:C.card, border:`1px solid ${C.border}`,
              borderRadius:14, padding:"10px 14px", display:"flex", alignItems:"center", gap:8, opacity:0.35 }}>
              <span style={{fontSize:22,filter:"grayscale(1)"}}>{a.icon}</span>
              <div>
                <div style={{fontSize:12,fontWeight:700,color:C.textSoft}}>{a.name}</div>
                <div style={{fontSize:10,color:C.textFaint}}>{a.desc}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* History */}
      <div style={{fontSize:11,fontWeight:700,color:C.textSoft,letterSpacing:"0.1em",marginBottom:10}}>MATCH HISTORY</div>
      {rows.length===0
        ? <EmptyState msg="No finished matches yet. History appears here." />
        : rows.map(({match,pred,points,exact})=>(
          <div key={match.id} style={{ background:C.card, border:`1px solid ${C.border}`,
            borderRadius:12, padding:"10px 14px", marginBottom:8,
            display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <div>
              <div style={{fontSize:12,fontWeight:700,color:C.text}}>
                {match.home_team?.name} <span style={{color:C.textSoft,fontSize:11}}>{match.home_score}–{match.away_score}</span> {match.away_team?.name}
              </div>
              <div style={{fontSize:10,color:C.textSoft,marginTop:2}}>
                You predicted: <span style={{color:C.text,fontWeight:700}}>{pred.predicted_home}–{pred.predicted_away}</span>
              </div>
            </div>
            <div style={{ background:points===0?"rgba(255,255,255,0.03)":points===3?"rgba(240,192,64,0.1)":"rgba(0,200,83,0.1)",
              border:`1px solid ${points===0?C.border:points===3?C.gold:C.green}`,
              borderRadius:10, padding:"5px 12px", textAlign:"center", minWidth:42 }}>
              <div style={{fontSize:18,fontWeight:900,color:points===0?C.textFaint:points===3?C.gold:C.green}}>{points}</div>
              <div style={{fontSize:9,color:C.textFaint}}>pts</div>
            </div>
          </div>
        ))
      }
    </div>
  );
}

function NotificationsPage() {
  const [status, setStatus] = useState("idle"); // idle | requesting | granted | denied | unsupported

  const handleEnable = async () => {
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setStatus("unsupported"); return;
      }
      setStatus("requesting");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setStatus("denied"); return; }

      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      const sub = existing || await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: "BLf2yqyu3jSuaN7VIceL9O3clxztZxpvT8oLF1E6lnP4I2BpbA9ifGshBxYx79vNBolieVwOPJFIVgFj-EyOdjI",
      });
      const key  = sub.getKey("p256dh");
      const auth = sub.getKey("auth");
      await supabase.from("push_subscriptions").upsert({
        user_id:  (await supabase.auth.getUser()).data.user?.id,
        endpoint: sub.endpoint,
        p256dh:   btoa(String.fromCharCode(...new Uint8Array(key))),
        auth:     btoa(String.fromCharCode(...new Uint8Array(auth))),
      }, { onConflict: "user_id,endpoint" });
      setStatus("granted");
    } catch(e) {
      setStatus("denied");
    }
  };

  const icon  = status === "granted" ? "✅" : status === "denied" ? "🔕" : status === "unsupported" ? "📵" : "🔔";
  const title = status === "granted" ? "You're all set!" : status === "denied" ? "Notifications Blocked" : status === "unsupported" ? "Not Supported" : "Enable Daily Reminders";
  const body  = status === "granted"
    ? "You'll get a notification every day at 4pm with that day's matches."
    : status === "denied"
    ? "You blocked notifications. Go to your phone Settings → find this site → set Notifications to Allow, then come back and try again."
    : status === "unsupported"
    ? "Your browser doesn\'t support push notifications. On iPhone, use Safari and add the app to your Home Screen first."
    : "Get a daily nudge at 4:00 PM reminding you to predict that day\'s matches before kickoff.";

  return (
    <div>
      <PageTitle title="🔔 Notifications" sub="Daily reminders at 4:00 PM" />

      <div style={{ background: status === "granted" ? "rgba(0,200,83,0.06)" : "rgba(240,192,64,0.06)",
        border: `1px solid ${status === "granted" ? "rgba(0,200,83,0.25)" : "rgba(240,192,64,0.15)"}`,
        borderRadius:20, padding:24, marginBottom:16, textAlign:"center" }}>
        <div style={{fontSize:52, marginBottom:12}}>{icon}</div>
        <div style={{fontSize:16, fontWeight:800, color:C.text, marginBottom:8}}>{title}</div>
        <div style={{fontSize:13, color:C.textSoft, lineHeight:1.7, marginBottom:22}}>{body}</div>
        {status !== "granted" && status !== "unsupported" && (
          <button onClick={handleEnable} disabled={status === "requesting"}
            style={{ width:"100%", background:`linear-gradient(135deg,${C.gold},${C.goldDim})`,
              border:"none", borderRadius:14, padding:16, color:"#000",
              fontSize:16, fontWeight:900, cursor:"pointer", opacity: status === "requesting" ? 0.6 : 1,
              boxShadow:"0 4px 20px rgba(240,192,64,0.35)" }}>
            {status === "requesting" ? "Enabling…" : "🔔 Enable Notifications"}
          </button>
        )}
      </div>

      {/* iPhone instructions */}
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:16, padding:16, marginBottom:12 }}>
        <div style={{fontSize:11, fontWeight:800, color:C.textFaint, letterSpacing:"0.1em", marginBottom:10}}>📱 iPHONE USERS</div>
        <div style={{fontSize:13, color:C.textSoft, lineHeight:1.9}}>
          Push notifications require the app to be installed on your Home Screen:<br/>
          <strong style={{color:C.text}}>1.</strong> Open in <strong style={{color:C.text}}>Safari</strong><br/>
          <strong style={{color:C.text}}>2.</strong> Tap the <strong style={{color:C.text}}>Share ↑</strong> button<br/>
          <strong style={{color:C.text}}>3.</strong> Tap <strong style={{color:C.text}}>"Add to Home Screen"</strong><br/>
          <strong style={{color:C.text}}>4.</strong> Open from your Home Screen<br/>
          <strong style={{color:C.text}}>5.</strong> Come back here and tap Enable
        </div>
      </div>

      {/* What you get */}
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:16, padding:16 }}>
        <div style={{fontSize:11, fontWeight:800, color:C.textFaint, letterSpacing:"0.1em", marginBottom:12}}>WHAT YOU GET</div>
        {[
          ["🕓","Daily at 4:00 PM","Sent every day that matches are scheduled"],
          ["⚽","Today\'s matches","Shows which teams are playing"],
          ["🎯","One tap to predict","Opens straight to your Fixtures"],
        ].map(([ico, t, d]) => (
          <div key={t} style={{display:"flex", gap:12, alignItems:"flex-start", marginBottom:12}}>
            <span style={{fontSize:22, flexShrink:0}}>{ico}</span>
            <div>
              <div style={{fontSize:13, fontWeight:700, color:C.text}}>{t}</div>
              <div style={{fontSize:12, color:C.textSoft}}>{d}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RulesPage() {
  const Block = ({emoji,title,children}) => (
    <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:18,padding:18,marginBottom:10}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
        <div style={{width:40,height:40,borderRadius:12,background:"rgba(255,255,255,0.04)",
          display:"flex",alignItems:"center",justifyContent:"center",fontSize:20}}>{emoji}</div>
        <div style={{fontSize:15,fontWeight:800,color:C.text}}>{title}</div>
      </div>
      {children}
    </div>
  );

  return (
    <div>
      <PageTitle title="How to Play" sub="Rules, scoring & tips" />

      <Block emoji="🎯" title="Making Predictions">
        <p style={{fontSize:13,color:C.textSoft,lineHeight:1.8,margin:0}}>
          Go to <strong style={{color:C.text}}>Fixtures</strong> and set a score for each match using the +/– buttons.
          Hit <strong style={{color:C.green}}>Save</strong> to lock it in.
          Predictions are <strong style={{color:C.red}}>locked at kickoff</strong> — you can't change them once the match starts.
        </p>
      </Block>

      <Block emoji="⭐" title="Scoring System">
        {[
          {icon:"🎯",label:"Exact score",pts:"4 pts",c:C.gold,note:"Right scoreline (3 pts) + right winner (1 pt)"},
          {icon:"✅",label:"Correct result",pts:"1 pt",c:C.green,note:"Right winner or draw, but wrong score"},
          {icon:"❌",label:"Wrong result",pts:"0 pts",c:C.textFaint,note:"Got the winner wrong"},
        ].map(({icon,label,pts,c,note})=>(
          <div key={label} style={{padding:"10px 0",borderBottom:`1px solid ${C.border}`}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{fontSize:13,color:C.text}}>{icon} {label}</span>
              <span style={{fontSize:16,fontWeight:900,color:c}}>{pts}</span>
            </div>
            <div style={{fontSize:11,color:C.textSoft,marginTop:3}}>{note}</div>
          </div>
        ))}
        <div style={{marginTop:12,padding:12,background:"rgba(240,192,64,0.05)",
          border:"1px solid rgba(240,192,64,0.1)",borderRadius:10}}>
          <div style={{fontSize:11,color:C.textSoft,lineHeight:1.8}}>
            <strong style={{color:C.text}}>Example:</strong> Real result 2–1.
            Predicted 2–0 → <span style={{color:C.gold,fontWeight:700}}>4 pts</span>.&nbsp;
            Predicted 1–0 → <span style={{color:C.green,fontWeight:700}}>1 pt</span>.&nbsp;
            Predicted 0–2 → <span style={{color:C.textFaint,fontWeight:700}}>0 pts</span>.
          </div>
        </div>
      </Block>

      <Block emoji="📅" title="Match Stakes">
        <p style={{fontSize:13,color:C.textSoft,lineHeight:1.8,margin:0}}>
          Each match card shows useful context: <strong style={{color:C.text}}>team form</strong> (last 5 results),
          <strong style={{color:C.text}}> H2H record</strong>, and <strong style={{color:C.text}}>betting odds</strong> (where available).
          Use this to make smarter predictions!
        </p>
      </Block>

      <Block emoji="🏆" title="Winning">
        <p style={{fontSize:13,color:C.textSoft,lineHeight:1.8,margin:0}}>
          Points accumulate across all <strong style={{color:C.text}}>104 WC matches</strong>.
          The player with the most points after the Final on{" "}
          <strong style={{color:C.gold}}>19 July 2026</strong> wins the league.
        </p>
      </Block>

      <Block emoji="⚡" title="Double Points Chip">
        <p style={{fontSize:13,color:C.textSoft,lineHeight:1.8,margin:0}}>
          Once per week, tap the <strong style={{color:C.gold}}>⚡ 2×</strong> button on any upcoming match to double your points for that game.
          The chip resets every Monday. You can remove and re-place it on a different match before kickoff, but
          once the match starts it's locked in.
        </p>
      </Block>

      <Block emoji="🔑" title="Lost Your Session?">
        <p style={{fontSize:13,color:C.textSoft,lineHeight:1.8,margin:0}}>
          Your account is saved permanently. If you get logged out, just open the app again,
          enter your <strong style={{color:C.text}}>same name</strong> and the{" "}
          <strong style={{color:C.gold}}>league password</strong> — all your predictions and
          points will be restored automatically.
        </p>
      </Block>
    </div>
  );
}

// ─── Missing Predictions page ─────────────────────────────────────────────────
function MissingPage({ fixtures, predMap, onSave }) {
  const now = new Date();

  // Split into: still open (kickoff in future) vs missed (kicked off, no pred)
  const open   = fixtures.filter(m => !predMap.has(m.id) && new Date(m.kickoff) > now);
  const missed = fixtures.filter(m => !predMap.has(m.id) && new Date(m.kickoff) <= now && m.status !== "finished");
  const noScore = fixtures.filter(m => {
    const p = predMap.get(m.id);
    return p && m.status === "finished" && (p.scores?.points_awarded === undefined || p.scores?.points_awarded === null);
  });

  const urgency = (ko) => {
    const diff = new Date(ko) - now;
    const hrs  = diff / 3600000;
    if (hrs < 1)  return { label:`< 1 hr`, color:C.red };
    if (hrs < 6)  return { label:`${Math.round(hrs)}h`,  color:C.red };
    if (hrs < 24) return { label:`${Math.round(hrs)}h`,  color:C.gold };
    return { label:`${Math.ceil(hrs/24)}d`, color:C.textSoft };
  };

  return (
    <div>
      <PageTitle title="What You're Missing" sub={`${open.length} still open · ${missed.length} missed`} />

      {open.length === 0 && missed.length === 0 ? (
        <div style={{ background:`linear-gradient(135deg,rgba(0,200,83,0.1),rgba(0,200,83,0.04))`,
          border:`1px solid rgba(0,200,83,0.2)`, borderRadius:18, padding:"32px 20px", textAlign:"center" }}>
          <div style={{fontSize:48,marginBottom:12}}>🎉</div>
          <div style={{fontSize:18,fontWeight:800,color:C.green,marginBottom:6}}>All caught up!</div>
          <div style={{fontSize:13,color:C.textSoft}}>You've predicted every available match.</div>
        </div>
      ) : (
        <>
          {/* Still open */}
          {open.length > 0 && (
            <div style={{marginBottom:24}}>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12 }}>
                <div style={{ width:8, height:8, borderRadius:"50%", background:C.green,
                  boxShadow:`0 0 8px ${C.green}`, animation:"pulse 1.5s infinite" }} />
                <div style={{fontSize:10,fontWeight:700,color:C.textSoft,letterSpacing:"0.12em"}}>
                  STILL OPEN — PREDICT NOW
                </div>
              </div>
              {open.map(m => {
                const u = urgency(m.kickoff);
                const imp = importanceLabel(m);
                return (
                  <div key={m.id} style={{ background:C.card, border:`1px solid ${u.color === C.red ? "rgba(255,61,87,0.25)" : C.border}`,
                    borderRadius:14, padding:"12px 14px", marginBottom:8,
                    boxShadow:u.color===C.red?"0 0 12px rgba(255,61,87,0.08)":"none" }}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:14,fontWeight:800,color:C.text,marginBottom:4}}>
                          {m.home_team?.name} <span style={{color:C.textFaint}}>vs</span> {m.away_team?.name}
                        </div>
                        <div style={{fontSize:11,color:C.textSoft}}>
                          {m.group_name || m.round}
                          {imp && <span style={{color:imp.color,marginLeft:6}}>· {imp.text}</span>}
                        </div>
                        <div style={{fontSize:11,color:C.textSoft,marginTop:2}}>
                          {new Date(m.kickoff).toLocaleDateString([],{weekday:"short",day:"numeric",month:"short"})}
                          {" · "}{new Date(m.kickoff).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}
                        </div>
                      </div>
                      <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:6, flexShrink:0 }}>
                        <div style={{ background:`${u.color}18`, border:`1px solid ${u.color}40`,
                          borderRadius:20, padding:"3px 10px", fontSize:11, fontWeight:800, color:u.color }}>
                          ⏰ {u.label}
                        </div>
                      </div>
                    </div>
                    {/* Inline prediction inputs */}
                    <InlinePredictRow match={m} onSave={onSave} />
                  </div>
                );
              })}
            </div>
          )}

          {/* Missed */}
          {missed.length > 0 && (
            <div style={{marginBottom:24}}>
              <div style={{fontSize:10,fontWeight:700,color:C.textSoft,letterSpacing:"0.12em",marginBottom:12}}>
                ❌ MISSED — PREDICTIONS CLOSED
              </div>
              {missed.map(m => (
                <div key={m.id} style={{ background:"rgba(255,61,87,0.04)", border:`1px solid rgba(255,61,87,0.15)`,
                  borderRadius:12, padding:"11px 14px", marginBottom:6,
                  display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                  <div>
                    <div style={{fontSize:13,fontWeight:700,color:C.textSoft}}>
                      {m.home_team?.name} vs {m.away_team?.name}
                    </div>
                    <div style={{fontSize:10,color:C.textFaint,marginTop:2}}>
                      {m.group_name || m.round} · Kicked off · 0 pts awarded
                    </div>
                  </div>
                  <span style={{fontSize:20,fontWeight:900,color:"rgba(255,61,87,0.4)"}}>0</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Awaiting scores */}
      {noScore.length > 0 && (
        <div>
          <div style={{fontSize:10,fontWeight:700,color:C.textSoft,letterSpacing:"0.12em",marginBottom:12}}>
            ⏳ PREDICTED — AWAITING SCORE CALCULATION
          </div>
          {noScore.map(m => {
            const p = predMap.get(m.id);
            return (
              <div key={m.id} style={{ background:C.card, border:`1px solid ${C.border}`,
                borderRadius:12, padding:"11px 14px", marginBottom:6,
                display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                <div>
                  <div style={{fontSize:13,fontWeight:700,color:C.text}}>
                    {m.home_team?.name} {m.home_score}–{m.away_score} {m.away_team?.name}
                  </div>
                  <div style={{fontSize:10,color:C.textSoft,marginTop:2}}>
                    Your prediction: {p.predicted_home}–{p.predicted_away}
                  </div>
                </div>
                <div style={{fontSize:11,color:C.textFaint,fontWeight:600}}>Syncing…</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Inline predict input used inside MissingPage cards
function InlinePredictRow({ match, onSave }) {
  const [lh, setLh] = useState("");
  const [la, setLa] = useState("");
  const [state, setState] = useState("idle");

  const save = async () => {
    if (lh===""||la==="") return;
    setState("saving");
    try {
      await onSave({ matchId:match.id, home:parseInt(lh), away:parseInt(la) });
      setState("saved");
    } catch { setState("error"); }
  };

  if (state === "saved") {
    return (
      <div style={{ marginTop:10, padding:"8px 12px", background:"rgba(0,200,83,0.08)",
        border:"1px solid rgba(0,200,83,0.2)", borderRadius:10, fontSize:12,
        color:C.green, fontWeight:700, textAlign:"center" }}>
        ✓ Prediction saved — {lh}–{la}
      </div>
    );
  }

  const numH = lh==="" ? null : parseInt(lh);
  const numA = la==="" ? null : parseInt(la);

  return (
    <div style={{ marginTop:12, display:"flex", alignItems:"center", gap:10,
      padding:"10px 12px", background:"rgba(0,200,83,0.04)",
      border:"1px solid rgba(0,200,83,0.15)", borderRadius:12 }}>
      <span style={{fontSize:11,color:C.textSoft,flexShrink:0}}>Your pick:</span>
      {/* Home score */}
      <div style={{display:"flex",alignItems:"center",gap:4,flex:1,justifyContent:"center"}}>
        <button onClick={()=>setLh(String(Math.min(20,(numH||0)+1)))}
          style={{width:34,height:34,borderRadius:8,background:"rgba(0,200,83,0.1)",border:`1px solid ${C.greenDark}`,color:C.green,fontSize:14,cursor:"pointer"}}>+</button>
        <div style={{width:42,height:42,borderRadius:10,background:C.surface,border:`1px solid ${C.border}`,
          display:"flex",alignItems:"center",justifyContent:"center",
          fontSize:20,fontWeight:900,color:C.text,fontFamily:"'SF Mono',monospace"}}>
          {numH===null?<span style={{color:C.textFaint,fontSize:13}}>–</span>:numH}
        </div>
        <button onClick={()=>setLh(String(Math.max(0,(numH||0)-1)))}
          style={{width:34,height:34,borderRadius:8,background:"rgba(0,200,83,0.1)",border:`1px solid ${C.greenDark}`,color:C.green,fontSize:14,cursor:"pointer"}}>–</button>
      </div>
      <span style={{fontSize:16,color:C.textFaint,fontWeight:900}}>:</span>
      {/* Away score */}
      <div style={{display:"flex",alignItems:"center",gap:4,flex:1,justifyContent:"center"}}>
        <button onClick={()=>setLa(String(Math.min(20,(numA||0)+1)))}
          style={{width:34,height:34,borderRadius:8,background:"rgba(0,200,83,0.1)",border:`1px solid ${C.greenDark}`,color:C.green,fontSize:14,cursor:"pointer"}}>+</button>
        <div style={{width:42,height:42,borderRadius:10,background:C.surface,border:`1px solid ${C.border}`,
          display:"flex",alignItems:"center",justifyContent:"center",
          fontSize:20,fontWeight:900,color:C.text,fontFamily:"'SF Mono',monospace"}}>
          {numA===null?<span style={{color:C.textFaint,fontSize:13}}>–</span>:numA}
        </div>
        <button onClick={()=>setLa(String(Math.max(0,(numA||0)-1)))}
          style={{width:34,height:34,borderRadius:8,background:"rgba(0,200,83,0.1)",border:`1px solid ${C.greenDark}`,color:C.green,fontSize:14,cursor:"pointer"}}>–</button>
      </div>
      <button onClick={save} disabled={lh===""||la===""||state==="saving"}
        style={{ flexShrink:0, background:lh!==""&&la!==""?`linear-gradient(135deg,${C.green},${C.greenDark})`:"rgba(255,255,255,0.05)",
          border:"none", borderRadius:10, padding:"10px 14px", color:"white",
          fontSize:12, fontWeight:800, cursor:lh!==""&&la!==""?"pointer":"not-allowed",
          boxShadow:lh!==""&&la!==""?"0 3px 10px rgba(0,200,83,0.3)":"none" }}>
        {state==="saving"?"…":"Save"}
      </button>
    </div>
  );
}

// ─── Shared UI components ─────────────────────────────────────────────────────
function PageTitle({ title, sub }) {
  return (
    <div style={{ marginBottom:20 }}>
      <div style={{ fontSize:24, fontWeight:900, color:C.text, letterSpacing:"-0.5px" }}>{title}</div>
      {sub && <div style={{ fontSize:13, color:C.textSoft, marginTop:4 }}>{sub}</div>}
    </div>
  );
}

function SectionHeader({ label, action }) {
  return (
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
      <div style={{ fontSize:10, fontWeight:700, color:C.textSoft, letterSpacing:"0.12em" }}>{label}</div>
      {action && (
        <button onClick={action.fn} style={{ background:"none", border:"none", color:C.gold,
          fontSize:12, fontWeight:600, cursor:"pointer" }}>{action.label} →</button>
      )}
    </div>
  );
}

function EmptyState({ msg }) {
  return (
    <div style={{ textAlign:"center", padding:"40px 20px", color:C.textSoft, fontSize:13 }}>
      <div style={{ fontSize:32, marginBottom:10, opacity:0.4 }}>⚽</div>
      {msg}
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
// Auto-reload when a new version is deployed
function useAutoUpdate() {
  useEffect(() => {
    let current = null;
    const check = async () => {
      try {
        const r = await fetch("/version.txt?t=" + Date.now());
        const v = await r.text();
        if (current === null) { current = v.trim(); return; }
        if (v.trim() !== current) window.location.reload();
      } catch {}
    };
    check();
    const iv = setInterval(check, 60000);
    return () => clearInterval(iv);
  }, []);
}

export default function App() {
  useAutoUpdate();
  const [user,      setUser]    = useState(null);
  const [userName,  setName]    = useState(null);
  const [tab,            setTab]    = useState("dashboard");
  const [fixtures,       setFix]    = useState([]);
  const [preds,          setPreds]  = useState([]);
  const [leaderboard,    setLb]     = useState([]);
  const [chips,          setChips]  = useState([]);
  const [loading,        setLoading] = useState(false);
  const [authReady,      setReady]  = useState(false);
  const [pendingSession, setPending] = useState(null);

  useEffect(() => {
    // On page load: if session exists but no profile, it's stale (user was deleted) — sign out
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        const { data: p } = await supabase.from("profiles").select("name").eq("id", session.user.id).single();
        if (p?.name) {
          setUser(session.user); setName(p.name);
        } else {
          // Local-only signout — works even if the user was deleted server-side
          await supabase.auth.signOut({ scope: "local" });
        }
      }
      setReady(true);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === "SIGNED_IN" && session?.user) {
        const { data: p, error: pErr } = await supabase.from("profiles").select("name").eq("id", session.user.id).single();
        if (p?.name) {
          setUser(session.user); setName(p.name);
        } else if (pErr?.code === "PGRST116" || !p) {
          // No profile yet — new sign-up, collect name+password
          setPending(session);
        }
      }
      if (event === "SIGNED_OUT") {
        setUser(null); setName(null); setPending(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const reload = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [{ data:fx }, { data:pr }, { data:lb }, { data:ch }] = await Promise.all([
        supabase.from("matches")
          .select("id,kickoff,stadium,round,group_name,matchday,status,home_score,away_score,h2h,home_team:teams!matches_home_team_id_fkey(id,name,code,flag_url,form),away_team:teams!matches_away_team_id_fkey(id,name,code,flag_url,form)")
          .order("kickoff"),
        supabase.from("predictions")
          .select("id,match_id,predicted_home,predicted_away,scores(points_awarded)")
          .eq("user_id", user.id).eq("league_id", LEAGUE_ID),
        supabase.from("leaderboard").select("*").eq("league_id", LEAGUE_ID).order("rank"),
        supabase.from("chips").select("*").eq("user_id", user.id).eq("league_id", LEAGUE_ID),
      ]);
      setFix(fx||[]); setPreds(pr||[]); setLb(lb||[]); setChips(ch||[]);
    } finally { setLoading(false); }
  }, [user]);

  // ── Sync scores from ESPN via Edge Function ──────────────────────────────
  const syncScores = useCallback(async () => {
    if (!user) return;
    try {
      await supabase.functions.invoke("sync-scores");
      await reload(); // reload Supabase data after sync
    } catch (_) {}
  }, [user, reload]);

  useEffect(() => { reload(); }, [reload]);

  // Kick off an immediate sync on load so scores are always fresh
  useEffect(() => { if (user) syncScores(); }, [user]);

  const hasLive = fixtures.some(m => m.status === "live");

  // While live: sync ESPN → Supabase every 60s, reload UI every 10s
  // No live games: sync every 5 min just in case a match just ended
  useEffect(() => {
    const syncIv = setInterval(syncScores, hasLive ? 60000 : 300000);
    return () => clearInterval(syncIv);
  }, [syncScores, hasLive]);

  useEffect(() => {
    const iv = setInterval(reload, hasLive ? 10000 : 30000);
    return () => clearInterval(iv);
  }, [reload, hasLive]);

  const predMap = new Map(preds.map(p => [p.match_id, p]));

  const weekStart = startOfISOWeek();
  const chipThisWeek = chips.find(c => c.chip_type === "double_game" && new Date(c.activated_at) >= weekStart);
  const chipMatchId = chipThisWeek?.target_match_id ?? null;

  const toggleChip = async (matchId) => {
    if (chipMatchId === matchId) {
      const { error } = await supabase.from("chips").delete().eq("id", chipThisWeek.id);
      if (error) { alert("Couldn't remove chip: " + error.message); return; }
    } else if (!chipMatchId) {
      const { error } = await supabase.from("chips").insert({
        user_id: user.id, league_id: LEAGUE_ID, chip_type: "double_game",
        target_match_id: matchId, activated_at: new Date().toISOString(),
      });
      if (error) { alert("Couldn't save chip: " + error.message); return; }
    }
    await reload();
  };

  const savePred = async ({ matchId, home, away }) => {
    await supabase.from("predictions").upsert({
      user_id:user.id, league_id:LEAGUE_ID, match_id:matchId,
      predicted_home:home, predicted_away:away,
    }, { onConflict:"user_id,league_id,match_id" });
    await reload();
  };

  if (!authReady) {
    return (
      <div style={{minHeight:"100vh",background:C.bg,display:"flex",alignItems:"center",justifyContent:"center"}}>
        <style>{"@keyframes spin{to{transform:rotate(360deg)}}"}</style>
        <div style={{width:40,height:40,border:"3px solid rgba(240,192,64,0.2)",borderTopColor:C.gold,borderRadius:"50%",animation:"spin 0.8s linear infinite"}} />
      </div>
    );
  }

  if (!user) {
    return (
      <JoinScreen
        onJoined={({ userId, name }) => {
          supabase.auth.getSession().then(({ data: { session } }) => {
            setUser(session?.user || { id: userId });
            setName(name);
          });
        }}
      />
    );
  }

  const now = new Date();
  // Open: upcoming matches without a prediction where kickoff hasn't passed yet
  const openCount   = fixtures.filter(m => !predMap.has(m.id) && new Date(m.kickoff) > now).length;
  // Missed: kicked off but no prediction
  const missedCount = fixtures.filter(m => !predMap.has(m.id) && new Date(m.kickoff) <= now && m.status !== "finished").length;
  const missingCount = openCount + missedCount;

  const tabs = [
    { id:"dashboard",      icon:"⚽", label:"Home" },
    { id:"fixtures",       icon:"📅", label:"Fixtures" },
    { id:"leaderboard",    icon:"🏆", label:"Table" },
    { id:"stats",          icon:"📊", label:"Stats" },
    { id:"notifications",  icon:"🔔", label:"Notify" },
  ];
  // "missing" tab still navigable via dashboard badge but excluded from bottom nav

  return (
    <div style={{ background:C.bg, minHeight:"100vh", color:C.text }}>
      <style>{`
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
        @keyframes spin{to{transform:rotate(360deg)}}
        *{-webkit-tap-highlight-color:transparent;box-sizing:border-box}
        ::-webkit-scrollbar{width:3px}
        ::-webkit-scrollbar-thumb{background:${C.border};border-radius:2px}
        input,button{font-family:inherit}
        html,body{overflow-x:hidden;-webkit-text-size-adjust:100%}
        button{touch-action:manipulation}
      `}</style>

      {/* Top bar */}
      <div style={{ position:"sticky", top:0, zIndex:100,
        background:"rgba(6,9,18,0.95)", backdropFilter:"blur(16px)",
        borderBottom:`1px solid ${C.border}`,
        padding:"10px 14px", display:"flex", justifyContent:"space-between", alignItems:"center",
        minHeight:52 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <div style={{ width:34, height:34, borderRadius:9, flexShrink:0,
            background:"linear-gradient(135deg,rgba(185,28,60,0.9),rgba(120,0,32,0.9))",
            display:"flex", alignItems:"center", justifyContent:"center", fontSize:18 }}>🏆</div>
          <div>
            <div style={{ fontSize:14, fontWeight:900, color:C.text, lineHeight:1.1 }}>WC2026</div>
            <div style={{ fontSize:9, color:C.textSoft, letterSpacing:"0.05em" }}>PREDICTION LEAGUE</div>
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          {loading && (
            <div style={{width:14,height:14,border:`2px solid ${C.border}`,borderTopColor:C.gold,
              borderRadius:"50%",animation:"spin 0.7s linear infinite",flexShrink:0}} />
          )}
          {missingCount>0 && (
            <div style={{ background:C.red, borderRadius:20, padding:"2px 8px",
              fontSize:10, fontWeight:800, color:"white",
              boxShadow:"0 2px 8px rgba(255,61,87,0.4)", flexShrink:0 }}>{missingCount}</div>
          )}
          {/* Avatar + name — truncate on narrow screens */}
          <div style={{ display:"flex", alignItems:"center", gap:6, minWidth:0 }}>
            <div style={{ width:28, height:28, borderRadius:8, flexShrink:0,
              background:`linear-gradient(135deg,${C.greenDark},rgba(0,200,83,0.2))`,
              border:"1px solid rgba(0,200,83,0.25)",
              display:"flex", alignItems:"center", justifyContent:"center",
              fontSize:11, fontWeight:800, color:C.green }}>
              {userName?.charAt(0).toUpperCase()}
            </div>
            <span style={{ fontSize:12, color:C.textSoft, fontWeight:600,
              overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", maxWidth:80 }}>
              {userName}
            </span>
          </div>
          <button onClick={()=>supabase.auth.signOut().then(()=>{setUser(null);setName(null);})}
            style={{ background:"rgba(255,255,255,0.04)", border:`1px solid ${C.border}`,
              borderRadius:8, padding:"6px 10px", color:C.textSoft, fontSize:11, cursor:"pointer",
              flexShrink:0, minHeight:30 }}>
            Out
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{ padding:"16px 14px calc(80px + env(safe-area-inset-bottom))", maxWidth:600, margin:"0 auto" }}>
        {tab==="dashboard"   && <DashboardPage fixtures={fixtures} predMap={predMap} leaderboard={leaderboard} userId={user.id} userName={userName} onNav={setTab} missingCount={missingCount} />}
        {tab==="fixtures"    && <FixturesPage  fixtures={fixtures} predMap={predMap} onSave={savePred} chipMatchId={chipMatchId} chipAvailable={!chipMatchId} onChipToggle={toggleChip} leagueId={LEAGUE_ID} />}
        {tab==="missing"     && <MissingPage   fixtures={fixtures} predMap={predMap} onSave={savePred} />}
        {tab==="leaderboard" && <LeaderboardPage leaderboard={leaderboard} userId={user.id} />}
        {tab==="stats"       && <StatsPage fixtures={fixtures} predMap={predMap} leaderboard={leaderboard} userId={user.id} />}
        {tab==="rules"       && <RulesPage />}
      </div>

      {/* Bottom nav */}
      <div style={{ position:"fixed", bottom:0, left:0, right:0, zIndex:100,
        background:"rgba(6,9,18,0.97)", backdropFilter:"blur(16px)",
        borderTop:`1px solid ${C.border}`, display:"flex",
        padding:"4px 0 max(6px, env(safe-area-inset-bottom))" }}>
        {tabs.map(t => {
          const active = tab===t.id;
          return (
            <button key={t.id} onClick={()=>setTab(t.id)}
              style={{ flex:1, background:"none", border:"none", cursor:"pointer",
                display:"flex", flexDirection:"column", alignItems:"center", gap:2,
                padding:"6px 0", position:"relative" }}>
              {t.id==="missing" && missingCount>0 && (
                <div style={{ position:"absolute", top:2, right:"14%", minWidth:16, height:16,
                  borderRadius:8, background:C.red, color:"white",
                  fontSize:9, fontWeight:800, display:"flex", alignItems:"center", justifyContent:"center",
                  padding:"0 4px", boxShadow:"0 0 6px rgba(255,61,87,0.6)" }}>
                  {missingCount}
                </div>
              )}
              <span style={{ fontSize:20, transition:"transform 0.15s",
                transform:active?"scale(1.2)":"scale(1)",
                filter:active?"drop-shadow(0 0 6px rgba(240,192,64,0.5))":"none" }}>
                {t.icon}
              </span>
              <span style={{ fontSize:9, fontWeight:active?800:500,
                color:active?C.gold:C.textFaint, letterSpacing:"0.06em" }}>
                {t.label.toUpperCase()}
              </span>
              {active && (
                <div style={{ position:"absolute", bottom:0, left:"50%", transform:"translateX(-50%)",
                  width:24, height:2, background:C.gold, borderRadius:"2px 2px 0 0",
                  boxShadow:"0 0 8px rgba(240,192,64,0.6)" }} />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
