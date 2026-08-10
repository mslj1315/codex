package com.restaurantops.workspace

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class VideoFactoryLocalContentTest {
    @Test
    fun `local factory content exposes labeled topic sources and per-shot placeholders`() {
        assertEquals(
            listOf("经营数据题材", "门店灵感", "本地热点"),
            VideoFactoryLocalContent.sources.map { it.label }
        )
        assertTrue(VideoFactoryLocalContent.sources.flatMap { it.topics }.contains("午市双人套餐"))
        assertEquals(2, VideoFactoryLocalContent.shots.size)
        VideoFactoryLocalContent.shots.forEach { shot ->
            assertTrue(shot.filmingGuidance.isNotBlank())
            assertEquals("素材槽位：本地占位，未上传", shot.materialPlaceholder)
        }
    }
}
