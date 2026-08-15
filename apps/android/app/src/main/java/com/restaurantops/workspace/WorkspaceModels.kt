package com.restaurantops.workspace

enum class WorkspaceTab(val title: String, val wireValue: String) {
    OPERATIONS("Operations", "operations"),
    HOME("首页", "home"),
    CONTENT_CREATION("内容创作", "content-creation"),
    TASKS("任务", "tasks"),
    MESSAGES("消息", "messages"),
    PROFILE("我的", "profile");

    companion object {
        fun fromWireValue(value: String?): WorkspaceTab = entries.firstOrNull { it.wireValue == value } ?: HOME
    }

    val isCustomerContentCreation: Boolean
        get() = this == CONTENT_CREATION
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

data class LocalVideoFactorySource(
    val label: String,
    val topics: List<String>
)

data class LocalVideoFactoryShot(
    val title: String,
    val filmingGuidance: String,
    val materialPlaceholder: String
)

object VideoFactoryLocalContent {
    val sources = listOf(
        LocalVideoFactorySource("经营数据题材", listOf("午市双人套餐")),
        LocalVideoFactorySource("门店灵感", listOf("工作日午餐限时菜单")),
        LocalVideoFactorySource("本地热点", listOf("门店午市服务提醒"))
    )

    val shots = listOf(
        LocalVideoFactoryShot(
            title = "镜头 1：套餐上桌",
            filmingGuidance = "拍摄提示：从套餐整体缓慢推进，保留两人用餐场景。",
            materialPlaceholder = "素材槽位：本地占位，未上传"
        ),
        LocalVideoFactoryShot(
            title = "镜头 2：套餐内容与到店提示",
            filmingGuidance = "拍摄提示：依次展示主食、配菜与午市到店提醒。",
            materialPlaceholder = "素材槽位：本地占位，未上传"
        )
    )
}

data class LocalActionTask(
    val title: String,
    val owner: String,
    val dueDate: String,
    val metric: String,
    val status: String = "待开始"
)
