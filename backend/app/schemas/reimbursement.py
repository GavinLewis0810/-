from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime
from app.models.reimbursement import ReimbursementStatus
from app.schemas.invoice import InvoiceResponse  # 引入发票的schema


class ReimbursementCreate(BaseModel):
    title: str = Field(..., description="报销事由")
    project_code: Optional[str] = Field(None, description="项目编号")
    invoice_ids: List[int] = Field(..., description="要打包报销的发票ID列表")


class ReimbursementResponse(BaseModel):
    id: int
    title: str
    project_code: Optional[str]
    total_amount: float
    submitter: Optional[str]
    reviewer: Optional[str]
    reject_reason: Optional[str]
    status: ReimbursementStatus
    created_at: datetime
    updated_at: datetime

    # 返回报销单时，连同底下的发票一起返回
    invoices: Optional[List[InvoiceResponse]] = []

    class Config:
        from_attributes = True


class ReimbursementReview(BaseModel):
    action: str = Field(..., description="APPROVE 或 REJECT")
    reject_reason: Optional[str] = None