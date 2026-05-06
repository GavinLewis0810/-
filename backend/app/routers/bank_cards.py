"""收款银行卡管理端点。"""
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from app.database import get_db
from app.models.bank_card import BankCard
from app.dependencies import get_current_user

router = APIRouter()


class BankCardCreate(BaseModel):
    bank_name: str
    account_name: str
    card_number: str


class BankCardResponse(BaseModel):
    id: int
    bank_name: str
    account_name: str
    card_number: str
    is_default: bool

    class Config:
        from_attributes = True


@router.get("", response_model=List[BankCardResponse])
async def list_bank_cards(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """获取当前用户的银行卡列表。"""
    result = await db.execute(
        select(BankCard).where(BankCard.user_id == current_user["id"]).order_by(BankCard.is_default.desc(), BankCard.created_at.desc())
    )
    return result.scalars().all()


@router.post("", response_model=BankCardResponse)
async def add_bank_card(
    data: BankCardCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """添加银行卡。"""
    if not data.bank_name.strip() or not data.account_name.strip() or not data.card_number.strip():
        raise HTTPException(status_code=400, detail="开户行、姓名、卡号均不能为空")

    # 如果是第一张卡，自动设为默认
    count = await db.scalar(select(BankCard).where(BankCard.user_id == current_user["id"]).limit(1))
    is_first = count is None

    card = BankCard(
        user_id=current_user["id"],
        bank_name=data.bank_name.strip(),
        account_name=data.account_name.strip(),
        card_number=data.card_number.strip(),
        is_default=is_first,
    )
    db.add(card)
    await db.commit()
    await db.refresh(card)
    return card


@router.put("/{card_id}/default")
async def set_default_card(
    card_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """设为默认银行卡。"""
    card = await db.get(BankCard, card_id)
    if not card or card.user_id != current_user["id"]:
        raise HTTPException(status_code=404, detail="银行卡不存在")

    # 取消所有默认
    result = await db.execute(
        select(BankCard).where(BankCard.user_id == current_user["id"], BankCard.is_default == True)  # noqa
    )
    for c in result.scalars().all():
        c.is_default = False

    card.is_default = True
    await db.commit()
    return {"message": "已设为默认"}


@router.delete("/{card_id}")
async def delete_bank_card(
    card_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """删除银行卡。"""
    card = await db.get(BankCard, card_id)
    if not card or card.user_id != current_user["id"]:
        raise HTTPException(status_code=404, detail="银行卡不存在")

    await db.delete(card)
    await db.commit()
    return {"message": "已删除"}
