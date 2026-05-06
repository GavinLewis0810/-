"""动态审批规则管理端点。"""
from typing import List, Optional, Any, Dict
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from app.database import get_db
from app.models.approval_rule import ApprovalRule
from app.dependencies import get_current_user

router = APIRouter()


class RuleIn(BaseModel):
    name: str
    entity_type: str = "reimbursement"
    priority: int = 100
    conditions: Dict[str, Any] = {}
    action: str = "NONE"
    is_active: bool = True


class RuleOut(BaseModel):
    id: int
    name: str
    entity_type: str
    priority: int
    conditions: Any
    action: str
    is_active: bool
    created_at: Optional[str] = None

    class Config:
        from_attributes = True


@router.get("", response_model=List[RuleOut])
async def list_rules(
    entity_type: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="仅管理员可操作")
    query = select(ApprovalRule).order_by(ApprovalRule.priority, ApprovalRule.id)
    if entity_type:
        query = query.where(ApprovalRule.entity_type == entity_type)
    result = await db.execute(query)
    rules = result.scalars().all()
    return [RuleOut(
        id=r.id, name=r.name, entity_type=r.entity_type, priority=r.priority,
        conditions=r.conditions, action=r.action, is_active=r.is_active,
        created_at=r.created_at.isoformat() if r.created_at else None,
    ) for r in rules]


@router.post("", response_model=RuleOut)
async def create_rule(
    data: RuleIn,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="仅管理员可操作")
    rule = ApprovalRule(
        name=data.name, entity_type=data.entity_type, priority=data.priority,
        conditions=data.conditions, action=data.action, is_active=data.is_active,
    )
    db.add(rule)
    await db.commit()
    await db.refresh(rule)
    return RuleOut(
        id=rule.id, name=rule.name, entity_type=rule.entity_type,
        priority=rule.priority, conditions=rule.conditions, action=rule.action,
        is_active=rule.is_active,
        created_at=rule.created_at.isoformat() if rule.created_at else None,
    )


@router.put("/{rule_id}", response_model=RuleOut)
async def update_rule(
    rule_id: int,
    data: RuleIn,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="仅管理员可操作")
    rule = await db.get(ApprovalRule, rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="规则不存在")
    rule.name = data.name
    rule.entity_type = data.entity_type
    rule.priority = data.priority
    rule.conditions = data.conditions
    rule.action = data.action
    rule.is_active = data.is_active
    await db.commit()
    await db.refresh(rule)
    return RuleOut(
        id=rule.id, name=rule.name, entity_type=rule.entity_type,
        priority=rule.priority, conditions=rule.conditions, action=rule.action,
        is_active=rule.is_active,
        created_at=rule.created_at.isoformat() if rule.created_at else None,
    )


@router.delete("/{rule_id}")
async def delete_rule(
    rule_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="仅管理员可操作")
    rule = await db.get(ApprovalRule, rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="规则不存在")
    await db.delete(rule)
    await db.commit()
    return {"message": "已删除"}
