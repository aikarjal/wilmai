// The relay reuses the CLI's Wilma logic through deep imports of its build
// output (packages/wilma-cli/dist). Importing the package root would run the CLI.
// Everything Wilma-related comes through the CLI package so the relay uses the
// same wilma-client copy (and error classes) the CLI does.
export { WilmaAccess, adoptSession } from "@wilm-ai/wilma-cli/dist/agent-data.js";
export {
  AuthenticationError,
  isMfaFailure,
  mfaCallbackFor,
  TotpSecretInvalidError,
  TotpSecretRequiredError,
  verifyLoginSession,
} from "@wilm-ai/wilma-cli/dist/credentials.js";
export { renderLoginPage } from "@wilm-ai/wilma-cli/dist/login-server.js";
export { INSTRUCTIONS, READ_ONLY, json, registerWilmaTools, textResult } from "@wilm-ai/wilma-cli/dist/mcp-tools.js";
export { normalizeTenantUrl } from "@wilm-ai/wilma-cli/dist/tenant-search.js";
export { findTenant, searchTenantList } from "./tenants";
