// files.controller.ts — נקודות הקצה לקבצים.
// POST /files/upload · GET /files · GET /files/trash · GET /files/:id · GET /files/:id/download · GET /files/:id/details · GET /files/:id/preview · DELETE /files/:id · POST /files/:id/restore
// כל פעולה דורשת הרשאה: העלאה=files.upload, צפייה=files.view, הורדת מקור=files.download_source, מחיקה=files.delete, שחזור=files.restore.
import {
  Body, Controller, Delete, Get, Param, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createReadStream } from 'fs';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { PERMISSIONS } from '../auth/permissions';
import { FilesService } from './files.service';
import { AccessService } from '../access/access.service';
import { MergeDuplicatesDto } from './dto/merge-duplicates.dto';

// Multer כותב את הקובץ הנכנס לתיקיית ההסגר (מחוץ לקוד) עם שם זמני, עד שייבדק וייכנס למאגר.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const multer = require('multer');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const nodeFs = require('fs');
const STORAGE_DIR = process.env.STORAGE_DIR ?? '/data';
const QUARANTINE = `${STORAGE_DIR}/quarantine`;
nodeFs.mkdirSync(QUARANTINE, { recursive: true });

const uploadOptions = {
  storage: multer.diskStorage({
    destination: (_req: any, _file: any, cb: any) => cb(null, QUARANTINE),
    filename: (_req: any, _file: any, cb: any) =>
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 * 1024 }, // 5GB
};

// סוגי קבצים שמותר להציג בתצוגה מקדימה inline (תמונה/וידאו/שמע/PDF/טקסט). אחרים — אין preview (דורש הורדת מקור).
function previewableType(mime?: string | null): string | null {
  if (!mime) return null;
  if (mime === 'application/pdf' || mime === 'text/plain') return mime;
  if (mime.startsWith('image/') || mime.startsWith('video/') || mime.startsWith('audio/')) return mime;
  return null;
}

@Controller('files')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class FilesController {
  constructor(private readonly files: FilesService, private readonly access: AccessService) {}

  @Post('upload')
  @RequirePermissions(PERMISSIONS.FILES_UPLOAD)
  @UseInterceptors(FileInterceptor('file', uploadOptions))
  upload(@Req() req: any, @UploadedFile() file: any, @Body() body: any) {
    return this.files.ingest(req.user.sub, file, body ?? {});
  }

  // מיזוג כפילויות (שמירת אחד, הסרת השאר). מסיר רשומות → דורש הרשאת מחיקה.
  @Post('duplicates/merge')
  @RequirePermissions(PERMISSIONS.FILES_DELETE)
  merge(@Req() req: any, @Body() dto: MergeDuplicatesDto) {
    return this.files.mergeDuplicates(req.user.sub, dto.keepId, dto.removeIds);
  }

  // GET /files — חיפוש (q), סינון מתקדם, מיון (sort/order) וטעינה במנות (page/pageSize). שלבים 2.1–2.2.
  @Get()
  @RequirePermissions(PERMISSIONS.FILES_VIEW)
  list(
    @Req() req: any,
    @Query('q') q?: string,
    @Query('folderId') folderId?: string,
    @Query('tagId') tagId?: string,
    @Query('withSub') withSub?: string,
    @Query('untagged') untagged?: string,
    @Query('tagIds') tagIds?: string,
    @Query('excludeTagIds') excludeTagIds?: string,
    @Query('mimeTypes') mimeTypes?: string,
    @Query('ext') ext?: string,
    @Query('sizeMin') sizeMin?: string,
    @Query('sizeMax') sizeMax?: string,
    @Query('createdFrom') createdFrom?: string,
    @Query('createdTo') createdTo?: string,
    @Query('uploadedById') uploadedById?: string,
    @Query('source') source?: string,
    @Query('duplicate') duplicate?: string,
    @Query('backedUp') backedUp?: string,
    @Query('sort') sort?: string,
    @Query('order') order?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    // רשימות (תגיות/סוגים) מגיעות כמחרוזת מופרדת בפסיקים.
    const csv = (v?: string) => (v ? v.split(',').map((x) => x.trim()).filter(Boolean) : undefined);
    return this.files.list({
      q,
      folderId,
      tagId,
      withSub: withSub === 'true' || withSub === '1',
      untagged: untagged === 'true' || untagged === '1',
      tagIds: csv(tagIds),
      excludeTagIds: csv(excludeTagIds),
      mimeTypes: csv(mimeTypes),
      ext,
      sizeMin: sizeMin !== undefined && sizeMin !== '' ? Number(sizeMin) : undefined,
      sizeMax: sizeMax !== undefined && sizeMax !== '' ? Number(sizeMax) : undefined,
      createdFrom,
      createdTo,
      uploadedById,
      source,
      duplicate,
      backedUp: backedUp === 'true' ? true : backedUp === 'false' ? false : undefined,
      sort,
      order,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      userId: req.user.sub,
    });
  }

  @Get('trash')
  @RequirePermissions(PERMISSIONS.FILES_RESTORE)
  trash() {
    return this.files.listDeleted();
  }

  // דוח כפילויות מלאות — קבוצות קבצים עם תוכן זהה (אותו hash). חייב לבוא לפני ':id'.
  @Get('duplicates')
  @RequirePermissions(PERMISSIONS.FILES_VIEW)
  duplicates(@Req() req: any) {
    return this.files.duplicates(req.user.sub);
  }

  // סוגי הקבצים (mime) הקיימים במאגר — לתפריט הסינון "סוג". חייב לבוא לפני ':id'.
  @Get('types')
  @RequirePermissions(PERMISSIONS.FILES_VIEW)
  types() {
    return this.files.availableTypes();
  }

  // מי שהעלה/ייבא קבצים — לתפריט הסינון "מי שהעלה". חייב לבוא לפני ':id'.
  @Get('uploaders')
  @RequirePermissions(PERMISSIONS.FILES_VIEW)
  uploaders() {
    return this.files.uploaders();
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.FILES_VIEW)
  async meta(@Req() req: any, @Param('id') id: string) {
    await this.access.assertCanView(req.user.sub, id, { device: req.user.device });
    return this.files.meta(id);
  }

  // הורדת המקור — דורשת הרשאה מפורשת. תמיד כקובץ להורדה (attachment) ולא inline — מניעת הרצה/רינדור.
  @Get(':id/download')
  @RequirePermissions(PERMISSIONS.FILES_DOWNLOAD_SOURCE)
  async download(@Req() req: any, @Param('id') id: string, @Res() res: any) {
    await this.access.assertCanView(req.user.sub, id, { device: req.user.device });
    const { file, filePath } = await this.files.getForDownload(id);
    // [שינוי 2026-06-25] רישום הורדת מקור ביומן הביקורת — עד כה הורדות לא תועדו כלל (גם של מנהל).
    await this.files.recordDownload(req.user.sub, file, req.user.device);
    const encoded = encodeURIComponent(file.name);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encoded}`);
    createReadStream(filePath).pipe(res);
  }

  // פרטי-על מלאים של קובץ (שלב 2.5) — צפייה בלבד.
  @Get(':id/details')
  @RequirePermissions(PERMISSIONS.FILES_VIEW)
  async details(@Req() req: any, @Param('id') id: string) {
    await this.access.assertCanView(req.user.sub, id, { device: req.user.device });
    return this.files.details(id);
  }

  // תצוגה מקדימה (שלב 2.5) — הזרמה inline, לסוגים מותרים בלבד, עם הגנות (nosniff, CSP sandbox, no-store, שם כללי).
  // דורשת files.view (לא הורדת מקור). הטוקן עובר בכותרת מה-fetch — גישה ישירה לכתובת ללא טוקן מחזירה 401,
  // ולכן ה-preview אינו דרך לחשוף את המקור להורדה.
  @Get(':id/preview')
  @RequirePermissions(PERMISSIONS.FILES_VIEW)
  async preview(@Req() req: any, @Param('id') id: string, @Res() res: any) {
    await this.access.assertCanView(req.user.sub, id, { device: req.user.device });
    const { file, filePath } = await this.files.getForPreview(id);
    const type = previewableType(file.mimeType);
    if (!type) {
      res.status(415).json({ message: 'אין תצוגה מקדימה לסוג קובץ זה' });
      return;
    }
    res.setHeader('Content-Type', type);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; media-src 'self'; object-src 'none'; style-src 'unsafe-inline'; sandbox");
    res.setHeader('Content-Disposition', 'inline; filename="preview"');
    createReadStream(filePath).pipe(res);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.FILES_DELETE)
  remove(@Req() req: any, @Param('id') id: string) {
    return this.files.softDelete(req.user.sub, id);
  }

  @Post(':id/restore')
  @RequirePermissions(PERMISSIONS.FILES_RESTORE)
  restore(@Req() req: any, @Param('id') id: string) {
    return this.files.restore(req.user.sub, id);
  }
}
