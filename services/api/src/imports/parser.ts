import ExcelJS from "exceljs";
import type { MetricKey, ParseOptions, ParseResult, ParsedCandidate } from "./models.js";

type Row = Record<string, unknown>;
type Unit = ParsedCandidate["unit"];
type CurrencyUnit = "yuan" | "cents";

export const MAX_XLSX_BYTES = 5 * 1024 * 1024;
export const MAX_XLSX_ROWS = 10_000;
export const MAX_XLSX_COLUMNS = 64;

export class ParserInputError extends Error {
  constructor(readonly code: "xlsx_too_large" | "xlsx_row_limit" | "xlsx_column_limit") {
    super(code);
    this.name = "ParserInputError";
  }
}

interface MetricDefinition {
  key: MetricKey;
  displayName: string;
  standard: readonly string[];
  aliases: readonly string[];
  kind: "amount" | "count";
  nonpositiveRejected: boolean;
}

const METRICS: readonly MetricDefinition[] = [
  { key: "revenue", displayName: "Revenue", standard: ["营业额（元）", "营业额(元)", "营业额（人民币）", "营业额(人民币)", "营业额（分）", "营业额(分)"], aliases: ["营业额", "营业收入", "销售额", "收入"], kind: "amount", nonpositiveRejected: false },
  { key: "orders", displayName: "Orders", standard: ["订单数"], aliases: ["订单量", "订单数量"], kind: "count", nonpositiveRejected: true },
  { key: "average_spend", displayName: "Average spend", standard: ["客单价（元）", "客单价(元)"], aliases: ["客单价"], kind: "amount", nonpositiveRejected: true },
  { key: "package_sales", displayName: "Package sales", standard: ["套餐销售额（元）", "套餐销售额(元)"], aliases: ["套餐销售额", "套餐销售"], kind: "amount", nonpositiveRejected: true },
  { key: "package_redemptions", displayName: "Package redemptions", standard: ["套餐核销数"], aliases: ["套餐核销", "核销数"], kind: "count", nonpositiveRejected: true },
  { key: "refunds", displayName: "Refunds", standard: ["退款金额（元）", "退款金额(元)"], aliases: ["退款金额", "退款额", "退款"], kind: "amount", nonpositiveRejected: false },
  { key: "promotion_spend", displayName: "Promotion spend", standard: ["推广费用（元）", "推广费用(元)", "促销费用（元）", "促销费用(元)"], aliases: ["推广费用", "推广费", "促销费用"], kind: "amount", nonpositiveRejected: false }
];

export function parseRows(rows: readonly Row[], options: ParseOptions): ParseResult {
  const candidates: ParsedCandidate[] = [];
  const unknownHeaders: string[] = [];
  const seenUnknownHeaders = new Set<string>();

  rows.forEach((row, rowIndex) => {
    const recognized = Object.entries(row).flatMap(([header, rawValue]) => {
      const match = findMetric(header);
      if (!match) {
        if (!seenUnknownHeaders.has(header)) {
          seenUnknownHeaders.add(header);
          unknownHeaders.push(header);
        }
        return [];
      }
      return [{ header, rawValue, match }];
    });
    const duplicateMetrics = new Set(recognized.map(({ match }) => match.definition.key).filter((key, index, keys) => keys.indexOf(key) !== index));
    for (const { header, rawValue, match } of recognized) {
      const candidate = parseCell(match.definition, match.isStandard, header, rawValue, rowIndex + 1, options);
      candidates.push(duplicateMetrics.has(candidate.metricKey)
        ? { ...candidate, confidence: 0, issueCode: "duplicate_header", status: "needs_confirmation" }
        : candidate);
    }
  });

  return { candidates, unknownHeaders };
}

export function parseCsv(input: string, options: ParseOptions): ParseResult {
  const [headerRow = [], ...valueRows] = parseCsvRecords(input);
  const headers = headerRow.map((header) => header.replace(/^\uFEFF/, ""));
  const result = parseRows(valueRows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]))), options);
  return { ...result, unknownHeaders: mergeUnknownHeaders(result.unknownHeaders, headers.filter((header) => !findMetric(header))) };
}

export async function parseXlsx(input: ArrayBuffer | Uint8Array, options: ParseOptions): Promise<ParseResult> {
  if (input.byteLength > MAX_XLSX_BYTES) throw new ParserInputError("xlsx_too_large");
  const workbook = new ExcelJS.Workbook();
  const workbookBytes = new Uint8Array(input.byteLength);
  workbookBytes.set(input instanceof Uint8Array ? input : new Uint8Array(input));
  await workbook.xlsx.load(workbookBytes.buffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return parseRows([], options);
  if (worksheet.rowCount - 1 > MAX_XLSX_ROWS) throw new ParserInputError("xlsx_row_limit");
  if (worksheet.columnCount > MAX_XLSX_COLUMNS) throw new ParserInputError("xlsx_column_limit");

  const headers = new Map<number, string>();
  worksheet.getRow(1).eachCell({ includeEmpty: false }, (cell, columnNumber) => {
    headers.set(columnNumber, cell.text);
  });
  const rows: Row[] = [];
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    rows.push(Object.fromEntries([...headers].map(([columnNumber, header]) => [header, cachedScalarValue(row.getCell(columnNumber).value)])));
  });
  return parseRows(rows, options);
}

