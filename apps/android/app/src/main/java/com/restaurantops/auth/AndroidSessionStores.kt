package com.restaurantops.auth

import android.content.Context

class PreferencesSelectedStoreStore(context: Context) : SelectedStoreStore {
    private val preferences = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

    override var storeId: String?
        get() = preferences.getString(STORE_ID_KEY, null)
        set(value) {
            preferences.edit().apply {
                if (value == null) remove(STORE_ID_KEY) else putString(STORE_ID_KEY, value)
            }.commit()
        }

    private companion object {
        const val PREFERENCES_NAME = "restaurant_ops_workspace"
        const val STORE_ID_KEY = "selected_store_id"
    }
}
