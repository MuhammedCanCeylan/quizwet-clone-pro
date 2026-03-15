import { useState, useEffect, useRef, useCallback } from "react";
import {
  Plus, ChevronLeft, ChevronRight, X as XIcon, Import, Settings,
  Maximize, Play, Pause, Shuffle, Check, Layers, LayoutGrid,
  BrainCircuit, Volume2, Star, FileText, Rocket, Home, Trash2,
  Trophy, Target, Filter, Folder, Edit2, ChevronDown, BookOpen,
  Zap, Clock, CheckCircle2, AlertCircle, RotateCcw,
  Eye, EyeOff, Keyboard, Save, SkipBack,
} from "lucide-react";
import { db, Card, Deck, seedDatabaseIfNeeded } from "./db";
import "./App.css";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type Mode = "flashcards" | "learn" | "test" | "match" | "blast" | "adding" | "importing";
type FilterMode = "all" | "learning" | "starred";
type BlastFilter = "all" | "starred" | "unknown";
type CardStatus = "new" | "learning" | "known";
type BlastState = "intro" | "playing" | "end";

interface MatchTile {
  id: string;
  cardId: number;
  text: string;
  type: "front" | "back";
  state: "idle" | "selected" | "matched" | "error";
}

interface TestQuestion {
  card: Card;
  type: "multichoice" | "written";
  options?: string[];
}

interface BlastMeteor {
  id: string;
  text: string;
  isCorrect: boolean;
  x: number; y: number; dx: number; dy: number;
}

interface BlastLaser {
  id: string;
  x: number; y: number; vx: number; vy: number; angle: number;
}

