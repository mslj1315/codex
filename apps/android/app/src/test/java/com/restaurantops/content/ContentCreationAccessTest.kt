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
}
