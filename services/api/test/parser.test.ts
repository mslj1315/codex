import { describe, expect, it } from "vitest";
import { parseCsv, parseRows, parseXlsx } from "../src/imports/parser.js";
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
});
