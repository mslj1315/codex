export type ParserCandidateStatus = "ready" | "needs_confirmation";

export interface DateRange {
  rangeStart: string;
  rangeEnd: string;
}

export interface ParseOptions extends DateRange {
  /** Declares the currency unit for amount columns whose headers omit one. */
  currencyUnit?: "yuan" | "cents";
}

export interface ParsedCandidate extends DateRange {
  metricKey: MetricKey;
  metricDisplayName: string;
  value: number;
  unit: "cents" | "count" | "unknown";
  sourceLocator: string;
  confidence: 0 | 80 | 100;
  issueCode?: "unit_missing" | "invalid_value" | "invalid_range" | "negative_value" | "nonpositive_value";
  status: ParserCandidateStatus;
}

export interface ParseResult {
  candidates: ParsedCandidate[];
  unknownHeaders: string[];
}

export type MetricKey =
  | "revenue"
  | "orders"
  | "average_spend"
  | "package_sales"
  | "package_redemptions"
  | "refunds"
  | "promotion_spend";
