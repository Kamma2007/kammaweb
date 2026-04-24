import { useEffect, useMemo, useRef, useState } from "react";
import { GameEngine, ROUNDS, cardBackUrl, cardImageUrl, roundLabel, suitLabel } from "./game";

function TrickGrid({ trick, slotRefs }) {
  const slots = [null, null, null, null];
  trick.forEach((t) => {
    slots[t.player] = t.card;
  });
  const posClass = ["pos-bottom", "pos-left", "pos-top", "pos-right"];

  return (
    <div className="trick">
      {slots.map((card, i) => {
        return (
          <div
            key={i}
            ref={(el) => {
              if (!slotRefs?.current) return;
              slotRefs.current[i] = el;
            }}
            className={`trick-cell ${posClass[i]}`}
          >
            {card ? <img className="card-img trick-card" src={cardImageUrl(card)} alt="" /> : <div className="trick-slot" />}
          </div>
        );
      })}
    </div>
  );
}

const HISTORY_KEY = "king_history_v1";
const ONLINE_SESSION_KEY = "king_online_session_v1";

function valueLabel(v) {
  if (v === "J") return "Fante";
  if (v === "Q") return "Donna";
  if (v === "K") return "Re";
  if (v === "A") return "Asso";
  return String(v);
}

function cardLabel(card) {
  return `${valueLabel(card.value)} di ${suitLabel(card.suit)}`;
}

function cardKey(card) {
  return `${card.suit}-${card.value}`;
}

function nextSeatToRight(seat) {
  return (seat + 3) % 4;
}

