'use client';
// duplicates/page.tsx — מסך כפילויות מלאות (מוגן): קבצים שונים עם תוכן זהה (אותו hash).
// צפייה דורשת "צפייה בקבצים"; מיזוג (שמירת אחד, הסרת השאר) דורש הרשאת "מחיקה".
import { useEffect, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import {
  getMe, getToken, logout, hasPermission,
  listDuplicates, mergeDuplicates,
  type AuthUser, type DuplicateGroup,
} from '@/lib/api';

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let n = bytes / 1024, i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(1)} ${units[i]}`;
}

export default function DuplicatesPage() {
  const router = useRouter();
  const [me, setMe] = useState<AuthUser | null>(null);
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [keep, setKeep] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState('');

  const canMerge = hasPermission(me, 'files.delete');

  function initKeep(gs: DuplicateGroup[]): void {
    const k: Record<string, string> = {};
    gs.forEach((g) => { k[g.hash] = g.files[0]?.id; });
    setKeep(k);
  }

  useEffect(() => {
    if (!getToken()) { router.replace('/login'); return; }
    getMe()
      .then(async (u) => {
        setMe(u);
        if (!hasPermission(u, 'files.view')) { setDenied(true); return; }
        const gs = await listDuplicates();
        setGroups(gs); initKeep(gs);
      })
      .catch(() => { logout(); router.replace('/login'); })
      .finally(() => setLoading(false));
  }, [router]);

  async function reload(): Promise<void> {
    const gs = await listDuplicates();
    setGroups(gs); initKeep(gs);
  }

  async function onMerge(g: DuplicateGroup): Promise<void> {
    const keepId = keep[g.hash] ?? g.files[0].id;
    const removeIds = g.files.filter((f) => f.id !== keepId).map((f) => f.id);
    if (removeIds.length === 0) return;
    if (!window.confirm(`לשמור קובץ אחד ולהסיר ${removeIds.length} עותקים זהים? התגיות שלהם יתווספו לקובץ שנשמר, והעותקים יעברו לסל המחזור.`)) return;
    setBusy(g.hash);
    try { await mergeDuplicates(keepId, removeIds); await reload(); }
    catch (err: any) { window.alert(err.message || 'שגיאה'); }
    finally { setBusy(''); }
  }

  if (loading) return <main style={{ maxWidth: 1000, margin: '40px auto', padding: 24, color: 'var(--muted)' }}>טוען…</main>;
  if (denied) {
    return (
      <main style={{ maxWidth: 1000, margin: '40px auto', padding: 24 }}>
        <section style={card}><h2 style={{ marginTop: 0 }}>אין הרשאה</h2>
          <p style={{ color: 'var(--muted)' }}>אין לך הרשאת צפייה בקבצים.</p>
          <button onClick={() => router.push('/')} style={btn}>חזרה ללוח הבקרה</button>
        </section>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 1000, margin: '40px auto', padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ color: 'var(--accent)', marginBottom: 4 }}>כפילויות</h1>
          <p style={{ color: 'var(--muted)', marginTop: 0 }}>קבצים שונים עם תוכן זהה לחלוטין (אותו טביעת-אצבע)</p>
        </div>
        <button onClick={() => router.push('/')} style={btn}>חזרה ללוח הבקרה</button>
      </div>

      {groups.length === 0 ? (
        <section style={card}><p style={{ margin: 0, color: 'var(--muted)' }}>לא נמצאו כפילויות — כל הקבצים ייחודיים. 🎉</p></section>
      ) : (
        <p style={{ color: 'var(--muted)', fontSize: 14 }}>נמצאו {groups.length} קבוצות של תוכן כפול. בכל קבוצה אפשר לבחור איזה קובץ לשמור; השאר יעברו לסל המחזור (הקובץ הפיזי נשמר — הוא משותף).</p>
      )}

      {groups.map((g) => {
        const keepId = keep[g.hash] ?? g.files[0]?.id;
        return (
          <section key={g.hash} style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <h2 style={{ marginTop: 0, marginBottom: 0, fontSize: 16 }}>
                {g.count} עותקים · {humanSize(g.sizeBytes)} · <span style={{ color: 'var(--muted)', fontFamily: 'monospace', fontSize: 12 }}>{g.hash.slice(0, 12)}…</span>
              </h2>
              {canMerge && (
                <button onClick={() => onMerge(g)} disabled={busy === g.hash}
                  style={{ ...btn, background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' }}>
                  {busy === g.hash ? 'ממזג…' : 'שמור את הנבחר · הסר את השאר'}
                </button>
              )}
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right', marginTop: 10 }}>
              <thead>
                <tr style={{ color: 'var(--muted)', fontSize: 13 }}>
                  <th style={th}>{canMerge ? 'לשמור' : ''}</th><th style={th}>שם</th><th style={th}>תיקייה</th><th style={th}>תגיות</th><th style={th}>הועלה</th>
                </tr>
              </thead>
              <tbody>
                {g.files.map((f) => (
                  <tr key={f.id} style={{ borderTop: '1px solid #eef2f7', background: f.id === keepId ? '#f0fdf4' : undefined }}>
                    <td style={td}>
                      {canMerge && (
                        <input type="radio" name={`keep-${g.hash}`} checked={f.id === keepId}
                          onChange={() => setKeep((prev) => ({ ...prev, [g.hash]: f.id }))} />
                      )}
                    </td>
                    <td style={td}>📄 {f.name}</td>
                    <td style={td}>{f.folderName ?? '—'}</td>
                    <td style={td}>{f.tags.map((t) => <span key={t.id} style={chip} title={t.path}>{t.path}</span>)}</td>
                    <td style={{ ...td, color: 'var(--muted)', fontSize: 13 }}>{new Date(f.createdAt).toLocaleDateString('he-IL')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
    </main>
  );
}

const card: CSSProperties = { background: 'var(--card)', border: '1px solid #e5e7eb', borderRadius: 12, padding: 20, marginTop: 16 };
const btn: CSSProperties = { padding: '8px 14px', background: '#fff', border: '1px solid #cbd5e1', borderRadius: 8, cursor: 'pointer' };
const th: CSSProperties = { padding: '8px 6px', fontWeight: 600 };
const td: CSSProperties = { padding: '10px 6px', verticalAlign: 'middle' };
const chip: CSSProperties = { background: '#f1f5f9', padding: '2px 8px', borderRadius: 999, fontSize: 12, marginInlineEnd: 4 };
