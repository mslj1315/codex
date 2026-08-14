package com.restaurantops.auth

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

class EncryptedRefreshTokenStore(context: Context) : RefreshTokenStore {
    private val preferences = EncryptedSharedPreferences.create(
        context,
        PREFERENCES_NAME,
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )

    override fun read(): String? = preferences.getString(REFRESH_TOKEN_KEY, null)

    override fun write(token: String) {
        preferences.edit().putString(REFRESH_TOKEN_KEY, token).commit()
    }

    override fun clear() {
        preferences.edit().remove(REFRESH_TOKEN_KEY).commit()
    }

    private companion object {
        const val PREFERENCES_NAME = "restaurant_ops_auth"
        const val REFRESH_TOKEN_KEY = "refresh_token"
    }
}
