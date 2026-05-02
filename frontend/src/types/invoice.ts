export enum InvoiceStatus {
  UPLOADED = '已上传',      // File uploaded, waiting for OCR processing
  PROCESSING = '解析中',    // OCR/LLM processing in progress
  PENDING = '待处理',       // Processing complete, no conflicts
  REVIEWING = '待审核',     // Has conflicts or missing fields, needs manual review
  CONFIRMED = '已确认',     // Manually reviewed and confirmed
  REIMBURSED = '已报销',    // Reimbursement completed
  NOT_REIMBURSED = '未报销', // Not yet reimbursed
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

// LLM Configuration Types
export interface LLMProviderInfo {
  name: string;
  display_name: string;
  is_configured: boolean;
  model: string | null;
  base_url: string | null;
}

export interface LLMStatusResponse {
  is_configured: boolean;
  active_provider: string | null;
  active_provider_display: string | null;
  configured_providers: string[];
  available_providers: LLMProviderInfo[];
}

export interface LLMConfigRequest {
  provider: string;
  api_key: string;
  model?: string;
  base_url?: string;
}

export interface LLMConfigResponse {
  success: boolean;
  message: string;
  provider: string | null;
}

export interface LLMTestResponse {
  success: boolean;
  provider: string;
  provider_display: string;
  message: string;
  response: string;
}

// Model Registry Types
export interface ModelInfo {
  id: string;
  name: string;
  vision: boolean;
  context_length?: number;
  pricing?: {
    prompt?: string;
    completion?: string;
  };
}

export interface ModelsResponse {
  models: ModelInfo[];
  source: 'openrouter' | 'fallback';
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
  created_at: string;
  updated_at: string;
  invoices?: any[]; // 关联的发票列表
}

// 创建报销单的请求载荷
export interface ReimbursementCreate {
  title: string;
  project_code?: string;
  invoice_ids: number[];
}