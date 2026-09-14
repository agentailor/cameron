import { NextRequest, NextResponse } from "next/server";
import { PROVIDERS } from "@/lib/config/modelSettings";
import {
  ModelSettingsError,
  readModelSettings,
  writeModelSettings,
} from "@/lib/agent/modelSettings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Public response: never expose API keys or their values, only which variable each provider reads.
export async function GET() {
  const settings = await readModelSettings();
  return NextResponse.json({
    configured: settings !== null,
    provider: settings?.provider ?? null,
    model: settings?.model ?? null,
    baseUrl: settings?.baseUrl ?? null,
    providers: PROVIDERS,
  });
}

export async function PUT(req: NextRequest) {
  let body: { provider?: string; model?: string; baseUrl?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const saved = await writeModelSettings({
      provider: body.provider ?? "",
      model: body.model ?? "",
      baseUrl: body.baseUrl ?? null,
    });
    return NextResponse.json({ configured: true, ...saved });
  } catch (error) {
    if (error instanceof ModelSettingsError) {
      return NextResponse.json({ error: error.message, field: error.field }, { status: 400 });
    }
    throw error;
  }
}
