package com.restaurantops.workspace

import org.junit.Assert.assertEquals
import org.junit.Test

class WorkspaceModelsTest {
    @Test
    fun `video factory stages retain the six expected titles in order`() {
        assertEquals(
            listOf("选题", "文案", "文字合规", "分镜", "素材", "视频库"),
            VideoFactoryStage.entries.map { it.title }
        )
    }
}
