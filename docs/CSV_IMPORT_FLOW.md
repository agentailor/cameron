# CSV import

Importing a bank or budgeting-app export is the one bulk write Cameron does, and the only
capability whose failure is **silent**: a wrong date format parses cleanly and books hundreds of
transactions on dates the file never said.

So the flow is built around two rules:

- **The rows never pass through the model in bulk.** The agent sees headers, a sample, specific
  rows it asks for by number, and a summary — never the file.
- **Nothing is refused without identity.** Every row the importer declines is reported by row
  number, so it can be recovered individually. A count alone is unrecoverable.

## The four tools

| Tool                      | Writes? | Approval  | Purpose                                          |
| ------------------------- | ------- | --------- | ------------------------------------------------ |
| `inspect_csv`             | no      | auto      | Headers, a few sample rows, total count          |
| `validate_csv_import`     | no      | auto      | Parse the whole file, report what _would_ happen |
| `read_csv_rows`           | no      | auto      | Read specific rows by number, raw                |
| `import_transactions_csv` | **yes** | **gated** | Write the rows                                   |

All four live in `src/lib/agent/tools/csvImport.ts`; the parsing internals are in
`src/lib/finance/csv.ts`.

## The flow

**inspect → propose → validate → import.**

1. **`inspect_csv`** returns only headers, ~5 sample rows, and the row count. Header strings must be
   copied into the mapping **exactly** — accents and casing included (`Catégorie`, never
   `Category`). A mapping value that is not a real header is rejected and nothing imports.
2. **Propose the mapping to the user**, including any headers left unmapped and the date format read
   from the sample. `05/07/2026` is 5 July or 7 May depending entirely on the declared format, and
   nothing in the file says which — so it is confirmed, never guessed.
3. **`validate_csv_import`** parses the _whole_ file and writes nothing. The sample is 5 rows out of
   possibly thousands; a format that fits them can still fail most of the file.
4. **`import_transactions_csv`** writes, behind the approval gate.

### Validation is mandatory, and is a separate tool

`import_transactions_csv` returns `validation_required` unless `validate_csv_import` has already run
with the same plan. The plan is fingerprinted over
`(fileKey, mapping, account, currency, dateFormat, typeDefault, typeValues)` — so changing _only_
the date format is a new plan and must be validated again. The gate checks state the server
recorded, never an argument the model asserts.

It is a separate tool rather than a `dryRun` flag because **approval is keyed by tool name**:
`interruptOn` (`agent/index.ts`) is built from `MUTATING_TOOL_NAMES`. A flag would force either
approving a step that writes nothing — training the user to click through the amber panel that
guards the real write — or making auto-approval depend on a model-authored boolean, where a mis-set
flag writes hundreds of rows unattended. As a separate tool the property is structural: it simply
is not in `MUTATING_TOOL_NAMES`. `approvalGate.test.ts` pins that validation auto-approves and the
import never does.

Both tools share one parse/classify function, so a validated prediction cannot differ from what the
import actually does.

## Recovering refused rows

**Read the refused rows and log them individually. Never re-import the file.**

Refused rows are reported by number in `badDateRows` (date did not match) and `unparsableRows`
(no parseable amount, or an empty note — each with a `reason`). Row numbers are **1-based over data
rows, header excluded** — one convention, produced by `dataRowNumber()` and read back by
`read_csv_rows`, which echoes each number beside its content so a mismatch is self-evident.

```
import → badDateRows: [{ row: 7, value: "07/09/2026" }]
       → read_csv_rows({ rows: [7] })     // raw row, keyed by header
       → log_expense(...)                  // corrected, one row, gated as usual
```

`read_csv_rows` returns rows **raw**, not mapped: a row is usually being read _because_ mapping it
failed, so showing our interpretation would show our bug instead of the file. It is bounded, and
row numbers outside the file come back in `missing` rather than being silently dropped.

Re-importing to rescue a few rows is the failure mode this design exists to prevent — see
[Duplicates](#duplicates).

### Few refused vs. most refused

The two need opposite responses, and validation's `hint` says which:

- **A few rows refused** — ordinary data messiness. Import the good rows, recover the rest
  individually.
- **Most rows refused** — the mapping or `dateFormat` is wrong. Fix it and validate again; nothing
  has been written, so this costs nothing.

## Dates

Dates are parsed with an agent-supplied `dateFormat` (a date-fns pattern), confirmed with the user.
A row whose value does not match is **reported, never dated `now()`**.

A declared format carrying a time absorbs rows without one: `parseDate` retries once against the
format truncated at its first time token, so a file mixing `06/09/2026 22:41:15` with a bare
`07/09/2026` imports whole. Those rows land at `00:00:00` and are counted in **`datesWithoutTime`** —
midnight is a fallback nobody chose, so it is reported rather than implied.

Truncation can only drop precision, never reinterpret field order: `07/09/2026` is 7 September under
both `dd/MM/yyyy HH:mm:ss` and `dd/MM/yyyy`. The DD/MM-vs-MM/DD ambiguity is still refused outright.

Parsed wall-clock components are reinterpreted as UTC so the stored calendar day matches the file
regardless of server timezone.

## Duplicates

Dedup keys on `(source, external_id)`. **In Postgres `NULL` never equals `NULL`**, so for a file with
no unique-id column the conflict target matches nothing and _nothing is deduplicated_.

The result therefore reports `duplicateDetection: "active" | "unavailable"` plus a warning, rather
than a `skippedDuplicates: 0` that would read as "checked, none found". Never report a check that
did not run.

**Consequence for the agent and the owner:** unless the file has an id column mapped to
`externalId`, importing it twice creates a second copy of every row. This is why row-level recovery
exists — re-running an import to pick up a handful of stragglers duplicates everything that already
landed.

A content-hash surrogate written into `external_id` would make re-imports genuinely idempotent and
is the intended next step; it is not implemented. `NULLS NOT DISTINCT` is **not** an option — it
makes all-NULL rows collide with each other, so a first import would insert one row and silently
drop the rest.

## Currency

Every row lands under one currency code and nothing in the file states it. Before importing, call
`get_config`; if it reports `isSet: false`, ask the user rather than inferring from the file's
language or its merchants. The result echoes `currency` and `currencyWasDefaulted` so a fallback
nobody chose is visible rather than implied.

## Where things live

- `src/lib/finance/csv.ts` — parsing, mapping, `dataRowNumber()`, `readCsvRows()`
- `src/lib/agent/tools/csvImport.ts` — the four tools, the plan fingerprint, the summary shape
- `src/lib/repositories/transactionRepository.ts` — `importWithCategories()`, the atomic bulk insert
- `src/lib/agent/prompt.ts` — the procedure the agent follows
- Tests beside the code; eval cases in `eval/cases/csvImport.cases.mts`
