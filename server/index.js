import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { GameEngine } from "../src/game.js";

const port = Number(process.env.PORT ?? 8787);
const DISCONNECT_GRACE_MS = 30 * 60 * 1000;
const ROOM_IDLE_TTL_MS = 60 * 60 * 1000;
const SUITS = new Set(["hearts", "diamonds", "clubs", "spades"]);
const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const BOT_MOVE_DELAY_MS = 700;
const BOT_TRICK_PAUSE_MS = 2000;
const RECONNECT_WINDOW_MS = 60 * 1000;
const ALL_DISCONNECT_WINDOW_MS = 15 * 60 * 1000;
const RESUME_COUNTDOWN_MS = 3 * 1000;

function now() {
  return Date.now();
}

function json(ws, payload) {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify(payload));
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".ico") return "image/x-icon";
  if (ext === ".map") return "application/json; charset=utf-8";
  return "application/octet-stream";
}

function roomCode() {
  return crypto.randomBytes(3).toString("hex").toUpperCase();
}

function sessionToken() {
  return crypto.randomBytes(16).toString("hex");
}

function rejoinCode() {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}

function isCard(obj) {
  return obj && typeof obj === "object" && typeof obj.suit === "string" && (typeof obj.value === "string" || typeof obj.value === "number");
}

function mustChooseTrump(engine, humanSeats) {
  if (!engine.currentRound.startsWith("DECLARATION_")) return false;
  if (engine.trumpSuit) return false;
  if (typeof engine.declarationChooser !== "number") return false;
  return humanSeats.has(engine.declarationChooser);
}

function viewState(engine, viewerSeat) {
  const players = engine.players.map((p) => ({
    name: p.name,
    score: p.score,
    handCount: p.hand.length,
    penaltyCards: p.penaltyCards ?? [],
    takenCount: p.taken?.length ?? 0,
  }));

  const yourHand = engine.players[viewerSeat]?.hand ?? [];
  const yourValidMoves =
    engine.currentPlayer !== viewerSeat || engine.roundOver || mustChooseTrump(engine, new Set([viewerSeat]))
      ? []
      : engine.currentRound === "DOMINO"
        ? engine.getDominoValidMoves(viewerSeat)
        : yourHand.filter((c) => engine.isValidMove(viewerSeat, c));

  const domino = engine.domino
    ? {
        table: engine.domino.table,
        starter: engine.domino.starter,
        passesInRow: engine.domino.passesInRow,
        winner: engine.domino.winner,
      }
    : null;

  return {
    players,
    yourHand,
    yourValidMoves,
    currentRoundIndex: engine.currentRoundIndex,
    currentRound: engine.currentRound,
    dealer: engine.dealer,
    currentPlayer: engine.currentPlayer,
    trick: engine.trick,
    leadSuit: engine.leadSuit,
    trickWinners: engine.trickWinners,
    lastResolvedTrick: engine.lastResolvedTrick,
    lastTrickWinner: engine.lastTrickWinner,
    lastTrickResolvedAt: engine.lastTrickResolvedAt,
    lastAction: engine.lastAction,
    heartsBroken: engine.heartsBroken,
    diamondsBroken: engine.diamondsBroken,
    trumpSuit: engine.trumpSuit,
    trumpBroken: engine.trumpBroken,
    declarationChooser: engine.declarationChooser,
    roundOver: engine.roundOver,
    pendingNextRound: engine.pendingNextRound,
    roundStartScores: engine.roundStartScores,
    lastRoundSummary: engine.lastRoundSummary,
    matchHistory: engine.matchHistory,
    gameOver: engine.gameOver,
    domino,
  };
}

function isConnectedHuman(room, seat) {
  if (!room.humanSeats.has(seat)) return false;
  const p = room.players.find((x) => x.seat === seat);
  return Boolean(p?.connected);
}

function stopBotRunner(room) {
  if (room.botTimer) clearTimeout(room.botTimer);
  room.botTimer = null;
  room.botRunning = false;
}

function scheduleBotRunner(room, delayMs = 0) {
  if (!room.started || !room.engine) return;
  if (room.botTimer) return;
  room.botRunning = true;
  room.botTimer = setTimeout(() => {
    room.botTimer = null;
    runBotStep(room);
  }, Math.max(0, delayMs));
}

