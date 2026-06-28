'use client';
// share/[token]/page.tsx — עמוד ציבורי לצפייה בקובץ ששותף (שלב 3.5). ללא התחברות!
// שערים אפשריים לפי הגדרות הקישור: אימות מייל + קוד חד-פעמי, ואישור ידני של מנהל. אחר כך — צופה מוגן ממוית-מים.
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useParams } from 'next/navigation';
import { shareStart, shareRequestOtp, shareVerify, shareStatus, rememberShareToken, fetchShareRendition, type ShareStart } from '@/lib/api';

type Phase = 'loading' | 'needEmail' | 'needCode' | 'pending' | 'ready' | 'error';

export default function SharePage() {
  const params = useParams();
  const token = String((params as any)?.token || '');
  const [phase, setPhase] = useState<Phase>('loading');
  const [info, setInfo] = useState<ShareStart | null>(null);
  const [sid, setSid] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [note, setNote] = useState('');

  const applyStart = useCallback((s: ShareStart) => {
    setInfo(s); setSid(s.sid);
    if (s.ready && s.token) { rememberShareToken(s.sid, s.token, s.tokenExpiresIn || 120); setPhase('ready'); return; }
    if (s.pendingApproval || (s.needApproval && !s.needVerify)) { setPhase('pending'); return; }
    if (s.needVerify) { setPhase('needEmail'); if (s.emailHint) setNote(`נשלח קוד למייל ${s.emailHint}`); return; }
    setPhase('error'); setErr('לא ניתן לפתוח את הקישור');
  }, []);

  useEffect(() => {
    if (!token) return;
    shareStart(token).then(applyStart).catch((e: any) => { setPhase('error'); setErr(e.message || 'הקישור אינו זמין'); });
  }, [token, applyStart]);

  // פולינג לאישור ידני
  useEffect(() => {
    if (phase !== 'pending') return;
    const id = setInterval(() => {
      shareStatus(token, sid).then((s) => { if (s.ready) applyStart(s); }).catch(() => undefined);
    }, 4000);
    return () => clearInterval(id);
  }, [phase, token, sid, applyStart]);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setBusy(true);
    try { await shareRequestOtp(token, sid, email); setPhase('needCode'); setNote(`נשלח קוד למייל ${email}`); }
    catch (e: any) { setErr(e.message || 'שגיאה'); } finally { setBusy(false); }
  }
  async function verify(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setBusy(true);
    try { const s = await shareVerify(token, sid, code); applyStart(s); }
    catch (e: any) { setErr(e.message || 'קוד שגוי'); } finally { setBusy(false); }
  }

  return (
    <main dir="rtl" style={{ minHeight: '100vh', background: '#f1f5f9', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 20 }}>
      <div style={{ maxWidth: 960, width: '100%' }}>
        <h1 style={{ fontSize: 20, color: '#1f4e79', marginBottom: 4 }}>מערכת ארכיון — צפייה בקובץ ששותף איתך</h1>
        <p style={{ color: '#64748b', marginTop: 0, fontSize: 13 }}>צפייה בלבד. הקובץ אינו ניתן להורדה, ומוטבע בו סימן מים אישי.</p>
        {err && <p style={{ color: '#b91c1c', background: '#fef2f2', padding: '10px 12px', borderRadius: 8 }}>{err}</p>}

        {phase === 'loading' && <p style={{ color: '#64748b' }}>טוען…</p>}

        {phase === 'needEmail' && (
          <form onSubmit={sendCode} style={card}>
            <h2 style={h2}>אימות מייל</h2>
            <p style={{ color: '#64748b', fontSize: 14 }}>{info?.emailLocked ? `הזן את כתובת המייל שאליה נשלחה ההזמנה (${info?.emailHint || ''}).` : 'הזן את כתובת המייל שלך כדי לקבל קוד חד-פעמי.'}</p>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" style={inp} />
            <button type="submit" disabled={busy} style={primary}>{busy ? 'שולח…' : 'שלח קוד'}</button>
          </form>
        )}

        {phase === 'needCode' && (
          <form onSubmit={verify} style={card}>
            <h2 style={h2}>הזנת הקוד</h2>
            <p style={{ color: '#64748b', fontSize: 14 }}>{note || 'הזן את הקוד בן 6 הספרות שנשלח למייל.'}</p>
            <input inputMode="numeric" pattern="[0-9]*" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="123456" style={{ ...inp, letterSpacing: 6, textAlign: 'center', fontSize: 22 }} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" disabled={busy} style={primary}>{busy ? 'בודק…' : 'אמת והצג'}</button>
              <button type="button" onClick={() => setPhase('needEmail')} style={btn}>החלף מייל</button>
            </div>
          </form>
        )}

        {phase === 'pending' && (
          <div style={card}>
            <h2 style={h2}>ממתין לאישור</h2>
            <p style={{ color: '#64748b', fontSize: 14 }}>הבקשה נשלחה למנהל לאישור. העמוד יתעדכן אוטומטית ברגע שהצפייה תאושר.</p>
            <p style={{ color: '#94a3b8', fontSize: 13 }}>אפשר להשאיר את העמוד פתוח.</p>
          </div>
        )}

        {phase === 'ready' && info && <GuestViewer token={token} sid={sid} info={info} />}
      </div>
    </main>
  );
}

