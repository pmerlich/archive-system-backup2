'use client';
// import/page.tsx — מסך ייבוא מדיסקים (שלב 1.7). דורש הרשאת files.import.
// זרימה: "סריקה בלבד" (לא נוגעת במקור) → רואים מה חדש/קיים → מאשרים "ייבוא" שמעתיק רק חדשים. בטוח-לחזרה.
import { useEffect, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import {
  getMe, getToken, logout, hasPermission,
  importScan, importHashBatch, importRunBatch, listImportJobs, getImportItems,
  type AuthUser, type ImportJob, type ImportItem,
} from '@/lib/api';

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let n = bytes / 1024, i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(1)} ${units[i]}`;
}

const STATUS_HE: Record<string, string> = {
  scanning: 'בסריקה…', scanned: 'נסרק — ממתין לאישור', importing: 'בייבוא…', completed: 'הושלם', failed: 'נכשל',
};
const ITEM_STATUS_HE: Record<string, string> = {
  pending: 'ממתין', new: 'חדש', duplicate: 'כבר קיים', imported: 'יובא', error: 'שגיאה',
};

export default function ImportPage() {
  const router = useRouter();
  const [me, setMe] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [sourcePath, setSourcePath] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [manifest, setManifest] = useState<{ jobId: string; status: string; items: ImportItem[]; total: number } | null>(null);

  useEffect(() => {
    if (!getToken()) { router.replace('/login'); return; }
    getMe()
      .then(async (u) => {
        setMe(u);
        if (!hasPermission(u, 'files.import')) { setDenied(true); return; }
        setJobs(await listImportJobs());
      })
      .catch(() => { logout(); router.replace('/login'); })
      .finally(() => setLoading(false));
  }, [router]);

  async function refresh(): Promise<void> {
    try { setJobs(await listImportJobs()); } catch { /* */ }
  }

  // סריקה בלבד: יוצר עבודה, ואז מחשב Hash באצוות עד שכל הקבצים סומנו (חדש/קיים). לא נוגע במקור.
  async function onScan(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!sourcePath.trim()) { setMsg('יש להזין נתיב לדיסק/לתיקייה'); return; }
    setBusy(true); setMsg('סורק… (קריאה בלבד — לא נוגע בדיסק)');
    try {
      let job = await importScan(sourcePath.trim(), label.trim());
      await refresh();
      let guard = Math.ceil((job.totalFiles || 0) / 50) + 10;
      while (job.status === 'scanning' && guard-- > 0) {
        job = await importHashBatch(job.id, 50);
        setMsg(`סורק… ${job.hashedFiles}/${job.totalFiles} (חדשים: ${job.newFiles}, קיימים: ${job.duplicateFiles})`);
      }
      await refresh();
      setMsg(`✓ הסריקה הסתיימה: ${job.newFiles} חדשים, ${job.duplicateFiles} כבר במאגר${job.errorFiles ? `, ${job.errorFiles} שגיאות` : ''}. אפשר לאשר ייבוא למטה.`);
      setSourcePath(''); setLabel('');
    } catch (err: any) { setMsg(err.message || 'שגיאה בסריקה'); }
    finally { setBusy(false); }
  }

  // ייבוא בפועל: מעתיק רק קבצים חדשים, באצוות, עד שהסתיים. המקור לא משתנה.
  async function onImport(job: ImportJob): Promise<void> {
    if (!window.confirm(`לייבא ${job.newFiles} קבצים חדשים מ"${job.label}"? הקיימים לא יועתקו שוב, והמקור לא משתנה.`)) return;
    setBusy(true); setMsg('מייבא…');
    try {
      let j = job;
      let guard = Math.ceil((j.newFiles || 0) / 50) + 10;
      while (j.status !== 'completed' && j.status !== 'failed' && guard-- > 0) {
        j = await importRunBatch(job.id, 50);
        setMsg(`מייבא… ${j.importedFiles} קבצים הועתקו`);
      }
      await refresh();
      setMsg(`✓ הייבוא הסתיים: ${j.importedFiles} קבצים יובאו לתיקייה "ייבוא: ${j.label}".`);
    } catch (err: any) { setMsg(err.message || 'שגיאה בייבוא'); }
    finally { setBusy(false); }
  }

  async function viewManifest(job: ImportJob, status: string): Promise<void> {
    try {
      const res = await getImportItems(job.id, status || undefined, 200);
      setManifest({ jobId: job.id, status, items: res.items, total: res.total });
    } catch (err: any) { window.alert(err.message || 'שגיאה'); }
  }

  if (loading) return <main style={wrap}>טוען…</main>;
  if (denied) {
    return (
      <main style={wrap}>
        <section style={card}><h2 style={{ marginTop: 0 }}>אין הרשאה</h2>
          <p style={{ color: 'var(--muted)' }}>ייבוא מדיסקים דורש הרשאת "ייבוא מדיסקים" (files.import).</p>
          <button onClick={() => router.push('/')} style={btn}>חזרה ללוח הבקרה</button>
        </section>
      </main>
    );
  }

  return (
    <main style={wrap}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ color: 'var(--accent)', marginBottom: 4 }}>ייבוא מדיסקים</h1>
          <p style={{ color: 'var(--muted)', marginTop: 0 }}>סריקה בטוחה (קריאה בלבד) → אישור → ייבוא חדשים בלבד</p>
        </div>
        <button onClick={() => router.push('/')} style={btn}>חזרה ללוח הבקרה</button>
      </div>

      <section style={{ ...card, background: '#fffbeb', borderColor: '#fde68a' }}>
        <strong style={{ color: '#92400e' }}>זהירות — מתחילים קטן.</strong>
        <p style={{ margin: '6px 0 0', color: '#92400e', fontSize: 14, lineHeight: 1.7 }}>
          התחילו מדיסק בדיקה אחד וקטן, לא מהדיסק היחיד שמחזיק חומר. ב"סריקה בלבד" המערכת רק קוראת ומדווחת —
          לא נוגעת בדיסק ולא מוחקת כלום. רק אחרי שתראו מה חדש, תאשרו ייבוא.
        </p>
      </section>

      <section style={card}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>סריקה חדשה</h2>
        <form onSubmit={onScan}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input value={sourcePath} onChange={(e) => setSourcePath(e.target.value)} placeholder="נתיב הדיסק/התיקייה כפי שנגיש לשרת (למשל /import/disk1)" style={{ flex: 1, minWidth: 280, padding: '8px 10px', borderRadius: 8, border: '1px solid #cbd5e1' }} />
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="שם לזיהוי (לא חובה)" style={{ width: 200, padding: '8px 10px', borderRadius: 8, border: '1px solid #cbd5e1' }} />
            <button type="submit" disabled={busy} style={{ ...btn, background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' }}>
              {busy ? 'עובד…' : 'סרוק (קריאה בלבד)'}
            </button>
          </div>
        </form>
        {msg && <p style={{ marginBottom: 0, marginTop: 12, color: msg.startsWith('✓') ? '#15803d' : (msg.includes('שגיאה') ? '#b91c1c' : '#475569'), fontSize: 14 }}>{msg}</p>}
      </section>

      <section style={card}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>עבודות ייבוא</h2>
        {jobs.length === 0 ? (
          <p style={{ color: 'var(--muted)' }}>עדיין אין סריקות. התחילו סריקה למעלה.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right' }}>
            <thead>
              <tr style={{ color: 'var(--muted)', fontSize: 14 }}>
                <th style={th}>שם</th><th style={th}>מצב</th><th style={th}>סה"כ</th><th style={th}>חדשים</th><th style={th}>קיימים</th><th style={th}>יובאו</th><th style={th}>שגיאות</th><th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} style={{ borderTop: '1px solid #eef2f7' }}>
                  <td style={td}>💽 {j.label}<div style={{ color: 'var(--muted)', fontSize: 12 }}>{j.sourcePath}</div></td>
                  <td style={td}>{STATUS_HE[j.status] ?? j.status}</td>
                  <td style={td}>{j.totalFiles} <span style={{ color: 'var(--muted)', fontSize: 12 }}>({humanSize(j.totalBytes)})</span></td>
                  <td style={td}>{j.newFiles}</td>
                  <td style={td}>{j.duplicateFiles}</td>
                  <td style={td}>{j.importedFiles}</td>
                  <td style={{ ...td, color: j.errorFiles ? '#b91c1c' : undefined }}>{j.errorFiles}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    {j.status === 'scanned' && j.newFiles > 0 && (
                      <button onClick={() => onImport(j)} disabled={busy} style={{ ...smallBtn, background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' }}>ייבא חדשים</button>
                    )}
                    <button onClick={() => viewManifest(j, '')} style={smallBtn}>מפת מיקום</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {manifest && (
        <section style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <h2 style={{ marginTop: 0, fontSize: 18 }}>מפת מיקום (Manifest) — {manifest.total} פריטים</h2>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <select value={manifest.status} onChange={(e) => { const job = jobs.find((x) => x.id === manifest.jobId); if (job) viewManifest(job, e.target.value); }} style={sel}>
                <option value="">הכול</option>
                <option value="new">חדשים</option>
                <option value="duplicate">כבר קיימים</option>
                <option value="imported">יובאו</option>
                <option value="error">שגיאות</option>
              </select>
              <button onClick={() => setManifest(null)} style={smallBtn}>סגור</button>
            </div>
          </div>
          {manifest.items.length === 0 ? (
            <p style={{ color: 'var(--muted)' }}>אין פריטים להצגה.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right' }}>
              <thead><tr style={{ color: 'var(--muted)', fontSize: 14 }}><th style={th}>נתיב בדיסק</th><th style={th}>גודל</th><th style={th}>מצב</th></tr></thead>
              <tbody>
                {manifest.items.map((it) => (
                  <tr key={it.id} style={{ borderTop: '1px solid #eef2f7' }}>
                    <td style={td}>{it.relativePath}</td>
                    <td style={td}>{humanSize(it.sizeBytes)}</td>
                    <td style={{ ...td, color: it.status === 'error' ? '#b91c1c' : undefined }}>{ITEM_STATUS_HE[it.status] ?? it.status}{it.error ? ` — ${it.error}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {manifest.total > manifest.items.length && (
            <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 0 }}>מוצגים {manifest.items.length} מתוך {manifest.total}.</p>
          )}
        </section>
      )}
    </main>
  );
}

const wrap: CSSProperties = { maxWidth: 1000, margin: '40px auto', padding: 24 };
const card: CSSProperties = { background: 'var(--card)', border: '1px solid #e5e7eb', borderRadius: 12, padding: 20, marginTop: 16 };
const btn: CSSProperties = { padding: '8px 14px', background: '#fff', border: '1px solid #cbd5e1', borderRadius: 8, cursor: 'pointer' };
const smallBtn: CSSProperties = { padding: '5px 10px', marginInlineEnd: 6, background: '#fff', border: '1px solid #cbd5e1', borderRadius: 7, cursor: 'pointer', fontSize: 13 };
const sel: CSSProperties = { padding: '6px 10px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff' };
const th: CSSProperties = { padding: '8px 6px', fontWeight: 600 };
const td: CSSProperties = { padding: '10px 6px', verticalAlign: 'middle' };
