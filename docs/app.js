let raw = null;
let table = null;

const JSON_PATH = new URL("data/bgstats.json", document.baseURI).toString();

function destroyTable() {
  if (table) {
    table.destroy();
    $("#tabela").empty();
    table = null;
  }
}

// score pode vir "", "14" ou "2+1" (BGStats) :contentReference[oaicite:3]{index=3} :contentReference[oaicite:4]{index=4}
function parseScore(scoreStr) {
  if (scoreStr === null || scoreStr === undefined) return null;
  const s = String(scoreStr).trim();
  if (!s) return null;
  const parts = s.split("+").map(x => Number(x.trim())).filter(n => !Number.isNaN(n));
  if (!parts.length) return null;
  return parts.reduce((a,b) => a + b, 0);
}

function toISOish(dt) {
  // playDate vem como "YYYY-MM-DD HH:MM:SS" :contentReference[oaicite:5]{index=5}
  if (!dt) return "";
  const d = new Date(String(dt).replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return String(dt);
  return d.toISOString().slice(0,19).replace("T"," ");
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

function renderPartidas() {
  destroyTable();

  const rows = (raw.plays || []).map(play => {
    const players = (play.playerScores || []).map(ps => getPlayerName(ps.playerRefId)).join(", ");
    const winners = (play.playerScores || []).filter(ps => ps.winner).map(ps => getPlayerName(ps.playerRefId)).join(", ");

    const scoreTotal = (play.playerScores || [])
      .map(ps => parseScore(ps.score))
      .filter(v => v !== null)
      .reduce((a,b) => a + b, 0);

    return {
      data: toISOish(play.playDate),
      jogo: getGameName(play.gameRefId),
      local: getLocationName(play.locationRefId),
      jogadores: players,
      vencedores: winners,
      times: play.usesTeams ? "sim" : "não",
      rating: play.rating ?? "",
      score_total: scoreTotal || "",
      uuid: play.uuid ?? ""
    };
  });

  $("#tabela").append(`
    <thead>
      <tr>
        <th>Data</th>
        <th>Jogo</th>
        <th>Local</th>
        <th>Jogadores</th>
        <th>Vencedores</th>
        <th>Times?</th>
        <th>Rating</th>
        <th>Score (soma)</th>
        <th>UUID</th>
      </tr>
    </thead>
  `);

  table = new DataTable("#tabela", {
    data: rows,
    columns: [
      { data: "data" },
      { data: "jogo" },
      { data: "local" },
      { data: "jogadores" },
      { data: "vencedores" },
      { data: "times" },
      { data: "rating" },
      { data: "score_total" },
      { data: "uuid" }
    ],
    pageLength: 25,
    order: [[0, "desc"]],
  });
}

function renderJogadores() {
  destroyTable();

  const agg = new Map(); // playerId -> stats

  for (const play of (raw.plays || [])) {
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

  $("#tabela").append(`
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
      { data: "score_medio" }
    ],
    pageLength: 25,
    order: [[1, "desc"]],
  });
}

async function main() {
  const status = document.getElementById("status");

  try {
    const res = await fetch(JSON_PATH, { cache: "no-store" });
    if (!res.ok) throw new Error(`Não consegui ler ${JSON_PATH} (HTTP ${res.status})`);
    const j = await res.json();

    // BGStats export “grande”: objeto com chaves como games/players/plays
    raw = {
      games: j.games || [],
      players: j.players || [],
      locations: j.locations || [],
      plays: j.plays || [],
      gamesById: indexById(j.games || []),
      playersById: indexById(j.players || []),
      locationsById: indexById(j.locations || [])
    };

    status.textContent = `OK — ${raw.plays.length} partidas, ${raw.players.length} jogadores, ${raw.games.length} jogos`;
    renderPartidas();

    document.getElementById("btnPartidas").onclick = () => {
      btnPartidas.classList.add("active");
      btnJogadores.classList.remove("active");
      renderPartidas();
    };

    document.getElementById("btnJogadores").onclick = () => {
      btnJogadores.classList.add("active");
      btnPartidas.classList.remove("active");
      renderJogadores();
    };

  } catch (e) {
    console.error(e);
    status.textContent = `Erro: ${e.message}`;
  }
}

main();
