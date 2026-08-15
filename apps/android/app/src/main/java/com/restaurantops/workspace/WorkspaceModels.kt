package com.restaurantops.workspace

enum class WorkspaceTab(val title: String, val wireValue: String) {
    OPERATIONS("Operations", "operations"),
    HOME("首页", "home"),
    CONTENT_CREATION("内容创作", "content"),
    TASKS("任务", "tasks"),
    MESSAGES("消息", "messages"),
    PROFILE("我的", "profile");

    companion object {
        fun fromWireValue(value: String?): WorkspaceTab = entries.firstOrNull { it.wireValue == value } ?: HOME
    }

    val isCustomerContentCreation: Boolean
        get() = this == CONTENT_CREATION
}

data class LocalActionTask(
    val title: String,
    val owner: String,
    val dueDate: String,
    val metric: String,
    val status: String = "待开始"
)
