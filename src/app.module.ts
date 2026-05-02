import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { IngestModule } from './ingest/ingest.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { AuthModule } from './auth/auth.module';
import { PluginModule } from './plugins/plugin.module';
import { TelemetryModule } from './telemetry/telemetry.module';
import { ControlPlaneModule } from './control-plane/control-plane.module';
import { AlertsModule } from './alerts/alerts.module';
import { StateModule } from './state/state.module';

@Module({
  imports: [
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'frontend', 'dist'),
      exclude: ['/api{/*path}', '/v1{/*path}', '/health{/*path}'],
    }),
    ConfigModule,
    StateModule,
    DatabaseModule,
    TelemetryModule,
    ControlPlaneModule,
    AlertsModule,
    PluginModule,
    AuthModule,
    IngestModule,
    DashboardModule,
  ],
})
export class AppModule {}
