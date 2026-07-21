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

export const postgresCheckpointer = createPostgresMemory();
