// configuration.ts — תצורה מרכזית. קוראת ממשתני הסביבה (.env) ומספקת אותם לשאר השרת.
// שאר הקוד מתייחס לכאן ולא קורא משתני סביבה ישירות — כדי לא לשכפל ערכים.
export default () => {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const jwtSecret = process.env.JWT_SECRET;
  // אבטחה: אסור להשתמש בסוד JWT חלש/ברירת-מחדל. בייצור — נכשלים מיד; בפיתוח — אזהרה בולטת.
  if (!jwtSecret || jwtSecret === 'dev_insecure_change_me') {
    if (nodeEnv === 'production') {
      throw new Error('JWT_SECRET חייב להיות מוגדר לערך חזק בסביבת ייצור (production).');
    }
    // eslint-disable-next-line no-console
    console.warn('[אבטחה] JWT_SECRET אינו מוגדר — נעשה שימוש בסוד פיתוח לא-מאובטח. הגדר JWT_SECRET חזק לפני העלאה לשרת.');
  }
  return {
    nodeEnv,
    port: parseInt(process.env.BACKEND_PORT ?? '4000', 10),
    databaseUrl: process.env.DATABASE_URL,
    redisUrl: process.env.REDIS_URL ?? 'redis://redis:6379',
    jwtSecret: jwtSecret ?? 'dev_insecure_change_me',
    // נתיב אחסון הקבצים: <dir>/quarantine להסגר, <dir>/files לאחסון הקבוע (לפי hash).
    storageDir: process.env.STORAGE_DIR ?? '/data',
    mail: {
      host: process.env.MAIL_HOST ?? 'mailpit',
      port: parseInt(process.env.MAIL_PORT ?? '1025', 10),
      from: process.env.MAIL_FROM ?? 'no-reply@archive.local',
    },
  };
};
