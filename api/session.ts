import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { getDashboardSession } from "./shared";

app.http("session", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "session",
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const session = getDashboardSession(request.headers);
      return json(session, session.status);
    } catch (error) {
      context.error(error);
      return json({ authenticated: false, allowed: false, scopeConfigured: false, error: "Unable to read dashboard session" }, 500);
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
