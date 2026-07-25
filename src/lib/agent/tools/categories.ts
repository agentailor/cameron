import { tool } from "@langchain/core/tools";
import { z } from "zod";
import * as categoryRepo from "@/lib/repositories/categoryRepository";
import { ConflictError } from "@/lib/database/errors";

/**
 * Category tools for interactive flows (manual logging, ad-hoc management). `create_category` is
 * gated (in MUTATING_TOOL_NAMES). These are NOT used by CSV import — imports resolve categories
 * server-side from the mapped column (see transactionRepository.importWithCategories); the agent
 * never sees the file's category values.
 */

export const listCategories = tool(
  async () => {
    const categories = await categoryRepo.list();
    return JSON.stringify({
      count: categories.length,
      categories: categories.map((c) => ({ id: c.id, name: c.name })),
    });
  },
  {
    name: "list_categories",
    description:
      "List the user's existing transaction categories (id + name). Read-only. Use this before " +
      "categorizing or importing so you reuse an existing category name instead of creating a " +
      "near-duplicate.",
    schema: z.object({}),
  },
);

export const createCategory = tool(
  async (input) => {
    try {
      const created = await categoryRepo.create({
        name: input.name.trim(),
        icon: input.icon ?? null,
        color: input.color ?? null,
      });
      return JSON.stringify({ ok: true, id: created.id, name: created.name });
    } catch (err) {
      if (err instanceof ConflictError) {
        const existing = await categoryRepo.getByName(input.name.trim());
        return JSON.stringify({
          ok: false,
          reason: "already_exists",
          message: `A category named "${input.name.trim()}" already exists.`,
          id: existing?.id ?? null,
        });
      }
      throw err;
    }
  },
  {
    name: "create_category",
    description:
      "Create a new transaction category. Names are unique — if it already exists you'll get an " +
      "'already_exists' result with the existing id (not an error). This mutates the store and " +
      "requires the user's approval. Check `list_categories` first to avoid duplicates.",
    schema: z.object({
      name: z.string().min(1).describe("The category name, e.g. 'Groceries'"),
      icon: z.string().optional().describe("Optional icon hint for later reports/charts"),
      color: z
        .string()
        .optional()
        .describe("Optional color hint (e.g. hex) for later reports/charts"),
    }),
  },
);

/** Category tools, registered into the agent in agent/index.ts. create_category is gated. */
export const categoryTools = [listCategories, createCategory];
