from datetime import date, datetime
from decimal import Decimal
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field
from enum import Enum


class InvoiceStatus(str, Enum):
    UPLOADED = "已上传"
    PROCESSING = "解析中"
    PENDING = "待处理"
    REVIEWING = "待确认"
    CONFIRMED = "已确认"
    PENDING_RECHECK = "待重审"
    PENDING_VOUCHER_REVIEW = "待随单审核"
    REIMBURSED = "已报销"
    NOT_REIMBURSED = "未报销"


# 🚨 1. 新增：专门用于解析 JSONB 中每一行商品明细的 Schema
class InvoiceItemSchema(BaseModel):
    item_name: Optional[str] = Field(None, description="项目名称")
    specification: Optional[str] = Field(None, description="规格型号")
    unit: Optional[str] = Field(None, description="单位")
    quantity: Optional[str] = Field(None, description="数量")
    unit_price: Optional[str] = Field(None, description="单价")
    amount: Optional[str] = Field(None, description="金额(不含税)")
    tax_rate: Optional[str] = Field(None, description="税率")
    tax_amount: Optional[str] = Field(None, description="税额")


# 🚨 2. 改造基础模型：删除单行商品字段，加入 items 数组
class InvoiceBase(BaseModel):
    invoice_number: Optional[str] = Field(None, description="发票号码")
    issue_date: Optional[date] = Field(None, description="开票日期")
    buyer_name: Optional[str] = Field(None, description="购买方名称")
    buyer_tax_id: Optional[str] = Field(None, description="购买方纳税人识别号")
    seller_name: Optional[str] = Field(None, description="销售方名称")
    seller_tax_id: Optional[str] = Field(None, description="销售方纳税人识别号")
    total_with_tax: Optional[Decimal] = Field(None, description="价税合计金额(全局)")
    amount: Optional[Decimal] = Field(None, description="总金额(不含税, 全局)")
    tax_rate: Optional[str] = Field(None, description="税率(全局)")
    tax_amount: Optional[Decimal] = Field(None, description="总税额(全局)")

    # 🚨 新增：支持多行商品明细的数组
    items: Optional[List[InvoiceItemSchema]] = Field(default=[], description="发票明细列表")

    # ESG 碳足迹
    spend_category: Optional[str] = Field(None, description="消费类别")
    carbon_kg: Optional[float] = Field(None, description="碳足迹(kg CO2)")

    # 发票确认流程：字段级状态
    field_states: Optional[Dict[str, Any]] = Field(None, description="字段确认状态快照")
    user_corrections: Optional[Dict[str, Any]] = Field(None, description="用户修正记录")
    confirmation_mode: Optional[str] = Field(None, description="AUTO/USER_SELECTION/USER_EDIT")
    decision_trace: Optional[Dict[str, Any]] = Field(None, description="字段决策轨迹与风险摘要")
    selection_fields: Optional[List[str]] = Field(None, description="在解析对比区人工选择过的字段列表")


class InvoiceCreate(InvoiceBase):
    pass


class InvoiceUpdate(InvoiceBase):
    status: Optional[InvoiceStatus] = None
    owner: Optional[str] = None


class InvoiceResponse(InvoiceBase):
    id: int
    file_name: str
    file_type: str
    status: InvoiceStatus
    owner: Optional[str] = None
    owner_id: Optional[int] = None
    reimbursement_id: Optional[int] = None
    invoice_hash: Optional[str] = None
    ground_truth: Optional[Dict[str, Any]] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class GroundTruthSave(BaseModel):
    """保存人工标注真值"""
    fields: Dict[str, str] = Field(..., description="字段名→真值，如 {'invoice_number': '12345678', ...}")


class InvoiceListResponse(BaseModel):
    items: List[InvoiceResponse]
    total: int
    page: int
    page_size: int


class OcrResultResponse(BaseModel):
    id: int
    invoice_id: int
    raw_text: Optional[str] = None
    invoice_number: Optional[str] = None
    issue_date: Optional[str] = None
    buyer_name: Optional[str] = None
    buyer_tax_id: Optional[str] = None
    seller_name: Optional[str] = None
    seller_tax_id: Optional[str] = None
    total_with_tax: Optional[str] = None
    amount: Optional[str] = None
    tax_rate: Optional[str] = None
    tax_amount: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class LlmResultResponse(BaseModel):
    id: int
    invoice_id: int
    invoice_number: Optional[str] = None
    issue_date: Optional[str] = None
    buyer_name: Optional[str] = None
    buyer_tax_id: Optional[str] = None
    seller_name: Optional[str] = None
    seller_tax_id: Optional[str] = None
    total_with_tax: Optional[str] = None
    amount: Optional[str] = None
    tax_rate: Optional[str] = None
    tax_amount: Optional[str] = None

    # 🚨 LLM 结果也需要带上解析出的 items 数组
    items: Optional[List[InvoiceItemSchema]] = []

    # 🚨 HITL置信度：LLM对各字段的自评置信度
    confidence_scores: Optional[Dict[str, Any]] = None

    created_at: datetime

    class Config:
        from_attributes = True


class ParsingDiffResponse(BaseModel):
    id: int
    invoice_id: int
    field_name: str
    ocr_value: Optional[str] = None
    llm_value: Optional[str] = None
    machine_value: Optional[str] = None
    machine_source: Optional[str] = None
    machine_confidence: Optional[float] = Field(None, description="机器综合裁决置信度(0.00-1.00)")
    decision_rule_type: Optional[str] = None
    decision_reason: Optional[Any] = None
    final_value: Optional[str] = None
    source: Optional[str] = None
    confidence: Optional[float] = Field(None, description="综合融合置信度(0.00-1.00)")
    ocr_confidence: Optional[float] = Field(None, description="OCR字段级置信度(0.00-1.00)")
    llm_confidence: Optional[float] = Field(None, description="LLM自评置信度(0.00-1.00)")
    resolved: int = 0

    class Config:
        from_attributes = True


