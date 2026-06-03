// ================================
// CONFIGURATION
// Sign up for a free API key at:
// https://collegefootballdata.com
// ================================

const API_KEY = "yZG44X3xOS8pzlXjCvSNroLvpyEVCAFPj1ujNaGkbyPjQSxZAz7cgPKFR9zOPC8S";
const CFBD_BASE = "https://api.collegefootballdata.com";
const SEASON = 2026;

// Holds all fetched games so filters can run without re-fetching
let allGames = [];

// Holds team metadata (colors, logos, mascots) keyed by team name
let teamMap = {};

// Players who left each team for 2026: { "LSU": Set("garrett nussmeier", ...) }
let draftExits    = {};  // keyed by college team name
let portalExits   = {};  // keyed by origin school name
let portalIncoming  = {}; // players arriving: { "LSU": [ portal entry, ... ] }
let recruitsByTeam   = {}; // 2026 HS signing class: { "Vanderbilt": [ recruit, ... ] }
let recruitingLoaded = false;

// Manual roster corrections for players whose 2026 status isn't yet in the API.
// MANUAL_EXITS:    forces a player off a team's displayed roster (exhausted eligibility,
//                 UDFA sign, or transfer safety-net for cases the portal API may miss).
// MANUAL_INCOMING: adds a player only if not already present — safe to leave here even
//                 if the CFBD portal API eventually includes them (deduplication runs first).
const MANUAL_EXITS = {
  // ---- Exhausted eligibility / UDFA — not in NFL Draft OR portal data ----
  "Vanderbilt":     ["Diego Pavia"],        // signed w/ Packers as UDFA
  "LSU":            ["Garrett Nussmeier"],  // signed w/ Chiefs as UDFA
  "Tennessee":      ["Joey Aguilar"],       // eligibility extension denied; signed w/ Jaguars
  "Ohio State":     ["Will Howard"],        // signed w/ Steelers as UDFA
  "Illinois":       ["Luke Altmyer"],       // exhausted eligibility

  // ---- Transfer safety-nets (also captured by portal API, but belt-and-suspenders) ----
  "Nebraska":       ["Dylan Raiola"],       // transferred to Oregon
  "Michigan State": ["Aidan Chiles"],       // transferred to Northwestern
  "Iowa State":     ["Rocco Becht"],        // transferred to Penn State (followed Matt Campbell)
  "Florida":        ["DJ Lagway"],          // transferred to Baylor
};

const MANUAL_INCOMING = {
  // ---- True freshman (not in portal OR 2025 roster — must be added manually) ----
  "Vanderbilt":     [{ firstName: "Jared",   lastName: "Curtis",     position: "QB", stars: 5, isRecruit: true }],
  "Colorado":       [{ firstName: "Julian",  lastName: "Lewis",      position: "QB", stars: 5, isRecruit: true }],

  // ---- Transfer QB additions (deduplication prevents doubles if API already has them) ----
  "LSU":            [{ firstName: "Sam",     lastName: "Leavitt",    position: "QB", stars: 0, origin: "Arizona State"  }],
  "Tennessee":      [{ firstName: "Ryan",    lastName: "Staub",      position: "QB", stars: 0, origin: "Colorado"       }],
  "Auburn":         [{ firstName: "Byrum",   lastName: "Brown",      position: "QB", stars: 0, origin: "South Florida"  }],
  "Florida":        [{ firstName: "Aaron",   lastName: "Philo",      position: "QB", stars: 0, origin: "Georgia Tech"   }],
  "Baylor":         [{ firstName: "DJ",      lastName: "Lagway",     position: "QB", stars: 0, origin: "Florida"        }],
  "Nebraska":       [{ firstName: "Anthony", lastName: "Colandrea",  position: "QB", stars: 0, origin: "UNLV"           }],
  "Oregon":         [{ firstName: "Dylan",   lastName: "Raiola",     position: "QB", stars: 5, origin: "Nebraska"       }],
  "Northwestern":   [{ firstName: "Aidan",   lastName: "Chiles",     position: "QB", stars: 0, origin: "Michigan State" }],
  "Penn State":     [{ firstName: "Rocco",   lastName: "Becht",      position: "QB", stars: 0, origin: "Iowa State"     }],
  "Iowa State":     [{ firstName: "Jaylen",  lastName: "Raynor",     position: "QB", stars: 0, origin: "Arkansas State" }],
  "Illinois":       [{ firstName: "Katin",   lastName: "Houser",     position: "QB", stars: 0, origin: "East Carolina"  }],
  "Indiana":        [{ firstName: "Josh",    lastName: "Hoover",     position: "QB", stars: 0, origin: "TCU"            }],
  "Rutgers":        [{ firstName: "Dylan",   lastName: "Lonergan",   position: "QB", stars: 0, origin: "Boston College" }],
  "Wisconsin":      [{ firstName: "Colton",  lastName: "Joseph",     position: "QB", stars: 0, origin: "Old Dominion"   }],
  "Florida State":  [{ firstName: "Ashton",  lastName: "Daniels",    position: "QB", stars: 0, origin: "Auburn"         }],
  "Miami":          [{ firstName: "Darian",  lastName: "Mensah",     position: "QB", stars: 0, origin: "Duke"           }],
  "Oklahoma State": [{ firstName: "Drew",    lastName: "Mestemaker", position: "QB", stars: 0, origin: "North Texas"    }],
  "Virginia":       [{ firstName: "Beau",    lastName: "Pribula",    position: "QB", stars: 0, origin: "Missouri"       }],
};


// ================================
// LOAD GAMES FROM API
// Fetches the real schedule and
// pregame win probabilities, then
// joins them by game ID.
// ================================

// Conference badge colors — background and text per conference
const CONF_COLORS = {
  "SEC":              { bg: "#003087", text: "#ffffff" },
  "Big Ten":          { bg: "#002868", text: "#ffffff" },
  "Big 12":           { bg: "#002366", text: "#ffffff" },
  "ACC":              { bg: "#013ca6", text: "#ffffff" },
  "Mountain West":    { bg: "#005b99", text: "#ffffff" },
  "American Athletic":{ bg: "#004990", text: "#ffffff" },
  "Sun Belt":         { bg: "#e8374d", text: "#ffffff" },
  "MAC":              { bg: "#1a3a5c", text: "#ffffff" },
  "Conference USA":   { bg: "#2a2a5a", text: "#ffffff" },
  "FBS Independents": { bg: "#444455", text: "#ffffff" },
};

// Major rivalry games — key is both team names sorted and joined with |
const RIVALRIES = {
  "Alabama|Auburn":               { name: "The Iron Bowl",                    flag: "🪓" },
  "Michigan|Ohio State":          { name: "The Game",                          flag: "⚔️" },
  "Oklahoma|Texas":               { name: "Red River Rivalry",                 flag: "🌊" },
  "Mississippi State|Ole Miss":   { name: "The Egg Bowl",                      flag: "🥚" },
  "Florida|Georgia":              { name: "The World's Largest Cocktail Party",flag: "🍹" },
  "Alabama|LSU":                  { name: "Battle for the Boot",               flag: "🥾" },
  "Alabama|Tennessee":            { name: "Third Saturday in October",         flag: "🍂" },
  "Arkansas|LSU":                 { name: "Battle for the Golden Boot",        flag: "🏆" },
  "Texas|Texas A&M":              { name: "Lone Star Showdown",                flag: "⭐" },
  "Clemson|South Carolina":       { name: "Palmetto Bowl",                     flag: "🌴" },
  "Florida|Florida State":        { name: "Sunshine Showdown",                 flag: "☀️" },
  "Michigan|Michigan State":      { name: "Paul Bunyan Trophy",                flag: "🪓" },
  "Notre Dame|USC":               { name: "Jeweled Shillelagh",                flag: "☘️" },
  "Georgia|Georgia Tech":         { name: "Clean Old-Fashioned Hate",          flag: "🐾" },
  "Oklahoma|Oklahoma State":      { name: "Bedlam",                            flag: "💥" },
  "Oregon|Oregon State":          { name: "Civil War",                         flag: "🌲" },
  "Washington|Washington State":  { name: "Apple Cup",                         flag: "🍎" },
  "Kansas|Kansas State":          { name: "Sunflower Showdown",                flag: "🌻" },
  "Auburn|Georgia":               { name: "Deep South's Oldest Rivalry",       flag: "🏈" },
  "Penn State|Pittsburgh":        { name: "Keystone State Classic",            flag: "🔑" },
};

