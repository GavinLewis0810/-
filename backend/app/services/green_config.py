"""ESG 绿色积分规则配置"""
from typing import Optional

# 维度一：无纸化贡献 — 每张电子发票固定积分
PAPERLESS_POINTS = 2

# 维度二：数字化替代 — 软件/SaaS/云服务替代物理介质
DIGITAL_CATEGORIES = {
    "通讯": 8,
}

# 维度三：绿色采购关键词 — 从 items 明细匹配
GREEN_KEYWORD_POINTS = {
    "一级能效": 10, "节能": 10, "低功耗": 10,
    "二手": 10, "翻新": 10, "以旧换新": 10,
    "电子版": 8, "数字": 8, "云": 8, "在线": 8,
    "环保": 8, "可再生": 8,
}


def compute_green_points(spend_category: str = "", items: Optional[list] = None) -> "tuple[int, list[str]]":
    """根据消费类别和商品明细计算绿色积分，返回 (积分, 来源列表)"""
    points = PAPERLESS_POINTS
    sources = ["无纸化"]

    # 数字化替代
    if spend_category in DIGITAL_CATEGORIES:
        pts = DIGITAL_CATEGORIES[spend_category]
        points += pts
        sources.append(f"数字化({spend_category})+{pts}")

    # 绿色采购关键词
    if items:
        import json
        text = json.dumps(items, ensure_ascii=False).lower()
        for keyword, pts in GREEN_KEYWORD_POINTS.items():
            if keyword.lower() in text:
                points += pts
                sources.append(f"绿色采购({keyword})+{pts}")
                break  # 一张发票只取最高一类关键词

    return points, sources