class ImageForensicsResponse(BaseModel):
    id: int
    invoice_id: int
    risk_score: int
    risk_level: str
    metadata_result: Optional[Dict[str, Any]] = None
    ela_result: Optional[Dict[str, Any]] = None
    jpeg_double_compression_result: Optional[Dict[str, Any]] = None
    noise_consistency_result: Optional[Dict[str, Any]] = None
    summary: Optional[str] = None
    details: Optional[List[str]] = None
    created_at: datetime

    class Config:
        from_attributes = True


class InvoiceDetailResponse(InvoiceResponse):
    ocr_result: Optional[OcrResultResponse] = None
    llm_result: Optional[LlmResultResponse] = None
    parsing_diffs: List[ParsingDiffResponse] = []
    forensics_result: Optional[ImageForensicsResponse] = None


class BatchUpdateRequest(BaseModel):
    invoice_ids: List[int]
    status: Optional[InvoiceStatus] = None
    owner: Optional[str] = None


class BatchDeleteRequest(BaseModel):
    invoice_ids: List[int] = Field(..., description="要删除的发票ID列表")


class StatisticsResponse(BaseModel):
    count: int = Field(description="发票数量")
    total_amount: Decimal = Field(description="金额合计")
    total_tax: Decimal = Field(description="税额合计")
    total_with_tax: Decimal = Field(description="价税合计")


class UploadResponse(BaseModel):
    id: int
    file_name: str
    status: str
    message: str


class ConfirmInvoiceRequest(BaseModel):
    """用户确认发票数据"""
    corrections: Dict[str, str] = Field(default_factory=dict, description="用户修正的字段 map: {field_name: user_value}")

class ConfirmInvoiceResponse(BaseModel):
    invoice_id: int
    status: str
    has_corrections: bool = False
    corrected_fields: List[str] = []
    confirmation_mode: str = "AUTO"
    risk_level: str = "low"
    requires_voucher_review: bool = False
    selection_fields: List[str] = []
    message: str
    next_status_label: str = ""       # 下一状态人话标签
    workflow_transition: str = ""     # 状态流转说明，如 "REVIEWING→PENDING_VOUCHER_REVIEW"


class ResolveDiffRequest(BaseModel):
    """Request to resolve a parsing diff by selecting a source value."""
    source: str = Field(..., description="'ocr', 'llm', or 'custom'")
    custom_value: Optional[str] = Field(None, description="Custom value if source is 'custom'")


# ========== ESG 碳足迹相关 Schema ==========

class CarbonMyStats(BaseModel):
    """当前用户的碳足迹统计"""
    total_carbon_kg: float = 0
    tree_offset: float = 0
    green_points: int = 0             # 绿色积分
    point_sources: List[str] = []     # 积分来源明细
    category_breakdown: List[dict] = []
    monthly_trend: List[dict] = []
    rank: int = 0
    rank_percentile: float = 0
    suggestion: str = ""


class CarbonRankItem(BaseModel):
    """低碳排名条目（按绿色积分降序）"""
    rank: int
    username: str
    full_name: str
    department: Optional[str] = None
    green_points: int = 0             # 绿色积分
    point_sources: List[str] = []     # 积分来源
    total_carbon_kg: float = 0        # 碳排放量（仅供参考）
    invoice_count: int = 0
    tree_offset: float = 0


class CarbonCompanyStats(BaseModel):
    """全公司碳足迹汇总"""
    total_carbon_kg: float = 0
    total_tree_offset: float = 0
    avg_carbon_per_user: float = 0
    top_category: str = ""
    category_breakdown: List[dict] = []
    monthly_trend: List[dict] = []


# ========== 操作审计相关 Schema ==========

class AuditLogItem(BaseModel):
    id: int
    entity_type: str
    entity_id: int
    action: str
    old_value: Optional[dict] = None
    new_value: Optional[dict] = None
    user_id: Optional[str] = None
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    details: Optional[str] = None
    created_at: str


class AuditLogResponse(BaseModel):
    items: List[AuditLogItem]
    total: int
    page: int
    page_size: int


class AuditStats(BaseModel):
    today_count: int = 0
    month_count: int = 0
    by_action: List[dict] = []
    by_entity: List[dict] = []


class FlowStat(BaseModel):
    # 最近一笔已完成报销单的精确耗时（分钟）
    latest_reimb_id: Optional[int] = None
    latest_submit_to_approve_minutes: float = 0
    latest_approve_to_pay_minutes: float = 0
    latest_total_minutes: float = 0
    # 近30天平均耗时（分钟）
    avg_submit_to_approve_minutes: float = 0
    avg_approve_to_pay_minutes: float = 0
    avg_total_minutes: float = 0
    # 当前待审批数
    pending_count: int = 0


class SubjectReviewApplyRequest(BaseModel):
    """主体复核整组应用请求"""
    scheme_key: Optional[str] = None       # 采用某个候选方案
    mode: Optional[str] = None             # "manual" 手动修正
    fields: Optional[Dict[str, str]] = None  # mode=manual 时的手动值


class SubjectReviewApplyResponse(BaseModel):
    """主体复核整组应用响应"""
    invoice_id: int
    applied: bool = True                    # 主体复核是否已完成
    applied_mode: str                       # "scheme" | "manual"
    scheme_key: Optional[str] = None
    scheme_display_label: Optional[str] = None
    resolved_fields: List[str] = []         # 已确认的主体字段（必含4个）
    all_subject_fields_resolved: bool = True
    next_status: str = ""                   # 当前状态（不在此接口变更）
    next_status_label: str = ""
    message: str = ""
