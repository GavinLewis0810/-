"""动态审批规则引擎。

条件 JSON 结构：
  叶子节点: { "field": "total_amount", "op": "<", "value": 500 }
  复合节点: { "operator": "AND", "rules": [...] }
支持操作符: < <= > >= == != in not_in
"""

from typing import Optional, Any, Dict, List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.approval_rule import ApprovalRule


def _evaluate_node(node: dict, context: dict) -> bool:
    """递归评估单个条件节点。"""
    # 叶子节点
    if "field" in node:
        actual = context.get(node["field"])
        target = node.get("value")
        op = node.get("op", "==")

        if op in ("<", "<=", ">", ">="):
            try:
                a = float(actual or 0)
                t = float(target or 0)
            except (TypeError, ValueError):
                return False
            if op == "<":   return a < t
            if op == "<=":  return a <= t
            if op == ">":   return a > t
            if op == ">=":  return a >= t

        if op == "==":
            return str(actual or "") == str(target or "")
        if op == "!=":
            return str(actual or "") != str(target or "")
        if op == "in":
            return str(actual) in (target if isinstance(target, list) else [target])
        if op == "not_in":
            return str(actual) not in (target if isinstance(target, list) else [target])

        return False

    # 复合节点
    children: List[dict] = node.get("rules", [])
    if not children:
        return False
    op = node.get("operator", "AND")
    results = [_evaluate_node(c, context) for c in children]
    return all(results) if op == "AND" else any(results)


async def match_rules(
    entity_type: str,
    context: Dict[str, Any],
    db: AsyncSession,
) -> Optional[str]:
    """按优先级匹配规则，返回第一个命中的 action，都不命中返回 None。"""
    result = await db.execute(
        select(ApprovalRule)
        .where(
            ApprovalRule.entity_type == entity_type,
            ApprovalRule.is_active == True,
        )
        .order_by(ApprovalRule.priority)
    )
    rules = result.scalars().all()

    print(f"[规则引擎] 上下文: {context}")
    print(f"[规则引擎] 找到 {len(rules)} 条活跃规则")
    for rule in rules:
        conditions = rule.conditions or {}
        if not conditions:
            continue
        matched = _evaluate_node(conditions, context)
        print(f"[规则引擎] 规则「{rule.name}」(pri={rule.priority}) 条件={conditions} → 匹配={matched} action={rule.action}")
        if matched:
            print(f"[规则引擎] ✅ 命中 action={rule.action}")
            return rule.action

    print("[规则引擎] ❌ 没有规则命中")
    return None
