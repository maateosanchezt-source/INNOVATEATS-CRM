export { account, session, user, verification } from "./auth.js";
export {
  evidence,
  leads,
  leadStatusHistory,
  organizations,
  sourceDocuments,
  sources
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
  evidence,
  leads,
  leadStatusHistory,
  organizations,
  sourceDocuments,
  sources
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
  auditLog,
  evidence,
  featureFlags,
  killSwitches,
  leads,
  leadStatusHistory,
  organizations,
  regions,
  schemaMigrations,
  session,
  sourceDocuments,
  sources,
  systemSettings,
  user,
  verification
};
