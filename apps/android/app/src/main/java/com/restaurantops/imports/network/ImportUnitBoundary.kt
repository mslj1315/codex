package com.restaurantops.imports.network

import com.restaurantops.imports.ImportCandidateUpdate
import java.math.BigDecimal

internal object ImportUnitBoundary {
    private const val CENTS_PER_YUAN = 100L
    private val monetaryMetrics = setOf(
        "revenue",
        "average_spend",
        "package_sales",
        "refunds",
        "promotion_spend"
    )
    private val countMetrics = setOf("orders", "package_redemptions")

    fun normalize(metricKey: String, value: Long, unit: String): ApiUnitValue {
        val normalizedUnit = unit.trim().lowercase()
        return when {
            metricKey in monetaryMetrics -> when (normalizedUnit) {
                "yuan" -> ApiUnitValue(yuanToCents(value), "cents")
                "cents", "unknown" -> ApiUnitValue(value, normalizedUnit)
                else -> invalidUnit(metricKey, normalizedUnit)
            }
            metricKey in countMetrics -> when (normalizedUnit) {
                "count", "unknown" -> ApiUnitValue(value, normalizedUnit)
                else -> invalidUnit(metricKey, normalizedUnit)
            }
            else -> throw ImportRequestException(422, "不支持的经营指标")
        }
    }

    fun displayValue(metricKey: String, value: Long, unit: String): String =
        if (metricKey in monetaryMetrics && unit == "cents") centsToYuan(value) else value.toString()

    fun displayUnit(metricKey: String, unit: String): String =
        if (metricKey in monetaryMetrics && unit == "cents") "元" else unit

    fun displayInputUnit(metricKey: String, unit: String): String =
        if (metricKey in monetaryMetrics && unit == "cents") "yuan" else unit

    fun parseDisplayInput(metricKey: String, valueInput: String, unit: String): ApiUnitValue? {
        val normalizedUnit = unit.trim().lowercase()
        return when {
            metricKey in monetaryMetrics && normalizedUnit == "yuan" -> {
                val cents = try {
                    BigDecimal(valueInput.trim()).movePointRight(2).longValueExact()
                } catch (_: NumberFormatException) {
                    null
                } catch (_: ArithmeticException) {
                    null
                }
                cents?.takeIf { it > 0 }?.let { ApiUnitValue(it, "cents") }
            }
            metricKey in monetaryMetrics && normalizedUnit == "cents" ->
                valueInput.trim().toLongOrNull()?.takeIf { it > 0 }?.let { ApiUnitValue(it, "cents") }
            metricKey in countMetrics && normalizedUnit == "count" ->
                valueInput.trim().toLongOrNull()?.let { ApiUnitValue(it, "count") }
            else -> null
        }
    }

    fun normalizeUpdate(metricKey: String, update: ImportCandidateUpdate): CandidateUpdateRequest {
        val suppliedUnit = update.unit ?: return CandidateUpdateRequest(
            value = update.value,
            rangeStart = update.rangeStart,
            rangeEnd = update.rangeEnd,
            status = update.status?.toApiValue()
        )
        val suppliedValue = update.value ?: throw ImportRequestException(422, "确认金额时必须填写数值")
        val normalized = normalize(metricKey, suppliedValue, suppliedUnit)
        return CandidateUpdateRequest(
            value = normalized.value,
            unit = normalized.unit,
            rangeStart = update.rangeStart,
            rangeEnd = update.rangeEnd,
            status = update.status?.toApiValue()
        )
    }

    private fun yuanToCents(value: Long): Long {
        if (value > Long.MAX_VALUE / CENTS_PER_YUAN || value < Long.MIN_VALUE / CENTS_PER_YUAN) {
            throw ImportRequestException(422, "金额超出可导入范围")
        }
        return value * CENTS_PER_YUAN
    }

    private fun centsToYuan(value: Long): String {
        val whole = value / CENTS_PER_YUAN
        val fraction = kotlin.math.abs(value % CENTS_PER_YUAN)
        val sign = if (value < 0 && whole == 0L) "-" else ""
        return if (fraction == 0L) whole.toString() else "$sign$whole.${fraction.toString().padStart(2, '0')}"
    }

    private fun invalidUnit(metricKey: String, unit: String): Nothing =
        throw ImportRequestException(422, "$metricKey 不支持单位 $unit")
}

internal data class ApiUnitValue(val value: Long, val unit: String)
