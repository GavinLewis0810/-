"""LLM-based invoice parsing service with multi-provider support."""

import base64
import json
import logging
import re
import threading
from abc import ABC, abstractmethod
from typing import Optional, Dict, Any

from app.config import get_settings

# Thread lock for singleton initialization
_llm_lock = threading.Lock()
from app.services.prompts import (
    INVOICE_VISION_PROMPT,
    INVOICE_VISION_SYSTEM_PROMPT,
    REQUIRED_FIELDS,
)

logger = logging.getLogger(__name__)
settings = get_settings()


def _model_matches_vision_pattern(model_name: str, vision_patterns: list[str]) -> bool:
    """跳过正则校验，我们现在使用焊死模式"""
    return True


def _model_uses_new_token_param(model_name: str) -> bool:
    return False


def _get_max_tokens_param(model_name: str, value: int) -> dict:
    return {"max_tokens": value}


class BaseLLMProvider(ABC):
    """Base class for LLM providers."""

    @abstractmethod
    def is_configured(self) -> bool:
        pass

    @abstractmethod
    def get_provider_name(self) -> str:
        pass

    @abstractmethod
    def chat_completion(self, system_prompt: str, user_prompt: str) -> str:
        pass

    def supports_vision(self) -> bool:
        return False

    def vision_completion(self, system_prompt: str, user_prompt: str, image_data: bytes, mime_type: str = "image/png") -> str:
        raise NotImplementedError("Vision not supported by this provider")


class OpenAIProvider(BaseLLMProvider):
    """OpenAI/OpenAI-compatible provider."""
    def __init__(self):
        self._client = None
        self._lock = threading.Lock()

    @property
    def client(self):
        if self._client is None:
            from openai import OpenAI
            self._client = OpenAI(api_key=settings.openai_api_key, base_url=settings.openai_base_url)
        return self._client

    def is_configured(self) -> bool:
        return bool(settings.openai_api_key)

    def get_provider_name(self) -> str:
        return "openai"

    def chat_completion(self, system_prompt: str, user_prompt: str) -> str:
        return ""


class QwenProvider(BaseLLMProvider):
    """Alibaba Qwen provider (OpenAI-compatible)."""

    def __init__(self):
        self._client = None
        self._lock = threading.Lock()

    @property
    def client(self):
        if self._client is None:
            with self._lock:
                if self._client is None:
                    from openai import OpenAI
                    # 【强制焊死】直接写死阿里云百炼官方接口和你的真实 Key
                    self._client = OpenAI(
                        api_key="sk-1bffc641148948bca84e73bf2507280c",
                        base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
                    )
        return self._client

    def is_configured(self) -> bool:
        # 【强制焊死】
        return True

    def get_provider_name(self) -> str:
        return "qwen"

    def supports_vision(self) -> bool:
        # 【强制焊死】
        return True

    def chat_completion(self, system_prompt: str, user_prompt: str) -> str:
        response = self.client.chat.completions.create(
            model="qwen-vl-plus",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            temperature=0.1,
            max_tokens=1000,
        )
        return response.choices[0].message.content.strip()

    def vision_completion(self, system_prompt: str, user_prompt: str, image_data: bytes, mime_type: str = "image/png") -> str:
        base64_image = base64.b64encode(image_data).decode("utf-8")
        response = self.client.chat.completions.create(
            model="qwen-vl-plus", # 【强制焊死】使用视觉模型
            messages=[
                {"role": "system", "content": system_prompt},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": user_prompt},
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:{mime_type};base64,{base64_image}"}
                        }
                    ]
                }
            ],
            temperature=0.01,
            max_tokens=1500,
        )
        return response.choices[0].message.content.strip()


# 其他 Provider 留空以简化
class AnthropicProvider(BaseLLMProvider):
    def is_configured(self): return False
    def get_provider_name(self): return "anthropic"
    def chat_completion(self, s, u): return ""

class GoogleProvider(BaseLLMProvider):
    def is_configured(self): return False
    def get_provider_name(self): return "google"
    def chat_completion(self, s, u): return ""

class DeepSeekProvider(BaseLLMProvider):
    def is_configured(self): return False
    def get_provider_name(self): return "deepseek"
    def chat_completion(self, s, u): return ""

class ZhipuProvider(BaseLLMProvider):
    def is_configured(self): return False
    def get_provider_name(self): return "zhipu"
    def chat_completion(self, s, u): return ""


# Provider registry
PROVIDERS: Dict[str, type] = {
    "openai": OpenAIProvider,
    "anthropic": AnthropicProvider,
    "google": GoogleProvider,
    "qwen": QwenProvider,
    "deepseek": DeepSeekProvider,
    "zhipu": ZhipuProvider,
}


