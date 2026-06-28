'use client';
// FileWatermark.tsx — סימן מים מוצמד לקובץ בודד (שלב 3.8b). דורש watermark.create.
import { useEffect, useState, type CSSProperties } from 'react';
import { createFileWatermark, type ArchiveFile } from '@/lib/api';

export default function FileWatermark({ file, onClose }: { file: ArchiveFile; onClose: () => void }) {
  const [name, setName] = useState(`סימן מים — ${file.name}`);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);
  useEffect(() => { const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, [onClose]);

  async function save() {
    if (!text.trim()) { setErr('הקלד את הטקסט שיופיע בסימן המים'); return; }
    setBusy(true); setErr('');
    try { await createFileWatermark(file.id, name.slice(0, 100), text.slice(0, 300)); setDone(true); }
    catch (e: any) { setErr(e.message || 'שגיאה'); } finally { setBusy(false); }
  }

  return (
    <div onClick={onClose} style={overlay}>
      <div onClick={(e) => e.stopPropagation()} style={modal} dir="rtl">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h2 style={{ margin: 0, fontSize: 18, wordBreak: 'break-word' }}>סימן מים לקובץ — {file.name}</h2>
          <button onClick={onClose} style={btn}>✕</button>
        </div>
        {done ? (
          <div>
            <p style={{ color: '#166534' }}>✓ סימן המים נוצר והופעל לקובץ הזה בלבד. הוא יופיע לכל מי שצופה בקובץ — ולא משפיע על שאר הקבצים.</p>
            <p style={{ color: 'var(--muted)', fontSize: 13 }}>אפשר לערוך או לכבות אותו במסך "סימני מים".</p>
            <button onClick={onClose} style={primary}>סגור</button>
          </div>
        ) : (
          <>
            <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>סימן מים שמוצמד לקובץ הזה בלבד. אפשר להשתמש במשתנים: {'{email} {name} {datetime} {date} {viewid}'} — יוחלפו אוטומטית לפי הצופה.</p>
            {err && <p style={{ color: '#b91c1c' }}>{err}</p>}
            <label style={lbl}>שם לזיהוי<input value={name} onChange={(e) => setName(e.target.value)} style={inp} /></label>
            <label style={lbl}>טקסט סימן המים<input value={text} onChange={(e) => setText(e.target.value)} placeholder="למשל: סודי · {email}" style={inp} /></label>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button onClick={save} disabled={busy} style={{ ...primary, opacity: busy ? 0.6 : 1 }}>{busy ? 'יוצר…' : 'צור סימן מים לקובץ'}</button>
              <button onClick={onClose} style={btn}>ביטול</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const overlay: CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 24, zIndex: 60, overflowY: 'auto' };
const modal: CSSProperties = { background: '#fff', borderRadius: 14, padding: 20, width: 'min(560px, 96vw)', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', marginTop: 40 };
const lbl: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, color: '#334155', marginTop: 8 };
const inp: CSSProperties = { padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 14 };
const btn: CSSProperties = { padding: '8px 14px', background: '#fff', border: '1px solid #cbd5e1', borderRadius: 8, cursor: 'pointer' };
const primary: CSSProperties = { padding: '9px 16px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 };
