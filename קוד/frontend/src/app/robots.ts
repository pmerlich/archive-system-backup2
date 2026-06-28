// robots.ts — מייצר robots.txt שמורה לכל מנועי החיפוש לא לסרוק ולא לאנדקס את האתר כלל.
// יחד עם meta robots (ב-layout) וכותרת X-Robots-Tag (ב-next.config) — שלוש שכבות הגנה
// שמבטיחות שהאתר לא יופיע בחיפוש גוגל או בכל מנוע חיפוש אחר.
import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', disallow: '/' }],
  };
}