function getRivalry(home, away) {
  const key = [home, away].sort().join("|");
  return RIVALRIES[key] || null;
}

// ================================
// LOCAL CACHE
// Stores API responses in localStorage
// so repeat visits are instant and
// rate limits are never hit.
// ================================

const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours in ms

function getCached(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { data, expiry } = JSON.parse(raw);
    if (Date.now() > expiry) { localStorage.removeItem(key); return null; }
    return data;
  } catch { return null; }
}

function setCached(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ data, expiry: Date.now() + CACHE_TTL }));
  } catch {
    Object.keys(localStorage).filter(k => k.startsWith("cfbd_")).forEach(k => localStorage.removeItem(k));
    try { localStorage.setItem(key, JSON.stringify({ data, expiry: Date.now() + CACHE_TTL })); } catch {}
  }
}

// Serialises uncached API calls one-at-a-time to avoid burst rate limits.
// Cached responses bypass the queue and return instantly.
// Each item resolves/rejects independently — a failure never breaks later items.
let apiQueue = Promise.resolve();

async function fetchCached(url, headers, cacheKey) {
  const cached = getCached(cacheKey);
  if (cached) return cached;

  return new Promise((resolve, reject) => {
    apiQueue = apiQueue
      .catch(() => {})          // insulate chain from any previous failure
      .then(async () => {
        for (let attempt = 0; attempt < 5; attempt++) {
          if (attempt > 0) await new Promise(r => setTimeout(r, attempt * 800));
          try {
            const res = await fetch(url, { headers });
            if (res.status === 429) continue;   // rate limited — retry
            if (!res.ok) { reject(new Error(`${res.status}`)); return; }
            const data = await res.json();
            setCached(cacheKey, data);
            resolve(data);
            await new Promise(r => setTimeout(r, 100)); // polite gap between requests
            return;
          } catch (e) {
            if (attempt === 4) { reject(e); return; }
          }
        }
        reject(new Error("429")); // all retries exhausted
        // note: no throw here — keeps the queue alive for subsequent calls
      });
  });
}

// Converts a Vegas point spread to a win probability.
// Uses a logistic curve fitted to college football score distributions.
// Negative spread = home team is favored (e.g. -7 means home favored by 7).
function spreadToWinProb(spread) {
  return 1 / (1 + Math.exp(spread / 10.5));
}

async function loadGames() {
  const container = document.getElementById("gamesContainer");
  container.innerHTML = `
    <div style="text-align:center;grid-column:1/-1;padding:48px 20px">
      <p style="color:#a8a8b3;font-family:'Oswald',sans-serif;font-size:18px;letter-spacing:2px;text-transform:uppercase">
        Loading schedule…
      </p>
    </div>
  `;

  const headers = { "Authorization": `Bearer ${API_KEY}` };

  try {
    // Games is the only strictly required request — the page can't show anything without it.
    // All other requests fall back to empty arrays on failure so the schedule still loads.
    const gamesData = await fetchCached(
      `${CFBD_BASE}/games?year=${SEASON}&seasonType=regular&classification=fbs`,
      headers, `cfbd_games_${SEASON}`
    );

    const safe = (key, url) => fetchCached(url, headers, key).catch(() => []);

    const [teamsData, wpData, linesData, spData, draftData, draft25Data, portalData] = await Promise.all([
      safe(`cfbd_teams_${SEASON}`,       `${CFBD_BASE}/teams/fbs?year=${SEASON}`),
      safe(`cfbd_wp_${SEASON}`,          `${CFBD_BASE}/metrics/wp/pregame?year=${SEASON}&seasonType=regular`),
      safe(`cfbd_lines_${SEASON}`,       `${CFBD_BASE}/lines?year=${SEASON}&seasonType=regular`),
      safe(`cfbd_sp_${SEASON - 1}`,      `${CFBD_BASE}/ratings/sp?year=${SEASON - 1}`),
      safe(`cfbd_draft_${SEASON}`,       `${CFBD_BASE}/draft/picks?year=${SEASON}`),
      safe(`cfbd_draft_${SEASON - 1}`,   `${CFBD_BASE}/draft/picks?year=${SEASON - 1}`),
      safe(`cfbd_portal_${SEASON}`,      `${CFBD_BASE}/player/portal?year=${SEASON}`)
    ]);

    // Build lookup maps
    const wpMap = {};
    wpData.forEach(wp => { wpMap[wp.gameId] = wp; });

    const linesMap = {};
    linesData.forEach(l => { linesMap[l.id] = l; });

    const spMap = {};
    spData.forEach(t => { spMap[t.team] = t.rating; });

    // Team metadata: colors, logos, mascot
    teamsData.forEach(t => {
      teamMap[t.school] = {
        color:      t.color          || "#2a2a4a",
        altColor:   t.alternateColor || "#2a2a4a",
        logo:       t.logos?.[0]     || null,
        darkLogo:   t.logos?.[1]     || null,
        mascot:     t.mascot         || null,
        conference: t.conference     || null
      };
    });

    // Draft exits: players who left for the NFL (both 2025 and 2026 drafts)
    [...draftData, ...draft25Data].forEach(pick => {
      if (!pick.collegeTeam) return;
      if (!draftExits[pick.collegeTeam]) draftExits[pick.collegeTeam] = new Set();
      draftExits[pick.collegeTeam].add(pick.name.toLowerCase().trim());
    });

    // Portal exits: players who transferred out — keyed by their origin school
    // Portal incoming: players arriving at a new school — keyed by destination
    portalData.forEach(entry => {
      const name = `${entry.firstName} ${entry.lastName}`.toLowerCase().trim();
      if (entry.origin) {
        if (!portalExits[entry.origin]) portalExits[entry.origin] = new Set();
        portalExits[entry.origin].add(name);
      }
      if (entry.destination) {
        if (!portalIncoming[entry.destination]) portalIncoming[entry.destination] = [];
        portalIncoming[entry.destination].push(entry);
      }
    });

    // Transform the API data into the shape our display function expects
    allGames = gamesData.map(game => {
      let homeWinProb;

      // Priority 1: SP+ pregame win probability (most accurate)
      const wp = wpMap[game.id];
      if (wp) {
        homeWinProb = Math.round(wp.homeWinProbability * 100);
      } else {
        // Priority 2: derive from the consensus Vegas spread
        const lineData = linesMap[game.id];
        if (lineData && lineData.lines && lineData.lines.length > 0) {
          const spreads = lineData.lines.map(l => l.spread).filter(s => s !== null);
          if (spreads.length > 0) {
            const avgSpread = spreads.reduce((a, b) => a + b, 0) / spreads.length;
            homeWinProb = Math.round(spreadToWinProb(avgSpread) * 100);
          }
        }

        // Priority 3: estimate from SP+ rating differential (prior season ratings).
        // FCS teams not in the SP+ database get a fixed baseline of -15, which sits
        // below the weakest FBS programs and produces realistic win probabilities
        // (e.g. LSU ~17 vs FCS baseline -15 → ~96% for LSU).
        if (homeWinProb === undefined) {
          const FCS_BASELINE    = -15;
          const homeRating      = spMap[game.homeTeam] !== undefined ? spMap[game.homeTeam] : FCS_BASELINE;
          const awayRating      = spMap[game.awayTeam] !== undefined ? spMap[game.awayTeam] : FCS_BASELINE;
          const homeFieldAdv    = game.neutralSite ? 0 : 2.5;
          const predictedSpread = -(homeRating - awayRating + homeFieldAdv);
          homeWinProb = Math.round(spreadToWinProb(predictedSpread) * 100);
        }
      }

      const location = game.venue
        ? (game.neutralSite ? `${game.venue} (Neutral)` : game.venue)
        : "TBD";

      return {
        gameId:      game.id,
        week:        String(game.week),
        home:        game.homeTeam,
        away:        game.awayTeam,
        date:        formatDate(game.startDate),
        location,
        homeWinProb,
        homePoints:  game.homePoints,
        awayPoints:  game.awayPoints,
        isCompleted: game.completed
      };
    });

    populateTeamFilter(allGames);
    populateConfBrowser();
    applyFilters(); // respects the default week selection in the dropdown

    fetchLiveScores();
    startLivePolling();

  } catch (err) {
    const msg = err.message === "429"
      ? "API rate limit reached. Get a fresh free key at collegefootballdata.com, paste it into script.js line 7, and refresh."
      : `Could not load games (${err.message}). Check your API key at collegefootballdata.com.`;
    container.innerHTML = `
      <p style="color: #e94560; text-align: center; grid-column: 1/-1; padding: 40px;">
        ${msg}
      </p>
    `;
    console.error(err);
  }
}

