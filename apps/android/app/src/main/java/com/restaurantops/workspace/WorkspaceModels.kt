package com.restaurantops.workspace

enum class WorkspaceTab(val title: String, val wireValue: String) {
    HOME("首页", "home"),
    TASKS("任务", "tasks"),
    MESSAGES("消息", "messages"),
    PROFILE("我的", "profile");

    companion object {
        fun fromWireValue(value: String?): WorkspaceTab = entries.firstOrNull { it.wireValue == value } ?: HOME
    }
}

enum class VideoFactoryStage(val title: String, val wireValue: String) {
    TOPIC("选题", "topic"),
    COPY("文案", "copy"),
    COPY_COMPLIANCE("文字合规", "copy-compliance"),
    STORYBOARD("分镜", "storyboard"),
    ASSETS("素材", "assets"),
    LIBRARY("视频库", "library");

    companion object {
        fun fromWireValue(value: String?): VideoFactoryStage =
            entries.firstOrNull { it.wireValue == value } ?: TOPIC
    }
}

data class LocalActionTask(
    val title: String,
    val owner: String,
    val dueDate: String,
    val metric: String,
    val status: String = "待开始"
)
