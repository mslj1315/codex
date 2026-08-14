package com.restaurantops.content

enum class RootScreen { ONBOARDING, PROFILE, WORKSPACE }

fun nextRootScreen(current: RootScreen, gate: ContentProfileGate): RootScreen = when (current) {
    RootScreen.ONBOARDING -> RootScreen.PROFILE
    RootScreen.PROFILE -> if (gate == ContentProfileGate.Ready) RootScreen.WORKSPACE else RootScreen.PROFILE
    RootScreen.WORKSPACE -> if (gate == ContentProfileGate.Ready) RootScreen.WORKSPACE else RootScreen.PROFILE
}
