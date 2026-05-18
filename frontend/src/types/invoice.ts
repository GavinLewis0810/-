export enum InvoiceStatus {
  UPLOADED = '已上传',
  PROCESSING = '解析中',
  PENDING = '待处理',
  REVIEWING = '待确认',
  CONFIRMED = '已确认',
  PENDING_RECHECK = '待重审',
  REIMBURSED = '已报销',
  NOT_REIMBURSED = '未报销',
}

// 🚨 新增：专门用于定义数组中每一行商品明细的类型
export interface InvoiceItem {
  item_name?: string | null;
  specification?: string | null;
  unit?: string | null;
  quantity?: string | null;
  unit_price?: string | null;
  amount?: string | null;
  tax_rate?: string | null;
  tax_amount?: string | null;
}

export interface Invoice {
  id: number;
  file_name: string;
  file_type: string;
  invoice_number: string | null;
  issue_date: string | null;
  buyer_name: string | null;
  buyer_tax_id: string | null;
  seller_name: string | null;
  seller_tax_id: string | null;

  // 🚨 这里删除了原来的单行商品字段，保留了全局金额字段
  total_with_tax: number | null;
  amount: number | null;
  tax_rate: string | null;
  tax_amount: number | null;

  // 🚨 新增：发票明细数组（挂载在发票主表上）
  items?: InvoiceItem[] | null;

  status: InvoiceStatus;
  owner: string | null;
  owner_id: number | null;
  reimbursement_id: number | null;
  invoice_hash: string | null;
  ground_truth: Record<string, any> | null;
  field_states: Record<string, { status: string; label: string; ocr: string | null; llm: string | null; confidence: number }> | null;
  user_corrections: Record<string, string> | null;
  spend_category: string | null;
  carbon_kg: number | null;
  created_at: string;
  updated_at: string;
}

// 碳足迹相关类型
export interface CarbonMyStats {
  total_carbon_kg: number;
  tree_offset: number;
  green_points: number;
  point_sources: string[];
  category_breakdown: { category: string; carbon_kg: number; count: number }[];
  monthly_trend: { month: string; carbon_kg: number }[];
  rank: number;
  rank_percentile: number;
  suggestion: string;
}

export interface CarbonRankItem {
  rank: number;
  username: string;
  full_name: string;
  department: string | null;
  green_points: number;
  point_sources: string[];
  total_carbon_kg: number;
  invoice_count: number;
  tree_offset: number;
}

export interface CarbonCompanyStats {
  total_carbon_kg: number;
  total_tree_offset: number;
  avg_carbon_per_user: number;
  top_category: string;
  category_breakdown: { category: string; carbon_kg: number }[];
  monthly_trend: { month: string; carbon_kg: number }[];
}

// 操作审计相关类型
export interface AuditLogItem {
  id: number;
  entity_type: string;
  entity_id: number;
  action: string;
  old_value: Record<string, any> | null;
  new_value: Record<string, any> | null;
  user_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  details: string | null;
  created_at: string;
}

export interface AuditLogResponse {
  items: AuditLogItem[];
  total: number;
  page: number;
  page_size: number;
}

export interface AuditStats {
  today_count: number;
  month_count: number;
  by_action: { action: string; count: number }[];
  by_entity: { entity_type: string; count: number }[];
}

export interface FlowStat {
  latest_reimb_id: number | null;
  latest_submit_to_approve_minutes: number;
  latest_approve_to_pay_minutes: number;
  latest_total_minutes: number;
  avg_submit_to_approve_minutes: number;
  avg_approve_to_pay_minutes: number;
  avg_total_minutes: number;
  pending_count: number;
}

export interface OcrResult {
  id: number;
  invoice_id: number;
  raw_text: string | null;
  invoice_number: string | null;
  issue_date: string | null;
  buyer_name: string | null;
  buyer_tax_id: string | null;
  seller_name: string | null;
  seller_tax_id: string | null;
  total_with_tax: string | null;
  amount: string | null;
  tax_rate: string | null;
  tax_amount: string | null;
  created_at: string;
}

export interface LlmResult {
  id: number;
  invoice_id: number;
  invoice_number: string | null;
  issue_date: string | null;
  buyer_name: string | null;
  buyer_tax_id: string | null;
  seller_name: string | null;
  seller_tax_id: string | null;
  total_with_tax: string | null;
  amount: string | null;
  tax_rate: string | null;
  tax_amount: string | null;

