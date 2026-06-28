// roles.service.ts — אחראי על תפקידי המערכת: זריעה אוטומטית בעליית השרת, ושליפה.
// הזריעה אידמפוטנטית: אפשר להריץ אינסוף פעמים — תמיד מסתיים באותם 8 תפקידים מובנים.
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ROLE_SEEDS } from '../auth/permissions';

@Injectable()
export class RolesService implements OnModuleInit {
  private readonly logger = new Logger('RolesService');

  constructor(private readonly prisma: PrismaService) {}

  // רץ אוטומטית כשהשרת עולה — מוודא שכל התפקידים המובנים קיימים ומעודכנים.
  async onModuleInit(): Promise<void> {
    await this.seedSystemRoles();
  }

  // יוצר/מעדכן את 8 התפקידים המובנים. עדכון לפי "שם" — כדי לקלוט גם תפקידים ישנים
  // שנוצרו לפני שהיו להם מפתח והרשאות.
  async seedSystemRoles(): Promise<void> {
    for (const seed of ROLE_SEEDS) {
      await this.prisma.role.upsert({
        where: { name: seed.name },
        update: {
          key: seed.key,
          description: seed.description,
          permissions: seed.permissions,
          isOwner: seed.isOwner ?? false,
          isSystem: true,
        },
        create: {
          key: seed.key,
          name: seed.name,
          description: seed.description,
          permissions: seed.permissions,
          isOwner: seed.isOwner ?? false,
          isSystem: true,
        },
      });
    }
    this.logger.log(`נזרעו/עודכנו ${ROLE_SEEDS.length} תפקידי מערכת מובנים`);
  }

  // רשימת התפקידים להצגה במסך הניהול (סדר קבוע: בעלים תחילה).
  async listRoles() {
    const roles = await this.prisma.role.findMany({
      orderBy: [{ isOwner: 'desc' }, { createdAt: 'asc' }],
      select: { id: true, key: true, name: true, description: true, permissions: true, isOwner: true },
    });
    return roles;
  }

  findByKey(key: string) {
    return this.prisma.role.findUnique({ where: { key } });
  }
}
