const JSON_PATH = "data/bgstats.json";

/* =========================
   DEFAULTS FIXOS (SEM PERSISTIR)
   - IDs de locais/jogadores são os VALUES dos <option> (strings)
   - Se deixar arrays vazios, começa "sem filtro" (todos)
========================= */
const DEFAULTS = {
  view: "partidas",     // "partidas" | "jogadores" | "jogos"
  year: "2025",             // ex: "2025" ou "" para todos
  minTime: "",          // ex: "30"
  maxTime: "",          // ex: "180"
  locMode: "OR",        // "OR" ou "AND"
  plMode: "OR",         // "OR" ou "AND"
  locations: ["3", "4"],        // ex: ["1","3"]  (ids de locationRefId)
  players: ["2", "3"],          // ex: ["12","33"] (ids de playerRefId)
};

let raw = null;
let filteredPlays = [];
let table = null;
let view = DEFAULTS.view;

const el = (id) => document.getElementById(id);

/* =========================
   HELPERS
========================= */
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
  return d.toISOString().slice(0,19).replace("T"," ");
}

/* =========================
   DURAÇÃO (BGStats: durationMin)
========================= */
function durationMin(play) {
  if (play && play.durationMin !== undefined && play.durationMin !== null && play.durationMin !== "") {
    const v = Number(play.durationMin);
    if (!Number.isNaN(v)) return Math.round(v);
  }

  const minuteKeys = ["durationMinutes","playTimeMinutes","playTime","length","duration","time"];
  for (const k of minuteKeys) {
    if (play && play[k] !== undefined && play[k] !== null && play[k] !== "") {
      const v = Number(play[k]);
      if (!Number.isNaN(v)) return Math.round(v);
    }
  }

  const secondKeys = ["durationSec","durationSeconds","playTimeSeconds","lengthSeconds"];
  for (const k of secondKeys) {
    if (play && play[k] !== undefined && play[k] !== null && play[k] !== "") {
      const v = Number(play[k]);
      if (!Number.isNaN(v)) return Math.round(v / 60);
    }
  }

  return null;
}

function getMode(radioName) {
  const x = document.querySelector(`input[name="${radioName}"]:checked`);
  return x ? x.value : "OR";
}

function setRadio(name, value) {
  const r = document.querySelector(`input[name="${name}"][value="${value}"]`);
  if (r) r.checked = true;
}

function setMultiSelect(selectEl, values) {
  const set = new Set((values || []).map(String));
  [...selectEl.options].forEach(o => { o.selected = set.has(String(o.value)); });
}

function setActiveTab() {
  const btnPartidas = el("btnPartidas");
  const btnJogadores = el("btnJogadores");
  const btnJogos = el("btnJogos");
  if (!btnJogos) return; // caso ainda não tenha colocado no HTML

  btnPartidas.classList.toggle("active", view === "partidas");
  btnJogadores.classList.toggle("active", view === "jogadores");
  btnJogos.classList.toggle("active", view === "jogos");
}

/* =========================
   FILTROS
========================= */
function buildFilterOptions() {
  // anos
  const years = [...new Set(raw.plays.map(p => yearOf(p.playDate)).filter(Boolean))].sort();
  const yearSel = el("fYear");
  yearSel.querySelectorAll("option:not(:first-child)").forEach(o => o.remove());
  years.forEach(y => yearSel.append(new Option(y, y)));

  // locais
  const locSel = el("fLocation");
  locSel.innerHTML = "";

  const usedLocIds = new Set(
    raw.plays.map(p => p.locationRefId)
      .filter(v => v !== undefined && v !== null && v !== "")
      .map(String)
  );

  const locs = [];
  raw.locationsById.forEach((v, k) => {
    if (usedLocIds.has(String(k))) locs.push([k, v?.name || `Local ${k}`]);
  });

  locs.sort((a,b) => String(a[1]).localeCompare(String(b[1])));
  locs.forEach(([k, name]) => locSel.append(new Option(name, String(k))));

  // jogadores
  const plSel = el("fPlayers");
  plSel.innerHTML = "";
  raw.players
    .slice()
    .sort((a,b) => (a.name||"").localeCompare(b.name||""))
    .forEach(p => plSel.append(new Option(p.name || `Player ${p.id}`, String(p.id))));
}

