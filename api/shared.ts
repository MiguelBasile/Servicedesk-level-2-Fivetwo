type AdoAuthMode = "entra" | "pat";
type Severity = "low" | "medium" | "high" | "critical";
type WatchStatus = "at-risk" | "breached";

type EntraTokenCache = {
  accessToken: string;
  expiresAt: number;
};

type AdoFieldCache = {
  referenceNames: Set<string>;
  expiresAt: number;
};

type ClientPrincipal = {
  identityProvider?: string;
  userId?: string;
  userDetails?: string;
  userRoles?: string[];
  claims?: Array<{ typ?: string; type?: string; val?: string; value?: string }>;
};

export type AdoWorkItem = {
  id: number;
  fields: Record<string, unknown>;
};

export type DashboardScope = {
  customerId?: string;
  displayName: string;
  mode: "user-map" | "static-customer" | "internal-all" | "mock";
};

export type UserCustomerMapping = {
  userDetails: string;
  customerId: string;
  displayName: string;
};

export type AllowedUserAccess = {
  authenticated: boolean;
  allowed: boolean;
  status: number;
  reason?: "local-mock-bypass" | "missing-principal" | "missing-user-details" | "missing-allowlist" | "not-allowed";
  user?: {
    identityProvider?: string;
    userDetails: string;
    userId?: string;
  };
};

export type DashboardSession = {
  authenticated: boolean;
  allowed: boolean;
  status: number;
  reason?: AllowedUserAccess["reason"];
  user?: AllowedUserAccess["user"];
  scope?: DashboardScope;
  scopeConfigured: boolean;
  scopeReason?: "mapped" | "static" | "internal-all" | "missing" | "unmapped";
};

export type OverviewMetrics = {
  majorIncidentsOpen: number;
  breachedSla: number;
  atRiskSla: number;
  p1Open: number;
  totalOpen: number;
  unassigned: number;
  blockedOpen: number;
  closedThisMonth: number;
};

export type OverviewIncident = {
  severity: Severity;
  title: string;
  state: string;
  assignee: string;
  customer: string;
  updateInterval: string;
};

export type OverviewWatchItem = {
  status: WatchStatus;
  title: string;
  assignee: string;
  remaining: string;
};

export type DashboardOverview = {
  metrics: OverviewMetrics;
  incidents: OverviewIncident[];
  slaWatch: OverviewWatchItem[];
  scope: Pick<DashboardScope, "displayName" | "mode">;
};

const azureDevOpsEntraScope = "https://app.vssps.visualstudio.com/.default";
const closedStates = ["closed", "done", "completed", "resolved", "removed"];
const blockedPatterns = ["blocked", "waiting", "hold", "dependency"];
const defaultWorkItemTypes = [
  "Incident",
  "Major Incident",
  "Service Request",
  "Operational Task",
  "Task",
  "User Story",
  "Feature",
  "Epic",
  "Bug",
  "Issue"
];
const baseFields = [
  "System.Id",
  "System.Title",
  "System.State",
  "System.WorkItemType",
  "System.CreatedDate",
  "System.ChangedDate",
  "System.AssignedTo",
  "System.Tags",
  "Microsoft.VSTS.Common.Priority",
  "Microsoft.VSTS.Common.Severity",
  "Microsoft.VSTS.Scheduling.DueDate",
  "Custom.SlaDueDate",
  "Custom.Customer"
];

let entraTokenCache: EntraTokenCache | undefined;
let adoFieldCache: AdoFieldCache | undefined;

export class AuthError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export class AdoRequestError extends Error {
  status: number;
  operation: string;
  safeMessage: string;

  constructor(message: string, status: number, operation = "azure-devops", safeMessage = message) {
    super(message);
    this.status = status;
    this.operation = operation;
    this.safeMessage = safeMessage;
  }
}

export type SafeApiError = {
  status: number;
  body: {
    error: string;
    message?: string;
    source?: string;
    status?: number;
  };
};

