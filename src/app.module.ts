import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { SequelizeModule } from "@nestjs/sequelize";
import { ScheduleModule } from "@nestjs/schedule";
import { EventEmitterModule } from "@nestjs/event-emitter";
import configuration from "./config/configuration";

import { AuthModule } from "./auth/auth.module";
import { BucketsModule } from "./buckets/buckets.module";
import { ObjectsModule } from "./objects/objects.module";
import { MultipartModule } from "./multipart/multipart.module";
import { StorageModule } from "./storage/storage.module";
import { AccessControlModule } from "./access-control/access-control.module";
import { LifecycleModule } from "./lifecycle/lifecycle.module";
import { ReplicationModule } from "./replication/replication.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { AuditModule } from "./audit/audit.module";

import { RequestIdInterceptor } from "./common/interceptors/request-id.interceptor";
import { RateLimitGuard } from "./common/guards/rate-limit.guard";
import { S3ErrorFilter } from "./common/filters/s3-error.filter";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),
    SequelizeModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const db = config.get("database");
        return {
          dialect: db.dialect,
          storage: db.dialect === "sqlite" ? db.storage : undefined,
          host: db.host,
          port: db.port,
          username: db.username,
          password: db.password,
          database: db.database,
          autoLoadModels: true,
          // Dev/demo convenience only — a real deployment should use
          // versioned migrations instead of letting Sequelize sync the
          // schema from the models on every boot.
          synchronize: true,
        };
      },
    }),
    AccessControlModule,
    AuthModule,
    StorageModule,
    BucketsModule,
    ObjectsModule,
    MultipartModule,
    LifecycleModule,
    ReplicationModule,
    NotificationsModule,
    AuditModule,
  ],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: RequestIdInterceptor },
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_FILTER, useClass: S3ErrorFilter },
  ],
})
export class AppModule {}