// ================================
// LIVE SCORES
// Polls the CFBD scoreboard endpoint
// for in-progress games and updates
// win probabilities in real time.
// Runs every 30 s during a live game,
// every 90 s otherwise.
// ================================

let liveInterval  = null;
let liveIntervalMs = 90_000;

// Parses /games/players response into { home: { passing, rushing, receiving }, away: {...} }
// Each category entry: { name, stats: { YDS, TD, ... } }
function parseLivePlayerStats(data, homeTeam, awayTeam) {
  if (!Array.isArray(data) || !data[0]?.teams) return null;
  const result = {};

  data[0].teams.forEach(team => {
    const key = team.school === homeTeam ? "home" : team.school === awayTeam ? "away" : null;
    if (!key) return;
    result[key] = {};

    (team.categories || []).forEach(cat => {
      const catName = (cat.name || "").toLowerCase();
      if (!["passing", "rushing", "receiving"].includes(catName)) return;

      // Build athlete → stat map
      const players = {};
      (cat.types || []).forEach(type => {
        (type.athletes || []).forEach(a => {
          if (!players[a.name]) players[a.name] = {};
          players[a.name][type.name] = a.stat;
        });
      });

      // Pick the leader by yards
      let leader = null, topYds = -1;
      Object.entries(players).forEach(([name, stats]) => {
        const yds = parseInt(stats["YDS"] || "0", 10);
        if (yds > topYds) { topYds = yds; leader = { name, stats }; }
      });
      if (leader) result[key][catName] = leader;
    });
  });

  return Object.keys(result).length ? result : null;
}


async function fetchLiveScores() {
  if (allGames.length === 0) return false;
  const headers = { "Authorization": `Bearer ${API_KEY}` };
  try {
    const res = await fetch(`${CFBD_BASE}/scoreboard?classification=fbs`, { headers });
    if (!res.ok) return false;
    const data = await res.json();

    // Snapshot previous live state so we only re-render when something changed
    const prevState = allGames.map(g => `${g.isLive}|${g.liveHomePoints}|${g.liveAwayPoints}|${g.liveHomeWinProb}|${g.isCompleted}`).join(",");

    // Clear all live flags so games that ended drop back to normal display
    allGames.forEach(g => { g.isLive = false; });

    let anyLive = false;
    if (Array.isArray(data)) {
      data.forEach(sg => {
        const hn = sg.homeTeam?.name;
        const an = sg.awayTeam?.name;
        if (!hn || !an) return;
        const match = allGames.find(g => g.home === hn && g.away === an);
        if (!match) return;

        if (sg.status === "in_progress") {
          match.isLive          = true;
          match.gameId          = sg.id ?? match.gameId;
          anyLive               = true;
          match.liveHomePoints  = sg.homeTeam?.points ?? 0;
          match.liveAwayPoints  = sg.awayTeam?.points ?? 0;
          match.liveHomeWinProb = sg.homeTeam?.winProbability != null
            ? Math.round(sg.homeTeam.winProbability * 100)
            : null;
          match.livePeriod      = sg.period    || null;
          match.liveClock       = sg.clock     || null;
          match.liveSituation   = sg.situation || null;
        } else if (sg.status === "final") {
          match.isCompleted  = true;
          match.isLive       = false;
          match.homePoints   = sg.homeTeam?.points;
          match.awayPoints   = sg.awayTeam?.points;
        }
      });
    }

    // Fetch live player stats for every in-progress game (parallel, not queued)
    const liveGames = allGames.filter(g => g.isLive && g.gameId);
    if (liveGames.length > 0) {
      const hdrs = { "Authorization": `Bearer ${API_KEY}` };
      await Promise.all(liveGames.map(async g => {
        try {
          const r = await fetch(`${CFBD_BASE}/games/players?year=${SEASON}&gameId=${g.gameId}`, { headers: hdrs });
          if (r.ok) g.liveStats = parseLivePlayerStats(await r.json(), g.home, g.away);
        } catch { /* non-fatal */ }
      }));
    }

    const newState = allGames.map(g => `${g.isLive}|${g.liveHomePoints}|${g.liveAwayPoints}|${g.liveHomeWinProb}|${g.isCompleted}`).join(",");
    if (newState !== prevState) applyFilters();

    // Speed up polling while games are live, slow down otherwise
    const targetMs = anyLive ? 30_000 : 90_000;
    if (targetMs !== liveIntervalMs) {
      liveIntervalMs = targetMs;
      restartLivePolling();
    }

    return anyLive;
  } catch (e) {
    console.warn("Live score fetch failed:", e);
    return false;
  }
}

function startLivePolling() {
  if (liveInterval) return;
  liveInterval = setInterval(fetchLiveScores, liveIntervalMs);
}

function restartLivePolling() {
  clearInterval(liveInterval);
  liveInterval = null;
  startLivePolling();
}

// Pause polling while the tab is hidden to avoid unnecessary requests
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    clearInterval(liveInterval);
    liveInterval = null;
  } else {
    fetchLiveScores();
    startLivePolling();
  }
});


function formatDate(isoString) {
  if (!isoString) return "TBD";
  return new Date(isoString).toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric"
  });
}


// ================================
// SEC SHOWCASE
// Renders clickable team logos for
// every SEC program. Clicking one
// sets the team filter and scrolls
// down to the matching games.
// ================================

// Canonical display order for conference tabs (FBS only — teamMap is built
// from /teams/fbs so no FCS conferences will appear anyway)
const CONF_ORDER = [
  "SEC", "Big Ten", "Big 12", "ACC",
  "Mountain West", "American Athletic", "Sun Belt", "MAC",
  "Conference USA", "FBS Independents"
];

const CONF_SHORT = {
  "SEC":               "SEC",
  "Big Ten":           "Big Ten",
  "Big 12":            "Big 12",
  "ACC":               "ACC",
  "Mountain West":     "Mtn West",
  "American Athletic": "AAC",
  "Sun Belt":          "Sun Belt",
  "MAC":               "MAC",
  "Conference USA":    "C-USA",
  "FBS Independents":  "Indep."
};

let activeConf      = "SEC";
let confTeamsByConf = {};

function populateConfBrowser() {
  // Group FBS teams (from teamMap) by conference
  confTeamsByConf = {};
  Object.entries(teamMap).forEach(([team, info]) => {
    const conf = info.conference;
    if (!conf) return;
    if (!confTeamsByConf[conf]) confTeamsByConf[conf] = [];
    confTeamsByConf[conf].push(team);
  });

  Object.keys(confTeamsByConf).forEach(conf => confTeamsByConf[conf].sort());

  const tabsEl = document.getElementById("confTabs");
  if (!tabsEl) return;

  const ordered = CONF_ORDER.filter(c => confTeamsByConf[c]);

  tabsEl.innerHTML = ordered.map(conf => {
    const c = CONF_COLORS[conf] || { bg: "#2a2a4a" };
    return `<button class="conf-tab" data-conf="${conf}"
              style="--conf-color:${c.bg}"
              onclick="showConfTeams('${conf}')">
              ${CONF_SHORT[conf] || conf}
            </button>`;
  }).join("");

  // Default to SEC, fall back to first available conference
  const defaultConf = confTeamsByConf["SEC"] ? "SEC" : ordered[0];
  showConfTeams(defaultConf);
}

function showConfTeams(confName) {
  activeConf = confName;

  document.querySelectorAll(".conf-tab").forEach(tab => {
    tab.classList.toggle("active", tab.dataset.conf === confName);
  });

  const teams = confTeamsByConf[confName] || [];
  const grid  = document.getElementById("confTeamGrid");
  if (!grid) return;

  grid.innerHTML = teams.map(team => {
    const info  = teamMap[team] || {};
    const color = info.color || "#8890a8";
    const frame = info.logo
      ? `<div class="conf-logo-frame" style="background:${color}22;border-color:${color}66">
           <img class="conf-team-logo" src="${info.logo}" alt="${team}" loading="lazy" onerror="this.style.display='none'">
         </div>`
      : `<div class="conf-logo-frame" style="background:${color}22;border-color:${color}66"></div>`;
    return `
      <div class="conf-team-item" onclick="filterToTeam('${team}')">
        ${frame}
        <div class="conf-team-name" style="color:${color}">${team}</div>
      </div>
    `;
  }).join("");
}

