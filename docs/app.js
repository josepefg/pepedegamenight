const JSON_PATH = "data/bgstats.json";

/* =========================
   DEFAULTS FIXOS (SEM PERSISTIR)
========================= */
const DEFAULTS = {
  view: "jogadores",
  year: "2026",
  plMode: "OR",
  locations: ["2", "6"],
  players: ["2", "3"],
  includeCompetitive: true,
  includeCoop: true,
  minPlays: "",
};

let raw = null;
let filteredPlays = [];        // com TODOS os filtros (inclui tipo de jogo)
let baseFilteredPlays = [];    // filtros neutros (ano/local/jogadores), SEM tipo de jogo
let table = null;
let view = DEFAULTS.view;

const el = (id) => document.getElementById(id);
const sid = (v) => (v === undefined || v === null) ? "" : String(v);

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

function indexByIdString(arr) {
  const m = new Map();
  (arr || []).forEach(o => {
    if (!o) return;
    const k = sid(o.id);
    if (k) m.set(k, o);
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

function durationMin(play) {
  if (play?.durationMin != null && play.durationMin !== "") {
    const v = Number(play.durationMin);
    if (!Number.isNaN(v)) return Math.round(v);
  }
  return null;
}

function pct(v) {
  return (Number.isFinite(v) ? (v * 100).toFixed(1) + "%" : "0.0%");
}

function safeNamePlayer(id) {
  const k = sid(id);
  return raw.playersById.get(k)?.name || `Player ${k}`;
}

function safeNameGame(id) {
  const k = sid(id);
  return raw.gamesById.get(k)?.name || `Game ${k}`;
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
  const map = {
    partidas: "btnPartidas",
    jogadores: "btnJogadores",
    jogos: "btnJogos",
    jogo_jogador: "btnJogoJogador",
  };

  Object.values(map).forEach(id => {
    const b = document.getElementById(id);
    if (b) b.classList.remove("active");
  });

  const activeId = map[view] || "btnPartidas";
  const activeBtn = document.getElementById(activeId);
  if (activeBtn) activeBtn.classList.add("active");
}

/* =========================
   COOPERATIVOS
========================= */
function isCoopGame(gameId) {
  const g = raw.gamesById.get(sid(gameId));
  const v = g?.cooperative;
  if (v === true) return true;
  if (typeof v === "string") return ["true", "1", "yes", "sim"].includes(v.toLowerCase());
  if (typeof v === "number") return v === 1;
  return false;
}

/* =========================
   FILTROS / OPTIONS
========================= */
function buildFilterOptions() {
  const years = [...new Set(raw.plays.map(p => yearOf(p.playDate)).filter(Boolean))].sort();
  const yearSel = el("fYear");
  yearSel.querySelectorAll("option:not(:first-child)").forEach(o => o.remove());
  years.forEach(y => yearSel.append(new Option(y, y)));

  const locSel = el("fLocation");
  locSel.innerHTML = "";

  const usedLocIds = new Set(raw.plays.map(p => sid(p.locationRefId)).filter(v => v !== ""));
  const locs = [];
  raw.locationsById.forEach((v, k) => {
    if (usedLocIds.has(k)) locs.push([k, v?.name || `Local ${k}`]);
  });

  locs.sort((a,b) => String(a[1]).localeCompare(String(b[1])));
  locs.forEach(([k, name]) => locSel.append(new Option(name, String(k))));

  const plSel = el("fPlayers");
  plSel.innerHTML = "";
  raw.players
    .slice()
    .sort((a,b) => (a.name || "").localeCompare(b.name || ""))
    .forEach(p => plSel.append(new Option(p.name || `Player ${p.id}`, sid(p.id))));
}

function applyDefaultsToUI() {
  view = DEFAULTS.view || "partidas";
  setActiveTab();

  el("fYear").value = DEFAULTS.year ?? "";

  setRadio("plMode", DEFAULTS.plMode || "OR");

  setMultiSelect(el("fLocation"), DEFAULTS.locations || []);
  setMultiSelect(el("fPlayers"), DEFAULTS.players || []);

  el("fIncludeCompetitive").checked = !!DEFAULTS.includeCompetitive;
  el("fIncludeCoop").checked = !!DEFAULTS.includeCoop;

  el("fMinPlays").value = DEFAULTS.minPlays ?? "";
}

function getMinPlays() {
  const v = el("fMinPlays").value;
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : null;
}

/* =========================
   FILTRO NEUTRO (sem tipo de jogo)
   - Local: sempre OU
========================= */
function passesNeutralFilters(play) {
  const year = el("fYear").value || null;

  const locSelected = [...el("fLocation").selectedOptions].map(o => sid(o.value));

  const plSelected = [...el("fPlayers").selectedOptions].map(o => sid(o.value));
  const plMode = document.querySelector('input[name="plMode"]:checked')?.value || "OR";

  if (year && yearOf(play.playDate) !== year) return false;

  // Local: SEMPRE OU
  if (locSelected.length) {
    const locId = sid(play.locationRefId);
    if (!locSelected.includes(locId)) return false;
  }

  if (plSelected.length) {
    const ids = new Set((play.playerScores || []).map(ps => sid(ps.playerRefId)));
    if (plMode === "OR") {
      if (![...plSelected].some(id => ids.has(id))) return false;
    } else {
      if (![...plSelected].every(id => ids.has(id))) return false;
    }
  }

  return true;
}

/* =========================
   APLICA FILTROS (gera baseFilteredPlays e filteredPlays)
========================= */
function applyFilters() {
  const includeCompetitive = el("fIncludeCompetitive").checked;
  const includeCoop = el("fIncludeCoop").checked;

  baseFilteredPlays = raw.plays.filter(passesNeutralFilters);

  filteredPlays = baseFilteredPlays.filter(play => {
    const coop = isCoopGame(play.gameRefId);
    if (coop && !includeCoop) return false;
    if (!coop && !includeCompetitive) return false;
    return true;
  });

  el("status").textContent = `Filtrado: ${filteredPlays.length} / ${raw.plays.length} partidas`;
}

/* =========================
   AGREGADORES
========================= */
function aggregatePlayersTotalsFromPlays(plays) {
  const totals = new Map();
  for (const play of plays) {
    for (const ps of play.playerScores || []) {
      const pid = sid(ps.playerRefId);
      totals.set(pid, (totals.get(pid) || 0) + 1);
    }
  }
  return totals;
}

function aggregateByGame() {
  const agg = new Map();

  for (const play of filteredPlays) {
    const gid = sid(play.gameRefId);
    if (!agg.has(gid)) {
      agg.set(gid, {
        gameId: gid,
        jogo: safeNameGame(gid),
        partidas: 0,
        tempo: 0,
        jogadores: new Set(),
        perPlayer: new Map(),
      });
    }

    const g = agg.get(gid);
    g.partidas++;
    const dur = durationMin(play);
    if (dur != null) g.tempo += dur;

    for (const ps of play.playerScores || []) {
      const pid = sid(ps.playerRefId);
      g.jogadores.add(pid);
      if (!g.perPlayer.has(pid)) g.perPlayer.set(pid, { partidas: 0, vitorias: 0, tempo: 0 });
      const pp = g.perPlayer.get(pid);
      pp.partidas++;
      if (ps.winner) pp.vitorias++;
      if (dur != null) pp.tempo += dur;
    }
  }

  return agg;
}

/* =========================
   PARTIDAS
========================= */
function renderPartidas() {
  destroyTable();

  const rows = filteredPlays.map(p => ({
    data: toISOish(p.playDate),
    ano: yearOf(p.playDate),
    jogo: safeNameGame(p.gameRefId),
    local: raw.locationsById.get(sid(p.locationRefId))?.name || "",
    tempo: durationMin(p) ?? "",
    jogadores: (p.playerScores || []).map(ps => safeNamePlayer(ps.playerRefId)).join(", "),
    vencedores: (p.playerScores || []).filter(ps => ps.winner).map(ps => safeNamePlayer(ps.playerRefId)).join(", "),
  }));

  table = new DataTable("#tabela", {
    data: rows,
    columns: [
      { title: "Data", data: "data" },
      { title: "Ano", data: "ano" },
      { title: "Jogo", data: "jogo" },
      { title: "Local", data: "local" },
      { title: "Tempo (min)", data: "tempo" },
      { title: "Jogadores", data: "jogadores" },
      { title: "Vencedores", data: "vencedores" },
    ],
    order: [[0, "desc"]],
    pageLength: 25,
  });
}

/* =========================
   JOGADORES
========================= */
function renderJogadores() {
  destroyTable();

  const minPlays = getMinPlays();

  const totalsByPlayer = aggregatePlayersTotalsFromPlays(baseFilteredPlays);

  const agg = new Map();

  for (const play of filteredPlays) {
    const dur = durationMin(play);
    const gameId = sid(play.gameRefId);

    for (const ps of play.playerScores || []) {
      const pid = sid(ps.playerRefId);
      if (!agg.has(pid)) {
        agg.set(pid, { jogador: safeNamePlayer(pid), partidas: 0, vitorias: 0, games: new Set(), tempo: 0 });
      }
      const s = agg.get(pid);
      s.partidas++;
      if (ps.winner) s.vitorias++;
      s.games.add(gameId);
      if (dur != null) s.tempo += dur;
    }
  }

  let rows = [...totalsByPlayer.keys()].map(pid => {
    const stats = agg.get(pid) || { jogador: safeNamePlayer(pid), partidas: 0, vitorias: 0, games: new Set(), tempo: 0 };
    const total = totalsByPlayer.get(pid) || 0;

    return {
      jogador: stats.jogador,
      partidas_total: total,
      partidas_filtrado: stats.partidas,
      jogos_diferentes: stats.games.size,
      tempo_total_h: (stats.tempo / 60).toFixed(1),
      vitorias: stats.vitorias,
      winrate: stats.partidas ? pct(stats.vitorias / stats.partidas) : "0%",
    };
  });

  if (minPlays != null) rows = rows.filter(r => r.partidas_total >= minPlays);

  table = new DataTable("#tabela", {
    data: rows,
    columns: [
      { title: "Jogador", data: "jogador" },
      { title: "Partidas total", data: "partidas_total" },
      { title: "Partidas (filtrado)", data: "partidas_filtrado" },
      { title: "Jogos diferentes", data: "jogos_diferentes" },
      { title: "Tempo total (h)", data: "tempo_total_h" },
      { title: "Vitórias", data: "vitorias" },
      { title: "Winrate", data: "winrate" },
    ],
    order: [[1, "desc"]],
    pageLength: 25,
  });
}

/* =========================
   JOGOS
========================= */
function buildGameDetailsHTML(gameAgg) {
  const minPlays = getMinPlays();

  let rows = [];
  for (const [pid, s] of gameAgg.perPlayer.entries()) {
    if (minPlays != null && s.partidas < minPlays) continue;

    rows.push({
      jogador: safeNamePlayer(pid),
      partidas: s.partidas,
      vitorias: s.vitorias,
      winrate: s.partidas ? pct(s.vitorias / s.partidas) : "0%",
      tempo_h: (s.tempo / 60).toFixed(1),
      tempo_med_min: s.partidas ? (s.tempo / s.partidas).toFixed(0) : "0",
    });
  }

  rows.sort((a,b) => (b.vitorias - a.vitorias) || (b.partidas - a.partidas));

  const body = rows.map(r => `
    <tr>
      <td>${r.jogador}</td>
      <td style="text-align:right">${r.partidas}</td>
      <td style="text-align:right">${r.vitorias}</td>
      <td style="text-align:right">${r.winrate}</td>
      <td style="text-align:right">${r.tempo_h}</td>
      <td style="text-align:right">${r.tempo_med_min}</td>
    </tr>
  `).join("");

  return `
    <div style="padding:10px 14px">
      <div style="margin-bottom:8px; opacity:.9">
        <b>Detalhes por jogador</b> — clique novamente para fechar
      </div>
      <table style="width:100%; border-collapse:collapse">
        <thead>
          <tr>
            <th style="text-align:left">Jogador</th>
            <th style="text-align:right">Partidas</th>
            <th style="text-align:right">Vitórias</th>
            <th style="text-align:right">Winrate</th>
            <th style="text-align:right">Tempo (h)</th>
            <th style="text-align:right">Tempo médio (min)</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  `;
}

function renderJogos() {
  destroyTable();

  const minPlays = getMinPlays();
  const agg = aggregateByGame();

  let rows = [...agg.values()].map(g => {
    let best = null;
    for (const [pid, s] of g.perPlayer.entries()) {
      const wr = s.partidas ? (s.vitorias / s.partidas) : 0;
      if (!best || s.vitorias > best.vitorias || (s.vitorias === best.vitorias && wr > best.wr)) {
        best = { pid, ...s, wr };
      }
    }

    return {
      jogo: g.jogo,
      partidas: g.partidas,
      tempo_total_h: (g.tempo / 60).toFixed(1),
      jogadores_unicos: g.jogadores.size,
      top_vencedor: best ? safeNamePlayer(best.pid) : "",
      top_vitorias: best ? best.vitorias : 0,
      top_winrate: best ? pct(best.wr) : "0%",
      _details: g,
    };
  });

  if (minPlays != null) rows = rows.filter(r => r.partidas >= minPlays);

  table = new DataTable("#tabela", {
    data: rows,
    columns: [
      { title: "Jogo", data: "jogo" },
      { title: "Partidas", data: "partidas" },
      { title: "Tempo total (h)", data: "tempo_total_h" },
      { title: "Jogadores únicos", data: "jogadores_unicos" },
      { title: "Top vencedor", data: "top_vencedor" },
      { title: "Vitórias (top)", data: "top_vitorias" },
      { title: "Winrate (top)", data: "top_winrate" },
    ],
    order: [[1, "desc"]],
    pageLength: 25,
  });

  window.jQuery("#tabela tbody").off("click").on("click", "tr", function () {
    const row = table.row(this);
    if (!row) return;

    if (row.child.isShown()) {
      row.child.hide();
      window.jQuery(this).removeClass("shown");
      return;
    }

    const data = row.data();
    row.child(buildGameDetailsHTML(data._details)).show();
    window.jQuery(this).addClass("shown");
  });
}

/* =========================
   JOGO x JOGADOR
========================= */
function renderJogoJogador() {
  destroyTable();

  const minPlays = getMinPlays();
  const totalsByPlayer = aggregatePlayersTotalsFromPlays(baseFilteredPlays);
  const agg = aggregateByGame();

  let rows = [];

  for (const g of agg.values()) {
    for (const [pid, s] of g.perPlayer.entries()) {
      const total = totalsByPlayer.get(pid) || 0;
      if (minPlays != null && total < minPlays) continue;

      const wr = s.partidas ? (s.vitorias / s.partidas) : 0;
      rows.push({
        jogo: g.jogo,
        jogador: safeNamePlayer(pid),
        partidas_no_jogo: s.partidas,
        vitorias_no_jogo: s.vitorias,
        winrate_no_jogo: s.partidas ? pct(wr) : "0%",
        partidas_total_jogador: total,
        tempo_total_h_no_jogo: (s.tempo / 60).toFixed(1),
        tempo_medio_min_no_jogo: s.partidas ? (s.tempo / s.partidas).toFixed(0) : "0",
      });
    }
  }

  table = new DataTable("#tabela", {
    data: rows,
    columns: [
      { title: "Jogo", data: "jogo" },
      { title: "Jogador", data: "jogador" },
      { title: "Partidas no jogo", data: "partidas_no_jogo" },
      { title: "Vitórias no jogo", data: "vitorias_no_jogo" },
      { title: "Winrate no jogo", data: "winrate_no_jogo" },
      { title: "Partidas total (jogador)", data: "partidas_total_jogador" },
      { title: "Tempo total (h) no jogo", data: "tempo_total_h_no_jogo" },
      { title: "Tempo médio (min) no jogo", data: "tempo_medio_min_no_jogo" },
    ],
    order: [[5, "desc"]],
    pageLength: 25,
  });
}

/* =========================
   RENDER MASTER
========================= */
function render() {
  applyFilters();
  if (view === "jogadores") renderJogadores();
  else if (view === "jogos") renderJogos();
  else if (view === "jogo_jogador") renderJogoJogador();
  else renderPartidas();
}

/* =========================
   UI / INIT
========================= */
function wireUI() {
  el("btnPartidas").onclick = () => { view = "partidas"; setActiveTab(); render(); };
  el("btnJogadores").onclick = () => { view = "jogadores"; setActiveTab(); render(); };
  el("btnJogos").onclick = () => { view = "jogos"; setActiveTab(); render(); };
  el("btnJogoJogador").onclick = () => { view = "jogo_jogador"; setActiveTab(); render(); };

  ["fLocation","fYear","fPlayers","fIncludeCompetitive","fIncludeCoop","fMinPlays"].forEach(id => {
    el(id).addEventListener("change", render);
  });

  document.querySelectorAll('input[name="plMode"]').forEach(r =>
    r.addEventListener("change", render)
  );

  el("btnClear").onclick = () => {
    [...el("fLocation").options].forEach(o => o.selected = false);
    el("fYear").value = "";
    [...el("fPlayers").options].forEach(o => o.selected = false);

    setRadio("plMode", "OR");

    el("fIncludeCompetitive").checked = true;
    el("fIncludeCoop").checked = true;

    el("fMinPlays").value = "";

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
      playersById: indexByIdString(j.players || []),
      gamesById: indexByIdString(j.games || []),
      locationsById: indexByIdString(j.locations || []),
    };

    el("status").textContent = `OK — ${raw.plays.length} partidas`;
    buildFilterOptions();
    applyDefaultsToUI();
    wireUI();
    render();
  } catch (e) {
    console.error(e);
    el("status").textContent = `Erro: ${e.message}`;
  }
}

init();

