// Race for Dottie live data: pulls the league from Sleeper's public API into one small JSON file
// (scores, lineups, standings, recent moves) that the Master Dashboard reads. Prints the JSON to stdout.
// Runs in GitHub Actions on a schedule; no dependencies (Node 20+ has fetch built in).

const API = 'https://api.sleeper.app/v1';
// League-mates' Sleeper usernames, used to find the league. Set LEAGUE_ID to skip the search.
const KNOWN = ['jdclemens19', 'jvelots', 'nneroni', 'gpdigs', 'tburke1110', 'FaucetNoLeaks', 'dmurphy1999', 'vkassleeper', 'JoeRo3', 'BigBake6'];
const MY_TEAM = /brooklyn cowboys/i;
const MY_PLAYERS = ['Drake Maye', 'Bijan Robinson', 'Kenneth Walker'];
const SLOT = { QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE', K: 'K', DEF: 'DEF', FLEX: 'W/R/T', SUPER_FLEX: 'Q/W/R/T', REC_FLEX: 'W/T', WRRB_FLEX: 'W/R' };
const BENCH = new Set(['BN', 'IR', 'TAXI']);
const INJ = { Questionable: 'Q', Doubtful: 'D', Out: 'O', IR: 'IR', PUP: 'PUP', Sus: 'SUS', NA: 'NA' };

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(path, { optional = false } = {}) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(API + path, { headers: { 'User-Agent': 'race-for-dottie-sync' } });
      if (r.status === 404 && optional) return null;
      if (!r.ok) throw new Error(`${path} -> HTTP ${r.status}`);
      const t = await r.text();
      return t && t !== 'null' ? JSON.parse(t) : null;
    } catch (e) {
      if (i >= 2) throw e;
      await sleep(1500 * (i + 1));
    }
  }
}
const pts = (whole, dec) => Math.round(((whole || 0) + (dec || 0) / 100) * 100) / 100;
const r2 = v => Math.round((Number(v) || 0) * 100) / 100;

async function findLeague(season) {
  if (process.env.LEAGUE_ID) return process.env.LEAGUE_ID;
  const ids = new Set(), seeds = [];
  for (const name of KNOWN) {
    const u = await get(`/user/${encodeURIComponent(name)}`, { optional: true });
    if (u && u.user_id) { ids.add(u.user_id); if (seeds.length < 2) seeds.push(u.user_id); }
  }
  if (!seeds.length) throw new Error('None of the known league-mates were found on Sleeper');
  let best = null;
  const seen = new Set();
  for (const uid of seeds) {
    const leagues = (await get(`/user/${uid}/leagues/nfl/${season}`, { optional: true })) || [];
    for (const lg of leagues) {
      if (seen.has(lg.league_id)) continue;
      seen.add(lg.league_id);
      const users = (await get(`/league/${lg.league_id}/users`, { optional: true })) || [];
      const n = users.filter(u => ids.has(u.user_id)).length;
      const mine = users.some(u => MY_TEAM.test((u.metadata && u.metadata.team_name) || ''));
      const score = n + (mine ? 5 : 0);
      if (!best || score > best.score) best = { id: lg.league_id, score, n };
    }
  }
  if (!best || best.n < 4) throw new Error('No league has at least 4 of the known league-mates');
  return best.id;
}

