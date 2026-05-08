import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ManagementAuditEvent } from '../database/entities';
import { AuditRequestContextInterceptor } from './audit-request-context.interceptor';
import { AuditRequestContextService } from './audit-request-context.service';
import { ManagementAuditService } from './management-audit.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([ManagementAuditEvent])],
  providers: [
    AuditRequestContextService,
    ManagementAuditService,
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditRequestContextInterceptor,
    },
  ],
  exports: [AuditRequestContextService, ManagementAuditService],
})
export class AuditModule {}
