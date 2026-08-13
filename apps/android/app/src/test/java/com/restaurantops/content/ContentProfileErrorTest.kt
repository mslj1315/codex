package com.restaurantops.content

import org.junit.Assert.assertEquals
import org.junit.Test

class ContentProfileErrorTest {
    @Test fun httpFailureUsesNeutralMessage() {
        assertEquals("暂时无法连接内容服务，请稍后重试", ContentProfileHttpException("raw secret").neutralMessage)
    }
}
