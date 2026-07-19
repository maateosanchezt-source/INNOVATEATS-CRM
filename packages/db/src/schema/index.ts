export { account, session, user, verification } from "./auth.js";
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
  featureFlags,
  killSwitches,
  regions,
  schemaMigrations,
  session,
  systemSettings,
  user,
  verification
};