function LastHandStrip({ trick, winnerName }) {
  if (!trick?.length) return null;
  return (
    <div className="last-hand">
      <div className="last-hand-title">Ultima mano:</div>
      <div className="last-hand-cards">
        {trick.map((t, idx) => (
          <img key={`${idx}-${t.player}-${t.card.suit}-${t.card.value}`} className="last-hand-card" src={cardImageUrl(t.card)} alt={cardLabel(t.card)} />
        ))}
      </div>
      <div className="last-hand-winner">Presa da {winnerName}</div>
    </div>
  );
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MOVE_DURATION_MS = 700;
const BOT_LEVEL_OPTIONS = ["Facile", "Medio", "Difficile", "Pro"];

function PenaltyRack({ cards }) {
  if (!cards?.length) return null;
  return (
    <div className="penalty-rack">
      {cards.map((c, idx) => (
        <img key={`${idx}-${c.suit}-${c.value}`} className="penalty-card" src={cardImageUrl(c)} alt={cardLabel(c)} />
      ))}
    </div>
  );
}

function HistoryOverlay({ history, onClose, onRemoveItem, onClear }) {
  return (
    <div className="overlay">
      <div className="modal">
        <h3>Storico partite</h3>
        <div className="history-list">
          {history.length ? (
            history.map((item) => (
              <div key={item.id} className="history-item">
                <div className="history-top">
                  <div className="history-date">{new Date(item.at).toLocaleString()}</div>
                  <div className="history-total">Totale: {item.totalScore}</div>
                </div>
                <div className="history-scores">
                  {item.players.map((name, idx) => (
                    <div key={`${item.id}-${idx}`} className="history-score">
                      <div className="history-name">{name}</div>
                      <div className="history-value">{item.scores[idx]}</div>
                    </div>
                  ))}
                </div>
                <div className="modal-actions">
                  <button className="btn" onClick={() => onRemoveItem(item.id)}>
                    Rimuovi
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="pill" style={{ display: "inline-block" }}>
              Nessuna partita salvata
            </div>
          )}
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Chiudi
          </button>
          <button className="btn" onClick={onClear} disabled={!history.length}>
            Svuota storico
          </button>
        </div>
      </div>
    </div>
  );
}

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveHistory(items) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(items));
}

function loadOnlineSession() {
  try {
    const raw = localStorage.getItem(ONLINE_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.roomId !== "string" || typeof parsed.sessionToken !== "string") return null;
    return { roomId: parsed.roomId, sessionToken: parsed.sessionToken, name: typeof parsed.name === "string" ? parsed.name : null };
  } catch {
    return null;
  }
}

function saveOnlineSession(session) {
  localStorage.setItem(ONLINE_SESSION_KEY, JSON.stringify(session));
}

function clearOnlineSession() {
  localStorage.removeItem(ONLINE_SESSION_KEY);
}

function DominoTable({ domino }) {
  const order = [
    { suit: "spades", label: "Picche" },
    { suit: "hearts", label: "Cuori" },
    { suit: "clubs", label: "Fiori" },
    { suit: "diamonds", label: "Denari" },
  ];

  return (
    <div className="domino">
      {order.map(({ suit, label }) => {
        const line = domino.table[suit];
        return (
          <div key={suit} className="domino-row">
            <div className="domino-suit">{label}</div>
            <div className="domino-cards">
              {line.cards.length ? (
                line.cards.map((c) => <img key={`${c.suit}-${c.value}`} className="domino-card" src={cardImageUrl(c)} alt="" />)
              ) : (
                <div className="domino-empty">—</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function App() {
  const [screen, setScreen] = useState("menu");
  const [botLevels, setBotLevels] = useState(["Umano", "Medio", "Medio", "Medio"]);
  const game = useMemo(() => new GameEngine(), []);
  const [version, setVersion] = useState(0);
  const forceUpdate = () => setVersion((v) => v + 1);
  const [history, setHistory] = useState(() => loadHistory());
  const [showHistory, setShowHistory] = useState(false);
  const [savedThisGame, setSavedThisGame] = useState(false);
  const [showSoloSetup, setShowSoloSetup] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [soloDealerSeat, setSoloDealerSeat] = useState(1);
  const [showOnlineSetup, setShowOnlineSetup] = useState(false);
  const [onlineTab, setOnlineTab] = useState("quick");
  const [onlineName, setOnlineName] = useState(() => loadOnlineSession()?.name ?? "Giocatore");
  const [onlineJoinCode, setOnlineJoinCode] = useState("");
  const [onlineMaxHumans, setOnlineMaxHumans] = useState(2);
  const [onlineRoom, setOnlineRoom] = useState(null);
  const [onlineError, setOnlineError] = useState(null);
  const [onlineMoveInFlight, setOnlineMoveInFlight] = useState(false);
  const [onlineConnected, setOnlineConnected] = useState(false);
  const [onlineShowResolvedTrick, setOnlineShowResolvedTrick] = useState(false);
  const [onlineSessionToken, setOnlineSessionToken] = useState(() => loadOnlineSession()?.sessionToken ?? null);
  const lastOnlineServerTimeRef = useRef(0);
  const lastOnlineClientTimeRef = useRef(0);
  const [onlineClockTick, setOnlineClockTick] = useState(0);
  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const autoJoinRef = useRef(false);
  const onlineActiveRef = useRef(false);
  const onlineRequestTimeoutRef = useRef(null);
  const pendingOnlinePayloadRef = useRef(null);
  const [collectAnimTick, setCollectAnimTick] = useState(0);
  const [collectTo, setCollectTo] = useState(null);
  const [winnerPulseTo, setWinnerPulseTo] = useState(null);
  const [showResolvedTrick, setShowResolvedTrick] = useState(false);
  const [trickPauseActive, setTrickPauseActive] = useState(false);
  const [moveInFlight, setMoveInFlight] = useState(false);
  const [flyOverlays, setFlyOverlays] = useState([]);
  const timersRef = useRef([]);
  const moveTokenRef = useRef(0);
  const arenaRef = useRef(null);
  const handbarRef = useRef(null);
  const playerAnchorRefs = useRef([null, null, null, null]);
  const trickSlotRefs = useRef([null, null, null, null]);

  const onlineWsUrl = () => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const envUrl = import.meta.env.VITE_WS_URL;
    if (envUrl) {
      const raw = String(envUrl).trim();
      if (location.protocol === "https:" && raw.startsWith("ws://")) return `wss://${raw.slice("ws://".length)}`;
      if (raw.startsWith("http://") || raw.startsWith("https://") || raw.startsWith("ws://") || raw.startsWith("wss://")) {
        try {
          const u = new URL(raw);
          if (u.protocol === "http:") u.protocol = "ws:";
          if (u.protocol === "https:") u.protocol = "wss:";
          if (u.pathname === "/") u.pathname = "/ws";
          return u.toString();
        } catch {
          return raw;
        }
      }
      return raw;
    }
    const isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";
    if (isLocal) return `${proto}://${location.hostname}:8787`;
    return `${proto}://${location.host}/ws`;
  };

  useEffect(() => {
    onlineActiveRef.current = showOnlineSetup || screen === "onlineGame";
  }, [showOnlineSetup, screen]);

  const clearOnlineRequestTimeout = () => {
    if (!onlineRequestTimeoutRef.current) return;
    clearTimeout(onlineRequestTimeoutRef.current);
    onlineRequestTimeoutRef.current = null;
  };

  const armOnlineRequestTimeout = () => {
    clearOnlineRequestTimeout();
    const wsUrl = onlineWsUrl();
    const isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";
    const timeoutMs = isLocal ? 6500 : 70000;
    onlineRequestTimeoutRef.current = setTimeout(() => {
      onlineRequestTimeoutRef.current = null;
      setOnlineMoveInFlight(false);
      setOnlineConnected(false);
      setOnlineError(`Server on line non raggiungibile (WS: ${wsUrl}). Controlla l'indirizzo WS e che il server sia avviato.`);
    }, timeoutMs);
  };

  const closeOnline = () => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    clearOnlineRequestTimeout();
    pendingOnlinePayloadRef.current = null;
    const ws = wsRef.current;
    wsRef.current = null;
    if (ws) ws.close();
    setOnlineRoom(null);
    setOnlineError(null);
    setOnlineMoveInFlight(false);
    setOnlineConnected(false);
    setOnlineSessionToken(null);
    clearOnlineSession();
    setShowOnlineSetup(false);
    if (screen === "onlineGame") setScreen("menu");
  };

  const ensureOnlineSocket = () => {
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) return wsRef.current;
    const ws = new WebSocket(onlineWsUrl());
    wsRef.current = ws;
    ws.onopen = () => {
      setOnlineConnected(true);
      setOnlineError(null);
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      const pending = pendingOnlinePayloadRef.current;
      if (pending) {
        pendingOnlinePayloadRef.current = null;
        try {
          ws.send(JSON.stringify(pending));
        } catch {
          pendingOnlinePayloadRef.current = pending;
        }
        return;
      }
      const session = loadOnlineSession();
      if (session?.roomId && session?.sessionToken && !onlineRoom) ws.send(JSON.stringify({ type: "resume", roomId: session.roomId, sessionToken: session.sessionToken }));
    };
    ws.onmessage = (evt) => {
      let msg;
      try {
        msg = JSON.parse(String(evt.data));
      } catch {
        return;
      }
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "error") {
        clearOnlineRequestTimeout();
        setOnlineMoveInFlight(false);
        setOnlineError(String(msg.message ?? "Errore"));
        return;
      }
      if (msg.type === "state") {
        clearOnlineRequestTimeout();
        setOnlineMoveInFlight(false);
        setOnlineError(null);
        lastOnlineServerTimeRef.current = Number(msg.serverTime ?? Date.now());
        lastOnlineClientTimeRef.current = Date.now();
        if (msg.sessionToken && msg.roomId) {
          saveOnlineSession({ roomId: msg.roomId, sessionToken: msg.sessionToken, name: onlineName });
          setOnlineSessionToken(msg.sessionToken);
        }
        setOnlineRoom({
          roomId: msg.roomId,
          seat: msg.seat,
          mode: msg.mode ?? "invite",
          isHost: Boolean(msg.isHost),
          dealerSeat: typeof msg.dealerSeat === "number" ? msg.dealerSeat : Number(msg.dealerSeat ?? 0),
          maxHumans: msg.maxHumans,
          humans: msg.humans ?? [],
          started: Boolean(msg.started),
          pause: msg.pause ?? null,
          game: msg.game ?? null,
        });
        if (msg.started) {
          setShowOnlineSetup(false);
          setScreen("onlineGame");
        }
        return;
      }
    };
    ws.onerror = () => {
      setOnlineConnected(false);
      setOnlineError("Connessione al server on line non riuscita.");
    };
    ws.onclose = () => {
      wsRef.current = null;
      setOnlineRoom(null);
      setOnlineMoveInFlight(false);
      setOnlineConnected(false);
      const hasPending = Boolean(pendingOnlinePayloadRef.current);
      const session = loadOnlineSession();
      if (!onlineActiveRef.current && !hasPending && (!session?.roomId || !session?.sessionToken)) return;
      if (reconnectTimerRef.current) return;
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        ensureOnlineSocket();
      }, 1500);
    };
    return ws;
  };

  const sendOnline = (payload) => {
    pendingOnlinePayloadRef.current = payload;
    const ws = ensureOnlineSocket();
    if (ws.readyState === WebSocket.OPEN) {
      const data = JSON.stringify(payload);
      pendingOnlinePayloadRef.current = null;
      ws.send(data);
    }
  };

  const onlineNow = () => {
    const base = Number(lastOnlineServerTimeRef.current ?? 0);
    const at = Number(lastOnlineClientTimeRef.current ?? 0);
    if (!base || !at) return Date.now();
    return base + (Date.now() - at);
  };

  useEffect(() => {
    if (screen !== "onlineGame") return;
    if (!onlineRoom?.pause) return;
    const t = setInterval(() => setOnlineClockTick((v) => v + 1), 250);
    return () => clearInterval(t);
  }, [screen, onlineRoom?.pause?.phase, onlineRoom?.pause?.until]);

  const clearTimers = () => {
    timersRef.current.forEach((t) => clearTimeout(t));
    timersRef.current = [];
  };

  const cancelMove = () => {
    moveTokenRef.current += 1;
    setFlyOverlays([]);
    setMoveInFlight(false);
  };

  const cancelAll = () => {
    clearTimers();
    cancelMove();
    setShowResolvedTrick(false);
    setTrickPauseActive(false);
    setCollectTo(null);
    setWinnerPulseTo(null);
  };

  const startSoloGame = () => {
    cancelAll();
    game.setBotLevels(botLevels);
    game.setDealer(soloDealerSeat);
    game.startGame();
    setSavedThisGame(false);
    setShowSoloSetup(false);
    setScreen("game");
    forceUpdate();
  };

  const startOnlineCreate = () => {
    setOnlineError(null);
    setOnlineMoveInFlight(true);
    armOnlineRequestTimeout();
    sendOnline({ type: "create_room", name: onlineName, maxHumans: onlineMaxHumans });
  };

  const startOnlineJoin = () => {
    setOnlineError(null);
    setOnlineMoveInFlight(true);
    armOnlineRequestTimeout();
    const code = onlineJoinCode.trim().toUpperCase();
    const session = loadOnlineSession();
    if (session?.roomId && session?.sessionToken && session.roomId === code) {
      sendOnline({ type: "resume", roomId: session.roomId, sessionToken: session.sessionToken });
      return;
    }
    sendOnline({ type: "join_room", name: onlineName, roomId: code });
  };

  const startOnlineQuick = () => {
    setOnlineError(null);
    setOnlineMoveInFlight(true);
    armOnlineRequestTimeout();
    sendOnline({ type: "quick_play", name: onlineName, maxHumans: onlineMaxHumans });
  };

  const startOnlineMatch = () => {
    setOnlineError(null);
    setOnlineMoveInFlight(true);
    armOnlineRequestTimeout();
    sendOnline({ type: "start_match" });
  };

  const rotateOnlineDealer = () => {
    if (!onlineRoom || onlineRoom.started) return;
    const next = nextSeatToRight(Number(onlineRoom.dealerSeat ?? 0));
    sendOnline({ type: "set_dealer", dealerSeat: next });
  };

  useEffect(() => {
    const code = new URLSearchParams(location.search).get("room");
    if (!code) return;
    if (autoJoinRef.current) return;
    autoJoinRef.current = true;
    setOnlineTab("join");
    setOnlineJoinCode(code);
    setShowOnlineSetup(true);
    setOnlineError(null);
    setOnlineMoveInFlight(true);
    armOnlineRequestTimeout();
    const session = loadOnlineSession();
    if (session?.roomId && session?.sessionToken && session.roomId === String(code).trim().toUpperCase()) {
      sendOnline({ type: "resume", roomId: session.roomId, sessionToken: session.sessionToken });
    } else {
      sendOnline({ type: "join_room", name: onlineName, roomId: code });
    }
  }, [onlineName]);

  const performMove = async ({ playerIndex, card, type }) => {
    if (moveInFlight) return;
    if (game.trick.length === 0) {
      setShowResolvedTrick(false);
      setCollectTo(null);
      setWinnerPulseTo(null);
    }
    moveTokenRef.current += 1;
    const token = moveTokenRef.current;
    setMoveInFlight(true);
    let overlayId = null;
    let readyPromise = null;
    if (type === "play") {
      const src = cardImageUrl(card);
      const img = new Image();
      img.src = src;
      const ready =
        typeof img.decode === "function"
          ? img.decode().catch(() => {})
          : new Promise((resolve) => {
              img.onload = () => resolve();
              img.onerror = () => resolve();
            });

      const arenaEl = arenaRef.current;
      const toEl = trickSlotRefs.current?.[playerIndex];
      const fromEl = playerIndex === 0 ? handbarRef.current : playerAnchorRefs.current?.[playerIndex];

      const fallback = { dx: playerIndex === 1 ? -340 : playerIndex === 3 ? 340 : 0, dy: playerIndex === 0 ? 280 : playerIndex === 2 ? -280 : 0 };
      let overlay = { id: token, src, toX: 0, toY: 0, dx: fallback.dx, dy: fallback.dy, active: false };

      if (arenaEl && toEl && fromEl) {
        const arenaRect = arenaEl.getBoundingClientRect();
        const toRect = toEl.getBoundingClientRect();
        const fromRect = fromEl.getBoundingClientRect();

        const toX = toRect.left + toRect.width / 2 - arenaRect.left;
        const toY = toRect.top + toRect.height / 2 - arenaRect.top;
        const fromX = fromRect.left + fromRect.width / 2 - arenaRect.left;
        const fromY = fromRect.top + fromRect.height / 2 - arenaRect.top;

        overlay = { id: token, src, toX, toY, dx: fromX - toX, dy: fromY - toY, active: false };
      } else {
        if (arenaEl) {
          const arenaRect = arenaEl.getBoundingClientRect();
          overlay = { id: token, src, toX: arenaRect.width / 2, toY: arenaRect.height / 2, dx: fallback.dx, dy: fallback.dy, active: false };
        } else {
          overlay = { id: token, src, toX: 0, toY: 0, dx: fallback.dx, dy: fallback.dy, active: false };
        }
      }

      setFlyOverlays((prev) => [...prev, overlay]);
      overlayId = token;
      readyPromise = ready;
      requestAnimationFrame(() => {
        if (moveTokenRef.current !== token) return;
        setFlyOverlays((prev) => prev.map((o) => (o.id === token ? { ...o, active: true } : o)));
      });
    }

    await sleep(MOVE_DURATION_MS);
    if (moveTokenRef.current !== token) return;

    if (type === "pass") game.playDominoPass(playerIndex);
    if (type === "play") game.playCard(playerIndex, card);
    forceUpdate();
    setMoveInFlight(false);

    if (overlayId && readyPromise) {
      readyPromise.then(() => {
        requestAnimationFrame(() => {
          setFlyOverlays((prev) => prev.filter((o) => o.id !== overlayId));
        });
      });
    }
  };

  useEffect(() => {
    if (screen !== "game") return;
    if (trickPauseActive) return;
    if (moveInFlight) return;
    if (game.trick.length !== 0) return;
    if (showResolvedTrick) setShowResolvedTrick(false);
    if (collectTo !== null) setCollectTo(null);
    if (winnerPulseTo !== null) setWinnerPulseTo(null);
  }, [game, game.trick.length, trickPauseActive, moveInFlight, showResolvedTrick, collectTo, winnerPulseTo]);

  useEffect(() => {
    if (screen !== "game") return;
    if (game.trick.length === 0) return;
    if (showResolvedTrick) setShowResolvedTrick(false);
    if (collectTo !== null) setCollectTo(null);
    if (winnerPulseTo !== null) setWinnerPulseTo(null);
  }, [game, game.trick.length, showResolvedTrick, collectTo, winnerPulseTo]);

  useEffect(() => {
    if (screen !== "game") return;
    if (!game.lastTrickResolvedAt) return;
    if (typeof game.lastTrickWinner !== "number") return;

    clearTimers();
    setCollectTo(null);
    setWinnerPulseTo(null);
    setShowResolvedTrick(true);
    setTrickPauseActive(true);

    const t1 = setTimeout(() => {
      setCollectAnimTick((v) => v + 1);
      setCollectTo(game.lastTrickWinner);
      setWinnerPulseTo(game.lastTrickWinner);
    }, 3000);
    const t2 = setTimeout(() => setShowResolvedTrick(false), 3320);
    const t3 = setTimeout(() => setCollectTo(null), 3360);
    const t4 = setTimeout(() => setWinnerPulseTo(null), 3520);
    const t5 = setTimeout(() => setTrickPauseActive(false), 3520);
    timersRef.current = [t1, t2, t3, t4, t5];
    return () => {
      clearTimers();
    };
  }, [game, game.lastTrickResolvedAt, game.lastTrickWinner, version]);

  const round = game.currentRound;
  const roundIndex = game.currentRoundIndex;
  const isOver = game.isGameOver();
  const p = game.players;

  const mustChooseTrump = round?.startsWith("DECLARATION_") && game.declarationChooser === 0 && !game.trumpSuit;
  const isDomino = round === "DOMINO";
  const humanDominoMoves = isDomino ? game.getDominoValidMoves(0) : [];
  const pendingNextRound = game.pendingNextRound;
  const lastSummary = game.lastRoundSummary;

  useEffect(() => {
    if (screen !== "game") return;
    if (isOver || pendingNextRound || mustChooseTrump || trickPauseActive || moveInFlight) return;
    if (game.currentPlayer === 0) return;
    if (game.currentRound.startsWith("DECLARATION_") && game.declarationChooser === 0 && !game.trumpSuit) return;

    const playerIndex = game.currentPlayer;
    const card = game.pickBotCard(playerIndex);
    if (!card) {
      if (game.currentRound === "DOMINO") performMove({ playerIndex, type: "pass", card: null });
      return;
    }
    performMove({ playerIndex, type: "play", card });
  }, [game, version, isOver, pendingNextRound, mustChooseTrump, trickPauseActive, moveInFlight]);

  const onHumanPlay = (card) => {
    performMove({ playerIndex: 0, type: "play", card });
  };

  const onHumanPass = () => {
    if (!isDomino) return;
    performMove({ playerIndex: 0, type: "pass", card: null });
  };

  const onlineGame = onlineRoom?.game;
  const onlineSeat = typeof onlineRoom?.seat === "number" ? onlineRoom.seat : null;
  const onlineSeatToUi = (seat) => (onlineSeat === null ? seat : (seat - onlineSeat + 4) % 4);
  const onlineUiToSeat = (ui) => (onlineSeat === null ? ui : (ui + onlineSeat) % 4);
  const onlinePlayersUi = onlineGame ? [0, 1, 2, 3].map((ui) => ({ ...onlineGame.players[onlineUiToSeat(ui)], seat: onlineUiToSeat(ui) })) : null;
  const onlineRound = onlineGame?.currentRound ?? null;
  const onlineRoundIndex = onlineGame?.currentRoundIndex ?? 0;
  const onlineIsOver = Boolean(onlineGame?.gameOver);
  const onlineIsDomino = onlineRound === "DOMINO";
  const onlineWaitingTrump = Boolean(onlineRound?.startsWith("DECLARATION_") && !onlineGame?.trumpSuit);
  const onlineMustChooseTrump = Boolean(onlineWaitingTrump && onlineGame?.declarationChooser === onlineSeat);
  const onlineValidSet = useMemo(() => new Set((onlineGame?.yourValidMoves ?? []).map((c) => cardKey(c))), [onlineGame?.yourValidMoves]);

  const onlineForbiddenLeadSuit = () => {
    if (!onlineRound) return null;
    if (onlineRound === "K_HEARTS") return "hearts";
    if (onlineRound === "NO_HEARTS") return "hearts";
    if (onlineRound === "EIGHT_DIAMONDS") return "diamonds";
    if (onlineRound.startsWith("DECLARATION_")) return onlineGame?.trumpSuit ?? null;
    return null;
  };

  const onlineIsSuitBroken = (suit) => {
    if (!suit) return true;
    if (onlineRound === "K_HEARTS") return Boolean(onlineGame?.heartsBroken);
    if (onlineRound === "NO_HEARTS") return Boolean(onlineGame?.heartsBroken);
    if (onlineRound === "EIGHT_DIAMONDS") return Boolean(onlineGame?.diamondsBroken);
    if (onlineRound?.startsWith("DECLARATION_")) return Boolean(onlineGame?.trumpBroken);
    return true;
  };

  useEffect(() => {
    if (screen !== "onlineGame") return;
    if (!onlineGame?.lastTrickResolvedAt) return;
    setOnlineShowResolvedTrick(true);
    const t = setTimeout(() => setOnlineShowResolvedTrick(false), 2000);
    return () => clearTimeout(t);
  }, [screen, onlineGame?.lastTrickResolvedAt]);

  const onlineOnPlay = (card) => {
    if (!onlineGame || onlineMoveInFlight) return;
    if (onlineRoom?.pause) return;
    if (onlineWaitingTrump) return;
    if (onlineGame.currentPlayer !== onlineSeat) return;
    if (!onlineValidSet.has(cardKey(card))) return;
    setOnlineMoveInFlight(true);
    sendOnline({ type: "action", action: { type: "play", card } });
  };

  const onlineOnPass = () => {
    if (!onlineIsDomino) return;
    if (!onlineGame || onlineMoveInFlight) return;
    if (onlineRoom?.pause) return;
    if (onlineWaitingTrump) return;
    if (onlineGame.currentPlayer !== onlineSeat) return;
    setOnlineMoveInFlight(true);
    sendOnline({ type: "action", action: { type: "pass" } });
  };

  const onlineNextRound = () => {
    if (!onlineGame || onlineMoveInFlight) return;
    if (onlineRoom?.pause) return;
    if (!onlineGame.pendingNextRound) return;
    setOnlineMoveInFlight(true);
    sendOnline({ type: "action", action: { type: "next_round" } });
  };

  const onlineChooseTrump = (suit) => {
    if (!onlineGame || onlineMoveInFlight) return;
    if (onlineRoom?.pause) return;
    if (!onlineMustChooseTrump) return;
    setOnlineMoveInFlight(true);
    sendOnline({ type: "action", action: { type: "choose_trump", suit } });
  };

  const restart = () => {
    cancelAll();
    game.setBotLevels(botLevels);
    game.startGame();
    setSavedThisGame(false);
    forceUpdate();
  };

  const nextRound = () => {
    cancelAll();
    const ok = game.continueToNextRound();
    if (!ok) return;
    forceUpdate();
  };

  const forbidden = game.forbiddenLeadSuit();
  const broken = game.isSuitBroken(forbidden);

  const totalScore = p.reduce((sum, pl) => sum + pl.score, 0);

  const saveMatchToHistory = () => {
    if (savedThisGame) return;
    const item = {
      id: `${Date.now()}`,
      at: Date.now(),
      players: p.map((pl) => pl.name),
      scores: p.map((pl) => pl.score),
      totalScore,
      rounds: game.matchHistory ?? [],
    };
    const next = [item, ...history].slice(0, 50);
    setHistory(next);
    saveHistory(next);
    setSavedThisGame(true);
  };

  const removeHistoryItem = (id) => {
    const next = history.filter((x) => x.id !== id);
    setHistory(next);
    saveHistory(next);
  };

  const clearHistory = () => {
    setHistory([]);
    saveHistory([]);
  };

  const pauseUi = trickPauseActive || moveInFlight;
  const canShowResolved = showResolvedTrick && !moveInFlight && game.trick.length === 0;
  const tableTrick = game.trick.length ? game.trick : canShowResolved ? game.lastResolvedTrick ?? [] : [];

  const lastHand = !isDomino ? game.lastResolvedTrick : null;
  const lastHandWinnerName = typeof game.lastTrickWinner === "number" ? p[game.lastTrickWinner]?.name : null;
  const showPenalty = round === "KJ" || round === "Q" || round === "NO_HEARTS";

  let lastActionLabel = null;
  if (isDomino && game.lastAction?.at) {
    const actor = p[game.lastAction.player]?.name ?? `P${game.lastAction.player}`;
    if (game.lastAction.type === "pass") lastActionLabel = `${actor} ha passato`;
    if (game.lastAction.type === "domino_play" && game.lastAction.card) lastActionLabel = `${actor} ha giocato ${cardLabel(game.lastAction.card)}`;
  }

  const onlineLobbyHostName = onlineRoom?.humans?.slice().sort((a, b) => a.seat - b.seat)[0]?.name ?? null;
  const onlineLobbyMissing =
    onlineRoom?.mode === "quick"
      ? Math.max(0, (onlineRoom?.maxHumans ?? 0) - (onlineRoom?.humans?.length ?? 0))
      : Math.max(0, 2 - (onlineRoom?.humans?.length ?? 0));
  const onlineLobbyNameBySeat = (seat) => {
    const found = onlineRoom?.humans?.find((h) => h.seat === seat);
    if (found?.name) return found.name;
    return `Bot${seat + 1}`;
  };

  const onlinePause = onlineRoom?.pause ?? null;
  const onlinePauseNow = onlineNow() + onlineClockTick * 0;
  const onlinePauseSeconds = onlinePause?.until ? Math.max(0, Math.ceil((Number(onlinePause.until) - onlinePauseNow) / 1000)) : 0;
  const onlinePauseText =
    onlinePause?.phase === "waiting"
      ? `${onlinePause?.name ?? "Giocatore"} si è disconnesso`
      : onlinePause?.phase === "resume"
        ? `${onlinePause?.name ?? "Giocatore"} riconnesso`
        : onlinePause?.phase === "kicked"
          ? `${onlinePause?.name ?? "Giocatore"} espulso per time-out`
          : "Partita in pausa";
  const onlineLobbyDealerSeat = Number.isFinite(Number(onlineRoom?.dealerSeat)) ? Number(onlineRoom?.dealerSeat) : 0;
  const onlineLobbyFirstSeat = nextSeatToRight(onlineLobbyDealerSeat);

  return (
    <div className="app-root">
      {screen === "menu" ? (
        <div className="menu-screen">
          <div className="menu-kings">
            <img className="menu-king" src={cardImageUrl({ suit: "spades", value: "K" })} alt="" />
            <img className="menu-king" src={cardImageUrl({ suit: "hearts", value: "K" })} alt="" />
            <img className="menu-king" src={cardImageUrl({ suit: "clubs", value: "K" })} alt="" />
            <img className="menu-king" src={cardImageUrl({ suit: "diamonds", value: "K" })} alt="" />
          </div>
          <div className="menu-panel">
            <div className="menu-title">KING</div>
            <div className="menu-tagline">Il gioco delle 13 mani</div>
            <div className="menu-subtitle">Scegli una modalità</div>
            <div className="menu-actions">
              <button className="btn menu-btn" onClick={() => setShowSoloSetup(true)}>
                Gioca in Solo
              </button>
              <button className="btn menu-btn" onClick={() => setShowHistory(true)}>
                Visualizza storico partite
              </button>
              <button
                className="btn menu-btn"
                onClick={() => {
                  setOnlineError(null);
                  setOnlineTab("quick");
                  setShowOnlineSetup(true);
                }}
              >
                Gioca on line
              </button>
              <button
                className="btn menu-btn"
                onClick={() => {
                  setOnlineError(null);
                  setOnlineTab("create");
                  setShowOnlineSetup(true);
                }}
              >
                Invita amici
              </button>
              <button className="btn menu-btn" onClick={() => setShowRules(true)}>
                Regole
              </button>
            </div>
          </div>

          {showSoloSetup ? (
            <div className="overlay">
              <div className="modal">
                <h3>Gioca in Solo</h3>
                <div className="pill" style={{ display: "inline-block", marginBottom: 10 }}>
                  Mazziere: {game.players[soloDealerSeat]?.name} · Primo di mano: {game.players[nextSeatToRight(soloDealerSeat)]?.name}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, alignItems: "center", justifyItems: "center", marginBottom: 10 }}>
                  <div />
                  <div
                    className="pill"
                    style={{
                      display: "inline-block",
                      borderColor:
                        soloDealerSeat === 2
                          ? "rgba(255,215,0,0.55)"
                          : nextSeatToRight(soloDealerSeat) === 2
                            ? "rgba(0,200,255,0.45)"
                            : undefined,
                    }}
                  >
                    Alto: {game.players[2]?.name}
                  </div>
                  <div />
                  <div
                    className="pill"
                    style={{
                      display: "inline-block",
                      borderColor:
                        soloDealerSeat === 1
                          ? "rgba(255,215,0,0.55)"
                          : nextSeatToRight(soloDealerSeat) === 1
                            ? "rgba(0,200,255,0.45)"
                            : undefined,
                    }}
                  >
                    Sinistra: {game.players[1]?.name}
                  </div>
                  <div className="pill" style={{ display: "inline-block" }}>
                    Tavolo
                  </div>
                  <div
                    className="pill"
                    style={{
                      display: "inline-block",
                      borderColor:
                        soloDealerSeat === 3
                          ? "rgba(255,215,0,0.55)"
                          : nextSeatToRight(soloDealerSeat) === 3
                            ? "rgba(0,200,255,0.45)"
                            : undefined,
                    }}
                  >
                    Destra: {game.players[3]?.name}
                  </div>
                  <div />
                  <div
                    className="pill"
                    style={{
                      display: "inline-block",
                      borderColor:
                        soloDealerSeat === 0
                          ? "rgba(255,215,0,0.55)"
                          : nextSeatToRight(soloDealerSeat) === 0
                            ? "rgba(0,200,255,0.45)"
                            : undefined,
                    }}
                  >
                    Basso: {game.players[0]?.name}
                  </div>
                  <div />
                </div>
                <div className="modal-actions" style={{ justifyContent: "center" }}>
                  <button className="btn" onClick={() => setSoloDealerSeat(nextSeatToRight(soloDealerSeat))}>
                    Ruota mazziere a destra
                  </button>
                </div>
                <div className="score-grid">
                  {[1, 2, 3].map((idx) => (
                    <div key={idx} className="score-row" style={{ gridTemplateColumns: "1fr auto" }}>
                      <div className="score-name">{game.players[idx]?.name ?? `Bot${idx}`}</div>
                      <select
                        className="select"
                        value={botLevels[idx]}
                        onChange={(e) => {
                          const next = [...botLevels];
                          next[idx] = e.target.value;
                          setBotLevels(next);
                        }}
                      >
                        {BOT_LEVEL_OPTIONS.map((lvl) => (
                          <option key={lvl} value={lvl}>
                            {lvl}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
                <div className="modal-actions">
                  <button className="btn" onClick={() => setShowSoloSetup(false)}>
                    Indietro
                  </button>
                  <button className="btn" onClick={startSoloGame}>
                    Inizia
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {showOnlineSetup ? (
            <div className="overlay">
              <div className="modal">
                <h3>Gioca on line</h3>
                <div className="score-grid" style={{ gridTemplateColumns: "1fr" }}>
                  <div className="score-row" style={{ gridTemplateColumns: "1fr auto", alignItems: "center" }}>
                    <div className="score-name">Nome</div>
                    <input className="select" value={onlineName} onChange={(e) => setOnlineName(e.target.value)} />
                  </div>
                  <div className="score-row" style={{ gridTemplateColumns: "1fr auto", alignItems: "center" }}>
                    <div className="score-name">Modalità</div>
                    <div style={{ display: "flex", gap: 10 }}>
                      <button className="btn" onClick={() => setOnlineTab("quick")} disabled={onlineTab === "quick"}>
                        Quick
                      </button>
                      <button className="btn" onClick={() => setOnlineTab("create")} disabled={onlineTab === "create"}>
                        Crea
                      </button>
                      <button className="btn" onClick={() => setOnlineTab("join")} disabled={onlineTab === "join"}>
                        Entra
                      </button>
                    </div>
                  </div>
                </div>

                {onlineRoom && !onlineRoom.started ? (
                  <>
                    <div className="pill" style={{ display: "inline-block", marginTop: 10 }}>
                      {onlineConnected ? "Connesso" : "Connessione…"}
                    </div>
                    <div className="pill" style={{ display: "inline-block", marginTop: 10 }}>
                      {onlineRoom.isHost ? "Sei host" : onlineLobbyHostName ? `Host: ${onlineLobbyHostName}` : "Host: —"}
                    </div>
                    <div className="pill" style={{ display: "inline-block", marginTop: 10 }}>
                      {onlineRoom.mode === "quick"
                        ? `Quick play: avvio automatico con ${onlineRoom.maxHumans} giocatori.`
                        : "Room invito: l'host può avviare quando vuole (min 2 giocatori)."}
                    </div>
                    <div className="pill" style={{ display: "inline-block", marginTop: 10 }}>
                      Room: {onlineRoom.roomId} · {onlineRoom.humans.length}/{onlineRoom.maxHumans} giocatori
                    </div>
                    {onlineLobbyMissing > 0 ? (
                      <div className="pill" style={{ display: "inline-block", marginTop: 10 }}>
                        Mancano {onlineLobbyMissing} {onlineLobbyMissing === 1 ? "giocatore" : "giocatori"}
                      </div>
                    ) : (
                      <div className="pill" style={{ display: "inline-block", marginTop: 10 }}>
                        Lobby completa
                      </div>
                    )}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, alignItems: "center", justifyItems: "center", marginTop: 10 }}>
                      <div />
                      <div
                        className="pill"
                        style={{
                          display: "inline-block",
                          borderColor:
                            onlineUiToSeat(2) === onlineLobbyDealerSeat
                              ? "rgba(255,215,0,0.55)"
                              : onlineUiToSeat(2) === onlineLobbyFirstSeat
                                ? "rgba(0,200,255,0.45)"
                                : undefined,
                        }}
                      >
                        Alto: {onlineLobbyNameBySeat(onlineUiToSeat(2))}
                        {onlineUiToSeat(2) === onlineLobbyDealerSeat ? " (Mazziere)" : onlineUiToSeat(2) === onlineLobbyFirstSeat ? " (Primo)" : ""}
                      </div>
                      <div />
                      <div
                        className="pill"
                        style={{
                          display: "inline-block",
                          borderColor:
                            onlineUiToSeat(1) === onlineLobbyDealerSeat
                              ? "rgba(255,215,0,0.55)"
                              : onlineUiToSeat(1) === onlineLobbyFirstSeat
                                ? "rgba(0,200,255,0.45)"
                                : undefined,
                        }}
                      >
                        Sinistra: {onlineLobbyNameBySeat(onlineUiToSeat(1))}
                        {onlineUiToSeat(1) === onlineLobbyDealerSeat ? " (Mazziere)" : onlineUiToSeat(1) === onlineLobbyFirstSeat ? " (Primo)" : ""}
                      </div>
                      <div className="pill" style={{ display: "inline-block" }}>
                        Tavolo
                      </div>
                      <div
                        className="pill"
                        style={{
                          display: "inline-block",
                          borderColor:
                            onlineUiToSeat(3) === onlineLobbyDealerSeat
                              ? "rgba(255,215,0,0.55)"
                              : onlineUiToSeat(3) === onlineLobbyFirstSeat
                                ? "rgba(0,200,255,0.45)"
                                : undefined,
                        }}
                      >
                        Destra: {onlineLobbyNameBySeat(onlineUiToSeat(3))}
                        {onlineUiToSeat(3) === onlineLobbyDealerSeat ? " (Mazziere)" : onlineUiToSeat(3) === onlineLobbyFirstSeat ? " (Primo)" : ""}
                      </div>
                      <div />
                      <div
                        className="pill"
                        style={{
                          display: "inline-block",
                          borderColor:
                            onlineUiToSeat(0) === onlineLobbyDealerSeat
                              ? "rgba(255,215,0,0.55)"
                              : onlineUiToSeat(0) === onlineLobbyFirstSeat
                                ? "rgba(0,200,255,0.45)"
                                : undefined,
                        }}
                      >
                        Basso: {onlineLobbyNameBySeat(onlineUiToSeat(0))}
                        {onlineUiToSeat(0) === onlineLobbyDealerSeat ? " (Mazziere)" : onlineUiToSeat(0) === onlineLobbyFirstSeat ? " (Primo)" : ""}
                      </div>
                      <div />
                    </div>
                    <div className="pill" style={{ display: "inline-block", marginTop: 10 }}>
                      Link invito: {`${location.origin}?room=${onlineRoom.roomId}`}
                    </div>
                    <div className="history-list" style={{ marginTop: 10 }}>
                      {onlineRoom.humans.map((h) => (
                        <div key={`${h.seat}-${h.name}`} className="history-item">
                          <div className="history-top">
                            <div className="history-date">Posto {h.seat + 1}</div>
                            <div className="history-total">{h.name}{h.connected === false ? " (offline)" : ""}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                ) : onlineTab === "quick" || onlineTab === "create" ? (
                  <div className="score-grid" style={{ gridTemplateColumns: "1fr", marginTop: 10 }}>
                    <div className="score-row" style={{ gridTemplateColumns: "1fr auto", alignItems: "center" }}>
                      <div className="score-name">Giocatori umani</div>
                      <select className="select" value={onlineMaxHumans} onChange={(e) => setOnlineMaxHumans(Number(e.target.value))}>
                        {[2, 3, 4].map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                ) : (
                  <div className="score-grid" style={{ gridTemplateColumns: "1fr", marginTop: 10 }}>
                    <div className="score-row" style={{ gridTemplateColumns: "1fr auto", alignItems: "center" }}>
                      <div className="score-name">Codice room</div>
                      <input className="select" value={onlineJoinCode} onChange={(e) => setOnlineJoinCode(e.target.value)} placeholder="Es. A1B2C3" />
                    </div>
                  </div>
                )}

                {onlineError ? (
                  <div className="pill" style={{ display: "inline-block", marginTop: 10, borderColor: "rgba(255,0,0,0.35)" }}>
                    {onlineError}
                  </div>
                ) : null}

                <div className="modal-actions">
                  <button className="btn" onClick={closeOnline}>
                    Indietro
                  </button>
                  {onlineRoom && !onlineRoom.started ? (
                    <>
                      {onlineRoom.isHost ? (
                        <button className="btn" onClick={rotateOnlineDealer} disabled={onlineMoveInFlight}>
                          Ruota mazziere a destra
                        </button>
                      ) : null}
                      {onlineRoom.isHost ? (
                        <button
                          className="btn"
                          onClick={startOnlineMatch}
                          disabled={
                            onlineMoveInFlight ||
                            onlineRoom.humans.length < 2 ||
                            (onlineRoom.mode === "quick" && onlineRoom.humans.length !== onlineRoom.maxHumans)
                          }
                        >
                          Inizia partita
                        </button>
                      ) : null}
                      <button
                        className="btn"
                        onClick={() => {
                          navigator.clipboard?.writeText?.(`${location.origin}?room=${onlineRoom.roomId}`);
                        }}
                      >
                        Copia link
                      </button>
                      <button
                        className="btn"
                        onClick={() => {
                          navigator.clipboard?.writeText?.(onlineRoom.roomId);
                        }}
                      >
                        Copia codice
                      </button>
                    </>
                  ) : onlineTab === "quick" ? (
                    <button className="btn" onClick={startOnlineQuick}>
                      Quick play
                    </button>
                  ) : onlineTab === "create" ? (
                    <button className="btn" onClick={startOnlineCreate}>
                      Crea room
                    </button>
                  ) : (
                    <button className="btn" onClick={startOnlineJoin} disabled={!onlineJoinCode.trim()}>
                      Entra
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {screen === "game" ? (
        <div className="table">
      <div className="topbar">
        <div className="topbar-left">
          <div className="hand-title">
            Mano {Math.min(roundIndex + 1, ROUNDS.length)}/{ROUNDS.length}
          </div>
          <div className="hand-rule">{roundLabel(round)}</div>
          <div className="chips">
            <div className="chip">Turno: {p[game.currentPlayer]?.name}</div>
            <div className="chip">Mazziere: {p[game.dealer]?.name}</div>
            <div className="chip">Primo: {p[nextSeatToRight(game.dealer)]?.name}</div>
            {game.trumpSuit ? <div className="chip">Briscola: {suitLabel(game.trumpSuit)}</div> : null}
            {forbidden ? <div className="chip">Blocco {suitLabel(forbidden)}: {broken ? "sbloccato" : "attivo"}</div> : null}
            {round === "DOMINO" ? <div className="chip">Primo: 7 di Denari</div> : null}
          </div>
        </div>

        <div className="topbar-center">
          <div className={`turn-indicator ${game.currentPlayer === 0 ? "is-human" : "is-bot"}`}>
            Turno: {p[game.currentPlayer]?.name}
          </div>
          {isDomino ? (lastActionLabel ? <div className="turn-sub">{lastActionLabel}</div> : null) : lastHandWinnerName ? <LastHandStrip trick={lastHand} winnerName={lastHandWinnerName} /> : null}
        </div>

        <div className="topbar-right">
          <div className="pill">Totale punti: {totalScore}</div>
          <div className="pill">
            {p[0].name}: {p[0].score} · {p[1].name}: {p[1].score} · {p[2].name}: {p[2].score} · {p[3].name}: {p[3].score}
          </div>
          <button className="btn" onClick={() => setShowHistory(true)}>
            Storico
          </button>
          <button className="btn" onClick={restart}>
            Nuova partita
          </button>
          <button
            className="btn"
            onClick={() => {
              cancelAll();
              setScreen("menu");
            }}
          >
            Menu
          </button>
        </div>
      </div>

      <div className="arena" ref={arenaRef}>
        <div
          className="player pos-top"
          ref={(el) => {
            playerAnchorRefs.current[2] = el;
          }}
        >
          <div className={`name ${game.currentPlayer === 2 ? "active-player" : ""} ${winnerPulseTo === 2 ? "winner-pulse" : ""}`}>
            {p[2].name} ({p[2].score}){game.currentPlayer === 2 ? " · turno" : ""}
          </div>
          <div className="count">{p[2].hand.length} carte</div>
          <div className="deck-row deck-row-top">
            <img className="card-img" src={cardBackUrl()} alt="" style={{ opacity: 0.85 }} />
            {showPenalty ? <PenaltyRack cards={p[2].penaltyCards} /> : null}
          </div>
        </div>

        <div
          className="player pos-left"
          ref={(el) => {
            playerAnchorRefs.current[1] = el;
          }}
        >
          <div className={`name ${game.currentPlayer === 1 ? "active-player" : ""} ${winnerPulseTo === 1 ? "winner-pulse" : ""}`}>
            {p[1].name} ({p[1].score}){game.currentPlayer === 1 ? " · turno" : ""}
          </div>
          <div className="count">{p[1].hand.length} carte</div>
          <div className="deck-row deck-row-left">
            <img className="card-img" src={cardBackUrl()} alt="" style={{ opacity: 0.85 }} />
            {showPenalty ? <PenaltyRack cards={p[1].penaltyCards} /> : null}
          </div>
        </div>

        <div
          className="player pos-right"
          ref={(el) => {
            playerAnchorRefs.current[3] = el;
          }}
        >
          <div className={`name ${game.currentPlayer === 3 ? "active-player" : ""} ${winnerPulseTo === 3 ? "winner-pulse" : ""}`}>
            {p[3].name} ({p[3].score}){game.currentPlayer === 3 ? " · turno" : ""}
          </div>
          <div className="count">{p[3].hand.length} carte</div>
          <div className="deck-row deck-row-right">
            <img className="card-img" src={cardBackUrl()} alt="" style={{ opacity: 0.85 }} />
            {showPenalty ? <PenaltyRack cards={p[3].penaltyCards} /> : null}
          </div>
        </div>

        <div className="fly-layer">
          {flyOverlays.map((o) => (
            <img
              key={o.id}
              className={`fly-card ${o.active ? "is-active" : ""}`}
              style={{
                left: `${o.toX}px`,
                top: `${o.toY}px`,
                "--dx": `${o.dx}px`,
                "--dy": `${o.dy}px`,
                animationDuration: `${MOVE_DURATION_MS}ms`,
              }}
              src={o.src}
              alt=""
            />
          ))}
        </div>

        <div className="center">
          {isOver ? (
            <div className="modal">
              <h3>Partita finita</h3>
              <div className="pill" style={{ display: "inline-block", marginBottom: 10 }}>
                Totale punti: {totalScore} (deve essere 0)
              </div>
              <div className="score-grid">
                {p.map((pl, idx) => (
                  <div key={idx} className="score-row">
                    <div className="score-name">{pl.name}</div>
                    <div className="score-value">{pl.score}</div>
                  </div>
                ))}
              </div>
              <div className="modal-actions">
                <button className="btn" disabled={savedThisGame} onClick={saveMatchToHistory}>
                  {savedThisGame ? "Salvata" : "Salva partita"}
                </button>
                <button className="btn" onClick={() => setShowHistory(true)}>
                  Apri storico
                </button>
              </div>
            </div>
          ) : (
            <>
              {isDomino && game.domino ? (
                <DominoTable domino={game.domino} />
              ) : (
                <div className={`trick-wrap ${collectTo === null ? "" : `collect to-${collectTo}`}`} key={`collect-${collectAnimTick}`}>
                  <TrickGrid trick={tableTrick} slotRefs={trickSlotRefs} />
                </div>
              )}
            </>
          )}
        </div>

        {!isOver && pendingNextRound && lastSummary ? (
          <div className="overlay">
            <div className="modal">
              <h3>
                Fine mano {lastSummary.roundIndex + 1}/{ROUNDS.length} · {roundLabel(lastSummary.round)}
              </h3>
              <div className="pill" style={{ display: "inline-block" }}>
                Pausa attiva: la prossima mano parte solo con il tuo click.
              </div>
              <div className="score-grid">
                {p.map((pl, idx) => (
                  <div key={idx} className="score-row">
                    <div className="score-name">{pl.name}</div>
                    <div className="score-delta">{lastSummary.deltas[idx] >= 0 ? `+${lastSummary.deltas[idx]}` : `${lastSummary.deltas[idx]}`}</div>
                    <div className="score-value">{pl.score}</div>
                    <div className="score-detail">{lastSummary.details?.[idx] ?? ""}</div>
                  </div>
                ))}
              </div>
              <div className="modal-actions">
                <button className="btn" onClick={nextRound}>
                  Prossima mano
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {mustChooseTrump ? (
          <div className="overlay">
            <div className="modal">
              <h3>Scegli la briscola</h3>
              <div className="suits">
                <button
                  className="suit-btn"
                  onClick={() => {
                    game.setTrumpSuitHuman("hearts");
                    forceUpdate();
                  }}
                >
                  <span>Cuori</span>
                  <span>H</span>
                </button>
                <button
                  className="suit-btn"
                  onClick={() => {
                    game.setTrumpSuitHuman("diamonds");
                    forceUpdate();
                  }}
                >
                  <span>Denari</span>
                  <span>D</span>
                </button>
                <button
                  className="suit-btn"
                  onClick={() => {
                    game.setTrumpSuitHuman("clubs");
                    forceUpdate();
                  }}
                >
                  <span>Fiori</span>
                  <span>C</span>
                </button>
                <button
                  className="suit-btn"
                  onClick={() => {
                    game.setTrumpSuitHuman("spades");
                    forceUpdate();
                  }}
                >
                  <span>Picche</span>
                  <span>S</span>
                </button>
              </div>
            </div>
          </div>
        ) : null}

      </div>

      <div className="handbar" ref={handbarRef}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <div className="pill">
              {p[0].name} ({p[0].score}) · {p[0].hand.length} carte
            </div>
            {showPenalty ? <PenaltyRack cards={p[0].penaltyCards} /> : null}
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {isDomino && game.currentPlayer === 0 && humanDominoMoves.length === 0 && !isOver && !mustChooseTrump ? (
              <button className="btn" onClick={onHumanPass} disabled={pauseUi}>
                Passa
              </button>
            ) : null}
            <div className="pill">{game.currentPlayer === 0 ? "Tocca a te" : "Aspetta il tuo turno"}</div>
          </div>
        </div>
        <div className="hand">
          {p[0].hand.map((c) => {
            const disabled = !game.isValidMove(0, c) || mustChooseTrump || isOver || pendingNextRound || pauseUi;
            return (
              <button key={`${c.suit}-${c.value}`} disabled={disabled} onClick={() => onHumanPlay(c)}>
                <img className="card-img" src={cardImageUrl(c)} alt="" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
      ) : null}

      {screen === "onlineGame" ? (
        onlineGame && onlinePlayersUi ? (
          <div className="table">
          <div className="topbar">
            <div className="topbar-left">
              <div className="hand-title">
                Mano {Math.min(onlineRoundIndex + 1, ROUNDS.length)}/{ROUNDS.length}
              </div>
              <div className="hand-rule">{roundLabel(onlineRound)}</div>
              <div className="chips">
                <div className="chip">Turno: {onlinePlayersUi[onlineSeatToUi(onlineGame.currentPlayer)]?.name}</div>
                <div className="chip">Mazziere: {onlinePlayersUi[onlineSeatToUi(onlineGame.dealer)]?.name}</div>
                <div className="chip">Primo: {onlinePlayersUi[onlineSeatToUi(nextSeatToRight(onlineGame.dealer))]?.name}</div>
                {onlineGame.trumpSuit ? <div className="chip">Briscola: {suitLabel(onlineGame.trumpSuit)}</div> : onlineWaitingTrump ? <div className="chip">Briscola: da scegliere</div> : null}
                {onlineForbiddenLeadSuit() ? (
                  <div className="chip">
                    Blocco {suitLabel(onlineForbiddenLeadSuit())}: {onlineIsSuitBroken(onlineForbiddenLeadSuit()) ? "sbloccato" : "attivo"}
                  </div>
                ) : null}
                {onlineRound === "DOMINO" ? <div className="chip">Primo: 7 di Denari</div> : null}
              </div>
            </div>

            <div className="topbar-center">
              <div className={`turn-indicator ${onlineGame.currentPlayer === onlineSeat ? "is-human" : "is-bot"}`}>
                Turno: {onlinePlayersUi[onlineSeatToUi(onlineGame.currentPlayer)]?.name}
              </div>
              {!onlineIsDomino && typeof onlineGame.lastTrickWinner === "number" && onlineGame.lastResolvedTrick?.length ? (
                <LastHandStrip trick={onlineGame.lastResolvedTrick} winnerName={onlinePlayersUi[onlineSeatToUi(onlineGame.lastTrickWinner)]?.name} />
              ) : null}
            </div>

            <div className="topbar-right">
              <div className="pill">Room: {onlineRoom?.roomId}</div>
              <div className="pill">
                {onlinePlayersUi[0].name}: {onlinePlayersUi[0].score} · {onlinePlayersUi[1].name}: {onlinePlayersUi[1].score} · {onlinePlayersUi[2].name}: {onlinePlayersUi[2].score} · {onlinePlayersUi[3].name}: {onlinePlayersUi[3].score}
              </div>
              <button className="btn" onClick={closeOnline}>
                Esci
              </button>
            </div>
          </div>

          {onlinePause ? (
            <div className="overlay">
              <div className="modal">
                <h3>Partita in pausa</h3>
                <div className="pill" style={{ display: "inline-block" }}>
                  {onlinePauseText}
                </div>
                {onlinePause.phase === "waiting" ? (
                  <div className="pill" style={{ display: "inline-block", marginTop: 10 }}>
                    Rientro entro {onlinePauseSeconds}s
                  </div>
                ) : (
                  <div className="pill" style={{ display: "inline-block", marginTop: 10 }}>
                    Riparte in {onlinePauseSeconds}…
                  </div>
                )}
                {onlinePause.phase === "kicked" && onlinePause.botName ? (
                  <div className="pill" style={{ display: "inline-block", marginTop: 10 }}>
                    Inserito {onlinePause.botName} (Pro)
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="arena">
            <div className="player pos-top">
              <div className={`name ${onlineSeatToUi(onlineGame.currentPlayer) === 2 ? "active-player" : ""}`}>{onlinePlayersUi[2].name} ({onlinePlayersUi[2].score}){onlineSeatToUi(onlineGame.currentPlayer) === 2 ? " · turno" : ""}</div>
              <div className="count">{onlinePlayersUi[2].handCount} carte</div>
              <div className="deck-row deck-row-top">
                <img className="card-img" src={cardBackUrl()} alt="" style={{ opacity: 0.85 }} />
                {onlineRound === "KJ" || onlineRound === "Q" || onlineRound === "NO_HEARTS" ? <PenaltyRack cards={onlinePlayersUi[2].penaltyCards} /> : null}
              </div>
            </div>

            <div className="player pos-left">
              <div className={`name ${onlineSeatToUi(onlineGame.currentPlayer) === 1 ? "active-player" : ""}`}>{onlinePlayersUi[1].name} ({onlinePlayersUi[1].score}){onlineSeatToUi(onlineGame.currentPlayer) === 1 ? " · turno" : ""}</div>
              <div className="count">{onlinePlayersUi[1].handCount} carte</div>
              <div className="deck-row deck-row-left">
                <img className="card-img" src={cardBackUrl()} alt="" style={{ opacity: 0.85 }} />
                {onlineRound === "KJ" || onlineRound === "Q" || onlineRound === "NO_HEARTS" ? <PenaltyRack cards={onlinePlayersUi[1].penaltyCards} /> : null}
              </div>
            </div>

            <div className="player pos-right">
              <div className={`name ${onlineSeatToUi(onlineGame.currentPlayer) === 3 ? "active-player" : ""}`}>{onlinePlayersUi[3].name} ({onlinePlayersUi[3].score}){onlineSeatToUi(onlineGame.currentPlayer) === 3 ? " · turno" : ""}</div>
              <div className="count">{onlinePlayersUi[3].handCount} carte</div>
              <div className="deck-row deck-row-right">
                <img className="card-img" src={cardBackUrl()} alt="" style={{ opacity: 0.85 }} />
                {onlineRound === "KJ" || onlineRound === "Q" || onlineRound === "NO_HEARTS" ? <PenaltyRack cards={onlinePlayersUi[3].penaltyCards} /> : null}
              </div>
            </div>

            <div className="center">
              {onlineIsOver ? (
                <div className="modal">
                  <h3>Partita finita</h3>
                  <div className="score-grid">
                    {onlinePlayersUi.map((pl, idx) => (
                      <div key={idx} className="score-row">
                        <div className="score-name">{pl.name}</div>
                        <div className="score-value">{pl.score}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : onlineIsDomino && onlineGame.domino ? (
                <DominoTable domino={onlineGame.domino} />
              ) : (
                <TrickGrid
                  trick={((onlineShowResolvedTrick && onlineGame.lastResolvedTrick?.length ? onlineGame.lastResolvedTrick : onlineGame.trick) ?? []).map((t) => ({
                    ...t,
                    player: onlineSeatToUi(t.player),
                  }))}
                  slotRefs={null}
                />
              )}
            </div>

            {!onlineIsOver && onlineGame.pendingNextRound && onlineGame.lastRoundSummary ? (
              <div className="overlay">
                <div className="modal">
                  <h3>
                    Fine mano {onlineGame.lastRoundSummary.roundIndex + 1}/{ROUNDS.length} · {roundLabel(onlineGame.lastRoundSummary.round)}
                  </h3>
                  <div className="pill" style={{ display: "inline-block" }}>
                    Pausa attiva: la prossima mano parte solo con il tuo click.
                  </div>
                  <div className="score-grid">
                    {onlinePlayersUi.map((pl, ui) => {
                      const seat = onlineUiToSeat(ui);
                      const d = onlineGame.lastRoundSummary.deltas?.[seat] ?? 0;
                      const v = onlineGame.lastRoundSummary.endScores?.[seat] ?? pl.score;
                      const detail = onlineGame.lastRoundSummary.details?.[seat] ?? "";
                      return (
                        <div key={ui} className="score-row">
                          <div className="score-name">{pl.name}</div>
                          <div className="score-delta">{d >= 0 ? `+${d}` : `${d}`}</div>
                          <div className="score-value">{v}</div>
                          <div className="score-detail">{detail}</div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="modal-actions">
                    <button className="btn" onClick={onlineNextRound} disabled={onlineMoveInFlight}>
                      Prossima mano
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {onlineMustChooseTrump ? (
              <div className="overlay">
                <div className="modal">
                  <h3>Scegli la briscola</h3>
                  <div className="suits">
                    <button className="suit-btn" onClick={() => onlineChooseTrump("hearts")} disabled={onlineMoveInFlight}>
                      <span>Cuori</span>
                      <span>H</span>
                    </button>
                    <button className="suit-btn" onClick={() => onlineChooseTrump("diamonds")} disabled={onlineMoveInFlight}>
                      <span>Denari</span>
                      <span>D</span>
                    </button>
                    <button className="suit-btn" onClick={() => onlineChooseTrump("clubs")} disabled={onlineMoveInFlight}>
                      <span>Fiori</span>
                      <span>C</span>
                    </button>
                    <button className="suit-btn" onClick={() => onlineChooseTrump("spades")} disabled={onlineMoveInFlight}>
                      <span>Picche</span>
                      <span>S</span>
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {onlineWaitingTrump && !onlineMustChooseTrump ? (
              <div className="overlay">
                <div className="modal">
                  <h3>In attesa della briscola</h3>
                  <div className="pill" style={{ display: "inline-block" }}>
                    Sta scegliendo: {onlinePlayersUi[onlineSeatToUi(onlineGame.declarationChooser)]?.name}
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <div className="handbar">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                <div className="pill">
                  {onlinePlayersUi[0].name} ({onlinePlayersUi[0].score}) · {onlineGame.yourHand.length} carte
                </div>
                {onlineRound === "KJ" || onlineRound === "Q" || onlineRound === "NO_HEARTS" ? <PenaltyRack cards={onlinePlayersUi[0].penaltyCards} /> : null}
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                {onlineIsDomino && onlineGame.currentPlayer === onlineSeat && onlineGame.yourValidMoves.length === 0 && !onlineIsOver && !onlineWaitingTrump ? (
                  <button className="btn" onClick={onlineOnPass} disabled={onlineMoveInFlight}>
                    Passa
                  </button>
                ) : null}
                <div className="pill">{onlineGame.currentPlayer === onlineSeat ? "Tocca a te" : "Aspetta il tuo turno"}</div>
              </div>
            </div>
            <div className="hand">
              {onlineGame.yourHand.map((c) => {
                const disabled = !onlineValidSet.has(cardKey(c)) || onlineWaitingTrump || onlineIsOver || onlineGame.pendingNextRound || onlineMoveInFlight || onlineGame.currentPlayer !== onlineSeat;
                return (
                  <button key={`${c.suit}-${c.value}`} disabled={disabled} onClick={() => onlineOnPlay(c)}>
                    <img className="card-img" src={cardImageUrl(c)} alt="" />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        ) : (
          <div className="table">
            <div className="center">
              <div className="modal">
                <h3>Riconnessione…</h3>
                <div className="pill" style={{ display: "inline-block" }}>
                  {onlineConnected ? "Connessione ripristinata, sto sincronizzando…" : "Connessione persa, sto provando a riconnettermi…"}
                </div>
                <div className="modal-actions">
                  <button className="btn" onClick={closeOnline}>
                    Esci
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      ) : null}

      {showRules ? (
        <div className="overlay">
          <div className="modal">
            <h3>🃏 REGOLAMENTO GIOCO DI CARTE “KING”</h3>
            <div className="pill" style={{ display: "inline-block", marginBottom: 10 }}>
              il gioco delle 13 mani
            </div>

            <div className="history-list">
              <div className="history-item">
                <div className="history-top">
                  <div className="history-total">👥 Giocatori</div>
                </div>
                <div className="history-scores" style={{ gridTemplateColumns: "1fr" }}>
                  <div className="pill" style={{ display: "inline-block" }}>
                    Il gioco si svolge con 4 giocatori (con possibilità di inserire Bot).
                  </div>
                  <div className="pill" style={{ display: "inline-block" }}>
                    Modalità disponibili: Tutti contro tutti (1vs1vs1vs1) · A squadre (2vs2)
                  </div>
                  <div className="pill" style={{ display: "inline-block" }}>
                    Si utilizza un mazzo standard da 52 carte (senza jolly).
                  </div>
                </div>
              </div>

              <div className="history-item">
                <div className="history-top">
                  <div className="history-total">🎯 Obiettivo del gioco</div>
                </div>
                <div className="history-scores" style={{ gridTemplateColumns: "1fr" }}>
                  <div className="pill" style={{ display: "inline-block" }}>
                    Il gioco è composto da 13 mani (round) con regole diverse.
                  </div>
                  <div className="pill" style={{ display: "inline-block" }}>
                    L’obiettivo è ottenere il miglior punteggio complessivo.
                  </div>
                  <div className="pill" style={{ display: "inline-block" }}>
                    👉 La somma totale dei punti a fine partita è sempre 0.
                  </div>
                </div>
              </div>

              <div className="history-item">
                <div className="history-top">
                  <div className="history-total">🔄 Struttura del gioco</div>
                </div>
                <div className="history-scores" style={{ gridTemplateColumns: "1fr" }}>
                  <div className="pill" style={{ display: "inline-block" }}>
                    Ogni mano vengono distribuite 13 carte per giocatore.
                  </div>
                  <div className="pill" style={{ display: "inline-block" }}>
                    Si gioca a prese (trick-taking).
                  </div>
                  <div className="pill" style={{ display: "inline-block" }}>
                    Ogni mano ha una regola specifica di punteggio o comportamento.
                  </div>
                </div>
              </div>

              <div className="history-item">
                <div className="history-top">
                  <div className="history-total">🧠 Regole generali delle prese</div>
                </div>
                <div className="history-scores" style={{ gridTemplateColumns: "1fr" }}>
                  <div className="pill" style={{ display: "inline-block" }}>
                    Il primo giocatore apre il seme.
                  </div>
                  <div className="pill" style={{ display: "inline-block" }}>
                    Gli altri devono: seguire il seme se possibile · altrimenti possono giocare qualsiasi carta.
                  </div>
                  <div className="pill" style={{ display: "inline-block" }}>
                    Vince la presa: 👉 la carta più alta del seme iniziale.
                  </div>
                  <div className="pill" style={{ display: "inline-block" }}>
                    Non esiste briscola (salvo nelle mani di dichiarazione).
                  </div>
                </div>
              </div>

              <div className="history-item">
                <div className="history-top">
                  <div className="history-total">🎴 LE 13 MANI</div>
                </div>
                <div className="history-scores" style={{ gridTemplateColumns: "1fr" }}>
                  <div className="pill" style={{ display: "inline-block" }}>
                    1. KJ (Re e Jack) — Ogni Re (K) o Jack (J) preso vale -2 punti · Totale mano: -16 punti
                  </div>
                  <div className="pill" style={{ display: "inline-block" }}>
                    2. Q (Donne) — Ogni Donna (Q) presa vale -3 punti · Totale mano: -12 punti
                  </div>
                  <div className="pill" style={{ display: "inline-block" }}>
                    3. Re di Cuori (K♥) — Non è possibile giocare cuori finché non vengono “rotti” · I cuori si rompono quando: un giocatore non può rispondere al seme oppure ha solo cuori in mano · Chi prende il Re di cuori: 👉 perde -8 punti 👉 la mano termina immediatamente
                  </div>
                  <div className="pill" style={{ display: "inline-block" }}>
                    4. 8 di Denari (8♦) — Non è possibile giocare denari finché non vengono “rotti” · I denari si rompono con le stesse regole dei cuori · Chi prende l’8 di denari: 👉 perde -8 punti 👉 la mano termina immediatamente
                  </div>
                  <div className="pill" style={{ display: "inline-block" }}>
                    5. No Cuori — Ogni carta di cuori presa vale -1 punto · Non è possibile giocare cuori finché non vengono “rotti” · Totale mano: -13 punti
                  </div>
                  <div className="pill" style={{ display: "inline-block" }}>
                    6. Ultime 2 prese — La penultima presa vale -4 punti · L’ultima presa vale -4 punti · Totale mano: -8 punti
                  </div>
                  <div className="pill" style={{ display: "inline-block" }}>
                    7. Mani Negative — Ogni presa vale -1 punto · Totale mano: -13 punti
                  </div>
                  <div className="pill" style={{ display: "inline-block" }}>
                    8. Domino — Modalità speciale (non a prese). Se un giocatore ha almeno 4 estremi (Assi e Re): 👉 le carte vengono mostrate 👉 la mano viene ridistribuita · Inizia il giocatore con il 7 di denari · Si costruiscono 4 file (una per seme) · Si possono giocare altri 7 o carte consecutive (6 o 8, poi 5/9, ecc.) · Se non puoi giocare: 👉 passi · Vince chi finisce le carte · Punteggio: ognuno perde -1 per carta rimasta, il vincitore guadagna la somma · 👉 Totale mano = 0
                  </div>
                  <div className="pill" style={{ display: "inline-block" }}>
                    9–12. Dichiarazioni (4 mani) — Ogni giocatore, a turno, è mazziere · Dopo aver visto le carte, il mazziere: 👉 sceglie il seme di briscola · Non è possibile giocare briscola finché non viene “tagliata” · Si gioca a prese con briscola · Ogni presa vale +1 punto · Totale per mano: +13 punti · Totale 4 mani: +52 punti
                  </div>
                  <div className="pill" style={{ display: "inline-block" }}>
                    13. Mano Positiva — Nessuna restrizione · Nessuna briscola · Ogni presa vale +2 punti · Totale mano: +26 punti
                  </div>
                </div>
              </div>

              <div className="history-item">
                <div className="history-top">
                  <div className="history-total">⚖️ Punteggio finale</div>
                </div>
                <div className="history-scores" style={{ gridTemplateColumns: "1fr" }}>
                  <div className="pill" style={{ display: "inline-block" }}>
                    La somma di tutte le mani è sempre 0.
                  </div>
                  <div className="pill" style={{ display: "inline-block" }}>
                    Vince il giocatore con il punteggio più alto.
                  </div>
                </div>
              </div>

              <div className="history-item">
                <div className="history-top">
                  <div className="history-total">👥 Modalità 2 vs 2</div>
                </div>
                <div className="history-scores" style={{ gridTemplateColumns: "1fr" }}>
                  <div className="pill" style={{ display: "inline-block" }}>
                    I giocatori si dividono in coppie. I punteggi vengono sommati per squadra.
                  </div>
                  <div className="pill" style={{ display: "inline-block" }}>
                    Nelle dichiarazioni: 👉 la scelta viene fatta a turno dalle coppie.
                  </div>
                </div>
              </div>

              <div className="history-item">
                <div className="history-top">
                  <div className="history-total">🏁 Fine partita</div>
                </div>
                <div className="history-scores" style={{ gridTemplateColumns: "1fr" }}>
                  <div className="pill" style={{ display: "inline-block" }}>
                    La partita termina dopo le 13 mani. Vince chi ha il punteggio migliore (o la squadra con più punti).
                  </div>
                </div>
              </div>

              <div className="history-item">
                <div className="history-top">
                  <div className="history-total">🎮 Note</div>
                </div>
                <div className="history-scores" style={{ gridTemplateColumns: "1fr" }}>
                  <div className="pill" style={{ display: "inline-block" }}>
                    Il gioco richiede: memoria delle carte · strategia sulle prese · gestione del rischio nelle mani negative · aggressività nelle mani positive.
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setShowRules(false)}>
                Chiudi
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showHistory ? (
        <HistoryOverlay history={history} onClose={() => setShowHistory(false)} onRemoveItem={removeHistoryItem} onClear={clearHistory} />
      ) : null}
    </div>
  );
}

export default App;
