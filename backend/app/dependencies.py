"""请求级依赖：从 Header 读取 Session Token，查找内存中的用户会话。"""
from fastapi import Header, HTTPException

from app.routers.auth import _session_store


async def get_current_user(
    x_session_token: str = Header(default="", alias="X-Session-Token"),
) -> dict:
    """从 X-Session-Token 请求头验证会话，返回 {id, username, role, full_name}。"""
    if not x_session_token:
        raise HTTPException(status_code=401, detail="未登录：缺少会话凭证")

    user = _session_store.get(x_session_token)
    if not user:
        raise HTTPException(status_code=401, detail="会话已过期，请重新登录")

    return user