function GuestViewer({ token, sid, info }: { token: string; sid: string; info: ShareStart }) {
  const [url, setUrl] = useState(''); const [text, setText] = useState('');
  const [page, setPage] = useState(1); const [loading, setLoading] = useState(true); const [err, setErr] = useState('');
  const urls = useRef<string[]>([]); const track = (u: string) => { urls.current.push(u); return u; };
  const kind = info.kind; const pages = info.pages || 0;

  const load = useCallback(async (pg: number) => {
    setLoading(true); setErr(''); setUrl(''); setText('');
    try {
      if (kind === 'image') setUrl(track((await fetchShareRendition(token, sid, 'image')).url));
      else if (kind === 'video') setUrl(track((await fetchShareRendition(token, sid, 'video')).url));
      else if (kind === 'audio') setUrl(track((await fetchShareRendition(token, sid, 'audio')).url));
      else if (kind === 'pdf') setUrl(track((await fetchShareRendition(token, sid, `page/${pg}`)).url));
      else if (kind === 'text') { const r = await fetchShareRendition(token, sid, 'text'); setText(await (await fetch(r.url)).text()); URL.revokeObjectURL(r.url); }
      else setErr('אין צפייה לסוג קובץ זה');
    } catch (e: any) { setErr(e.message || 'שגיאת צפייה'); } finally { setLoading(false); }
  }, [token, sid, kind]);

  useEffect(() => { load(page); }, [page, load]);
  useEffect(() => () => { urls.current.forEach((u) => URL.revokeObjectURL(u)); urls.current = []; }, []);

  const media: CSSProperties = { userSelect: 'none', WebkitUserSelect: 'none', maxWidth: '100%', maxHeight: '74vh', borderRadius: 8 };
  return (
    <div style={card} onContextMenu={(e) => e.preventDefault()}>
      <h2 style={{ ...h2, marginBottom: 8 }}>{info.name}</h2>
      {err && <p style={{ color: '#b91c1c' }}>{err}</p>}
      {loading && <p style={{ color: '#64748b' }}>טוען צפייה…</p>}
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 240, background: '#0f172a', borderRadius: 10, padding: 10 }}>
        {kind === 'image' && url && <img src={url} alt="צפייה" draggable={false} style={media} />}
        {kind === 'pdf' && url && <img src={url} alt={`עמוד ${page}`} draggable={false} style={media} />}
        {kind === 'video' && url && <video src={url} controls controlsList="nodownload" disablePictureInPicture style={media} />}
        {kind === 'audio' && url && <audio src={url} controls controlsList="nodownload" style={{ width: '100%' }} />}
        {kind === 'text' && <pre style={{ color: '#e2e8f0', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '74vh', overflow: 'auto', margin: 0, width: '100%', textAlign: 'left', direction: 'ltr' }}>{text}</pre>}
        {!loading && !url && !text && !err && <span style={{ color: '#94a3b8' }}>אין מה להציג</span>}
      </div>
      {kind === 'pdf' && pages > 1 && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center', marginTop: 10 }}>
          <button style={btn} disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>← הקודם</button>
          <span style={{ color: '#64748b' }}>עמוד {page} מתוך {pages}</span>
          <button style={btn} disabled={page >= pages} onClick={() => setPage((p) => Math.min(pages, p + 1))}>הבא →</button>
        </div>
      )}
    </div>
  );
}

const card: CSSProperties = { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: 18, marginTop: 12, boxShadow: '0 6px 24px rgba(0,0,0,0.06)' };
const h2: CSSProperties = { margin: '0 0 8px', fontSize: 17, color: '#1f2937' };
const inp: CSSProperties = { padding: '10px 12px', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 15, width: '100%', maxWidth: 320, display: 'block', marginBottom: 10 };
const btn: CSSProperties = { padding: '8px 14px', background: '#fff', border: '1px solid #cbd5e1', borderRadius: 8, cursor: 'pointer' };
const primary: CSSProperties = { padding: '10px 20px', background: '#1f4e79', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 };
