export { account, session, user, verification } from "./auth.js";
export {
  agentRuns,
  contacts,
  contactVerifications,
  evidence,
  founders,
  leads,
  leadScores,
  leadStatusHistory,
  messageApprovals,
  messageDrafts,
  organizations,
  sourceDocuments,
  sources,
  strategyBriefs
} from "./crm.js";
export {
  auditLog,
  featureFlags,
  killSwitches,
  regions,
  schemaMigrations,
  systemSettings
} from "./foundations.js";

import { account, session, user, verification } from "./auth.js";
import {
  agentRuns,
  contacts,
  contactVerifications,
  evidence,
  founders,
  leads,
  leadScores,
  leadStatusHistory,
  messageApprovals,
  messageDrafts,
  organizations,
  sourceDocuments,
  sources,
  strategyBriefs
} from "./crm.js";
import {
  auditLog,
  featureFlags,
  killSwitches,
  regions,
  schemaMigrations,
  systemSettings
} from "./foundations.js";

export const schema = {
  account,
  agentRuns,
  auditLog,
  contacts,
  contactVerifications,
  evidence,
  featureFlags,
  founders,
  killSwitches,
  leads,
  leadScores,
  leadStatusHistory,
  messageApprovals,
  messageDrafts,
  organizations,
  regions,
  schemaMigrations,
  session,
  sourceDocuments,
  sources,
  strategyBriefs,
  systemSettings,
  user,
  verification
};
