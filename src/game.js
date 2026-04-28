const SUITS = ["hearts", "diamonds", "clubs", "spades"];
const VALUES = [2, 3, 4, 5, 6, 7, 8, 9, 10, "J", "Q", "K", "A"];

export const ROUNDS = [
  "KJ",
  "Q",
  "K_HEARTS",
  "EIGHT_DIAMONDS",
  "NO_HEARTS",
  "LAST_TWO",
  "NEGATIVE_TRICKS",
  "DOMINO",
  "DECLARATION_1",
  "DECLARATION_2",
  "DECLARATION_3",
  "DECLARATION_4",
  "POSITIVE_TRICKS",
];

export function roundLabel(round) {
  if (round === "KJ") return "KJ: -2 per Re/Jack presi";
  if (round === "Q") return "Q: -3 per Donna presa";
  if (round === "K_HEARTS") return "Re di Cuori: -8, mano finisce subito";
  if (round === "EIGHT_DIAMONDS") return "8 di Denari: -8, mano finisce subito";
  if (round === "NO_HEARTS") return "No Cuori: -1 per Cuore preso";
  if (round === "LAST_TWO") return "Ultime 2: -4 penultima e ultima presa";
  if (round === "NEGATIVE_TRICKS") return "Mani negative: -1 per presa";
  if (round === "DOMINO") return "Domino: chiude per primo, totale mano = 0";
  if (round.startsWith("DECLARATION_")) return "Dichiarazioni: briscola +1 per presa";
  if (round === "POSITIVE_TRICKS") return "Mano positiva: +2 per presa";
  return round;
}

export function suitLabel(suit) {
  if (suit === "hearts") return "Cuori";
  if (suit === "diamonds") return "Denari";
  if (suit === "clubs") return "Fiori";
  if (suit === "spades") return "Picche";
  return suit;
}

function suitCode(suit) {
  if (suit === "spades") return "S";
  if (suit === "hearts") return "H";
  if (suit === "diamonds") return "D";
  return "C";
}

function valueCode(value) {
  if (value === 10) return "0";
  return String(value);
}

export function cardImageUrl(card) {
  return `https://deckofcardsapi.com/static/img/${valueCode(card.value)}${suitCode(card.suit)}.png`;
}

export function cardBackUrl() {
  return "https://deckofcardsapi.com/static/img/back.png";
}

function cardId(card) {
  return `${card.suit}-${card.value}`;
}

function cardRank(value) {
  const map = { J: 11, Q: 12, K: 13, A: 14 };
  return map[value] ?? value;
}

function dominoRank(value) {
  const map = { A: 1, J: 11, Q: 12, K: 13 };
  return map[value] ?? value;
}