function filterToTeam(team) {
  const select = document.getElementById("teamFilter");
  select.value = team;
  applyFilters();
  document.querySelector(team === "LSU" ? ".lsu-hero" : ".filters").scrollIntoView({ behavior: "smooth" });
}

// ================================
// LSU MODE
// Transforms the page into an
// LSU-themed experience when LSU
// is selected.
// ================================

const LSU_LEGENDS = [
  {
    name: "Joe Burrow", pos: "QB", years: "2018–19", espnId: "3915511",
    note: "2019 Heisman Winner",
    detail: "Led LSU to a perfect 15–0 national championship in 2019, setting NCAA single-season records with 5,671 passing yards and 60 touchdowns. Won the Heisman Trophy by the largest margin in history."
  },
  {
    name: "Jayden Daniels", pos: "QB", years: "2023", espnId: "4426348",
    note: "2023 Heisman Winner",
    detail: "Won the 2023 Heisman Trophy after passing for 3,812 yards and 40 TDs while rushing for 1,134 yards. His dual-threat dominance made him the consensus best player in college football."
  },
  {
    name: "Odell Beckham Jr.", pos: "WR", years: "2011–13", espnId: "16733",
    note: "3× All-SEC",
    detail: "A three-time All-SEC selection whose elite route running and acrobatic catches made him one of the most exciting receivers in Tiger Stadium history, setting the stage for a legendary NFL career."
  },
  {
    name: "Leonard Fournette", pos: "RB", years: "2014–16", espnId: "3115364",
    note: "#4 Pick, 2017 Draft",
    detail: "Rushed for 2,531 yards in 2015 alone, earning consensus All-American honors. His combination of size, speed, and power made him one of the most physically imposing backs LSU has ever produced."
  },
  {
    name: "Ja'Marr Chase", pos: "WR", years: "2018–20", espnId: "4362628",
    note: "2020 Biletnikoff Award",
    detail: "Won the 2020 Biletnikoff Award with 84 catches, 1,780 yards, and 20 TDs. His chemistry with Joe Burrow formed the most prolific QB–WR duo in college football history."
  },
  {
    name: "Justin Jefferson", pos: "WR", years: "2017–19", espnId: "4262921",
    note: "3× All-Pro",
    detail: "Caught 111 passes for 1,540 yards and 18 TDs during LSU's 2019 title run. Went on to set the NFL record for most receiving yards through a player's first four seasons."
  },
  {
    name: "Tyrann Mathieu", pos: "DB", years: "2010–12", espnId: "15851",
    note: '"The Honey Badger"',
    detail: "Named 2011 SEC Defensive Player of the Year with 4 interceptions and 6 forced fumbles. His fearless playmaking style earned him the legendary nickname \"The Honey Badger\" and an iconic place in Tiger Stadium lore."
  },
  {
    name: "Patrick Peterson", pos: "CB", years: "2008–10", espnId: "13980",
    note: "2011 Thorpe Award",
    detail: "Won the Jim Thorpe Award as the nation's best defensive back and was a two-time first-team All-SEC selection. Drafted #5 overall in 2011, he became one of the premier shutdown corners in NFL history."
  },
];

function populateLSULegends() {
  const container = document.getElementById("lsuLegends");
  if (!container || container.children.length > 0) return;

  container.innerHTML = LSU_LEGENDS.map((p, i) => `
    <div class="lsu-legend-card" onclick="openLegendModal(${i})">
      <img class="lsu-legend-photo"
           src="https://a.espncdn.com/i/headshots/nfl/players/full/${p.espnId}.png"
           alt="${p.name}" loading="lazy"
           onerror="this.style.opacity='0.25'">
      <div class="lsu-legend-name">${p.name}</div>
      <div class="lsu-legend-pos">${p.pos} &nbsp;·&nbsp; ${p.years}</div>
      <div class="lsu-legend-note">${p.note}</div>
    </div>
  `).join("");
}

function openLegendModal(idx) {
  const p = LSU_LEGENDS[idx];
  if (!p) return;

  const legendPhoto = document.getElementById("legendModalPhoto");
  legendPhoto.style.opacity = "";
  legendPhoto.src = `https://a.espncdn.com/i/headshots/nfl/players/full/${p.espnId}.png`;
  legendPhoto.alt = p.name;
  document.getElementById("legendModalName").textContent   = p.name;
  document.getElementById("legendModalMeta").textContent   = `${p.pos}  ·  LSU ${p.years}`;
  document.getElementById("legendModalAward").textContent  = p.note;
  document.getElementById("legendModalDetail").textContent = p.detail;

  document.getElementById("legendModal").classList.add("open");
}

function closeLegendModal() {
  document.getElementById("legendModal").classList.remove("open");
}

document.getElementById("legendModalClose").addEventListener("click", closeLegendModal);
document.getElementById("legendModal").addEventListener("click", function(e) {
  if (e.target === this) closeLegendModal();
});


// ================================
// LSU MINI GAME
// Endless runner: click to jump the
// LSU RB over Ole Miss defenders.
// Highscore persists in localStorage.
// ================================