function applyDefaultsToUI() {
  // view/tab
  view = DEFAULTS.view || "partidas";
  setActiveTab();

  // valores simples
  el("fYear").value = DEFAULTS.year ?? "";
  el("fMinTime").value = DEFAULTS.minTime ?? "";
  el("fMaxTime").value = DEFAULTS.maxTime ?? "";

  // modos
  setRadio("locMode", DEFAULTS.locMode || "OR");
  setRadio("plMode", DEFAULTS.plMode || "OR");

  // multis
  setMultiSelect(el("fLocation"), DEFAULTS.locations || []);
  setMultiSelect(el("fPlayers"), DEFAULTS.players || []);
}

function applyFilters() {
  const locSelected = [...el("fLocation").selectedOptions].map(o => String(o.value));
  const locMode = getMode("locMode");

  const year = el("fYear").value || null;

  const minT = el("fMinTime").value !== "" ? Number(el("fMinTime").value) : null;
  const maxT = el("fMaxTime").value !== "" ? Number(el("fMaxTime").value) : null;

  const plSelected = [...el("fPlayers").selectedOptions].map(o => Number(o.value)).filter(n => !Number.isNaN(n));
  const plMode = getMode("plMode");

  filteredPlays = raw.plays.filter(play => {
    // ano
    if (year && yearOf(play.playDate) !== year) return false;

    // tempo
    const dur = durationMin(play);
    if (minT !== null && (dur === null || dur < minT)) return false;
    if (maxT !== null && (dur === null || dur > maxT)) return false;

    // local
    if (locSelected.length) {
      const locId = String(play.locationRefId ?? "");
      if (locMode === "OR") {
        if (!locSelected.includes(locId)) return false;
      } else {
        // AND com 2+ locais não faz sentido (1 partida = 1 local)
        if (locSelected.length !== 1 || locSelected[0] !== locId) return false;
      }
    }

    // jogadores
    if (plSelected.length) {
      const ids = new Set((play.playerScores || []).map(ps => ps.playerRefId));
      if (plMode === "OR") {
        let ok = false;
        for (const id of plSelected) {
          if (ids.has(id)) { ok = true; break; }
        }
        if (!ok) return false;
      } else {
        for (const id of plSelected) {
          if (!ids.has(id)) return false;
        }
      }
    }

    return true;
  });

  el("status").textContent = `Filtrado: ${filteredPlays.length} / ${raw.plays.length} partidas`;
}

/* =========================
   RENDER – PARTIDAS (SEM RATING)
========================= */
function renderPartidas() {
  destroyTable();

  const rows = filteredPlays.map(p => ({
    data: toISOish(p.playDate),
    ano: yearOf(p.playDate),
    jogo: raw.gamesById.get(p.gameRefId)?.name || `Game ${p.gameRefId}`,
    local: raw.locationsById.get(p.locationRefId)?.name || (p.locationRefId ?? ""),
    tempo: durationMin(p) ?? "",
    jogadores: (p.playerScores||[])
      .map(ps => raw.playersById.get(ps.playerRefId)?.name || `Player ${ps.playerRefId}`)
      .join(", "),
    vencedores: (p.playerScores||[])
      .filter(ps => ps.winner)
      .map(ps => raw.playersById.get(ps.playerRefId)?.name || `Player ${ps.playerRefId}`)
      .join(", "),
  }));

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
    ],
    pageLength: 25,
    order: [[0, "desc"]],
  });
}