function cloneCard(card) {
  return { suit: card.suit, value: card.value };
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function sortHand(hand) {
  const suitOrder = { clubs: 0, diamonds: 1, hearts: 2, spades: 3 };
  hand.sort((a, b) => {
    if (a.suit !== b.suit) return suitOrder[a.suit] - suitOrder[b.suit];
    return cardRank(a.value) - cardRank(b.value);
  });
}

function nextSeatClockwise(seat) {
  return (seat + 1) % 4;
}

function seatToRight(seat) {
  return (seat + 3) % 4;
}

export class GameEngine {
  constructor(options = {}) {
    this.players = [
      { name: "Tu", hand: [], score: 0, taken: [], lastTrickWins: [], penaltyCards: [] },
      { name: "Bot1", hand: [], score: 0, taken: [], lastTrickWins: [], penaltyCards: [] },
      { name: "Bot2", hand: [], score: 0, taken: [], lastTrickWins: [], penaltyCards: [] },
      { name: "Bot3", hand: [], score: 0, taken: [], lastTrickWins: [], penaltyCards: [] },
    ];

    this.botLevels = options.botLevels ?? ["Umano", "Medio", "Medio", "Medio"];

    this.currentRoundIndex = 0;
    this.dealer = Number.isInteger(options.dealer) ? ((options.dealer % 4) + 4) % 4 : 0;

    this.currentPlayer = 0;
    this.trick = [];
    this.leadSuit = null;
    this.trickWinners = [];
    this.lastResolvedTrick = null;
    this.lastTrickWinner = null;
    this.lastTrickResolvedAt = null;
    this.lastAction = null;

    this.heartsBroken = false;
    this.diamondsBroken = false;

    this.trumpSuit = null;
    this.trumpBroken = false;
    this.declarationChooser = null;

    this.roundOver = false;
    this.pendingNextRound = false;
    this.roundStartScores = [0, 0, 0, 0];
    this.lastRoundSummary = null;
    this.matchHistory = [];
    this.gameOver = false;

    this.domino = null;
    this.seenCards = new Set();
    this.knownVoidByPlayer = this.players.map(() => ({ hearts: false, diamonds: false, clubs: false, spades: false }));
  }

  setPlayerNames(names) {
    if (!Array.isArray(names) || names.length !== 4) return false;
    names.forEach((name, idx) => {
      if (typeof name !== "string") return;
      const trimmed = name.trim();
      if (!trimmed) return;
      if (!this.players[idx]) return;
      this.players[idx].name = trimmed.slice(0, 16);
    });
    return true;
  }

  setDealer(seat) {
    if (!Number.isInteger(seat)) return false;
    const v = ((seat % 4) + 4) % 4;
    this.dealer = v;
    return true;
  }

  setBotLevels(levels) {
    if (!Array.isArray(levels) || levels.length !== 4) return false;
    this.botLevels = [...levels];
    return true;
  }

  resetRoundMemory() {
    this.seenCards = new Set();
    this.knownVoidByPlayer = this.players.map(() => ({ hearts: false, diamonds: false, clubs: false, spades: false }));
  }

  rememberCard(card) {
    this.seenCards.add(cardId(card));
  }

  markSuitVoid(playerIndex, suit) {
    if (!Number.isInteger(playerIndex)) return;
    if (!SUITS.includes(suit)) return;
    if (!this.knownVoidByPlayer[playerIndex]) return;
    this.knownVoidByPlayer[playerIndex][suit] = true;
  }

  get currentRound() {
    return ROUNDS[this.currentRoundIndex];
  }

  startGame() {
    this.players.forEach((p) => {
      p.score = 0;
      p.hand = [];
      p.taken = [];
      p.lastTrickWins = [];
    });
    this.currentRoundIndex = 0;
    this.gameOver = false;
    this.pendingNextRound = false;
    this.lastRoundSummary = null;
    this.matchHistory = [];
    this.startRound();
  }

  startRound() {
    this.roundOver = false;
    this.pendingNextRound = false;
    this.trick = [];
    this.leadSuit = null;
    this.trickWinners = [];
    this.lastResolvedTrick = null;
    this.lastTrickWinner = null;
    this.lastTrickResolvedAt = null;
    this.lastAction = null;
    this.heartsBroken = false;
    this.diamondsBroken = false;
    this.trumpSuit = null;
    this.trumpBroken = false;
    this.declarationChooser = null;
    this.domino = null;
    this.resetRoundMemory();

    this.players.forEach((p) => {
      p.taken = [];
      p.lastTrickWins = [];
      p.hand = [];
      p.penaltyCards = [];
    });

    if (this.currentRound === "DOMINO") {
      this.startDominoRound();
      this.roundStartScores = this.players.map((pl) => pl.score);
      return;
    }

    this.deck = this.createDeck();
    this.shuffle(this.deck);
    this.deal();
    this.players.forEach((p) => sortHand(p.hand));

    const first = nextSeatClockwise(this.dealer);
    this.currentPlayer = first;

    if (this.currentRound.startsWith("DECLARATION_")) {
      const chooser = this.dealer;
      this.declarationChooser = chooser;
      if (this.botLevels?.[chooser] !== "Umano") {
        this.trumpSuit = this.chooseTrumpSuitBot(chooser);
      }
    }

    this.roundStartScores = this.players.map((pl) => pl.score);
  }

  startDominoRound() {
    let tries = 0;
    while (tries < 20) {
      this.deck = this.createDeck();
      this.shuffle(this.deck);
      this.deal();
      this.players.forEach((p) => sortHand(p.hand));

      const hasFourExtremes = this.players.some((p) => {
        const extremes = p.hand.filter((c) => c.value === "A" || c.value === "K").length;
        return extremes >= 4;
      });

      if (!hasFourExtremes) break;
      tries++;
    }

    const sevenD = this.players.findIndex((p) => p.hand.some((c) => c.suit === "diamonds" && c.value === 7));
    const starter = sevenD === -1 ? 0 : sevenD;

    const starterCard = { suit: "diamonds", value: 7 };
    this.removeCardFromHand(starter, starterCard);

    this.domino = {
      table: {
        hearts: { min: 7, max: 7, cards: [] },
        diamonds: { min: 7, max: 7, cards: [starterCard] },
        clubs: { min: 7, max: 7, cards: [] },
        spades: { min: 7, max: 7, cards: [] },
      },
      placed: {
        hearts: new Set(),
        diamonds: new Set([7]),
        clubs: new Set(),
        spades: new Set(),
      },
      starter,
      passesInRow: 0,
      winner: null,
    };

    this.currentPlayer = nextSeatClockwise(starter);
  }

  createDeck() {
    const deck = [];
    SUITS.forEach((suit) => VALUES.forEach((value) => deck.push({ suit, value })));
    return deck;
  }

  shuffle(deck) {
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
  }

  deal() {
    this.players.forEach((p) => (p.hand = []));
    this.deck.forEach((c, i) => {
      this.players[i % 4].hand.push(cloneCard(c));
    });
  }

  removeCardFromHand(playerIndex, card) {
    const player = this.players[playerIndex];
    const id = cardId(card);
    const idx = player.hand.findIndex((c) => cardId(c) === id);
    if (idx >= 0) player.hand.splice(idx, 1);
  }

  forbiddenLeadSuit() {
    const round = this.currentRound;
    if (round === "K_HEARTS") return "hearts";
    if (round === "NO_HEARTS") return "hearts";
    if (round === "EIGHT_DIAMONDS") return "diamonds";
    if (round.startsWith("DECLARATION_")) return this.trumpSuit;
    return null;
  }

  isSuitBroken(suit) {
    if (!suit) return true;
    if (this.currentRound === "K_HEARTS") return this.heartsBroken;
    if (this.currentRound === "NO_HEARTS") return this.heartsBroken;
    if (this.currentRound === "EIGHT_DIAMONDS") return this.diamondsBroken;
    if (this.currentRound.startsWith("DECLARATION_")) return this.trumpBroken;
    return true;
  }

  setSuitBroken(suit) {
    if (!suit) return;
    if (this.currentRound === "K_HEARTS" && suit === "hearts") this.heartsBroken = true;
    if (this.currentRound === "NO_HEARTS" && suit === "hearts") this.heartsBroken = true;
    if (this.currentRound === "EIGHT_DIAMONDS" && suit === "diamonds") this.diamondsBroken = true;
    if (this.currentRound.startsWith("DECLARATION_") && suit === this.trumpSuit) this.trumpBroken = true;
  }

  isValidMove(playerIndex, card) {
    if (this.roundOver) return false;
    if (playerIndex !== this.currentPlayer) return false;

    if (this.currentRound === "DOMINO") {
      return this.getDominoValidMoves(playerIndex).some((c) => cardId(c) === cardId(card));
    }

    const player = this.players[playerIndex];
    const hasCard = player.hand.some((c) => cardId(c) === cardId(card));
    if (!hasCard) return false;

    if (!this.leadSuit) {
      const forbidden = this.forbiddenLeadSuit();
      if (forbidden && card.suit === forbidden && !this.isSuitBroken(forbidden)) {
        const hasNonForbidden = player.hand.some((c) => c.suit !== forbidden);
        if (hasNonForbidden) return false;
      }
      return true;
    }

    const hasLead = player.hand.some((c) => c.suit === this.leadSuit);
    if (hasLead && card.suit !== this.leadSuit) return false;
    return true;
  }

  playCard(playerIndex, card) {
    if (!this.isValidMove(playerIndex, card)) return false;

    if (this.currentRound === "DOMINO") {
      return this.playDominoCard(playerIndex, card);
    }

    this.removeCardFromHand(playerIndex, card);

    if (this.trick.length === 0) {
      this.leadSuit = card.suit;
      const forbidden = this.forbiddenLeadSuit();
      if (forbidden && card.suit === forbidden) this.setSuitBroken(forbidden);
    } else {
      if (card.suit !== this.leadSuit) this.markSuitVoid(playerIndex, this.leadSuit);
      const forbidden = this.forbiddenLeadSuit();
      if (forbidden && card.suit === forbidden && card.suit !== this.leadSuit) this.setSuitBroken(forbidden);
    }

    this.rememberCard(card);
    this.trick.push({ player: playerIndex, card: cloneCard(card) });
    this.lastAction = { at: Date.now(), type: "play", player: playerIndex, card: cloneCard(card) };
    this.currentPlayer = nextSeatClockwise(this.currentPlayer);

    if (this.trick.length === 4) this.resolveTrick();
    return true;
  }

  resolveTrick() {
    const round = this.currentRound;
    const trump = round.startsWith("DECLARATION_") ? this.trumpSuit : null;

    let winner = this.trick[0].player;
    let bestCard = this.trick[0].card;
    let bestIsTrump = trump && bestCard.suit === trump;

    this.trick.forEach((t) => {
      const isTrump = trump && t.card.suit === trump;
      if (bestIsTrump) {
        if (isTrump && cardRank(t.card.value) > cardRank(bestCard.value)) {
          bestCard = t.card;
          winner = t.player;
        }
        return;
      }

      if (isTrump) {
        bestIsTrump = true;
        bestCard = t.card;
        winner = t.player;
        return;
      }

      if (t.card.suit === this.leadSuit && cardRank(t.card.value) > cardRank(bestCard.value)) {
        bestCard = t.card;
        winner = t.player;
      }
    });

    this.players[winner].taken.push([...this.trick]);
    this.players[winner].lastTrickWins.push([...this.trick]);
    if (round === "KJ" || round === "Q" || round === "NO_HEARTS") {
      const penalty = this.trick
        .map((t) => t.card)
        .filter((c) => (round === "KJ" ? c.value === "K" || c.value === "J" : round === "Q" ? c.value === "Q" : c.suit === "hearts"))
        .map((c) => cloneCard(c));
      if (penalty.length) this.players[winner].penaltyCards.push(...penalty);
    }
    this.trickWinners.push(winner);
    this.lastResolvedTrick = [...this.trick];
    this.lastTrickWinner = winner;
    this.lastTrickResolvedAt = Date.now();

    const trickCards = this.trick.map((t) => t.card);
    this.trick = [];
    this.leadSuit = null;
    this.currentPlayer = winner;

    if (round === "K_HEARTS") {
      const hasKingHearts = trickCards.some((c) => c.suit === "hearts" && c.value === "K");
      if (hasKingHearts) {
        this.players[winner].score += -8;
        this.finishRoundEarly();
        return;
      }
    }

    if (round === "EIGHT_DIAMONDS") {
      const hasEightDiamonds = trickCards.some((c) => c.suit === "diamonds" && c.value === 8);
      if (hasEightDiamonds) {
        this.players[winner].score += -8;
        this.finishRoundEarly();
        return;
      }
    }

    if (this.players[0].hand.length === 0) this.endRound();
  }

  analyze(player) {
    const data = { hearts: 0, queens: 0, kings: 0, jacks: 0, tricks: player.taken.length };

    player.taken.forEach((trick) => {
      trick.forEach((t) => {
        if (t.card.suit === "hearts") data.hearts++;
        if (t.card.value === "Q") data.queens++;
        if (t.card.value === "K") data.kings++;
        if (t.card.value === "J") data.jacks++;
      });
    });

    return data;
  }

  endRound() {
    const round = this.currentRound;
    let extra = {};

    if (round === "KJ" || round === "Q" || round === "NO_HEARTS" || round === "NEGATIVE_TRICKS" || round === "POSITIVE_TRICKS") {
      this.players.forEach((p) => {
        const a = this.analyze(p);
        let delta = 0;
        if (round === "KJ") delta = -2 * (a.kings + a.jacks);
        if (round === "Q") delta = -3 * a.queens;
        if (round === "NO_HEARTS") delta = -1 * a.hearts;
        if (round === "NEGATIVE_TRICKS") delta = -1 * a.tricks;
        if (round === "POSITIVE_TRICKS") delta = +2 * a.tricks;
        p.score += delta;
      });
    }

    if (round === "LAST_TWO") {
      const last = this.trickWinners[this.trickWinners.length - 1];
      const secondLast = this.trickWinners[this.trickWinners.length - 2];
      if (Number.isInteger(secondLast)) this.players[secondLast].score += -4;
      if (Number.isInteger(last)) this.players[last].score += -4;
      extra = { secondLast, last };
    }

    if (round.startsWith("DECLARATION_")) {
      this.players.forEach((p) => (p.score += p.taken.length));
    }

    this.finishRound("completed", extra);
  }

  finishRoundEarly() {
    this.finishRound("early");
  }

  buildRoundDetails(round, deltas, extra = {}) {
    return this.players.map((player, idx) => {
      const a = this.analyze(player);
      if (round === "KJ") return `K:${a.kings} J:${a.jacks}`;
      if (round === "Q") return `Q prese:${a.queens}`;
      if (round === "NO_HEARTS") return `Cuori presi:${a.hearts}`;
      if (round === "NEGATIVE_TRICKS" || round === "POSITIVE_TRICKS") return `Prese:${a.tricks}`;
      if (round.startsWith("DECLARATION_")) return `Prese:${player.taken.length}`;
      if (round === "DOMINO") return `Carte rimaste:${player.hand.length}`;
      if (round === "LAST_TWO") {
        let txt = "Nessuna penalita";
        if (extra.secondLast === idx) txt = "Penultima presa: -4";
        if (extra.last === idx) txt = txt === "Nessuna penalita" ? "Ultima presa: -4" : "Penultima+Ultima: -8";
        return txt;
      }
      if (round === "K_HEARTS" || round === "EIGHT_DIAMONDS") {
        if (deltas[idx] === -8) return "Presa speciale: -8";
        return "Nessuna penalita";
      }
      return "";
    });
  }

  finishRound(reason, extra = {}) {
    this.roundOver = true;

    const endScores = this.players.map((pl) => pl.score);
    const deltas = endScores.map((s, i) => s - (this.roundStartScores[i] ?? 0));
    const details = this.buildRoundDetails(this.currentRound, deltas, extra);
    const summary = {
      at: Date.now(),
      roundIndex: this.currentRoundIndex,
      round: this.currentRound,
      reason,
      startScores: [...this.roundStartScores],
      endScores: [...endScores],
      deltas,
      details,
    };

    this.lastRoundSummary = summary;
    this.matchHistory.push(summary);

    if (this.currentRoundIndex >= ROUNDS.length - 1) {
      this.gameOver = true;
      this.pendingNextRound = false;
      return;
    }

    this.pendingNextRound = true;
  }

  continueToNextRound() {
    if (!this.pendingNextRound) return false;
    if (this.gameOver) return false;

    this.pendingNextRound = false;
    this.currentRoundIndex++;
    this.dealer = nextSeatClockwise(this.dealer);
    this.startRound();
    return true;
  }

  isGameOver() {
    return this.gameOver;
  }

  chooseTrumpSuitBot(playerIndex) {
    const counts = { hearts: 0, diamonds: 0, clubs: 0, spades: 0 };
    this.players[playerIndex].hand.forEach((c) => (counts[c.suit] += 1));
    let bestSuit = "hearts";
    let best = -1;
    SUITS.forEach((s) => {
      if (counts[s] > best) {
        best = counts[s];
        bestSuit = s;
      }
    });
    return bestSuit;
  }

  setTrumpSuitHuman(suit) {
    if (!this.currentRound.startsWith("DECLARATION_")) return false;
    if (this.declarationChooser !== 0) return false;
    if (this.trumpSuit) return false;
    if (!SUITS.includes(suit)) return false;
    this.trumpSuit = suit;
    return true;
  }

  pickBotCard(playerIndex) {
    const round = this.currentRound;
    const player = this.players[playerIndex];
    const level = this.botLevels?.[playerIndex] ?? "Medio";

    if (round === "DOMINO") {
      const moves = this.getDominoValidMoves(playerIndex);
      if (moves.length === 0) return null;
      const sevens = moves.filter((c) => c.value === 7);
      const pool = sevens.length ? sevens : moves;
      if (level === "Facile") return pickRandom(pool);
      return pickRandom(pool);
    }

    const candidates = player.hand.filter((c) => this.isValidMove(playerIndex, c));
    if (candidates.length === 0) return null;

    const lead = this.leadSuit;
    const forbidden = this.forbiddenLeadSuit();

    const isPenaltyRound = round === "KJ" || round === "Q" || round === "NO_HEARTS";
    const wantsWin = round === "POSITIVE_TRICKS" || round.startsWith("DECLARATION_");

    const isPenaltyCard = (card) => {
      if (round === "KJ") return card.value === "K" || card.value === "J";
      if (round === "Q") return card.value === "Q";
      if (round === "NO_HEARTS") return card.suit === "hearts";
      return false;
    };

    const currentBest = () => {
      if (!this.trick.length) return null;
      const trump = round.startsWith("DECLARATION_") ? this.trumpSuit : null;
      let best = this.trick[0].card;
      let bestIsTrump = trump && best.suit === trump;
      this.trick.forEach((t) => {
        const isTrump = trump && t.card.suit === trump;
        if (bestIsTrump) {
          if (isTrump && cardRank(t.card.value) > cardRank(best.value)) best = t.card;
          return;
        }
        if (isTrump) {
          bestIsTrump = true;
          best = t.card;
          return;
        }
        if (t.card.suit === this.leadSuit && cardRank(t.card.value) > cardRank(best.value)) best = t.card;
      });
      return best;
    };

    const wouldWinTrick = (card) => {
      const best = currentBest();
      if (!best) return true;
      const trump = round.startsWith("DECLARATION_") ? this.trumpSuit : null;
      const bestIsTrump = trump && best.suit === trump;
      const isTrump = trump && card.suit === trump;
      if (bestIsTrump) return isTrump && cardRank(card.value) > cardRank(best.value);
      if (isTrump) return true;
      if (card.suit !== this.leadSuit) return false;
      return cardRank(card.value) > cardRank(best.value);
    };

    const lowest = (arr) => arr.reduce((a, b) => (cardRank(a.value) < cardRank(b.value) ? a : b));
    const highest = (arr) => arr.reduce((a, b) => (cardRank(a.value) > cardRank(b.value) ? a : b));
    const unknownHigherCount = (card) => {
      const own = new Set(player.hand.filter((c) => c.suit === card.suit).map((c) => cardId(c)));
      let count = 0;
      VALUES.forEach((v) => {
        if (cardRank(v) <= cardRank(card.value)) return;
        const probe = { suit: card.suit, value: v };
        const id = cardId(probe);
        if (this.seenCards.has(id)) return;
        if (own.has(id)) return;
        count++;
      });
      return count;
    };
    const countOpponentsVoidSuit = (suit) =>
      [0, 1, 2, 3].filter((idx) => idx !== playerIndex && this.knownVoidByPlayer[idx]?.[suit]).length;

    if (lead) {
      const follow = candidates.filter((c) => c.suit === lead);
      if (follow.length) {
        if (level === "Facile") return pickRandom(follow);
        if (level === "Medio") return lowest(follow);
        if (wantsWin) {
          const winners = follow.filter((c) => wouldWinTrick(c));
          if (winners.length) return level === "Pro" ? highest(winners) : lowest(winners);
          return lowest(follow);
        }
        if (isPenaltyRound) {
          const losers = follow.filter((c) => !wouldWinTrick(c));
          if (losers.length) {
            const penaltyLosers = losers.filter((c) => isPenaltyCard(c));
            if (penaltyLosers.length) return level === "Pro" ? highest(penaltyLosers) : lowest(penaltyLosers);
            return lowest(losers);
          }
          const winners = follow.filter((c) => wouldWinTrick(c));
          return winners.length ? lowest(winners) : lowest(follow);
        }
        if (level === "Difficile" || level === "Pro") {
          const losers = follow.filter((c) => !wouldWinTrick(c));
          if (losers.length) return lowest(losers);
        }
        return lowest(follow);
      }

      if (level === "Facile") return pickRandom(candidates);

      const suitCounts = { hearts: 0, diamonds: 0, clubs: 0, spades: 0 };
      player.hand.forEach((c) => {
        suitCounts[c.suit] += 1;
      });
      const suitsByShort = SUITS.filter((s) => suitCounts[s] > 0).sort((a, b) => suitCounts[a] - suitCounts[b]);
      const shortestSuit = suitsByShort[0] ?? candidates[0].suit;
      const shortestSuitCards = candidates.filter((c) => c.suit === shortestSuit);
      const highestShortest = shortestSuitCards.length ? highest(shortestSuitCards) : highest(candidates);
      const lowestShortest = shortestSuitCards.length ? lowest(shortestSuitCards) : lowest(candidates);

      if (round.startsWith("DECLARATION_") && this.trumpSuit) {
        const trumps = candidates.filter((c) => c.suit === this.trumpSuit);
        const nonTrumps = candidates.filter((c) => c.suit !== this.trumpSuit);

        if (wantsWin && trumps.length) {
          const trumpWinners = trumps.filter((c) => wouldWinTrick(c));
          if (trumpWinners.length) return level === "Pro" ? highest(trumpWinners) : lowest(trumpWinners);
          return lowest(trumps);
        }

        if (isPenaltyRound && nonTrumps.length) {
          const penalty = nonTrumps.filter((c) => isPenaltyCard(c));
          if (penalty.length) return level === "Pro" ? highest(penalty) : highest(penalty);
          return level === "Pro" ? highestShortest : lowestShortest;
        }

        if (nonTrumps.length) return level === "Pro" ? highestShortest : lowestShortest;
        return lowest(trumps);
      }

      if (isPenaltyRound) {
        const penalty = candidates.filter((c) => isPenaltyCard(c));
        if (penalty.length) return level === "Pro" ? highest(penalty) : highest(penalty);
      }

      if (wantsWin) return level === "Pro" ? highestShortest : lowestShortest;
      return level === "Pro" ? highestShortest : lowestShortest;
    }

    if (round === "K_HEARTS") {
      const avoid = candidates.filter((c) => !(c.suit === "hearts" && c.value === "K"));
      if (avoid.length) return level === "Facile" ? pickRandom(avoid) : lowest(avoid);
    }

    if (round === "EIGHT_DIAMONDS") {
      const avoid = candidates.filter((c) => !(c.suit === "diamonds" && c.value === 8));
      if (avoid.length) return level === "Facile" ? pickRandom(avoid) : lowest(avoid);
    }

    if (round === "NO_HEARTS") {
      const avoidHearts = candidates.filter((c) => c.suit !== "hearts");
      if (avoidHearts.length) return level === "Facile" ? pickRandom(avoidHearts) : lowest(avoidHearts);
    }

    if (round.startsWith("DECLARATION_") && forbidden && !this.isSuitBroken(forbidden) && !lead) {
      const avoidTrumpLead = candidates.filter((c) => c.suit !== forbidden);
      if (avoidTrumpLead.length) return level === "Facile" ? pickRandom(avoidTrumpLead) : lowest(avoidTrumpLead);
    }

    if (level === "Facile") return pickRandom(candidates);

    if (!lead) {
      if (level === "Pro" && isPenaltyRound) {
        const nonPenalty = candidates.filter((c) => !isPenaltyCard(c));
        const pool = nonPenalty.length ? nonPenalty : candidates;
        const bySuit = SUITS.map((suit) => {
          const suitCards = pool.filter((c) => c.suit === suit);
          if (!suitCards.length) return null;
          const low = lowest(suitCards);
          const oppVoid = countOpponentsVoidSuit(suit);
          const unknownHigher = unknownHigherCount(low);
          const score = oppVoid * 100 + unknownHigher * 10 - cardRank(low.value);
          return { suit, low, score, oppVoid, unknownHigher };
        }).filter(Boolean);
        const strategic = bySuit
          .filter((x) => x.oppVoid > 0 && x.unknownHigher > 0)
          .sort((a, b) => b.score - a.score);
        if (strategic.length) return strategic[0].low;
      }

      if (isPenaltyRound) {
        const nonPenalty = candidates.filter((c) => !isPenaltyCard(c));
        if (nonPenalty.length) {
          const suitCounts = { hearts: 0, diamonds: 0, clubs: 0, spades: 0 };
          player.hand.forEach((c) => {
            if (!isPenaltyCard(c)) suitCounts[c.suit] += 1;
          });
          const suitsByShort = SUITS.filter((s) => suitCounts[s] > 0).sort((a, b) => suitCounts[a] - suitCounts[b]);
          const shortestSuit = suitsByShort[0] ?? nonPenalty[0].suit;
          const pool = nonPenalty.filter((c) => c.suit === shortestSuit);
          return pool.length ? lowest(pool) : lowest(nonPenalty);
        }
        return lowest(candidates);
      }
    }

    if (wantsWin) return level === "Pro" ? highest(candidates) : lowest(candidates);
    return lowest(candidates);
  }

  autoPlayStep() {
    if (this.isGameOver() || this.roundOver) return false;
    if (this.currentRound.startsWith("DECLARATION_") && this.declarationChooser === 0 && !this.trumpSuit) return false;
    if (this.currentPlayer === 0) return false;

    const playerIndex = this.currentPlayer;
    const card = this.pickBotCard(playerIndex);
    if (!card) {
      if (this.currentRound === "DOMINO") {
        this.playDominoPass(playerIndex);
        return true;
      }
      return false;
    }

    this.playCard(playerIndex, card);
    return true;
  }

  autoPlayUntilHuman() {
    while (!this.isGameOver() && !this.roundOver) {
      if (this.currentRound.startsWith("DECLARATION_") && this.declarationChooser === 0 && !this.trumpSuit) break;
      if (this.currentPlayer === 0) break;
      const card = this.pickBotCard(this.currentPlayer);
      if (!card) {
        if (this.currentRound === "DOMINO") {
          this.playDominoPass(this.currentPlayer);
          continue;
        }
        break;
      }
      this.playCard(this.currentPlayer, card);
    }
  }

  getDominoValidMoves(playerIndex) {
    if (!this.domino) return [];
    const hand = this.players[playerIndex].hand;
    const moves = [];
    hand.forEach((card) => {
      const n = dominoRank(card.value);
      if (this.isDominoPlayable(card.suit, n)) moves.push(card);
    });
    return moves;
  }

  isDominoPlayable(suit, n) {
    const placed = this.domino.placed[suit];
    if (n === 7) return !placed.has(7);

    if (placed.size === 0) return false;

    const min = this.domino.table[suit].min;
    const max = this.domino.table[suit].max;
    return n === min - 1 || n === max + 1;
  }

  playDominoPass(playerIndex) {
    if (!this.domino) return false;
    if (playerIndex !== this.currentPlayer) return false;
    this.domino.passesInRow += 1;
    this.lastAction = { at: Date.now(), type: "pass", player: playerIndex, card: null };
    this.currentPlayer = nextSeatClockwise(this.currentPlayer);
    return true;
  }

  playDominoCard(playerIndex, card) {
    const n = dominoRank(card.value);
    if (!this.isDominoPlayable(card.suit, n)) return false;

    this.removeCardFromHand(playerIndex, card);
    this.domino.passesInRow = 0;
    this.lastAction = { at: Date.now(), type: "domino_play", player: playerIndex, card: cloneCard(card) };

    const placed = this.domino.placed[card.suit];
    placed.add(n);

    if (this.domino.table[card.suit].cards.length === 0 && n === 7) {
      this.domino.table[card.suit].cards = [cloneCard(card)];
      this.domino.table[card.suit].min = 7;
      this.domino.table[card.suit].max = 7;
    } else {
      const suitLine = this.domino.table[card.suit];
      if (n === suitLine.min - 1) suitLine.min = n;
      if (n === suitLine.max + 1) suitLine.max = n;
      suitLine.cards.push(cloneCard(card));
      suitLine.cards.sort((a, b) => dominoRank(a.value) - dominoRank(b.value));
    }

    if (this.players[playerIndex].hand.length === 0) {
      this.finishDominoRound(playerIndex);
      return true;
    }

    this.currentPlayer = nextSeatClockwise(this.currentPlayer);
    return true;
  }

  finishDominoRound(winnerIndex) {
    const deltas = [0, 0, 0, 0];
    let paid = 0;
    this.players.forEach((p, idx) => {
      if (idx === winnerIndex) return;
      const d = -p.hand.length;
      deltas[idx] = d;
      paid += -d;
    });
    deltas[winnerIndex] = paid;
    this.players.forEach((p, idx) => (p.score += deltas[idx]));
    this.finishRound("domino");
  }
}
