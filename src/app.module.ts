import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { IngestModule } from './ingest/ingest.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { AuthModule } from './auth/auth.module';
import { PluginModule } from './plugins/plugin.module';

@Module({
  imports: [
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'frontend', 'dist'),
      exclude: ['/api(.*)', '/v1(.*)', '/health(.*)'],
    }),
    ConfigModule,
    DatabaseModule,
    PluginModule,
    AuthModule,
    IngestModule,
    DashboardModule,
  ],
})
export class AppModule {}
