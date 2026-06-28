// permissions.ts — קטלוג ההרשאות (capabilities) והגדרת תפקידי המערכת המובנים.
// מקור האמת לפי פרק 16 באפיון ("משתמשים והרשאות").
// עיקרון-על: ברירת המחדל היא תמיד "אין גישה ללא הרשאה מפורשת" (default-deny),
// והרשאה מינימלית — נותנים לכל תפקיד בדיוק את מה שצריך, לא יותר.

// כל מפתח הרשאה הוא יכולת אחת ברורה במערכת.
export const PERMISSIONS = {
  FILES_VIEW: 'files.view', // צפייה בקבצים מורשים
  FILES_UPLOAD: 'files.upload', // העלאת קבצים
  FILES_RENAME: 'files.rename', // שינוי שם
  FILES_MOVE: 'files.move', // העברה בין תיקיות
  FILES_TAG: 'files.tag', // ניהול תגיות על קבצים
  FILES_DELETE: 'files.delete', // מחיקה (לסל המחזור)
  FILES_RESTORE: 'files.restore', // שחזור ממחיקה
  FILES_IMPORT: 'files.import', // ייבוא קבצים מדיסקים פיזיים
  FOLDERS_MANAGE: 'folders.manage', // ניהול תיקיות (יצירה / שינוי שם / העברה / מחיקת תיקייה)
  FILES_DOWNLOAD_SOURCE: 'files.download_source', // הורדת קובץ המקור
  FILES_DOWNLOAD_EDITED: 'files.download_edited', // הורדת גרסה ערוכה
  LINKS_MANAGE: 'links.manage', // יצירה וביטול של קישורי שיתוף
  MEDIA_EDIT: 'media.edit', // עריכת תמונה ווידאו
  WATERMARK_CREATE: 'watermark.create', // יצירת סימני מים
  PEOPLE_MANAGE: 'people.manage', // ניהול זיהוי אנשים ופנים
  LOGS_VIEW: 'logs.view', // צפייה בלוגים
  DISKS_MANAGE: 'disks.manage', // ניהול דיסקים פיזיים וסנכרון
  BACKUPS_MANAGE: 'backups.manage', // ניהול גיבויים
  USERS_MANAGE: 'users.manage', // ניהול משתמשים והרשאות
  SECURITY_MANAGE: 'security.manage', // הגדרות אבטחה
  SETTINGS_MANAGE: 'settings.manage', // הגדרות מערכת כלליות
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

// כל ההרשאות הקיימות — לשימוש בתפקיד "בעלים" וב-UI.
export const ALL_PERMISSIONS: PermissionKey[] = Object.values(PERMISSIONS);

// תוויות בעברית לכל הרשאה — להצגה במסכי הניהול.
export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  [PERMISSIONS.FILES_VIEW]: 'צפייה בקבצים',
  [PERMISSIONS.FILES_UPLOAD]: 'העלאה',
  [PERMISSIONS.FILES_RENAME]: 'שינוי שם',
  [PERMISSIONS.FILES_MOVE]: 'העברה',
  [PERMISSIONS.FILES_TAG]: 'תגיות',
  [PERMISSIONS.FILES_DELETE]: 'מחיקה',
  [PERMISSIONS.FILES_RESTORE]: 'שחזור',
  [PERMISSIONS.FILES_IMPORT]: 'ייבוא מדיסקים',
  [PERMISSIONS.FOLDERS_MANAGE]: 'ניהול תיקיות',
  [PERMISSIONS.FILES_DOWNLOAD_SOURCE]: 'הורדת מקור',
  [PERMISSIONS.FILES_DOWNLOAD_EDITED]: 'הורדת גרסה ערוכה',
  [PERMISSIONS.LINKS_MANAGE]: 'קישורי שיתוף',
  [PERMISSIONS.MEDIA_EDIT]: 'עריכת תמונה ווידאו',
  [PERMISSIONS.WATERMARK_CREATE]: 'יצירת סימן מים',
  [PERMISSIONS.PEOPLE_MANAGE]: 'ניהול זיהוי אנשים',
  [PERMISSIONS.LOGS_VIEW]: 'צפייה בלוגים',
  [PERMISSIONS.DISKS_MANAGE]: 'ניהול דיסקים',
  [PERMISSIONS.BACKUPS_MANAGE]: 'ניהול גיבויים',
  [PERMISSIONS.USERS_MANAGE]: 'ניהול משתמשים והרשאות',
  [PERMISSIONS.SECURITY_MANAGE]: 'אבטחה',
  [PERMISSIONS.SETTINGS_MANAGE]: 'הגדרות',
};