export function parseAllowedUserUpns(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => normalizeUserIdentifier(entry))
    .filter((entry): entry is string => Boolean(entry));
}

export function parseUserCustomerMap(value: string | undefined): UserCustomerMapping[] {
  const mappings: UserCustomerMapping[] = [];

  for (const entry of (value ?? "").split(",")) {
    const trimmed = entry.trim();
    const separatorIndex = getMappingSeparatorIndex(trimmed);
    if (separatorIndex <= 0) continue;

    const userDetails = normalizeUserIdentifier(trimmed.slice(0, separatorIndex));
    const customerValue = trimmed.slice(separatorIndex + 1).trim();
    const [customerId, displayName] = customerValue.split("|").map((part) => part.trim());

    if (!userDetails || !customerId) continue;
    mappings.push({ userDetails, customerId, displayName: displayName || customerId });
  }

  return mappings;
}

export function parseSwaClientPrincipal(headers: Headers): ClientPrincipal | undefined {
  const encoded = headers.get("x-ms-client-principal");
  if (!encoded) return undefined;

  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as ClientPrincipal;
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function getAllowedUserAccess(
  headers: Headers,
  env: Record<string, string | undefined> = process.env
): AllowedUserAccess {
  if (env.MOCK_MODE === "true" && env.NODE_ENV !== "production") {
    return {
      authenticated: true,
      allowed: true,
      status: 200,
      reason: "local-mock-bypass",
      user: { identityProvider: "mock", userDetails: "dev@fivetwo.local" }
    };
  }

  const principal = parseSwaClientPrincipal(headers);
  const userIdentifiers = getPrincipalUserIdentifiers(principal);
  const userDetails = userIdentifiers[0];

  if (!principal) {
    return { authenticated: false, allowed: false, status: 401, reason: "missing-principal" };
  }

  if (!userDetails) {
    return { authenticated: true, allowed: false, status: 403, reason: "missing-user-details" };
  }

  const allowedUpns = parseAllowedUserUpns(env.ALLOWED_USER_UPNS);
  if (allowedUpns.length === 0) {
    return { authenticated: true, allowed: false, status: 500, reason: "missing-allowlist", user: toAllowedUser(principal, userDetails) };
  }

  const allowedIdentifier = userIdentifiers.find((identifier) => allowedUpns.includes(identifier));
  if (!allowedIdentifier) {
    return { authenticated: true, allowed: false, status: 403, reason: "not-allowed", user: toAllowedUser(principal, userDetails) };
  }

  return { authenticated: true, allowed: true, status: 200, user: toAllowedUser(principal, allowedIdentifier) };
}

export function getDashboardSession(
  headers: Headers,
  env: Record<string, string | undefined> = process.env
): DashboardSession {
  const access = getAllowedUserAccess(headers, env);
  if (!access.allowed) {
    return {
      authenticated: access.authenticated,
      allowed: access.allowed,
      status: access.status,
      reason: access.reason,
      user: access.user,
      scopeConfigured: false
    };
  }

  const scope = getConfiguredDashboardScope(access.user?.userDetails, env);
  return {
    authenticated: true,
    allowed: true,
    status: 200,
    user: access.user,
    scope: scope.scope,
    scopeConfigured: Boolean(scope.scope),
    scopeReason: scope.reason
  };
}

export function verifyAllowedDashboardUser(
  headers: Headers,
  env: Record<string, string | undefined> = process.env
): AllowedUserAccess["user"] {
  const access = getAllowedUserAccess(headers, env);
  if (!access.allowed) {
    throw new AuthError(accessErrorMessage(access), access.status);
  }

  return access.user;
}

export function resolveDashboardScope(
  headers: Headers,
  env: Record<string, string | undefined> = process.env
): DashboardScope {
  const user = verifyAllowedDashboardUser(headers, env);
  const configured = getConfiguredDashboardScope(user?.userDetails, env);

  if (configured.scope) return configured.scope;
  if (configured.reason === "unmapped") throw new AuthError("Dashboard scope is not configured for this account", 403);

  throw new AuthError("Dashboard scope is not configured", 500);
}

export async function getAdoConnectionStatus() {
  const org = requireEnv("ADO_ORG");
  const project = requireEnv("ADO_PROJECT");
  const fieldReferenceNames = await getAdoFieldReferenceNames();
  const customerField = getCustomerField();

  return {
    connected: true,
    org,
    project,
    authMode: getAdoAuthMode(),
    customerField,
    customerFieldAvailable: fieldReferenceNames.has(customerField),
    slaFieldAvailable: fieldReferenceNames.has("Custom.SlaDueDate") || fieldReferenceNames.has("Microsoft.VSTS.Scheduling.DueDate"),
    availableFieldCount: fieldReferenceNames.size
  };
}

export async function getDashboardOverview(scope: DashboardScope): Promise<DashboardOverview> {
  const workItems = await getDashboardWorkItems(scope);
  return toDashboardOverview(workItems, scope);
}

export function getMockOverview(scope: DashboardScope = { customerId: "FiveTwo Internal", displayName: "FiveTwo Internal", mode: "mock" }) {
  return toDashboardOverview(mockWorkItems, scope);
}

export async function adoFetch(path: string, init: RequestInit = {}) {
  const org = requireEnv("ADO_ORG");
  const project = requireEnv("ADO_PROJECT");
  const authorization = await getAdoAuthorizationHeader();
  const operation = getAdoOperation(path);

  const response = await fetch(`https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/${path}`, {
    ...init,
    headers: {
      Authorization: authorization,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...init.headers
    }
  });

  if (!response.ok) {
    throw new AdoRequestError(
      `ADO ${operation} request failed: ${response.status}`,
      response.status,
      operation,
      getAdoFailureMessage(response.status, operation)
    );
  }

  return response.json();
}

export function toSafeApiError(error: unknown, fallback: string): SafeApiError {
  if (error instanceof AuthError) {
    return { status: error.status, body: { error: error.message, message: error.message, source: "dashboard-auth", status: error.status } };
  }

  if (error instanceof AdoRequestError) {
    return {
      status: error.status >= 400 && error.status < 500 ? error.status : 500,
      body: {
        error: fallback,
        message: error.safeMessage,
        source: error.operation,
        status: error.status
      }
    };
  }

  if (error instanceof Error && error.message.endsWith("is not configured")) {
    return {
      status: 500,
      body: {
        error: fallback,
        message: error.message,
        source: "configuration"
      }
    };
  }

  return { status: 500, body: { error: fallback, message: fallback } };
}

export function toDashboardOverview(
  workItems: AdoWorkItem[],
  scope: DashboardScope,
  now: Date = new Date()
): DashboardOverview {
  const startOfMonth = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const openItems = workItems.filter((item) => !isClosedState(item.fields["System.State"]));
  const slaItems = openItems
    .map((item) => ({ item, sla: getSlaStatus(item, now) }))
    .filter((entry): entry is { item: AdoWorkItem; sla: WatchStatus } => Boolean(entry.sla));
  const majorIncidentsOpen = openItems.filter((item) => isMajorIncident(item)).length;
  const breachedSla = slaItems.filter((entry) => entry.sla === "breached").length;
  const atRiskSla = slaItems.filter((entry) => entry.sla === "at-risk").length;

  const metrics: OverviewMetrics = {
    majorIncidentsOpen,
    breachedSla,
    atRiskSla,
    p1Open: openItems.filter((item) => priorityRank(item) === 1).length,
    totalOpen: openItems.length,
    unassigned: openItems.filter((item) => getAssigneeName(item.fields["System.AssignedTo"]) === "Unassigned").length,
    blockedOpen: openItems.filter((item) => isBlocked(item)).length,
    closedThisMonth: workItems.filter((item) => isClosedState(item.fields["System.State"]) && getChangedTime(item) >= startOfMonth).length
  };

  return {
    metrics,
    incidents: openItems
      .sort(sortBySeverityThenChanged)
      .slice(0, 5)
      .map((item) => toOverviewIncident(item, scope, now)),
    slaWatch: slaItems
      .sort((left, right) => sortBySlaThenChanged(left.item, right.item, left.sla, right.sla))
      .slice(0, 5)
      .map((entry) => toOverviewWatchItem(entry.item, entry.sla, now)),
    scope: { displayName: scope.displayName, mode: scope.mode }
  };
}

function getConfiguredDashboardScope(
  userDetails: string | undefined,
  env: Record<string, string | undefined>
): { scope?: DashboardScope; reason: DashboardSession["scopeReason"] } {
  if (env.MOCK_MODE === "true" && env.NODE_ENV !== "production") {
    const mockCustomer = env.LOCAL_DEV_CUSTOMER_ID?.trim() || "FiveTwo Internal";
    return { scope: { customerId: mockCustomer, displayName: mockCustomer, mode: "mock" }, reason: "static" };
  }

  const mappedCustomer = getMappedCustomerForUser(userDetails, env);
  if (mappedCustomer) return { scope: mappedCustomer, reason: "mapped" };

  const staticScope = (env.DASHBOARD_CUSTOMER_SCOPE || env.ADO_CUSTOMER_SCOPE)?.trim();
  if (staticScope) {
    return {
      scope: {
        customerId: staticScope,
        displayName: env.DASHBOARD_SCOPE_LABEL?.trim() || staticScope,
        mode: "static-customer"
      },
      reason: "static"
    };
  }

  if (isUserCustomerMapConfigured(env)) return { reason: "unmapped" };

  if (env.INTERNAL_DASHBOARD === "true") {
    return { scope: { displayName: "All allowed work items", mode: "internal-all" }, reason: "internal-all" };
  }

  return { reason: "missing" };
}

function getMappedCustomerForUser(
  userDetails: string | undefined,
  env: Record<string, string | undefined> = process.env
): DashboardScope | undefined {
  const normalizedUser = normalizeUserIdentifier(userDetails);
  if (!normalizedUser) return undefined;

  const mapping = parseUserCustomerMap(env.USER_CUSTOMER_MAP).find((entry) => entry.userDetails === normalizedUser);
  if (!mapping) return undefined;

  return { customerId: mapping.customerId, displayName: mapping.displayName, mode: "user-map" };
}

function isUserCustomerMapConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.USER_CUSTOMER_MAP?.trim());
}

