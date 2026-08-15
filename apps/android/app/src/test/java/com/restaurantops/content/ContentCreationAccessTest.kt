package com.restaurantops.content

import org.junit.Assert.assertEquals
import org.junit.Test

class ContentCreationAccessTest {
    @Test fun unauthenticatedContentCreationHasOnlyTheReturnToLoginAction() {
        assertEquals(
            listOf(ContentCreationAccessAction.ReturnToLogin),
            contentCreationAccessActions(hasAuthenticatedClient = false)
        )
        assertEquals(
            emptyList<ContentCreationAccessAction>(),
            contentCreationAccessActions(hasAuthenticatedClient = true)
        )
    }

    @Test fun requiredLoginRouteExposesOneReturnActionAndInvokesItsCallback() {
        var returned = false
        val route = remoteContentCreationRequiredRoute { returned = true }

        assertEquals(1, route.actions.size)
        assertEquals("返回登录", route.actions.single().label)
        route.actions.single().invoke()
        assertEquals(true, returned)
    }
}