function runBotStep(room) {
  const engine = room.engine;
  if (!room.started || !engine) {
    stopBotRunner(room);
    return;
  }
  if (room.pause) {
    stopBotRunner(room);
    return;
  }
  if (engine.isGameOver() || engine.roundOver || engine.pendingNextRound) {
    stopBotRunner(room);
    return;
  }

  if (mustChooseTrump(engine, room.humanSeats)) {
    const chooser = engine.declarationChooser;
    if (typeof chooser === "number" && room.humanSeats.has(chooser) && !isConnectedHuman(room, chooser)) {
      engine.trumpSuit = engine.chooseTrumpSuitBot(chooser);
      room.lastActivityAt = now();
      broadcastRoom(room);
      scheduleBotRunner(room, BOT_MOVE_DELAY_MS);
      return;
    }
    stopBotRunner(room);
    return;
  }

  const seat = engine.currentPlayer;
  if (room.humanSeats.has(seat) && isConnectedHuman(room, seat)) {
    stopBotRunner(room);
    return;
  }

  const prevResolvedAt = engine.lastTrickResolvedAt;
  const card = engine.pickBotCard(seat);
  if (!card) {
    if (engine.currentRound === "DOMINO") {
      engine.playDominoPass(seat);
      room.lastActivityAt = now();
      broadcastRoom(room);
      scheduleBotRunner(room, BOT_MOVE_DELAY_MS);
      return;
    }
    stopBotRunner(room);
    return;
  }

  engine.playCard(seat, card);
  room.lastActivityAt = now();
  broadcastRoom(room);

  if (engine.isGameOver() || engine.roundOver || engine.pendingNextRound) {
    stopBotRunner(room);
    return;
  }

  const resolvedNow = Boolean(engine.lastTrickResolvedAt && engine.lastTrickResolvedAt !== prevResolvedAt);
  scheduleBotRunner(room, resolvedNow ? BOT_TRICK_PAUSE_MS : BOT_MOVE_DELAY_MS);
}

function broadcastRoom(room) {
  room.players.forEach((p) => {
    if (!p.ws) return;
    json(p.ws, {
      type: "state",
      roomId: room.id,
      seat: p.seat,
      sessionToken: p.token,
      mode: room.mode,
      isHost: Boolean(room.hostToken && p.token === room.hostToken),
      dealerSeat: room.dealerSeat ?? 0,
      maxHumans: room.maxHumans,
      humans: room.players
        .filter((x) => room.humanSeats.has(x.seat))
        .map((x) => ({ seat: x.seat, name: x.name, connected: Boolean(x.connected) })),
      started: room.started,
      pause: room.pause
        ? {
            phase: room.pause.phase,
            seat: room.pause.seat,
            name: room.pause.name,
            until: room.pause.until,
            botName: room.pause.botName ?? null,
            rejoinCode: room.pause.rejoinCode ?? null,
          }
        : null,
      game: room.engine ? viewState(room.engine, p.seat) : null,
      serverTime: now(),
    });
  });
}

function clearPause(room) {
  if (room.pauseTimer) clearTimeout(room.pauseTimer);
  if (room.kickTimer) clearTimeout(room.kickTimer);
  room.pauseTimer = null;
  room.kickTimer = null;
  room.pause = null;
}

function startResumeCountdown(room, payload) {
  clearPause(room);
  room.pause = payload;
  broadcastRoom(room);
  room.pauseTimer = setTimeout(() => {
    room.pauseTimer = null;
    room.pause = null;
    broadcastRoom(room);
    scheduleBotRunner(room, BOT_MOVE_DELAY_MS);
  }, RESUME_COUNTDOWN_MS);
}

function beginResumeCountdown(room, seat, name) {
  clearPause(room);
  room.pause = { phase: "resume", seat, name, until: now() + RESUME_COUNTDOWN_MS, botName: null, rejoinCode: null };
  room.pauseTimer = setTimeout(() => {
    room.pauseTimer = null;
    room.pause = null;
    broadcastRoom(room);
    scheduleBotRunner(room, BOT_MOVE_DELAY_MS);
  }, RESUME_COUNTDOWN_MS);
}

