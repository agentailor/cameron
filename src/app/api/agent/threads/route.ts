import { NextRequest, NextResponse } from "next/server";
import type { Thread } from "@/types/message";
import type { ThreadRecord } from "@/types/mcp";
import * as threadRepo from "@/lib/repositories/threadRepository";
import { deleteThreadCheckpoints } from "@/lib/agent/memory";
import { UpdateThreadBody, DeleteThreadBody, ListThreadsQuery, CreateThreadBody } from "./schema";
import { DEFAULT_THREAD_TITLE } from "@/lib/format/threadTitle";

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

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const parsed = ListThreadsQuery.safeParse({
    limit: url.searchParams.get("limit") ?? undefined,
    cursorUpdatedAt: url.searchParams.get("cursorUpdatedAt") ?? undefined,
    cursorId: url.searchParams.get("cursorId") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid pagination parameters" }, { status: 400 });
  }
  const { limit, cursorUpdatedAt, cursorId } = parsed.data;

  // Both halves of the cursor or neither — a half cursor would silently page from the top.
  if (Boolean(cursorUpdatedAt) !== Boolean(cursorId)) {
    return NextResponse.json(
      { error: "cursorUpdatedAt and cursorId must be provided together" },
      { status: 400 },
    );
  }

  const page = await threadRepo.list({
    limit,
    cursor: cursorUpdatedAt && cursorId ? { updatedAt: cursorUpdatedAt, id: cursorId } : null,
  });

  return NextResponse.json(
    { threads: page.rows.map(toWire), total: page.total, nextCursor: page.nextCursor },
    { status: 200 },
  );
}

export async function POST(req: NextRequest) {
  // Body is optional: a bare POST still creates an untitled thread.
  const raw = await req.json().catch(() => ({}));
  const parsed = CreateThreadBody.safeParse(raw ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid title" }, { status: 400 });
  }
  const created = await threadRepo.create({
    title: parsed.data.title?.trim() || DEFAULT_THREAD_TITLE,
  });
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

    const existing = await threadRepo.getById(id);
    if (!existing) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }

    // Checkpoints before metadata: a failure here leaves the thread visible and retryable.
    await deleteThreadCheckpoints(id);

    const deleted = await threadRepo.remove(id);
    if (!deleted) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Delete failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
