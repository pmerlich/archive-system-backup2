// devices.service.ts — ניהול מכשירים מאושרים (שלב 3.3). אישור/ביטול ע"י מנהל אבטחה.
// הרישום עצמו של מכשיר חדש נעשה ב-auth.service (resolveReaderDevice) בעת כניסת ה-Reader.
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DevicesService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const devices = await this.prisma.device.findMany({ orderBy: [{ approved: 'asc' }, { createdAt: 'desc' }] });
    const ids = [...new Set(devices.map((d) => d.userId))];
    const users = ids.length ? await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }) : [];
    const byId = new Map(users.map((u) => [u.id, u]));
    return devices.map((d) => ({
      id: d.id, deviceId: d.deviceId, name: d.name, approved: d.approved,
      revokedAt: d.revokedAt, lastSeenAt: d.lastSeenAt, createdAt: d.createdAt,
      user: byId.get(d.userId) ?? null,
    }));
  }

  async approve(actorId: string, id: string) {
    const d = await this.prisma.device.findUnique({ where: { id } });
    if (!d) throw new NotFoundException('המכשיר לא נמצא');
    const upd = await this.prisma.device.update({ where: { id }, data: { approved: true, revokedAt: null } });
    await this.audit('device.approved', actorId, id, { deviceId: d.deviceId, ownerUserId: d.userId });
    return upd;
  }

  async revoke(actorId: string, id: string) {
    const d = await this.prisma.device.findUnique({ where: { id } });
    if (!d) throw new NotFoundException('המכשיר לא נמצא');
    const upd = await this.prisma.device.update({ where: { id }, data: { approved: false, revokedAt: new Date() } });
    await this.audit('device.revoked', actorId, id, { deviceId: d.deviceId, ownerUserId: d.userId });
    return upd;
  }

  private async audit(action: string, userId: string, targetId: string, details: any) {
    await this.prisma.auditEvent.create({ data: { action, userId, targetType: 'device', targetId, details } });
  }
}
