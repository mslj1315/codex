package com.restaurantops.workspace

enum class WorkspaceTab(val title: String) {
    HOME("首页"),
    TASKS("任务"),
    MESSAGES("消息"),
    PROFILE("我的")
}

enum class VideoFactoryStage(val title: String) {
    TOPIC("选题"),
    COPY("文案"),
    COPY_COMPLIANCE("文字合规"),
    STORYBOARD("分镜"),
    ASSETS("素材"),
    LIBRARY("视频库")
}

data class LocalActionTask(
    val title: String,
    val owner: String,
    val dueDate: String,
    val metric: String,
    val status: String = "待开始"
)
