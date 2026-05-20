import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { AuthError, getDashboardOverview, getMockOverview, resolveDashboardScope } from "../shared";

app.http("adoOverview", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "ado/overview",
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const scope = resolveDashboardScope(request.headers);

      if (process.env.MOCK_MODE === "true") {
        return json(getMockOverview(scope));
      }

      return json(await getDashboardOverview(scope));
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

  return json({ error: "Unable to load Azure DevOps overview" }, 500);
}
