package com.restaurantops.content

fun nextRootScreen(current: RootScreen, gate: ContentProfileGate): RootScreen = when (current) {
    RootScreen.ONBOARDING -> RootScreen.PROFILE
    RootScreen.PROFILE -> if (gate == ContentProfileGate.Ready) RootScreen.WORKSPACE else RootScreen.PROFILE
    RootScreen.WORKSPACE -> if (gate == ContentProfileGate.Ready) RootScreen.WORKSPACE else RootScreen.PROFILE
    RootScreen.STORYBOARD_EDITOR -> if (gate == ContentProfileGate.Ready) RootScreen.WORKSPACE else RootScreen.PROFILE
}
