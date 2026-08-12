package com.restaurantops

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MainActivityNavigationTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<MainActivity>()

    @Test
    fun completedOnboardingEntersTheWorkspace() {
        composeRule.onNodeWithText("本地演示").performClick()
        composeRule.onNodeWithText("门店名称").performTextInput("Task7Store")
        composeRule.onNodeWithText("下一步").performClick()
        composeRule.onNodeWithTag("business-type-chinese_dining").performClick()
        composeRule.onNodeWithText("下一步").performClick()
        composeRule.onNodeWithText("人均消费").performTextInput("100")
        composeRule.onNodeWithText("下一步").performClick()
        composeRule.onNodeWithText("希望优先改善什么？").performTextInput("Improve")
        composeRule.onNodeWithText("本地预览").assertIsEnabled().performClick()

        composeRule.onNodeWithText("进入今日经营").performClick()

        composeRule.onNodeWithText("今日经营").assertIsDisplayed()
        composeRule.onNodeWithText("导入经营数据").assertIsDisplayed()

        composeRule.activityRule.scenario.recreate()
        composeRule.onNodeWithText("今日经营").assertIsDisplayed()
    }
}
