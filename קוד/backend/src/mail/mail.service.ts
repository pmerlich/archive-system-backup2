// mail.service.ts — שליחת מיילים (קודים חד-פעמיים). בפיתוח שולח ל-Mailpit; בשרת — ל-SMTP אמיתי.
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: nodemailer.Transporter;
  private readonly from: string;

  constructor(config: ConfigService) {
    const mail = config.get<{ host: string; port: number; from: string }>('mail')!;
    this.from = mail.from;
    this.transporter = nodemailer.createTransport({ host: mail.host, port: mail.port, secure: false });
  }

  async sendOtp(to: string, code: string, purpose: 'login' | 'enable' | 'share'): Promise<void> {
    const subject = purpose === 'login' ? 'קוד כניסה למערכת הארכיון' : purpose === 'share' ? 'קוד צפייה בקובץ ששותף איתך' : 'קוד הפעלת אימות דו-שלבי';
    const html = `
      <div style="font-family:Arial,sans-serif;direction:rtl;text-align:right;max-width:480px">
        <h2 style="color:#1f4e79">מערכת ארכיון</h2>
        <p>הקוד החד-פעמי שלך:</p>
        <p style="font-size:28px;font-weight:bold;letter-spacing:4px;color:#1f4e79">${code}</p>
        <p style="color:#6b7280">הקוד תקף ל-10 דקות. אם לא ביקשת אותו, אפשר להתעלם מההודעה.</p>
      </div>`;
    await this.transporter.sendMail({ from: this.from, to, subject, html });
    this.logger.log(`OTP email (${purpose}) sent to ${to}`);
  }
}
