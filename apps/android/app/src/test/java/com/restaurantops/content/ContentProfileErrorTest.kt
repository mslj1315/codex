package com.restaurantops.content

import org.junit.Assert.assertEquals
import org.junit.Test

class ContentProfileErrorTest {
    @Test fun httpFailureUsesNeutralMessage() {
        assertEquals("暂时无法连接内容服务，请稍后重试", ContentProfileHttpException("raw secret").neutralMessage)
    }

    @Test fun stageFailureDoesNotExposeRawExceptionMessage() {
        assertEquals("暂时无法保存经营阶段，请稍后重试", contentProfileErrorMessage(IllegalStateException("credential=secret"), "暂时无法保存经营阶段，请稍后重试"))
    }
}
