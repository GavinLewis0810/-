import asyncio
import json
import logging
from typing import Dict, List, Optional
from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    """WebSocket 连接池：按 user_id 管理多个连接（支持多设备/多标签页）。"""

    def __init__(self):
        self._connections: Dict[int, List[WebSocket]] = {}

    async def connect(self, user_id: int, ws: WebSocket):
        await ws.accept()
        self._connections.setdefault(user_id, []).append(ws)
        logger.info(f"WebSocket 连接: user_id={user_id}, 当前连接数={len(self._connections[user_id])}")

    def disconnect(self, user_id: int, ws: WebSocket):
        conns = self._connections.get(user_id, [])
        if ws in conns:
            conns.remove(ws)
        if not conns:
            self._connections.pop(user_id, None)
        logger.info(f"WebSocket 断开: user_id={user_id}")

    async def send_to_user(self, user_id: int, data: dict):
        """推送 JSON 消息给指定用户的所有连接。"""
        conns = self._connections.get(user_id, [])
        if not conns:
            return
        payload = json.dumps(data, ensure_ascii=False)
        dead: List[WebSocket] = []
        for ws in conns:
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(user_id, ws)

    async def broadcast(self, data: dict):
        """推送给所有在线用户。"""
        payload = json.dumps(data, ensure_ascii=False)
        for user_id, conns in list(self._connections.items()):
            dead = []
            for ws in conns:
                try:
                    await ws.send_text(payload)
                except Exception:
                    dead.append(ws)
            for ws in dead:
                self.disconnect(user_id, ws)

    @property
    def online_count(self) -> int:
        return sum(len(v) for v in self._connections.values())


ws_manager = ConnectionManager()


async def push_notification(
    db,
    user_id: int,
    title: str,
    message: str,
    entity_type: str = "",
    entity_id: Optional[int] = None,
):
    """统一入口：创建数据库通知 + 通过 WebSocket 实时推送给目标用户。"""
    from app.models.notification import Notification

    notif = Notification(
        user_id=user_id,
        title=title,
        message=message,
        entity_type=entity_type or None,
        entity_id=entity_id,
    )
    db.add(notif)

    await ws_manager.send_to_user(user_id, {
        "type": "notification",
        "notification_id": notif.id or 0,
        "title": title,
        "message": message,
        "entity_type": entity_type,
        "entity_id": entity_id,
    })


async def push_notification_to_admins(
    db,
    title: str,
    message: str,
    entity_type: str = "",
    entity_id: Optional[int] = None,
):
    """向所有管理员推送通知（数据库 + WebSocket）。"""
    from sqlalchemy import select
    from app.models.user import User

    admins = (await db.execute(select(User).where(User.role == "admin"))).scalars().all()
    for admin in admins:
        await push_notification(db, admin.id, title, message, entity_type, entity_id)
