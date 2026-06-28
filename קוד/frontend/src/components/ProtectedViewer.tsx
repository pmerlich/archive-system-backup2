'use client';
// ProtectedViewer.tsx — צופה מוגן (שלב 3.1). מציג "גרסת צפייה" נגזרת מהשרת (לא קובץ המקור),
// עם טוקן קצר-מועד שמתחדש אוטומטית. תומך בתמונה, עמודי PDF, וידאו, שמע וטקסט.
// כל גרסת צפייה נטענת כ-blob (object URL) ומשוחררת בסגירה — אין קישור ישיר חשוף.
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { createViewSession, fetchRendition, type ProtectedSession } from '@/lib/api';

export default function ProtectedViewer({ file, onClose }: {
  file: { id: string; name: string; mimeType?: string | null };
  onClose: () => void;
}) {
  const [session, setSession] = useState<ProtectedSession | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [url, setUrl] = useState(''); // תמונה / וידאו / שמע / עמוד PDF נוכחי
  const [text, setText] = useState('');
  const [page, setPage] = useState(1);
  const urlsRef = useRef<string[]>([]); // כל כתובות ה-blob — לשחרור בסיום
  const track = (u: string) => { urlsRef.current.push(u); return u; };

  // פתיחת הפעלת צפייה
  useEffect(() => {
    let alive = true;
    setLoading(true); setErr('');
    createViewSession(file.id)
      .then((s) => { if (alive) setSession(s); })
      .catch((e: any) => { if (alive) { setErr(e.message || 'שגיאה בפתיחת צפייה'); setLoading(false); } });
    return () => { alive = false; };
  }, [file.id]);

  // טעינת גרסת הצפייה לפי הסוג (ול-PDF לפי העמוד)
  const load = useCallback(async (s: ProtectedSession, pg: number) => {
    setLoading(true); setErr(''); setUrl(''); setText('');
    try {
      if (s.kind === 'image') setUrl(track((await fetchRendition(s.sid, file.id, 'image')).url));
      else if (s.kind === 'video') setUrl(track((await fetchRendition(s.sid, file.id, 'video')).url));
      else if (s.kind === 'audio') setUrl(track((await fetchRendition(s.sid, file.id, 'audio')).url));
      else if (s.kind === 'pdf') setUrl(track((await fetchRendition(s.sid, file.id, `page/${pg}`)).url));
      else if (s.kind === 'text') {
        const r = await fetchRendition(s.sid, file.id, 'text');
        setText(await (await fetch(r.url)).text());
        URL.revokeObjectURL(r.url);
      } else setErr('אין צפייה מוגנת לסוג קובץ זה');
    } catch (e: any) {
      setErr(e.message || 'שגיאת צפייה');
    } finally {
      setLoading(false);
    }
  }, [file.id]);

  useEffect(() => { if (session) load(session, page); }, [session, page, load]);

  // שחרור כל כתובות ה-blob בסגירה (מניעת דליפת זיכרון)
  useEffect(() => () => { urlsRef.current.forEach((u) => URL.revokeObjectURL(u)); urlsRef.current = []; }, []);

  // Escape לסגירה
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const media: CSSProperties = { userSelect: 'none', WebkitUserSelect: 'none', maxWidth: '100%', maxHeight: '70vh', borderRadius: 8 };

  return (
    <div onClick={onClose} style={overlay}>
      <div onClick={(e) => e.stopPropagation()} style={modal} dir="rtl" onContextMenu={(e) => e.preventDefault()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: 18, wordBreak: 'break-word' }}>צפייה מוגנת — {file.name}</h2>
          <button onClick={onClose} style={btn}>✕ סגור</button>
        </div>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>גרסת צפייה בלבד — קובץ המקור אינו יורד למחשב.</p>
        {err && <p style={{ color: '#b91c1c' }}>{err}</p>}
        {loading && <p style={{ color: 'var(--muted)' }}>טוען צפייה…</p>}

        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 220, background: '#0f172a', borderRadius: 10, padding: 10 }}>
          {session?.kind === 'image' && url && <img src={url} alt="צפייה" draggable={false} style={media} />}
          {session?.kind === 'pdf' && url && <img src={url} alt={`עמוד ${page}`} draggable={false} style={media} />}
          {session?.kind === 'video' && url && <video src={url} controls controlsList="nodownload" disablePictureInPicture style={media} />}
          {session?.kind === 'audio' && url && <audio src={url} controls controlsList="nodownload" style={{ width: '100%' }} />}
          {session?.kind === 'text' && <pre style={{ color: '#e2e8f0', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '70vh', overflow: 'auto', margin: 0, width: '100%', textAlign: 'left', direction: 'ltr' }}>{text}</pre>}
          {!loading && !url && !text && !err && <span style={{ color: '#94a3b8' }}>אין מה להציג</span>}
        </div>

        {session?.kind === 'pdf' && session.pages > 1 && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center', marginTop: 10 }}>
            <button style={btn} disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>← הקודם</button>
            <span style={{ color: 'var(--muted)' }}>עמוד {page} מתוך {session.pages}</span>
            <button style={btn} disabled={page >= session.pages} onClick={() => setPage((p) => Math.min(session.pages, p + 1))}>הבא →</button>
          </div>
        )}
      </div>
    </div>
  );
}

const overlay: CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.7)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 24, zIndex: 70, overflowY: 'auto' };
const modal: CSSProperties = { background: '#fff', borderRadius: 14, padding: 20, width: 'min(900px, 96vw)', boxShadow: '0 20px 60px rgba(0,0,0,0.35)', marginTop: 24, marginBottom: 24 };
const btn: CSSProperties = { padding: '8px 14px', background: '#fff', border: '1px solid #cbd5e1', borderRadius: 8, cursor: 'pointer' };