async function getDashboardWorkItems(scope: DashboardScope): Promise<AdoWorkItem[]> {
  const workItemTypes = getConfiguredWorkItemTypes();
  const monthStart = getMonthStartIso();
  const customerField = getCustomerField();
  const availableFields = await getAdoFieldReferenceNames();

  if (scope.customerId && !availableFields.has(customerField)) {
    throw new AdoRequestError(
      `Configured customer field is not available: ${customerField}`,
      500,
      "configuration",
      `ADO_CUSTOMER_FIELD is set to ${customerField}, but that field was not found in Azure DevOps. Check the field reference name.`
    );
  }

  const scopeClause = scope.customerId ? `AND [${customerField}] = '${escapeWiql(scope.customerId)}'` : "";
  const wiql = {
    query: `
      SELECT [System.Id]
      FROM WorkItems
      WHERE [System.WorkItemType] IN (${workItemTypes.map((type) => `'${escapeWiql(type)}'`).join(", ")})
      ${scopeClause}
      AND (
        [System.State] NOT IN ('Closed', 'Done', 'Completed', 'Resolved', 'Removed')
        OR [System.ChangedDate] >= '${monthStart}'
      )
      ORDER BY [System.ChangedDate] DESC
    `
  };

  const result = await adoFetch("wit/wiql?api-version=7.1", {
    method: "POST",
    body: JSON.stringify(wiql)
  });
  const ids = (result.workItems ?? []).map((item: { id: number }) => item.id).slice(0, 200);
  if (ids.length === 0) return [];

  const fields = uniqueFields([...baseFields, customerField]).filter((field) => availableFields.has(field));
  const response = await adoFetch(`wit/workitems?ids=${ids.join(",")}&fields=${fields.map(encodeURIComponent).join(",")}&api-version=7.1`);
  return response.value ?? [];
}

