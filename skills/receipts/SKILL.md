---
name: receipts
description: Log an expense from an uploaded receipt or invoice. Use when the owner uploads a receipt or invoice with no other request, or asks to log, record or add one. Not for questions about what a document says — answer those from read_document's result.
---

# Receipts

A receipt or invoice uploaded with no other request means "log this". Propose it; don't ask
whether to.

1. **Read it** with read_document. If it returns an error, follow that error's message and stop.
2. **Find what's missing.** Logging needs the total, the date, the currency and the account.
   - `total` or `date` listed in `unreadable` → ask for it. Never work it out from the other lines.
   - The date is printed as written. Read it with the document's own convention (a French or German
     receipt is day-first, a US one month-first); ask only if that doesn't settle it.
   - `currency` is null → ask.
   - Account: CASH if the receipt says it was paid in cash; otherwise ask which account paid. A
     card payment can be CREDIT or CHECKING.

   Ask everything that's missing in ONE message, then go on.

3. **Currency:** call get_config. If the receipt's currency differs from the owner's, say so in
   your proposal and log it in the receipt's currency — don't convert.
4. **Duplicates:** query_transactions for the same amount within 3 days of the date. A match (often
   from a bank import) → ask whether it's the same purchase; if it is, don't log it.
5. **Category:** list_categories, and reuse an existing name.
6. **Log** with log_from_document: the total actually paid (including tax and tip), the date as an
   ISO date, the merchant as printed, a short note. The owner approves on a card that shows the
   document beside your values.
7. `already_logged` → tell the owner it's already in as that transaction, and offer
   update_transaction if something on it is wrong.
