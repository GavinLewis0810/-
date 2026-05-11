export enum InvoiceStatus {
  UPLOADED = '已上传',
  PROCESSING = '解析中',
  PENDING = '待处理',
  REVIEWING = '待确认',
  CONFIRMED = '已确认',
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
  created_at: string;
  updated_at: string;
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
  resolved: number;
}

export interface InvoiceDetail extends Invoice {
  ocr_result: OcrResult | null;
  llm_result: LlmResult | null;
  parsing_diffs: ParsingDiff[];
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