function toOverviewIncident(item: AdoWorkItem, scope: DashboardScope, now: Date): OverviewIncident {
  const slaStatus = getSlaStatus(item, now);

  return {
    severity: getSeverity(item, slaStatus),
    title: safeText(item.fields["System.Title"], `Ticket ${item.id}`),
    state: safeText(item.fields["System.State"], "New"),
    assignee: getAssigneeName(item.fields["System.AssignedTo"]),
    customer: getCustomerLabel(item, scope),
    updateInterval: getUpdateLabel(item, now, slaStatus)
  };
}

function toOverviewWatchItem(item: AdoWorkItem, status: WatchStatus, now: Date): OverviewWatchItem {
  return {
    status,
    title: safeText(item.fields["System.Title"], `Ticket ${item.id}`),
    assignee: getAssigneeName(item.fields["System.AssignedTo"]),
    remaining: getSlaRemainingLabel(item, now, status)
  };
}

function getSlaStatus(item: AdoWorkItem, now: Date): WatchStatus | undefined {
  const dueTime = getDueTime(item);
  if (!Number.isFinite(dueTime)) return undefined;
  if (dueTime <= now.getTime()) return "breached";

  const createdTime = Date.parse(String(item.fields["System.CreatedDate"] ?? ""));
  if (!Number.isFinite(createdTime)) return dueTime - now.getTime() <= 4 * 60 * 60 * 1000 ? "at-risk" : undefined;

  const totalWindow = dueTime - createdTime;
  const remaining = dueTime - now.getTime();
  if (remaining <= 4 * 60 * 60 * 1000 || remaining <= totalWindow * 0.2) return "at-risk";
  return undefined;
}

