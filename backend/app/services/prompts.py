"""Prompts for LLM-based invoice parsing."""

import json

# JSON Schema definition for strict output format
INVOICE_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "invoice_number": {
            "type": ["string", "null"],
            "description": "发票号码，通常为8-20位数字"
        },
        "invoice_code": {
            "type": ["string", "null"],
            "description": "发票代码，通常为10-12位数字（如有）"
        },
        "issue_date": {
            "type": ["string", "null"],
            "pattern": "^\\d{4}-\\d{2}-\\d{2}$",
            "description": "开票日期，格式必须为YYYY-MM-DD"
        },
        "buyer_name": {
            "type": ["string", "null"],
            "description": "购买方名称（公司全称）"
        },
        "buyer_tax_id": {
            "type": ["string", "null"],
            "pattern": "^[A-Z0-9]{15,20}$",
            "description": "购买方纳税人识别号，15-20位字母数字"
        },
        "seller_name": {
            "type": ["string", "null"],
            "description": "销售方名称（公司全称）"
        },
        "seller_tax_id": {
            "type": ["string", "null"],
            "pattern": "^[A-Z0-9]{15,20}$",
            "description": "销售方纳税人识别号，15-20位字母数字"
        },
        "total_with_tax": {
            "type": ["string", "null"],
            "pattern": "^\\d+(\\.\\d{1,2})?$",
            "description": "价税合计金额，纯数字不含货币符号"
        },
        "amount": {
            "type": ["string", "null"],
            "pattern": "^\\d+(\\.\\d{1,2})?$",
            "description": "总金额（不含税），纯数字"
        },
        "tax_amount": {
            "type": ["string", "null"],
            "pattern": "^\\d+(\\.\\d{1,2})?$",
            "description": "总税额，纯数字（免税发票返回\"0\"）"
        },
        "tax_rate": {
            "type": ["string", "null"],
            "description": "全局税率，如\"6%\"、\"13%\"、\"免税\""
        },
        "items": {
            "type": ["array", "null"],
            "description": "发票上的商品明细列表，包含所有的商品行。有几行商品就提取几个对象。",
            "items": {
                "type": "object",
                "properties": {
                    "item_name": {"type": ["string", "null"], "description": "项目名称/货物名称"},
                    "specification": {"type": ["string", "null"], "description": "规格型号，如无则返回null"},
                    "unit": {"type": ["string", "null"], "description": "单位，如'个'、'台'，如无则返回null"},
                    "quantity": {"type": ["string", "null"], "description": "数量，纯数字，如无则返回null"},
                    "unit_price": {"type": ["string", "null"], "description": "单价，纯数字，如无则返回null"},
                    "amount": {"type": ["string", "null"], "description": "该行商品金额（不含税），纯数字"},
                    "tax_rate": {"type": ["string", "null"], "description": "该行商品税率"},
                    "tax_amount": {"type": ["string", "null"], "description": "该行商品税额"}
                }
            }
        }
    },
    "required": [
        "invoice_number", "issue_date",
        "buyer_name", "seller_name", "total_with_tax", "items"
    ],
    "additionalProperties": False
}

# Required fields list for validation
REQUIRED_FIELDS = list(INVOICE_JSON_SCHEMA["required"])

# Vision-based system prompt (for direct image analysis)
INVOICE_VISION_SYSTEM_PROMPT = """你是一个专业的中国发票信息提取助手。
你必须严格按照JSON Schema格式返回结果，无法识别的字段返回null。
只返回JSON对象，不要包含任何其他文字、解释或markdown代码块标记。"""

# Build field descriptions for the prompt
_field_descriptions = json.dumps(
    {k: v["description"] for k, v in INVOICE_JSON_SCHEMA["properties"].items()},
    ensure_ascii=False,
    indent=2
)

# Build items sub-field descriptions so LLM knows what keys each item should have
_items_schema = INVOICE_JSON_SCHEMA["properties"]["items"]["items"]["properties"]
_items_field_descriptions = json.dumps(
    {k: v["description"] for k, v in _items_schema.items()},
    ensure_ascii=False,
    indent=2
)