interface Toast {
  id: string;
  message: string;
  type: "success" | "error" | "info";
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const shuffle = <T,>(arr: T[]): T[] => [...arr].sort(() => Math.random() - 0.5);

const speak = (text: string) => {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "tr-TR";
  window.speechSynthesis.speak(u);
};

const fmtTime = (s: number) =>
  `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

// ─────────────────────────────────────────────────────────────────────────────
// Components
// ─────────────────────────────────────────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <label className="relative inline-flex items-center cursor-pointer">
      <input type="checkbox" checked={checked} onChange={onChange} className="sr-only peer" />
      <div className="w-11 h-6 bg-slate-600 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#4255ff]" />
    </label>
  );
}

function ToastContainer({ toasts, remove }: { toasts: Toast[]; remove: (id: string) => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`flex items-center gap-3 px-5 py-3 rounded-xl shadow-2xl text-sm font-semibold text-white pointer-events-auto
            ${t.type === "success" ? "bg-emerald-600" : t.type === "error" ? "bg-red-600" : "bg-[#4255ff]"}`}
          style={{ animation: "slideIn 0.25s cubic-bezier(0.4,0,0.2,1) forwards" }}
        >
          {t.type === "success" && <CheckCircle2 size={16} />}
          {t.type === "error" && <AlertCircle size={16} />}
          {t.type === "info" && <Zap size={16} />}
          {t.message}
          <button onClick={() => remove(t.id)} className="ml-2 opacity-60 hover:opacity-100">
            <XIcon size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

function ProgressRing({ known, learning, total, size = 48 }: { known: number; learning: number; total: number; size?: number }) {
  const r = size / 2 - 4;
  const circ = 2 * Math.PI * r;
  const kPct = total > 0 ? known / total : 0;
  const lPct = total > 0 ? learning / total : 0;
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1a1b41" strokeWidth={4} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f59e0b" strokeWidth={4}
        strokeDasharray={circ} strokeDashoffset={circ * (1 - lPct - kPct)} strokeLinecap="round" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#10b981" strokeWidth={4}
        strokeDasharray={circ} strokeDashoffset={circ * (1 - kPct)} strokeLinecap="round" />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// App
// ─────────────────────────────────────────────────────────────────────────────

export default function App() {
  // Core
  const [decks, setDecks] = useState<Deck[]>([]);
  const [deckStats, setDeckStats] = useState<Record<number, { total: number; known: number; learning: number }>>({});
  const [activeDeck, setActiveDeck] = useState<Deck | null>(null);
  const [newDeckName, setNewDeckName] = useState("");
  const [editingDeckId, setEditingDeckId] = useState<number | null>(null);
  const [editingDeckName, setEditingDeckName] = useState("");
  const [allCardsDb, setAllCardsDb] = useState<Card[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [activeMode, setActiveMode] = useState<Mode>("flashcards");

  // Flashcard
  const [flipped, setFlipped] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isShuffled, setIsShuffled] = useState(false);
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [showSettings, setShowSettings] = useState(false);
  const [trackProgress, setTrackProgress] = useState(true);
  const [hideDefinitions, setHideDefinitions] = useState(false);
  const [showActivityMenu, setShowActivityMenu] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);

  // Card editing
  const [editingCardId, setEditingCardId] = useState<number | null>(null);
  const [editFront, setEditFront] = useState("");
  const [editBack, setEditBack] = useState("");

  // Add / Import
  const [frontInput, setFrontInput] = useState("");
  const [backInput, setBackInput] = useState("");
  const [importInput, setImportInput] = useState("");

  // Learn
  const [learnOptions, setLearnOptions] = useState<string[]>([]);
  // "none" = henüz cevap verilmedi | "correct" = doğru | "wrong" = yanlış
  const [learnResult, setLearnResult] = useState<"none" | "correct" | "wrong">("none");
  const [learnSelectedAnswer, setLearnSelectedAnswer] = useState<string | null>(null);
  const [learnStreak, setLearnStreak] = useState(0);
  const [learnWritten, setLearnWritten] = useState("");
  const [learnMode, setLearnMode] = useState<"multi" | "written">("multi");
  // Doğru cevap sadece yanlış seçilince gösterilecek
  const [learnRevealAnswer, setLearnRevealAnswer] = useState(false);

  // Match
  const [matchTiles, setMatchTiles] = useState<MatchTile[]>([]);
  const [selectedTiles, setSelectedTiles] = useState<MatchTile[]>([]);
  const [isMatchWon, setIsMatchWon] = useState(false);
  const [matchTime, setMatchTime] = useState(0);
  const [matchMistakes, setMatchMistakes] = useState(0);
  const matchTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const matchStartedRef = useRef(false);
  const [matchBestTime, setMatchBestTime] = useState<number | null>(null);

  // Test
  const [isTestSetup, setIsTestSetup] = useState(true);
  const [testConfigCount, setTestConfigCount] = useState(20);
  const [testConfigMultichoice, setTestConfigMultichoice] = useState(true);
  const [testConfigWritten, setTestConfigWritten] = useState(true);
  const [testQuestions, setTestQuestions] = useState<TestQuestion[]>([]);
  const [testAnswers, setTestAnswers] = useState<string[]>([]);
  const [testScore, setTestScore] = useState<number | null>(null);
  const [testShowReview, setTestShowReview] = useState(false);

  // Blast
  const [blastFilter, setBlastFilter] = useState<BlastFilter>("all");
  const [blastState, setBlastState] = useState<BlastState>("intro");
  const [blastCurrentCard, setBlastCurrentCard] = useState<Card | null>(null);
  const [blastMeteors, setBlastMeteors] = useState<BlastMeteor[]>([]);
  const [blastLasers, setBlastLasers] = useState<BlastLaser[]>([]);
  const [blastTurretAngle, setBlastTurretAngle] = useState(-Math.PI / 2);
  const [blastScore, setBlastScore] = useState(0);
  const [blastLevel, setBlastLevel] = useState(1);
  const [blastQuestionCount, setBlastQuestionCount] = useState(0);
  const [blastMaxScore, setBlastMaxScore] = useState(0);
  const [blastMaxLevel, setBlastMaxLevel] = useState(1);
  const [blastCombo, setBlastCombo] = useState(0);
  const [blastComboDisplay, setBlastComboDisplay] = useState<{ x: number; y: number; val: number } | null>(null);

  const blastScoreRef = useRef(0);
  const blastLevelRef = useRef(1);
  const blastQCountRef = useRef(0);
  const blastStateRef = useRef<BlastState>("intro");
  const blastCardsRef = useRef<Card[]>([]);
  const blastAllCardsRef = useRef<Card[]>([]);
  const blastMeteorsRef = useRef<BlastMeteor[]>([]);
  const blastLasersRef = useRef<BlastLaser[]>([]);
  const blastComboRef = useRef(0);

  // Toasts
  const [toasts, setToasts] = useState<Toast[]>([]);
  const addToast = useCallback((message: string, type: Toast["type"] = "success") => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3000);
  }, []);
  const removeToast = (id: string) => setToasts((prev) => prev.filter((t) => t.id !== id));

  // ─────────────────────────────────────────────────────────────────────────
  // DB helpers
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    const init = async () => { await seedDatabaseIfNeeded(); fetchDecks(); };
    init();
  }, []);

  const fetchDecks = async () => {
    const all = await db.decks.toArray();
    setDecks(all);
    const stats: Record<number, { total: number; known: number; learning: number }> = {};
    for (const deck of all) {
      const cs = await db.cards.where("deckId").equals(deck.id!).toArray();
      stats[deck.id!] = {
        total: cs.length,
        known: cs.filter((c) => c.status === "known").length,
        learning: cs.filter((c) => c.status === "learning").length,
      };
    }
    setDeckStats(stats);
  };

  const createDeck = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDeckName.trim()) return;
    await db.decks.add({ name: newDeckName.trim() });
    setNewDeckName("");
    fetchDecks();
    addToast("Set oluşturuldu!", "success");
  };

  const deleteDeck = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    if (!confirm("Bu seti silmek istediğinize emin misiniz?")) return;
    await db.decks.delete(id);
    await db.cards.where("deckId").equals(id).delete();
    fetchDecks();
    addToast("Set silindi.", "info");
  };

  const renameDeck = async (id: number) => {
    if (!editingDeckName.trim()) return;
    await db.decks.update(id, { name: editingDeckName.trim() });
    setEditingDeckId(null);
    if (activeDeck?.id === id) setActiveDeck((d) => d ? { ...d, name: editingDeckName.trim() } : d);
    fetchDecks();
    addToast("Set adı güncellendi.", "success");
  };

  const fetchAndFilterCards = useCallback(async () => {
    if (!activeDeck) return;
    try {
      const all = (await db.cards.where("deckId").equals(activeDeck.id!).toArray()).map((c) => ({
        ...c,
        status: c.status ?? "new",
        isStarred: c.isStarred ?? false,
      }));
      setAllCardsDb(all);
      blastAllCardsRef.current = all;

      let filtered = [...all];
      if (filterMode === "starred") filtered = filtered.filter((c) => c.isStarred);
      if (filterMode === "learning") filtered = filtered.filter((c) => c.status !== "known");
      if (isShuffled) filtered = shuffle(filtered);

      setCards(filtered);
      setCurrentIndex((i) => (i >= filtered.length ? 0 : i));
      setTestConfigCount(Math.min(20, filtered.length));

      // Blast pool — ayrı filtre
      updateBlastPool(all, blastFilter);
    } catch (err) {
      console.error(err);
    }
  }, [activeDeck, filterMode, isShuffled, blastFilter]);

  const updateBlastPool = (all: Card[], filter: BlastFilter) => {
    let pool = [...all];
    if (filter === "starred") pool = pool.filter((c) => c.isStarred);
    if (filter === "unknown") pool = pool.filter((c) => c.status !== "known");
    blastCardsRef.current = pool;
  };

  useEffect(() => {
    if (activeDeck) fetchAndFilterCards();
  }, [activeDeck, filterMode, isShuffled, fetchAndFilterCards]);

  // Blast filtresi değişince pool'u güncelle
  useEffect(() => {
    updateBlastPool(allCardsDb, blastFilter);
  }, [blastFilter, allCardsDb]);

  const updateCardStatus = async (status: CardStatus) => {
    const card = cards[currentIndex] ?? cards[0];
    if (!card) return;
    await db.cards.update(card.id!, { status });
    await fetchAndFilterCards();
    if (filterMode === "all" || filterMode === "starred") nextCard();
  };

  const toggleStar = async (id: number) => {
    const card = await db.cards.get(id);
    if (card) {
      await db.cards.update(id, { isStarred: !card.isStarred });
      fetchAndFilterCards();
    }
  };

  const deleteCard = async (id: number) => {
    if (!confirm("Bu kartı silmek istiyor musunuz?")) return;
    await db.cards.delete(id);
    fetchAndFilterCards();
    fetchDecks();
    addToast("Kart silindi.", "info");
  };

  const startEditCard = (card: Card) => {
    setEditingCardId(card.id!);
    setEditFront(card.front);
    setEditBack(card.back);
  };

  const saveEditCard = async () => {
    if (!editingCardId || !editFront.trim() || !editBack.trim()) return;
    await db.cards.update(editingCardId, { front: editFront.trim(), back: editBack.trim() });
    setEditingCardId(null);
    fetchAndFilterCards();
    addToast("Kart güncellendi.", "success");
  };

  const restartCards = async () => {
    for (const card of allCardsDb) await db.cards.update(card.id!, { status: "new" });
    fetchAndFilterCards();
    setShowSettings(false);
    addToast("İlerleme sıfırlandı.", "info");
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Navigation
  // ─────────────────────────────────────────────────────────────────────────

  const nextCard = useCallback(() => {
    setFlipped(false);
    setTimeout(() => setCurrentIndex((i) => (i < cards.length - 1 ? i + 1 : 0)), 60);
  }, [cards.length]);

  const prevCard = useCallback(() => {
    setFlipped(false);
    setTimeout(() => setCurrentIndex((i) => (i > 0 ? i - 1 : cards.length - 1)), 60);
  }, [cards.length]);

  // 1. karta dön
  const goFirstCard = useCallback(() => {
    setFlipped(false);
    setTimeout(() => setCurrentIndex(0), 60);
  }, []);

  useEffect(() => {
    if (activeMode !== "flashcards") return;
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowRight") { e.preventDefault(); nextCard(); }
      if (e.key === "ArrowLeft") { e.preventDefault(); prevCard(); }
      if (e.key === "Home") { e.preventDefault(); goFirstCard(); }
      if (e.key === " ") { e.preventDefault(); setFlipped((f) => !f); }
      if (e.key === "1" && trackProgress) updateCardStatus("learning");
      if (e.key === "2" && trackProgress) updateCardStatus("known");
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeMode, nextCard, prevCard, goFirstCard, trackProgress]);

  useEffect(() => setFlipped(false), [currentIndex]);

  useEffect(() => {
    if (!isPlaying) return;
    const id = setInterval(nextCard, 3000);
    return () => clearInterval(id);
  }, [isPlaying, nextCard]);

  useEffect(() => {
    if (activeMode === "match") startMatchGame();
    if (activeMode === "learn") initLearnQuestion();
    if (activeMode === "test") { setIsTestSetup(true); setTestScore(null); }
    if (activeMode === "blast") { setBlastState("intro"); blastStateRef.current = "intro"; }
  }, [activeMode]);

  // ─────────────────────────────────────────────────────────────────────────
  // Learn mode
  // ─────────────────────────────────────────────────────────────────────────

  const initLearnQuestion = useCallback(() => {
    const card = cards[currentIndex] ?? cards[0];
    if (!card || cards.length < 4) return;
    setLearnResult("none");
    setLearnSelectedAnswer(null);
    setLearnWritten("");
    setLearnRevealAnswer(false);
    const wrongs = shuffle(allCardsDb.filter((c) => c.id !== card.id)).slice(0, 3);
    setLearnOptions(shuffle([card.back, ...wrongs.map((c) => c.back)]));
    // Seri 3+ olunca yazılı, değilse random
    setLearnMode(learnStreak >= 3 ? "written" : (Math.random() > 0.5 ? "multi" : "written"));
  }, [currentIndex, cards, allCardsDb, learnStreak]);

  useEffect(() => {
    if (activeMode === "learn") initLearnQuestion();
  }, [currentIndex, activeMode, cards.length]);

  const handleLearnAnswer = (answer: string) => {
    if (learnResult !== "none") return;
    const card = cards[currentIndex] ?? cards[0];
    if (!card) return;
    const correct = answer.toLowerCase().trim() === card.back.toLowerCase().trim();
    setLearnSelectedAnswer(answer);
    setLearnResult(correct ? "correct" : "wrong");
    setLearnStreak((s) => (correct ? s + 1 : 0));
    // Yanlışsa doğru cevabı göster
    if (!correct) setLearnRevealAnswer(true);
    setTimeout(() => updateCardStatus(correct ? "known" : "learning"), 1600);
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Match mode
  // ─────────────────────────────────────────────────────────────────────────

  const startMatchGame = () => {
    if (cards.length === 0) return;
    setIsMatchWon(false); setMatchMistakes(0); setMatchTime(0);
    matchStartedRef.current = false;
    if (matchTimerRef.current) clearInterval(matchTimerRef.current);
    const pool = shuffle(cards).slice(0, 6);
    const tiles: MatchTile[] = [];
    pool.forEach((c) => {
      tiles.push({ id: `f-${c.id}`, cardId: c.id!, text: c.front, type: "front", state: "idle" });
      tiles.push({ id: `b-${c.id}`, cardId: c.id!, text: c.back, type: "back", state: "idle" });
    });
    setMatchTiles(shuffle(tiles)); setSelectedTiles([]);
  };

  useEffect(() => () => { if (matchTimerRef.current) clearInterval(matchTimerRef.current); }, []);

  const handleTileClick = (tile: MatchTile) => {
    if (tile.state !== "idle" || selectedTiles.length >= 2) return;
    if (!matchStartedRef.current) {
      matchStartedRef.current = true;
      matchTimerRef.current = setInterval(() => setMatchTime((t) => t + 1), 1000);
    }
    const newSelected = [...selectedTiles, tile];
    setSelectedTiles(newSelected);
    setMatchTiles((prev) => prev.map((t) => (t.id === tile.id ? { ...t, state: "selected" } : t)));
    if (newSelected.length === 2) {
      const [a, b] = newSelected;
      if (a.cardId === b.cardId && a.type !== b.type) {
        setTimeout(() => {
          setMatchTiles((prev) => {
            const updated = prev.map((t) =>
              t.id === a.id || t.id === b.id ? { ...t, state: "matched" as const } : t
            );
            if (updated.every((t) => t.state === "matched")) {
              setIsMatchWon(true);
              if (matchTimerRef.current) clearInterval(matchTimerRef.current);
              setMatchBestTime((prev) => (prev === null ? matchTime + 1 : Math.min(prev, matchTime + 1)));
            }
            return updated;
          });
          setSelectedTiles([]);
        }, 300);
      } else {
        setMatchMistakes((m) => m + 1);
        setMatchTiles((prev) => prev.map((t) => t.id === a.id || t.id === b.id ? { ...t, state: "error" as const } : t));
        setTimeout(() => {
          setMatchTiles((prev) => prev.map((t) => t.id === a.id || t.id === b.id ? { ...t, state: "idle" as const } : t));
          setSelectedTiles([]);
        }, 700);
      }
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Test mode
  // ─────────────────────────────────────────────────────────────────────────

  const generateTest = () => {
    setTestScore(null); setTestShowReview(false);
    const pool = shuffle(cards).slice(0, testConfigCount);
    const questions: TestQuestion[] = pool.map((q) => {
      let type: TestQuestion["type"] = "multichoice";
      if (testConfigWritten && testConfigMultichoice) type = Math.random() > 0.5 ? "multichoice" : "written";
      else if (testConfigWritten) type = "written";
      if (type === "multichoice") {
        const wrongs = shuffle(allCardsDb.filter((c) => c.id !== q.id)).slice(0, 3);
        return { card: q, type, options: shuffle([q.back, ...wrongs.map((c) => c.back)]) };
      }
      return { card: q, type };
    });
    setTestQuestions(questions);
    setTestAnswers(new Array(questions.length).fill(""));
    setIsTestSetup(false);
  };

  const submitTest = () => {
    const correct = testQuestions.reduce(
      (acc, q, i) => testAnswers[i].toLowerCase().trim() === q.card.back.toLowerCase().trim() ? acc + 1 : acc, 0
    );
    setTestScore(Math.round((correct / testQuestions.length) * 100));
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Blast mode
  // ─────────────────────────────────────────────────────────────────────────

  const spawnBlastQuestion = useCallback((level: number, qCount: number) => {
    if (qCount >= 10) {
      setBlastState("end"); blastStateRef.current = "end";
      setBlastMaxScore((prev) => Math.max(prev, blastScoreRef.current));
      setBlastMaxLevel((prev) => Math.max(prev, blastLevelRef.current));
      return;
    }
    const pool = blastCardsRef.current;
    if (pool.length === 0) return;
    const target = pool[Math.floor(Math.random() * pool.length)];
    setBlastCurrentCard(target);
    const allPool = blastAllCardsRef.current;
    const uniqueWrongsMap = new Map<string, Card>();
    for (const c of allPool) {
      const lb = c.back.trim().toLowerCase();
      const tb = target.back.trim().toLowerCase();
      if (c.id !== target.id && lb !== tb && !uniqueWrongsMap.has(lb)) uniqueWrongsMap.set(lb, c);
    }
    const wrongs = shuffle(Array.from(uniqueWrongsMap.values())).slice(0, 4);
    const options = shuffle([target, ...wrongs]);
    const speed = 0.5 + level * 0.18;
    const newMeteors = options.map((opt) => ({
      id: Math.random().toString(36).slice(2),
      text: opt.back,
      isCorrect: opt.id === target.id,
      x: Math.random() * 55 + 22,
      y: Math.random() * 40 + 10,
      dx: ((Math.random() - 0.5) * speed * 2) || 0.4,
      dy: ((Math.random() - 0.5) * speed * 2) || 0.4,
    }));
    blastMeteorsRef.current = newMeteors;
    setBlastMeteors(newMeteors);
  }, []);

  const startBlastGame = () => {
    const pool = blastCardsRef.current;
    if (pool.length < 5) { addToast("Bu filtre için en az 5 kart gereklidir.", "error"); return; }
    blastScoreRef.current = 0; blastLevelRef.current = 1; blastQCountRef.current = 0; blastComboRef.current = 0;
    setBlastScore(0); setBlastLevel(1); setBlastQuestionCount(0); setBlastCombo(0);
    setBlastState("playing"); blastStateRef.current = "playing";
    blastLasersRef.current = []; setBlastLasers([]);
    setBlastComboDisplay(null);
    spawnBlastQuestion(1, 0);
  };

  const handleMeteorClick = (m: BlastMeteor) => {
    if (blastStateRef.current !== "playing") return;
    if (m.isCorrect) {
      blastComboRef.current += 1;
      const combo = blastComboRef.current;
      const bonus = combo >= 3 ? combo * 5 : 10;
      blastScoreRef.current += bonus;
      blastQCountRef.current += 1;
      const newLevel = Math.floor(blastQCountRef.current / 3) + 1;
      blastLevelRef.current = newLevel;
      setBlastScore(blastScoreRef.current); setBlastLevel(newLevel);
      setBlastQuestionCount(blastQCountRef.current); setBlastCombo(combo);
      setBlastComboDisplay({ x: m.x, y: m.y, val: bonus });
      setTimeout(() => setBlastComboDisplay(null), 800);
      spawnBlastQuestion(newLevel, blastQCountRef.current);
    } else {
      blastComboRef.current = 0;
      setBlastCombo(0);
      blastScoreRef.current = Math.max(0, blastScoreRef.current - 5);
      setBlastScore(blastScoreRef.current);
      blastMeteorsRef.current = blastMeteorsRef.current.filter((x) => x.id !== m.id);
      setBlastMeteors([...blastMeteorsRef.current]);
    }
  };

  const handleBlastMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (blastStateRef.current !== "playing") return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * 100;
    const my = ((e.clientY - rect.top) / rect.height) * 100;
    setBlastTurretAngle(Math.atan2(my - 90, mx - 50));
  };

  const handleBlastClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (blastStateRef.current !== "playing") return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * 100;
    const my = ((e.clientY - rect.top) / rect.height) * 100;
    const dx = mx - 50, dy = my - 90;
    const dist = Math.hypot(dx, dy);
    if (dist === 0) return;
    const speed = 4;
    const newLaser: BlastLaser = {
      id: Math.random().toString(36).slice(2),
      x: 50, y: 90,
      vx: (dx / dist) * speed, vy: (dy / dist) * speed,
      angle: Math.atan2(dy, dx),
    };
    blastLasersRef.current.push(newLaser);
    setBlastLasers([...blastLasersRef.current]);
  };

  useEffect(() => {
    if (blastState !== "playing") return;
    const id = setInterval(() => {
      blastLasersRef.current = blastLasersRef.current
        .map((l) => ({ ...l, x: l.x + l.vx, y: l.y + l.vy }))
        .filter((l) => l.x > -10 && l.x < 110 && l.y > -10 && l.y < 110);
      blastMeteorsRef.current = blastMeteorsRef.current.map((m) => {
        let { x, y, dx, dy } = m;
        x += dx; y += dy;
        if (x <= 5 || x >= 88) { dx = -dx; x = Math.max(5, Math.min(88, x)); }
        if (y <= 3 || y >= 70) { dy = -dy; y = Math.max(3, Math.min(70, y)); }
        return { ...m, x, y, dx, dy };
      });
      const survivingLasers = [];
      for (const l of blastLasersRef.current) {
        let hit = false;
        for (let j = 0; j < blastMeteorsRef.current.length; j++) {
          const m = blastMeteorsRef.current[j];
          if (Math.hypot(m.x - l.x, m.y - l.y) < 8) {
            hit = true;
            if (m.isCorrect) {
              blastComboRef.current += 1;
              const bonus = blastComboRef.current >= 3 ? blastComboRef.current * 5 : 10;
              blastScoreRef.current += bonus;
              blastQCountRef.current += 1;
              const newLevel = Math.floor(blastQCountRef.current / 3) + 1;
              blastLevelRef.current = newLevel;
              setBlastScore(blastScoreRef.current); setBlastLevel(newLevel);
              setBlastQuestionCount(blastQCountRef.current); setBlastCombo(blastComboRef.current);
              setBlastComboDisplay({ x: m.x, y: m.y, val: bonus });
              setTimeout(() => setBlastComboDisplay(null), 800);
              spawnBlastQuestion(newLevel, blastQCountRef.current);
            } else {
              blastComboRef.current = 0;
              setBlastCombo(0);
              blastScoreRef.current = Math.max(0, blastScoreRef.current - 5);
              setBlastScore(blastScoreRef.current);
              blastMeteorsRef.current.splice(j, 1);
            }
            break;
          }
        }
        if (!hit) survivingLasers.push(l);
      }
      blastLasersRef.current = survivingLasers;
      setBlastLasers([...blastLasersRef.current]);
      setBlastMeteors([...blastMeteorsRef.current]);
    }, 50);
    return () => clearInterval(id);
  }, [blastState, spawnBlastQuestion]);

  // ─────────────────────────────────────────────────────────────────────────
  // Add / Import
  // ─────────────────────────────────────────────────────────────────────────

  const handleAddCard = async () => {
    if (!frontInput.trim() || !backInput.trim() || !activeDeck) return;
    await db.cards.add({ deckId: activeDeck.id!, front: frontInput.trim(), back: backInput.trim(), status: "new", isStarred: false });
    setFrontInput(""); setBackInput("");
    setActiveMode("flashcards");
    fetchAndFilterCards(); fetchDecks();
    addToast("Kart eklendi!", "success");
  };

  const handleImportCards = async () => {
    if (!importInput.trim() || !activeDeck) return;
    const newCards: Omit<Card, "id">[] = [];
    for (const line of importInput.split("\n")) {
      if (!line.trim()) continue;
      let parts = line.split("\t");
      if (parts.length < 2) parts = line.split(" - ");
      if (parts.length < 2) parts = line.split(";");
      if (parts.length >= 2) newCards.push({ deckId: activeDeck.id!, front: parts[0].trim(), back: parts.slice(1).join(" ").trim(), status: "new", isStarred: false });
    }
    if (newCards.length > 0) {
      await db.cards.bulkAdd(newCards);
      setImportInput(""); setActiveMode("flashcards");
      fetchAndFilterCards(); fetchDecks();
      addToast(`${newCards.length} kart içe aktarıldı!`, "success");
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Convenience
  // ─────────────────────────────────────────────────────────────────────────

  const safeCard = cards[currentIndex] ?? cards[0] ?? null;
  const knownCount = allCardsDb.filter((c) => c.status === "known").length;
  const learningCount = allCardsDb.filter((c) => c.status === "learning").length;
  const newCount = allCardsDb.filter((c) => c.status === "new").length;
  const starredCount = allCardsDb.filter((c) => c.isStarred).length;

  const goMode = (m: Mode) => { setActiveMode(m); window.scrollTo({ top: 0, behavior: "smooth" }); };

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div
      className="w-screen min-h-screen flex flex-col overflow-y-auto relative"
      style={{ backgroundColor: "#0a092d", color: "#e2e8f0", fontFamily: "'Segoe UI', system-ui, sans-serif" }}
    >
      {/* Title bar */}
      <div
        style={{ WebkitAppRegion: "drag", backgroundColor: "#080720" } as React.CSSProperties}
        className="sticky top-0 z-50 w-full h-9 flex items-center justify-between px-4 shrink-0 border-b border-white/5"
      >
        <div className="flex items-center gap-2 pointer-events-none">
          <BookOpen size={14} className="text-[#4255ff]" />
          <span className="text-xs font-bold text-white/40 tracking-widest uppercase">Quizlet</span>
        </div>
        <div className="w-10 h-1 bg-white/10 rounded-full pointer-events-none" />
        <div className="w-16" />
      </div>

      <ToastContainer toasts={toasts} remove={removeToast} />

      <div className="flex-1 flex flex-col p-6 w-full max-w-5xl mx-auto">

        {/* ════════════════════════════════════════════════════════════════════
            DECK BROWSER
        ════════════════════════════════════════════════════════════════════ */}
        {!activeDeck ? (
          <div className="flex flex-col">
            <div className="flex items-end justify-between mb-8">
              <div>
                <h1 className="text-4xl font-black text-white mb-1">Çalışma Setlerim</h1>
                <p className="text-slate-500 text-sm">{decks.length} set · Öğrenmek için bir sete tıkla</p>
              </div>
            </div>

            <form onSubmit={createDeck} className="flex gap-3 mb-10 w-full max-w-xl">
              <input
                type="text"
                placeholder="Yeni set adı (örn: İngilizce Kelimeler)"
                value={newDeckName}
                onChange={(e) => setNewDeckName(e.target.value)}
                className="flex-1 bg-[#1a1b41] border border-white/10 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-[#4255ff] outline-none placeholder-slate-700 text-sm"
              />
              <button type="submit" className="bg-[#4255ff] hover:bg-blue-500 text-white font-bold py-3 px-5 rounded-xl flex items-center gap-2 transition-colors text-sm active:scale-95">
                <Plus size={18} /> Oluştur
              </button>
            </form>

            {decks.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-slate-700">
                <Folder size={56} className="mb-4 opacity-20" />
                <p className="text-lg font-semibold">Henüz set yok</p>
                <p className="text-sm mt-1">Yukarıdan ilk setini oluştur</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {decks.map((deck) => {
                  const s = deckStats[deck.id!] ?? { total: 0, known: 0, learning: 0 };
                  const pct = s.total > 0 ? Math.round((s.known / s.total) * 100) : 0;
                  return (
                    <div
                      key={deck.id}
                      onClick={() => { if (editingDeckId !== deck.id) setActiveDeck(deck); }}
                      className="bg-[#1a1b41] hover:bg-[#1e2055] border border-white/5 hover:border-[#4255ff]/20 p-5 rounded-2xl cursor-pointer transition-all hover:shadow-xl hover:shadow-[#4255ff]/5 group relative"
                    >
                      <div className="flex justify-between items-start mb-4">
                        <div className="w-10 h-10 rounded-xl bg-[#4255ff]/15 flex items-center justify-center">
                          <Folder size={20} className="text-[#4255ff]" />
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={(e) => { e.stopPropagation(); setEditingDeckId(deck.id!); setEditingDeckName(deck.name); }}
                            className="p-1.5 text-slate-600 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
                          >
                            <Edit2 size={13} />
                          </button>
                          <button
                            onClick={(e) => deleteDeck(e, deck.id!)}
                            className="p-1.5 text-slate-600 hover:text-red-400 rounded-lg hover:bg-red-400/10 transition-colors"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                      {editingDeckId === deck.id ? (
                        <div className="flex gap-2 mb-3" onClick={(e) => e.stopPropagation()}>
                          <input autoFocus value={editingDeckName} onChange={(e) => setEditingDeckName(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") renameDeck(deck.id!); if (e.key === "Escape") setEditingDeckId(null); }}
                            className="flex-1 bg-[#0a092d] border border-[#4255ff] rounded-lg px-3 py-1.5 text-white text-sm outline-none" />
                          <button onClick={() => renameDeck(deck.id!)} className="p-1.5 bg-[#4255ff] rounded-lg text-white"><Save size={13} /></button>
                        </div>
                      ) : (
                        <h3 className="text-base font-bold text-white mb-1 line-clamp-2 leading-snug">{deck.name}</h3>
                      )}
                      <p className="text-xs text-slate-600 mb-3">{s.total} kart</p>
                      {s.total > 0 && (
                        <div className="space-y-1">
                          <div className="flex justify-between text-xs text-slate-700">
                            <span>{pct}%</span>
                            <span className="text-emerald-600">{s.known} biliyor</span>
                          </div>
                          <div className="w-full h-1.5 bg-[#0a092d] rounded-full overflow-hidden">
                            <div className="h-full bg-gradient-to-r from-[#4255ff] to-emerald-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

        ) : (
          <>
            {/* ── Header ─────────────────────────────────────────────────── */}
            <div className="flex items-center gap-3 mb-6 pb-4 border-b border-white/10">
              <button
                onClick={() => { setActiveDeck(null); setActiveMode("flashcards"); }}
                className="p-2 bg-[#1a1b41] hover:bg-[#2e3856] rounded-xl transition-colors"
              >
                <Home size={18} />
              </button>
              <div className="flex-1 min-w-0">
                <h2 className="text-xl font-black text-white truncate">{activeDeck.name}</h2>
                <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-600">
                  <span>{allCardsDb.length} kart</span>
                  {trackProgress && (
                    <>
                      <span>·</span>
                      <span className="text-emerald-500">{knownCount} biliyor</span>
                      <span className="text-amber-400">{learningCount} öğreniyor</span>
                      <span>{newCount} yeni</span>
                    </>
                  )}
                </div>
              </div>
              {trackProgress && allCardsDb.length > 0 && (
                <div className="flex items-center gap-2">
                  <ProgressRing known={knownCount} learning={learningCount} total={allCardsDb.length} size={44} />
                  <span className="text-lg font-black text-white">{Math.round((knownCount / allCardsDb.length) * 100)}%</span>
                </div>
              )}
            </div>

            {/* ── Mode tabs ────────────────────────────────────────────── */}
            <div className="flex gap-1.5 mb-8 bg-[#0f0e2a] p-1.5 rounded-2xl border border-white/5">
              {([
                ["flashcards", "Kartlar", <Layers size={14} />, "#4255ff"],
                ["learn", "Öğren", <BrainCircuit size={14} />, "#a855f7"],
                ["test", "Test", <FileText size={14} />, "#eab308"],
                ["match", "Eşleştir", <LayoutGrid size={14} />, "#22d3ee"],
                ["blast", "Blast", <Rocket size={14} />, "#f97316"],
              ] as [Mode, string, React.ReactNode, string][]).map(([mode, label, icon, color]) => (
                <button
                  key={mode}
                  onClick={() => setActiveMode(mode)}
                  className="flex-1 py-2.5 rounded-xl font-bold flex items-center justify-center gap-1.5 transition-all text-xs"
                  style={activeMode === mode
                    ? { backgroundColor: "#1a1b41", color, boxShadow: "0 2px 8px rgba(0,0,0,0.3)" }
                    : { color: "#64748b" }
                  }
                >
                  {icon} {label}
                </button>
              ))}
            </div>

            {/* ════════════════════════════════════════════════════════════
                FLASHCARDS MODE
            ════════════════════════════════════════════════════════════ */}
            {activeMode === "flashcards" && (
              <div className="flex flex-col w-full relative">
                {/* Settings panel */}
                {showSettings && (
                  <div className="absolute top-0 right-0 z-50 w-72 bg-[#1a1b41] rounded-2xl shadow-2xl border border-white/10 p-5">
                    <div className="flex justify-between items-center mb-4">
                      <h3 className="text-base font-bold text-white">Ayarlar</h3>
                      <button onClick={() => setShowSettings(false)} className="bg-white/10 p-1.5 rounded-full hover:bg-white/20">
                        <XIcon size={14} />
                      </button>
                    </div>
                    <div className="space-y-0 divide-y divide-white/5 text-sm">
                      <div className="flex justify-between items-center py-3">
                        <p className="text-white font-semibold">İlerlemeyi takip et</p>
                        <Toggle checked={trackProgress} onChange={() => setTrackProgress((v) => !v)} />
                      </div>
                      <div className="flex justify-between items-center py-3">
                        <p className="text-white font-semibold">Tanımları gizle</p>
                        <Toggle checked={hideDefinitions} onChange={() => setHideDefinitions((v) => !v)} />
                      </div>
                      <button
                        onClick={goFirstCard}
                        className="w-full flex items-center gap-2 py-3 text-blue-400 hover:text-blue-300 font-semibold transition-colors text-left"
                      >
                        <SkipBack size={14} /> 1. Karta Geri Dön
                      </button>
                      <button
                        onClick={restartCards}
                        className="w-full flex items-center gap-2 py-3 text-red-400 hover:text-red-300 font-semibold transition-colors text-left"
                      >
                        <RotateCcw size={14} /> İlerlemeyi Sıfırla
                      </button>
                    </div>
                  </div>
                )}

                {/* Shortcuts modal */}
                {showShortcuts && (
                  <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={() => setShowShortcuts(false)}>
                    <div className="bg-[#1a1b41] rounded-2xl p-6 w-80 border border-white/10 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                      <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2"><Keyboard size={18} /> Klavye Kısayolları</h3>
                      <div className="space-y-1 text-sm">
                        {[
                          ["→ / ←", "Sonraki / Önceki kart"],
                          ["Home", "1. karta geri dön"],
                          ["Boşluk", "Kartı çevir"],
                          ["1", "Tekrar et (öğreniyor)"],
                          ["2", "Biliyorum"],
                        ].map(([k, v]) => (
                          <div key={k} className="flex justify-between items-center py-2 border-b border-white/5">
                            <span className="text-slate-300">{v}</span>
                            <kbd className="bg-[#0a092d] border border-white/20 px-2 py-0.5 rounded text-xs text-slate-400 font-mono">{k}</kbd>
                          </div>
                        ))}
                      </div>
                      <button onClick={() => setShowShortcuts(false)} className="mt-4 w-full py-2.5 bg-[#4255ff] rounded-xl text-white font-bold text-sm">Tamam</button>
                    </div>
                  </div>
                )}

                {/* Filter & stats */}
                <div className="w-full max-w-3xl mx-auto flex justify-between items-center mb-4">
                  <div className="relative">
                    <select
                      value={filterMode}
                      onChange={(e) => setFilterMode(e.target.value as FilterMode)}
                      className="appearance-none bg-[#1a1b41] hover:bg-[#252660] text-white font-semibold py-2 px-4 pr-8 rounded-xl border border-white/10 outline-none cursor-pointer text-sm transition-colors"
                    >
                      <option value="all">Tüm Kartlar ({allCardsDb.length})</option>
                      <option value="learning">Öğrenilmeyenler ({learningCount + newCount})</option>
                      <option value="starred">Yıldızlılar ({starredCount})</option>
                    </select>
                    <Filter size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                  </div>
                  {trackProgress && (
                    <div className="flex gap-2 text-xs font-bold">
                      <span className="flex items-center gap-1 bg-amber-400/10 text-amber-400 px-3 py-1.5 rounded-lg border border-amber-400/10">
                        <Clock size={11} /> {learningCount} öğreniyor
                      </span>
                      <span className="flex items-center gap-1 bg-emerald-500/10 text-emerald-400 px-3 py-1.5 rounded-lg border border-emerald-500/10">
                        <CheckCircle2 size={11} /> {knownCount} biliyor
                      </span>
                    </div>
                  )}
                </div>

                {/* ── FLIP CARD (aşağıdan yukarıya = rotateX) ── */}
                <div className="w-full max-w-3xl mx-auto">
                  {cards.length > 0 && safeCard ? (
                    <>
                      {/* Progress bar */}
                      <div className="w-full h-1 bg-[#1a1b41] rounded-full overflow-hidden mb-4">
                        <div
                          className="h-full bg-gradient-to-r from-[#4255ff] to-purple-500 rounded-full transition-all duration-500"
                          style={{ width: `${((currentIndex + 1) / cards.length) * 100}%` }}
                        />
                      </div>

                      <div
                        className="w-full cursor-pointer select-none"
                        style={{ perspective: "1400px", height: "320px" }}
                        onClick={() => setFlipped((f) => !f)}
                      >
                        <div
                          className="w-full h-full relative"
                          style={{
                            transformStyle: "preserve-3d",
                            /* ← AŞAĞIDAN YUKARIYA: rotateX kullanıyoruz */
                            transition: "transform 0.45s cubic-bezier(0.4, 0, 0.2, 1)",
                            transform: flipped ? "rotateX(-180deg)" : "rotateX(0deg)",
                          }}
                        >
                          {/* Front face */}
                          <div
                            className="absolute inset-0 flex flex-col items-center justify-center p-10 rounded-2xl border border-white/8 shadow-2xl"
                            style={{
                              backfaceVisibility: "hidden",
                              background: "linear-gradient(160deg, #1e2d4d 0%, #1a1b41 100%)",
                            }}
                          >
                            <span className="absolute top-5 left-6 text-xs text-slate-600 font-bold uppercase tracking-widest">Terim</span>
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleStar(safeCard.id!); }}
                              className={`absolute top-4 right-5 transition-colors ${safeCard.isStarred ? "text-yellow-400" : "text-slate-700 hover:text-slate-400"}`}
                            >
                              <Star size={20} fill={safeCard.isStarred ? "currentColor" : "none"} />
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); speak(safeCard.front); }}
                              className="absolute bottom-5 left-6 text-slate-700 hover:text-[#4255ff] transition-colors"
                            >
                              <Volume2 size={17} />
                            </button>
                            <p className="text-3xl font-black text-white text-center leading-relaxed">{safeCard.front}</p>
                            <span className="absolute bottom-5 right-5 text-xs text-slate-700">boşluk / tıkla</span>
                            {safeCard.status !== "new" && (
                              <span className={`absolute top-5 left-1/2 -translate-x-1/2 text-xs px-2 py-0.5 rounded-full font-semibold
                                ${safeCard.status === "known" ? "bg-emerald-500/20 text-emerald-400" : "bg-amber-500/20 text-amber-400"}`}>
                                {safeCard.status === "known" ? "✓ Biliyor" : "↺ Öğreniyor"}
                              </span>
                            )}
                          </div>

                          {/* Back face — rotateX ile ters yüz */}
                          <div
                            className="absolute inset-0 flex flex-col items-center justify-center p-10 rounded-2xl border border-[#4255ff]/20 shadow-2xl"
                            style={{
                              backfaceVisibility: "hidden",
                              /* rotateX(-180deg) ile ters */
                              transform: "rotateX(180deg)",
                              background: "linear-gradient(160deg, #0f2a63 0%, #1a1b41 100%)",
                            }}
                          >
                            <span className="absolute top-5 left-6 text-xs text-slate-600 font-bold uppercase tracking-widest">Tanım</span>
                            <button
                              onClick={(e) => { e.stopPropagation(); speak(safeCard.back); }}
                              className="absolute bottom-5 left-6 text-slate-700 hover:text-[#4255ff] transition-colors"
                            >
                              <Volume2 size={17} />
                            </button>
                            <p className="text-2xl text-white text-center leading-relaxed font-semibold">{safeCard.back}</p>
                          </div>
                        </div>
                      </div>

                      {/* Progress buttons */}
                      {trackProgress && (
                        <div className="flex justify-center gap-8 mt-8">
                          <button onClick={() => updateCardStatus("learning")} className="group flex flex-col items-center gap-1.5">
                            <div className="w-14 h-14 rounded-full border-2 border-white/10 flex items-center justify-center text-slate-500 group-hover:text-red-400 group-hover:border-red-400/40 group-hover:bg-red-400/5 transition-all bg-[#1a1b41] shadow-lg active:scale-95">
                              <XIcon size={24} />
                            </div>
                            <span className="text-xs text-slate-600 font-semibold">Tekrar <kbd className="opacity-40 font-mono">1</kbd></span>
                          </button>
                          <button onClick={() => updateCardStatus("known")} className="group flex flex-col items-center gap-1.5">
                            <div className="w-14 h-14 rounded-full border-2 border-white/10 flex items-center justify-center text-slate-500 group-hover:text-emerald-400 group-hover:border-emerald-400/40 group-hover:bg-emerald-400/5 transition-all bg-[#1a1b41] shadow-lg active:scale-95">
                              <Check size={24} />
                            </div>
                            <span className="text-xs text-slate-600 font-semibold">Biliyorum <kbd className="opacity-40 font-mono">2</kbd></span>
                          </button>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-center py-20 bg-[#1a1b41] rounded-2xl border border-white/5">
                      <BookOpen size={48} className="mx-auto mb-4 text-slate-700" />
                      <p className="text-slate-400 font-semibold">Kart yok</p>
                      <p className="text-slate-600 text-sm mt-1">Filtre ayarlarını değiştirin veya kart ekleyin.</p>
                    </div>
                  )}
                </div>

                {/* Navigation controls */}
                <div className="max-w-3xl w-full mx-auto mt-6 flex items-center justify-between">
                  <div className="flex items-center gap-2 w-1/3">
                    <button onClick={() => setIsPlaying((p) => !p)} className={`p-2 rounded-xl transition-colors ${isPlaying ? "text-[#4255ff] bg-[#4255ff]/10" : "text-slate-500 hover:text-white hover:bg-white/5"}`}>
                      {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
                    </button>
                    <button onClick={() => setIsShuffled((s) => !s)} className={`p-2 rounded-xl transition-colors ${isShuffled ? "text-[#4255ff] bg-[#4255ff]/10" : "text-slate-500 hover:text-white hover:bg-white/5"}`}>
                      <Shuffle size={20} />
                    </button>
                    {/* 1. karta dön */}
                    <button
                      onClick={goFirstCard}
                      title="1. Karta Geri Dön (Home)"
                      className="p-2 rounded-xl transition-colors text-slate-500 hover:text-white hover:bg-white/5"
                    >
                      <SkipBack size={18} />
                    </button>
                  </div>

                  <div className="flex items-center justify-center gap-4 bg-[#1a1b41] rounded-2xl px-5 py-2.5 border border-white/5 shadow">
                    <button onClick={prevCard} className="p-1 text-slate-400 hover:text-white transition-colors">
                      <ChevronLeft size={24} />
                    </button>
                    <span className="text-sm font-black text-white w-14 text-center">
                      {cards.length > 0 ? currentIndex + 1 : 0} / {cards.length}
                    </span>
                    <button onClick={nextCard} className="p-1 text-slate-400 hover:text-white transition-colors">
                      <ChevronRight size={24} />
                    </button>
                  </div>

                  <div className="flex items-center justify-end gap-2 w-1/3">
                    <button onClick={() => setShowShortcuts(true)} className="p-2 text-slate-500 hover:text-white hover:bg-white/5 rounded-xl transition-colors">
                      <Keyboard size={18} />
                    </button>
                    <button onClick={() => setShowSettings((s) => !s)} className={`p-2 rounded-xl transition-colors ${showSettings ? "text-white bg-white/10" : "text-slate-500 hover:text-white hover:bg-white/5"}`}>
                      <Settings size={18} />
                    </button>
                    <button onClick={() => { if (!document.fullscreenElement) document.documentElement.requestFullscreen(); else document.exitFullscreen(); }} className="p-2 text-slate-500 hover:text-white hover:bg-white/5 rounded-xl transition-colors">
                      <Maximize size={18} />
                    </button>
                  </div>
                </div>

                {/* Card list */}
                <div className="mt-14 w-full max-w-5xl mx-auto pb-16">
                  <div className="flex justify-between items-center border-b border-white/10 pb-4 mb-5">
                    <h2 className="text-xl font-black text-white">
                      Bu setteki terimler <span className="text-slate-600 font-normal text-base">({allCardsDb.length})</span>
                    </h2>
                    <div className="flex gap-2">
                      <button onClick={() => { setActiveMode("adding"); window.scrollTo({ top: 0 }); }} className="bg-[#1a1b41] hover:bg-[#2e3856] px-3 py-2 rounded-xl font-semibold transition-colors flex items-center gap-2 text-xs border border-white/5">
                        <Plus size={14} /> Terim Ekle
                      </button>
                      <button onClick={() => { setActiveMode("importing"); window.scrollTo({ top: 0 }); }} className="bg-[#1a1b41] hover:bg-[#2e3856] px-3 py-2 rounded-xl font-semibold transition-colors flex items-center gap-2 text-xs border border-white/5">
                        <Import size={14} /> İçe Aktar
                      </button>
                      <button onClick={() => setHideDefinitions((h) => !h)} className="bg-[#1a1b41] hover:bg-[#2e3856] px-3 py-2 rounded-xl font-semibold transition-colors text-xs border border-white/5 flex items-center gap-2">
                        {hideDefinitions ? <Eye size={14} /> : <EyeOff size={14} />}
                        {hideDefinitions ? "Göster" : "Gizle"}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {allCardsDb.map((card, index) => (
                      <div key={card.id} className="bg-[#1a1b41] rounded-xl border border-white/5 group overflow-hidden">
                        {editingCardId === card.id ? (
                          <div className="p-4 space-y-3">
                            <input autoFocus value={editFront} onChange={(e) => setEditFront(e.target.value)} placeholder="Ön yüz"
                              className="w-full bg-[#0a092d] border border-[#4255ff]/50 rounded-xl px-4 py-3 text-white outline-none focus:border-[#4255ff] text-sm" />
                            <input value={editBack} onChange={(e) => setEditBack(e.target.value)} placeholder="Arka yüz"
                              onKeyDown={(e) => { if (e.key === "Enter") saveEditCard(); if (e.key === "Escape") setEditingCardId(null); }}
                              className="w-full bg-[#0a092d] border border-[#4255ff]/50 rounded-xl px-4 py-3 text-white outline-none focus:border-[#4255ff] text-sm" />
                            <div className="flex gap-2 justify-end">
                              <button onClick={() => setEditingCardId(null)} className="px-4 py-2 text-slate-400 hover:text-white text-sm font-semibold rounded-xl hover:bg-white/5">İptal</button>
                              <button onClick={saveEditCard} className="px-4 py-2 bg-[#4255ff] hover:bg-blue-500 text-white text-sm font-bold rounded-xl flex items-center gap-2">
                                <Save size={13} /> Kaydet
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="p-4 flex items-center">
                            <span className="text-slate-700 font-bold w-8 text-xs flex-shrink-0">{index + 1}</span>
                            <div className="flex-1 grid grid-cols-2 gap-4">
                              <p className="text-white font-semibold text-sm border-r border-white/10 pr-4">{card.front}</p>
                              <p className={`text-slate-300 text-sm transition-all duration-300 ${hideDefinitions ? "blur-md hover:blur-none cursor-pointer select-none" : ""}`}>
                                {card.back}
                              </p>
                            </div>
                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity pl-3 items-center">
                              {card.status !== "new" && (
                                <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold mr-1 ${card.status === "known" ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-400"}`}>
                                  {card.status === "known" ? "✓" : "↺"}
                                </span>
                              )}
                              <button onClick={() => speak(card.front)} className="p-1.5 text-slate-600 hover:text-white rounded-lg hover:bg-white/5 transition-colors"><Volume2 size={14} /></button>
                              <button onClick={() => toggleStar(card.id!)} className={`p-1.5 rounded-lg hover:bg-white/5 transition-colors ${card.isStarred ? "text-yellow-400" : "text-slate-600 hover:text-white"}`}>
                                <Star size={14} fill={card.isStarred ? "currentColor" : "none"} />
                              </button>
                              <button onClick={() => startEditCard(card)} className="p-1.5 text-slate-600 hover:text-white rounded-lg hover:bg-white/5 transition-colors"><Edit2 size={14} /></button>
                              <button onClick={() => deleteCard(card.id!)} className="p-1.5 text-slate-600 hover:text-red-400 rounded-lg hover:bg-red-400/10 transition-colors"><Trash2 size={14} /></button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Bottom CTA */}
                  <div className="mt-10 flex justify-center">
                    <div className="relative">
                      <button
                        onClick={() => setShowActivityMenu((s) => !s)}
                        className="px-8 py-4 bg-[#4255ff] hover:bg-blue-500 text-white font-black rounded-2xl flex items-center gap-2 transition-all shadow-lg shadow-[#4255ff]/20 active:scale-95"
                      >
                        Bir aktiviteyle çalış
                        <ChevronDown size={18} className={`transition-transform ${showActivityMenu ? "rotate-180" : ""}`} />
                      </button>
                      {showActivityMenu && (
                        <div className="absolute bottom-full left-0 mb-2 w-full bg-[#1a1b41] rounded-2xl shadow-2xl border border-white/10 overflow-hidden z-50">
                          {([
                            ["learn", "Öğren", <BrainCircuit size={15} />, "text-purple-400"],
                            ["match", "Eşleştir", <LayoutGrid size={15} />, "text-cyan-400"],
                            ["blast", "Blast", <Rocket size={15} />, "text-orange-400"],
                          ] as [Mode, string, React.ReactNode, string][]).map(([m, label, icon, color], i, arr) => (
                            <button key={m} onClick={() => { goMode(m); setShowActivityMenu(false); }}
                              className={`w-full text-left p-4 hover:bg-[#2e3856] text-white font-bold flex items-center gap-3 transition-colors ${i < arr.length - 1 ? "border-b border-white/5" : ""}`}>
                              <span className={color}>{icon}</span> {label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ════════════════════════════════════════════════════════════
                LEARN MODE
            ════════════════════════════════════════════════════════════ */}
            {activeMode === "learn" && (
              <div className="flex-1 flex flex-col max-w-3xl mx-auto w-full space-y-5 mt-2">
                {cards.length < 4 || !safeCard ? (
                  <div className="text-center text-slate-400 p-10 bg-[#1a1b41] rounded-2xl border border-white/5">
                    <BrainCircuit size={40} className="mx-auto mb-3 text-slate-600" />
                    <p className="font-semibold">Öğren modu için en az 4 kart gereklidir.</p>
                  </div>
                ) : (
                  <>
                    {/* Streak */}
                    {learnStreak >= 3 && (
                      <div className="text-center text-orange-400 font-black text-sm animate-pulse">
                        🔥 {learnStreak} seri! {learnStreak >= 5 ? "Yazılı sorular geliyor..." : ""}
                      </div>
                    )}

                    {/* Progress */}
                    <div className="flex justify-between items-center text-xs text-slate-600 font-semibold">
                      <span>{currentIndex + 1} / {cards.length}</span>
                      <span className="flex items-center gap-1 text-emerald-500">
                        <CheckCircle2 size={11} /> {knownCount} biliyor
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-[#1a1b41] rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-[#4255ff] to-purple-500 rounded-full transition-all duration-500"
                        style={{ width: `${((currentIndex + 1) / cards.length) * 100}%` }} />
                    </div>

                    {/* Question card */}
                    <div className="p-10 bg-gradient-to-br from-[#1e2d4d] to-[#1a1b41] rounded-2xl shadow-xl flex flex-col items-center border border-white/5">
                      <span className="text-xs text-slate-600 mb-4 font-bold uppercase tracking-widest">Bu terimi tanımla</span>
                      <p className="text-3xl font-black text-white text-center">{safeCard.front}</p>
                    </div>

                    {/* Çoktan seçmeli */}
                    {learnMode === "multi" ? (
                      <div className="grid grid-cols-2 gap-3">
                        {learnOptions.map((opt, i) => {
                          const isSelectedOpt = opt === learnSelectedAnswer;
                          const isCorrectOpt = opt === safeCard.back;

                          let cls = "bg-[#1a1b41] border-transparent hover:border-[#4255ff]/40 text-slate-200 hover:bg-[#1e2055] cursor-pointer";

                          if (learnResult !== "none") {
                            if (isSelectedOpt && learnResult === "correct") {
                              // Sadece seçilen doğruysa yeşil
                              cls = "bg-emerald-500/15 border-emerald-500 text-emerald-300 cursor-default";
                            } else if (isSelectedOpt && learnResult === "wrong") {
                              // Yanlış seçim kırmızı
                              cls = "bg-red-500/15 border-red-500 text-red-400 cursor-default";
                            } else if (!isSelectedOpt && learnRevealAnswer && isCorrectOpt) {
                              // Yanlış cevap verdikten sonra doğruyu farklı göster (ama yeşil değil, beyaz border)
                              cls = "bg-white/5 border-white/40 text-white cursor-default";
                            } else {
                              cls = "opacity-30 border-transparent bg-[#1a1b41] text-slate-600 cursor-default";
                            }
                          }

                          return (
                            <button
                              key={i}
                              onClick={() => handleLearnAnswer(opt)}
                              disabled={learnResult !== "none"}
                              className={`p-5 rounded-xl text-left font-semibold border-2 transition-all duration-200 relative ${cls}`}
                            >
                              <span className="text-slate-600 mr-2 text-xs font-bold">{i + 1}</span>
                              {opt}
                              {/* Yanlış seçildikten sonra doğruyu ikon ile işaretle */}
                              {learnResult === "wrong" && isCorrectOpt && learnRevealAnswer && (
                                <span className="absolute top-2 right-2 text-white/50 text-xs font-bold">✓ doğru</span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      /* Yazılı */
                      <div className="space-y-3">
                        <input
                          type="text"
                          autoFocus
                          placeholder="Cevabınızı yazın..."
                          value={learnWritten}
                          onChange={(e) => setLearnWritten(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter" && learnResult === "none") handleLearnAnswer(learnWritten); }}
                          disabled={learnResult !== "none"}
                          className={`w-full bg-[#1a1b41] border-2 rounded-2xl p-5 text-white outline-none text-lg font-semibold transition-colors
                            ${learnResult === "correct" ? "border-emerald-500 bg-emerald-500/10" : learnResult === "wrong" ? "border-red-500 bg-red-500/10" : "border-white/10 focus:border-[#4255ff]"}`}
                        />
                        {learnResult === "none" && (
                          <button onClick={() => handleLearnAnswer(learnWritten)} className="w-full py-4 bg-[#4255ff] hover:bg-blue-500 text-white font-black rounded-2xl transition-colors">
                            Cevapla
                          </button>
                        )}
                        {learnResult === "wrong" && (
                          <div className="p-4 bg-[#1a1b41] border border-white/20 rounded-xl text-sm flex items-start gap-3">
                            <span className="text-slate-500 mt-0.5">Doğru cevap:</span>
                            <span className="text-white font-bold">{safeCard.back}</span>
                          </div>
                        )}
                        {learnResult === "correct" && (
                          <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-sm text-emerald-400 font-bold flex items-center gap-2">
                            <CheckCircle2 size={16} /> Harika! Doğru cevap.
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* ════════════════════════════════════════════════════════════
                MATCH MODE
            ════════════════════════════════════════════════════════════ */}
            {activeMode === "match" && (
              <div className="flex-1 flex flex-col max-w-5xl mx-auto w-full">
                {cards.length < 2 ? (
                  <div className="text-center text-slate-400 p-10 bg-[#1a1b41] rounded-2xl border border-white/5">
                    <LayoutGrid size={40} className="mx-auto mb-3 text-slate-600" />
                    <p className="font-semibold">Eşleştirme için en az 2 kart gereklidir.</p>
                  </div>
                ) : isMatchWon ? (
                  <div className="flex flex-col items-center justify-center space-y-5 py-16 bg-gradient-to-br from-[#1e2d4d] to-[#1a1b41] rounded-3xl border border-emerald-500/10">
                    <div className="text-7xl">🎉</div>
                    <h2 className="text-4xl font-black text-white">Mükemmel!</h2>
                    <div className="flex gap-4">
                      {[
                        ["Süre", fmtTime(matchTime), "text-white"],
                        ["Hata", String(matchMistakes), matchMistakes === 0 ? "text-emerald-400" : "text-amber-400"],
                        ...(matchBestTime ? [["En İyi", fmtTime(matchBestTime), "text-yellow-400"]] : []),
                      ].map(([l, v, tc]) => (
                        <div key={l} className="bg-[#0a092d] px-6 py-3 rounded-2xl text-center">
                          <p className="text-xs text-slate-500 mb-1">{l}</p>
                          <p className={`text-2xl font-black ${tc}`}>{v}</p>
                        </div>
                      ))}
                    </div>
                    <button onClick={startMatchGame} className="px-10 py-4 bg-[#4255ff] hover:bg-blue-500 rounded-2xl text-white font-black text-lg transition-all active:scale-95 shadow-lg">
                      Tekrar Oyna
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex justify-between items-center mb-4">
                      <span className="flex items-center gap-2 text-sm text-slate-400 font-semibold"><Clock size={14} /> {fmtTime(matchTime)}</span>
                      <button onClick={startMatchGame} className="text-xs text-slate-500 hover:text-white flex items-center gap-1 transition-colors bg-[#1a1b41] px-3 py-1.5 rounded-lg border border-white/5">
                        <RotateCcw size={12} /> Yeniden
                      </button>
                      <span className="text-sm text-slate-400 font-semibold">{matchMistakes} hata</span>
                    </div>
                    <div className="grid grid-cols-4 gap-3 w-full">
                      {matchTiles.map((tile) => (
                        <div
                          key={tile.id}
                          onClick={() => handleTileClick(tile)}
                          className="flex items-center justify-center p-4 rounded-xl cursor-pointer transition-all duration-200 select-none text-sm font-semibold text-center min-h-[80px]"
                          style={{
                            background: tile.state === "idle" ? "#1a1b41" : tile.state === "selected" ? "#4255ff" : tile.state === "error" ? "#7f1d1d" : "transparent",
                            border: tile.state === "selected" ? "2px solid rgba(255,255,255,0.2)" : tile.state === "error" ? "2px solid #ef4444" : "2px solid rgba(255,255,255,0.05)",
                            opacity: tile.state === "matched" ? 0 : 1,
                            pointerEvents: tile.state === "matched" ? "none" : "auto",
                            transform: tile.state === "selected" ? "scale(1.02)" : tile.state === "error" ? "scale(0.96)" : tile.state === "matched" ? "scale(0.9)" : "scale(1)",
                            color: "white",
                          }}
                        >
                          {tile.text}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ════════════════════════════════════════════════════════════
                TEST MODE
            ════════════════════════════════════════════════════════════ */}
            {activeMode === "test" && (
              <div className="flex-1 flex flex-col max-w-4xl mx-auto w-full">
                {cards.length < 4 ? (
                  <div className="text-center text-slate-400 p-10 bg-[#1a1b41] rounded-2xl border border-white/5">
                    <FileText size={40} className="mx-auto mb-3 text-slate-600" />
                    <p className="font-semibold">Test için en az 4 kart gereklidir.</p>
                  </div>
                ) : isTestSetup ? (
                  <div className="flex flex-col items-center mt-2">
                    <div className="bg-[#1a1b41] p-8 rounded-3xl w-full max-w-lg border border-white/10 shadow-2xl relative">
                      <button onClick={() => setActiveMode("flashcards")} className="absolute top-4 right-4 bg-white/10 hover:bg-white/20 p-2 rounded-full transition-colors">
                        <XIcon size={18} />
                      </button>
                      <p className="text-slate-500 text-xs font-bold uppercase tracking-widest mb-1">{activeDeck.name}</p>
                      <h1 className="text-3xl font-black text-white mb-7">Testini hazırla</h1>
                      <div className="space-y-0 divide-y divide-white/5">
                        <div className="flex justify-between items-center py-4">
                          <span className="font-semibold text-white text-sm">Soru Sayısı <span className="text-slate-600 font-normal">(maks. {cards.length})</span></span>
                          <input type="number" min={1} max={cards.length} value={testConfigCount} onChange={(e) => setTestConfigCount(Math.min(cards.length, Math.max(1, Number(e.target.value))))} className="w-16 bg-[#0a092d] text-white text-center rounded-lg p-2 outline-none font-bold border border-white/10 text-sm" />
                        </div>
                        <div className="flex justify-between items-center py-4">
                          <span className="font-semibold text-white text-sm">Çoktan Seçmeli</span>
                          <Toggle checked={testConfigMultichoice} onChange={() => setTestConfigMultichoice((v) => !v)} />
                        </div>
                        <div className="flex justify-between items-center py-4">
                          <span className="font-semibold text-white text-sm">Yazılı</span>
                          <Toggle checked={testConfigWritten} onChange={() => setTestConfigWritten((v) => !v)} />
                        </div>
                      </div>
                      <button onClick={generateTest} disabled={!testConfigMultichoice && !testConfigWritten} className="mt-7 w-full py-4 bg-[#4255ff] hover:bg-blue-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-white font-black rounded-2xl transition-all active:scale-95">
                        Teste Başla
                      </button>
                    </div>
                  </div>
                ) : testScore !== null ? (
                  <div className="flex flex-col items-center space-y-5 bg-gradient-to-br from-[#1e2d4d] to-[#1a1b41] rounded-3xl p-10 border border-white/5">
                    <div className={`text-8xl font-black ${testScore >= 70 ? "text-emerald-400" : testScore >= 40 ? "text-yellow-400" : "text-red-400"}`}>
                      %{testScore}
                    </div>
                    <p className="text-slate-400">{testQuestions.length} sorudan {Math.round((testScore / 100) * testQuestions.length)} doğru</p>
                    <div className="flex gap-3">
                      <button onClick={() => setTestShowReview((v) => !v)} className="px-5 py-3 bg-[#0a092d] rounded-xl text-white font-bold text-sm transition-colors hover:bg-[#1a1b41] border border-white/10 flex items-center gap-2">
                        {testShowReview ? <EyeOff size={14} /> : <Eye size={14} />} {testShowReview ? "Gizle" : "Cevapları Gör"}
                      </button>
                      <button onClick={() => setIsTestSetup(true)} className="px-5 py-3 bg-[#4255ff] hover:bg-blue-500 rounded-xl text-white font-bold text-sm transition-all active:scale-95">
                        Yeni Test
                      </button>
                    </div>
                    {testShowReview && (
                      <div className="w-full mt-2 space-y-2 max-h-96 overflow-y-auto pr-1">
                        {testQuestions.map((q, i) => {
                          const isCorrect = testAnswers[i].toLowerCase().trim() === q.card.back.toLowerCase().trim();
                          return (
                            <div key={i} className={`p-4 rounded-xl border text-sm ${isCorrect ? "border-emerald-500/20 bg-emerald-500/5" : "border-red-500/20 bg-red-500/5"}`}>
                              <p className="text-white font-semibold mb-1">{q.card.front}</p>
                              {!isCorrect && <p className="text-red-400 text-xs mb-0.5">Cevabın: {testAnswers[i] || "(boş)"}</p>}
                              <p className={`text-xs ${isCorrect ? "text-emerald-400" : "text-emerald-300"}`}>✓ {q.card.back}</p>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-5 pb-10">
                    <div className="flex items-center justify-between text-xs text-slate-500 font-semibold">
                      <span>{testAnswers.filter((a) => a !== "").length}/{testQuestions.length} cevaplandı</span>
                    </div>
                    <div className="w-full h-1 bg-[#1a1b41] rounded-full overflow-hidden">
                      <div className="h-full bg-yellow-400 rounded-full transition-all" style={{ width: `${(testAnswers.filter((a) => a !== "").length / testQuestions.length) * 100}%` }} />
                    </div>
                    {testQuestions.map((q, qi) => (
                      <div key={qi} className="bg-[#1a1b41] p-7 rounded-2xl border border-white/5">
                        <div className="flex justify-between items-start mb-4">
                          <p className="text-slate-500 text-xs font-bold">Soru {qi + 1}/{testQuestions.length}</p>
                          <span className={`text-xs px-2.5 py-1 rounded-full font-bold ${q.type === "multichoice" ? "bg-[#4255ff]/20 text-[#4255ff]" : "bg-purple-500/20 text-purple-400"}`}>
                            {q.type === "multichoice" ? "Çoktan Seçmeli" : "Yazılı"}
                          </span>
                        </div>
                        <p className="text-xl text-white font-bold mb-5">{q.card.front}</p>
                        {q.type === "multichoice" ? (
                          <div className="grid grid-cols-2 gap-3">
                            {q.options?.map((opt, oi) => (
                              <button key={oi} onClick={() => { const a = [...testAnswers]; a[qi] = opt; setTestAnswers(a); }}
                                className={`p-4 rounded-xl text-left font-semibold border-2 transition-all text-sm
                                  ${testAnswers[qi] === opt ? "bg-[#4255ff]/15 border-[#4255ff] text-[#8b98ff]" : "bg-[#0a092d] border-transparent text-slate-300 hover:border-slate-600"}`}>
                                {opt}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <input type="text" placeholder="Cevabınızı yazın..."
                            value={testAnswers[qi]}
                            onChange={(e) => { const a = [...testAnswers]; a[qi] = e.target.value; setTestAnswers(a); }}
                            className="w-full bg-[#0a092d] border border-white/10 rounded-xl p-4 text-white focus:border-[#4255ff] outline-none text-sm font-medium" />
                        )}
                      </div>
                    ))}
                    <button onClick={submitTest} className="w-full py-5 bg-emerald-500 hover:bg-emerald-400 text-white text-lg font-black rounded-2xl transition-all shadow-lg active:scale-[0.99]">
                      Testi Bitir ✓
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* ════════════════════════════════════════════════════════════
                BLAST MODE — filtreli
            ════════════════════════════════════════════════════════════ */}
            {activeMode === "blast" && (
              <div className="flex-1 flex flex-col max-w-5xl mx-auto w-full gap-3">
                {/* Blast filter bar — sadece intro/end'de göster */}
                {(blastState === "intro" || blastState === "end") && (
                  <div className="flex gap-2 bg-[#0f0e2a] p-1.5 rounded-xl border border-white/5 self-center">
                    {([
                      ["all", "Tüm Kartlar", allCardsDb.length],
                      ["starred", "⭐ Yıldızlılar", starredCount],
                      ["unknown", "❓ Bilinmeyenler", allCardsDb.filter((c) => c.status !== "known").length],
                    ] as [BlastFilter, string, number][]).map(([f, label, count]) => (
                      <button
                        key={f}
                        onClick={() => setBlastFilter(f)}
                        className="px-4 py-2 rounded-lg text-xs font-bold transition-all"
                        style={blastFilter === f
                          ? { backgroundColor: "#1a1b41", color: "#f97316", boxShadow: "0 2px 8px rgba(0,0,0,0.3)" }
                          : { color: "#64748b" }
                        }
                      >
                        {label} <span className="opacity-50">({count})</span>
                      </button>
                    ))}
                  </div>
                )}

                <div className="relative h-[580px] bg-[#07051a] rounded-3xl overflow-hidden border-2 border-[#1a1b41] shadow-2xl">
                  {blastCardsRef.current.length < 5 && blastState === "intro" ? (
                    <div className="flex-1 flex flex-col items-center justify-center absolute inset-0 gap-3 text-slate-400">
                      <Rocket size={40} className="text-slate-600" />
                      <p className="font-semibold">Bu filtre için en az 5 kart gereklidir.</p>
                      <p className="text-sm text-slate-600">Farklı bir filtre dene.</p>
                    </div>
                  ) : blastState === "intro" ? (
                    <div className="flex-1 flex flex-col items-center justify-center space-y-5 absolute inset-0 bg-[#07051a] z-20">
                      <div className="w-24 h-24 rounded-full bg-[#4255ff]/15 flex items-center justify-center">
                        <Rocket size={48} className="text-[#4255ff]" />
                      </div>
                      <h2 className="text-5xl font-black text-white">Blast</h2>
                      <p className="text-slate-500 text-center max-w-xs px-6 text-sm">Fare ile hedef al ve tıkla → lazer ateşle! Doğru cevabın yazdığı meteoru patlat.</p>
                      <div className="flex items-center gap-3 text-xs text-slate-600">
                        <span className="bg-[#1a1b41] px-3 py-1.5 rounded-lg border border-white/5">
                          {blastFilter === "all" ? "Tüm Kartlar" : blastFilter === "starred" ? "⭐ Yıldızlılar" : "❓ Bilinmeyenler"} · {blastCardsRef.current.length} kart
                        </span>
                      </div>
                      {blastMaxScore > 0 && (
                        <p className="text-yellow-400 text-sm font-bold">🏆 En iyi: {blastMaxScore} puan · Seviye {blastMaxLevel}</p>
                      )}
                      <button onClick={startBlastGame} className="px-12 py-4 bg-[#4255ff] hover:bg-blue-500 rounded-2xl text-white font-black text-xl mt-2 transition-all active:scale-95 shadow-lg shadow-[#4255ff]/20">
                        Başla
                      </button>
                    </div>

                  ) : blastState === "end" ? (
                    <div className="flex-1 flex flex-col items-center justify-center absolute inset-0 bg-[#07051a] z-20 p-8">
                      <Trophy size={56} className="text-yellow-400 mb-4" />
                      <h2 className="text-3xl font-black text-white mb-1">Oyun Bitti!</h2>
                      <p className="text-slate-500 text-sm mb-7">10 soru tamamlandı</p>
                      <div className="grid grid-cols-2 gap-3 max-w-sm w-full mb-7">
                        {([
                          ["Puanın", blastScore, "#172554"],
                          ["Seviye", blastLevel, "#172554"],
                          ["En Yüksek", blastMaxScore, "#3b0764"],
                          ["En İyi Seviye", blastMaxLevel, "#3b0764"],
                        ] as [string, number, string][]).map(([l, v, bg]) => (
                          <div key={l} className="p-5 rounded-2xl text-center" style={{ backgroundColor: bg }}>
                            <p className="text-xs text-slate-400 mb-1">{l}</p>
                            <p className="text-4xl font-black text-white">{v}</p>
                          </div>
                        ))}
                      </div>
                      <div className="flex flex-col gap-2 w-full max-w-sm">
                        <button onClick={startBlastGame} className="w-full py-4 bg-[#4255ff] hover:bg-blue-500 rounded-2xl text-white font-black transition-all active:scale-95">Tekrar Oyna</button>
                        <button onClick={() => goMode("learn")} className="w-full py-3 text-slate-500 hover:text-white font-semibold text-sm transition-colors">Öğren moduna geç</button>
                      </div>
                    </div>

                  ) : (
                    <>
                      {/* Question bar */}
                      <div className="w-full bg-gradient-to-r from-[#2a2bb5] to-[#1a1b8a] py-4 flex flex-col items-center z-10 border-b border-indigo-500/20 pointer-events-none">
                        <span className="text-2xl font-black text-white tracking-wide drop-shadow">{blastCurrentCard?.front}</span>
                      </div>
                      {/* Progress bar */}
                      <div className="w-full h-1.5 bg-[#1a1b41] pointer-events-none">
                        <div className="h-full bg-cyan-400 transition-all duration-500" style={{ width: `${(blastQuestionCount / 10) * 100}%` }} />
                      </div>

                      {/* Game area */}
                      <div
                        className="flex-1 relative overflow-hidden bg-gradient-to-b from-[#0f1136] to-[#07051a] cursor-crosshair"
                        style={{ height: "calc(100% - 72px)" }}
                        onMouseMove={handleBlastMouseMove}
                        onClick={handleBlastClick}
                      >
                        {/* Stars bg */}
                        <div className="absolute inset-0 opacity-20 pointer-events-none" style={{ backgroundImage: "radial-gradient(1px 1px at 15% 25%, white 0%, transparent 100%), radial-gradient(1px 1px at 75% 15%, white 0%, transparent 100%), radial-gradient(1px 1px at 45% 55%, white 0%, transparent 100%), radial-gradient(1px 1px at 85% 65%, white 0%, transparent 100%), radial-gradient(1px 1px at 30% 80%, white 0%, transparent 100%)" }} />

                        {/* Lasers */}
                        {blastLasers.map((l) => (
                          <div key={l.id} className="absolute pointer-events-none"
                            style={{ left: `${l.x}%`, top: `${l.y}%`, width: "28px", height: "3px", background: "linear-gradient(90deg, transparent, #ff5555, #ffaaaa)", borderRadius: "999px", boxShadow: "0 0 8px #ff4444, 0 0 16px rgba(255,68,68,0.4)", transform: `translate(-50%, -50%) rotate(${l.angle}rad)`, transformOrigin: "left center" }} />
                        ))}

                        {/* Combo display */}
                        {blastComboDisplay && (
                          <div
                            className="absolute pointer-events-none font-black text-yellow-400 text-2xl z-20"
                            style={{ left: `${blastComboDisplay.x}%`, top: `${blastComboDisplay.y}%`, transform: "translate(-50%,-100%)", animation: "floatUp 0.8s ease-out forwards", textShadow: "0 0 10px rgba(250,204,21,0.8)" }}
                          >
                            +{blastComboDisplay.val}
                            {blastComboDisplay.val > 10 && <span className="text-sm ml-1">🔥</span>}
                          </div>
                        )}

                        {/* Meteors */}
                        {blastMeteors.map((m) => (
                          <button key={m.id}
                            onClick={(e) => { e.stopPropagation(); handleMeteorClick(m); }}
                            className="absolute w-24 h-24 flex items-center justify-center p-3 rounded-full text-white font-bold text-center text-xs leading-tight select-none pointer-events-auto hover:scale-110 active:scale-90 transition-transform"
                            style={{
                              top: `${m.y}%`, left: `${m.x}%`, transform: "translate(-50%, -50%)",
                              transition: "top 0.05s linear, left 0.05s linear",
                              background: "radial-gradient(circle at 35% 35%, #5b62b5, #2a2c6a)",
                              boxShadow: "0 0 20px rgba(66,85,255,0.15), inset -3px -3px 10px rgba(0,0,0,0.4)",
                              border: "2px solid rgba(255,255,255,0.05)",
                            }}>
                            <span className="z-10 drop-shadow pointer-events-none">{m.text}</span>
                          </button>
                        ))}

                        {/* Spaceship */}
                        <div className="absolute bottom-5 left-1/2 -translate-x-1/2 w-14 h-14 rounded-full bg-emerald-400/90 border-4 border-emerald-200 flex items-center justify-center z-10 pointer-events-none shadow-lg shadow-emerald-400/20">
                          <div className="absolute w-10 h-3.5 bg-emerald-300 rounded-r-full"
                            style={{ left: "50%", top: "50%", transformOrigin: "left center", transform: `translate(0, -50%) rotate(${blastTurretAngle}rad)`, boxShadow: "0 0 10px rgba(52,211,153,0.8)" }} />
                          <Target size={22} className="text-white z-10" />
                        </div>

                        {/* HUD */}
                        <div className="absolute top-3 left-3 flex items-center gap-2 pointer-events-none">
                          <div className="bg-black/40 backdrop-blur-sm px-3 py-1.5 rounded-xl">
                            <span className="text-yellow-400 font-black text-sm">Lv.{blastLevel}</span>
                          </div>
                          {blastCombo >= 2 && (
                            <div className="bg-black/40 backdrop-blur-sm px-3 py-1.5 rounded-xl">
                              <span className="text-orange-400 font-black text-xs">🔥 x{blastCombo}</span>
                            </div>
                          )}
                        </div>
                        <div className="absolute top-3 right-3 bg-black/40 backdrop-blur-sm px-3 py-1.5 rounded-xl pointer-events-none">
                          <span className="text-white font-black text-sm">{blastScore} puan</span>
                        </div>
                        <div className="absolute bottom-7 right-3 text-slate-700 font-bold text-xs pointer-events-none">{blastQuestionCount}/10</div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* ════════════════════════════════════════════════════════════
                ADD / IMPORT
            ════════════════════════════════════════════════════════════ */}
            {(activeMode === "adding" || activeMode === "importing") && (
              <div className="flex-1 flex flex-col items-center mt-6 max-w-2xl mx-auto w-full">
                <div className="w-full bg-[#1a1b41] p-8 rounded-2xl border border-white/5 shadow-2xl">
                  <h2 className="text-2xl font-black text-white mb-6 flex justify-between items-center">
                    {activeMode === "adding" ? "Yeni Kart Ekle" : "Kartları İçe Aktar"}
                    <button onClick={() => setActiveMode("flashcards")} className="text-slate-500 hover:text-red-400 transition-colors bg-white/5 p-2 rounded-xl">
                      <XIcon size={18} />
                    </button>
                  </h2>
                  {activeMode === "adding" ? (
                    <div className="space-y-4">
                      <div>
                        <label className="text-xs text-slate-500 font-bold uppercase tracking-widest mb-2 block">Terim (Ön Yüz)</label>
                        <input type="text" placeholder="örn: apple" value={frontInput} onChange={(e) => setFrontInput(e.target.value)}
                          className="w-full p-4 rounded-xl bg-[#0a092d] border border-white/10 text-white focus:border-[#4255ff] outline-none text-sm font-medium placeholder-slate-700" />
                      </div>
                      <div>
                        <label className="text-xs text-slate-500 font-bold uppercase tracking-widest mb-2 block">Tanım (Arka Yüz)</label>
                        <input type="text" placeholder="örn: elma" value={backInput} onChange={(e) => setBackInput(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") handleAddCard(); }}
                          className="w-full p-4 rounded-xl bg-[#0a092d] border border-white/10 text-white focus:border-[#4255ff] outline-none text-sm font-medium placeholder-slate-700" />
                      </div>
                      <button onClick={handleAddCard} className="w-full py-4 bg-[#4255ff] hover:bg-blue-500 text-white rounded-xl font-black transition-all active:scale-[0.99] flex items-center justify-center gap-2">
                        <Plus size={18} /> Kaydet
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="bg-[#0a092d] rounded-xl p-4 border border-white/5 text-xs text-slate-500">
                        <p className="mb-2 font-semibold">Her satıra bir kart. Ön ve arkayı şunlarla ayırın:</p>
                        <div className="flex gap-2">
                          {["Tab", " - ", ";"].map((s) => <kbd key={s} className="bg-[#1a1b41] border border-white/10 px-2 py-0.5 rounded font-mono">{s}</kbd>)}
                        </div>
                      </div>
                      <textarea
                        placeholder={"apple\telma\nhouse\tev\ncar\taraba"}
                        rows={8}
                        value={importInput}
                        onChange={(e) => setImportInput(e.target.value)}
                        className="w-full p-4 rounded-xl bg-[#0a092d] border border-white/10 text-white resize-none outline-none focus:border-[#4255ff] font-mono text-sm placeholder-slate-700"
                      />
                      <button onClick={handleImportCards} className="w-full py-4 bg-[#4255ff] hover:bg-blue-500 text-white rounded-xl font-black flex justify-center items-center gap-2 transition-all active:scale-[0.99]">
                        <Import size={18} /> İçe Aktar
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <style>{`
        @keyframes slideIn {
          from { opacity: 0; transform: translateX(60px) scale(0.95); }
          to { opacity: 1; transform: translateX(0) scale(1); }
        }
        @keyframes floatUp {
          0% { opacity: 1; transform: translate(-50%, -100%) scale(1); }
          100% { opacity: 0; transform: translate(-50%, -200%) scale(1.3); }
        }
      `}</style>
    </div>
  );
}