function getUpdateLabel(item: AdoWorkItem, now: Date, slaStatus: WatchStatus | undefined): string {
  if (isMajorIncident(item)) return "Bridge active";
  if (slaStatus === "breached") return "SLA breached";
  if (slaStatus === "at-risk") return getSlaRemainingLabel(item, now, slaStatus);

  const changed = getChangedTime(item);
  if (!Number.isFinite(changed)) return "Recently updated";

  const ageMinutes = Math.max(0, Math.round((now.getTime() - changed) / 60_000));
  if (ageMinutes < 60) return `Updated ${ageMinutes || 1}m ago`;

  const ageHours = Math.round(ageMinutes / 60);
  if (ageHours < 24) return `Updated ${ageHours}h ago`;

  return `Updated ${Math.round(ageHours / 24)}d ago`;
}

function getSlaRemainingLabel(item: AdoWorkItem, now: Date, status: WatchStatus): string {
  const dueTime = getDueTime(item);
  if (!Number.isFinite(dueTime)) return status === "breached" ? "SLA breached" : "SLA at risk";

  const deltaMinutes = Math.max(1, Math.round(Math.abs(dueTime - now.getTime()) / 60_000));
  const suffix = status === "breached" ? "overdue" : "left";
  if (deltaMinutes < 60) return `${deltaMinutes}m ${suffix}`;

  const hours = Math.round(deltaMinutes / 60);
  if (hours < 48) return `${hours}h ${suffix}`;

  return `${Math.round(hours / 24)}d ${suffix}`;
}

function getAssigneeName(value: unknown): string {
  if (!value) return "Unassigned";

  const raw =
    typeof value === "object" && value !== null && "displayName" in value
      ? String((value as { displayName?: unknown }).displayName ?? "")
      : String(value);
  const withoutEmail = raw.replace(/\s*<[^>]+>\s*/g, "").trim();

  if (!withoutEmail || withoutEmail.includes("@")) return "Support Team";
  return withoutEmail;
}

