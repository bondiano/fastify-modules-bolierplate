import type { AuditLogRepository } from './audit-log.repository.ts';

declare global {
  interface Dependencies {
    auditLogRepository: AuditLogRepository;
  }
}
