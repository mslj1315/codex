import { describe, expect, it } from "vitest";
import { MAX_XLSX_BYTES, ParserInputError, parseCsv, parseRows, parseXlsx } from "../src/imports/parser.js";
import ExcelJS from "exceljs";

const validRange = { rangeStart: "2026-08-01", rangeEnd: "2026-08-07" };

describe("import parser", () => {
  it("maps standard headers with explicit units into ready candidates", () => {
    const result = parseRows([{ "营业额（元）": "48260", "订单数": "1284" }], validRange);

    expect(result.candidates).toEqual([
      expect.objectContaining({
        metricKey: "revenue",
        value: 4_826_000,
        unit: "cents",
        confidence: 100,
        status: "ready",
        rangeStart: "2026-08-01",
        rangeEnd: "2026-08-07"
      }),
      expect.objectContaining({
        metricKey: "orders",
        value: 1284,
        unit: "count",
        confidence: 100,
        status: "ready"
      })
    ]);
  });

  it("preserves explicit cents without converting them", () => {
    const result = parseRows([{ "营业额（分）": "123" }], validRange);

    expect(result.candidates).toEqual([
      expect.objectContaining({ metricKey: "revenue", value: 123, unit: "cents", confidence: 100, status: "ready" })
    ]);
  });

  it("converts yuan decimals to cents without floating point rounding", () => {
    const result = parseRows([{ "营业额（元）": "0.29" }], validRange);

    expect(result.candidates).toEqual([
      expect.objectContaining({ metricKey: "revenue", value: 29, unit: "cents", confidence: 100, status: "ready" })
    ]);
  });

  it("requires confirmation when an amount header omits its unit", () => {
    const result = parseRows([{ "客单价": "38" }], validRange);

    expect(result.candidates).toEqual([
      expect.objectContaining({
        metricKey: "average_spend",
        value: 38,
        status: "needs_confirmation",
        confidence: 0,
        issueCode: "unit_missing"
      })
    ]);
  });

  it("maps an alias with contextual units at lower confidence", () => {
    const result = parseRows([{ "营业收入": "48260", "订单量": "1284" }], {
      ...validRange,
      currencyUnit: "yuan"
    });

    expect(result.candidates).toEqual([
      expect.objectContaining({ metricKey: "revenue", value: 4_826_000, unit: "cents", confidence: 80, status: "ready" }),
      expect.objectContaining({ metricKey: "orders", value: 1284, unit: "count", confidence: 80, status: "ready" })
    ]);
  });

  it("rejects disallowed negative amounts and counts", () => {
    const result = parseRows([{ "营业额（元）": "-1", "订单数": "-2" }], validRange);

    expect(result.candidates).toEqual([
      expect.objectContaining({ metricKey: "revenue", status: "needs_confirmation", confidence: 0, issueCode: "negative_value" }),
      expect.objectContaining({ metricKey: "orders", status: "needs_confirmation", confidence: 0, issueCode: "negative_value" })
    ]);
  });

  it("rejects an invalid date range", () => {
    const result = parseRows([{ "订单数": "1284" }], {
      rangeStart: "2026-08-08",
      rangeEnd: "2026-08-07"
    });

    expect(result.candidates).toEqual([
      expect.objectContaining({ metricKey: "orders", status: "needs_confirmation", confidence: 0, issueCode: "invalid_range" })
    ]);
  });

  it("rejects calendar dates that do not exist", () => {
    const result = parseRows([{ "订单数": "1284" }], {
      rangeStart: "2026-02-30",
      rangeEnd: "2026-03-01"
    });

    expect(result.candidates).toEqual([
      expect.objectContaining({ metricKey: "orders", status: "needs_confirmation", confidence: 0, issueCode: "invalid_range" })
    ]);
  });

  it("preserves unknown headers outside candidates", () => {
    const result = parseRows([{ "订单数": "1284", "天气": "晴" }], validRange);

    expect(result.candidates).toHaveLength(1);
    expect(result.unknownHeaders).toEqual(["天气"]);
  });

  it("parses CSV rows deterministically", () => {
    const result = parseCsv("订单数,营业额（元）\n1284,48260\n", validRange);

    expect(result.candidates).toEqual([
      expect.objectContaining({ metricKey: "orders", value: 1284 }),
      expect.objectContaining({ metricKey: "revenue", value: 4_826_000 })
    ]);
  });

  it("preserves CSV headers even when there are no data rows", () => {
    const result = parseCsv("天气\n", validRange);

    expect(result.candidates).toEqual([]);
    expect(result.unknownHeaders).toEqual(["天气"]);
  });

  it("maps each remaining metric and rejects malformed or nonfinite values", () => {
    const result = parseRows([{
      "客单价（元）": "38",
      "套餐销售额（元）": "100",
      "套餐核销数": "5",
      "退款金额（元）": "3.50",
      "推广费用（元）": "4",
      "订单数": "0",
      "营业额（元）": "Infinity"
    }], validRange);

    expect(result.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ metricKey: "average_spend", value: 3800, status: "ready", confidence: 100 }),
      expect.objectContaining({ metricKey: "package_sales", value: 10000, status: "ready", confidence: 100 }),
      expect.objectContaining({ metricKey: "package_redemptions", value: 5, status: "ready", confidence: 100 }),
      expect.objectContaining({ metricKey: "refunds", value: 350, status: "ready", confidence: 100 }),
      expect.objectContaining({ metricKey: "promotion_spend", value: 400, status: "ready", confidence: 100 }),
      expect.objectContaining({ metricKey: "orders", status: "needs_confirmation", issueCode: "nonpositive_value" }),
      expect.objectContaining({ metricKey: "revenue", status: "needs_confirmation", issueCode: "invalid_value" })
    ]));
  });

  it("rejects malformed numeric values", () => {
    const result = parseRows([{ "套餐销售额（元）": "not-a-number" }], validRange);

    expect(result.candidates).toEqual([
      expect.objectContaining({ metricKey: "package_sales", status: "needs_confirmation", issueCode: "invalid_value" })
    ]);
  });

  it("rejects fractional count values", () => {
    const result = parseRows([{ "订单数": "1.5" }], validRange);

    expect(result.candidates).toEqual([
      expect.objectContaining({ metricKey: "orders", status: "needs_confirmation", issueCode: "invalid_value" })
    ]);
  });

  it("marks duplicate recognized headers for a metric as requiring confirmation", () => {
    const result = parseRows([{ "订单数": "10", "订单量": "11" }], validRange);

    expect(result.candidates).toEqual([
      expect.objectContaining({ metricKey: "orders", status: "needs_confirmation", confidence: 0, issueCode: "duplicate_header" }),
      expect.objectContaining({ metricKey: "orders", status: "needs_confirmation", confidence: 0, issueCode: "duplicate_header" })
    ]);
  });

  it("uses cached scalar formula results without evaluating formulas", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("first");
    sheet.addRow(["订单数"]);
    sheet.addRow([{ formula: "1+1", result: 2 }]);
    sheet.addRow([{ formula: "1+1" }]);

    const result = await parseXlsx(await workbook.xlsx.writeBuffer(), validRange);

    expect(result.candidates).toEqual([
      expect.objectContaining({ metricKey: "orders", value: 2, status: "ready" }),
      expect.objectContaining({ metricKey: "orders", status: "needs_confirmation", issueCode: "invalid_value" })
    ]);
  });

  it("rejects XLSX input larger than the parser byte limit before loading", async () => {
    await expect(parseXlsx(new Uint8Array(MAX_XLSX_BYTES + 1), validRange)).rejects.toMatchObject({
      code: "xlsx_too_large"
    } satisfies Partial<ParserInputError>);
  });

  it("rejects a first worksheet with more than the configured row limit", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("first");
    sheet.addRow(["订单数"]);
    for (let row = 0; row <= 10_000; row += 1) sheet.addRow([row + 1]);

    await expect(parseXlsx(await workbook.xlsx.writeBuffer(), validRange)).rejects.toMatchObject({
      code: "xlsx_row_limit"
    } satisfies Partial<ParserInputError>);
  });

  it("parses only the first XLSX sheet", async () => {
    const workbook = new ExcelJS.Workbook();
    const firstSheet = workbook.addWorksheet("first");
    firstSheet.addRow(["订单数"]);
    firstSheet.addRow([1284]);
    const secondSheet = workbook.addWorksheet("second");
    secondSheet.addRow(["营业额（元）"]);
    secondSheet.addRow([48260]);

    const result = await parseXlsx(await workbook.xlsx.writeBuffer(), validRange);

    expect(result.candidates).toEqual([expect.objectContaining({ metricKey: "orders", value: 1284 })]);
  });

  it("preserves the byte offset and length of sliced XLSX input", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("first");
    sheet.addRow(["订单数"]);
    sheet.addRow([1284]);
    const source = new Uint8Array(await workbook.xlsx.writeBuffer());
    const padded = new Uint8Array(source.length + 10);
    padded.set(source, 5);

    const result = await parseXlsx(padded.subarray(5, 5 + source.length), validRange);

    expect(result.candidates).toEqual([expect.objectContaining({ metricKey: "orders", value: 1284 })]);
  });
});
