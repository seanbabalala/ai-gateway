import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Organization, Workspace } from '../database/entities';
import { WorkspaceContextInterceptor } from './workspace-context.interceptor';
import { WorkspaceContextService } from './workspace-context.service';
import { WorkspaceService } from './workspace.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Organization, Workspace])],
  providers: [
    WorkspaceContextService,
    WorkspaceService,
    {
      provide: APP_INTERCEPTOR,
      useClass: WorkspaceContextInterceptor,
    },
  ],
  exports: [WorkspaceContextService, WorkspaceService],
})
export class WorkspacesModule {}