function getCustomerLabel(item: AdoWorkItem, scope: DashboardScope): string {
  if (scope.customerId) return scope.displayName;

  const value = safeText(item.fields[getCustomerField()], "Internal");
  return value.includes("@") ? "Internal" : value;
}

function getSeverity(item: AdoWorkItem, slaStatus: WatchStatus | undefined): Severity {
  if (isMajorIncident(item)) return "critical";
  if (priorityRank(item) === 1) return "critical";
  if (slaStatus === "breached") return "high";
  if (priorityRank(item) === 2 || slaStatus === "at-risk") return "high";
  if (priorityRank(item) === 3) return "medium";
  return "low";
}

function priorityRank(item: AdoWorkItem): number {
  const raw = String(item.fields["Microsoft.VSTS.Common.Priority"] ?? item.fields["Custom.Priority"] ?? "").toLowerCase();
  const severity = String(item.fields["Microsoft.VSTS.Common.Severity"] ?? item.fields["Custom.Severity"] ?? "").toLowerCase();
  const value = `${raw} ${severity}`;

  if (raw === "1" || value.includes("p1") || value.includes("critical")) return 1;
  if (raw === "2" || value.includes("p2") || value.includes("high")) return 2;
  if (raw === "3" || value.includes("p3") || value.includes("medium") || value.includes("normal")) return 3;
  return 4;
}

function isMajorIncident(item: AdoWorkItem): boolean {
  const workItemType = String(item.fields["System.WorkItemType"] ?? "").toLowerCase();
  const state = String(item.fields["System.State"] ?? "").toLowerCase();
  return workItemType.includes("major") || state.includes("major incident");
}

function isBlocked(item: AdoWorkItem): boolean {
  const state = String(item.fields["System.State"] ?? "").toLowerCase();
  const tags = String(item.fields["System.Tags"] ?? "").toLowerCase();
  return blockedPatterns.some((pattern) => state.includes(pattern) || tags.includes(pattern));
}

function isClosedState(value: unknown): boolean {
  const state = String(value ?? "").toLowerCase();
  return closedStates.some((closedState) => state.includes(closedState));
}

function getDueTime(item: AdoWorkItem): number {
  const dueDate = item.fields["Custom.SlaDueDate"] ?? item.fields["Microsoft.VSTS.Scheduling.DueDate"];
  return Date.parse(String(dueDate ?? ""));
}

function getChangedTime(item: AdoWorkItem): number {
  return Date.parse(String(item.fields["System.ChangedDate"] ?? item.fields["System.CreatedDate"] ?? ""));
}

function sortBySeverityThenChanged(left: AdoWorkItem, right: AdoWorkItem): number {
  const severityDelta = priorityRank(left) - priorityRank(right);
  if (severityDelta !== 0) return severityDelta;
  return getChangedTime(right) - getChangedTime(left);
}

function sortBySlaThenChanged(left: AdoWorkItem, right: AdoWorkItem, leftStatus: WatchStatus, rightStatus: WatchStatus): number {
  if (leftStatus !== rightStatus) return leftStatus === "breached" ? -1 : 1;
  return getDueTime(left) - getDueTime(right);
}

function safeText(value: unknown, fallback: string): string {
  const text = String(value ?? "")
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();

  return text || fallback;
}

function accessErrorMessage(access: AllowedUserAccess): string {
  if (access.reason === "missing-allowlist") return "Allowed users are not configured";
  if (access.reason === "not-allowed") return "User is not authorized for this dashboard";
  if (access.reason === "missing-user-details") return "Signed-in user details are not available";
  return "Sign in required";
}

function getMappingSeparatorIndex(value: string): number {
  const equalsIndex = value.indexOf("=");
  if (equalsIndex >= 0) return equalsIndex;
  return value.indexOf(":");
}

function normalizeUserIdentifier(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  return normalized || undefined;
}

