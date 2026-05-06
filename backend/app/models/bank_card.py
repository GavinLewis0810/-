"""收款银行卡模型。"""
from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, Boolean, ForeignKey
from sqlalchemy.orm import relationship
from app.database import Base


class BankCard(Base):
    __tablename__ = "bank_cards"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    bank_name = Column(String(100), nullable=False)      # 开户行
    account_name = Column(String(50), nullable=False)     # 持卡人姓名
    card_number = Column(String(30), nullable=False)      # 银行卡号（尾号存储/脱敏）
    is_default = Column(Boolean, default=False)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    user = relationship("User")
