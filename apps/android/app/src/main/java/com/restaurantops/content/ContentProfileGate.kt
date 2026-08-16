package com.restaurantops.content

sealed interface ContentProfileGate {
    data object Loading : ContentProfileGate
    data object NeedsProfile : ContentProfileGate
    data object Ready : ContentProfileGate
}

fun contentProfileGate(state: ContentProfileState): ContentProfileGate = when {
    state.loading -> ContentProfileGate.Loading
    state.profile?.isContentPlanningReady() == true -> ContentProfileGate.Ready
    else -> ContentProfileGate.NeedsProfile
}
