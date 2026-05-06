from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime
from app.models.reimbursement import ReimbursementStatus
from app.schemas.invoice import InvoiceResponse  # 引入发票的schema

class ReimbursementCreate(BaseModel):
    title: str = Field(..., description="报销事由")
    project_code: str = Field(..., description="项目编号（必选）")
    invoice_ids: List[int] = Field(..., description="要打包报销的发票ID列表")
    bank_card_id: Optional[int] = Field(None, description="收款银行卡 ID")
    application_id: Optional[int] = Field(None, description="事前申请单 ID")
    borrowing_id: Optional[int] = Field(None, description="关联借款申请 ID（用于冲销）")

class ReimbursementResponse(BaseModel):
    id: int
    title: str
    project_code: Optional[str]
    total_amount: float
    submitter: Optional[str]
    reviewer: Optional[str]
    review_note: Optional[str] = None
    reject_reason: Optional[str]
    status: ReimbursementStatus
    created_at: datetime
    updated_at: datetime

    # 🚀🚀🚀 核心新增：告诉 FastAPI 允许把 AI 结果发给前端！
    ai_risk_level: Optional[str] = None
    ai_reason: Optional[str] = None
    ai_review_detail: Optional[Dict[str, Any]] = None
    bank_card_id: Optional[int] = None
    application_id: Optional[int] = None
    borrowing_id: Optional[int] = None
    bank_card_info: Optional[str] = None  # "工商银行 (尾号1234)"
    reviewer_signature: Optional[str] = None  # 财务总监电子签名

    # 模拟打款凭证
    payment_transaction_id: Optional[str] = None
    payment_time: Optional[datetime] = None
    payment_bank: Optional[str] = None

    # 返回报销单时，连同底下的发票一起返回
    invoices: Optional[List[InvoiceResponse]] = []

    class Config:
        from_attributes = True

class ReimbursementReview(BaseModel):
    action: str = Field(..., description="APPROVE 或 REJECT")
    reject_reason: Optional[str] = None