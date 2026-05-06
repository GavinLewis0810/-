import hashlib
import secrets
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from pydantic import BaseModel

from app.database import get_db
from app.models.user import User

router = APIRouter()

# ====== 内存级 Session 存储（后端重启即清空，所有 token 失效）======
_session_store: dict[str, dict] = {}


def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()


def _user_to_dict(user: User) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "full_name": user.full_name,
        "role": user.role,
        "department": user.department,
        "signature": user.signature,
    }


class RegisterRequest(BaseModel):
    username: str
    password: str
    full_name: str


class LoginRequest(BaseModel):
    username: str
    password: str


class UpdateProfileRequest(BaseModel):
    full_name: Optional[str] = None
    department: Optional[str] = None
    signature: Optional[str] = None  # base64 PNG


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str


@router.post("/register")
async def register(data: RegisterRequest, db: AsyncSession = Depends(get_db)):
    # 🚀 防御升级一：系统保留字/敏感词黑名单拦截
    # 彻底杜绝员工试图注册具有误导性或特权的用户名
    reserved_usernames = ["admin", "administrator", "root", "system", "sys", "test", "boss"]
    if data.username.lower() in reserved_usernames:
        raise HTTPException(
            status_code=400,
            detail=f"【安全拦截】'{data.username}' 为系统保留关键字，禁止被注册为普通员工账号！"
        )

    # 🚀 防御升级二：全局重名校验
    query = select(User).where(User.username == data.username)
    result = await db.execute(query)
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="该用户名已被其他同事占用，请换一个名称")

    # 创建新用户，依然强制锁死为普通员工 (employee)
    new_user = User(
        username=data.username,
        password_hash=hash_password(data.password),
        role="employee",
        full_name=data.full_name
    )
    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)

    return {"message": "注册成功", "user": {"id": new_user.id, "username": new_user.username, "role": new_user.role}}


@router.post("/login")
async def login(data: LoginRequest, db: AsyncSession = Depends(get_db)):
    query = select(User).where(User.username == data.username)
    result = await db.execute(query)
    user = result.scalar_one_or_none()

    if not user or user.password_hash != hash_password(data.password):
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="账号已被禁用，请联系管理员")
    token = secrets.token_hex(32)
    user_data = _user_to_dict(user)
    _session_store[token] = user_data

    return {
        "message": "登录成功",
        "token": token,
        "user": user_data,
    }


@router.get("/me")
async def validate_session(
    x_session_token: str = Header(default="", alias="X-Session-Token"),
):
    """验证 session token 是否有效。后端重启后内存清空，所有 token 失效。"""
    if not x_session_token:
        raise HTTPException(status_code=401, detail="未登录")
    user = _session_store.get(x_session_token)
    if not user:
        raise HTTPException(status_code=401, detail="会话已过期，请重新登录")
    return {"user": user}


@router.put("/profile")
async def update_profile(
    data: UpdateProfileRequest,
    x_session_token: str = Header(default="", alias="X-Session-Token"),
    db: AsyncSession = Depends(get_db),
):
    """更新个人信息：姓名、部门、电子签名"""
    if not x_session_token:
        raise HTTPException(status_code=401, detail="未登录")
    session = _session_store.get(x_session_token)
    if not session:
        raise HTTPException(status_code=401, detail="会话已过期，请重新登录")

    user_id = session["id"]
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")

    updates = {}
    if data.full_name is not None:
        user.full_name = data.full_name
        updates["full_name"] = data.full_name
    if data.department is not None:
        user.department = data.department
        updates["department"] = data.department
    if data.signature is not None:
        user.signature = data.signature
        updates["signature"] = data.signature

    await db.commit()
    await db.refresh(user)

    # 同步更新 session 缓存
    for key in updates:
        session[key] = updates[key]

    return {"message": "个人信息已更新", "user": _user_to_dict(user)}


@router.put("/password")
async def change_password(
    data: ChangePasswordRequest,
    x_session_token: str = Header(default="", alias="X-Session-Token"),
    db: AsyncSession = Depends(get_db),
):
    """修改密码（需验证旧密码）"""
    if not x_session_token:
        raise HTTPException(status_code=401, detail="未登录")
    session = _session_store.get(x_session_token)
    if not session:
        raise HTTPException(status_code=401, detail="会话已过期，请重新登录")

    user_id = session["id"]
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")

    if user.password_hash != hash_password(data.old_password):
        raise HTTPException(status_code=400, detail="旧密码不正确")

    if len(data.new_password) < 3:
        raise HTTPException(status_code=400, detail="新密码至少 3 位")

    user.password_hash = hash_password(data.new_password)
    await db.commit()

    return {"message": "密码修改成功"}