"""Prompts for LLM-based invoice parsing."""

import json

# JSON Schema definition for strict output format
INVOICE_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "invoice_number": {
            "type": ["string", "null"],
            "description": "发票号码,通常为8-20位数字"
        },
        "invoice_code": {
            "type": ["string", "null"],
            "description": "发票代码,通常为10-12位数字（如有）"
        },
        "issue_date": {
            "type": ["string", "null"],
            "pattern": "^\\d{4}-\\d{2}-\\d{2}$",
            "description": "开票日期,格式必须为YYYY-MM-DD"
        },
        "buyer_name": {
            "type": ["string", "null"],
            "description": "购买方名称（公司全称）"
        },
        "buyer_tax_id": {
            "type": ["string", "null"],
            "pattern": "^[A-Z0-9]{15,20}$",
            "description": "购买方纳税人识别号,15-20位字母数字"
        },
        "seller_name": {
            "type": ["string", "null"],
            "description": "销售方名称（公司全称）"
        },
        "seller_tax_id": {
            "type": ["string", "null"],
            "pattern": "^[A-Z0-9]{15,20}$",
            "description": "销售方纳税人识别号,15-20位字母数字"
        },
        "total_with_tax": {
            "type": ["string", "null"],
            "pattern": "^\\d+(\\.\\d{1,2})?$",
            "description": "价税合计金额,纯数字不含货币符号"
        },
        "amount": {
            "type": ["string", "null"],
            "pattern": "^\\d+(\\.\\d{1,2})?$",
            "description": "总金额（不含税）,纯数字"
        },
        "tax_amount": {
            "type": ["string", "null"],
            "pattern": "^\\d+(\\.\\d{1,2})?$",
            "description": "总税额,纯数字（免税发票返回\"0\"）"
        },
        "tax_rate": {
            "type": ["string", "null"],
            "description": "全局税率,如\"6%\"、\"13%\"、\"免税\""
        },
        "spend_category": {
            "type": ["string", "null"],
            "enum": ["高铁/火车", "航空", "出租车/网约车", "公共交通", "住宿/酒店",
                     "餐饮", "办公用品", "电子产品/设备", "印刷/纸张", "通讯", "其他", None],
            "description": "根据销售方名称和商品明细判断的消费类别。无法判断时返回\"其他\",严禁胡编乱造。"
        },
        "items": {
            "type": ["array", "null"],
            "description": "发票上的商品明细列表,包含所有的商品行。有几行商品就提取几个对象。",
            "items": {
                "type": "object",
                "properties": {
                    "item_name": {"type": ["string", "null"], "description": "项目名称/货物名称"},
                    "specification": {"type": ["string", "null"], "description": "规格型号,如无则返回null"},
                    "unit": {"type": ["string", "null"], "description": "单位,如'个'、'台',如无则返回null"},
                    "quantity": {"type": ["string", "null"], "description": "数量,纯数字,如无则返回null"},
                    "unit_price": {"type": ["string", "null"], "description": "单价,纯数字,如无则返回null"},
                    "amount": {"type": ["string", "null"], "description": "该行商品金额（不含税）,纯数字"},
                    "tax_rate": {"type": ["string", "null"], "description": "该行商品税率"},
                    "tax_amount": {"type": ["string", "null"], "description": "该行商品税额"}
                }
            }
        },
        "confidence_scores": {
            "type": "object",
            "description": "对每个提取字段的置信度评估(0.0-1.0)。1.0=完全确定,0.0=完全不确定。必须包含所有已提取字段的置信度。",
            "properties": {
                "invoice_number": {"type": "number", "minimum": 0, "maximum": 1},
                "invoice_code": {"type": "number", "minimum": 0, "maximum": 1},
                "issue_date": {"type": "number", "minimum": 0, "maximum": 1},
                "buyer_name": {"type": "number", "minimum": 0, "maximum": 1},
                "buyer_tax_id": {"type": "number", "minimum": 0, "maximum": 1},
                "seller_name": {"type": "number", "minimum": 0, "maximum": 1},
                "seller_tax_id": {"type": "number", "minimum": 0, "maximum": 1},
                "total_with_tax": {"type": "number", "minimum": 0, "maximum": 1},
                "amount": {"type": "number", "minimum": 0, "maximum": 1},
                "tax_amount": {"type": "number", "minimum": 0, "maximum": 1},
                "tax_rate": {"type": "number", "minimum": 0, "maximum": 1},
                "items_confidence": {"type": "array", "items": {"type": "number", "minimum": 0, "maximum": 1}, "description": "每个明细行的置信度,与items数组一一对应"}
            }
        }
    },
    "required": [
        "invoice_number", "issue_date",
        "buyer_name", "seller_name", "total_with_tax", "items", "confidence_scores"
    ],
    "additionalProperties": False
}

# Required fields list for validation
REQUIRED_FIELDS = list(INVOICE_JSON_SCHEMA["required"])

