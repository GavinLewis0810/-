from pydantic import BaseModel, Field
from typing import Optional
from datetime import date, datetime


class BorrowingCreate(BaseModel):
    title: str = Field(..., description="借款事由")
    estimated_amount: float = Field(..., description="预计借款金额")
    expected_repayment_date: Optional[str] = Field(None, description="预计还款日期 YYYY-MM-DD")


class BorrowingResponse(BaseModel):
    id: int
    title: str
    estimated_amount: float
    expected_repayment_date: Optional[str] = None
    status: str
    reject_reason: Optional[str] = None
    repayment_date: Optional[str] = None
    repaid_amount: Optional[float] = None
    reimbursement_id: Optional[int] = None
    user_name: Optional[str] = None
    approver_name: Optional[str] = None
    created_at: Optional[str] = None

    class Config:
        from_attributes = True
