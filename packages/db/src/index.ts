export { createDatabaseClient, type AppDatabase, type DatabaseClient } from "./client.js";
export { applyMigrations, readMigrationFiles, type MigrationFile } from "./migrations.js";
export {
  ContactAssociationError,
  ContactNotFoundError,
  PostgresContactRepository,
  type ContactExtractionSource,
  type ContactRecord,
  type SaveContactResult
} from "./repositories/contact.js";
export {
  EvidenceNotFoundError,
  InvalidLeadTransitionError,
  LeadNotFoundError,
  PostgresCrmRepository,
  type EvidenceRecord,
  type LeadDetail,
  type LeadHistoryRecord,
  type LeadListFilters,
  type LeadListItem,
  type ManualIngestResult
} from "./repositories/crm.js";
export {
  PostgresResearchRepository,
  ResearchStateError,
  type AgentRunCompletion,
  type AgentRunRecord,
  type AgentRunStartInput,
  type EntityResolutionResult,
  type FounderRecord,
  type LeadScoreRecord,
  type SnapshotRecordResult
} from "./repositories/research.js";
export {
  MessageDraftNotFoundError,
  MessageStateError,
  PostgresMessageRepository,
  type ApprovalResult,
  type MessageApprovalRecord,
  type MessageDecision,
  type MessageDraftRecord,
  type MessageWorkspace,
  type SaveGeneratedSequenceResult,
  type StrategyBriefRecord
} from "./repositories/message.js";
export {
  PostgresSafetyControlRepository,
  type AuditActor
} from "./repositories/safety-controls.js";
export { schema } from "./schema/index.js";
export { seedFoundations } from "./seed-data.js";
