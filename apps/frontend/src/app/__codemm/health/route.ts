import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  // Used by Electron main to verify the renderer server it is about to load
  // is the Codemm frontend it started (mitigates localhost port hijacking).
  const token = typeof process.env.CODEMM_FRONTEND_TOKEN === "string" ? process.env.CODEMM_FRONTEND_TOKEN : null;
  return NextResponse.json(
    { ok: true, token },
    {
      headers: {
        "cache-control": "no-store",
      },
    }
  );
}

