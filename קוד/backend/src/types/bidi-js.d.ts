// [שינוי 2026-06-25] הצהרת טיפוסים מקומית ל-bidi-js (החבילה אינה כוללת טיפוסים).
declare module 'bidi-js' {
  export interface EmbeddingLevels {
    levels: Uint8Array;
    paragraphs: Array<{ start: number; end: number; level: number }>;
  }
  export interface Bidi {
    getEmbeddingLevels(text: string, baseDirection?: 'ltr' | 'rtl' | 'auto'): EmbeddingLevels;
    getReorderSegments(text: string, embeddingLevels: EmbeddingLevels, start?: number, end?: number): Array<[number, number]>;
    getMirroredCharactersMap(text: string, embeddingLevels: EmbeddingLevels, start?: number, end?: number): Map<number, string>;
  }
  export default function bidiFactory(): Bidi;
}