function findMetric(header: string): { definition: MetricDefinition; isStandard: boolean } | undefined {
  const normalizedHeader = normalizeHeader(header);
  for (const definition of METRICS) {
    if (definition.standard.some((name) => normalizeHeader(name) === normalizedHeader)) return { definition, isStandard: true };
    if (definition.aliases.some((name) => normalizeHeader(name) === normalizedHeader)) return { definition, isStandard: false };
  }
  return undefined;
}

function parseCell(definition: MetricDefinition, isStandard: boolean, header: string, rawValue: unknown, rowNumber: number, options: ParseOptions): ParsedCandidate {
  const range = { rangeStart: options.rangeStart, rangeEnd: options.rangeEnd };
  const sourceLocator = `row:${rowNumber}:${header}`;
  const rawNumber = toFiniteNumber(rawValue);
  const explicitUnit = definition.kind === "amount" ? unitFromHeader(header) : undefined;
  const explicitYuan = explicitUnit === "yuan";
  const contextualUnit = definition.kind === "amount" ? options.currencyUnit : undefined;
  const unit: Unit = definition.kind === "count" ? "count" : explicitUnit || contextualUnit ? "cents" : "unknown";
  const parsedValue = toStoredValue(rawValue, definition.kind, explicitUnit ?? contextualUnit);
  const value = parsedValue ?? 0;
  const base = { metricKey: definition.key, metricDisplayName: definition.displayName, value, unit, sourceLocator, ...range };

  if (!isValidRange(range.rangeStart, range.rangeEnd)) return { ...base, confidence: 0, issueCode: "invalid_range", status: "needs_confirmation" };
  if (rawNumber == null || parsedValue == null) return { ...base, confidence: 0, issueCode: "invalid_value", status: "needs_confirmation" };
  if (rawNumber < 0) return { ...base, confidence: 0, issueCode: "negative_value", status: "needs_confirmation" };
  if (definition.nonpositiveRejected && rawNumber <= 0) return { ...base, confidence: 0, issueCode: "nonpositive_value", status: "needs_confirmation" };
  if (definition.kind === "amount" && !explicitUnit && !contextualUnit) return { ...base, confidence: 0, issueCode: "unit_missing", status: "needs_confirmation" };

  return { ...base, confidence: isStandard && (definition.kind === "count" || explicitUnit) ? 100 : 80, status: "ready" };
}

function normalizeHeader(header: string): string {
  return header.trim().replace(/\s+/g, "").replace(/[（]/g, "(").replace(/[）]/g, ")").toLowerCase();
}

function unitFromHeader(header: string): CurrencyUnit | undefined {
  if (/[（(]\s*(元|人民币)\s*[）)]/.test(header)) return "yuan";
  if (/[（(]\s*分\s*[）)]/.test(header)) return "cents";
  return undefined;
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const parsed = Number(value.replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toStoredValue(value: unknown, kind: MetricDefinition["kind"], currencyUnit: CurrencyUnit | undefined): number | undefined {
  const text = numericText(value);
  if (!text) return undefined;
  if (kind === "count" || currencyUnit === "cents" || !currencyUnit) {
    const parsed = Number(text);
    return Number.isSafeInteger(parsed) ? parsed : undefined;
  }
  const match = /^([+-]?)(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return undefined;
  const cents = BigInt(match[2]) * 100n + BigInt((match[3] ?? "").padEnd(2, "0"));
  const signedCents = match[1] === "-" ? -cents : cents;
  const parsed = Number(signedCents);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function isValidRange(rangeStart: string, rangeEnd: string): boolean {
  const start = utcDate(rangeStart);
  const end = utcDate(rangeEnd);
  return start != null && end != null && start <= end;
}

function utcDate(value: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? timestamp : undefined;
}

function numericText(value: unknown): string | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : undefined;
  if (typeof value !== "string") return undefined;
  const text = value.replace(/,/g, "").trim();
  return /^[-+]?\d+(?:\.\d+)?$/.test(text) ? text : undefined;
}

function cachedScalarValue(value: unknown): unknown {
  if (typeof value !== "object" || value === null || !("formula" in value)) return value ?? "";
  const result = (value as { result?: unknown }).result;
  return typeof result === "number" || typeof result === "string" ? result : "";
}

function mergeUnknownHeaders(current: string[], headers: string[]): string[] {
  return [...new Set([...current, ...headers])];
}

function parseCsvRecords(input: string): string[][] {
  const records: string[][] = [[]];
  let field = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character === '"') {
      if (quoted && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      records.at(-1)?.push(field);
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      records.at(-1)?.push(field);
      records.push([]);
      field = "";
    } else {
      field += character;
    }
  }
  records.at(-1)?.push(field);
  return records.filter((record) => record.some((value) => value !== ""));
}