function getPrincipalUserIdentifiers(principal: ClientPrincipal | undefined): string[] {
  if (!principal) return [];

  return [
    principal.userDetails,
    getPrincipalClaim(principal, "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"),
    getPrincipalClaim(principal, "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn"),
    getPrincipalClaim(principal, "preferred_username"),
    getPrincipalClaim(principal, "upn")
  ].reduce<string[]>((identifiers, value) => {
    const normalized = normalizeUserIdentifier(value);
    if (normalized && !identifiers.includes(normalized)) identifiers.push(normalized);
    return identifiers;
  }, []);
}

function getPrincipalClaim(principal: ClientPrincipal, claimType: string): string | undefined {
  const claim = principal.claims?.find((claim) => (claim.typ || claim.type) === claimType);
  return claim?.val ?? claim?.value;
}

function toAllowedUser(principal: ClientPrincipal, userDetails: string): AllowedUserAccess["user"] {
  return {
    identityProvider: principal.identityProvider,
    userDetails,
    userId: principal.userId
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function getAdoAuthMode(): AdoAuthMode {
  const mode = (process.env.ADO_AUTH_MODE || "entra").trim().toLowerCase();

  if (mode === "entra" || mode === "aad" || mode === "service-principal") return "entra";
  if (mode === "pat") return "pat";

  throw new Error(`Unsupported ADO_AUTH_MODE "${mode}". Use "entra" or "pat".`);
}

async function getAdoAuthorizationHeader(): Promise<string> {
  if (getAdoAuthMode() === "pat") {
    const auth = Buffer.from(`:${requireEnv("ADO_PAT")}`).toString("base64");
    return `Basic ${auth}`;
  }

  return `Bearer ${await getAdoEntraAccessToken()}`;
}

async function getAdoEntraAccessToken(): Promise<string> {
  const now = Date.now();
  if (entraTokenCache && entraTokenCache.expiresAt - 60_000 > now) {
    return entraTokenCache.accessToken;
  }

  const tenantId = requireEnv("ADO_ENTRA_TENANT_ID");
  const clientId = requireEnv("ADO_ENTRA_CLIENT_ID");
  const clientSecret = requireEnv("ADO_ENTRA_CLIENT_SECRET");
  const scope = process.env.ADO_ENTRA_SCOPE || azureDevOpsEntraScope;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "client_credentials",
    scope
  });

  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  if (!response.ok) {
    throw new AdoRequestError(
      `ADO Entra token request failed: ${response.status}`,
      response.status,
      "entra-token",
      getAdoTokenFailureMessage(response.status)
    );
  }

  const token = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };

  if (!token.access_token) {
    throw new Error("ADO Entra token response did not include an access token");
  }

  entraTokenCache = {
    accessToken: token.access_token,
    expiresAt: now + Math.max(60, token.expires_in ?? 3600) * 1000
  };

  return token.access_token;
}

function getConfiguredWorkItemTypes(): string[] {
  const configured = process.env.ADO_WORK_ITEM_TYPES?.split(",").map((type) => type.trim()).filter(Boolean);
  if (configured?.length) return configured;
  return defaultWorkItemTypes;
}

function getCustomerField(): string {
  return process.env.ADO_CUSTOMER_FIELD || "Custom.Customer";
}

async function getAdoFieldReferenceNames(): Promise<Set<string>> {
  const now = Date.now();
  if (adoFieldCache && adoFieldCache.expiresAt > now) {
    return adoFieldCache.referenceNames;
  }

  const fieldsResponse = (await adoFetch("wit/fields?api-version=7.1")) as {
    value?: Array<{ referenceName?: string }>;
  };
  const referenceNames = new Set(
    (fieldsResponse.value ?? [])
      .map((field) => field.referenceName)
      .filter((field): field is string => Boolean(field))
  );

  adoFieldCache = {
    referenceNames,
    expiresAt: now + 5 * 60 * 1000
  };

  return referenceNames;
}

function getAdoOperation(path: string): string {
  if (path.startsWith("wit/wiql")) return "wiql";
  if (path.startsWith("wit/workitems")) return "work-item-read";
  if (path.startsWith("wit/fields")) return "field-list";
  return "azure-devops";
}

