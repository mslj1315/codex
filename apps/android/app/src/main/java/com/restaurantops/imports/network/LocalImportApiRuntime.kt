package com.restaurantops.imports.network

object LocalImportApiRuntime {
    fun canUseLocalApi(isDebug: Boolean, baseUrl: String): Boolean =
        isDebug && baseUrl.isNotBlank()
}
