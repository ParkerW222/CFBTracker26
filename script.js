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
let portalIncoming = {}; // players arriving: { "LSU": [ portal entry, ... ] }


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
            await new Promise(r => setTimeout(r, 250)); // polite gap between requests
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
    populateSECShowcase();
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

async function fetchLiveScores() {
  if (allGames.length === 0) return false;
  const headers = { "Authorization": `Bearer ${API_KEY}` };
  try {
    const res = await fetch(`${CFBD_BASE}/scoreboard?classification=fbs`, { headers });
    if (!res.ok) return false;
    const data = await res.json();

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

    applyFilters();

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

const SEC_TEAMS = [
  "Alabama", "Arkansas", "Auburn", "Florida", "Georgia", "Kentucky",
  "Vanderbilt", "Mississippi State", "Missouri", "Ole Miss", "Oklahoma",
  "South Carolina", "Tennessee", "Texas", "Texas A&M", "LSU"
];

function populateSECShowcase() {
  const container = document.getElementById("secLogos");
  if (!container) return;

  container.innerHTML = SEC_TEAMS.map(team => {
    const info  = teamMap[team] || {};
    const logo  = info.logo  ? `<img class="sec-team-logo" src="${info.logo}" alt="${team}" loading="lazy" onerror="this.style.display='none'">` : "";
    const color = info.color || "#8890a8";
    return `
      <div class="sec-team-item" onclick="filterToTeam('${team}')">
        ${logo}
        <div class="sec-team-name" style="color:${color}">${team}</div>
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
  { name: "Joe Burrow",        pos: "QB", years: "2018–19", espnId: "3915511", note: "2019 Heisman Winner"   },
  { name: "Jayden Daniels",    pos: "QB", years: "2023",    espnId: "4426348", note: "2023 Heisman Winner"   },
  { name: "Odell Beckham Jr.", pos: "WR", years: "2011–13", espnId: "16733",   note: "3× All-SEC"           },
  { name: "Leonard Fournette", pos: "RB", years: "2014–16", espnId: "3115364", note: "#4 Pick, 2017 Draft"  },
  { name: "Ja'Marr Chase",     pos: "WR", years: "2018–20", espnId: "4362628", note: "2020 Biletnikoff Awd" },
  { name: "Justin Jefferson",  pos: "WR", years: "2017–19", espnId: "4262921", note: "3× All-Pro"           },
  { name: "Tyrann Mathieu",    pos: "DB", years: "2010–12", espnId: "15851",   note: "\"The Honey Badger\"" },
  { name: "Patrick Peterson",  pos: "CB", years: "2008–10", espnId: "13980",   note: "2011 Thorpe Award"    },
];

function populateLSULegends() {
  const container = document.getElementById("lsuLegends");
  if (!container || container.children.length > 0) return;

  container.innerHTML = LSU_LEGENDS.map(p => `
    <div class="lsu-legend-card">
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

function enterLSUMode() {
  if (document.body.classList.contains("lsu-mode")) return;
  document.body.classList.add("lsu-mode");
  const hero = document.getElementById("lsuHero");
  hero.style.display = "block";
  const lsuInfo = teamMap["LSU"] || {};
  document.getElementById("lsuHeroLogo").src = lsuInfo.darkLogo || lsuInfo.logo || "";
  populateLSULegends();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function exitLSUMode() {
  document.body.classList.remove("lsu-mode");
  document.getElementById("lsuHero").style.display = "none";
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
              <div class="prob-fill" style="width:${Math.max(liveWP, liveAwayWP)}%"></div>
            </div>
            <div class="prob-text">
              ${game.home}: ${liveWP}% win &nbsp;|&nbsp; ${game.away}: ${liveAwayWP}% win
            </div>
          ` : ""}
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

async function fetchRoster(team) {
  if (rosterCache[team]) return rosterCache[team];
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
        const xfer   = p.isTransfer
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
    if (document.getElementById("playerModal").classList.contains("open")) {
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
