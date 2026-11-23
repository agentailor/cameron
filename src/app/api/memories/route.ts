import { NextResponse } from "next/server";
import * as memoryRepo from "@/lib/repositories/memoryRepository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await memoryRepo.list());
  } catch (error) {
    console.error("Error listing memories:", error);
    return NextResponse.json({ error: "Failed to list memories" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "ID is required" }, { status: 400 });

    const [removed] = await memoryRepo.removeMany([id]);
    if (!removed) return NextResponse.json({ error: "Memory not found" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting memory:", error);
    return NextResponse.json({ error: "Failed to delete memory" }, { status: 500 });
  }
}
