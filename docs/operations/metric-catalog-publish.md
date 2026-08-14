# 指标目录发布

此命令供服务商后台或受控运维任务使用。门店端没有指标目录写权限；门店应用只读取已发布版本。

## 发布流程

准备一个 JSON 数组。每次运行都会从当前已发布目录复制一个新草稿，再以清单中的定义覆盖同名字段，最后发布该草稿。未写入清单的既有字段会保留；要停用字段，请在清单中以相同 `metricKey` 写入 `enabled: false`。

```json
[
  {
    "metricKey": "revenue",
    "displayName": "营业额",
    "valueKind": "amount",
    "storageUnit": "cents",
    "allowNegative": false,
    "requirePositive": false,
    "usableForReadiness": true,
    "usableForDiagnostic": true,
    "usableForVerification": true,
    "enabled": true
  },
  {
    "metricKey": "lunch_orders",
    "displayName": "午市订单数",
    "valueKind": "count",
    "storageUnit": "count",
    "allowNegative": false,
    "requirePositive": true,
    "usableForReadiness": false,
    "usableForDiagnostic": false,
    "usableForVerification": true,
    "enabled": true
  }
]
```

在 `services/api` 目录运行：

```powershell
$env:DATABASE_URL = 'postgresql://...'
$env:METRIC_CATALOG_FILE = 'C:\secure\metric-catalog.json'
npm run publish:metric-catalog
```

成功时标准输出仅包含新目录版本，例如：

```json
{"versionNumber":2,"state":"published"}
```

失败时命令不会输出数据库地址、清单内容或具体错误。字段名称必须唯一且使用小写字母、数字和下划线；金额使用 `cents`，次数使用 `count`，比例使用 `basis_points`。`revenue`、`orders` 和 `average_spend` 必须保持启用并可用于数据就绪度，否则发布会被拒绝。
