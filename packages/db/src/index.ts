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
  ComplianceStateError,
  PostgresComplianceRepository,
  type CreateComplianceDecisionInput,
  type CreatedComplianceDecision,
  type RegionPolicyView,
  type SocialManualItem
} from "./repositories/compliance.js";
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
  GmailOAuthStateError,
  PostgresGmailAuthRepository,
  type ConsumedGmailOAuthState,
  type GmailCredentialRecord,
  type GmailSenderRecord
} from "./repositories/gmail-auth.js";
export {
  InboundStateError,
  PostgresInboundRepository,
  type IngestedReplyResult,
  type KnownGmailThread,
  type ReplyDetail,
  type ReplyHandoffContext,
  type ReplyListItem
} from "./repositories/inbound.js";
export {
  OutreachStateError,
  PostgresOutreachRepository,
  type ClaimedOutbound,
  type ClaimOutboundResult,
  type CreatedSequence,
  type CreateSequenceInput,
  type OutboxEventRecord,
  type RuntimeSendGate,
  type SequenceWorkspace
} from "./repositories/outreach.js";
export {
  PostgresSafetyControlRepository,
  type AuditActor
} from "./repositories/safety-controls.js";
export {
  PostgresMetricsRepository,
  type CostMetrics,
  type DeliverabilityMetrics,
  type FunnelMetrics,
  type QualityMetrics
} from "./repositories/metrics.js";
export {
  PostgresReadinessRepository,
  ReadinessStateError,
  type ChecklistItemView,
  type ChecklistStatus,
  type EvalRunView,
  type PilotRunView,
  type ReadinessSnapshot
} from "./repositories/readiness.js";
export {
  DataGovernanceStateError,
  PostgresDataGovernanceRepository,
  type DataExportBundle,
  type ErasureResult
} from "./repositories/data-governance.js";
export {
  DiscoveryStateError,
  PostgresDiscoveryRepository,
  type CandidateSourceInput,
  type ClaimProviderActionInput,
  type CompleteDiscoveryRunInput,
  type DiscoveredCandidateInput,
  type DiscoveryCampaignView,
  type DiscoveryCandidateView,
  type DiscoveryRunContext,
  type DiscoveryRunRecord,
  type DiscoverySeedRecord,
  type ProviderActionRecord
} from "./repositories/discovery.js";
export { schema } from "./schema/index.js";
export { seedFoundations } from "./seed-data.js";
