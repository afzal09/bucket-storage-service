import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { NotificationConfig } from './entities/notification-config.entity';
import { EventPublisherService } from './event-publisher.service';
import { WebhookDispatcher } from './webhook-dispatcher.service';

@Module({
  imports: [SequelizeModule.forFeature([NotificationConfig])],
  providers: [EventPublisherService, WebhookDispatcher],
  exports: [EventPublisherService],
})
export class NotificationsModule {}
