'use client';
// ImageEditor.tsx — עורך תמונות לא-הרסני (שלבים 4.1–4.3). מציג תמונת בסיס (גרסת-צפייה ממוזערת — לא המקור),
// מאפשר חיתוך/סיבוב/היפוך/שינוי-גודל/בהירות/ניגודיות/חדות/שחור-לבן (4.1), סימון אזורים לטשטוש/פיקסול/כיסוי (4.2),
// וסימונים: טקסט/חץ/מסגרת + ניקוי מטא-דאטה + גרסת שיתוף ממוית-מים (4.3). תצוגה מקדימה מדויקת מהשרת. המקור לעולם לא משתנה.
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  fetchEditBase, fetchEditPreview, saveEditVersion, listFileEdits,
  duplicateVersion, downloadEditedVersion, enqueueEditJob,
  type EditOp, type EditVersion,
} from '@/lib/api';

type Crop = { x: number; y: number; w: number; h: number };
type Tool = 'crop' | 'redact' | 'text' | 'arrow' | 'frame';
type RedactMode = 'blur' | 'pixelate' | 'cover';
type RedactShape = 'rect' | 'ellipse';
type Area = { id: string; shape: RedactShape; mode: RedactMode; strength: number; color: string; feather: number; invert: boolean; x: number; y: number; w: number; h: number };
type Anno = { id: string; kind: 'text' | 'arrow' | 'frame'; color: string; size: number; width: number; font?: string; value?: string; x?: number; y?: number; w?: number; h?: number; x1?: number; y1?: number; x2?: number; y2?: number };

const rid = () => Math.random().toString(36).slice(2);
const modeLabel: Record<RedactMode, string> = { blur: 'טשטוש', pixelate: 'פיקסול', cover: 'כיסוי' };
const modeColor: Record<RedactMode, string> = { blur: '#38bdf8', pixelate: '#a78bfa', cover: '#f87171' };

