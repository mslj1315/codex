package com.restaurantops.workspace

import org.junit.Assert.assertThrows
import org.junit.Test

class LegacyVideoFactoryRemovalTest {
    @Test fun legacyLocalVideoFactoryTypesAreNotShipped() {
        assertThrows(ClassNotFoundException::class.java) {
            Class.forName("com.restaurantops.workspace.VideoFactoryStage")
        }
        assertThrows(ClassNotFoundException::class.java) {
            Class.forName("com.restaurantops.workspace.VideoFactoryLocalContent")
        }
    }
}
