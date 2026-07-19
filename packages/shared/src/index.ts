export {
  INITIAL_AUTHORIZED_EMAIL,
  INNOVATEATS_WEBSITE,
  MAX_SEQUENCE_TOUCHES,
  operationModes,
  type OperationMode
} from "./constants.js";
export {
  defaultFeatureFlags,
  featureFlagKeys,
  featureFlagKeySchema,
  killSwitchScopeTypes,
  killSwitchScopeTypeSchema,
  normalizeFeatureFlags,
  type FeatureFlagKey,
  type KillSwitchScope,
  type KillSwitchScopeType
} from "./feature-flags.js";
export { isAuthorizedEmail, normalizeEmail } from "./identity.js";
export {
  approvalStatuses,
  containsRequiredInnovatEatsWebsite,
  evaluateOutboundSafety,
  policyDecisions,
  requiredWebsiteFooter,
  type ApprovalStatus,
  type OutboundBlockReason,
  type OutboundSafetyDecision,
  type OutboundSafetyInput,
  type PolicyDecision
} from "./outbound-safety.js";