class LLMService:
    """Handles LLM-based invoice parsing with fixed Qwen config."""

    def __init__(self):
        self._providers: Dict[str, BaseLLMProvider] = {}
        self._active_provider: Optional[BaseLLMProvider] = None

    def _get_provider(self, provider_name: str) -> Optional[BaseLLMProvider]:
        if provider_name not in self._providers:
            if provider_name in PROVIDERS:
                self._providers[provider_name] = PROVIDERS[provider_name]()
        return self._providers.get(provider_name)

    @property
    def active_provider(self) -> Optional[BaseLLMProvider]:
        """【强制焊死】无论前端选什么，始终返回配置好的 QwenProvider"""
        return self._get_provider("qwen")

    @property
    def is_available(self) -> bool:
        """【强制焊死】始终可用"""
        return True

    def get_configured_providers(self) -> list[str]:
        return ["qwen"]

    def get_active_provider_name(self) -> Optional[str]:
        return "qwen"

    def supports_vision(self) -> bool:
        return True

    def parse_invoice_from_image(self, image_data: bytes, mime_type: str = "image/png") -> Dict[str, Any]:
        """解析核心逻辑"""
        provider = self.active_provider
        try:
            content = provider.vision_completion(
                INVOICE_VISION_SYSTEM_PROMPT,
                INVOICE_VISION_PROMPT,
                image_data,
                mime_type
            )
            return self._parse_json_response(content, provider.get_provider_name())
        except Exception as e:
            logger.error(f"LLM vision parsing failed: {e}")
            return {}

    def _normalize_field_value(self, field_name: str, value: Any) -> Optional[str]:
        if value is None: return None
        if isinstance(value, (int, float)): value = str(value)
        if not isinstance(value, str): return None
        cleaned = value.strip()
        if not cleaned: return None
        # 🚨 强化清洗 1：去除大模型手欠提取的“标签前缀”
        if field_name in ['buyer_tax_id', 'seller_tax_id']:
            # 用正则抹除“纳税人识别号:”之类的多余文字
            cleaned = re.sub(r'^(统一社会信用代码/纳税人识别号|纳税人识别号|税号)[:：]?\s*', '', cleaned)
            # 抹除后如果没东西了，说明原图真的是空的
            if not cleaned:
                return None

        # 🚨 强化清洗 2：中英文标点统一（解决“个人（个人）”冲突）
        if field_name in ['buyer_name', 'seller_name', 'item_name']:
            cleaned = cleaned.replace('（', '(').replace('）', ')')

        # 🚨 强化清洗 3：干掉发票号码莫名其妙的前导 0
        if field_name == 'invoice_number':
            # 如果大模型多加了00，且把前面多余的0去掉后长度在正常范围（比如20位）
            if cleaned.startswith('0') and len(cleaned) > 20:
                cleaned = cleaned.lstrip('0')
        # 简单清洗金额
        if field_name in ['total_with_tax', 'amount', 'tax_amount']:
            cleaned = re.sub(r'[¥￥$€,，\s]', '', cleaned)
            match = re.search(r'(\d+(?:\.\d{1,2})?)', cleaned)
            return match.group(1) if match else None

        # 简单清洗日期
        if field_name == 'issue_date':
            match = re.search(r'(\d{4})[年/-](\d{1,2})[月/-](\d{1,2})', cleaned)
            if match:
                y, m, d = match.groups()
                return f"{int(y):04d}-{int(m):02d}-{int(d):02d}"
        return cleaned

    def _parse_json_response(self, content: str, provider_name: str) -> Dict[str, Any]:
        print(f"\n========== 大模型原始回复 ==========\n{content}\n==================================\n")
        if "```json" in content:
            content = content.split("```json")[1].split("```")[0].strip()
        elif "```" in content:
            content = content.split("```")[1].strip()

        try:
            raw_fields = json.loads(content)
        except:
            raw_fields = json.loads(content.strip())

        fields: Dict[str, Any] = {}
        for field in REQUIRED_FIELDS:
            if field == 'items':
                raw_items = raw_fields.get('items', [])
                if not isinstance(raw_items, list):
                    raw_items = []

                cleaned_items = []
                # 🚨 新增：建立别名映射字典，防范大模型自作聪明改名字
                alias_map = {
                    "project_name": "item_name",
                    "name": "item_name",
                    "goods_name": "item_name",
                    "spec_model": "specification",
                    "spec": "specification",
                    "model": "specification"
                }

                for item in raw_items:
                    if isinstance(item, dict):
                        cleaned_item = {}
                        for k, v in item.items():
                            # 强行把别名转换成我们的标准字段名
                            standard_key = alias_map.get(k, k)
                            cleaned_item[standard_key] = self._normalize_field_value(standard_key, v)
                        cleaned_items.append(cleaned_item)
                fields['items'] = cleaned_items
            else:
                fields[field] = self._normalize_field_value(field, raw_fields.get(field))

        logger.info(f"LLM (FIXED QWEN) extracted fields: {list(fields.keys())}")
        return fields


# Singleton instance
_llm_service: Optional[LLMService] = None


def get_llm_service() -> LLMService:
    global _llm_service
    if _llm_service is None:
        with _llm_lock:
            if _llm_service is None:
                _llm_service = LLMService()
    return _llm_service


def reset_llm_service():
    global _llm_service
    with _llm_lock:
        _llm_service = None