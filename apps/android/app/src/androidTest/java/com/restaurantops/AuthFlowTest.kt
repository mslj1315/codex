package com.restaurantops

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AuthFlowTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<MainActivity>()

    @Test
    fun debugAppStartsAtLoginAndOffersExplicitLocalDemo() {
        composeRule.onNodeWithText("登录门店工作台").assertIsDisplayed()
        composeRule.onNodeWithText("账号").assertIsDisplayed()
        composeRule.onNodeWithText("密码").assertIsDisplayed()
        composeRule.onNodeWithText("本地演示").assertIsDisplayed()
    }
}
