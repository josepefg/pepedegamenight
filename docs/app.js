let raw = null;
let table = null;
let filteredPlays = [];

const JSON_PATH = "data/bgstats.json"; // dentro de docs/data/

function $(id) {
  return document.getElementById(id);
}

function destroyTable() {
  if (table) {
    table.destroy();
    window.jQuery("#tabela").empty();
    table = null;
  }
}

function indexById(arr) {
  const m = new Map();
  (arr || []).forEach(o => {
    if (o && (o.id !== undefined)) m.set(o.id, o);
  });
  return m;
}

function getPlayerName(playerId) {
  const p = raw.playersById.get(playerId);
  return p?.name || `Player ${playerId}`;
}
function getGameName(gameId) {
  const g = raw.gamesById.get(gameId);
  return g?.name || `Game ${gameId}`;
}
function getLocationName(locId) {
  const l = raw.locationsById.get(locId);
  return l?.name || (locId ?? "");
}

function toISOish(dt) {
  if (!dt) return "";
  const d = new Date(String(dt).replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return String(dt);
  return d.toISOString().slice(0, 19).replace("T", " ");
}
function getYear(dt) {
  const d = new Date(String(dt).replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? "" : String(d.getFullYear());
}

// tenta achar duração (min)
function getDurationMinutes(play) {
  const candidates = [
    "durationMinutes", "playTimeMinutes", "playTime", "length", "duration", "time",
    "playTimeSeconds", "durationSeconds", "lengthSeconds"
  ];

  for (const k of candidates) {
    if (play && play[k] !== undefined && play[k] !== null && play[k] !== "") {
      const v = Number(play[k]);
      if (!Number.isNaN(v)) {
        if (k.toLowerCase().includes("second")) return Math.round(v / 60);
        if (v > 600) return Math.round(v / 60); // heurística p/ segundos
        return Math.round(v);
      }
    }
  }
  return null;
}

function parseScore(scoreStr) {
  if (scoreStr === null || scoreStr === undefined) return null;
  const s = String(scoreStr).trim();
  if (!s) return null;
  const parts = s.split("+").map(x => Number(x.trim())).filter(n => !Number.isNaN(n));
  if (!parts.length) return null;
  return parts.reduce((a, b) => a + b, 0);
}

function buildOptions() {
  const locSel = $("fLocation");
  const yearsSel = $("fYear");
  const togetherSel = $("fPlayersTogether");

  // limpa (mantém primeiro option nos dois primeiros)
  locSel.querySelectorAll("option:not(:first-child)").forEach(o => o.remove());
  yearsSel.querySelectorAll("option:not(:first-child)").forEach(o => o.remove());
  togetherSel.innerHTML = "";

  const locSet = new Set();
  const yearSet = new Set();

  for (const p of raw.plays) {
    if (p.locationRefId !== undefined && p.locationRefId !== null && p.locationRefId !== "") {
      locSet.add(String(p.locationRefId));
    }
    const y = getYear(p.playDate);
    if (y) yearSet.add(y);
  }

  [...locSet].sort((a,b)=>a.localeCompare(b)).forEach(id => {
    const opt = document.createElement("option");
    opt.value = id;
    const numericId = Number(id);
    opt.textContent = getLocationName(Number.isNaN(numericId) ? id : numericId) || `Local ${id}`;
    locSel.appendChild(opt);
  });

  [...yearSet].sort().forEach(y => {
    const opt = document.createElement("option");
    opt.value = y;
    opt.textContent = y;
    yearsSel.appendChild(opt);
  });

  const players = (raw.players || []).slice().sort((a,b) => (a.name||"").localeCompare(b.name||""));
  for (const pl of players) {
    const opt = document.createElement("option");
    opt.value = String(pl.id);
    opt.textContent = pl.name || `Player ${pl.id}`;
    togetherSel.appendChild(opt);
  }
}

function readFilters() {
  const locationId = $("fLocation").value;
  const year = $("fYear").value;
  const minTimeStr = $("fMinTime").value;
  const maxTimeStr = $("fMaxTime").value;

  const togetherSel = $("fPlayersTogether");
  const togetherIds = [...togetherSel.selectedOptions]
    .map(o => Number(o.value))
    .filter(v => !Number.isNaN(v));

  return {
    locationId: locationId || null,
    year: year || null,
    minTime: minTimeStr !== "" ? Number(minTimeStr) : null,
    maxTime: maxTimeStr !== "" ? Number(maxTimeStr) : null,
    togetherIds,
  };
}

function applyFilters() {
  const f = readFilters();

  filteredPlays = raw.plays.filter(play => {
    if (f.locationId) {
      if (String(play.locationRefId ?? "") !== String(f.locationId)) return false;
    }
    if (f.year) {
      if (getYear(play.playDate) !== f.year) return false;
    }

    const dur = getDurationMinutes(play);
    if (f.minTime !== null) {
      if (dur === null || dur < f.minTime) return false;
    }
    if (f.maxTime !== null) {
      if (dur === null || dur > f.maxTime) return false;
    }

    if (f.togetherIds.length) {
      const ids = new Set((play.playerScores || []).map(ps => ps.playerRefId));
      for (const needed of f.togetherIds) {
        if (!ids.has(needed)) return false;
      }
    }
    return true;
  });

  $("status").textContent = `Filtrado: ${filteredPlays.length} / ${raw.plays.length} partidas`;
}

function renderPartidas() {
  destroyTable();

  const rows = filteredPlays.map(play => {
    const duration = getDurationMinutes(play);
    const players = (play.playerScores || []).map(ps => getPlayerName(ps.playerRefId)).join(", ");
    const winners = (play.playerScores || []).filter(ps => ps.winner).map(ps => getPlayerName(ps.playerRefId)).join(", ");

    const scoreTotal = (play.playerScores || [])
      .map(ps => parseScore(ps.score))
      .filter(v => v !== null)
      .reduce((a,b) => a + b, 0);

    return {
      data: toISOish(play.playDate),
      ano: getYear(play.playDate),
      jogo: getGameName(play.gameRefId),
      local: getLocationName(play.locationRefId),
      tempo_min: duration ?? "",
      jogadores: players,
      vencedores: winners,
      times: play.usesTeams ? "sim" : "não",
      rating: play.rating ?? "",
      score_total: scoreTotal || "",
    };
  });

  window.jQuery("#tabela").append(`
    <thead>
      <tr>
        <th>Data</th>
        <th>Ano</th>
        <th>Jogo</th>
        <th>Local</th>
        <th>Tempo (min)</th>
        <th>Jogadores</th>
        <th>Vencedores</th>
        <th>Times?</th>
        <th>Rating</th>
        <th>Score (soma)</th>
      </tr>
    </thead>
  `);

  table = new DataTable("#tabela", {
    data: rows,
    columns: [
      { data: "data" },
      { data: "ano" },
      { data: "jogo" },
      { data: "local" },
      { data: "tempo_min" },
      { data: "jogadores" },
      { data: "vencedores" },
      { data: "times" },
      { data: "rating" },
      { data: "score_total" },
    ],
    pageLength: 25,
    order: [[0, "desc"]],
  });
}

function renderJogadores() {
  destroyTable();

  const agg = new Map();

  for (const play of filteredPlays) {
    for (const ps of (play.playerScores || [])) {
      const id = ps.playerRefId;

      if (!agg.has(id)) {
        agg.set(id, {
          jogador: getPlayerName(id),
          partidas: 0,
          vitorias: 0,
          rankSum: 0,
          rankCount: 0,
          scoreSum: 0,
          scoreCount: 0
        });
      }

      const s = agg.get(id);
      s.partidas += 1;
      if (ps.winner) s.vitorias += 1;

      if (ps.rank !== undefined && ps.rank !== null) {
        s.rankSum += Number(ps.rank);
        s.rankCount += 1;
      }

      const sc = parseScore(ps.score);
      if (sc !== null) {
        s.scoreSum += sc;
        s.scoreCount += 1;
      }
    }
  }

  const rows = [...agg.values()].map(s => ({
    jogador: s.jogador,
    partidas: s.partidas,
    vitorias: s.vitorias,
    winrate: s.partidas ? (100 * s.vitorias / s.partidas).toFixed(1) + "%" : "0%",
    rank_medio: s.rankCount ? (s.rankSum / s.rankCount).toFixed(2) : "",
    score_medio: s.scoreCount ? (s.scoreSum / s.scoreCount).toFixed(2) : ""
  }));

  window.jQuery("#tabela").append(`
    <thead>
      <tr>
        <th>Jogador</th>
        <th>Partidas</th>
        <th>Vitórias</th>
        <th>Winrate</th>
        <th>Rank médio</th>
        <th>Score médio</th>
      </tr>
    </thead>
  `);

  table = new DataTable("#tabela", {
    data: rows,
    columns: [
      { data: "jogador" },
      { data: "partidas" },
      { data: "vitorias" },
      { data: "winrate" },
      { data: "rank_medio" },
      { data: "score_medio" },
    ],
    pageLength: 25,
    order: [[1, "desc"]],
  });
}

function refreshActiveView() {
  applyFilters();
  if ($("btnJogadores").classList.contains("active")) renderJogadores();
  else renderPartidas();
}

function wireFilters() {
  const ids = ["fLocation", "fYear", "fMinTime", "fMaxTime", "fPlayersTogether"];
  ids.forEach(id => $(id).addEventListener("change", refreshActiveView));
  $("fMinTime").addEventListener("input", refreshActiveView);
  $("fMaxTime").addEventListener("input", refreshActiveView);

  $("btnClear").onclick = () => {
    $("fLocation").value = "";
    $("fYear").value = "";
    $("fMinTime").value = "";
    $("fMaxTime").value = "";
    const sel = $("fPlayersTogether");
    [...sel.options].forEach(o => o.selected = false);
    refreshActiveView();
  };
}

async function main() {
  const statusEl = $("status");
  const btnPartidas = $("btnPartidas");
  const btnJogadores = $("btnJogadores");

  try {
    const res = await fetch(JSON_PATH, { cache: "no-store" });
    if (!res.ok) throw new Error(`Não consegui ler ${JSON_PATH} (HTTP ${res.status})`);

    const j = await res.json();

    raw = {
      games: j.games || [],
      players: j.players || [],
      locations: j.locations || [],
      plays: j.plays || [],
      gamesById: indexById(j.games || []),
      playersById: indexById(j.players || []),
      locationsById: indexById(j.locations || []),
    };

    buildOptions();
    wireFilters();

    filteredPlays = raw.plays.slice();
    statusEl.textContent = `OK — ${raw.plays.length} partidas`;
    renderPartidas();

    btnPartidas.onclick = () => {
      btnPartidas.classList.add("active");
      btnJogadores.classList.remove("active");
      refreshActiveView();
    };
    btnJogadores.onclick = () => {
      btnJogadores.classList.add("active");
      btnPartidas.classList.remove("active");
      refreshActiveView();
    };

  } catch (e) {
    console.error(e);
    statusEl.textContent = `Erro: ${e.message} (veja Console/F12)`;
  }
}

main();