# Vision-based extraction prompt (for direct image analysis)
INVOICE_VISION_PROMPT = f"""请分析这张中国发票图片，提取发票信息。你是一个无情的发票数据提取机器，请绝对忠实于原图。

## 绝对约束与禁止行为 (CRITICAL RULES) - 必须严格遵守
1. 【绝对忠实】只能提取图片中肉眼可见的文字！绝对不允许进行任何数学计算、逻辑推理或常识猜测！
2. 【禁止脑补】如果图片上某个字段（如规格、单位、数量、单价）为空、显示为“-”或看不清，请直接返回 null。绝对不能根据常识自己猜测。
3. 【长数字完整性】发票号码通常是 20 位或 8 位的纯数字。请完整提取图片上的所有数字，绝对不允许截断。
4. 【精确提取】注意区分表单的“标签”和“值”。例如对于纳税人识别号，只返回具体的税号数字。
5. 【明细提取规则】发票中通常包含一个多行的商品明细表格，请将每一行提取为一个对象，放入 `items` 数组中。每个明细对象必须包含以下字段（无法识别的字段返回 null）：
{_items_field_descriptions}

## 输出格式要求（必须严格遵守）
返回一个JSON对象，必须包含以下结构（如果没有找到对应内容，请用null代替，绝不能遗漏字段）：
{_field_descriptions}

字段类型规则：
- 所有字段值必须是 string 或 null（数值也用字符串表示），items 必须是数组。
- 日期格式必须是 YYYY-MM-DD。
- 金额、数量、单价字段仅包含数字和小数点。
- 税率字段格式如 \"6%\"、\"13%\" 或 \"免税\"。

## 购买方与销售方识别规则（最重要）
根据标签文字识别，不要依赖位置：
- 购买方 = 标注为"购买方"、"购方"、"购货单位"的区域
- 销售方 = 标注为"销售方"、"销方"、"销货单位"的区域

## 全局字段与明细字段的区分
1. total_with_tax: 查找发票最底部的"价税合计（大写）"右侧的"(小写)"金额！它通常是整张发票最大的金额。
2. amount / tax_amount (全局): 查找"合 计"行对应的总金额和总税额。
3. items 数组: 仔细识别发票中间的表格区域，有几条商品就提取几个对象，包含其独有的单价、金额等。

请直接返回JSON对象："""

# ... 文件末尾 ...

def build_ai_check_prompt(reimb_title: str, reimb_amount: str, invoices: list, budget_info: str = "") -> str:
    """
    构建用于 AI 合规审查的 prompt，要求 LLM 输出结构化 JSON
    """
    invoices_str = ""
    for inv in invoices:
        item_details = ""
        if inv.get("items"):
            item_details = "\n".join([
                f"   - {i.get('item_name','')} 规格{i.get('specification','')} "
                f"数量{i.get('quantity','')} 单价{i.get('unit_price','')} 金额{i.get('amount','')}"
                for i in inv["items"]
            ])
        else:
            item_details = "   无明细"

        invoices_str += f"""
发票 {inv.get('invoice_number','未知')}（销售方：{inv.get('seller_name','')}，价税合计：{inv.get('total_with_tax','0')}元）：
商品明细：
{item_details}
"""

    prompt = f"""请以标准财务审计标准对以下报销单进行审查。你的目标是发现明显的违规行为，而非吹毛求疵。对于模糊或边界情况，应倾向于认定为合规。只关注实质性问题，不要纠结于细枝末节。

## 报销单信息
- 报销事由：{reimb_title}
- 报销总金额：{reimb_amount}元

## 关联发票及商品明细
{invoices_str}
{budget_info}

## 审计要点

### 1. 报销事由合法性（仅关注明显违规）
- 事由是否为无意义的乱码、纯数字、纯字母、随意敲击的内容（如"111"、"asdf"、"测试"）？
  → 如果是，直接判定为 **不合规 + 高风险**。
- 事由是否过于模糊以至于无法判断业务性质（如只有"报销"、"费用"这种完全无信息的词）？
  → 如果是，判定为 **中风险**。
- 如果事由包含了具体的业务场景描述（如"实验室设备更新"、"出差"、"采买办公用品"等），即使没有精确到具体型号，也判定为 **低风险**。

### 2. 事由与发票商品匹配度（宽松判定）
- 仅判断大类别是否相关，不要求精确匹配：
  - 事由涉及"设备"、"采买"、"采购"、"更新"等，发票是电子产品 → **低风险/合规**
  - 事由涉及"差旅"、"出差"，发票是住宿、交通、餐饮类 → **低风险/合规**
  - 事由涉及"维修"，发票是维修服务或配件 → **低风险/合规**
  - 事由涉及"办公"，发票是文具、耗材、设备 → **低风险/合规**
  - 事由与发票商品属于完全不同的领域（如事由说"医疗用品"但发票是"汽车配件"）→ **中风险**
  - 事由与发票内容完全无关（如事由说"差旅费"但发票是"大型机械设备"）→ **高风险**
- 重要：不要判断商品型号是否真实存在，这是供应商的事。只要商品属于事由所述的大类即可。

### 3. 金额合理性（仅关注明显异常）
- 金额是否与该类业务的正常价格范围差距过大？（如一张办公用纸报销5000元）
- 是否存在非常规的整万金额（如恰好 10000 元、20000 元）且与业务逻辑明显不符？普通的 .00 结尾金额（如 1234.00、5784.00）属于正常记账，不得判定为凑整。

### 4. 发票来源合理性
- 销售方名称是否看起来像正常企业？
- 是否存在同一销售方短时间内大量重复出现？

## 输出要求
只返回一个 JSON 对象，不要任何额外文字：
{{
    "compliance_status": "合规" 或 "不合规",
    "risk_level": "低风险" 或 "中风险" 或 "高风险",
    "reason": "一句话总结核心判断依据",
    "remarks": "审计意见",
    "details": [
        {{
            "issue": "具体发现的问题",
            "severity": "轻微" 或 "中等" 或 "严重",
            "comment": "针对该问题的详细说明"
        }}
    ]
}}

核心原则：默认假设报销是合规的。只有在发现明显、确凿的违规证据时才提高风险等级。事由和发票属于同一大类即为匹配。不要质疑商品型号是否存在。"""
    return prompt