const JSON_PATH = "data/bgstats.json";

let raw = null;
let filteredPlays = [];
let table = null;
let view = "partidas";

const el = (id) => document.getElementById(id);

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
    if (o && o.id !== undefined) m.set(o.id, o);
  });
  return m;
}

function yearOf(dt) {
  if (!dt) return "";
  const d = new Date(String(dt).replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? "" : String(d.getFullYear());
}

function toISOish(dt) {
  if (!dt) return "";
  const d = new Date(String(dt).replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return String(dt);
  return d.toISOString().slice(0, 19).replace("T", " ");
}

// Heurística: tenta achar duração em minutos
function durationMin(play) {
  const keys = [
    "durationMinutes", "playTimeMinutes", "playTime", "length", "duration", "time",
    "playTimeSeconds", "durationSeconds", "lengthSeconds"
  ];
  for (const k of keys) {
    if (play && play[k] !== undefined && play[k] !== null && play[k] !== "") {
      const v = Number(play[k]);
      if (!Number.isNaN(v)) {
        if (k.toLowerCase().includes("second")) return Math.round(v / 60);
        if (v > 600) return Math.round(v / 60); // parece segundos
        return Math.round(v);
      }
    }
  }
  return null;
}

function getMode(radioName) {
  const x = document.querySelector(`input[name="${radioName}"]:checked`);
  return x ? x.value : "OR";
}

function getSelectedValues(selectEl) {
  return [...selectEl.selectedOptions].map(o => o.value);
}

function getSelectedNumbers(selectEl) {
  return [...selectEl.selectedOptions]
    .map(o => Number(o.value))
    .filter(n => !Number.isNaN(n));
}

function buildFilterOptions() {
  // Anos
  const years = [...new Set((raw.plays || []).map(p => yearOf(p.playDate)).filter(Boolean))].sort();
  const yearSel = el("fYear");
  yearSel.querySelectorAll("option:not(:first-child)").forEach(o => o.remove());
  years.forEach(y => yearSel.append(new Option(y, y)));

  // Locais (multi)
  const locSel = el("fLocation");
  locSel.innerHTML = "";

  // incluir apenas locais que aparecem em plays (pra não lotar)
  const usedLocIds = new Set((raw.plays || [])
    .map(p => p.locationRefId)
    .filter(v => v !== undefined && v !== null && v !== "")
    .map(v => String(v)));

  const locs = [];
  raw.locationsById.forEach((v, k) => {
    if (usedLocIds.has(String(k))) locs.push([k, v?.name || `Local ${k}`]);
  });

  if (!locs.length && usedLocIds.size) {
    [...usedLocIds].sort().forEach(id => locs.push([id, `Local ${id}`]));
  } else {
    locs.sort((a,b) => String(a[1]).localeCompare(String(b[1])));
  }

  locs.forEach(([k, name]) => locSel.append(new Option(name, String(k))));

  // Jogadores (multi)
  const plSel = el("fPlayers");
  plSel.innerHTML = "";
  const players = (raw.players || []).slice()
    .sort((a,b) => (a.name||"").localeCompare(b.name||""));
  players.forEach(p => plSel.append(new Option(p.name || `Player ${p.id}`, String(p.id))));
}

function applyFilters() {
  const locSelected = getSelectedValues(el("fLocation"));  // strings
  const locMode = getMode("locMode"); // OR / AND

  const year = el("fYear").value || null;

  const minT = el("fMinTime").value !== "" ? Number(el("fMinTime").value) : null;
  const maxT = el("fMaxTime").value !== "" ? Number(el("fMaxTime").value) : null;

  const plSelected = getSelectedNumbers(el("fPlayers"));  // numbers
  const plMode = getMode("plMode"); // OR / AND

  filteredPlays = (raw.plays || []).filter(play => {
    // Ano
    if (year && yearOf(play.playDate) !== year) return false;

    // Tempo
    const dur = durationMin(play);
    if (minT !== null && (dur === null || dur < minT)) return false;
    if (maxT !== null && (dur === null || dur > maxT)) return false;

    // Local (OR/AND)
    if (locSelected.length) {
      const locId = String(play.locationRefId ?? "");
      if (locMode === "OR") {
        if (!locSelected.includes(locId)) return false;
      } else { // AND
        // uma partida só pode ter 1 local; AND com 2+ vira impossível
        if (locSelected.length !== 1) return false;
        if (locSelected[0] !== locId) return false;
      }
    }

    // Jogadores (OR/AND)
    if (plSelected.length) {
      const ids = new Set((play.playerScores || []).map(ps => ps.playerRefId));
      if (plMode === "OR") {
        let hasAny = false;
        for (const pid of plSelected) {
          if (ids.has(pid)) { hasAny = true; break; }
        }
        if (!hasAny) return false;
      } else { // AND
        for (const pid of plSelected) {
          if (!ids.has(pid)) return false;
        }
      }
    }

    return true;
  });

  el("status").textContent = `Filtrado: ${filteredPlays.length} / ${raw.plays.length} partidas`;
}

function renderPartidas() {
  destroyTable();

  const rows = filteredPlays.map(p => {
    const players = (p.playerScores || [])
      .map(ps => raw.playersById.get(ps.playerRefId)?.name || `Player ${ps.playerRefId}`)
      .join(", ");

    const winners = (p.playerScores || [])
      .filter(ps => ps.winner)
      .map(ps => raw.playersById.get(ps.playerRefId)?.name || `Player ${ps.playerRefId}`)
      .join(", ");

    return {
      data: toISOish(p.playDate),
      ano: yearOf(p.playDate),
      jogo: raw.gamesById.get(p.gameRefId)?.name || `Game ${p.gameRefId}`,
      local: raw.locationsById.get(p.locationRefId)?.name || (p.locationRefId ?? ""),
      tempo: durationMin(p) ?? "",
      jogadores: players,
      vencedores: winners,
      times: p.usesTeams ? "sim" : "não",
      rating: p.rating ?? ""
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
      { data: "tempo" },
      { data: "jogadores" },
      { data: "vencedores" },
      { data: "times" },
      { data: "rating" },
    ],
    pageLength: 25,
    order: [[0, "desc"]],
  });
}

function renderJogadores() {
  destroyTable();

  // Agregações por jogador (apenas nas plays filtradas)
  const agg = new Map();

  for (const play of filteredPlays) {
    const dur = durationMin(play);
    const gameId = play.gameRefId;

    for (const ps of (play.playerScores || [])) {
      const id = ps.playerRefId;

      if (!agg.has(id)) {
        agg.set(id, {
          jogador: raw.playersById.get(id)?.name || `Player ${id}`,
          partidas: 0,
          vitorias: 0,
          gamesSet: new Set(),
          tempoTotalMin: 0,
        });
      }

      const s = agg.get(id);
      s.partidas += 1;
      if (ps.winner) s.vitorias += 1;

      if (gameId !== undefined && gameId !== null && gameId !== "") s.gamesSet.add(String(gameId));
      if (dur !== null) s.tempoTotalMin += dur;
    }
  }

  const rows = [...agg.values()].map(s => {
    const horas = s.tempoTotalMin / 60;
    return {
      jogador: s.jogador,
      partidas: s.partidas,
      vitorias: s.vitorias,
      winrate: s.partidas ? (100 * s.vitorias / s.partidas).toFixed(1) + "%" : "0%",
      jogos_diferentes: s.gamesSet.size,
      tempo_total_h: horas ? horas.toFixed(1) : "0.0",
    };
  });

  table = new DataTable("#tabela", {
    data: rows,
    columns: [
      { title: "Jogador", data: "jogador" },
      { title: "Partidas", data: "partidas" },
      { title: "Vitórias", data: "vitorias" },
      { title: "Winrate", data: "winrate" },
      { title: "Jogos diferentes", data: "jogos_diferentes" },
      { title: "Tempo total (h)", data: "tempo_total_h" },
    ],
    pageLength: 25,
    order: [[1, "desc"]],
  });
}

function render() {
  applyFilters();
  if (view === "jogadores") renderJogadores();
  else renderPartidas();
}

function wireUI() {
  const btnPartidas = el("btnPartidas");
  const btnJogadores = el("btnJogadores");

  btnPartidas.onclick = () => {
    view = "partidas";
    btnPartidas.classList.add("active");
    btnJogadores.classList.remove("active");
    render();
  };

  btnJogadores.onclick = () => {
    view = "jogadores";
    btnJogadores.classList.add("active");
    btnPartidas.classList.remove("active");
    render();
  };

  // filtros
  ["fLocation", "fYear", "fMinTime", "fMaxTime", "fPlayers"].forEach(id => {
    el(id).addEventListener("change", render);
  });
  el("fMinTime").addEventListener("input", render);
  el("fMaxTime").addEventListener("input", render);

  // toggles OR/AND
  document.querySelectorAll('input[name="locMode"]').forEach(r => r.addEventListener("change", render));
  document.querySelectorAll('input[name="plMode"]').forEach(r => r.addEventListener("change", render));

  el("btnClear").onclick = () => {
    // clear selects
    [...el("fLocation").options].forEach(o => o.selected = false);
    el("fYear").value = "";
    el("fMinTime").value = "";
    el("fMaxTime").value = "";
    [...el("fPlayers").options].forEach(o => o.selected = false);

    // reset modes to OR
    document.querySelector('input[name="locMode"][value="OR"]').checked = true;
    document.querySelector('input[name="plMode"][value="OR"]').checked = true;

    render();
  };
}

async function init() {
  try {
    const res = await fetch(JSON_PATH, { cache: "no-store" });
    if (!res.ok) throw new Error(`Não consegui ler ${JSON_PATH} (HTTP ${res.status})`);

    const j = await res.json();

    raw = {
      plays: j.plays || [],
      players: j.players || [],
      games: j.games || [],
      locations: j.locations || [],
      playersById: indexById(j.players || []),
      gamesById: indexById(j.games || []),
      locationsById: indexById(j.locations || []),
    };

    el("status").textContent = `OK — ${raw.plays.length} partidas`;
    buildFilterOptions();
    wireUI();
    render();

  } catch (e) {
    console.error(e);
    el("status").textContent = `Erro: ${e.message}`;
  }
}

init();
