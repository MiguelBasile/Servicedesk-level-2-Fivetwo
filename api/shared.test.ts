import { describe, expect, it } from "vitest";
import { getAllowedUserAccess, getDashboardSession, parseUserCustomerMap, toDashboardOverview, type AdoWorkItem } from "./shared";

function principalHeader(userDetails: string) {
  const payload = Buffer.from(
    JSON.stringify({
      identityProvider: "aad",
      userId: "user-1",
      userDetails
    })
  ).toString("base64");

  return new Headers({ "x-ms-client-principal": payload });
}

describe("dashboard auth", () => {
  it("allowlists signed-in Static Web Apps users case-insensitively", () => {
    const access = getAllowedUserAccess(principalHeader("Miguel.Basile@FiveTwo.nz"), {
      ALLOWED_USER_UPNS: "miguel.basile@fivetwo.nz"
    });

    expect(access.allowed).toBe(true);
    expect(access.user?.userDetails).toBe("miguel.basile@fivetwo.nz");
  });

  it("reports a missing allowlist as a configuration error", () => {
    const access = getAllowedUserAccess(principalHeader("miguel.basile@fivetwo.nz"), {});

    expect(access.allowed).toBe(false);
    expect(access.status).toBe(500);
    expect(access.reason).toBe("missing-allowlist");
  });

  it("resolves mapped customer scopes from allowed users", () => {
    const session = getDashboardSession(principalHeader("janicebasile@fivetwo.nz"), {
      ALLOWED_USER_UPNS: "janicebasile@fivetwo.nz",
      USER_CUSTOMER_MAP: "janicebasile@fivetwo.nz=FiveTwo Internal"
    });

    expect(session.allowed).toBe(true);
    expect(session.scopeConfigured).toBe(true);
    expect(session.scope?.displayName).toBe("FiveTwo Internal");
  });

  it("uses a mock dashboard scope during local mock mode", () => {
    const session = getDashboardSession(new Headers(), {
      MOCK_MODE: "true",
      LOCAL_DEV_CUSTOMER_ID: "FiveTwo Internal",
      USER_CUSTOMER_MAP: "miguel.basile@fivetwo.nz=FiveTwo Internal"
    });

    expect(session.allowed).toBe(true);
    expect(session.scopeConfigured).toBe(true);
    expect(session.scope?.mode).toBe("mock");
  });

  it("parses display labels in user customer maps", () => {
    expect(parseUserCustomerMap("a@example.com=customer-id|Customer Name")).toEqual([
      { userDetails: "a@example.com", customerId: "customer-id", displayName: "Customer Name" }
    ]);
  });
});

describe("dashboard overview mapping", () => {
  it("builds metrics without leaking assignee email addresses", () => {
    const now = new Date("2026-05-20T12:00:00.000Z");
    const items: AdoWorkItem[] = [
      {
        id: 100,
        fields: {
          "System.Title": "Core ERP unavailable",
          "System.State": "Investigating",
          "System.WorkItemType": "Major Incident",
          "System.CreatedDate": "2026-05-20T08:00:00.000Z",
          "System.ChangedDate": "2026-05-20T09:00:00.000Z",
          "System.AssignedTo": { displayName: "Miguel Basile <miguel.basile@fivetwo.nz>", uniqueName: "miguel.basile@fivetwo.nz" },
          "Microsoft.VSTS.Common.Priority": 1,
          "Microsoft.VSTS.Scheduling.DueDate": "2026-05-20T10:00:00.000Z",
          "Custom.Customer": "FiveTwo Internal"
        }
      },
      {
        id: 101,
        fields: {
          "System.Title": "Starter request",
          "System.State": "Closed",
          "System.WorkItemType": "Service Request",
          "System.CreatedDate": "2026-05-12T08:00:00.000Z",
          "System.ChangedDate": "2026-05-19T09:00:00.000Z",
          "System.AssignedTo": { displayName: "servicedesk@fivetwo.nz", uniqueName: "servicedesk@fivetwo.nz" },
          "Microsoft.VSTS.Common.Priority": 4,
          "Custom.Customer": "FiveTwo Internal"
        }
      }
    ];

    const overview = toDashboardOverview(items, { customerId: "FiveTwo Internal", displayName: "FiveTwo Internal", mode: "user-map" }, now);

    expect(overview.metrics.majorIncidentsOpen).toBe(1);
    expect(overview.metrics.breachedSla).toBe(1);
    expect(overview.metrics.closedThisMonth).toBe(1);
    expect(overview.incidents[0].assignee).toBe("Miguel Basile");
    expect(JSON.stringify(overview)).not.toContain("miguel.basile@fivetwo.nz");
  });
});
