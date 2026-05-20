# Service Desk Level 2 Dashboard

Customer-scoped Azure DevOps service health dashboard for Azure Static Web Apps.

## Azure Static Web Apps Build Settings

- Build preset: `Next.js`
- App location: `/`
- API location: `api`
- Output location: `out`
- App build command: `npm run build`
- API build command: `npm run build`

The frontend is a static Next.js export (`output: "export"`). Azure DevOps calls are made only from Azure Functions under `/api`.

## Required App Settings

```text
ADO_AUTH_MODE=entra
ADO_ORG=...
ADO_PROJECT=...
ADO_ENTRA_TENANT_ID=...
ADO_ENTRA_CLIENT_ID=...
ADO_ENTRA_CLIENT_SECRET=...
ADO_ENTRA_SCOPE=https://app.vssps.visualstudio.com/.default
ADO_CUSTOMER_FIELD=Custom.Customer
ADO_WORK_ITEM_TYPES=Incident,Major Incident,Service Request,Operational Task,Task,User Story,Feature,Epic,Bug,Issue
ALLOWED_USER_UPNS=miguel.basile@fivetwo.nz,janicebasile@fivetwo.nz
ALLOWED_USER_IDS=
ALLOWED_USER_ROLES=
USER_CUSTOMER_MAP=miguel.basile@fivetwo.nz=FiveTwo Internal,janicebasile@fivetwo.nz=FiveTwo Internal
CUSTOMER_ROLE_MAP=fivetwo-internal=FiveTwo Internal
MOCK_MODE=false
```

`USER_CUSTOMER_MAP` values must exactly match the Azure DevOps customer field configured by `ADO_CUSTOMER_FIELD`.

If Static Web Apps returns a masked value such as `mig*****` after login, add the displayed SWA user ID to `ALLOWED_USER_IDS` and use the same ID as the key in `USER_CUSTOMER_MAP`. SWA user IDs are stable per Static Web App resource.

Preferred for production: invite users to a Static Web Apps custom role such as `fivetwo-internal`, then set `CUSTOMER_ROLE_MAP=fivetwo-internal=FiveTwo Internal`. Role mapping does not depend on `userDetails`, so it works even when SWA returns a masked provider handle.

For an internal-only aggregate dashboard, set `INTERNAL_DASHBOARD=true`. Leave it unset for customer-facing deployments so every user must resolve to a customer scope.

## Local Commands

```powershell
npm install
cd api; npm install; cd ..
npm run lint
npm test
npm run build
cd api; npm run build
```

## Authentication Model

- Static Web Apps built-in Entra authentication protects the frontend.
- `/.auth/*` and `/api/*` are anonymous at the SWA edge.
- Azure Functions parse `x-ms-client-principal` and enforce `ALLOWED_USER_UPNS` / `ALLOWED_USER_IDS`.
- `CUSTOMER_ROLE_MAP` maps Static Web Apps roles directly to customer scopes and also allowlists users in those roles.
- `ALLOWED_USER_IDS` may contain SWA user IDs when the provider returns masked user details.
- Customer scope is resolved from `USER_CUSTOMER_MAP`; the map key may also be an email/UPN or SWA user ID.
- ADO tokens, client secrets, raw work item fields, assignee emails, and internal notes are never sent to the browser.