function getAdoFailureMessage(status: number, operation: string): string {
  if (status === 400 && operation === "wiql") {
    return "Azure DevOps rejected the dashboard WIQL query. Check ADO_CUSTOMER_FIELD, ADO_WORK_ITEM_TYPES, and the exact customer value in USER_CUSTOMER_MAP.";
  }

  if (status === 400 && operation === "work-item-read") {
    return "Azure DevOps rejected the work item field read. Check that the configured customer and SLA field names exist in this project.";
  }

  if (status === 401) {
    return "Azure DevOps rejected the Entra access token. Check that the service principal is added to the Azure DevOps organization.";
  }

  if (status === 403) {
    return "Azure DevOps accepted the identity but denied access. Give the service principal project and work item read permissions, and use Basic access if Stakeholder is too limited.";
  }

  if (status === 404) {
    return "Azure DevOps returned 404. Check that ADO_ORG is only the organization name and ADO_PROJECT exactly matches the project name.";
  }

  return `Azure DevOps ${operation} request failed with status ${status}.`;
}

function getAdoTokenFailureMessage(status: number): string {
  if (status === 400 || status === 401) {
    return "Microsoft Entra did not issue an Azure DevOps token. Check ADO_ENTRA_TENANT_ID, ADO_ENTRA_CLIENT_ID, ADO_ENTRA_CLIENT_SECRET, and ADO_ENTRA_SCOPE.";
  }

  return `Microsoft Entra token request failed with status ${status}.`;
}

function getMonthStartIso(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

function uniqueFields(fields: string[]): string[] {
  return [...new Set(fields)];
}

function escapeWiql(value: string): string {
  return value.replace(/'/g, "''");
}

const mockWorkItems: AdoWorkItem[] = [
  {
    id: 501,
    fields: {
      "System.Title": "VPN capacity warning",
      "System.State": "Investigating",
      "System.WorkItemType": "Incident",
      "System.CreatedDate": "2026-05-20T00:00:00.000Z",
      "System.ChangedDate": "2026-05-20T01:00:00.000Z",
      "System.AssignedTo": { displayName: "Platform Support", uniqueName: "platform@example.com" },
      "Microsoft.VSTS.Common.Priority": 3,
      "Microsoft.VSTS.Scheduling.DueDate": "2026-05-21T02:00:00.000Z",
      "Custom.Customer": "FiveTwo Internal"
    }
  },
  {
    id: 502,
    fields: {
      "System.Title": "Laptop build request queue",
      "System.State": "In Progress",
      "System.WorkItemType": "Service Request",
      "System.CreatedDate": "2026-05-18T03:45:00.000Z",
      "System.ChangedDate": "2026-05-20T00:30:00.000Z",
      "System.AssignedTo": { displayName: "Service Desk", uniqueName: "servicedesk@example.com" },
      "Microsoft.VSTS.Common.Priority": 4,
      "Custom.Customer": "FiveTwo Internal"
    }
  },
  {
    id: 503,
    fields: {
      "System.Title": "Printer queue delay",
      "System.State": "Waiting on Customer",
      "System.WorkItemType": "Incident",
      "System.CreatedDate": "2026-05-19T02:15:00.000Z",
      "System.ChangedDate": "2026-05-20T00:10:00.000Z",
      "System.AssignedTo": { displayName: "Facilities", uniqueName: "facilities@example.com" },
      "Microsoft.VSTS.Common.Priority": 4,
      "System.Tags": "blocked",
      "Custom.Customer": "FiveTwo Internal"
    }
  },
  {
    id: 504,
    fields: {
      "System.Title": "Closed starter setup",
      "System.State": "Closed",
      "System.WorkItemType": "Service Request",
      "System.CreatedDate": "2026-05-05T02:15:00.000Z",
      "System.ChangedDate": "2026-05-19T00:10:00.000Z",
      "Microsoft.VSTS.Common.Priority": 4,
      "Custom.Customer": "FiveTwo Internal"
    }
  }
];