/* =========================
   RENDER – JOGADORES (ORDEM FIXA)
========================= */
function renderJogadores() {
  destroyTable();

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
          games: new Set(),
          tempoMin: 0
        });
      }

      const s = agg.get(id);
      s.partidas += 1;
      if (ps.winner) s.vitorias += 1;
      if (gameId != null) s.games.add(String(gameId));
      if (dur != null) s.tempoMin += dur;
    }
  }

  const rows = [...agg.values()].map(s => ({
    jogador: s.jogador,
    partidas: s.partidas,
    jogos_diferentes: s.games.size,
    tempo_total_h: (s.tempoMin / 60).toFixed(1),
    vitorias: s.vitorias,
    winrate: s.partidas ? (100 * s.vitorias / s.partidas).toFixed(1) + "%" : "0%"
  }));

  table = new DataTable("#tabela", {
    data: rows,
    columns: [
      { title: "Jogador", data: "jogador" },
      { title: "Partidas", data: "partidas" },
      { title: "Jogos diferentes", data: "jogos_diferentes" },
      { title: "Tempo total (h)", data: "tempo_total_h" },
      { title: "Vitórias", data: "vitorias" },
      { title: "Winrate", data: "winrate" },
    ],
    pageLength: 25,
    order: [[1, "desc"]],
  });
}

/* =========================
   RENDER – JOGOS (NOVA ABA)
========================= */
function renderJogos() {
  destroyTable();

  const agg = new Map();

  for (const play of filteredPlays) {
    const gameId = play.gameRefId;
    if (gameId == null) continue;

    if (!agg.has(gameId)) {
      agg.set(gameId, {
        jogo: raw.gamesById.get(gameId)?.name || `Game ${gameId}`,
        partidas: 0,
        tempoMin: 0,
        jogadoresUnicos: new Set(),
      });
    }

    const s = agg.get(gameId);
    s.partidas += 1;

    const dur = durationMin(play);
    if (dur != null) s.tempoMin += dur;

    for (const ps of (play.playerScores || [])) {
      if (ps.playerRefId != null) s.jogadoresUnicos.add(String(ps.playerRefId));
    }
  }

  const rows = [...agg.values()].map(s => ({
    jogo: s.jogo,
    partidas: s.partidas,
    tempo_total_h: (s.tempoMin / 60).toFixed(1),
    tempo_medio_min: s.partidas ? (s.tempoMin / s.partidas).toFixed(0) : "0",
    jogadores_unicos: s.jogadoresUnicos.size,
  }));

  table = new DataTable("#tabela", {
    data: rows,
    columns: [
      { title: "Jogo", data: "jogo" },
      { title: "Partidas", data: "partidas" },
      { title: "Tempo total (h)", data: "tempo_total_h" },
      { title: "Tempo médio (min)", data: "tempo_medio_min" },
      { title: "Jogadores únicos", data: "jogadores_unicos" },
    ],
    pageLength: 25,
    order: [[1, "desc"]],
  });
}

/* =========================
   RENDER MASTER
========================= */
function render() {
  applyFilters();
  if (view === "jogadores") renderJogadores();
  else if (view === "jogos") renderJogos();
  else renderPartidas();
}

/* =========================
   UI / INIT
========================= */
function wireUI() {
  const btnPartidas = el("btnPartidas");
  const btnJogadores = el("btnJogadores");
  const btnJogos = el("btnJogos");

  btnPartidas.onclick = () => {
    view = "partidas";
    setActiveTab();
    render();
  };

  btnJogadores.onclick = () => {
    view = "jogadores";
    setActiveTab();
    render();
  };

  btnJogos.onclick = () => {
    view = "jogos";
    setActiveTab();
    render();
  };

  ["fLocation","fYear","fMinTime","fMaxTime","fPlayers"].forEach(id =>
    el(id).addEventListener("change", render)
  );
  el("fMinTime").addEventListener("input", render);
  el("fMaxTime").addEventListener("input", render);

  document.querySelectorAll('input[name="locMode"], input[name="plMode"]').forEach(r =>
    r.addEventListener("change", render)
  );

  el("btnClear").onclick = () => {
    [...el("fLocation").options].forEach(o => o.selected = false);
    el("fYear").value = "";
    el("fMinTime").value = "";
    el("fMaxTime").value = "";
    [...el("fPlayers").options].forEach(o => o.selected = false);

    setRadio("locMode", "OR");
    setRadio("plMode", "OR");

    // NÃO salva nada, apenas limpa nesta sessão
    render();
  };
}

async function init() {
  try {
    const res = await fetch(JSON_PATH, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
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

    // aplica defaults fixos SEM persistir
    applyDefaultsToUI();

    wireUI();
    render();

  } catch (e) {
    console.error(e);
    el("status").textContent = `Erro: ${e.message}`;
  }
}

init();
