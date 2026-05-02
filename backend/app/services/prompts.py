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

# Vision-based extraction prompt (for direct image analysis)
INVOICE_VISION_PROMPT = f"""请分析这张中国发票图片，提取发票信息。你是一个无情的发票数据提取机器，请绝对忠实于原图。

## 绝对约束与禁止行为 (CRITICAL RULES) - 必须严格遵守
1. 【绝对忠实】只能提取图片中肉眼可见的文字！绝对不允许进行任何数学计算、逻辑推理或常识猜测！
2. 【禁止脑补】如果图片上某个字段（如规格、单位、数量、单价）为空、显示为“-”或看不清，请直接返回 null。绝对不能根据常识自己猜测。
3. 【长数字完整性】发票号码通常是 20 位或 8 位的纯数字。请完整提取图片上的所有数字，绝对不允许截断。
4. 【精确提取】注意区分表单的“标签”和“值”。例如对于纳税人识别号，只返回具体的税号数字。
5. 【明细提取规则】发票中通常包含一个多行的商品明细表格，请将每一行提取为一个对象，放入 `items` 数组中。

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