export default function ImageEditor({ file, onClose, onSaved }: {
  file: { id: string; name: string; mimeType?: string | null };
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [baseUrl, setBaseUrl] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [loadingBase, setLoadingBase] = useState(true);
  const [loadingPrev, setLoadingPrev] = useState(false);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState('');
  const [versions, setVersions] = useState<EditVersion[]>([]);

  // בקרות העריכה (4.1)
  const [crop, setCrop] = useState<Crop | null>(null);
  const [rot, setRot] = useState(0); // 0 / 90 / 180 / 270
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [scalePct, setScalePct] = useState(100);
  const [bright, setBright] = useState(0);
  const [contrast, setContrast] = useState(0);
  const [sharpen, setSharpen] = useState(0);
  const [gray, setGray] = useState(false);
  const [label, setLabel] = useState('');

  // כלי סימון אזורים (4.2)
  const [tool, setTool] = useState<Tool>('crop');
  const [redactMode, setRedactMode] = useState<RedactMode>('blur');
  const [redactShape, setRedactShape] = useState<RedactShape>('rect');
  const [redactStrength, setRedactStrength] = useState(60);
  const [redactColor, setRedactColor] = useState('#000000');
  const [redactFeather, setRedactFeather] = useState(0); // ריכוך מדורג
  const [redactInvert, setRedactInvert] = useState(false); // היפוך בחירה
  const [areas, setAreas] = useState<Area[]>([]);
  const [draft, setDraft] = useState<Crop | null>(null);

  // כלי סימון: טקסט / חץ / מסגרת (4.3)
  const [annoColor, setAnnoColor] = useState('#ff2d2d');
  const [annoSize, setAnnoSize] = useState(34);
  const [annoWidth, setAnnoWidth] = useState(5);
  const [annoFont, setAnnoFont] = useState('sans');
  const [annos, setAnnos] = useState<Anno[]>([]);
  const [annoDraft, setAnnoDraft] = useState<Anno | null>(null);

  // ניהול גרסאות (4.4)
  const [compare, setCompare] = useState<EditVersion | null>(null);
  const [compareUrl, setCompareUrl] = useState('');
  const [busyVer, setBusyVer] = useState('');

  const imgRef = useRef<HTMLImageElement | null>(null);
  const urlsRef = useRef<string[]>([]);
  const track = (u: string) => { urlsRef.current.push(u); return u; };

  // בניית "מתכון" מהבקרות הנוכחיות.
  const buildRecipe = useCallback((): EditOp[] => {
    const r: EditOp[] = [];
    if (crop && (crop.x > 0.001 || crop.y > 0.001 || crop.w < 0.999 || crop.h < 0.999)) r.push({ op: 'crop', ...crop });
    if (rot === 90 || rot === 180 || rot === 270) r.push({ op: 'rotate', deg: rot as 90 | 180 | 270 });
    if (flipH) r.push({ op: 'flip', axis: 'h' });
    if (flipV) r.push({ op: 'flip', axis: 'v' });
    if (scalePct !== 100) r.push({ op: 'resize', scalePct });
    if (bright !== 0) r.push({ op: 'brightness', value: bright });
    if (contrast !== 0) r.push({ op: 'contrast', value: contrast });
    if (sharpen > 0) r.push({ op: 'sharpen', value: sharpen });
    if (gray) r.push({ op: 'grayscale' });
    for (const a of areas) r.push({ op: 'redact', shape: a.shape, mode: a.mode, strength: a.strength, color: a.color, feather: a.feather, invert: a.invert, x: a.x, y: a.y, w: a.w, h: a.h });
    for (const a of annos) {
      if (a.kind === 'text' && a.value) r.push({ op: 'text', x: a.x ?? 0, y: a.y ?? 0, value: a.value, color: a.color, size: a.size, font: a.font ?? 'sans' });
      else if (a.kind === 'arrow') r.push({ op: 'arrow', x1: a.x1 ?? 0, y1: a.y1 ?? 0, x2: a.x2 ?? 0, y2: a.y2 ?? 0, color: a.color, width: a.width });
      else if (a.kind === 'frame') r.push({ op: 'frame', x: a.x ?? 0, y: a.y ?? 0, w: a.w ?? 0, h: a.h ?? 0, color: a.color, width: a.width });
    }
    return r;
  }, [crop, rot, flipH, flipV, scalePct, bright, contrast, sharpen, gray, areas, annos]);

  const refreshVersions = useCallback(() => {
    listFileEdits(file.id).then((edits) => {
      setVersions(edits.flatMap((e) => e.versions).sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)));
    }).catch(() => undefined);
  }, [file.id]);

  // טעינת תמונת הבסיס + הגרסאות הקיימות
  useEffect(() => {
    let alive = true;
    setLoadingBase(true); setErr('');
    fetchEditBase(file.id)
      .then((b) => { if (alive) { setBaseUrl(track(b.url)); setLoadingBase(false); } })
      .catch((e: any) => { if (alive) { setErr(e.message || 'שגיאה בטעינת התמונה'); setLoadingBase(false); } });
    refreshVersions();
    return () => { alive = false; urlsRef.current.forEach((u) => URL.revokeObjectURL(u)); urlsRef.current = []; };
  }, [file.id, refreshVersions]);

  // תצוגה מקדימה מהשרת — מושהית (debounce) בכל שינוי במתכון.
  const recipeKey = JSON.stringify(buildRecipe());
  useEffect(() => {
    const recipe = buildRecipe();
    if (recipe.length === 0) { setPreviewUrl(''); return; } // אין שינוי → מציגים את הבסיס
    let alive = true;
    setLoadingPrev(true);
    const t = setTimeout(() => {
      fetchEditPreview(file.id, recipe)
        .then((p) => { if (alive) { setPreviewUrl(track(p.url)); setLoadingPrev(false); } })
        .catch(() => { if (alive) setLoadingPrev(false); });
    }, 450);
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipeKey, file.id]);

  // רינדור הגרסה הנבחרת להשוואה מול המקור (4.4).
  useEffect(() => {
    if (!compare?.result) { setCompareUrl(''); return; }
    let alive = true;
    fetchEditBase(compare.result.id).then((b) => { if (alive) setCompareUrl(track(b.url)); }).catch(() => { if (alive) setCompareUrl(''); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compare]);

  // ── סימון על תמונת הבסיס (גרירה/לחיצה) לפי הכלי הנבחר ──
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  function frac(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const el = imgRef.current; if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  }
  function box(s: { x: number; y: number }, p: { x: number; y: number }): Crop {
    return { x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) };
  }
  function onDown(e: React.PointerEvent) {
    e.preventDefault(); (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = frac(e); dragRef.current = p;
    if (tool === 'crop') setCrop({ ...p, w: 0, h: 0 });
    else if (tool === 'redact') setDraft({ ...p, w: 0, h: 0 });
    else if (tool === 'arrow') setAnnoDraft({ id: 'd', kind: 'arrow', color: annoColor, size: annoSize, width: annoWidth, x1: p.x, y1: p.y, x2: p.x, y2: p.y });
    else if (tool === 'frame') setAnnoDraft({ id: 'd', kind: 'frame', color: annoColor, size: annoSize, width: annoWidth, x: p.x, y: p.y, w: 0, h: 0 });
  }
  function onMove(e: React.PointerEvent) {
    if (!dragRef.current) return;
    const p = frac(e);
    if (tool === 'crop') setCrop(box(dragRef.current, p));
    else if (tool === 'redact') setDraft(box(dragRef.current, p));
    else if (tool === 'arrow') setAnnoDraft((d) => d ? { ...d, x2: p.x, y2: p.y } : d);
    else if (tool === 'frame') setAnnoDraft((d) => d ? { ...d, ...box(dragRef.current!, p) } : d);
  }
  function onUp() {
    const start = dragRef.current; dragRef.current = null;
    if (tool === 'crop') { if (crop && (crop.w < 0.02 || crop.h < 0.02)) setCrop(null); return; }
    if (tool === 'redact') {
      if (draft) {
        if (draft.w >= 0.02 && draft.h >= 0.02) setAreas((a) => [...a, { id: rid(), shape: redactShape, mode: redactMode, strength: redactStrength, color: redactColor, feather: redactFeather, invert: redactInvert, ...draft }]);
        setDraft(null);
      }
      return;
    }
    if (tool === 'text' && start) {
      const value = (window.prompt('טקסט לסימון:') || '').trim();
      if (value) setAnnos((a) => [...a, { id: rid(), kind: 'text', color: annoColor, size: annoSize, width: annoWidth, font: annoFont, value, x: start.x, y: start.y }]);
      return;
    }
    if ((tool === 'arrow' || tool === 'frame') && annoDraft) {
      const d = annoDraft; setAnnoDraft(null);
      if (tool === 'arrow') { if (Math.hypot((d.x2 ?? 0) - (d.x1 ?? 0), (d.y2 ?? 0) - (d.y1 ?? 0)) >= 0.03) setAnnos((a) => [...a, { ...d, id: rid() }]); }
      else if ((d.w ?? 0) >= 0.02 && (d.h ?? 0) >= 0.02) setAnnos((a) => [...a, { ...d, id: rid() }]);
    }
  }

  function resetAll() {
    setCrop(null); setRot(0); setFlipH(false); setFlipV(false); setScalePct(100);
    setBright(0); setContrast(0); setSharpen(0); setGray(false);
    setAreas([]); setDraft(null); setAnnos([]); setAnnoDraft(null);
  }

  async function doSave(opts?: { share?: boolean; watermarkText?: string }) {
    const recipe = buildRecipe();
    if (!opts?.share && recipe.length === 0) { setErr('לא בוצעו שינויים לשמירה'); return; }
    setSaving(true); setErr(''); setSaved('');
    try {
      const r = await saveEditVersion(file.id, recipe, label, opts);
      setSaved(`נשמרה ${opts?.share ? 'גרסת שיתוף' : 'גרסה'} ${r.version.versionNo}: ${r.result.name}`);
      setLabel('');
      refreshVersions();
      onSaved?.();
    } catch (e: any) { setErr(e.message || 'שמירה נכשלה'); }
    finally { setSaving(false); }
  }
  function onSaveShare() {
    const wm = (window.prompt('טקסט סימן מים לגרסת השיתוף (למשל שם הנמען):', 'לא להפצה') || '').trim();
    doSave({ share: true, watermarkText: wm });
  }

  // שמירה ברקע — שולח את העריכה לתור העיבוד (שלב 4.5) במקום לעבד מיד; שימושי לעריכות כבדות.
  async function onSaveBackground() {
    const recipe = buildRecipe();
    if (recipe.length === 0) { setErr('לא בוצעו שינויים לשמירה'); return; }
    setSaving(true); setErr(''); setSaved('');
    try {
      await enqueueEditJob(file.id, recipe, label);
      setSaved('נשלח לתור העיבוד — הגרסה תופיע בעוד רגע (אפשר לעקוב במסך "תור עיבוד")');
      setLabel('');
      setTimeout(() => refreshVersions(), 4000);
    } catch (e: any) { setErr(e.message || 'שליחה לתור נכשלה'); }
    finally { setSaving(false); }
  }

  // טעינת "מתכון" של גרסה חזרה לבקרות (שחזור / עריכה-מחדש — 4.4). strip/watermark מושמטים (בלעדיים לשיתוף).
  function loadRecipe(recipe: EditOp[]) {
    resetAll();
    const na: Anno[] = []; const ar: Area[] = [];
    for (const op of (recipe || [])) {
      switch (op.op) {
        case 'crop': setCrop({ x: op.x, y: op.y, w: op.w, h: op.h }); break;
        case 'rotate': setRot(op.deg); break;
        case 'flip': op.axis === 'h' ? setFlipH(true) : setFlipV(true); break;
        case 'resize': setScalePct(op.scalePct); break;
        case 'brightness': setBright(op.value); break;
        case 'contrast': setContrast(op.value); break;
        case 'sharpen': setSharpen(op.value); break;
        case 'grayscale': setGray(true); break;
        case 'redact': if (op.shape !== 'polygon') ar.push({ id: rid(), shape: op.shape, mode: op.mode, strength: op.strength, color: op.color, feather: op.feather, invert: op.invert, x: op.x ?? 0, y: op.y ?? 0, w: op.w ?? 0, h: op.h ?? 0 }); break;
        case 'text': na.push({ id: rid(), kind: 'text', color: op.color, size: op.size, width: 5, font: op.font, value: op.value, x: op.x, y: op.y }); break;
        case 'arrow': na.push({ id: rid(), kind: 'arrow', color: op.color, size: 34, width: op.width, x1: op.x1, y1: op.y1, x2: op.x2, y2: op.y2 }); break;
        case 'frame': na.push({ id: rid(), kind: 'frame', color: op.color, size: 34, width: op.width, x: op.x, y: op.y, w: op.w, h: op.h }); break;
        default: break;
      }
    }
    setAreas(ar); setAnnos(na);
    setSaved('המתכון נטען לעריכה — שנה ושמור כגרסה חדשה'); setErr('');
  }

  async function onDuplicate(versionId: string) {
    setBusyVer(versionId); setErr('');
    try { const r = await duplicateVersion(versionId); setSaved(`שוכפלה כגרסה ${r.version.versionNo}`); refreshVersions(); onSaved?.(); }
    catch (e: any) { setErr(e.message || 'שכפול נכשל'); }
    finally { setBusyVer(''); }
  }

  const displayPreview = buildRecipe().length > 0;
  const isAnno = tool === 'text' || tool === 'arrow' || tool === 'frame';

  // ציור אזור הסתרה (מלבן/אליפסה) כשכבת-על
  function areaBox(a: { shape: RedactShape; x: number; y: number; w: number; h: number }, color: string, solid: boolean): CSSProperties {
    return {
      position: 'absolute', left: `${a.x * 100}%`, top: `${a.y * 100}%`, width: `${a.w * 100}%`, height: `${a.h * 100}%`,
      border: `2px ${solid ? 'solid' : 'dashed'} ${color}`, background: `${color}33`,
      borderRadius: a.shape === 'ellipse' ? '50%' : 4, boxSizing: 'border-box', pointerEvents: 'none',
    };
  }

  return (
    <div onClick={onClose} style={overlay}>
      <div onClick={(e) => e.stopPropagation()} style={modal} dir="rtl">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: 18, wordBreak: 'break-word' }}>עריכת תמונה — {file.name}</h2>
          <button onClick={onClose} style={btn}>✕ סגור</button>
        </div>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>העריכה אינה הרסנית — המקור נשמר, והתוצאה תישמר כגרסה חדשה. הסתרת אזור וסימונים נצרבים בפיקסלים של הגרסה.</p>
        {err && <p style={{ color: '#b91c1c' }}>{err}</p>}
        {saved && <p style={{ color: '#15803d' }}>{saved}</p>}

        {/* בורר כלי */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
          <span style={{ fontSize: 13, color: '#334155' }}>כלי:</span>
          <button style={tool === 'crop' ? segOn : seg} onClick={() => setTool('crop')}>✂️ חיתוך</button>
          <button style={tool === 'redact' ? segOn : seg} onClick={() => setTool('redact')}>🛡️ הסתרה</button>
          <button style={tool === 'text' ? segOn : seg} onClick={() => setTool('text')}>🅰️ טקסט</button>
          <button style={tool === 'arrow' ? segOn : seg} onClick={() => setTool('arrow')}>↗ חץ</button>
          <button style={tool === 'frame' ? segOn : seg} onClick={() => setTool('frame')}>▢ מסגרת</button>

          {tool === 'redact' && (
            <>
              <span style={divider} />
              {(['blur', 'pixelate', 'cover'] as RedactMode[]).map((m) => (
                <button key={m} style={redactMode === m ? segOn : seg} onClick={() => setRedactMode(m)}>{modeLabel[m]}</button>
              ))}
              <span style={divider} />
              <button style={redactShape === 'rect' ? segOn : seg} onClick={() => setRedactShape('rect')}>▭ מלבן</button>
              <button style={redactShape === 'ellipse' ? segOn : seg} onClick={() => setRedactShape('ellipse')}>◯ אליפסה</button>
              {redactMode !== 'cover' && (
                <label style={ctl}>עוצמה {redactStrength}<input type="range" min={1} max={100} value={redactStrength} onChange={(e) => setRedactStrength(+e.target.value)} style={{ width: 100 }} /></label>
              )}
              {redactMode === 'cover' && (
                <label style={ctl}>צבע <input type="color" value={redactColor} onChange={(e) => setRedactColor(e.target.value)} /></label>
              )}
              <label style={ctl}>ריכוך {redactFeather}<input type="range" min={0} max={100} value={redactFeather} onChange={(e) => setRedactFeather(+e.target.value)} style={{ width: 80 }} /></label>
              <label style={ctl}><input type="checkbox" checked={redactInvert} onChange={(e) => setRedactInvert(e.target.checked)} /> היפוך (מסביב)</label>
            </>
          )}

          {isAnno && (
            <>
              <span style={divider} />
              <label style={ctl}>צבע <input type="color" value={annoColor} onChange={(e) => setAnnoColor(e.target.value)} /></label>
              {tool === 'text' && (
                <label style={ctl}>פונט
                  <select value={annoFont} onChange={(e) => setAnnoFont(e.target.value)} style={{ padding: '3px 6px', borderRadius: 6, border: '1px solid #cbd5e1' }}>
                    <option value="sans">רגיל</option>
                    <option value="bold">מודגש</option>
                    <option value="serif">Serif</option>
                    <option value="mono">Mono</option>
                    <option value="hebrew">עברי</option>
                    <option value="hebrew-bold">עברי מודגש</option>
                    <option value="hebrew-serif">עברי Serif</option>
                  </select>
                </label>
              )}
              {tool === 'text'
                ? <label style={ctl}>גודל {annoSize}<input type="range" min={10} max={120} value={annoSize} onChange={(e) => setAnnoSize(+e.target.value)} style={{ width: 90 }} /></label>
                : <label style={ctl}>עובי {annoWidth}<input type="range" min={1} max={20} value={annoWidth} onChange={(e) => setAnnoWidth(+e.target.value)} style={{ width: 90 }} /></label>}
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{tool === 'text' ? 'לחץ על התמונה למיקום הטקסט' : 'גרור על התמונה'}</span>
            </>
          )}
        </div>

        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          {/* מקור + סימון */}
          <div style={{ flex: '1 1 320px', minWidth: 280 }}>
            <div style={paneTitle}>{tool === 'crop' ? 'מקור (גרור לבחירת אזור חיתוך)' : 'מקור (סמן על התמונה)'}</div>
            <div style={stage}>
              {loadingBase && <span style={{ color: '#94a3b8' }}>טוען…</span>}
              {baseUrl && (
                <div style={{ position: 'relative', display: 'inline-block', lineHeight: 0, touchAction: 'none', cursor: 'crosshair', overflow: 'hidden', borderRadius: 6 }}
                  onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
                  <img ref={imgRef} src={baseUrl} alt="מקור" draggable={false}
                    style={{ maxWidth: '100%', maxHeight: '52vh', borderRadius: 6, userSelect: 'none' }} />
                  {/* חיתוך */}
                  {crop && crop.w > 0 && crop.h > 0 && (
                    <div style={{ position: 'absolute', left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%`, border: '2px solid #38bdf8', boxShadow: '0 0 0 9999px rgba(15,23,42,0.5)', pointerEvents: 'none' }} />
                  )}
                  {/* אזורי הסתרה */}
                  {areas.map((a) => <div key={a.id} style={areaBox(a, modeColor[a.mode], true)} />)}
                  {tool === 'redact' && draft && draft.w > 0 && draft.h > 0 && (
                    <div style={areaBox({ shape: redactShape, ...draft }, modeColor[redactMode], false)} />
                  )}
                  {/* סימונים */}
                  {annos.map((a) => <AnnoView key={a.id} a={a} />)}
                  {annoDraft && <AnnoView a={annoDraft} draft />}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              {crop && <button onClick={() => setCrop(null)} style={smallBtn}>אפס חיתוך</button>}
              {areas.length > 0 && <button onClick={() => setAreas([])} style={smallBtn}>נקה הסתרות ({areas.length})</button>}
              {annos.length > 0 && <button onClick={() => setAnnos([])} style={smallBtn}>נקה סימונים ({annos.length})</button>}
            </div>
          </div>

          {/* תוצאה (תצוגה מקדימה מדויקת מהשרת) */}
          <div style={{ flex: '1 1 320px', minWidth: 280 }}>
            <div style={paneTitle}>תוצאה (תצוגה מקדימה){loadingPrev ? ' — מעבד…' : ''}</div>
            <div style={stage}>
              {!displayPreview && <span style={{ color: '#94a3b8' }}>אין שינויים — התוצאה זהה למקור</span>}
              {displayPreview && previewUrl && <img src={previewUrl} alt="תוצאה" draggable={false} style={{ maxWidth: '100%', maxHeight: '52vh', borderRadius: 6 }} />}
              {displayPreview && !previewUrl && <span style={{ color: '#94a3b8' }}>מעבד תצוגה…</span>}
            </div>
          </div>
        </div>

        {/* רשימת הסתרות + סימונים */}
        {(areas.length > 0 || annos.length > 0) && (
          <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {areas.map((a, i) => (
              <span key={a.id} style={{ ...chip, border: `1px solid ${modeColor[a.mode]}` }}>
                הסתרה {i + 1}: {modeLabel[a.mode]}
                <button onClick={() => setAreas((arr) => arr.filter((x) => x.id !== a.id))} style={chipX}>✕</button>
              </span>
            ))}
            {annos.map((a, i) => (
              <span key={a.id} style={{ ...chip, border: `1px solid ${a.color}` }}>
                {a.kind === 'text' ? `טקסט: ${a.value}` : a.kind === 'arrow' ? `חץ ${i + 1}` : `מסגרת ${i + 1}`}
                <button onClick={() => setAnnos((arr) => arr.filter((x) => x.id !== a.id))} style={chipX}>✕</button>
              </span>
            ))}
          </div>
        )}

        {/* בקרות (4.1) */}
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 12 }}>
          <div style={ctrlGroup}>
            <div style={ctrlLabel}>סיבוב והיפוך</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button style={smallBtn} onClick={() => setRot((r) => (r + 270) % 360)}>↺ 90°</button>
              <button style={smallBtn} onClick={() => setRot((r) => (r + 90) % 360)}>↻ 90°</button>
              <button style={smallBtn} onClick={() => setRot((r) => (r + 180) % 360)}>180°</button>
              <button style={flipH ? smallBtnOn : smallBtn} onClick={() => setFlipH((v) => !v)}>היפוך ⇆</button>
              <button style={flipV ? smallBtnOn : smallBtn} onClick={() => setFlipV((v) => !v)}>היפוך ⇅</button>
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>סיבוב נוכחי: {rot}°</div>
          </div>

          <div style={ctrlGroup}>
            <div style={ctrlLabel}>גודל: {scalePct}%</div>
            <input type="range" min={25} max={200} value={scalePct} onChange={(e) => setScalePct(+e.target.value)} style={{ width: 180 }} />
            <label style={chk}><input type="checkbox" checked={gray} onChange={(e) => setGray(e.target.checked)} /> שחור-לבן</label>
          </div>

          <div style={ctrlGroup}>
            <div style={ctrlLabel}>בהירות: {bright}</div>
            <input type="range" min={-100} max={100} value={bright} onChange={(e) => setBright(+e.target.value)} style={{ width: 180 }} />
            <div style={ctrlLabel}>ניגודיות: {contrast}</div>
            <input type="range" min={-100} max={100} value={contrast} onChange={(e) => setContrast(+e.target.value)} style={{ width: 180 }} />
            <div style={ctrlLabel}>חדות: {sharpen}</div>
            <input type="range" min={0} max={100} value={sharpen} onChange={(e) => setSharpen(+e.target.value)} style={{ width: 180 }} />
          </div>
        </div>

        {/* שמירה */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 12, borderTop: '1px solid #e2e8f0', paddingTop: 12 }}>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="שם/הערה לגרסה (לא חובה)" style={{ padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 8, flex: '1 1 200px' }} />
          <button onClick={resetAll} style={btn} disabled={saving}>אפס הכול</button>
          <button onClick={onSaveShare} style={btn} disabled={saving || loadingBase} title="גרסה עם סימן מים מרוצף וללא מטא-דאטה (לשיתוף)">🔗 גרסת שיתוף</button>
          <button onClick={onSaveBackground} style={btn} disabled={saving || loadingBase} title="שולח לתור עיבוד ברקע — לא תוקע את האתר">🕓 ברקע</button>
          <button onClick={() => doSave()} style={primaryBtn} disabled={saving || loadingBase}>{saving ? 'שומר…' : '💾 שמור גרסה'}</button>
        </div>

        {/* גרסאות קיימות */}
        {versions.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={paneTitle}>גרסאות קיימות ({versions.length})</div>
            <div style={{ maxHeight: 160, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 8 }}>
              {versions.map((v) => (
                <div key={v.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', padding: '6px 10px', borderBottom: '1px solid #f1f5f9', fontSize: 13, flexWrap: 'wrap' }}>
                  <span style={{ flex: '1 1 150px' }}>גרסה {v.versionNo}{v.label ? ` · ${v.label}` : ''} — {v.result?.name ?? '—'}</span>
                  <span style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
                    <button style={miniBtn} disabled={!v.result} onClick={() => setCompare(v)}>השוואה</button>
                    <button style={miniBtn} onClick={() => loadRecipe(v.recipe)}>טען לעריכה</button>
                    <button style={miniBtn} disabled={busyVer === v.id} onClick={() => onDuplicate(v.id)}>{busyVer === v.id ? '…' : 'שכפול'}</button>
                    <button style={miniBtn} disabled={!v.result} onClick={() => v.result && downloadEditedVersion(v.id, v.result.name).catch((e: any) => setErr(e.message || 'שגיאת הורדה'))}>הורדה</button>
                  </span>
                </div>
              ))}
            </div>
            <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>הגרסאות נשמרות כקבצים חדשים ומופיעות גם ברשימת הקבצים (מקור: עריכה).</p>
          </div>
        )}
      </div>

      {compare && (
        <div onClick={() => setCompare(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 80 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, padding: 16, width: 'min(1000px, 96vw)' }} dir="rtl">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h3 style={{ margin: 0, fontSize: 16 }}>השוואה — מקור מול גרסה {compare.versionNo}</h3>
              <button onClick={() => setCompare(null)} style={btn}>✕ סגור</button>
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 300px' }}>
                <div style={paneTitle}>מקור</div>
                <div style={stage}>{baseUrl ? <img src={baseUrl} alt="מקור" style={{ maxWidth: '100%', maxHeight: '60vh', borderRadius: 6 }} /> : <span style={{ color: '#94a3b8' }}>—</span>}</div>
              </div>
              <div style={{ flex: '1 1 300px' }}>
                <div style={paneTitle}>גרסה {compare.versionNo}{compare.label ? ` · ${compare.label}` : ''}</div>
                <div style={stage}>{compareUrl ? <img src={compareUrl} alt="גרסה" style={{ maxWidth: '100%', maxHeight: '60vh', borderRadius: 6 }} /> : <span style={{ color: '#94a3b8' }}>טוען…</span>}</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// שכבת-על להצגת סימון (טקסט / חץ / מסגרת) על תמונת המקור. אינדיקציה בלבד — הצריבה האמיתית מהשרת.
function AnnoView({ a, draft }: { a: Anno; draft?: boolean }) {
  if (a.kind === 'frame') {
    return <div style={{ position: 'absolute', left: `${(a.x ?? 0) * 100}%`, top: `${(a.y ?? 0) * 100}%`, width: `${(a.w ?? 0) * 100}%`, height: `${(a.h ?? 0) * 100}%`, border: `2px ${draft ? 'dashed' : 'solid'} ${a.color}`, boxSizing: 'border-box', pointerEvents: 'none' }} />;
  }
  if (a.kind === 'text') {
    return <div style={{ position: 'absolute', left: `${(a.x ?? 0) * 100}%`, top: `${(a.y ?? 0) * 100}%`, color: a.color, fontSize: Math.max(10, Math.round(a.size * 0.5)), fontWeight: 700, lineHeight: 1, textShadow: '0 1px 2px rgba(0,0,0,0.55)', pointerEvents: 'none', whiteSpace: 'nowrap' }}>{a.value}</div>;
  }
  return (
    <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }} viewBox="0 0 100 100" preserveAspectRatio="none">
      <line x1={(a.x1 ?? 0) * 100} y1={(a.y1 ?? 0) * 100} x2={(a.x2 ?? 0) * 100} y2={(a.y2 ?? 0) * 100} stroke={a.color} strokeWidth={a.width} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

const overlay: CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.7)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 24, zIndex: 70, overflowY: 'auto' };
const modal: CSSProperties = { background: '#fff', borderRadius: 14, padding: 20, width: 'min(1040px, 96vw)', boxShadow: '0 20px 60px rgba(0,0,0,0.35)', marginTop: 24, marginBottom: 24 };
const stage: CSSProperties = { display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 220, background: '#0f172a', borderRadius: 10, padding: 10 };
const paneTitle: CSSProperties = { fontSize: 13, fontWeight: 600, marginBottom: 6, color: '#334155' };
const ctrlGroup: CSSProperties = { flex: '1 1 200px', minWidth: 190, display: 'flex', flexDirection: 'column', gap: 6, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 10 };
const ctrlLabel: CSSProperties = { fontSize: 13, color: '#334155' };
const chk: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, marginTop: 4 };
const ctl: CSSProperties = { fontSize: 12, color: '#334155', display: 'flex', alignItems: 'center', gap: 6 };
const divider: CSSProperties = { width: 1, height: 22, background: '#e2e8f0' };
const chip: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, background: '#f1f5f9', borderRadius: 999, padding: '3px 10px' };
const chipX: CSSProperties = { border: 'none', background: 'transparent', cursor: 'pointer', color: '#64748b', fontSize: 14, lineHeight: 1 };
const btn: CSSProperties = { padding: '8px 14px', background: '#fff', border: '1px solid #cbd5e1', borderRadius: 8, cursor: 'pointer' };
const primaryBtn: CSSProperties = { padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 };
const smallBtn: CSSProperties = { padding: '5px 10px', background: '#fff', border: '1px solid #cbd5e1', borderRadius: 7, cursor: 'pointer', fontSize: 13 };
const smallBtnOn: CSSProperties = { ...smallBtn, background: '#dbeafe', borderColor: '#60a5fa' };
const seg: CSSProperties = { padding: '5px 10px', background: '#fff', border: '1px solid #cbd5e1', borderRadius: 7, cursor: 'pointer', fontSize: 13 };
const segOn: CSSProperties = { ...seg, background: '#1e293b', color: '#fff', borderColor: '#1e293b' };
const miniBtn: CSSProperties = { padding: '3px 8px', background: '#fff', border: '1px solid #cbd5e1', borderRadius: 6, cursor: 'pointer', fontSize: 12 };
