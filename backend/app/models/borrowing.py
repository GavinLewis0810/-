from sqlalchemy import Column, Integer, String, Numeric, DateTime, Date, ForeignKey
from sqlalchemy.orm import relationship
from datetime import datetime
import enum

from app.database import Base


class BorrowingStatus(str, enum.Enum):
    DRAFT = "草稿"
    SUBMITTED = "待审批"
    APPROVED = "已批准"
    REJECTED = "已驳回"
    REPAID = "已冲销"


class Borrowing(Base):
    __tablename__ = "borrowings"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    title = Column(String(255), nullable=False)
    estimated_amount = Column(Numeric(12, 2), nullable=False)
    expected_repayment_date = Column(Date, nullable=True)
    status = Column(String(20), default=BorrowingStatus.SUBMITTED.value, nullable=False)
    reject_reason = Column(String(500), nullable=True)
    approved_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    reason_category_id = Column(Integer, ForeignKey("reason_categories.id"), nullable=True)

    # 关联事前申请
    application_id = Column(Integer, ForeignKey("applications.id"), nullable=True)

    # 冲销关联
    reimbursement_id = Column(Integer, ForeignKey("reimbursements.id"), nullable=True)
    repaid_amount = Column(Numeric(12, 2), nullable=True)  # 实际冲销金额

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # 关系
    user = relationship("User", foreign_keys=[user_id])
    approver = relationship("User", foreign_keys=[approved_by])
    reason_category = relationship("ReasonCategory")
    application = relationship("Application", foreign_keys=[application_id])
    reimbursement = relationship("Reimbursement", foreign_keys=[reimbursement_id])
