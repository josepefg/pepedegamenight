const JSON_PATH = "data/bgstats.json";

/* =========================
   DEFAULTS FIXOS (SEM PERSISTIR)
========================= */
const DEFAULTS = {
  view: "jogadores",     // "partidas" | "jogadores" | "jogos" | "jogo_jogador"
  year: "",
  minTime: "",
  maxTime: "",
  locMode: "OR",
  plMode: "OR",
  locations: ["2", "6"],
  players: ["2", "3"],
  includeCoop: true,     // ✅ novo: inclui jogos coop por padrão nas estatísticas por jogo
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

function pct(v) {
  return (Number.isFinite(v) ? (v * 100).toFixed(1) + "%" : "0.0%");
}

function safeNamePlayer(id) {
  return raw.playersById.get(id)?.name || `Player ${id}`;
}

function safeNameGame(gameId) {
  return raw.gamesById.get(gameId)?.name || `Game ${gameId}`;
}

/* ✅ identifica coop via campo "isCoop" no array games */
function isCoopGame(gameId) {
  const g = raw.gamesById.get(gameId);
  return !!(g && g.isCoop);
}

/* =========================
   FILTROS (globais)
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
  view = DEFAULTS.view || "partidas";
  setActiveTab();

  el("fYear").value = DEFAULTS.year ?? "";
  el("fMinTime").value = DEFAULTS.minTime ?? "";
  el("fMaxTime").value = DEFAULTS.maxTime ?? "";

  setRadio("locMode", DEFAULTS.locMode || "OR");
  setRadio("plMode", DEFAULTS.plMode || "OR");

  setMultiSelect(el("fLocation"), DEFAULTS.locations || []);
  setMultiSelect(el("fPlayers"), DEFAULTS.players || []);

  // checkbox coop (se existir no HTML)
  const coopEl = el("fIncludeCoop");
  if (coopEl) coopEl.checked = !!DEFAULTS.includeCoop;
}

function applyFilters() {
  const locSelected = [...el("fLocation").selectedOptions].map(o => String(o.value));
  const locMode = getMode("locMode");

  const year = el("fYear").value || null;

  const minT = el("fMinTime").value !== "" ? Number(el("fMinTime").value) : null;
  const maxT = el("fMaxTime").value !== "" ? Number(el("fMaxTime").value) : null;

  const plSelected = [...el("fPlayers").selectedOptions]
    .map(o => Number(o.value))
    .filter(n => !Number.isNaN(n));
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
   PARTIDAS (sem rating)
========================= */
function renderPartidas() {
  destroyTable();

  const rows = filteredPlays.map(p => ({
    data: toISOish(p.playDate),
    ano: yearOf(p.playDate),
    jogo: safeNameGame(p.gameRefId),
    local: raw.locationsById.get(p.locationRefId)?.name || (p.locationRefId ?? ""),
    tempo: durationMin(p) ?? "",
    jogadores: (p.playerScores||[])
      .map(ps => safeNamePlayer(ps.playerRefId))
      .join(", "),
    vencedores: (p.playerScores||[])
      .filter(ps => ps.winner)
      .map(ps => safeNamePlayer(ps.playerRefId))
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
   JOGADORES (global)
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
          jogador: safeNamePlayer(id),
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
   AGREGADOR POR JOGO
   (✅ aplica filtro coop aqui, só para estatísticas por jogo)
========================= */
function aggregateByGame() {
  const includeCoop = el("fIncludeCoop") ? el("fIncludeCoop").checked : true;

  // gameId -> { jogo, partidas, tempoMin, jogadoresUnicos:Set, perPlayer: Map(playerId -> {partidas,vitorias,tempoMin}) }
  const agg = new Map();

  for (const play of filteredPlays) {
    const gameId = play.gameRefId;
    if (gameId == null) continue;

    if (!includeCoop && isCoopGame(gameId)) continue; // ✅ aqui

    if (!agg.has(gameId)) {
      agg.set(gameId, {
        gameId,
        jogo: safeNameGame(gameId),
        partidas: 0,
        tempoMin: 0,
        jogadoresUnicos: new Set(),
        perPlayer: new Map(),
      });
    }

    const g = agg.get(gameId);
    g.partidas += 1;

    const dur = durationMin(play);
    if (dur != null) g.tempoMin += dur;

    for (const ps of (play.playerScores || [])) {
      const pid = ps.playerRefId;
      if (pid == null) continue;

      g.jogadoresUnicos.add(String(pid));

      if (!g.perPlayer.has(pid)) {
        g.perPlayer.set(pid, { playerId: pid, partidas: 0, vitorias: 0, tempoMin: 0 });
      }
      const pp = g.perPlayer.get(pid);
      pp.partidas += 1;
      if (ps.winner) pp.vitorias += 1;
      if (dur != null) pp.tempoMin += dur; // tempo do jogo contado para quem participou
    }
  }

  return agg;
}

function buildGameDetailsHTML(gameAgg) {
  const players = [...gameAgg.perPlayer.values()].map(pp => ({
    jogador: safeNamePlayer(pp.playerId),
    partidas: pp.partidas,
    vitorias: pp.vitorias,
    winrate: pp.partidas ? (pp.vitorias / pp.partidas) : 0,
    tempo_h: (pp.tempoMin / 60),
    tempo_med_min: pp.partidas ? (pp.tempoMin / pp.partidas) : 0,
  }));

  players.sort((a,b) => (b.vitorias - a.vitorias) || (b.winrate - a.winrate) || (b.partidas - a.partidas));

  const rows = players.map(p => `
    <tr>
      <td>${p.jogador}</td>
      <td style="text-align:right">${p.partidas}</td>
      <td style="text-align:right">${p.vitorias}</td>
      <td style="text-align:right">${pct(p.winrate)}</td>
      <td style="text-align:right">${p.tempo_h.toFixed(1)}</td>
      <td style="text-align:right">${p.tempo_med_min.toFixed(0)}</td>
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
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

/* =========================
   JOGOS (resumo + clique p/ detalhes)
========================= */
function renderJogos() {
  destroyTable();

  const agg = aggregateByGame();

  const rows = [...agg.values()].map(g => {
    // top vencedor
    let best = null;
    for (const pp of g.perPlayer.values()) {
      const winrate = pp.partidas ? (pp.vitorias / pp.partidas) : 0;
      const cand = { ...pp, winrate };
      if (!best) best = cand;
      else {
        const a = cand, b = best;
        if (
          (a.vitorias > b.vitorias) ||
          (a.vitorias === b.vitorias && a.winrate > b.winrate) ||
          (a.vitorias === b.vitorias && a.winrate === b.winrate && a.partidas > b.partidas)
        ) best = cand;
      }
    }

    return {
      gameId: g.gameId,
      jogo: g.jogo,
      partidas: g.partidas,
      tempo_total_h: (g.tempoMin / 60).toFixed(1),
      tempo_medio_min: g.partidas ? (g.tempoMin / g.partidas).toFixed(0) : "0",
      jogadores_unicos: g.jogadoresUnicos.size,
      top_vencedor: best ? safeNamePlayer(best.playerId) : "",
      top_vitorias: best ? best.vitorias : 0,
      top_winrate: best ? pct(best.winrate) : "0.0%",
      _details: g,
    };
  });

  table = new DataTable("#tabela", {
    data: rows,
    columns: [
      { title: "Jogo", data: "jogo" },
      { title: "Partidas", data: "partidas" },
      { title: "Tempo total (h)", data: "tempo_total_h" },
      { title: "Tempo médio (min)", data: "tempo_medio_min" },
      { title: "Jogadores únicos", data: "jogadores_unicos" },
      { title: "Top vencedor", data: "top_vencedor" },
      { title: "Vitórias (top)", data: "top_vitorias" },
      { title: "Winrate (top)", data: "top_winrate" },
    ],
    pageLength: 25,
    order: [[1, "desc"]],
  });

  // expand
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
   JOGO x JOGADOR (filtrável)
========================= */
function renderJogoJogador() {
  destroyTable();

  const agg = aggregateByGame();
  const rows = [];

  for (const g of agg.values()) {
    for (const pp of g.perPlayer.values()) {
      const wr = pp.partidas ? (pp.vitorias / pp.partidas) : 0;
      rows.push({
        jogo: g.jogo,
        jogador: safeNamePlayer(pp.playerId),
        partidas: pp.partidas,
        vitorias: pp.vitorias,
        winrate: pct(wr),
        tempo_total_h: (pp.tempoMin / 60).toFixed(1),
        tempo_medio_min: pp.partidas ? (pp.tempoMin / pp.partidas).toFixed(0) : "0",
      });
    }
  }

  table = new DataTable("#tabela", {
    data: rows,
    columns: [
      { title: "Jogo", data: "jogo" },
      { title: "Jogador", data: "jogador" },
      { title: "Partidas", data: "partidas" },
      { title: "Vitórias", data: "vitorias" },
      { title: "Winrate", data: "winrate" },
      { title: "Tempo total (h)", data: "tempo_total_h" },
      { title: "Tempo médio (min)", data: "tempo_medio_min" },
    ],
    pageLength: 25,
    order: [[2, "desc"]],
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
  const btnPartidas = el("btnPartidas");
  const btnJogadores = el("btnJogadores");
  const btnJogos = el("btnJogos");
  const btnJogoJogador = el("btnJogoJogador");

  btnPartidas.onclick = () => { view = "partidas"; setActiveTab(); render(); };
  btnJogadores.onclick = () => { view = "jogadores"; setActiveTab(); render(); };
  btnJogos.onclick = () => { view = "jogos"; setActiveTab(); render(); };
  btnJogoJogador.onclick = () => { view = "jogo_jogador"; setActiveTab(); render(); };

  ["fLocation","fYear","fMinTime","fMaxTime","fPlayers"].forEach(id =>
    el(id).addEventListener("change", render)
  );
  el("fMinTime").addEventListener("input", render);
  el("fMaxTime").addEventListener("input", render);

  document.querySelectorAll('input[name="locMode"], input[name="plMode"]').forEach(r =>
    r.addEventListener("change", render)
  );

  // ✅ checkbox coop (se existir no HTML)
  const coopEl = el("fIncludeCoop");
  if (coopEl) coopEl.addEventListener("change", render);

  el("btnClear").onclick = () => {
    [...el("fLocation").options].forEach(o => o.selected = false);
    el("fYear").value = "";
    el("fMinTime").value = "";
    el("fMaxTime").value = "";
    [...el("fPlayers").options].forEach(o => o.selected = false);
    setRadio("locMode", "OR");
    setRadio("plMode", "OR");
    if (coopEl) coopEl.checked = true;
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
    applyDefaultsToUI();
    wireUI();
    render();

  } catch (e) {
    console.error(e);
    el("status").textContent = `Erro: ${e.message}`;
  }
}

init();
