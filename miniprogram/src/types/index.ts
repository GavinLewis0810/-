// ============================================================
// 从 Web 端完整复用的类型定义
// 来源: frontend/src/types/invoice.ts
// 小程序端 100% 兼容，无需修改
// ============================================================

export enum InvoiceStatus {
  UPLOADED = '已上传',
  PROCESSING = '解析中',
  PENDING = '待处理',
  REVIEWING = '待确认',
  CONFIRMED = '已确认',
  REIMBURSED = '已报销',
  NOT_REIMBURSED = '未报销',
}

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
  total_with_tax: number | null;
  amount: number | null;
  tax_rate: string | null;
  tax_amount: number | null;
  items?: InvoiceItem[] | null;
  status: InvoiceStatus;
  owner: string | null;
  owner_id: number | null;
  reimbursement_id: number | null;
  invoice_hash: string | null;
  ground_truth: Record<string, any> | null;
  spend_category: string | null;
  carbon_kg: number | null;
  created_at: string;
  updated_at: string;
}

export interface InvoiceListResponse {
  items: Invoice[];
  total: number;
  page: number;
  page_size: number;
}

export interface UploadResponse {
  id: number;
  file_name: string;
  status: string;
  message: string;
}

export enum ReimbursementStatus {
  DRAFT = '草稿',
  SUBMITTED = '待审批',
  APPROVED = '已通过',
  REJECTED = '已驳回',
  COMPLETED = '已打款',
}

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
  payment_transaction_id?: string | null;
  payment_time?: string | null;
  payment_bank?: string | null;
  bank_card_info?: string | null;
  reviewer_signature?: string | null;
  borrowing_id?: number | null;
  carbon_kg?: number | null;
  invoices?: Invoice[];
}

export interface ReimbursementCreate {
  title: string;
  project_code?: string;
  invoice_ids: number[];
  bank_card_id?: number;
  application_id?: number;
  borrowing_id?: number;
  reason_category_id?: number;
}

export interface UserProfile {
  id: number;
  username: string;
  full_name: string;
  role: string;
  department: string | null;
  signature: string | null;
}

export interface ProjectItem {
  id: number;
  project_code: string;
  project_name: string;
  budget: number | string;
  used_amount: number | string;
  remaining: number | string;
  usage_rate: number | string;
  created_at: string;
}

export interface NotificationItem {
  id: number;
  title: string;
  message: string | null;
  is_read: boolean;
  entity_type: string | null;
  entity_id: number | null;
  created_at: string;
}
