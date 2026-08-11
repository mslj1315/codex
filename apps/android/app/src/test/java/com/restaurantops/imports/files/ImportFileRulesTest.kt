package com.restaurantops.imports.files

import com.restaurantops.imports.ImportSourceType
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ImportFileRulesTest {
    @Test
    fun `picker MIME lists are defensive copies for each source`() {
        val first = ImportFileRules.pickerMimeTypes(ImportSourceType.CSV)
        first[0] = "mutated"

        assertArrayEquals(
            arrayOf(
                "text/csv",
                "text/comma-separated-values",
                "application/csv",
                "application/vnd.ms-excel"
            ),
            ImportFileRules.pickerMimeTypes(ImportSourceType.CSV)
        )
        assertArrayEquals(
            arrayOf("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
            ImportFileRules.pickerMimeTypes(ImportSourceType.XLSX)
        )
        assertArrayEquals(emptyArray<String>(), ImportFileRules.pickerMimeTypes(ImportSourceType.MANUAL))
    }

    @Test
    fun `CSV and XLSX validation accepts case insensitive matching extensions`() {
        assertNull(ImportFileRules.validate("REPORT.CSV", 1, ImportSourceType.CSV))
        assertNull(ImportFileRules.validate("REPORT.XLSX", 1, ImportSourceType.XLSX))
    }

    @Test
    fun `validation reports stable typed file errors`() {
        assertEquals("无法读取文件名", ImportFileRules.validate(null, 1, ImportSourceType.CSV))
        assertEquals("无法读取文件名", ImportFileRules.validate("  ", 1, ImportSourceType.CSV))
        assertEquals("请选择 CSV 文件", ImportFileRules.validate("report.xlsx", 1, ImportSourceType.CSV))
        assertEquals("请选择 Excel 文件", ImportFileRules.validate("report.csv", 1, ImportSourceType.XLSX))
        assertEquals("手工录入不接受文件", ImportFileRules.validate("report.csv", 1, ImportSourceType.MANUAL))
    }

    @Test
    fun `validation rejects unavailable nonpositive and oversized metadata but accepts exact limit`() {
        assertEquals("无法读取文件大小", ImportFileRules.validate("report.csv", null, ImportSourceType.CSV))
        assertEquals("无法读取文件大小", ImportFileRules.validate("report.csv", 0, ImportSourceType.CSV))
        assertEquals("无法读取文件大小", ImportFileRules.validate("report.csv", -1, ImportSourceType.CSV))
        assertNull(ImportFileRules.validate("report.csv", ImportFileRules.MAX_BYTES, ImportSourceType.CSV))
        assertEquals(
            "文件不能超过 5 MiB",
            ImportFileRules.validate("report.csv", ImportFileRules.MAX_BYTES + 1, ImportSourceType.CSV)
        )
    }

    @Test
    fun `MIME normalization ignores unsafe provider values and uses source standard`() {
        assertEquals("text/csv", ImportFileRules.normalizedMimeType("report.csv", ImportSourceType.CSV, "bad mime\r\n"))
        assertEquals(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            ImportFileRules.normalizedMimeType("report.xlsx", ImportSourceType.XLSX, null)
        )
    }
}