function kickDisconnectedPlayer(room, seat, name) {
  if (!room.engine) return;
  if (!room.humanSeats.has(seat)) return;
  if (isConnectedHuman(room, seat)) return;
  room.humanSeats.delete(seat);
  const player = room.players.find((p) => p.seat === seat);
  if (player) {
    player.kicked = true;
    player.ws = null;
    player.connected = false;
  }
  const botName = `BotPro${seat + 1}`;
  room.engine.players[seat].name = botName;
  room.engine.botLevels[seat] = "Pro";
  startResumeCountdown(room, { phase: "kicked", seat, name, until: now() + RESUME_COUNTDOWN_MS, botName });
}

function pauseForDisconnect(room, seat, name) {
  if (!room.started || !room.engine) return;
  if (room.pause) return;
  stopBotRunner(room);
  const until = now() + RECONNECT_WINDOW_MS;
  room.pause = { phase: "waiting", seat, name, until, botName: null, rejoinCode: rejoinCode() };
  broadcastRoom(room);
  room.kickTimer = setTimeout(() => {
    room.kickTimer = null;
    if (!room.pause || room.pause.phase !== "waiting") return;
    kickDisconnectedPlayer(room, seat, name);
  }, RECONNECT_WINDOW_MS);
}

function pauseForAllDisconnect(room) {
  if (!room.started || !room.engine) return;
  stopBotRunner(room);
  clearPause(room);
  room.pause = { phase: "waiting_all", seat: null, name: "Tutti i giocatori", until: now() + ALL_DISCONNECT_WINDOW_MS, botName: null, rejoinCode: null };
  broadcastRoom(room);
  room.kickTimer = setTimeout(() => {
    room.kickTimer = null;
    if (!room.pause || room.pause.phase !== "waiting_all") return;
    const connectedHumans = room.players.filter((p) => room.humanSeats.has(p.seat) && p.connected).length;
    if (connectedHumans > 0) return;
    clearPause(room);
    broadcastRoom(room);
  }, ALL_DISCONNECT_WINDOW_MS);
}

function createRoom(maxHumans) {
  let id = roomCode();
  while (rooms.has(id)) id = roomCode();
  return {
    id,
    createdAt: now(),
    maxHumans,
    mode: "invite",
    started: false,
    players: [],
    humanSeats: new Set(),
    engine: null,
    lastActivityAt: now(),
    hostToken: null,
    dealerSeat: 3,
    botRunning: false,
    botTimer: null,
    pause: null,
    kickTimer: null,
    pauseTimer: null,
  };
}

function startMatch(room) {
  if (room.started) return;
  const humans = room.players.filter((p) => room.humanSeats.has(p.seat));
  if (humans.length < 2) return;
  if (room.mode === "quick" && humans.length !== room.maxHumans) return;

  const engine = new GameEngine();
  engine.setDealer(room.dealerSeat ?? 0);
  const names = Array(4).fill(null);
  const botLevels = Array(4).fill("Medio");
  humans.forEach((p) => {
    names[p.seat] = p.name;
    botLevels[p.seat] = "Umano";
  });
  for (let i = 0; i < 4; i++) {
    if (!names[i]) names[i] = `Bot${i + 1}`;
  }

  engine.setPlayerNames(names);
  engine.setBotLevels(botLevels);
  engine.startGame();
  room.engine = engine;
  room.started = true;
  for (const [k, v] of quickQueues.entries()) {
    if (v === room.id) quickQueues.delete(k);
  }
  broadcastRoom(room);
  scheduleBotRunner(room, BOT_MOVE_DELAY_MS);
}

const rooms = new Map();
const clientInfo = new Map();
const quickQueues = new Map();

function cleanupRooms() {
  const t = now();
  for (const [id, room] of rooms.entries()) {
    const activePlayers = room.players.filter((p) => p.connected);
    const allDisconnected = activePlayers.length === 0;
    const idleTooLong = t - (room.lastActivityAt ?? room.createdAt ?? t) > ROOM_IDLE_TTL_MS;
    const allExpired = room.players.every((p) => !p.connected && t - (p.disconnectedAt ?? 0) > DISCONNECT_GRACE_MS);
    if (allDisconnected && (idleTooLong || allExpired)) {
      rooms.delete(id);
      for (const [k, v] of quickQueues.entries()) {
        if (v === id) quickQueues.delete(k);
      }
    }
  }
}

