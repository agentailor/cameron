import { NextRequest, NextResponse } from "next/server";
import type { Thread } from "@/types/message";
import type { ThreadRecord } from "@/types/mcp";
import * as threadRepo from "@/lib/repositories/threadRepository";
import { UpdateThreadBody, DeleteThreadBody } from "./schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function toWire(t: ThreadRecord): Thread {
  return {
    id: t.id,
    title: t.title,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

export async function GET() {
  const threads = (await threadRepo.list()).map(toWire);
  return NextResponse.json(threads, { status: 200 });
}

export async function POST() {
  const created = await threadRepo.create({ title: "New thread" });
  return NextResponse.json(toWire(created), { status: 201 });
}

export async function PATCH(req: NextRequest) {
  try {
    const parsed = UpdateThreadBody.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "id and title required" }, { status: 400 });
    }
    const { id, title } = parsed.data;
    const updated = await threadRepo.rename(id, title);
    if (!updated) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }
    return NextResponse.json(toWire(updated), { status: 200 });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Update failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const parsed = DeleteThreadBody.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Thread id required" }, { status: 400 });
    }
    const { id } = parsed.data;

    // Delete the thread metadata (returns false if it did not exist).
    const deleted = await threadRepo.remove(id);
    if (!deleted) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }

    // Note: LangGraph checkpoint data will become orphaned but won't affect functionality
    // The checkpointer will simply not find any thread metadata for this thread_id
    // Future versions could implement direct checkpoint deletion via SQL if needed

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Delete failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
