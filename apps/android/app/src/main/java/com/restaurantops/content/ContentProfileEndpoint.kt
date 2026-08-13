package com.restaurantops.content

/** Production supplies an authenticated HTTPS endpoint at build time; debug may use the emulator loopback endpoint. */
fun contentProfileEndpointConfigured(baseUrl: String): Boolean = baseUrl.trim().let { it.startsWith("https://") || it.startsWith("http://10.0.2.2:") }