setInterval(cleanupRooms, 30 * 1000).unref();

function attachClientToRoom(ws, room, seat, name, token) {
  const existing = room.players.find((p) => p.seat === seat);
  const entry = existing ?? { ws: null, seat, name, token, connected: false, disconnectedAt: null, kicked: false };
  entry.ws = ws;
  entry.name = name;
  entry.token = token;
  entry.connected = true;
  entry.disconnectedAt = null;
  if (!existing) room.players.push(entry);
  if (!entry.kicked) room.humanSeats.add(seat);
  if (!room.hostToken) room.hostToken = token;
  clientInfo.set(ws, { roomId: room.id, seat, token });
  room.lastActivityAt = now();
  broadcastRoom(room);
  if (room.mode === "quick") startMatch(room);
}

function claimSeat(room) {
  const used = new Set(room.players.map((p) => p.seat));
  const seat = [0, 1, 2, 3].find((s) => !used.has(s));
  return typeof seat === "number" ? seat : null;
}

function dropClient(ws) {
  const info = clientInfo.get(ws);
  if (!info) return;
  const room = rooms.get(info.roomId);
  clientInfo.delete(ws);
  if (!room) return;
  const player = room.players.find((p) => p.seat === info.seat && p.token === info.token);
  if (player && player.ws === ws) {
    player.ws = null;
    player.connected = false;
    player.disconnectedAt = now();
  }
  room.lastActivityAt = now();
  if (!room.started) broadcastRoom(room);
  if (room.started) {
    const connectedHumans = room.players.filter((p) => room.humanSeats.has(p.seat) && p.connected).length;
    if (connectedHumans === 0) {
      pauseForAllDisconnect(room);
      return;
    }
    if (player && !player.kicked && room.humanSeats.has(player.seat) && !room.pause) {
      pauseForDisconnect(room, player.seat, player.name);
      return;
    }
    broadcastRoom(room);
    scheduleBotRunner(room, BOT_MOVE_DELAY_MS);
  }
}

