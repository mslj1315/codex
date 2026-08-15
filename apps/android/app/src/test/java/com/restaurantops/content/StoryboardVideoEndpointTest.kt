package com.restaurantops.content

import org.junit.Assert.assertEquals
import org.junit.Test

class StoryboardVideoEndpointTest {
    @Test fun customerRoutesStayScopedToStoreTaskShotListAndProject() {
        val route = storyboardProjectPath("store", "task", "shots", "project")
        assertEquals("/v1/stores/store/content-tasks/task/shot-lists/shots/projects/project", route)
        assertEquals("$route/renders/render/output", storyboardRenderOutputPath("store", "task", "shots", "project", "render"))
        assertEquals("$route/renders/render/cover-candidates/candidate", storyboardCoverPath("store", "task", "shots", "project", "render", "candidate"))
    }
}
