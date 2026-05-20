# Customer Dashboard Deployment Notes

These are the production lessons from the earlier customer dashboard that were reused for this Service Desk Level 2 dashboard.

## Static Web Apps Shape

- Use Azure Static Web Apps with the Next.js preset.
- Keep the frontend as a static Next export with `output: "export"` and `output_location: out`.
- Keep backend calls in Azure Functions under `api`.
- Use these SWA build settings:
  - App location: `/`
  - API location: `api`
  - Output location: `out`
  - App build command: `npm run build`
  - API build command: `npm run build`

## Runtime Alignment

- Use Node 22 everywhere:
  - root `package.json`
  - `api/package.json`
  - `staticwebapp.config.json`
  - `public/staticwebapp.config.json`
  - GitHub Actions workflow
- SWA config needs `"apiRuntime": "node:22"`.
- The workflow should confirm Node 22 before the Azure SWA deploy action runs.

## ADO Access

- Do not use browser-side ADO calls.
- Do not expose PATs, Entra client secrets, raw ADO fields, internal notes, assignee emails, or customer tokens.
- Use Entra client credentials server-side in Functions:
  - `ADO_AUTH_MODE=entra`
  - `ADO_ENTRA_TENANT_ID`
  - `ADO_ENTRA_CLIENT_ID`
  - `ADO_ENTRA_CLIENT_SECRET`
  - `ADO_ENTRA_SCOPE=https://app.vssps.visualstudio.com/.default`
- The Entra app registration/service principal must be added to Azure DevOps with project/work item read access.

## SWA Entra Auth

- Let Static Web Apps handle the Entra sign-in flow.
- Keep `/.auth/*` anonymous.
- Keep `/api/*` anonymous at the SWA edge because the Functions enforce auth themselves.
- Require the built-in `authenticated` role for the static app routes.
- `/login` redirects to `/.auth/login/aad`.
- `/logout` redirects to `/.auth/logout`.

## App-Managed Authorization

- Use `ALLOWED_USER_UPNS` for dashboard allowlisting.
- If Static Web Apps returns masked `userDetails` such as `mig*****`, put the SWA `userId` shown on the unauthorized screen in `ALLOWED_USER_IDS`.
- Functions parse the SWA-provided `x-ms-client-principal` header.
- Function responses should distinguish:
  - `401`: no signed-in SWA principal
  - `403`: signed in but not allowlisted or not mapped
  - `500`: allowlist or scope configuration missing

## Customer Scope Mapping

- Use `USER_CUSTOMER_MAP` to map signed-in UPNs to ADO customer scopes.
- The left side of `USER_CUSTOMER_MAP` can be a UPN/email or an SWA `userId`.
- The mapped value must exactly match the ADO customer field value.
- For this environment the known value is `FiveTwo Internal`.
- The old pasted customer-token flow should not be used for production.

## Verification Pattern

Before pushing, run:

```powershell
npm run lint
npm test
npm run build
cd api
npm run build
```

The previous customer dashboard passed the same checks plus live SWA login, `/api/session`, ticket loading, detail routes, invalid-ticket state, logout, dashboard tabs, and responsive UI checks.