const server = http.createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405);
    res.end();
    return;
  }

  let pathname = "/";
  try {
    pathname = new URL(req.url ?? "/", "http://localhost").pathname;
  } catch {
    res.writeHead(400);
    res.end();
    return;
  }

  if (pathname === "/health") {
    sendJson(res, 200, { ok: true, time: now() });
    return;
  }

  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const resolved = path.normalize(path.join(distDir, requestedPath));
  if (!resolved.startsWith(distDir)) {
    res.writeHead(400);
    res.end();
    return;
  }

  const serve = (filePath, status, cacheSeconds) => {
    const headers = {
      "content-type": contentType(filePath),
      "cache-control": `public, max-age=${cacheSeconds}`,
    };
    res.writeHead(status, headers);
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    fs.createReadStream(filePath).pipe(res);
  };

  fs.stat(resolved, (err, stat) => {
    if (!err && stat.isFile()) {
      const isAsset = pathname.startsWith("/assets/");
      serve(resolved, 200, isAsset ? 31536000 : 0);
      return;
    }
    const indexPath = path.join(distDir, "index.html");
    fs.stat(indexPath, (err2, stat2) => {
      if (err2 || !stat2.isFile()) {
        sendJson(res, 500, { ok: false, error: "dist non trovato. Esegui prima npm run build." });
        return;
      }
      serve(indexPath, 200, 0);
    });
  });
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      json(ws, { type: "error", message: "Formato non valido" });
      return;
    }

    if (!msg || typeof msg !== "object") return;

    if (msg.type === "ping") {
      const info = clientInfo.get(ws);
      if (info) {
        const room = rooms.get(info.roomId);
        if (room) room.lastActivityAt = now();
      }
      json(ws, { type: "pong", at: now() });
      return;
    }

    if (msg.type === "resume") {
      const roomId = typeof msg.roomId === "string" ? msg.roomId.trim().toUpperCase() : "";
      const token = typeof msg.sessionToken === "string" ? msg.sessionToken.trim() : "";
      const room = rooms.get(roomId);
      if (!room || !token) {
        json(ws, { type: "error", message: "Sessione non valida" });
        return;
      }
      const player = room.players.find((p) => p.token === token);
      if (!player) {
        json(ws, { type: "error", message: "Sessione scaduta" });
        return;
      }
      if (player.kicked) {
        json(ws, { type: "error", message: "Sei stato espulso per time-out" });
        return;
      }
      if (player.ws && player.ws !== ws) {
        try {
          player.ws.close();
        } catch {
          // ignore
        }
      }
      if (room.started) {
        if (room.pause?.phase === "waiting" && room.pause.seat === player.seat) {
          beginResumeCountdown(room, player.seat, player.name);
          attachClientToRoom(ws, room, player.seat, player.name, player.token);
        } else if (room.pause?.phase === "waiting_all") {
          beginResumeCountdown(room, player.seat, player.name);
          attachClientToRoom(ws, room, player.seat, player.name, player.token);
        } else {
          attachClientToRoom(ws, room, player.seat, player.name, player.token);
          broadcastRoom(room);
          scheduleBotRunner(room, BOT_MOVE_DELAY_MS);
        }
      } else {
        attachClientToRoom(ws, room, player.seat, player.name, player.token);
      }
      return;
    }

    if (msg.type === "rejoin") {
      const roomId = typeof msg.roomId === "string" ? msg.roomId.trim().toUpperCase() : "";
      const code = typeof msg.rejoinCode === "string" ? msg.rejoinCode.trim().toUpperCase() : "";
      const room = rooms.get(roomId);
      if (!room || !code) {
        json(ws, { type: "error", message: "Codice rientro non valido" });
        return;
      }
      if (!room.pause || room.pause.phase !== "waiting") {
        json(ws, { type: "error", message: "Rientro non disponibile" });
        return;
      }
      if (String(room.pause.rejoinCode ?? "").toUpperCase() !== code) {
        json(ws, { type: "error", message: "Codice rientro errato" });
        return;
      }
      const seat = room.pause.seat;
      const player = room.players.find((p) => p.seat === seat);
      if (!player || player.kicked) {
        json(ws, { type: "error", message: "Giocatore non disponibile" });
        return;
      }
      if (player.ws && player.ws !== ws) {
        try {
          player.ws.close();
        } catch {
          // ignore
        }
      }
      beginResumeCountdown(room, player.seat, player.name);
      attachClientToRoom(ws, room, player.seat, player.name, player.token);
      return;
    }

    if (msg.type === "set_dealer") {
      const info = clientInfo.get(ws);
      if (!info) {
        json(ws, { type: "error", message: "Non sei in una room" });
        return;
      }
      const room = rooms.get(info.roomId);
      if (!room) {
        json(ws, { type: "error", message: "Room non trovata" });
        return;
      }
      if (room.started) {
        json(ws, { type: "error", message: "Partita già iniziata" });
        return;
      }
      if (!room.hostToken || info.token !== room.hostToken) {
        json(ws, { type: "error", message: "Solo l'host può cambiare il mazziere" });
        return;
      }
      const seat = Number(msg.dealerSeat);
      if (!Number.isFinite(seat) || seat < 0 || seat > 3) {
        json(ws, { type: "error", message: "Mazziere non valido" });
        return;
      }
      room.dealerSeat = Math.floor(seat);
      room.lastActivityAt = now();
      broadcastRoom(room);
      return;
    }

    if (msg.type === "start_match") {
      const info = clientInfo.get(ws);
      if (!info) {
        json(ws, { type: "error", message: "Non sei in una room" });
        return;
      }
      const room = rooms.get(info.roomId);
      if (!room) {
        json(ws, { type: "error", message: "Room non trovata" });
        return;
      }
      if (room.started) {
        json(ws, { type: "error", message: "Partita già iniziata" });
        return;
      }
      if (!room.hostToken || info.token !== room.hostToken) {
        json(ws, { type: "error", message: "Solo l'host può iniziare" });
        return;
      }
      const humans = room.players.filter((p) => room.humanSeats.has(p.seat));
      if (humans.length < 2) {
        json(ws, { type: "error", message: "Servono almeno 2 giocatori" });
        return;
      }
      if (room.mode === "quick" && humans.length !== room.maxHumans) {
        json(ws, { type: "error", message: "Quick play: attendi che la lobby sia completa" });
        return;
      }
      room.lastActivityAt = now();
      startMatch(room);
      return;
    }

    if (msg.type === "create_room") {
      const name = typeof msg.name === "string" ? msg.name.trim().slice(0, 16) : "Giocatore";
      const maxHumansRaw = Number(msg.maxHumans ?? 2);
      const maxHumans = Number.isFinite(maxHumansRaw) ? Math.min(4, Math.max(2, Math.floor(maxHumansRaw))) : 2;

      const room = createRoom(maxHumans);
      room.mode = "invite";
      rooms.set(room.id, room);

      const seat = 0;
      const token = sessionToken();
      attachClientToRoom(ws, room, seat, name, token);
      return;
    }

    if (msg.type === "join_room") {
      const roomId = typeof msg.roomId === "string" ? msg.roomId.trim().toUpperCase() : "";
      const room = rooms.get(roomId);
      if (!room) {
        json(ws, { type: "error", message: "Room non trovata" });
        return;
      }
      const joinName = typeof msg.name === "string" ? msg.name.trim().slice(0, 16) : "";
      const session = typeof msg.sessionToken === "string" ? msg.sessionToken.trim() : "";
      if (room.started && session) {
        const player = room.players.find((p) => p.token === session);
        if (player && !player.kicked) {
          if (player.ws && player.ws !== ws) {
            try {
              player.ws.close();
            } catch {
              // ignore
            }
          }
          if (room.started) {
            if (room.pause?.phase === "waiting" && room.pause.seat === player.seat) {
              beginResumeCountdown(room, player.seat, player.name);
              attachClientToRoom(ws, room, player.seat, player.name, player.token);
            } else if (room.pause?.phase === "waiting_all") {
              beginResumeCountdown(room, player.seat, player.name);
              attachClientToRoom(ws, room, player.seat, player.name, player.token);
            } else {
              attachClientToRoom(ws, room, player.seat, player.name, player.token);
              broadcastRoom(room);
              scheduleBotRunner(room, BOT_MOVE_DELAY_MS);
            }
          }
          return;
        }
      }
      if (room.started && joinName) {
        const found = room.players.find((p) => !p.kicked && String(p.name ?? "").trim().toLowerCase() === joinName.toLowerCase());
        if (found) {
          if (found.connected) {
            json(ws, { type: "error", message: "Giocatore già connesso" });
            return;
          }
          if (found.ws && found.ws !== ws) {
            try {
              found.ws.close();
            } catch {
              // ignore
            }
          }
          if (room.pause?.phase === "waiting" && room.pause.seat === found.seat) {
            beginResumeCountdown(room, found.seat, found.name);
            attachClientToRoom(ws, room, found.seat, found.name, found.token);
          } else if (room.pause?.phase === "waiting_all") {
            beginResumeCountdown(room, found.seat, found.name);
            attachClientToRoom(ws, room, found.seat, found.name, found.token);
          } else {
            attachClientToRoom(ws, room, found.seat, found.name, found.token);
            broadcastRoom(room);
            scheduleBotRunner(room, BOT_MOVE_DELAY_MS);
          }
          return;
        }
      }
      if (room.started) {
        json(ws, { type: "error", message: "Partita già iniziata" });
        return;
      }
      const humanCount = room.players.filter((p) => room.humanSeats.has(p.seat)).length;
      if (humanCount >= room.maxHumans) {
        json(ws, { type: "error", message: "Room piena" });
        return;
      }

      const name = joinName || "Giocatore";
      const seat = claimSeat(room);
      if (seat === null) {
        json(ws, { type: "error", message: "Room piena" });
        return;
      }

      const token = sessionToken();
      attachClientToRoom(ws, room, seat, name, token);
      return;
    }

    if (msg.type === "quick_play") {
      const name = typeof msg.name === "string" ? msg.name.trim().slice(0, 16) : "Giocatore";
      const maxHumansRaw = Number(msg.maxHumans ?? 2);
      const maxHumans = Number.isFinite(maxHumansRaw) ? Math.min(4, Math.max(2, Math.floor(maxHumansRaw))) : 2;
      const queuedRoomId = quickQueues.get(maxHumans);
      const queuedRoom = queuedRoomId ? rooms.get(queuedRoomId) : null;
      const room =
        queuedRoom && !queuedRoom.started && queuedRoom.maxHumans === maxHumans && queuedRoom.players.filter((p) => queuedRoom.humanSeats.has(p.seat)).length < maxHumans
          ? queuedRoom
          : createRoom(maxHumans);

      if (!rooms.has(room.id)) rooms.set(room.id, room);
      room.mode = "quick";
      const seat = claimSeat(room);
      if (seat === null) {
        json(ws, { type: "error", message: "Impossibile entrare in quick play" });
        return;
      }

      const token = sessionToken();
      attachClientToRoom(ws, room, seat, name, token);

      if (!room.started) {
        const humans = room.players.filter((p) => room.humanSeats.has(p.seat));
        if (humans.length < maxHumans) quickQueues.set(maxHumans, room.id);
      }
      return;
    }

    if (msg.type === "action") {
      const info = clientInfo.get(ws);
      if (!info) {
        json(ws, { type: "error", message: "Non sei in una room" });
        return;
      }
      const room = rooms.get(info.roomId);
      if (!room || !room.started || !room.engine) {
        json(ws, { type: "error", message: "Partita non pronta" });
        return;
      }
      stopBotRunner(room);
      if (room.pause) {
        json(ws, { type: "error", message: "Partita in pausa: attendi la riconnessione" });
        return;
      }

      const seat = info.seat;
      const engine = room.engine;
      const action = msg.action;
      if (!action || typeof action !== "object") return;
      room.lastActivityAt = now();

      if (action.type === "choose_trump") {
        const suit = typeof action.suit === "string" ? action.suit : "";
        if (!mustChooseTrump(engine, room.humanSeats)) {
          json(ws, { type: "error", message: "Non è il momento di scegliere la briscola" });
          return;
        }
        if (engine.declarationChooser !== seat) {
          json(ws, { type: "error", message: "Non tocca a te scegliere" });
          return;
        }
        if (!SUITS.has(suit)) {
          json(ws, { type: "error", message: "Briscola non valida" });
          return;
        }
        engine.trumpSuit = suit;
        broadcastRoom(room);
        scheduleBotRunner(room, BOT_MOVE_DELAY_MS);
        return;
      }

      if (action.type === "next_round") {
        if (!engine.pendingNextRound) {
          json(ws, { type: "error", message: "Non c'è una mano da avanzare" });
          return;
        }
        engine.continueToNextRound();
        broadcastRoom(room);
        scheduleBotRunner(room, BOT_MOVE_DELAY_MS);
        return;
      }

      if (mustChooseTrump(engine, room.humanSeats)) {
        json(ws, { type: "error", message: "Attendi scelta briscola" });
        return;
      }

      if (action.type === "pass") {
        const ok = engine.playDominoPass(seat);
        if (!ok) {
          json(ws, { type: "error", message: "Passata non valida" });
          return;
        }
        broadcastRoom(room);
        scheduleBotRunner(room, BOT_MOVE_DELAY_MS);
        return;
      }

      if (action.type === "play") {
        const card = action.card;
        if (!isCard(card)) {
          json(ws, { type: "error", message: "Carta non valida" });
          return;
        }
        const ok = engine.playCard(seat, card);
        if (!ok) {
          json(ws, { type: "error", message: "Mossa non valida" });
          return;
        }
        broadcastRoom(room);
        scheduleBotRunner(room, BOT_MOVE_DELAY_MS);
        return;
      }
    }
  });

  ws.on("close", () => dropClient(ws));
  ws.on("error", () => dropClient(ws));
});

server.listen(port, () => {
  process.stdout.write(`KING server ws://localhost:${port}\n`);
});