  // 🚨 LLM 的解析结果也会包含这个商品明细数组
  items?: InvoiceItem[] | null;

  // 🚨 HITL置信度：LLM对各字段的自评置信度
  confidence_scores?: Record<string, number> | null;

  created_at: string;
}

export interface ParsingDiff {
  id: number;
  invoice_id: number;
  field_name: string;
  ocr_value: string | null;
  llm_value: string | null;
  final_value: string | null;
  source: string | null;
  confidence: number | null;      // 综合融合置信度 (0.00-1.00)
  ocr_confidence: number | null;  // OCR字段级置信度 (0.00-1.00)
  llm_confidence: number | null;  // LLM自评置信度 (0.00-1.00)
  resolved: number;
}

export interface ImageForensicsResult {
  id: number;
  invoice_id: number;
  risk_score: number;       // 0-100
  risk_level: string;        // 'low' | 'medium' | 'high' | 'unknown'
  metadata_result: Record<string, any> | null;
  ela_result: Record<string, any> | null;
  jpeg_double_compression_result: Record<string, any> | null;
  noise_consistency_result: Record<string, any> | null;
  summary: string | null;
  details: string[] | null;
  created_at: string;
}

export interface InvoiceDetail extends Invoice {
  ocr_result: OcrResult | null;
  llm_result: LlmResult | null;
  parsing_diffs: ParsingDiff[];
  forensics_result: ImageForensicsResult | null;
}

export interface InvoiceListResponse {
  items: Invoice[];
  total: number;
  page: number;
  page_size: number;
}

export interface Statistics {
  count: number;
  total_amount: number;
  total_tax: number;
  total_with_tax: number;
}

export interface UploadResponse {
  id: number;
  file_name: string;
  status: string;
  message: string;
}

// 双引擎精度评估
export interface EvalAccuracy {
  annotated_count: number;
  total_fields: number;
  overall: { ocr: number; llm: number; fusion: number };
  per_field: { field: string; label: string; ocr: number; llm: number; fusion: number; samples: number }[];
  cross_validation: {
    agree_rate: number;
    agree_both_correct: number;
    agree_both_wrong: number;
    disagree_rate: number;
    disagree_ocr_correct: number;
    disagree_llm_correct: number;
    disagree_neither: number;
  };
  review_savings: {
    auto_pass_rate: number;
    auto_pass_count: number;
    need_review_count: number;
  };
}

// 用户个人信息（电子签名）
export interface UserProfile {
  id: number;
  username: string;
  full_name: string;
  role: string;
  department: string | null;
  signature: string | null; // base64 PNG
}

// 报销单状态枚举
export enum ReimbursementStatus {
  DRAFT = "草稿",
  SUBMITTED = "待审批",
  APPROVED = "已通过",
  REJECTED = "已驳回",
  COMPLETED = "已打款",
}

// 报销单详情接口
export interface Reimbursement {
  id: number;
  title: string;
  project_code?: string;
  total_amount: number;
  submitter?: string;
  reviewer?: string;
  reject_reason?: string;
  status: ReimbursementStatus;
  ai_risk_level?: string | null;
  ai_reason?: string | null;
  ai_review_detail?: any;
  review_note?: string | null;
  created_at: string;
  updated_at: string;
  // 模拟打款凭证
  payment_transaction_id?: string | null;
  payment_time?: string | null;
  payment_bank?: string | null;
  bank_card_info?: string | null; // "工商银行 (尾号1234)"
  reviewer_signature?: string | null; // 财务总监电子签名
  borrowing_id?: number | null; // 关联借款申请
  borrowing_info?: {  // 借款冲销详情
    id: number;
    title: string;
    estimated_amount: number;
    repaid_amount: number | null;
    status: string;
  } | null;
  carbon_kg?: number | null; // 碳足迹合计
  invoices?: Invoice[]; // 关联的发票列表（详情接口返回完整数据）
}
// 创建报销单的请求载荷
export interface ReimbursementCreate {
  title: string;
  project_code?: string;
  invoice_ids: number[];
  bank_card_id?: number;
  application_id?: number;
  borrowing_id?: number; // 关联借款申请
  reason_category_id?: number;
}