async function main() {
  const state = await get('/state/nfl');
  const season = String(state.league_season || state.season);
  const week = Math.min(18, Math.max(1, Number(state.display_week || state.week || 1)));
  const lid = await findLeague(season);
  const [league, users, rosters, matchups, players] = await Promise.all([
    get(`/league/${lid}`), get(`/league/${lid}/users`), get(`/league/${lid}/rosters`),
    get(`/league/${lid}/matchups/${week}`, { optional: true }), get('/players/nfl'),
  ]);
  const txNow = (await get(`/league/${lid}/transactions/${week}`, { optional: true })) || [];
  const txPrev = week > 1 ? ((await get(`/league/${lid}/transactions/${week - 1}`, { optional: true })) || []) : [];

  const P = players || {};
  const nm = id => {
    const p = P[id];
    if (!p) return String(id);
    if (p.position === 'DEF') return `${p.last_name || id} D`;
    return p.full_name || [p.first_name, p.last_name].filter(Boolean).join(' ') || String(id);
  };
  const pos = id => (P[id] && P[id].position) || '';
  const nfl = id => (P[id] && P[id].team) || (P[id] && P[id].position === 'DEF' ? id : '');
  const inj = id => INJ[(P[id] && P[id].injury_status) || ''] || '';

  const byOwner = Object.fromEntries((users || []).map(u => [u.user_id, u]));
  const teams = (rosters || []).map(r => {
    const u = byOwner[r.owner_id] || {}, s = r.settings || {};
    return {
      rid: r.roster_id,
      name: (u.metadata && u.metadata.team_name) || u.display_name || `Team ${r.roster_id}`,
      owner: u.display_name || '',
      w: s.wins || 0, l: s.losses || 0, t: s.ties || 0,
      pf: pts(s.fpts, s.fpts_decimal), pa: pts(s.fpts_against, s.fpts_against_decimal),
    };
  });
  if (teams.length < 2) throw new Error('League has fewer than 2 rosters');
  let me = (teams.find(t => MY_TEAM.test(t.name)) || {}).rid;
  if (me == null) {
    const r = (rosters || []).find(x => MY_PLAYERS.every(n => (x.players || []).some(id => nm(id) === n)));
    me = r ? r.roster_id : null;
  }

  const slots = (league.roster_positions || []).filter(s => !BENCH.has(s));
  const games = {}, lineups = {};
  let bench = [];
  for (const m of matchups || []) {
    const st = m.starters || [];
    lineups[m.roster_id] = st.map((id, i) => [
      SLOT[slots[i]] || slots[i] || '', id === '0' ? '' : nm(id), id === '0' ? '' : pos(id), id === '0' ? '' : nfl(id),
      r2(m.starters_points && m.starters_points[i] != null ? m.starters_points[i] : (m.players_points || {})[id]), id === '0' ? '' : inj(id),
    ]);
    if (m.roster_id === me) {
      bench = (m.players || []).filter(id => !st.includes(id)).map(id => [nm(id), pos(id), nfl(id), r2((m.players_points || {})[id]), inj(id)]);
    }
    if (m.matchup_id == null) continue;
    (games[m.matchup_id] = games[m.matchup_id] || []).push({ rid: m.roster_id, pts: r2(m.custom_points != null ? m.custom_points : m.points) });
  }
  const pairs = Object.keys(games).sort((a, b) => a - b).map(k => games[k].sort((a, b) => a.rid - b.rid));

  const moves = [...txNow, ...txPrev]
    .filter(t => t && t.status === 'complete')
    .sort((a, b) => (b.status_updated || b.created || 0) - (a.status_updated || a.created || 0))
    .slice(0, 15)
    .map(t => ({
      at: t.status_updated || t.created || 0, type: t.type, rids: t.roster_ids || [],
      adds: Object.entries(t.adds || {}).map(([id, rid]) => [nm(id), pos(id), rid]),
      drops: Object.entries(t.drops || {}).map(([id, rid]) => [nm(id), pos(id), rid]),
      bid: t.settings && t.settings.waiver_bid != null ? t.settings.waiver_bid : null,
    }));

  const out = {
    v: 1, at: new Date().toISOString(), season, week, seasonType: state.season_type || '',
    league: { id: lid, name: league.name || '', size: teams.length },
    me, teams, games: pairs, lineups, bench, moves,
  };
  process.stdout.write(JSON.stringify(out));
}

main().catch(e => { console.error(String(e && e.stack || e)); process.exit(1); });
