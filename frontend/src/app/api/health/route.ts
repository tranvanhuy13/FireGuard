export const dynamic = "force-dynamic";

// Public liveness only; no user data or credentials are exposed cross-origin.
export function GET() {
  return Response.json({ status: "ready", service: "frontend" }, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    },
  });
}
