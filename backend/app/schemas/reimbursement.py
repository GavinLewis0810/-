from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from app.models.reimbursement import ReimbursementStatus
from app.schemas.invoice import InvoiceResponse


class ReimbursementCreate(BaseModel):
    title: str = Field(..., description="报销事由")
    project_code: str = Field(..., description="项目编号")
    invoice_ids: List[int] = Field(..., description="要打包报销的发票 ID 列表")
    bank_card_id: Optional[int] = Field(None, description="收款银行卡 ID")
    application_id: Optional[int] = Field(None, description="事前申请单 ID")
    borrowing_id: Optional[int] = Field(None, description="关联借款申请 ID")
    reason_category_id: Optional[int] = Field(None, description="事由类别 ID")


class ReimbursementResponse(BaseModel):
    id: int
    title: str
    project_code: Optional[str]
    total_amount: float
    submitter: Optional[str]
    reviewer: Optional[str]
    review_note: Optional[str] = None
    reject_reason: Optional[str]
    carbon_kg: Optional[float] = None
    status: ReimbursementStatus
    created_at: datetime
    updated_at: datetime

    ai_risk_level: Optional[str] = None
    ai_reason: Optional[str] = None
    ai_review_detail: Optional[Dict[str, Any]] = None
    bank_card_id: Optional[int] = None
    application_id: Optional[int] = None
    borrowing_id: Optional[int] = None
    bank_card_info: Optional[str] = None
    reviewer_signature: Optional[str] = None

    payment_transaction_id: Optional[str] = None
    payment_time: Optional[datetime] = None
    payment_bank: Optional[str] = None

    invoices: Optional[List[InvoiceResponse]] = []

    class Config:
        from_attributes = True


class CategorySuggestionRequest(BaseModel):
    invoice_ids: List[int] = Field(..., description="选中的发票 ID 列表")
    application_id: Optional[int] = Field(None, description="关联的申请单 ID")


class CategorySuggestionResponse(BaseModel):
    mode: str
    suggested_category_id: Optional[int] = None
    suggested_category_name: Optional[str] = None
    confidence: float = 0.0
    breakdown: List[Dict[str, Any]] = []
    hint: str = ""


class ReimbursementReview(BaseModel):
    action: str = Field(..., description="APPROVE 或 REJECT")
    reject_reason: Optional[str] = None


class VoucherReviewFieldUpdate(BaseModel):
    field_name: str = Field(..., description="需要复核的字段名")
    source: str = Field(..., description="ocr / llm / custom")
    value: Optional[str] = Field(None, description="最终采用值；source 为 custom 时必填")


class VoucherReviewRequest(BaseModel):
    review_note: Optional[str] = Field(None, description="管理员复核备注")
    mark_reviewed: bool = Field(True, description="是否将该票标记为已核对")
    field_updates: List[VoucherReviewFieldUpdate] = Field(
        default_factory=list,
        description="管理员在随单审核中修正的字段",
    )


class VoucherReviewResponse(BaseModel):
    reimbursement_id: int
    invoice_id: int
    reviewed: bool
    corrected_fields: List[str] = []
    confirmation_mode: str
    message: str
