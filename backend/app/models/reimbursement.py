from datetime import datetime
from decimal import Decimal
from enum import Enum
from sqlalchemy import Column, Integer, String, DateTime, Numeric, Text, Enum as SQLEnum, ForeignKey
from sqlalchemy.dialects.postgresql import JSONB
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

    # 提交人：外键关联到 users 表
    submitter_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    # 保留旧字段用于数据迁移（迁移后可删除）
    submitter = Column(String(100), nullable=True, default="当前用户")

    reviewer = Column(String(100), nullable=True)  # 审批人
    review_note = Column(Text, nullable=True)  # 审批意见（通过时填写）
    reject_reason = Column(Text, nullable=True)  # 驳回理由

    status = Column(SQLEnum(ReimbursementStatus), default=ReimbursementStatus.SUBMITTED, nullable=False)

    # AI 风控结果字段
    ai_risk_level = Column(String(50), nullable=True, comment="AI风险评级")
    ai_reason = Column(Text, nullable=True, comment="AI深度审计意见")
    ai_review_detail = Column(JSONB, nullable=True, comment="AI审查完整报告(含合规状态、备注、明细)")

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # 收款银行卡
    bank_card_id = Column(Integer, ForeignKey("bank_cards.id"), nullable=True)
    # 事由类别
    reason_category_id = Column(Integer, ForeignKey("reason_categories.id"), nullable=True)
    # 事前申请单
    application_id = Column(Integer, ForeignKey("applications.id"), nullable=True)
    # 关联借款申请（用于冲销）
    borrowing_id = Column(Integer, ForeignKey("borrowings.id"), nullable=True)

    # 模拟银企直联打款凭证
    payment_transaction_id = Column(String(64), nullable=True)
    payment_time = Column(DateTime, nullable=True)
    payment_bank = Column(String(100), nullable=True)

    # 关联关系
    submitter_user = relationship("User", back_populates="reimbursements", foreign_keys=[submitter_id])
    reason_category = relationship("ReasonCategory")
    bank_card = relationship("BankCard")
    application = relationship("Application")
    borrowing = relationship("Borrowing", foreign_keys=[borrowing_id])
    invoices = relationship("Invoice", back_populates="reimbursement")

    @property
    def submitter_name(self):
        """从外键关系获取提交人用户名。"""
        return self.submitter_user.username if self.submitter_user else self.submitter