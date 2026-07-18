/* ===================================================================
   cards.js
   Storage layer for the Tag ID -> action mappings. Lives in
   localStorage so it works offline once loaded and needs no backend.

   Card shape:
   {
     id: string           (internal id, not the tag id)
     tagId: string         (the NFC tag's UID, e.g. "04A2B3C1")
     label: string          (what Janae's helpers see, e.g. "Twinkle Twinkle")
     icon: string           (one emoji)
     color: string          (hex, background for the reveal screen)
     actionType: "song" | "playlist" | "phrase"
     spotifyUri: string     (for song/playlist)
     phraseText: string     (for phrase)
   }
   =================================================================== */

const CardStore = (() => {
  const KEY = "jtp_cards";
  const PALETTE = [
    "#ff6b6b",
    "#4ecdc4",
    "#ffc857",
    "#a78bfa",
    "#6ee7b7",
    "#f472b6",
    "#67c8ff",
  ];

  function all() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveAll(cards) {
    localStorage.setItem(KEY, JSON.stringify(cards));
  }

  function nextColor() {
    const cards = all();
    return PALETTE[cards.length % PALETTE.length];
  }

  function findByTagId(tagId) {
    const normalized = String(tagId).trim().toUpperCase();
    return all().find((c) => c.tagId.toUpperCase() === normalized) || null;
  }

  function upsert(card) {
    const cards = all();
    const idx = cards.findIndex((c) => c.id === card.id);
    if (idx === -1) {
      cards.push(card);
    } else {
      cards[idx] = card;
    }
    saveAll(cards);
  }

  function remove(id) {
    saveAll(all().filter((c) => c.id !== id));
  }

  function newId() {
    return "card_" + Math.random().toString(36).slice(2, 10);
  }

  function exportJson() {
    return JSON.stringify(all(), null, 2);
  }

  function importJson(json) {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) throw new Error("Not a valid card list.");
    saveAll(parsed);
  }

  return {
    all,
    saveAll,
    nextColor,
    findByTagId,
    upsert,
    remove,
    newId,
    exportJson,
    importJson,
  };
})();
