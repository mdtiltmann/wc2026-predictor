import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL             = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const ESPN_URL = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?limit=200&dates=20260611-20261231";

function mapStatus(s: string): string {
  switch (s) {
    case "STATUS_IN_PROGRESS":
    case "STATUS_HALFTIME":
    case "STATUS_EXTRA_TIME":
    case "STATUS_PENALTIES":     return "live";
    case "STATUS_FULL_TIME":
    case "STATUS_FINAL":
    case "STATUS_FINAL_PEN":     return "finished";
    case "STATUS_POSTPONED":
    case "STATUS_CANCELED":
    case "STATUS_SUSPENDED":     return "postponed";
    default:                     return "upcoming";
  }
}

function calcPoints(ph: number, pa: number, ah: number, aa: number): number {
  const exact         = ph === ah && pa === aa;
  const correctResult = Math.sign(ph - pa) === Math.sign(ah - aa);
  return (exact ? 3 : 0) + (correctResult ? 1 : 0);
}

async function recalcScores(matchId: string, hs: number, as_: number) {
  const { data: preds } = await supabase
    .from("predictions").select("id,predicted_home,predicted_away").eq("match_id", matchId);
  if (!preds?.length) return;
  await supabase.from("scores").upsert(
    preds.map(p => ({
      prediction_id: p.id,
      points_awarded: calcPoints(p.predicted_home, p.predicted_away, hs, as_),
      score_breakdown: { predicted: `${p.predicted_home}-${p.predicted_away}`, actual: `${hs}-${as_}` },
      computed_at: new Date().toISOString(),
    })),
    { onConflict: "prediction_id" }
  );
}

Deno.serve(async (req) => {
  if (req.method !== "GET" && req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  try {
    // Fetch all WC matches from ESPN (free, no API key needed)
    const espnRes = await fetch(ESPN_URL);
    if (!espnRes.ok) return new Response(JSON.stringify({ error: `ESPN API error: ${espnRes.status}` }), { status: 502 });

    const espnData = await espnRes.json();
    const events: any[] = espnData.events || [];

    // Load our teams table to map abbreviation → team id
    const { data: teams } = await supabase.from("teams").select("id,code");
    const teamByCode = new Map(teams?.map((t: any) => [t.code.toUpperCase(), t.id]));

    let synced = 0, scored = 0;
    const errors: string[] = [];

    for (const event of events) {
      const comp        = event.competitions?.[0];
      if (!comp) continue;

      const competitors = comp.competitors || [];
      const homeComp    = competitors.find((c: any) => c.homeAway === "home");
      const awayComp    = competitors.find((c: any) => c.homeAway === "away");
      if (!homeComp || !awayComp) continue;

      const homeTla  = homeComp.team?.abbreviation?.toUpperCase();
      const awayTla  = awayComp.team?.abbreviation?.toUpperCase();
      const homeId   = teamByCode.get(homeTla);
      const awayId   = teamByCode.get(awayTla);

      if (!homeId || !awayId) {
        errors.push(`Unknown teams: ${homeTla} / ${awayTla}`);
        continue;
      }

      const status    = mapStatus(comp.status?.type?.name || "");
      const homeScore = status === "upcoming" ? null : parseInt(homeComp.score ?? "") ?? null;
      const awayScore = status === "upcoming" ? null : parseInt(awayComp.score ?? "") ?? null;
      const validScores = homeScore !== null && !isNaN(homeScore) && awayScore !== null && !isNaN(awayScore);

      // Find our match by home+away team ids and kickoff date
      const kickoff = event.date;
      const { data: match, error: matchErr } = await supabase
        .from("matches")
        .select("id,status,home_score,away_score")
        .eq("home_team_id", homeId)
        .eq("away_team_id", awayId)
        .gte("kickoff", kickoff.substring(0, 10) + "T00:00:00Z")
        .lte("kickoff", kickoff.substring(0, 10) + "T23:59:59Z")
        .single();

      if (matchErr || !match) {
        errors.push(`Match not found: ${homeTla} vs ${awayTla} on ${kickoff.substring(0, 10)}`);
        continue;
      }

      // Only update if something changed
      const scoreChanged = validScores && (match.home_score !== homeScore || match.away_score !== awayScore);
      const statusChanged = match.status !== status;

      if (statusChanged || scoreChanged) {
        const update: any = { status };
        if (validScores) { update.home_score = homeScore; update.away_score = awayScore; }
        await supabase.from("matches").update(update).eq("id", match.id);
      }
      synced++;

      // Award points once match is finished and we have valid scores
      if (status === "finished" && validScores) {
        await recalcScores(match.id, homeScore!, awayScore!);
        scored++;
      }
    }

    // Update team form from finished matches
    const { data: recentMatches } = await supabase
      .from("matches")
      .select("home_score,away_score,home_team_id,away_team_id")
      .eq("status", "finished")
      .order("kickoff", { ascending: false })
      .limit(200);

    if (recentMatches) {
      const teamResults: Map<string, string[]> = new Map();
      for (const m of recentMatches) {
        const addResult = (teamId: string, result: string) => {
          const arr = teamResults.get(teamId) || [];
          if (arr.length < 5) arr.push(result);
          teamResults.set(teamId, arr);
        };
        const hw = m.home_score > m.away_score, aw = m.away_score > m.home_score;
        addResult(m.home_team_id, hw ? "W" : aw ? "L" : "D");
        addResult(m.away_team_id, aw ? "W" : hw ? "L" : "D");
      }
      for (const [teamId, form] of teamResults.entries()) {
        await supabase.from("teams").update({ form }).eq("id", teamId);
      }
    }

    return new Response(JSON.stringify({ ok: true, synced, scored, errors: errors.slice(0, 10) }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
