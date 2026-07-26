import { BaseMessage } from "@langchain/core/messages";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import * as dotenv from "dotenv";

if (process.env.NODE_ENV !== "test") {
  dotenv.config();
}

/**
 * Creates a PostgresSaver instance using environment variables
 * @returns PostgresSaver instance
 */
export function createPostgresMemory(): PostgresSaver {
  const connectionString = `${process.env.DATABASE_URL}${
    process.env.DB_SSLMODE ? `?sslmode=${process.env.DB_SSLMODE}` : ""
  }`;
  return PostgresSaver.fromConnString(connectionString);
}

/**
 * Retrieves the message history for a specific thread.
 * @param threadId - The ID of the thread to retrieve history for.
 * @returns An array of messages associated with the thread.
 */
export const getHistory = async (threadId: string): Promise<BaseMessage[]> => {
  const history = await postgresCheckpointer.get({
    configurable: { thread_id: threadId },
  });
  return Array.isArray(history?.channel_values?.messages) ? history.channel_values.messages : [];
};

/**
 * Deletes a thread's conversation history (`checkpoints`, `checkpoint_blobs`, `checkpoint_writes`).
 *
 * These tables are owned by the checkpointer, not Drizzle, so deleting a thread must clear them
 * alongside the `thread` row or the messages are orphaned. A no-op when the thread has no history.
 */
export const deleteThreadCheckpoints = async (threadId: string): Promise<void> => {
  await setupCheckpointer();
  await postgresCheckpointer.deleteThread(threadId);
};

export const postgresCheckpointer = createPostgresMemory();

let setupPromise: Promise<void> | null = null;

/**
 * One-time initialization for the Postgres checkpointer — ensures its tables/extensions exist.
 * Idempotent and shared by every entry point that touches checkpoint data (agent creation and
 * thread deletion), so deleting a thread can never hit a missing table on a fresh database.
 */
export async function setupCheckpointer(): Promise<void> {
  if (!setupPromise) {
    setupPromise = postgresCheckpointer.setup().catch((err) => {
      // Reset so a future call can retry if initial setup failed.
      setupPromise = null;
      console.error("Failed to setup postgres checkpointer:", err);
      throw err;
    });
  }
  await setupPromise;
}
