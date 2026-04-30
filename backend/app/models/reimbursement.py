from datetime import datetime
from decimal import Decimal
from enum import Enum
from sqlalchemy import Column, Integer, String, DateTime, Numeric, Text, Enum as SQLEnum
from sqlalchemy.orm import relationship

from app.database import Base


class ReimbursementStatus(str, Enum):
    DRAFT = "草稿"
    SUBMITTED = "待审批"
    APPROVED = "已通过"
    REJECTED = "已驳回"
    COMPLETED = "已打款"


class Reimbursement(Base):
    __tablename__ = "reimbursements"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255), nullable=False)  # 报销事由，如 "参加人工智能大会差旅"
    project_code = Column(String(100), nullable=True)  # 项目编号/课题组
    total_amount = Column(Numeric(12, 2), default=0)  # 报销总金额

    submitter = Column(String(100), nullable=True, default="当前用户")  # 提交人
    reviewer = Column(String(100), nullable=True)  # 审批人
    reject_reason = Column(Text, nullable=True)  # 驳回理由

    status = Column(SQLEnum(ReimbursementStatus), default=ReimbursementStatus.SUBMITTED, nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # 关联关系：一个报销单对应多张发票
    invoices = relationship("Invoice", back_populates="reimbursement")