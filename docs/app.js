let rawPlays = [];
let table = null;

function parseScore(scoreStr) {
  // score às vezes vem "" (vazio) :contentReference[oaicite:3]{index=3}
  // às vezes vem "8+31+8" :contentReference[oaicite:4]{index=4}
  if (!scoreStr) return null;
  const parts = String(scoreStr).split("+").map(s => Number(s.trim())).filter(n => !Number.isNaN(n));
  if (!parts.length) return null;
  return parts.reduce((a,b) => a + b, 0);
}

function asDate(isoLike) {
  // exemplo: "2025-04-20 01:59:36" :contentReference[oaicite:5]{index=5}
  // troca espaço por 'T' pra Date() entender melhor
  return new Date(String(isoLike).replace(" ", "T"));
}

function destroyTable() {
  if (table) {
    table.destroy();
    $("#tabela").empty();
    table = null;
  }
}

function renderPartidas() {
  destroyTable();

  const rows = rawPlays.map(p => {
    const date = p.playDate ? asDate(p.playDate) : null;
    const players = (p.playerScores || []).map(ps => `Player ${ps.playerRefId}`).join(", ");
    const winners = (p.playerScores || []).filter(ps => ps.winner).map(ps => `Player ${ps.playerRefId}`).join(", ");
    return {
      playDate: date ? date.toISOString().slice(0,19).replace("T"," ") : "",
      gameRefId: p.gameRefId ?? "",
      locationRefId: p.locationRefId ?? "",
      players,
      winners,
      usesTeams: p.usesTeams ? "sim" : "não",
      rating: p.rating ?? "",
      uuid: p.uuid ?? ""
    };
  });

  $("#tabela").append(`
    <thead>
      <tr>
        <th>Data</th>
        <th>Jogo (gameRefId)</th>
        <th>Local (locationRefId)</th>
        <th>Jogadores</th>
        <th>Vencedores</th>
        <th>Times?</th>
        <th>Rating</th>
        <th>UUID</th>
      </tr>
    </thead>
  `);

  table = new DataTable("#tabela", {
    data: rows,
    columns: [
      { data: "playDate" },
      { data: "gameRefId" },
      { data: "locationRefId" },
      { data: "players" },
      { data: "winners" },
      { data: "usesTeams" },
      { data: "rating" },
      { data: "uuid" },
    ],
    pageLength: 25,
    order: [[0, "desc"]],
  });
}

function renderJogadores() {
  destroyTable();

  const agg = new Map(); // playerRefId -> stats

  for (const p of rawPlays) {
    const scores = p.playerScores || [];
    for (const ps of scores) {
      const id = ps.playerRefId;
      if (!agg.has(id)) {
        agg.set(id, { player: `Player ${id}`, partidas: 0, vitorias: 0, rankSum: 0, rankCount: 0, scoreSum: 0, scoreCount: 0 });
      }
      const s = agg.get(id);
      s.partidas += 1;
      if (ps.winner) s.vitorias += 1;
      if (ps.rank !== undefined && ps.rank !== null) { s.rankSum += Number(ps.rank); s.rankCount += 1; }
      const sc = parseScore(ps.score);
      if (sc !== null) { s.scoreSum += sc; s.scoreCount += 1; }
    }
  }

  const rows = [...agg.values()].map(s => ({
    player: s.player,
    partidas: s.partidas,
    vitorias: s.vitorias,
    winrate: s.partidas ? (100 * s.vitorias / s.partidas).toFixed(1) + "%" : "0%",
    rankMedio: s.rankCount ? (s.rankSum / s.rankCount).toFixed(2) : "",
    scoreMedio: s.scoreCount ? (s.scoreSum / s.scoreCount).toFixed(2) : ""
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
      { data: "player" },
      { data: "partidas" },
      { data: "vitorias" },
      { data: "winrate" },
      { data: "rankMedio" },
      { data: "scoreMedio" },
    ],
    pageLength: 25,
    order: [[1, "desc"]],
  });
}

async function main() {
  const status = document.getElementById("status");

  try {
    const res = await fetch("./data/bgstats.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    rawPlays = await res.json();

    status.textContent = `OK — ${rawPlays.length} partidas carregadas`;
    renderPartidas();
  } catch (e) {
    status.textContent = `Erro ao carregar JSON: ${e.message}`;
    console.error(e);
  }

  document.getElementById("btnPartidas").onclick = () => {
    document.getElementById("btnPartidas").classList.add("active");
    document.getElementById("btnJogadores").classList.remove("active");
    renderPartidas();
  };
  document.getElementById("btnJogadores").onclick = () => {
    document.getElementById("btnJogadores").classList.add("active");
    document.getElementById("btnPartidas").classList.remove("active");
    renderJogadores();
  };
}

main();
