import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/sequelize';
import { NotificationConfig } from './entities/notification-config.entity';
import { ObjectEvent } from './event-publisher.service';

const MAX_ATTEMPTS = 3;

@Injectable()
export class WebhookDispatcher {
  private readonly logger = new Logger(WebhookDispatcher.name);

  constructor(@InjectModel(NotificationConfig) private readonly configModel: typeof NotificationConfig) {}

  @OnEvent('ObjectCreated')
  @OnEvent('ObjectRemoved')
  async handle(event: ObjectEvent): Promise<void> {
    const configs = await this.configModel.findAll({ where: { bucketName: event.bucketName } });
    const interested = configs.filter((c) => c.events.includes(event.type));

    await Promise.all(interested.map((config) => this.dispatchWithRetry(config.webhookUrl, event)));
  }

  private async dispatchWithRetry(url: string, event: ObjectEvent, attempt = 1): Promise<void> {
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      });
    } catch (err) {
      this.logger.warn(`Webhook delivery to ${url} failed (attempt ${attempt}): ${(err as Error).message}`);
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 500));
        return this.dispatchWithRetry(url, event, attempt + 1);
      }
    }
  }
}
