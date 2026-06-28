// tag-catalog.ts — סוגי התגיות ורמות הרגישות המותרות (לפי האפיון, פרק תגיות).
// רמת הרגישות היא שדה נשלט (ולא תגית חופשית) — כי היא אמורה להשפיע בעתיד על הרשאות וסימני מים.

export const TAG_TYPES = [
  { key: 'regular', label: 'רגילה' },
  { key: 'project', label: 'פרויקט' },
  { key: 'person', label: 'אדם' },
  { key: 'status', label: 'סטטוס' },
  { key: 'edit', label: 'עריכה' },
  { key: 'backup', label: 'גיבוי' },
];
export const TAG_TYPE_KEYS: string[] = TAG_TYPES.map((t) => t.key);

// תואם ל-enum Sensitivity במסד (NONE / LOW / MEDIUM / HIGH).
export const SENSITIVITY_LEVELS = [
  { key: 'NONE', label: 'ללא' },
  { key: 'LOW', label: 'נמוכה' },
  { key: 'MEDIUM', label: 'בינונית' },
  { key: 'HIGH', label: 'גבוהה' },
];
export const SENSITIVITY_KEYS: string[] = SENSITIVITY_LEVELS.map((s) => s.key);
