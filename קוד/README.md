# קוד מערכת הארכיון

שלד המערכת: שרת (NestJS), אתר (Next.js), מסד נתונים (PostgreSQL), תורים (Redis), וכלי לצפייה במסד (Adminer) — הכול ב-Docker.

## איך מריצים (פעם ראשונה)

1. התקן **Docker Desktop** ל-Windows והפעל אותו.
2. בתיקייה הזו, העתק את הקובץ `.env.example` לקובץ חדש בשם `.env`.
3. פתח שורת פקודה בתיקייה הזו והרץ:

   ```
   docker compose up --build
   ```

4. כשהכול עולה (זה ייקח כמה דקות בפעם הראשונה), פתח בדפדפן:
   - לוח הבקרה (האתר): http://localhost:3000
   - בדיקת תקינות השרת: http://localhost:4000/health
   - צפייה במסד הנתונים (Adminer): http://localhost:8080

   ב-Adminer מתחברים כך: System = PostgreSQL, Server = `postgres`, ואת המשתמש/סיסמה/בסיס לוקחים מקובץ `.env`.

## איך עוצרים
בשורת הפקודה: `Ctrl + C`, ואז `docker compose down`.

## מבנה התיקיות
- `docker-compose.yml` — מגדיר את כל הקונטיינרים.
- `.env.example` — תצורה מרכזית (העתק ל-`.env`).
- `backend/` — השרת (NestJS) + סכמת מסד הנתונים (Prisma).
- `frontend/` — האתר (Next.js).

## הערה למתכנת
מחסנית: NestJS + Prisma + Next.js (TypeScript). `backend/prisma/schema.prisma` הוא מקור האמת למבנה מסד הנתונים. כל התצורה מרוכזת ב-`.env` ונקראת דרך `backend/src/config/configuration.ts` (צד שרת) ו-`frontend/src/lib/api.ts` (צד אתר) — אין ערכים משוכפלים. זהו שלב 0.3 + תחילת 1.1 בתוכנית העבודה.