# Vision-based system prompt (for direct image analysis)
INVOICE_VISION_SYSTEM_PROMPT = "你是中国发票信息提取助手。严格按JSON格式输出,无法识别返回null。只输出纯JSON,不含任何解释或markdown标记。"

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
INVOICE_VISION_PROMPT = f"""分析这张中国发票图片,只输出纯JSON,严禁包含任何解释、注释、markdown标记或代码片段。找不到的字段返回null。

## JSON格式铁律（违反任何一条都会导致系统崩溃）
1. 必须输出合法JSON,不允许尾随逗号,不允许//或/* */注释。
2. 不允许在JSON外附加任何文字说明。
3. confidence_scores的每个值必须是0-1之间的数字字面量(如0.95),禁止使用表达式、函数或代码片段。

## 核心规则
1. 只提取图片上肉眼可见的文字,不计算、不推测、不脑补。看不清就返回null。
2. 发票号码完整提取所有数字,不截断。
3. 纳税人识别号提取15-20位数字,忽略标签文字。
4. 金额字段只提取图片上明确标注的数字,绝对禁止计算或推测。找不到精确数字→返回null。

## 金额特别约束
- total_with_tax: 只提取"价税合计(小写)"的精确数字
- amount: 只提取"合计"行"金额"列
- tax_amount: 只提取"合计"行"税额"列
- 禁止用 total_with_tax - amount 计算税额。不确定时三个都返回null。

## 购买方与销售方
- 购买方 = "购买方/购方/购货单位"区域的公司名称和税号
- 销售方 = "销售方/销方/销货单位"区域的公司名称和税号

## 商品明细
每行商品提取为items数组中的一个对象,字段: {_items_field_descriptions}

## 置信度评分规则（最高优先级）

**null字段硬性规则（先执行这条！）**
输出前逐字段检查：该字段的值是否为null？
→ 是：confidence_scores中该字段必须填0.0-0.29
→ 否：按下方标准填0.30-0.98
此规则无例外。null配高分 = 结果无效。

**正常字段评分（仅对非null字段）**
0.95-0.98: 文字非常清晰,边缘锐利,无遮挡反光
0.85-0.94: 文字可辨,但有轻微噪点、拍摄倾斜
0.60-0.84: 文字能读,但明显模糊、折痕或光线不均
0.30-0.59: 勉强可辨,需结合上下文推测

items_confidence规则同上：对各明细行的提取质量评分,该行大部分字段为null则整行≤0.29。
必须是纯数字,禁止表达式/函数/代码,禁止全部填相同值。

## 输出结构
{_field_descriptions}

日期YYYY-MM-DD。金额/数量纯数字不含符号。税率如"6%""13%""免税"。所有字段值必须是string或null,items必须是数组。

请直接返回JSON："""

# ... 文件末尾 ...

def build_ai_check_prompt(reimb_title: str, reimb_amount: str, invoices: list, budget_info: str = "") -> str:
    """
    构建用于 AI 合规审查的 prompt,要求 LLM 输出结构化 JSON
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
发票 {inv.get('invoice_number','未知')}（销售方：{inv.get('seller_name','')},价税合计：{inv.get('total_with_tax','0')}元）：
商品明细：
{item_details}
"""

    prompt = f"""请以标准财务审计标准对以下报销单进行审查。你的目标是发现明显的违规行为,而非吹毛求疵。对于模糊或边界情况,应倾向于认定为合规。只关注实质性问题,不要纠结于细枝末节。

## 报销单信息
- 报销事由：{reimb_title}
- 报销总金额：{reimb_amount}元

## 关联发票及商品明细
{invoices_str}
{budget_info}

## 审计要点

### 1. 报销事由合法性（仅关注明显违规）
- 事由是否为无意义的乱码、纯数字、纯字母、随意敲击的内容（如"111"、"asdf"、"测试"）？
  → 如果是,直接判定为 **不合规 + 高风险**。
- 事由是否过于模糊以至于无法判断业务性质（如只有"报销"、"费用"这种完全无信息的词）？
  → 如果是,判定为 **中风险**。
- 如果事由包含了具体的业务场景描述（如"实验室设备更新"、"出差"、"采买办公用品"等）,即使没有精确到具体型号,也判定为 **低风险**。

### 2. 事由与发票商品匹配度（宽松判定）
- 仅判断大类别是否相关,不要求精确匹配：
  - 事由涉及"设备"、"采买"、"采购"、"更新"等,发票是电子产品 → **低风险/合规**
  - 事由涉及"差旅"、"出差",发票是住宿、交通、餐饮类 → **低风险/合规**
  - 事由涉及"维修",发票是维修服务或配件 → **低风险/合规**
  - 事由涉及"办公",发票是文具、耗材、设备 → **低风险/合规**
  - 事由与发票商品属于完全不同的领域（如事由说"医疗用品"但发票是"汽车配件"）→ **中风险**
  - 事由与发票内容完全无关（如事由说"差旅费"但发票是"大型机械设备"）→ **高风险**
- 重要：不要判断商品型号是否真实存在,这是供应商的事。只要商品属于事由所述的大类即可。

### 3. 金额合理性（仅关注明显异常）
- 金额是否与该类业务的正常价格范围差距过大？（如一张办公用纸报销5000元）
- 是否存在非常规的整万金额（如恰好 10000 元、20000 元）且与业务逻辑明显不符？普通的 .00 结尾金额（如 1234.00、5784.00）属于正常记账,不得判定为凑整。

### 4. 发票来源合理性
- 销售方名称是否看起来像正常企业？
- 是否存在同一销售方短时间内大量重复出现？

## 输出要求
只返回一个 JSON 对象,不要任何额外文字：
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