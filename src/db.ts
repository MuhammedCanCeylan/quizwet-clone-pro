import Dexie, { Table } from 'dexie';

export interface Deck {
  id?: number;
  name: string;
  description?: string;
}

export interface Card {
  id?: number;
  deckId: number;
  front: string;
  back: string;
  status: 'new' | 'learning' | 'known';
  isStarred: boolean;
}

export class QuizletCloneDB extends Dexie {
  decks!: Table<Deck>;
  cards!: Table<Card>;

  constructor() {
    super('QuizletCloneDB');
    this.version(3).stores({
      decks: '++id, name',
      cards: '++id, deckId, front, back, status, isStarred'
    });
  }
}

export const db = new QuizletCloneDB();

// YENİ: VARSAYILAN SETLERİ OLUŞTURMA SİSTEMİ
export const seedDatabaseIfNeeded = async () => {
  const deckCount = await db.decks.count();
  
  if (deckCount === 0) {
    // 1. Varsayılan Set: Fiiller
    const verbsDeckId = await db.decks.add({ name: "En Çok Kullanılan Fiiller", description: "Günlük hayatta en sık kullanılan İngilizce fiiller ve anlamları." });
    await db.cards.bulkAdd([
      { deckId: verbsDeckId, front: "accept", back: "kabul etmek", status: 'new', isStarred: false },
      { deckId: verbsDeckId, front: "allow", back: "izin vermek", status: 'new', isStarred: false },
      { deckId: verbsDeckId, front: "ask", back: "sormak, istemek", status: 'new', isStarred: false },
      { deckId: verbsDeckId, front: "believe", back: "inanmak", status: 'new', isStarred: false },
      { deckId: verbsDeckId, front: "borrow", back: "ödünç almak", status: 'new', isStarred: false },
      { deckId: verbsDeckId, front: "break", back: "kırmak", status: 'new', isStarred: false },
      { deckId: verbsDeckId, front: "bring", back: "getirmek", status: 'new', isStarred: false },
      { deckId: verbsDeckId, front: "buy", back: "satın almak", status: 'new', isStarred: false },
      { deckId: verbsDeckId, front: "catch", back: "yakalamak", status: 'new', isStarred: false },
      { deckId: verbsDeckId, front: "change", back: "değiştirmek", status: 'new', isStarred: false },
    ]);

    // 2. Varsayılan Set: Sıfatlar
    const adjDeckId = await db.decks.add({ name: "Temel İngilizce Sıfatlar", description: "Bilinmesi gereken önemli sıfatlar." });
    await db.cards.bulkAdd([
      { deckId: adjDeckId, front: "beautiful", back: "güzel", status: 'new', isStarred: false },
      { deckId: adjDeckId, front: "brave", back: "cesur", status: 'new', isStarred: false },
      { deckId: adjDeckId, front: "clever", back: "zeki", status: 'new', isStarred: false },
      { deckId: adjDeckId, front: "dangerous", back: "tehlikeli", status: 'new', isStarred: false },
      { deckId: adjDeckId, front: "easy", back: "kolay", status: 'new', isStarred: false },
    ]);
  }
};