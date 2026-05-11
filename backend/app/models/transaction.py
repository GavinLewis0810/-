"""交易流水模型。"""
from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Numeric
from sqlalchemy.orm import relationship
from app.database import Base


class Transaction(Base):
    __tablename__ = "transactions"

    id = Column(Integer, primary_key=True, index=True)
    type = Column(String(20), nullable=False)  # 拨款 / 报销到账 / 借款冲销
    amount = Column(Numeric(12, 2), nullable=False)
    bank_card_id = Column(Integer, ForeignKey("bank_cards.id"), nullable=False, index=True)
    borrowing_id = Column(Integer, ForeignKey("borrowings.id"), nullable=True)
    reimbursement_id = Column(Integer, ForeignKey("reimbursements.id"), nullable=True)
    balance_before = Column(Numeric(12, 2), nullable=False)
    balance_after = Column(Numeric(12, 2), nullable=False)
    note = Column(String(300), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    bank_card = relationship("BankCard")
    borrowing = relationship("Borrowing")
    reimbursement = relationship("Reimbursement")