// הגדרת תפקיד מובנה.
export interface RoleSeed {
  key: string; // מזהה יציב באנגלית
  name: string; // שם להצגה בעברית
  description: string;
  permissions: PermissionKey[];
  isOwner?: boolean; // בעלים — עוקף את כל הבדיקות
}

const P = PERMISSIONS;

// 8 התפקידים המובנים — בדיוק לפי טבלת התפקידים באפיון (פרק 16).
export const ROLE_SEEDS: RoleSeed[] = [
  {
    key: 'owner',
    name: 'בעלים',
    description: 'הכול — שליטה מלאה במערכת.',
    permissions: ALL_PERMISSIONS,
    isOwner: true,
  },
  {
    key: 'system_admin',
    name: 'מנהל מערכת',
    description: 'משתמשים, אבטחה, לוגים, גיבויים והגדרות.',
    permissions: [
      P.USERS_MANAGE,
      P.SECURITY_MANAGE,
      P.LOGS_VIEW,
      P.BACKUPS_MANAGE,
      P.DISKS_MANAGE,
      P.SETTINGS_MANAGE,
    ],
  },
  {
    key: 'content_manager',
    name: 'מנהל תוכן',
    description: 'העלאה, תגיות, כפילויות, עריכה וסימני מים.',
    permissions: [
      P.FILES_VIEW,
      P.FILES_UPLOAD,
      P.FILES_IMPORT,
      P.FILES_RENAME,
      P.FILES_MOVE,
      P.FILES_TAG,
      P.FILES_DELETE,
      P.FILES_RESTORE,
      P.FOLDERS_MANAGE,
      P.FILES_DOWNLOAD_SOURCE,
      P.FILES_DOWNLOAD_EDITED,
      P.MEDIA_EDIT,
      P.WATERMARK_CREATE,
      P.LINKS_MANAGE,
    ],
  },
  {
    key: 'editor',
    name: 'עורך',
    description: 'העלאה ועריכה באזורים מורשים בלבד.',
    permissions: [P.FILES_VIEW, P.FILES_UPLOAD, P.FILES_TAG, P.MEDIA_EDIT],
  },
  {
    key: 'internal_viewer',
    name: 'צופה פנימי',
    description: 'צפייה בלבד בתוכן מורשה.',
    permissions: [P.FILES_VIEW],
  },
  {
    key: 'external_viewer',
    name: 'צופה חיצוני',
    description: 'צפייה מוגבלת דרך ה-Reader.',
    permissions: [P.FILES_VIEW],
  },
  {
    key: 'log_auditor',
    name: 'מבקר לוגים',
    description: 'צפייה בלוגים בלבד.',
    permissions: [P.LOGS_VIEW],
  },
  {
    key: 'backup_operator',
    name: 'מפעיל גיבוי',
    description: 'ניהול דיסקים וסנכרון בלבד.',
    permissions: [P.DISKS_MANAGE, P.BACKUPS_MANAGE],
  },
];

// מפתח התפקיד שמקבל המשתמש הראשון במערכת (בעלים), והברירת-מחדל לשאר (המצומצם ביותר).
export const OWNER_ROLE_KEY = 'owner';
export const DEFAULT_ROLE_KEY = 'internal_viewer';
