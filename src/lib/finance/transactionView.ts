import type { TransactionView } from "@/types/finance";
import type { TransactionSnapshot } from "@/lib/repositories/transactionTypes";

/** The fields a {@link TransactionView} carries, in display order. */
export const TRANSACTION_VIEW_FIELDS = [
  "amount",
  "currency",
  "type",
  "note",
  "occurredAt",
  "account",
  "category",
  "merchant",
  "description",
] as const satisfies readonly (keyof TransactionView)[];

export function toTransactionView(t: TransactionSnapshot): TransactionView {
  return {
    id: t.id,
    occurredAt: t.occurredAt.toISOString(),
    amount: t.amount,
    type: t.type,
    note: t.note,
    currency: t.currency,
    account: t.account,
    category: t.categoryName,
    merchant: t.merchant,
    description: t.description,
    source: t.source,
  };
}
