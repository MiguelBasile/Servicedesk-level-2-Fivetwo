import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { AuthError, getAdoConnectionStatus, resolveDashboardScope } from "../shared";

app.http("adoStatus", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "ado/status",
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      resolveDashboardScope(request.headers);

      if (process.env.MOCK_MODE === "true") {
        return json({
          connected: false,
          mode: "mock",
          message:
            "Mock mode is enabled. Set MOCK_MODE=false and configure ADO_ORG, ADO_PROJECT, and ADO Entra app settings for live ADO."
        });
      }

      return json(await getAdoConnectionStatus());
    } catch (error) {
      context.error(error);
      return errorResponse(error);
    }
  }
});

function json(body: unknown, status = 200): HttpResponseInit {
  return {
    status,
    jsonBody: body,
    headers: {
      "Cache-Control": "no-store"
    }
  };
}

function errorResponse(error: unknown): HttpResponseInit {
  if (error instanceof AuthError) {
    return json({ error: error.message }, error.status);
  }

  return json({ connected: false, error: "Unable to connect to Azure DevOps" }, 500);
}
