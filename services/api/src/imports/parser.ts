import ExcelJS from "exceljs";
import type { MetricKey, ParseOptions, ParseResult, ParsedCandidate } from "./models.js";

type Row = Record<string, unknown>;
type Unit = ParsedCandidate["unit"];

interface MetricDefinition {
  key: MetricKey;
  displayName: string;
  standard: readonly string[];
  aliases: readonly string[];
  kind: "amount" | "count";
  nonpositiveRejected: boolean;
}

const METRICS: readonly MetricDefinition[] = [
  { key: "revenue", displayName: "Revenue", standard: ["营业额（元）", "营业额(元)", "营业额（人民币）", "营业额(人民币)"], aliases: ["营业额", "营业收入", "销售额", "收入"], kind: "amount", nonpositiveRejected: false },
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
    for (const [header, rawValue] of Object.entries(row)) {
      const match = findMetric(header);
      if (!match) {
        if (!seenUnknownHeaders.has(header)) {
          seenUnknownHeaders.add(header);
          unknownHeaders.push(header);
        }
        continue;
      }
      candidates.push(parseCell(match.definition, match.isStandard, header, rawValue, rowIndex + 1, options));
    }
  });

  return { candidates, unknownHeaders };
}

export function parseCsv(input: string, options: ParseOptions): ParseResult {
  const [headerRow = [], ...valueRows] = parseCsvRecords(input);
  const headers = headerRow.map((header) => header.replace(/^\uFEFF/, ""));
  return parseRows(valueRows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]))), options);
}

export async function parseXlsx(input: ArrayBuffer | Uint8Array, options: ParseOptions): Promise<ParseResult> {
  const workbook = new ExcelJS.Workbook();
  const workbookBytes = (input instanceof Uint8Array ? input.buffer : input) as ArrayBuffer;
  await workbook.xlsx.load(workbookBytes);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return parseRows([], options);

  const headers = new Map<number, string>();
  worksheet.getRow(1).eachCell({ includeEmpty: false }, (cell, columnNumber) => {
    headers.set(columnNumber, cell.text);
  });
  const rows: Row[] = [];
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    rows.push(Object.fromEntries([...headers].map(([columnNumber, header]) => [header, row.getCell(columnNumber).value ?? ""])));
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
  const explicitYuan = definition.kind === "amount" && hasYuanUnit(header);
  const contextualUnit = definition.kind === "amount" ? options.currencyUnit : undefined;
  const unit: Unit = definition.kind === "count" ? "count" : explicitYuan || contextualUnit ? "cents" : "unknown";
  const parsedValue = rawNumber == null ? undefined : toStoredValue(rawNumber, explicitYuan ? "yuan" : contextualUnit);
  const value = parsedValue ?? 0;
  const base = { metricKey: definition.key, metricDisplayName: definition.displayName, value, unit, sourceLocator, ...range };

  if (!isValidRange(range.rangeStart, range.rangeEnd)) return { ...base, confidence: 0, issueCode: "invalid_range", status: "needs_confirmation" };
  if (rawNumber == null || parsedValue == null) return { ...base, confidence: 0, issueCode: "invalid_value", status: "needs_confirmation" };
  if (rawNumber < 0) return { ...base, confidence: 0, issueCode: "negative_value", status: "needs_confirmation" };
  if (definition.nonpositiveRejected && rawNumber <= 0) return { ...base, confidence: 0, issueCode: "nonpositive_value", status: "needs_confirmation" };
  if (definition.kind === "amount" && !explicitYuan && !contextualUnit) return { ...base, confidence: 0, issueCode: "unit_missing", status: "needs_confirmation" };

  return { ...base, confidence: isStandard && (definition.kind === "count" || explicitYuan) ? 100 : 80, status: "ready" };
}

function normalizeHeader(header: string): string {
  return header.trim().replace(/\s+/g, "").replace(/[（]/g, "(").replace(/[）]/g, ")").toLowerCase();
}

function hasYuanUnit(header: string): boolean {
  return /[（(]\s*(元|人民币)\s*[）)]/.test(header);
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const parsed = Number(value.replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toStoredValue(value: number, currencyUnit: "yuan" | "cents" | undefined): number | undefined {
  const stored = currencyUnit === "yuan" ? value * 100 : value;
  return Number.isSafeInteger(stored) ? stored : undefined;
}

function isValidRange(rangeStart: string, rangeEnd: string): boolean {
  const isoDate = /^\d{4}-\d{2}-\d{2}$/;
  return isoDate.test(rangeStart) && isoDate.test(rangeEnd) && rangeStart <= rangeEnd;
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