const LSU_GAME = (() => {
  const W = 560, H = 150, GROUND = 112;
  const RB_X = 80, RB_W = 26, RB_H = 52;
  const DEF_W = 28, DEF_H = 58;
  const GRAVITY = 0.65, JUMP_VY = -13;

  let canvas, ctx, animId = null;
  let state = "idle"; // idle | running | dead
  let ry, rvy, grounded;
  let defenders, nextSpawn, speed, tick, score;
  let best = 0;
  let ready = false;

  function setup() {
    canvas = document.getElementById("lsuGameCanvas");
    if (!canvas) return;
    ctx = canvas.getContext("2d");
    if (!ready) {
      canvas.addEventListener("click", onClick);
      canvas.addEventListener("touchstart", e => { e.preventDefault(); onClick(); }, { passive: false });
      ready = true;
    }
    best = parseInt(localStorage.getItem("lsuMiniGameBest") || "0", 10);
    state = "idle";
    setHUD(0, best);
    renderIdle();
  }

  function onClick() {
    if (state === "idle" || state === "dead") { startGame(); return; }
    if (grounded) { rvy = JUMP_VY; grounded = false; }
  }

  function startGame() {
    ry = GROUND - RB_H; rvy = 0; grounded = true;
    defenders = []; nextSpawn = 90; speed = 3; tick = 0; score = 0;
    state = "running";
    cancelAnimationFrame(animId);
    animId = requestAnimationFrame(step);
  }

  function step() {
    if (state !== "running") return;
    tick++;
    score = Math.floor(tick / 6);
    speed = 3 + score * 0.008;

    // Physics
    rvy += GRAVITY;
    ry  += rvy;
    if (ry >= GROUND - RB_H) { ry = GROUND - RB_H; rvy = 0; grounded = true; }

    // Spawn defenders
    if (--nextSpawn <= 0) {
      defenders.push({ x: W + 10 });
      nextSpawn = Math.max(55, 95 - score * 0.25) + Math.random() * 50;
    }
    defenders.forEach(d => d.x -= speed);
    defenders = defenders.filter(d => d.x > -DEF_W - 10);

    // Collision (shrunk hitbox for fairness)
    const rx = RB_X + 5, rw = RB_W - 10, rhh = RB_H - 10;
    for (const d of defenders) {
      const dy = GROUND - DEF_H;
      if (rx + rw > d.x + 5 && rx < d.x + DEF_W - 5 && ry + 8 + rhh > dy + 6 && ry + 8 < dy + DEF_H - 4) {
        gameOver(); return;
      }
    }

    setHUD(score, best);
    render();
    animId = requestAnimationFrame(step);
  }

  function gameOver() {
    state = "dead";
    cancelAnimationFrame(animId);
    if (score > best) { best = score; localStorage.setItem("lsuMiniGameBest", best); }
    setHUD(score, best);
    render();
    // Overlay
    ctx.fillStyle = "rgba(0,0,0,0.58)";
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = "center";
    ctx.font = "bold 22px 'Oswald', sans-serif";
    ctx.fillStyle = "#e8374d";
    ctx.fillText("TACKLED!", W / 2, H / 2 - 10);
    ctx.font = "bold 13px 'Oswald', sans-serif";
    ctx.fillStyle = "#fdd023";
    ctx.fillText(score + " YDS  ·  BEST: " + best + " YDS", W / 2, H / 2 + 12);
    ctx.font = "11px 'Inter', sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.fillText("Click to run again", W / 2, H / 2 + 30);
  }

  function renderIdle() {
    if (!ctx) return;
    tick = 0; ry = GROUND - RB_H; defenders = [{ x: 360 }];
    render();
    ctx.fillStyle = "rgba(0,0,0,0.52)";
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = "center";
    ctx.font = "bold 16px 'Oswald', sans-serif";
    ctx.fillStyle = "#fdd023";
    ctx.fillText("CLICK TO RUN!", W / 2, H / 2 - 4);
    ctx.font = "11px 'Inter', sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.fillText("Click or tap to jump", W / 2, H / 2 + 14);
  }

  // ---- Drawing ----

  function render() {
    ctx.clearRect(0, 0, W, H);
    drawField();
    defenders.forEach(drawDefender);
    drawRunner();
  }

  function drawStadiumLight(x, y, r) {
    // Light tower pole
    ctx.strokeStyle = "rgba(160,160,180,0.45)";
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x, y + r + 1); ctx.lineTo(x, y + 36); ctx.stroke();
    // Horizontal arm
    ctx.beginPath(); ctx.moveTo(x - 7, y + r + 1); ctx.lineTo(x + 7, y + r + 1); ctx.stroke();
    // Outer glow halo
    const halo = ctx.createRadialGradient(x, y, 0, x, y, r * 7);
    halo.addColorStop(0,   "rgba(255,248,200,0.55)");
    halo.addColorStop(0.25,"rgba(255,240,160,0.18)");
    halo.addColorStop(1,   "rgba(255,240,160,0)");
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(x, y, r * 7, 0, Math.PI * 2); ctx.fill();
    // Bright core
    ctx.fillStyle = "rgba(255,252,220,0.95)";
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }

  function drawField() {
    // ---- Night sky ----
    ctx.fillStyle = "#03020a";
    ctx.fillRect(0, 0, W, GROUND);

    // Field-light ambient glow rising from below
    const ambient = ctx.createRadialGradient(W / 2, GROUND, 20, W / 2, GROUND / 2, W * 0.75);
    ambient.addColorStop(0, "rgba(200,180,80,0.09)");
    ambient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = ambient;
    ctx.fillRect(0, 0, W, GROUND);

    // ---- Stadium stands (rows of seats) ----
    const STAND_TOP = 6, STAND_H = 58, ROWS = 9;
    const rowH = STAND_H / ROWS;
    const rowColors = ["#140a1e","#110818","#160b22","#12091a","#170c24","#130920","#15091e","#110718","#140a1c"];
    for (let i = 0; i < ROWS; i++) {
      ctx.fillStyle = rowColors[i];
      ctx.fillRect(0, STAND_TOP + i * rowH, W, rowH + 0.5);
    }

    // ---- Crowd dots (LSU gold + purple + dark) ----
    // Uses sin-based deterministic pattern so it's consistent across frames
    for (let cx = 6; cx < W - 6; cx += 5) {
      for (let cy = STAND_TOP + 3; cy < STAND_TOP + STAND_H - 4; cy += 5) {
        const v = (Math.sin(cx * 6.7 + cy * 11.3) + 1) * 0.5;
        if (v > 0.62) {
          ctx.fillStyle = v > 0.85 ? "#fdd023" : (v > 0.73 ? "#4b0082" : "#2d1040");
          ctx.fillRect(cx, cy, 2, 2);
        }
      }
    }

    // ---- Stadium lights (2 banks per side) ----
    drawStadiumLight(48,  10, 4);
    drawStadiumLight(112, 7,  3);
    drawStadiumLight(W - 48,  10, 4);
    drawStadiumLight(W - 112, 7,  3);

    // ---- Fade stands into field ----
    const fade = ctx.createLinearGradient(0, STAND_TOP + STAND_H - 14, 0, GROUND);
    fade.addColorStop(0, "rgba(3,2,10,0)");
    fade.addColorStop(1, "rgba(3,2,10,1)");
    ctx.fillStyle = fade;
    ctx.fillRect(0, STAND_TOP + STAND_H - 14, W, GROUND - (STAND_TOP + STAND_H - 14));

    // ---- Turf ----
    ctx.fillStyle = "#0b3010";
    ctx.fillRect(0, GROUND, W, H - GROUND);
    // Turf stripe alternation
    const stripeOff = (tick * speed * 0.5) % 40;
    for (let x = -stripeOff; x < W; x += 40) {
      ctx.fillStyle = "rgba(0,0,0,0.12)";
      ctx.fillRect(x, GROUND, 20, H - GROUND);
    }
    // Ground line
    ctx.fillStyle = "#1a6025";
    ctx.fillRect(0, GROUND, W, 3);
    // Yard lines
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1.5;
    const off = (tick * speed) % 90;
    for (let x = W - off; x > -90; x -= 90) {
      ctx.beginPath(); ctx.moveTo(x, GROUND + 2); ctx.lineTo(x, H); ctx.stroke();
    }
  }

  function drawRunner() {
    const x = RB_X, y = ry;
    const stride = Math.floor(tick / 5) % 2;

    // Shadow
    shadow(x + RB_W / 2, 13);

    // Gold pants + animated legs
    ctx.fillStyle = "#fdd023";
    if (grounded) {
      ctx.fillRect(x + 2,  y + RB_H - 20, 10, 20);
      ctx.fillRect(x + 14, y + RB_H - (stride ? 20 : 14), 10, stride ? 20 : 14);
    } else {
      ctx.fillRect(x + 2,  y + RB_H - 16, 10, 14); // tuck
      ctx.fillRect(x + 14, y + RB_H - 20, 10, 18);
    }

    // Purple jersey
    ctx.fillStyle = "#4b0082";
    ctx.fillRect(x + 1, y + 16, RB_W - 2, 30);
    // Jersey number
    ctx.fillStyle = "#fdd023";
    ctx.font = "bold 11px 'Oswald', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("7", x + RB_W / 2, y + 34);

    // Gold helmet dome
    ctx.fillStyle = "#fdd023";
    ctx.beginPath();
    ctx.arc(x + RB_W / 2, y + 9, 11, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(x + 2, y + 8, RB_W - 4, 9);
    // Purple stripe
    ctx.fillStyle = "#4b0082";
    ctx.fillRect(x + RB_W / 2 - 2, y, 4, 18);
    // Facemask (faces right)
    ctx.strokeStyle = "rgba(210,210,210,0.7)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x + RB_W - 4, y + 10);
    ctx.lineTo(x + RB_W + 3, y + 15);
    ctx.lineTo(x + RB_W + 3, y + 21);
    ctx.stroke();

    // Football tucked under arm
    ctx.fillStyle = "#6b3010";
    ctx.beginPath();
    ctx.ellipse(x + RB_W + 7, y + 26, 9, 5, -0.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(x + RB_W + 1, y + 25);
    ctx.lineTo(x + RB_W + 12, y + 27);
    ctx.stroke();
  }

  function drawDefender(d) {
    const x = d.x, y = GROUND - DEF_H;

    // Shadow
    shadow(x + DEF_W / 2, 13);

    // Silver pants + legs
    ctx.fillStyle = "#8a8a9a";
    ctx.fillRect(x + 3,  y + DEF_H - 20, 9, 20);
    ctx.fillRect(x + 16, y + DEF_H - 20, 9, 20);

    // Ole Miss red jersey
    ctx.fillStyle = "#cc0001";
    ctx.fillRect(x, y + 16, DEF_W, 32);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 9px 'Oswald', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("OM", x + DEF_W / 2, y + 35);

    // Arms raised (blocking)
    ctx.fillStyle = "#cc0001";
    ctx.fillRect(x - 8, y + 14, 9, 22);
    ctx.fillRect(x + DEF_W - 1, y + 14, 9, 22);
    // Hands
    ctx.fillStyle = "#c8956a";
    ctx.beginPath(); ctx.arc(x - 4, y + 12, 5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + DEF_W + 3, y + 12, 5, 0, Math.PI * 2); ctx.fill();

    // Navy helmet dome
    ctx.fillStyle = "#00205b";
    ctx.beginPath();
    ctx.arc(x + DEF_W / 2, y + 9, 12, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(x + 2, y + 8, DEF_W - 4, 9);
    // Red helmet stripe
    ctx.fillStyle = "#cc0001";
    ctx.fillRect(x + DEF_W / 2 - 2, y, 4, 18);
    // Facemask (faces left — toward runner)
    ctx.strokeStyle = "rgba(210,210,210,0.7)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x + 4, y + 10);
    ctx.lineTo(x - 3, y + 15);
    ctx.lineTo(x - 3, y + 21);
    ctx.stroke();
  }

  function shadow(cx, rx) {
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.beginPath();
    ctx.ellipse(cx, GROUND + 4, rx, 4, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function setHUD(s, b) {
    const se = document.getElementById("lsuGameScore");
    const be = document.getElementById("lsuGameBest");
    if (se) se.textContent = s;
    if (be) be.textContent = b;
  }

  function stop() {
    cancelAnimationFrame(animId);
    animId = null;
    state = "idle";
  }

  return { setup, stop };
})();


function enterLSUMode() {
  if (document.body.classList.contains("lsu-mode")) return;
  document.body.classList.add("lsu-mode");
  const hero = document.getElementById("lsuHero");
  hero.style.display = "block";
  const lsuInfo = teamMap["LSU"] || {};
  document.getElementById("lsuHeroLogo").src = lsuInfo.darkLogo || lsuInfo.logo || "";
  populateLSULegends();
  LSU_GAME.setup();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function exitLSUMode() {
  document.body.classList.remove("lsu-mode");
  document.getElementById("lsuHero").style.display = "none";
  LSU_GAME.stop();
}

function exitLSUModeBtn() {
  document.getElementById("teamFilter").value = "all";
  exitLSUMode();
  applyFilters();
}


// ================================
// TEAM FILTER POPULATION
// Builds the team dropdown from the
// loaded schedule so it always has
// every team in the current season.
// ================================

function populateTeamFilter(gameList) {
  const select = document.getElementById("teamFilter");

  const teams = [...new Set(gameList.flatMap(g => [g.home, g.away]))].sort();

  teams.forEach(team => {
    const option = document.createElement("option");
    option.value = team;
    option.textContent = team;
    select.appendChild(option);
  });
}


// ================================
// DISPLAY FUNCTION
// Builds a card for each game.
// Completed games show the real
// score; upcoming games show the
// statistical win probability.
// ================================

function displayGames(gameList) {
  const container = document.getElementById("gamesContainer");

  if (gameList.length === 0) {
    container.innerHTML = `
      <p style="color: #a8a8b3; text-align: center; grid-column: 1/-1; padding: 40px;">
        No games found for that filter. Try a different selection.
      </p>
    `;
    return;
  }

  // Build all cards as one string, then write to the DOM once (much faster than += in a loop)
  container.innerHTML = gameList.map(function(game) {
    let resultHTML;

    if (game.isLive) {
      const liveWP     = game.liveHomeWinProb;
      const liveAwayWP = liveWP != null ? 100 - liveWP : null;
      const periodStr  = game.livePeriod ? `Q${game.livePeriod}` : "";
      const clockStr   = game.liveClock  || "";
      const timeInfo   = [periodStr, clockStr].filter(Boolean).join(" · ");
      const situation  = game.liveSituation
        ? `<div class="live-situation">${game.liveSituation}</div>`
        : "";

      // Player stat rows
      const statRow = (label, leader) => {
        if (!leader) return "";
        const s = leader.stats;
        let val = "";
        if (label === "PASS") val = [s["C/ATT"], s["YDS"] && s["YDS"]+"YDS", s["TD"] && s["TD"]+"TD", s["INT"] && s["INT"]+"INT"].filter(Boolean).join(" · ");
        else if (label === "RUSH") val = [s["CAR"] && s["CAR"]+"CAR", s["YDS"] && s["YDS"]+"YDS", s["TD"] && s["TD"]+"TD"].filter(Boolean).join(" · ");
        else val = [s["REC"] && s["REC"]+"REC", s["YDS"] && s["YDS"]+"YDS", s["TD"] && s["TD"]+"TD"].filter(Boolean).join(" · ");
        return `<div class="live-stat-row"><span class="live-stat-cat">${label}</span><span class="live-stat-name">${leader.name}</span><span class="live-stat-val">${val}</span></div>`;
      };
      const teamStatBlock = (key, abbr) => {
        const ts = game.liveStats?.[key];
        if (!ts) return "";
        const rows = [statRow("PASS",ts.passing), statRow("RUSH",ts.rushing), statRow("REC",ts.receiving)].filter(Boolean).join("");
        return rows ? `<div class="live-stats-team">${abbr}</div>${rows}` : "";
      };
      const homeAbbr = game.home.split(" ").pop().slice(0,4).toUpperCase();
      const awayAbbr = game.away.split(" ").pop().slice(0,4).toUpperCase();
      const statsSection = game.liveStats
        ? `<div class="live-stats-box">${teamStatBlock("home",homeAbbr)}${teamStatBlock("away",awayAbbr)}</div>`
        : "";

      resultHTML = `
        <div class="prediction">
          <div class="pred-label">
            <span class="live-badge"><span class="live-dot"></span>Live</span>
            ${timeInfo ? `<span class="live-time">${timeInfo}</span>` : ""}
          </div>
          <div class="live-score">
            ${game.home} <strong>${game.liveHomePoints ?? 0}</strong>
            <span class="live-dash">—</span>
            <strong>${game.liveAwayPoints ?? 0}</strong> ${game.away}
          </div>
          ${situation}
          ${liveWP != null ? `
            <div class="prob-bar">
              <div class="prob-fill" style="width:${Math.max(liveWP, liveAwayWP)}%; transition:width 1s ease"></div>
            </div>
            <div class="prob-text">
              ${game.home}: ${liveWP}% &nbsp;|&nbsp; ${game.away}: ${liveAwayWP}%
            </div>
          ` : ""}
          ${statsSection}
        </div>
      `;
    } else if (game.isCompleted) {
      const winner = game.homePoints > game.awayPoints ? game.home : game.away;
      resultHTML = `
        <div class="prediction">
          <div class="pred-label">
            <span class="final-badge">Final</span>
          </div>
          <div class="pred-winner">🏆 ${winner}</div>
          <div class="prob-text">
            ${game.home} ${game.homePoints} &nbsp;|&nbsp; ${game.away} ${game.awayPoints}
          </div>
        </div>
      `;
    } else if (game.homeWinProb === null) {
      resultHTML = `
        <div class="prediction">
          <div class="pred-label">Win Probability</div>
          <div class="prob-text" style="padding-top: 6px;">Odds not yet available</div>
        </div>
      `;
    } else {
      const awayWinProb = 100 - game.homeWinProb;
      const favorite    = game.homeWinProb >= 50 ? game.home : game.away;
      const favProb     = game.homeWinProb >= 50 ? game.homeWinProb : awayWinProb;
      const favBarWidth = game.homeWinProb >= 50 ? game.homeWinProb : awayWinProb;
      resultHTML = `
        <div class="prediction">
          <div class="pred-label">Win Probability</div>
          <div class="pred-winner">🏆 ${favorite} (${favProb}%)</div>
          <div class="prob-bar">
            <div class="prob-fill" style="width: ${favBarWidth}%"></div>
          </div>
          <div class="prob-text">
            ${game.home}: ${game.homeWinProb}% win &nbsp;|&nbsp; ${game.away}: ${awayWinProb}% win
          </div>
        </div>
      `;
    }

    const homeInfo   = teamMap[game.home] || {};
    const awayInfo   = teamMap[game.away] || {};
    const homeColor  = homeInfo.color  || "#2a2a4a";
    const awayColor  = awayInfo.color  || "#2a2a4a";
    const homeLogo   = homeInfo.logo   ? `<img class="team-logo-sm" src="${homeInfo.logo}" alt="${game.home}" loading="lazy" onerror="this.style.display='none'">` : "";
    const awayLogo   = awayInfo.logo   ? `<img class="team-logo-sm" src="${awayInfo.logo}" alt="${game.away}" loading="lazy" onerror="this.style.display='none'">` : "";
    const mascotLine = (homeInfo.mascot || awayInfo.mascot)
      ? `<div class="mascot-line">${homeInfo.mascot || game.home} vs ${awayInfo.mascot || game.away}</div>`
      : "";

    // Conference badges
    const makeConfBadge = conf => {
      if (!conf) return "";
      const c = CONF_COLORS[conf] || { bg: "#2a2a4a", text: "#ffffff" };
      return `<span class="conf-badge" style="background:${c.bg};color:${c.text}">${conf}</span>`;
    };
    const homeConf = homeInfo.conference || null;
    const awayConf = awayInfo.conference || null;
    const confBadges = homeConf === awayConf
      ? makeConfBadge(homeConf)
      : makeConfBadge(homeConf) + makeConfBadge(awayConf);

    // Rivalry banner
    const rivalry = getRivalry(game.home, game.away);
    const rivalryClass = rivalry ? " rivalry-card" : "";
    const rivalryGlow  = rivalry ? `box-shadow:0 0 28px ${homeColor}55,0 0 0 1px rgba(255,255,255,0.1);` : "";
    const rivalryBanner = rivalry ? `
      <div class="rivalry-banner">
        <div class="rivalry-flag">${rivalry.flag}</div>
        <div class="rivalry-name">${rivalry.name}</div>
        <div class="rivalry-sub">Rivalry Game</div>
      </div>` : "";

    return `
      <div class="game-card${rivalryClass}" style="${rivalryGlow}">
        <div class="card-color-bar" style="background:linear-gradient(to right,${homeColor} 50%,${awayColor} 50%)"></div>
        ${rivalryBanner}
        <div class="card-meta">
          <span class="week-label" style="margin-bottom:0">Week ${game.week}</span>
          <div class="conf-badges">${confBadges}</div>
        </div>
        <div class="matchup roster-trigger" data-home="${game.home}" data-away="${game.away}">
          <div class="matchup-line">
            <span class="team-name-block">${homeLogo}${game.home}</span>
            <span class="vs-label">vs</span>
            <span class="team-name-block">${game.away}${awayLogo}</span>
          </div>
          ${mascotLine}
          <div class="roster-hint">👥 Click to view rosters</div>
        </div>
        <div class="game-info">📅 ${game.date} &nbsp;|&nbsp; 📍 ${game.location}</div>
        ${resultHTML}
      </div>
    `;
  }).join("");
}


// ================================
// FILTER FUNCTION
// Runs when the user clicks
// "Apply Filters". Filters the
// already-loaded games in memory.
// ================================

function applyFilters() {
  const selectedTeam = document.getElementById("teamFilter").value;
  const selectedWeek = document.getElementById("weekFilter").value;

  if (selectedTeam === "LSU") {
    enterLSUMode();
  } else {
    exitLSUMode();
  }

  let filtered = allGames;

  if (selectedTeam !== "all") {
    filtered = filtered.filter(g => g.home === selectedTeam || g.away === selectedTeam);
  }

  if (selectedWeek !== "all") {
    filtered = filtered.filter(g => g.week === selectedWeek);
  }

  displayGames(filtered);
}


// ================================
// CSV EXPORT
// Downloads the currently-filtered
// games as a .csv file.
// ================================

function exportCSV() {
  const selectedTeam = document.getElementById("teamFilter").value;
  const selectedWeek = document.getElementById("weekFilter").value;

  let filtered = allGames;
  if (selectedTeam !== "all") {
    filtered = filtered.filter(g => g.home === selectedTeam || g.away === selectedTeam);
  }
  if (selectedWeek !== "all") {
    filtered = filtered.filter(g => g.week === selectedWeek);
  }

  if (filtered.length === 0) {
    alert("No games to export with the current filters.");
    return;
  }

  const headers = ["Week", "Date", "Home Team", "Away Team", "Location", "Home Win %", "Away Win %", "Home Score", "Away Score", "Completed"];

  const rows = filtered.map(g => [
    g.week,
    g.date,
    g.home,
    g.away,
    g.location,
    g.homeWinProb != null ? g.homeWinProb : "",
    g.homeWinProb != null ? 100 - g.homeWinProb : "",
    g.homePoints != null ? g.homePoints : "",
    g.awayPoints != null ? g.awayPoints : "",
    g.isCompleted ? "Yes" : "No"
  ]);

  const csv = [headers, ...rows]
    .map(row => row.map(val => `"${String(val).replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const teamPart = selectedTeam === "all" ? "AllTeams" : selectedTeam.replace(/\s+/g, "");
  const weekPart = selectedWeek === "all" ? "AllWeeks" : `Week${selectedWeek}`;
  a.download = `CFBTracker_${teamPart}_${weekPart}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}


// ================================
// EVENT LISTENER + STARTUP
// ================================

document.getElementById("filterBtn").addEventListener("click", applyFilters);
document.getElementById("exportBtn").addEventListener("click", exportCSV);

// Open roster modal when any matchup is clicked (event delegation)
document.getElementById("gamesContainer").addEventListener("click", function(e) {
  const trigger = e.target.closest(".roster-trigger");
  if (trigger) openRosterModal(trigger.dataset.home, trigger.dataset.away);
});

loadGames();


// ================================
// ROSTER MODAL
// Fetches and displays both teams'
// rosters when a matchup is clicked.
// Uses 2025 rosters (most recent
// available) and caches results so
// the same team is never fetched
// twice in a session.
// ================================

const rosterCache = {};
let currentRosterData = {};

// Recruiting data is large and only needed when a roster modal opens.
// Fetch it lazily the first time rather than on page load.
async function loadRecruitingIfNeeded() {
  if (recruitingLoaded) return;
  recruitingLoaded = true;
  try {
    const headers = { "Authorization": `Bearer ${API_KEY}` };
    const data = await fetchCached(
      `${CFBD_BASE}/recruiting/players?year=${SEASON}&classification=HighSchool`,
      headers,
      `cfbd_recruits_${SEASON}`
    );
    data.forEach(r => {
      if (!r.committedTo) return;
      if (!recruitsByTeam[r.committedTo]) recruitsByTeam[r.committedTo] = [];
      recruitsByTeam[r.committedTo].push(r);
    });
  } catch { /* non-fatal — rosters still show without recruiting class */ }
}

async function fetchRoster(team) {
  if (rosterCache[team]) return rosterCache[team];
  await loadRecruitingIfNeeded();
  const headers = { "Authorization": `Bearer ${API_KEY}` };
  let data = await fetchCached(
    `${CFBD_BASE}/roster?team=${encodeURIComponent(team)}&year=2025`,
    headers,
    `cfbd_roster_${team}_2025`
  ).catch(() => []);

  // Remove players who entered the 2026 NFL Draft or transferred out
  const drafted     = draftExits[team]  || new Set();
  const transferred = portalExits[team] || new Set();
  data = data.filter(p => {
    const name = `${p.firstName} ${p.lastName}`.toLowerCase().trim();
    return !drafted.has(name) && !transferred.has(name);
  });

  // Add incoming transfer portal players using portal data only (no extra API calls)
  const incoming = portalIncoming[team] || [];
  if (incoming.length > 0) {
    const transferPlayers = incoming.map(entry => ({
      firstName:  entry.firstName,
      lastName:   entry.lastName,
      position:   entry.position,
      jersey:     null,
      height:     null,
      weight:     null,
      year:       null,
      homeCity:   null,
      homeState:  null,
      isTransfer: true,
      stars:      entry.stars  || 0,
      origin:     entry.origin || ""
    }));
    data = [...data, ...transferPlayers];
  }

  // Apply manual exits (players known to be gone but not yet in API data)
  const manualOut = (MANUAL_EXITS[team] || []).map(n => n.toLowerCase().trim());
  if (manualOut.length) {
    data = data.filter(p => !manualOut.includes(`${p.firstName} ${p.lastName}`.toLowerCase().trim()));
  }

  // Apply manual incoming (deduplicated — safe if API already has them)
  const manualIn = MANUAL_INCOMING[team] || [];
  if (manualIn.length) {
    const existing = new Set(data.map(p => `${p.firstName} ${p.lastName}`.toLowerCase().trim()));
    const toAdd = manualIn
      .filter(e => !existing.has(`${e.firstName} ${e.lastName}`.toLowerCase().trim()))
      .map(e => ({
        firstName: e.firstName, lastName: e.lastName, position: e.position,
        jersey: null, height: null, weight: null, year: null,
        homeCity: null, homeState: null,
        isTransfer: !e.isRecruit, isRecruit: e.isRecruit || false,
        stars: e.stars || 0, origin: e.origin || ""
      }));
    data = [...data, ...toAdd];
  }

  // Inject 2026 HS signing class (deduplication prevents doubles with early enrollees)
  const recruits = recruitsByTeam[team] || [];
  if (recruits.length > 0) {
    const existing = new Set(data.map(p => `${p.firstName} ${p.lastName}`.toLowerCase().trim()));
    const freshmen = recruits
      .filter(r => r.name && !existing.has(r.name.toLowerCase().trim()))
      .map(r => {
        const parts = r.name.trim().split(/\s+/);
        return {
          firstName:  parts[0]             || "",
          lastName:   parts.slice(1).join(" ") || "",
          position:   r.position           || null,
          jersey:     null,
          height:     r.height             || null,
          weight:     r.weight             || null,
          year:       null,
          homeCity:   r.city               || null,
          homeState:  r.stateProvince      || null,
          isTransfer: false,
          isRecruit:  true,
          stars:      r.stars              || 0,
          origin:     ""
        };
      });
    data = [...data, ...freshmen];
  }

  rosterCache[team] = data;
  return data;
}


async function openRosterModal(home, away) {
  const modal   = document.getElementById("rosterModal");
  const title   = document.getElementById("modalTitle");
  const rosters = document.getElementById("modalRosters");

  const homeInfo = teamMap[home] || {};
  const awayInfo = teamMap[away] || {};

  title.textContent = `${home} vs ${away} — ${SEASON} Rosters`;
  rosters.innerHTML = `
    <div class="roster-col"><p style="color:#6670a0;font-size:13px">Loading ${home}...</p></div>
    <div class="roster-col"><p style="color:#6670a0;font-size:13px">Loading ${away}...</p></div>
  `;
  modal.classList.add("open");

  const [homePlayers, awayPlayers] = await Promise.all([
    fetchRoster(home),
    fetchRoster(away)
  ]);

  currentRosterData = {
    [home]: { cfbd: homePlayers },
    [away]: { cfbd: awayPlayers }
  };

  const makeHeader = (info, team) => {
    const logo  = info.logo  ? `<img class="team-logo-md" src="${info.logo}" alt="${team}" onerror="this.style.display='none'">` : "";
    const color = info.color || "#e8374d";
    return `<h3 style="border-color:${color};color:${color}">${logo}${team}${info.mascot ? " " + info.mascot : ""}</h3>`;
  };

  rosters.innerHTML = `
    <div class="roster-col">
      ${makeHeader(homeInfo, home)}
      ${buildRosterHTML(homePlayers, home)}
    </div>
    <div class="roster-col">
      ${makeHeader(awayInfo, away)}
      ${buildRosterHTML(awayPlayers, away)}
    </div>
  `;

}

function buildRosterHTML(players, team) {
  if (!players || players.length === 0) {
    return `<p style="color:#6670a0;font-size:13px;">Roster not available.</p>`;
  }

  const groups = {
    "QB":             players.filter(p => p.position === "QB"),
    "RB / FB":        players.filter(p => ["RB","FB"].includes(p.position)),
    "WR / TE":        players.filter(p => ["WR","TE"].includes(p.position)),
    "O-Line":         players.filter(p => ["OL","C","G","OG","OT","T"].includes(p.position)),
    "D-Line":         players.filter(p => ["DE","DT","NT","DL"].includes(p.position)),
    "Linebacker":     players.filter(p => ["LB","ILB","OLB","MLB"].includes(p.position)),
    "Defensive Back": players.filter(p => ["CB","S","FS","SS","DB","NB","SAF"].includes(p.position)),
    "Special Teams":  players.filter(p => ["K","P","LS","ATH","KR","PR"].includes(p.position)),
  };

  return Object.entries(groups)
    .filter(([, list]) => list.length > 0)
    .map(([groupName, list]) => {
      const sorted = list.sort((a, b) => (a.isTransfer ? 1 : 0) - (b.isTransfer ? 1 : 0) || (a.jersey ?? 99) - (b.jersey ?? 99));
      const rows = sorted.map((p, i) => {
        const jersey = p.jersey != null ? `#${p.jersey}` : "—";
        const name   = `${p.firstName} ${p.lastName}`;
        const yr     = formatYear(p.year);
        const ht     = formatHeight(p.height);
        const wt     = p.weight ? `${p.weight} lbs` : "";
        const meta   = [yr, ht, wt].filter(Boolean).join(" · ");
        const xfer   = p.isRecruit
          ? `<span class="transfer-badge recruit-badge">${"★".repeat(Math.min(p.stars || 0, 5))} Freshman</span>`
          : p.isTransfer
          ? `<span class="transfer-badge">${"★".repeat(Math.min(p.stars || 0, 5))} from ${p.origin}</span>`
          : "";
        const globalIdx = players.indexOf(p);
        return `
          <div class="player-row clickable-player" data-team="${team}" data-idx="${globalIdx}">
            <span class="player-jersey">${jersey}</span>
            <span class="player-name">${name}${xfer}</span>
            <span class="player-meta">${meta}</span>
          </div>`;
      }).join("");

      return `
        <div class="position-group">
          <div class="position-label">${groupName}</div>
          ${rows}
        </div>`;
    }).join("");
}

function formatHeight(inches) {
  if (!inches) return "";
  return `${Math.floor(inches / 12)}'${inches % 12}"`;
}

function formatYear(year) {
  return ["", "Fr", "So", "Jr", "Sr", "Gr"][year] || "";
}

// Close roster modal
document.getElementById("modalClose").addEventListener("click", closeModal);
document.getElementById("rosterModal").addEventListener("click", function(e) {
  if (e.target === this) closeModal();
});
document.addEventListener("keydown", function(e) {
  if (e.key === "Escape") {
    if (document.getElementById("legendModal").classList.contains("open")) {
      closeLegendModal();
    } else if (document.getElementById("playerModal").classList.contains("open")) {
      closePlayerModal();
    } else {
      closeModal();
    }
  }
});

function closeModal() {
  document.getElementById("rosterModal").classList.remove("open");
}

// Player row click — delegate from the roster modal content area
document.getElementById("modalRosters").addEventListener("click", function(e) {
  const row = e.target.closest(".clickable-player");
  if (row) showPlayerDetail(row.dataset.team, parseInt(row.dataset.idx));
});

// ================================
// PLAYER DETAIL MODAL
// ================================

function showPlayerDetail(team, idx) {
  const teamData = currentRosterData[team];
  if (!teamData) return;

  const p    = teamData.cfbd[idx];
  const info = teamMap[team] || {};
  if (!p) return;

  // CFBD player IDs map directly to ESPN college headshot URLs — no API call needed
  const headshot = document.getElementById("playerHeadshot");
  headshot.style.display = "block";
  headshot.onerror = function() { this.style.display = "none"; };
  headshot.src = `https://a.espncdn.com/i/headshots/college-football/players/full/${p.id}.png`;

  document.getElementById("playerJerseyBadge").textContent      = p.jersey != null ? `#${p.jersey}` : "";
  document.getElementById("playerJerseyBadge").style.background = info.color || "#e8374d";
  document.getElementById("playerCardName").textContent          = `${p.firstName} ${p.lastName}`;
  document.getElementById("playerCardTeam").textContent          = `${team}${info.mascot ? " " + info.mascot : ""}`;
  document.getElementById("pcPosition").textContent              = p.position || "—";
  document.getElementById("pcClass").textContent                 = formatYear(p.year) || "—";
  document.getElementById("pcHeight").textContent                = formatHeight(p.height) || "—";
  document.getElementById("pcWeight").textContent                = p.weight ? `${p.weight} lbs` : "—";
  document.getElementById("pcHometown").textContent              = [p.homeCity, p.homeState].filter(Boolean).join(", ") || "—";

  document.getElementById("playerModal").classList.add("open");
}

function closePlayerModal() {
  document.getElementById("playerModal").classList.remove("open");
}

document.getElementById("playerModalClose").addEventListener("click", closePlayerModal);
document.getElementById("playerModal").addEventListener("click", function(e) {
  if (e.target === this) closePlayerModal();
});
